/** إدارة الجهات والحسابات — مشتركة بين شاشات الأدمن وAPI الربط (manage_users). */
import { randomBytes } from 'node:crypto';
import { getDb, tx } from '../db/sqlite.js';
import { AppError, Errors } from '../http/errors.js';
import { Checker, isEmail, isPhone, normalizeDigits, onlyKeys, type Obj } from '../http/validate.js';
import { hashPassword, sha256 } from '../auth/jwt.js';
import { config } from '../config.js';
import { ROLE_ORG_TYPE, ROLE_LABELS, STAFF_ROLES, ORG_IDS, type Role, type OrgType } from '../domain.js';
import { dispatchCore } from '../../../core/notify/dispatch.js';
import { activeStaffCount, createOrganization, getOrganization, isStructuralOrg, updateOrganization } from '../store/organizations.js';
import { changeEmail, createUser, getUserByEmail, getUserById, setPassword, setVerifyToken, updateUserProfile, toPublicUser } from '../store/users.js';
import { dispatch } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { revokeAllForUser } from '../store/refreshTokens.js';
import { addAuditLog, type AuditActor } from '../store/audit.js';

/** كلمة مؤقتة قوية (تحوي حروفًا وأرقامًا) — تُعرض مرة واحدة ويجب تغييرها عند أول دخول. */
export function tempPassword(): string {
  return `Tmp-${randomBytes(9).toString('base64url')}7a`;
}

export interface AccountsPolicy { allowAdminAccounts: boolean }

const CREATABLE_ORG_TYPES: OrgType[] = ['funder'];

export async function createOrg(actor: AuditActor, body: unknown) {
  const b: Obj = onlyKeys(body, ['type', 'nameAr', 'nameEn', 'contactEmail']);
  const c = new Checker();
  const nameAr = c.text(b, 'nameAr', { required: true, min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { required: true, min: 2, max: 200 });
  const contactEmail = c.text(b, 'contactEmail', { max: 254 });
  if (contactEmail && !isEmail(contactEmail)) c.add('contactEmail', 'invalid email');
  // الجهات الهيكلية ثابتة، والمتقدمون يسجلون بأنفسهم — الإضافة هنا لجهات التمويل فقط.
  if (!CREATABLE_ORG_TYPES.includes(b.type as OrgType)) c.add('type', 'only "funder" organizations can be created');
  c.throwIfAny();
  const org = await createOrganization({ type: b.type as OrgType, nameAr: nameAr!, nameEn: nameEn!, contactEmail });
  await addAuditLog({ ...actor, action: 'organization.create', entityType: 'organization', entityId: org.id, summaryAr: `إضافة جهة: ${org.nameAr}` });
  return org;
}

export async function updateOrg(actor: AuditActor, id: string, body: unknown, opts: AccountsPolicy) {
  const org = await getOrganization(id);
  if (!org) throw Errors.notFound();
  if (!opts.allowAdminAccounts && org.type === 'admin') throw Errors.forbidden('لا يمكن تعديل جهة إدارة النظام عبر الربط.', 'The administration organization cannot be modified via integration.');
  const b: Obj = onlyKeys(body, ['nameAr', 'nameEn', 'contactEmail', 'isActive', 'confirmOpenReferrals']);
  const c = new Checker();
  const nameAr = c.text(b, 'nameAr', { min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { min: 2, max: 200 });
  const contactEmail = c.text(b, 'contactEmail', { max: 254 });
  if (contactEmail && !isEmail(contactEmail)) c.add('contactEmail', 'invalid email');
  if (b.isActive !== undefined && typeof b.isActive !== 'boolean') c.add('isActive', 'must be boolean');
  if (b.isActive === false && isStructuralOrg(id)) c.add('isActive', 'structural organizations cannot be deactivated');
  c.throwIfAny();
  const load = b.isActive === false && org.type === 'funder' && org.isActive ? await requireFunderLoadConfirmation(org.id, b.confirmOpenReferrals) : null;
  const after = await tx(async () => {
    const updated = (await updateOrganization(id, { nameAr, nameEn, contactEmail, isActive: b.isActive as boolean | undefined }))!;
    await addAuditLog({ ...actor, action: 'organization.update', entityType: 'organization', entityId: id, summaryAr: `تعديل جهة: ${updated.nameAr}`, details: { before: org, after: updated, openLoad: load } });
    return updated;
  });
  return after;
}

export async function createStaffUser(actor: AuditActor, body: unknown, opts: AccountsPolicy) {
  const b: Obj = onlyKeys(body, ['email', 'nameAr', 'nameEn', 'phone', 'role', 'organizationId']);
  const c = new Checker();
  const email = c.text(b, 'email', { required: true, max: 254 });
  const nameAr = c.text(b, 'nameAr', { required: true, min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { max: 200 });
  const phoneRaw = c.text(b, 'phone', { max: 20 });
  const phone = phoneRaw === undefined ? undefined : normalizeDigits(phoneRaw);
  if (email && !isEmail(email)) c.add('email', 'invalid email');
  if (phone && !isPhone(phone)) c.add('phone', 'invalid phone number');
  const role = b.role as Role;
  const allowedRoles = opts.allowAdminAccounts ? STAFF_ROLES : STAFF_ROLES.filter((r) => r !== 'system_admin');
  if (!allowedRoles.includes(role)) c.add('role', `must be one of ${allowedRoles.join(', ')}`);
  const orgId = typeof b.organizationId === 'string' ? b.organizationId : '';
  const org = orgId ? await getOrganization(orgId) : null;
  if (!org) c.add('organizationId', 'unknown organization');
  else if (allowedRoles.includes(role) && org.type !== ROLE_ORG_TYPE[role]) c.add('organizationId', `role ${role} requires an organization of type ${ROLE_ORG_TYPE[role]}`);
  c.throwIfAny();
  if (await getUserByEmail(email!)) throw new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم بالفعل.', 'This email is already in use.');
  // One account per person: an e-mail that already has a platform account only gets the Sona3 role (its password is unchanged).
  const password = tempPassword();
  const user = await tx(async () => {
    const u = await createUser({
      organizationId: org!.id, role, email: email!.toLowerCase(), nameAr: nameAr!, nameEn, phone, passwordHash: hashPassword(password),
      mustChangePassword: true, emailVerified: true, createdBy: actor.actorUserId ?? null,
    });
    await addAuditLog({ ...actor, action: 'user.create', entityType: 'user', entityId: u.id, summaryAr: `إنشاء حساب ${role}: ${u.email}`, details: { role, organizationId: org!.id } });
    return u;
  });
  if (user.existingAccount) {
    await dispatchCore('platform.membership_added', { name: user.nameAr, initiativeAr: 'صُنّاع المستقبل', initiativeEn: "Sona'a El-Mostaqbal", roleAr: ROLE_LABELS[role]?.ar ?? role },
      [{ userId: user.id, email: user.email }], { dedupePrefix: `membership:${user.id}:sona3`, channels: ['email'] });
    kickNotificationWorker();
    return { user: toPublicUser(user), temporaryPassword: null, existingAccount: true };
  }
  return { user: toPublicUser(user), temporaryPassword: password };
}

export async function updateStaffUser(actor: AuditActor, id: string, body: unknown, opts: AccountsPolicy) {
  const u = await getUserById(id);
  if (!u) throw Errors.notFound();
  if (u.role === 'applicant') throw Errors.forbidden('حسابات المتقدمين يديرها أصحابها.', 'Applicant accounts are managed by their owners.');
  if (!opts.allowAdminAccounts && (u.role === 'system_admin' || u.organizationId === ORG_IDS.admin)) {
    throw Errors.forbidden('لا يمكن تعديل حسابات إدارة النظام عبر الربط.', 'System administrator accounts cannot be modified via integration.');
  }
  const b: Obj = onlyKeys(body, ['nameAr', 'nameEn', 'phone', 'isActive', 'resetPassword', 'confirmOpenReferrals']);
  const c = new Checker();
  const nameAr = c.text(b, 'nameAr', { min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { max: 200 });
  const phoneRaw = c.text(b, 'phone', { max: 20 });
  const phone = phoneRaw === undefined ? undefined : normalizeDigits(phoneRaw);
  if (phone && !isPhone(phone)) c.add('phone', 'invalid phone number');
  if (b.isActive !== undefined && typeof b.isActive !== 'boolean') c.add('isActive', 'must be boolean');
  if (b.resetPassword !== undefined && b.resetPassword !== true) c.add('resetPassword', 'must be true when present');
  if (b.isActive === false && actor.actorUserId === id) c.add('isActive', 'you cannot deactivate your own account');
  c.throwIfAny();
  // إيقاف آخر مستخدم نشط في جهة تمويل لها إحالات مفتوحة = الجهة تصبح بلا من يعمل فيها.
  const lastFunderUser = b.isActive === false && u.isActive && u.role === 'funder_reviewer' && await activeStaffCount(u.organizationId) === 1;
  const load = lastFunderUser ? await requireFunderLoadConfirmation(u.organizationId, b.confirmOpenReferrals) : null;
  let temporaryPassword: string | undefined;
  const after = await tx(async () => {
    const updated = (await updateUserProfile(id, { nameAr, nameEn, phone, isActive: b.isActive as boolean | undefined }))!;
    if (b.isActive === false) await revokeAllForUser(id);
    if (b.resetPassword === true) {
      temporaryPassword = tempPassword();
      await setPassword(id, hashPassword(temporaryPassword), true);
      await revokeAllForUser(id);
    }
    await addAuditLog({ ...actor, action: 'user.update', entityType: 'user', entityId: id, summaryAr: `تعديل حساب: ${u.email}`,
      details: { isActive: b.isActive, resetPassword: b.resetPassword === true, nameChanged: Boolean(nameAr || nameEn), openLoad: load } });
    return updated;
  });
  return { user: toPublicUser((await getUserById(after.id))!), ...(temporaryPassword ? { temporaryPassword } : {}) };
}

/** إحالات مفتوحة (قيد الدراسة) وملفات ممولة قيد التنفيذ/التشغيل لدى جهة التمويل. */
export async function openFunderLoad(funderOrgId: string): Promise<{ referrals: number; funded: number }> {
  const db = getDb();
  const referrals = (await db.prepare("SELECT COUNT(*) AS n FROM sona3_funding_referrals WHERE funderOrgId = ? AND status = 'pending'").get(funderOrgId) as { n: number }).n;
  const funded = (await db.prepare("SELECT COUNT(*) AS n FROM sona3_applications WHERE funderOrgId = ? AND state IN ('IMPLEMENTATION','OPERATING')").get(funderOrgId) as { n: number }).n;
  return { referrals, funded };
}

/**
 * إيقاف جهة تمويل (أو آخر مستخدميها) لها ملفات مفتوحة يحتاج تأكيدًا صريحًا يعرض عددها.
 * بلا confirmOpenReferrals=true → 409 OPEN_REFERRALS ولا يُنفذ شيء.
 */
async function requireFunderLoadConfirmation(funderOrgId: string, confirm: unknown): Promise<{ referrals: number; funded: number } | null> {
  const load = await openFunderLoad(funderOrgId);
  const total = load.referrals + load.funded;
  if (!total) return null;
  if (confirm !== true) {
    throw new AppError(409, 'OPEN_REFERRALS',
      `لهذه الجهة ${load.referrals} ملف قيد الدراسة و${load.funded} مشروع ممول قيد التنفيذ/التشغيل. الإيقاف يتركها بلا من يعمل عليها (لن تُصرف الدفعات). أكّد الإيقاف صراحة للمتابعة.`,
      `This funder has ${load.referrals} file(s) under review and ${load.funded} funded project(s). Confirm explicitly to proceed.`,
      [{ field: 'confirmOpenReferrals', issue: `required: ${total} open item(s)` }]);
  }
  return load;
}

const VERIFY_TTL_MS = 24 * 3600_000;

/**
 * استرداد إداري لحساب متقدم فقد مالكه بريده — بريد جديد غير مستخدم، بسبب ومرجع طلب رسمي إجباريين.
 * البريد الجديد غير مفعّل حتى يُفتح رابطه، وتُلغى كل الجلسات، ويُبلَّغ البريدان، ويُدقق الإجراء كاملًا.
 */
export async function recoverApplicantEmail(actor: AuditActor, id: string, body: unknown) {
  const u = await getUserById(id);
  if (!u) throw Errors.notFound();
  if (u.role !== 'applicant') throw Errors.forbidden('الاسترداد بتغيير البريد لحسابات المتقدمين فقط.', 'Email recovery applies to applicant accounts only.');
  const b: Obj = onlyKeys(body, ['newEmail', 'reason', 'requestReference']);
  const c = new Checker();
  const newEmail = c.text(b, 'newEmail', { required: true, max: 254 });
  const reason = c.text(b, 'reason', { required: true, min: 10, max: 1000 });
  const requestReference = c.text(b, 'requestReference', { required: true, min: 3, max: 120 });
  if (newEmail && !isEmail(newEmail)) c.add('newEmail', 'invalid email');
  c.throwIfAny();
  const email = newEmail!.toLowerCase();
  if (email === u.email.toLowerCase()) throw Errors.validation([{ field: 'newEmail', issue: 'same as current email' }]);
  if (await getUserByEmail(email)) throw new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم بالفعل.', 'This email is already in use.');
  const oldEmail = u.email;
  const token = randomBytes(32).toString('hex');
  const hash = sha256(token);
  await tx(async () => {
    await changeEmail(u.id, email);
    await setVerifyToken(u.id, hash, new Date(Date.now() + VERIFY_TTL_MS).toISOString());
    await revokeAllForUser(u.id);
    await addAuditLog({ ...actor, action: 'user.recover_email', entityType: 'user', entityId: u.id,
      summaryAr: `استرداد حساب متقدم: تغيير البريد (مرجع ${requestReference})`,
      details: { oldEmail, newEmail: email, reason, requestReference, sessionsRevoked: true } });
    await dispatch('auth.email_changed_old', { name: u.nameAr }, [{ userId: u.id, email: oldEmail }], { dedupePrefix: `recover-old:${hash.slice(0, 16)}`, channels: ['email'] });
    await dispatch('auth.email_changed_new', { name: u.nameAr, link: `${config.appUrl}/#verify-email/${token}` }, [{ userId: u.id, email }],
      { dedupePrefix: `recover-new:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
  });
  kickNotificationWorker();
  return { user: toPublicUser((await getUserById(u.id))!) };
}
