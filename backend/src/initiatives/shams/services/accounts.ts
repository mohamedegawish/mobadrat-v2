/**
 * إدارة الجهات والحسابات — الخدمة الوحيدة لحسابات الجهات، تستخدمها شاشات الأدمن وAPI الربط (manage_users) وأمر CLI.
 *
 * H2 (القرار 1): حساب في جهة قرار (IMC/ENCPC/PMU/بنك) لا يُنشأ ولا يتغير بريده إلا بطلب معلق يوافق عليه مستخدم نشط
 * من الجهة نفسها (وللبنوك أيضًا PMU)، ومقدم الطلب لا يوافق على طلبه. لا كلمة مؤقتة لأحد: بعد الموافقة يصل رابط تعيين
 * كلمة المرور لبريد صاحب الحساب فقط (لمرة واحدة وبمدة). أول مستخدم في أي جهة بأمر CLI على السيرفر فقط.
 */
import { randomBytes } from 'node:crypto';
import { getDb, nowIso, tx } from '../db/sqlite.js';
import { AppError, Errors } from '../http/errors.js';
import { newId, mapSeq, filterSeq } from '../http/helpers.js';
import { Checker, isEmail, isPhone, normalizeDigits, onlyKeys, type Obj } from '../http/validate.js';
import { sha256 } from '../auth/jwt.js';
import { config } from '../config.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { ROLE_ORG_TYPE, ROLE_LABELS, STAFF_ROLES, ORG_IDS, isRetiredRole, type Role, type OrgType } from '../domain.js';
import { activeStaffCount, createOrganization, getOrganization, isStructuralOrg, updateOrganization, type Organization } from '../store/organizations.js';
import {
  activeUsersOf, changeEmail, clearPassword, createUser, getUserByEmail, getUserById, setResetToken, setVerifyToken, updateUserProfile, toPublicUser,
  type UserInternal,
} from '../store/users.js';
import { openBankLoad, openRegistryHoldsOfFactoryOrg } from '../store/applications.js';
import { dispatch, orgRecipients, type Recipient } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { revokeAllSessions } from '../store/refreshTokens.js';
import { addAuditLog, type AuditActor } from '../store/audit.js';

export interface AccountsPolicy { allowAdminAccounts: boolean }

const CREATABLE_ORG_TYPES: OrgType[] = ['bank'];
/** جهات القرار — حساباتها بموافقة الجهة (H2). حسابات الأدمن لا تملك أي قرار على الطلبات. */
export const DECISION_ROLES: Role[] = ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer'];

export async function createOrg(actor: AuditActor, body: unknown) {
  const b: Obj = onlyKeys(body, ['type', 'nameAr', 'nameEn', 'contactEmail']);
  const c = new Checker();
  const nameAr = c.text(b, 'nameAr', { required: true, min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { required: true, min: 2, max: 200 });
  const contactEmail = c.text(b, 'contactEmail', { max: 254 });
  if (contactEmail && !isEmail(contactEmail)) c.add('contactEmail', 'invalid email');
  // الجهات الهيكلية ثابتة، والمصانع تسجل بنفسها — الإضافة هنا للبنوك فقط.
  if (!CREATABLE_ORG_TYPES.includes(b.type as OrgType)) c.add('type', 'only "bank" organizations can be created');
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
  // تفعيل جهة موقوفة يعيد صلاحيات مستخدميها — من شاشة الأدمن فقط، لا عبر الربط.
  if (b.isActive === true && !opts.allowAdminAccounts && !org.isActive) c.add('isActive', 'reactivation is not allowed via integration');
  c.throwIfAny();
  const load = b.isActive === false && org.type === 'bank' && org.isActive ? await requireBankLoadConfirmation(org.id, b.confirmOpenReferrals) : null;
  // H3: إيقاف جهة مصنع لا يحرر رقم السجل الذي يحجزه طلبه — يُنبَّه PMU فقط (لا قرار تلقائي).
  const holds = b.isActive === false && org.type === 'factory' && org.isActive ? await openRegistryHoldsOfFactoryOrg(org.id) : [];
  const after = await tx(async () => {
    const updated = (await updateOrganization(id, { nameAr, nameEn, contactEmail, isActive: b.isActive as boolean | undefined }))!;
    if (b.isActive === false) for (const u of await activeUsersOf(id)) await revokeAllSessions(u.id);
    await addAuditLog({ ...actor, action: 'organization.update', entityType: 'organization', entityId: id, summaryAr: `تعديل جهة: ${updated.nameAr}`, details: { before: org, after: updated, openLoad: load } });
    if (load) await alertBankUnavailable(org.id, org.nameAr, load);
    for (const a of holds) {
      await dispatch('ops.registry_held_by_inactive', { appId: a.id, number: a.number, companyName: a.companyName, registryNumber: a.industrialRegistryNumber ?? '' },
        await pmuRecipients(), { dedupePrefix: `held-inactive:${a.id}:${nowIso()}`, applicationId: a.id, channels: ['email'] });
    }
    return updated;
  });
  if (load || holds.length) kickNotificationWorker();
  return after;
}

// ── طلبات الحسابات (H2) ─────────────────────────────────────────────────────

export type AccountRequestKind = 'create_user' | 'change_email';
export type AccountRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccountRequestRow {
  id: string; kind: AccountRequestKind; organizationId: string; role: Role; targetUserId: string | null; email: string;
  nameAr: string; nameEn: string; phone: string; reason: string; status: AccountRequestStatus;
  requestedByType: 'user' | 'integration_key'; requestedByUserId: string | null; requestedByKeyId: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string; resultUserId: string | null; createdAt: string; updatedAt: string;
}

export async function getAccountRequest(id: string): Promise<AccountRequestRow | null> {
  return (await getDb().prepare('SELECT * FROM shams_account_requests WHERE id = ?').get(id) as unknown as AccountRequestRow | undefined) ?? null;
}

async function pendingRequestForEmail(email: string): Promise<AccountRequestRow | null> {
  return (await getDb().prepare("SELECT * FROM shams_account_requests WHERE email = ? COLLATE NOCASE AND status = 'pending'").get(email) as unknown as AccountRequestRow | undefined) ?? null;
}

export async function pmuRecipients(): Promise<Recipient[]> {
  return await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer');
}

/** من يوافق على طلبات جهة: المستخدمون النشطون بدور الجهة، وللبنوك أيضًا PMU (shamsPolicy.accountApproval). */
async function approverRecipients(org: Organization, role: Role): Promise<Recipient[]> {
  const out = await orgRecipients(org.id, role);
  if (org.type === 'bank' && shamsPolicy.accountApproval.approverRolesForBank.includes('pmu_reviewer')) out.push(...await pmuRecipients());
  return out;
}

/** هل يملك المستخدم الموافقة على هذا الطلب؟ نفس الدالة تحدد القائمة وترفض التنفيذ في السيرفر. */
export async function canApproveAccountRequest(user: UserInternal, r: AccountRequestRow): Promise<boolean> {
  if (!user.isActive || !user.organizationActive || r.status !== 'pending') return false;
  if (r.requestedByUserId && r.requestedByUserId === user.id) return false; // مقدم الطلب لا يوافق على طلبه
  if (r.targetUserId && r.targetUserId === user.id) return false; // ولا صاحب الحساب على تغيير حسابه
  const org = await getOrganization(r.organizationId);
  if (!org) return false;
  if (user.organizationId === org.id && user.role === ROLE_ORG_TYPE_ROLE[org.type]) return true;
  return org.type === 'bank' && user.role === 'pmu_reviewer' && user.organizationId === ORG_IDS.pmu
    && shamsPolicy.accountApproval.approverRolesForBank.includes('pmu_reviewer');
}

// G-02: لا أدوار للبنوك — لا يوجد من «يوافق من داخل البنك».
const ROLE_ORG_TYPE_ROLE: Partial<Record<OrgType, Role>> = { imc: 'imc_reviewer', encpc: 'encpc_reviewer', pmu: 'pmu_reviewer' };

function requesterOf(actor: AuditActor): Pick<AccountRequestRow, 'requestedByType' | 'requestedByUserId' | 'requestedByKeyId'> {
  return actor.actorType === 'integration_key'
    ? { requestedByType: 'integration_key', requestedByUserId: null, requestedByKeyId: actor.integrationKeyId ?? null }
    : { requestedByType: 'user', requestedByUserId: actor.actorUserId ?? null, requestedByKeyId: null };
}

async function insertRequest(r: Omit<AccountRequestRow, 'id' | 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'resultUserId' | 'createdAt' | 'updatedAt'>): Promise<AccountRequestRow> {
  const id = newId('acr');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO shams_account_requests (id, kind, organizationId, role, targetUserId, email, nameAr, nameEn, phone, reason, status,
      requestedByType, requestedByUserId, requestedByKeyId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`).run(
    id, r.kind, r.organizationId, r.role, r.targetUserId, r.email, r.nameAr, r.nameEn, r.phone, r.reason, r.requestedByType, r.requestedByUserId, r.requestedByKeyId, now, now,
  );
  return (await getAccountRequest(id))!;
}

export async function publicAccountRequest(r: AccountRequestRow) {
  const org = await getOrganization(r.organizationId);
  const target = r.targetUserId ? await getUserById(r.targetUserId) : null;
  return {
    id: r.id, kind: r.kind, status: r.status, email: r.email, nameAr: r.nameAr, nameEn: r.nameEn, phone: r.phone, role: r.role,
    roleLabelAr: ROLE_LABELS[r.role].ar, roleLabelEn: ROLE_LABELS[r.role].en, reason: r.reason,
    organizationId: r.organizationId, organizationNameAr: org?.nameAr ?? '', organizationNameEn: org?.nameEn ?? '',
    targetUserId: r.targetUserId, targetCurrentEmail: target?.email ?? null,
    requestedByType: r.requestedByType, requestedByName: r.requestedByUserId ? (await getUserById(r.requestedByUserId))?.nameAr ?? '' : (r.requestedByKeyId ? 'API' : ''),
    decidedAt: r.decidedAt, decisionNote: r.decisionNote, resultUserId: r.resultUserId, createdAt: r.createdAt,
  };
}

function setupLinkHours(): number { return shamsPolicy.accountSetupLinkHours; }

/** رابط تعيين كلمة المرور لبريد الحساب الحالي فقط (لمرة واحدة، accountSetupLinkHours). يرجع الرابط لأمر CLI فقط. */
async function sendSetupLink(u: UserInternal, purpose: 'created' | 'reset'): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const hash = sha256(token);
  await setResetToken(u.id, hash, new Date(Date.now() + setupLinkHours() * 3600_000).toISOString());
  const link = `${config.appUrl}/#reset-password/${token}`;
  await dispatch('auth.account_setup', { name: u.nameAr, link, purpose, hours: setupLinkHours() }, [{ userId: u.id, email: u.email }],
    { dedupePrefix: `setup:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
  return link;
}

/** إبلاغ صاحب الحساب ومستخدمي جهته النشطين وPMU بأي إنشاء أو إعادة تعيين أو تغيير بريد. */
async function notifyAccountEvent(u: Pick<UserInternal, 'id' | 'email' | 'nameAr' | 'organizationId' | 'phone'>, eventAr: string, eventEn: string, dedupe: string): Promise<void> {
  const org = await getOrganization(u.organizationId);
  await dispatch('ops.account_event', { email: u.email, name: u.nameAr, orgNameAr: org?.nameAr ?? '', eventAr, eventEn },
    [{ userId: u.id, email: u.email }, ...await orgRecipients(u.organizationId), ...await pmuRecipients()], { dedupePrefix: dedupe, channels: ['email'] });
}

async function cleanNewAccount(body: unknown, opts: AccountsPolicy) {
  const b: Obj = onlyKeys(body, ['email', 'nameAr', 'nameEn', 'phone', 'role', 'organizationId', 'reason']);
  const c = new Checker();
  const email = c.text(b, 'email', { required: true, max: 254 });
  const nameAr = c.text(b, 'nameAr', { required: true, min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { max: 200 });
  const phoneRaw = c.text(b, 'phone', { max: 20 });
  const reason = c.text(b, 'reason', { max: 1000 });
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
  return { email: email!.toLowerCase(), nameAr: nameAr!, nameEn: nameEn ?? '', phone: phone ?? '', role, org: org!, reason: reason ?? '' };
}

function emailTaken(): AppError {
  return new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم بالفعل.', 'This email is already in use.');
}

function firstUserViaCli(org: Organization): AppError {
  return new AppError(409, 'FIRST_USER_REQUIRES_CLI',
    `لا يوجد مستخدم نشط في «${org.nameAr}» يوافق على الحساب. أول مستخدم في أي جهة يُنشأ بأمر على السيرفر فقط (npm run users:create-first).`,
    'The organization has no active user to approve the account. The first user of an organization is created with the server CLI only.');
}

/**
 * طلب حساب جديد. جهات القرار → طلب معلق (لا حساب، لا دخول، لا سر في الرد). حساب أدمن (شاشة الأدمن فقط) → يُنشأ مباشرة
 * برابط تعيين على بريده، ويُبلَّغ الأدمن الآخرون (الأدمن لا يملك أي قرار على الطلبات).
 */
export async function requestStaffAccount(actor: AuditActor, body: unknown, opts: AccountsPolicy) {
  const n = await cleanNewAccount(body, opts);
  if (await getUserByEmail(n.email) || await pendingRequestForEmail(n.email)) throw emailTaken();
  if (n.role === 'system_admin') {
    const user = await tx(async () => {
      const u = await createUser({ organizationId: n.org.id, role: n.role, email: n.email, nameAr: n.nameAr, nameEn: n.nameEn, phone: n.phone, passwordHash: '', emailVerified: false, createdBy: actor.actorUserId ?? null });
      await sendSetupLink(u, 'created');
      await addAuditLog({ ...actor, action: 'user.create', entityType: 'user', entityId: u.id, summaryAr: `إنشاء حساب مدير نظام: ${u.email}`, details: { role: n.role, organizationId: n.org.id } });
      await notifyAccountEvent(u, 'إنشاء حساب مدير نظام', 'system administrator account created', `acct-created:${u.id}`);
      return u;
    });
    kickNotificationWorker();
    return { user: toPublicUser(user), request: null };
  }
  if (!n.org.isActive) throw Errors.conflict('ORG_INACTIVE', 'الجهة موقوفة.', 'The organization is inactive.');
  if (shamsPolicy.accountApproval.firstUserViaCliOnly && (await activeUsersOf(n.org.id, n.role)).length === 0) throw firstUserViaCli(n.org);
  const request = await tx(async () => {
    const r = await insertRequest({ kind: 'create_user', organizationId: n.org.id, role: n.role, targetUserId: null, email: n.email, nameAr: n.nameAr, nameEn: n.nameEn, phone: n.phone, reason: n.reason, ...requesterOf(actor) });
    await addAuditLog({ ...actor, action: 'account_request.create', entityType: 'account_request', entityId: r.id,
      summaryAr: `طلب إنشاء حساب ${n.role} في ${n.org.nameAr}: ${n.email} (بانتظار موافقة الجهة)`, details: { role: n.role, organizationId: n.org.id, email: n.email } });
    await dispatch('ops.account_request', { email: n.email, name: n.nameAr, roleAr: ROLE_LABELS[n.role].ar, orgNameAr: n.org.nameAr, eventAr: 'طلب إنشاء حساب جديد' },
      await approverRecipients(n.org, n.role), { dedupePrefix: `acr:${r.id}`, channels: ['email'] });
    return r;
  });
  kickNotificationWorker();
  return { user: null, request: await publicAccountRequest(request) };
}

/** طلب تغيير بريد حساب جهة قرار — نفس موافقة الجهة (لا مسار آخر يغيّر البريد أو الدور أو الجهة). */
export async function requestEmailChange(actor: AuditActor, userId: string, body: unknown) {
  const u = await getUserById(userId);
  if (!u) throw Errors.notFound();
  if (!DECISION_ROLES.includes(u.role)) {
    throw Errors.forbidden(u.role === 'factory_owner' ? 'بريد حساب المصنع يتغير بطلب الاسترداد فقط.' : 'تغيير بريد هذا الحساب غير متاح.',
      u.role === 'factory_owner' ? 'Factory account emails change only through account recovery.' : 'Changing the email of this account is not available.');
  }
  const b: Obj = onlyKeys(body, ['newEmail', 'reason']);
  const c = new Checker();
  const newEmail = c.text(b, 'newEmail', { required: true, max: 254 });
  const reason = c.text(b, 'reason', { required: true, min: 10, max: 1000 });
  if (newEmail && !isEmail(newEmail)) c.add('newEmail', 'invalid email');
  c.throwIfAny();
  const email = newEmail!.toLowerCase();
  if (email === u.email.toLowerCase()) throw Errors.validation([{ field: 'newEmail', issue: 'same as current email' }]);
  if (await getUserByEmail(email) || await pendingRequestForEmail(email)) throw emailTaken();
  const org = (await getOrganization(u.organizationId))!;
  const request = await tx(async () => {
    const r = await insertRequest({ kind: 'change_email', organizationId: u.organizationId, role: u.role, targetUserId: u.id, email, nameAr: u.nameAr, nameEn: u.nameEn, phone: u.phone, reason: reason!, ...requesterOf(actor) });
    await addAuditLog({ ...actor, action: 'account_request.create', entityType: 'account_request', entityId: r.id,
      summaryAr: `طلب تغيير بريد حساب ${u.email} (بانتظار موافقة الجهة)`, details: { userId: u.id, oldEmail: u.email, newEmail: email, reason } });
    await dispatch('ops.account_request', { email, name: u.nameAr, roleAr: ROLE_LABELS[u.role].ar, orgNameAr: org.nameAr, eventAr: `طلب تغيير بريد الحساب ${u.email}` },
      await approverRecipients(org, u.role), { dedupePrefix: `acr:${r.id}`, channels: ['email'] });
    return r;
  });
  kickNotificationWorker();
  return await publicAccountRequest(request);
}

/** قائمة الطلبات: الأدمن يرى كل الطلبات الأخيرة؛ مستخدمو الجهات يرون المعلق الذي يملكون الموافقة عليه. */
export async function listAccountRequests(user: UserInternal) {
  const rows = await getDb().prepare(user.role === 'system_admin'
    ? 'SELECT * FROM shams_account_requests ORDER BY createdAt DESC LIMIT 200'
    : "SELECT * FROM shams_account_requests WHERE status = 'pending' ORDER BY createdAt LIMIT 200").all() as unknown as AccountRequestRow[];
  const visible = user.role === 'system_admin' ? rows : await filterSeq(rows, (r) => canApproveAccountRequest(user, r));
  return mapSeq(visible, (r) => publicAccountRequest(r));
}

export async function decideAccountRequest(user: UserInternal, id: string, approve: boolean, body: unknown, ip: string) {
  const r = await getAccountRequest(id);
  if (!r) throw Errors.notFound();
  if (r.status !== 'pending') throw Errors.conflict('ALREADY_DECIDED', 'تم البت في هذا الطلب بالفعل.', 'This request was already decided.');
  if (!await canApproveAccountRequest(user, r)) {
    throw Errors.forbidden('لا تملك الموافقة على هذا الطلب (مستخدم نشط من الجهة نفسها، أو PMU للبنوك، وليس مقدم الطلب).', 'You cannot decide this request.');
  }
  const b: Obj = onlyKeys(body ?? {}, ['note']);
  const c = new Checker();
  const note = c.text(b, 'note', { required: !approve, min: approve ? undefined : 3, max: 1000 });
  c.throwIfAny();
  const actor: AuditActor = { actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip };
  const org = (await getOrganization(r.organizationId))!;
  const result = await tx(async () => {
    const cur = (await getAccountRequest(id))!;
    if (cur.status !== 'pending') throw Errors.conflict('ALREADY_DECIDED', 'تم البت في هذا الطلب بالفعل.', 'This request was already decided.');
    let resultUserId: string | null = null;
    if (approve && r.kind === 'create_user') {
      if (await getUserByEmail(r.email)) throw emailTaken();
      const u = await createUser({ organizationId: r.organizationId, role: r.role, email: r.email, nameAr: r.nameAr, nameEn: r.nameEn, phone: r.phone, passwordHash: '', emailVerified: false, createdBy: r.requestedByUserId });
      resultUserId = u.id;
      await sendSetupLink(u, 'created');
      await addAuditLog({ ...actor, action: 'user.create', entityType: 'user', entityId: u.id, summaryAr: `إنشاء حساب ${r.role} بعد الموافقة: ${u.email}`, details: { requestId: r.id, role: r.role, organizationId: r.organizationId } });
      await notifyAccountEvent(u, 'إنشاء حساب جديد بعد موافقة الجهة', 'new account created after approval', `acct-created:${u.id}`);
    }
    if (approve && r.kind === 'change_email') {
      const u = await getUserById(r.targetUserId!);
      if (!u) throw Errors.notFound();
      if (await getUserByEmail(r.email)) throw emailTaken();
      const oldEmail = u.email;
      const token = randomBytes(32).toString('hex');
      const hash = sha256(token);
      await changeEmail(u.id, r.email);
      await setVerifyToken(u.id, hash, new Date(Date.now() + 24 * 3600_000).toISOString());
      await revokeAllSessions(u.id);
      resultUserId = u.id;
      await addAuditLog({ ...actor, action: 'user.change_email', entityType: 'user', entityId: u.id, summaryAr: `تغيير بريد حساب بعد الموافقة: ${oldEmail} ← ${r.email}`, details: { requestId: r.id, oldEmail, newEmail: r.email } });
      await dispatch('auth.email_changed_old', { name: u.nameAr }, [{ userId: u.id, email: oldEmail }], { dedupePrefix: `chg-old:${hash.slice(0, 16)}`, channels: ['email'] });
      await dispatch('auth.email_changed_new', { name: u.nameAr, link: `${config.appUrl}/#verify-email/${token}` }, [{ userId: u.id, email: r.email }],
        { dedupePrefix: `chg-new:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
      await notifyAccountEvent({ ...u, email: r.email }, `تغيير بريد الحساب من ${oldEmail}`, 'account email changed', `acct-email:${r.id}`);
    }
    await getDb().prepare('UPDATE shams_account_requests SET status = ?, decidedBy = ?, decidedAt = ?, decisionNote = ?, resultUserId = ?, updatedAt = ? WHERE id = ?')
      .run(approve ? 'approved' : 'rejected', user.id, nowIso(), note ?? '', resultUserId, nowIso(), id);
    await addAuditLog({ ...actor, action: approve ? 'account_request.approve' : 'account_request.reject', entityType: 'account_request', entityId: id,
      summaryAr: `${approve ? 'موافقة على' : 'رفض'} طلب ${r.kind === 'create_user' ? 'حساب' : 'تغيير بريد'} في ${org.nameAr}: ${r.email}`, details: { note: note ?? '' } });
    if (!approve && r.requestedByUserId) {
      const requester = await getUserById(r.requestedByUserId);
      if (requester) await dispatch('ops.account_event', { email: r.email, name: r.nameAr, orgNameAr: org.nameAr, eventAr: 'رُفض طلب الحساب من الجهة', eventEn: 'account request rejected' },
        [{ userId: requester.id, email: requester.email }], { dedupePrefix: `acr-rej:${id}`, channels: ['email'] });
    }
    return (await getAccountRequest(id))!;
  });
  kickNotificationWorker();
  return await publicAccountRequest(result);
}

export async function updateStaffUser(actor: AuditActor, id: string, body: unknown, opts: AccountsPolicy) {
  const u = await getUserById(id);
  if (!u) throw Errors.notFound();
  if (u.role === 'factory_owner') throw Errors.forbidden('حسابات المصانع تُدار من أصحابها.', 'Factory accounts are managed by their owners.');
  if (!opts.allowAdminAccounts && (u.role === 'system_admin' || u.organizationId === ORG_IDS.admin)) {
    throw Errors.forbidden('لا يمكن تعديل حسابات إدارة النظام عبر الربط.', 'System administrator accounts cannot be modified via integration.');
  }
  // H2: لا تغيير بريد ولا دور ولا جهة ولا كلمة مرور من هنا (onlyKeys يرفض أي حقل آخر بـ 400).
  const b: Obj = onlyKeys(body, ['nameAr', 'nameEn', 'phone', 'isActive', 'confirmOpenReferrals']);
  const c = new Checker();
  const nameAr = c.text(b, 'nameAr', { min: 2, max: 200 });
  const nameEn = c.text(b, 'nameEn', { max: 200 });
  const phoneRaw = c.text(b, 'phone', { max: 20 });
  const phone = phoneRaw === undefined ? undefined : normalizeDigits(phoneRaw);
  if (phone && !isPhone(phone)) c.add('phone', 'invalid phone number');
  if (b.isActive !== undefined && typeof b.isActive !== 'boolean') c.add('isActive', 'must be boolean');
  if (b.isActive === false && actor.actorUserId === id) c.add('isActive', 'you cannot deactivate your own account');
  // API الربط يوقف فقط؛ إعادة تفعيل حساب جهة قرار من شاشة الأدمن.
  if (b.isActive === true && !opts.allowAdminAccounts && !u.isActive) c.add('isActive', 'reactivation is not allowed via integration');
  // G-02: حسابات البنوك ملغاة — لا تُعاد.
  if (b.isActive === true && isRetiredRole(u.role)) c.add('isActive', 'this role is retired (banks have no platform accounts)');
  c.throwIfAny();
  const load = null;
  const after = await tx(async () => {
    const updated = (await updateUserProfile(id, { nameAr, nameEn, phone, isActive: b.isActive as boolean | undefined }))!;
    if (b.isActive === false) await revokeAllSessions(id);
    await addAuditLog({ ...actor, action: 'user.update', entityType: 'user', entityId: id, summaryAr: `تعديل حساب: ${u.email}`,
      details: { isActive: b.isActive, nameChanged: Boolean(nameAr || nameEn), phoneChanged: phone !== undefined, openLoad: load } });
    if (b.isActive === true && !u.isActive && DECISION_ROLES.includes(u.role)) await notifyAccountEvent(u, 'إعادة تفعيل حساب', 'account re-enabled', `acct-on:${u.id}:${nowIso()}`);
    return updated;
  });
  kickNotificationWorker();
  return { user: toPublicUser((await getUserById(after.id))!) };
}

/**
 * إعادة تعيين إدارية (شاشة الأدمن فقط): تُبطل كلمة المرور الحالية وكل الجلسات، ويصل رابط التعيين لبريد الحساب الحالي فقط،
 * ويُبلَّغ صاحب الحساب وجهته وPMU. لا كلمة مؤقتة لأحد.
 */
export async function adminResetPassword(actor: AuditActor, id: string) {
  const u = await getUserById(id);
  if (!u) throw Errors.notFound();
  if (u.role === 'factory_owner') throw Errors.forbidden('صاحب حساب المصنع يستعيد كلمة المرور بنفسه من «نسيت كلمة المرور».', 'Factory owners reset their own password.');
  await tx(async () => {
    await clearPassword(u.id);
    await revokeAllSessions(u.id);
    await sendSetupLink(u, 'reset');
    await addAuditLog({ ...actor, action: 'user.password_reset_by_admin', entityType: 'user', entityId: u.id, summaryAr: `إعادة تعيين كلمة مرور ${u.email} (رابط على بريد الحساب)`, details: { sessionsRevoked: true } });
    await notifyAccountEvent(u, 'إعادة تعيين كلمة المرور من إدارة النظام', 'password reset by the administration', `acct-reset:${u.id}:${nowIso()}`);
  });
  kickNotificationWorker();
  return { user: toPublicUser((await getUserById(u.id))!) };
}

/**
 * أول مستخدم في جهة (أمر CLI على السيرفر فقط). يُرفض إن كان في الجهة مستخدم نشط بنفس الدور.
 * لا كلمة مرور: رابط التعيين يصل لبريد المستخدم (يرجع الرابط لأمر CLI ليطبعه فقط عند --print-link).
 */
export async function createFirstOrgUser(input: { organizationId: string; role: Role; email: string; nameAr: string; nameEn?: string; phone?: string }) {
  const org = await getOrganization(input.organizationId);
  if (!org) throw Errors.validation([{ field: 'organizationId', issue: 'unknown organization' }]);
  if (!STAFF_ROLES.includes(input.role) || org.type !== ROLE_ORG_TYPE[input.role]) throw Errors.validation([{ field: 'role', issue: `role must match organization type ${org.type}` }]);
  if (!org.isActive) throw Errors.conflict('ORG_INACTIVE', 'الجهة موقوفة.', 'The organization is inactive.');
  if ((await activeUsersOf(org.id, input.role)).length > 0) {
    throw Errors.conflict('ORG_HAS_ACTIVE_USER', 'للجهة مستخدم نشط بالفعل — الحسابات التالية بطلب يوافق عليه مستخدم من الجهة.', 'The organization already has an active user; further accounts need approval.');
  }
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) throw Errors.validation([{ field: 'email', issue: 'invalid email' }]);
  if (await getUserByEmail(email) || await pendingRequestForEmail(email)) throw emailTaken();
  const actor: AuditActor = { actorType: 'system', actorName: 'cli' };
  const out = await tx(async () => {
    const u = await createUser({ organizationId: org.id, role: input.role, email, nameAr: input.nameAr, nameEn: input.nameEn, phone: input.phone, passwordHash: '', emailVerified: false });
    const link = await sendSetupLink(u, 'created');
    await addAuditLog({ ...actor, action: 'user.create_first', entityType: 'user', entityId: u.id, summaryAr: `إنشاء أول مستخدم في ${org.nameAr} من سطر الأوامر: ${email}`, details: { role: input.role, organizationId: org.id } });
    await notifyAccountEvent(u, 'إنشاء أول مستخدم في الجهة من سطر الأوامر', 'first organization user created from the server CLI', `acct-first:${u.id}`);
    return { user: u, link };
  });
  return { user: toPublicUser(out.user), link: out.link };
}

/**
 * I4: إيقاف بنك (أو آخر مستخدميه) له طلبات مفتوحة يحتاج تأكيدًا صريحًا يعرض عددها.
 * بلا confirmOpenReferrals=true → 409 OPEN_REFERRALS ولا يُنفذ شيء.
 */
async function requireBankLoadConfirmation(bankOrgId: string, confirm: unknown): Promise<{ referrals: number; pendingSelections: number } | null> {
  const load = await openBankLoad(bankOrgId);
  const total = load.referrals + load.pendingSelections;
  if (!total) return null;
  if (confirm !== true) {
    throw new AppError(409, 'OPEN_REFERRALS',
      `اختار هذا البنكَ ${load.referrals} طلب لم يسجل نتيجة التعاقد بعد. الإيقاف لا يمنعها من تسجيل النتيجة لكنه يخفي البنك عن الاختيارات الجديدة. أكّد الإيقاف صراحة للمتابعة.`,
      `${load.referrals} open application(s) chose this bank and have not recorded the contract outcome yet. Deactivation hides it from new choices only. Confirm explicitly to proceed.`,
      [{ field: 'confirmOpenReferrals', issue: `required: ${total} open application(s)` }]);
  }
  return load;
}

async function alertBankUnavailable(bankOrgId: string, bankNameAr: string, load: { referrals: number; pendingSelections: number }): Promise<void> {
  await dispatch('ops.bank_unavailable', { bankNameAr, count: load.referrals + load.pendingSelections }, await pmuRecipients(),
    { dedupePrefix: `bank-off:${bankOrgId}:${nowIso()}`, channels: ['email'] });
}
