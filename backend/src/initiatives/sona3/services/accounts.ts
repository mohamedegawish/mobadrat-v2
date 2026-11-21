/** إدارة الجهات والحسابات — مشتركة بين شاشات الأدمن وAPI الربط (manage_users). */
import { randomBytes } from 'node:crypto';
import { getDb, tx } from '../db/sqlite.js';
import { AppError, Errors } from '../http/errors.js';
import { Checker, isEmail, isPhone, normalizeDigits, onlyKeys, type Obj } from '../http/validate.js';
import { hashPassword, sha256 } from '../auth/jwt.js';
import { config } from '../config.js';
import { ROLE_ORG_TYPE, STAFF_ROLES, ORG_IDS, type Role, type OrgType } from '../domain.js';
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

export function createOrg(actor: AuditActor, body: unknown) {
  const b: Obj = onlyKeys(body, ['type', 'nameAr', 'nameEn', 'contactEmail']);
  const c = new Checker();
  const nameAr = c.text(b, 'nameAr', { required: true, min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { required: true, min: 2, max: 200 });
  const contactEmail = c.text(b, 'contactEmail', { max: 254 });
  if (contactEmail && !isEmail(contactEmail)) c.add('contactEmail', 'invalid email');
  // الجهات الهيكلية ثابتة، والمتقدمون يسجلون بأنفسهم — الإضافة هنا لجهات التمويل فقط.
  if (!CREATABLE_ORG_TYPES.includes(b.type as OrgType)) c.add('type', 'only "funder" organizations can be created');
  c.throwIfAny();
  const org = createOrganization({ type: b.type as OrgType, nameAr: nameAr!, nameEn: nameEn!, contactEmail });
  addAuditLog({ ...actor, action: 'organization.create', entityType: 'organization', entityId: org.id, summaryAr: `إضافة جهة: ${org.nameAr}` });
  return org;
}

export function updateOrg(actor: AuditActor, id: string, body: unknown, opts: AccountsPolicy) {
  const org = getOrganization(id);
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
  const load = b.isActive === false && org.type === 'funder' && org.isActive ? requireFunderLoadConfirmation(org.id, b.confirmOpenReferrals) : null;
  const after = tx(() => {
    const updated = updateOrganization(id, { nameAr, nameEn, contactEmail, isActive: b.isActive as boolean | undefined })!;
    addAuditLog({ ...actor, action: 'organization.update', entityType: 'organization', entityId: id, summaryAr: `تعديل جهة: ${updated.nameAr}`, details: { before: org, after: updated, openLoad: load } });
    return updated;
  });
  return after;
}

export function createStaffUser(actor: AuditActor, body: unknown, opts: AccountsPolicy) {
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
  const org = orgId ? getOrganization(orgId) : null;
  if (!org) c.add('organizationId', 'unknown organization');
  else if (allowedRoles.includes(role) && org.type !== ROLE_ORG_TYPE[role]) c.add('organizationId', `role ${role} requires an organization of type ${ROLE_ORG_TYPE[role]}`);
  c.throwIfAny();
  if (getUserByEmail(email!)) throw new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم بالفعل.', 'This email is already in use.');
  const password = tempPassword();
  const user = tx(() => {
    const u = createUser({
      organizationId: org!.id, role, email: email!.toLowerCase(), nameAr: nameAr!, nameEn, phone, passwordHash: hashPassword(password),
      mustChangePassword: true, emailVerified: true, createdBy: actor.actorUserId ?? null,
    });
    addAuditLog({ ...actor, action: 'user.create', entityType: 'user', entityId: u.id, summaryAr: `إنشاء حساب ${role}: ${u.email}`, details: { role, organizationId: org!.id } });
    return u;
  });
  return { user: toPublicUser(user), temporaryPassword: password };
}

export function updateStaffUser(actor: AuditActor, id: string, body: unknown, opts: AccountsPolicy) {
  const u = getUserById(id);
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
  const lastFunderUser = b.isActive === false && u.isActive && u.role === 'funder_reviewer' && activeStaffCount(u.organizationId) === 1;
  const load = lastFunderUser ? requireFunderLoadConfirmation(u.organizationId, b.confirmOpenReferrals) : null;
  let temporaryPassword: string | undefined;
  const after = tx(() => {
    const updated = updateUserProfile(id, { nameAr, nameEn, phone, isActive: b.isActive as boolean | undefined })!;
    if (b.isActive === false) revokeAllForUser(id);
    if (b.resetPassword === true) {
      temporaryPassword = tempPassword();
      setPassword(id, hashPassword(temporaryPassword), true);
      revokeAllForUser(id);
    }
    addAuditLog({ ...actor, action: 'user.update', entityType: 'user', entityId: id, summaryAr: `تعديل حساب: ${u.email}`,
      details: { isActive: b.isActive, resetPassword: b.resetPassword === true, nameChanged: Boolean(nameAr || nameEn), openLoad: load } });
    return updated;
  });
  return { user: toPublicUser(getUserById(after.id)!), ...(temporaryPassword ? { temporaryPassword } : {}) };
}

/** إحالات مفتوحة (قيد الدراسة) وملفات ممولة قيد التنفيذ/التشغيل لدى جهة التمويل. */
export function openFunderLoad(funderOrgId: string): { referrals: number; funded: number } {
  const db = getDb();
  const referrals = (db.prepare("SELECT COUNT(*) AS n FROM funding_referrals WHERE funderOrgId = ? AND status = 'pending'").get(funderOrgId) as { n: number }).n;
  const funded = (db.prepare("SELECT COUNT(*) AS n FROM applications WHERE funderOrgId = ? AND state IN ('IMPLEMENTATION','OPERATING')").get(funderOrgId) as { n: number }).n;
  return { referrals, funded };
}

/**
 * إيقاف جهة تمويل (أو آخر مستخدميها) لها ملفات مفتوحة يحتاج تأكيدًا صريحًا يعرض عددها.
 * بلا confirmOpenReferrals=true → 409 OPEN_REFERRALS ولا يُنفذ شيء.
 */
function requireFunderLoadConfirmation(funderOrgId: string, confirm: unknown): { referrals: number; funded: number } | null {
  const load = openFunderLoad(funderOrgId);
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
export function recoverApplicantEmail(actor: AuditActor, id: string, body: unknown) {
  const u = getUserById(id);
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
  if (getUserByEmail(email)) throw new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم بالفعل.', 'This email is already in use.');
  const oldEmail = u.email;
  const token = randomBytes(32).toString('hex');
  const hash = sha256(token);
  tx(() => {
    changeEmail(u.id, email);
    setVerifyToken(u.id, hash, new Date(Date.now() + VERIFY_TTL_MS).toISOString());
    revokeAllForUser(u.id);
    addAuditLog({ ...actor, action: 'user.recover_email', entityType: 'user', entityId: u.id,
      summaryAr: `استرداد حساب متقدم: تغيير البريد (مرجع ${requestReference})`,
      details: { oldEmail, newEmail: email, reason, requestReference, sessionsRevoked: true } });
    dispatch('auth.email_changed_old', { name: u.nameAr }, [{ userId: u.id, email: oldEmail }], { dedupePrefix: `recover-old:${hash.slice(0, 16)}`, channels: ['email'] });
    dispatch('auth.email_changed_new', { name: u.nameAr, link: `${config.appUrl}/#verify-email/${token}` }, [{ userId: u.id, email }],
      { dedupePrefix: `recover-new:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
  });
  kickNotificationWorker();
  return { user: toPublicUser(getUserById(u.id)!) };
}
