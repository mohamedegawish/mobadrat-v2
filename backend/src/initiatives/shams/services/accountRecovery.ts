/**
 * H4 (القرار 2): استرداد حساب مصنع بتغيير بريده — لم يعد إجراءً فوريًا بيد أدمن واحد:
 *   1) الأدمن يسجل طلبًا بمستند PDF رسمي وسبب ومرجع ← يُبلَّغ البريد الحالي وSMS الهاتف المسجل برابط إلغاء لمرة واحدة، وتُبلَّغ PMU.
 *   2) موافقة PMU (ليس مقدم الطلب) ← تبدأ مهلة accountRecoveryCoolingHours ويُبلَّغ المالك مجددًا برابط إلغاء جديد.
 *   3) خلال المهلة لا يتغير شيء؛ المالك (بالرابط) أو PMU يلغي الطلب.
 *   4) بعد المهلة ينفذه العامل: تغيير البريد، تفعيل البريد الجديد برابط، إنهاء كل الجلسات (refresh + access).
 * كل خطوة في التدقيق. لا يوجد أي مسار لهذا عبر API الربط.
 */
import { randomBytes } from 'node:crypto';
import { getDb, nowIso, tx, withJobLock } from '../db/database.js';
import { AppError, Errors } from '../http/errors.js';
import { newId, mapSeq } from '../http/helpers.js';
import { Checker, isEmail, onlyKeys, type Obj } from '../http/validate.js';
import { sha256 } from '../auth/jwt.js';
import { config } from '../config.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { acceptPdf, discardUpload } from '../http/upload.js';
import { changeEmail, getUserByEmail, getUserById, setVerifyToken, type UserInternal } from '../store/users.js';
import { revokeAllSessions } from '../store/refreshTokens.js';
import { addAuditLog, type AuditActor } from '../store/audit.js';
import { getFactoryByOrg } from '../store/factories.js';
import { dispatch, type Recipient } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { trackJob } from '../jobs/inflight.js';
import { pmuRecipients } from './accounts.js';
import { ORG_IDS } from '../domain.js';

export type RecoveryStatus = 'pending_approval' | 'cooling' | 'executed' | 'cancelled' | 'rejected';

export interface RecoveryRow {
  id: string; userId: string; oldEmail: string; newEmail: string; reason: string; requestReference: string;
  documentOriginalName: string; documentStoredName: string; documentSizeBytes: number; documentSha256: string;
  status: RecoveryStatus; requestedBy: string; requestedAt: string; approvedBy: string | null; approvedAt: string | null;
  coolingEndsAt: string | null; cancelTokenHash: string | null; closedBy: string | null; closedAt: string | null; closeReason: string; executedAt: string | null;
}

const OPEN: RecoveryStatus[] = ['pending_approval', 'cooling'];

export async function getRecovery(id: string): Promise<RecoveryRow | null> {
  return (await getDb().prepare('SELECT * FROM shams_account_recovery_requests WHERE id = ?').get(id) as unknown as RecoveryRow | undefined) ?? null;
}

async function openRecoveryFor(userId: string): Promise<RecoveryRow | null> {
  return (await getDb().prepare("SELECT * FROM shams_account_recovery_requests WHERE userId = ? AND status IN ('pending_approval','cooling')").get(userId) as unknown as RecoveryRow | undefined) ?? null;
}

/** طلب استرداد مفتوح على الحساب (يُعرض للأدمن وPMU، ويمنع طلبًا ثانيًا). */
export async function hasOpenRecovery(userId: string): Promise<boolean> {
  return await openRecoveryFor(userId) !== null;
}

export async function publicRecovery(r: RecoveryRow) {
  const u = await getUserById(r.userId);
  const factory = u ? await getFactoryByOrg(u.organizationId) : null;
  return {
    id: r.id, userId: r.userId, companyName: factory?.companyName ?? u?.organizationNameAr ?? '', currentEmail: u?.email ?? r.oldEmail,
    oldEmail: r.oldEmail, newEmail: r.newEmail, reason: r.reason, requestReference: r.requestReference,
    document: { originalName: r.documentOriginalName, sizeBytes: r.documentSizeBytes, sha256: r.documentSha256 },
    status: r.status, requestedBy: r.requestedBy, requestedByName: (await getUserById(r.requestedBy))?.nameAr ?? '', requestedAt: r.requestedAt,
    approvedBy: r.approvedBy, approvedAt: r.approvedAt, coolingEndsAt: r.coolingEndsAt, closedAt: r.closedAt, closeReason: r.closeReason, executedAt: r.executedAt,
  };
}

function ownerRecipients(u: UserInternal): Recipient[] {
  return [{ userId: u.id, email: u.email, phone: u.phone || undefined }];
}

function newCancelToken(): { token: string; hash: string; link: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256(token), link: `${config.appUrl}/#i/shams/cancel-recovery/${token}` };
}

function canDecide(user: UserInternal, r: RecoveryRow): boolean {
  return shamsPolicy.accountRecoveryApproverRoles.includes(user.role) && user.organizationId === ORG_IDS.pmu && user.isActive && r.requestedBy !== user.id;
}

async function companyOf(u: UserInternal): Promise<string> {
  return (await getFactoryByOrg(u.organizationId))?.companyName ?? u.organizationNameAr;
}

/** 1) الأدمن يسجل الطلب (multipart: file + newEmail + reason + requestReference). لا يتغير البريد. */
export async function requestRecovery(actor: AuditActor & { actorUserId: string }, userId: string, body: unknown, file: Express.Multer.File | undefined) {
  const fail = (e: AppError): never => { discardUpload(file); throw e; };
  const u = await getUserById(userId);
  if (!u) fail(Errors.notFound());
  if (u!.role !== 'factory_owner') fail(Errors.forbidden('الاسترداد بتغيير البريد لحسابات المصانع فقط.', 'Email recovery applies to factory accounts only.'));
  let b: Obj;
  try { b = onlyKeys(body ?? {}, ['newEmail', 'reason', 'requestReference']); } catch (e) { discardUpload(file); throw e; }
  const c = new Checker();
  const newEmail = c.text(b, 'newEmail', { required: true, max: 254 });
  const reason = c.text(b, 'reason', { required: true, min: 10, max: 1000 });
  const requestReference = c.text(b, 'requestReference', { required: true, min: 3, max: 120 });
  if (newEmail && !isEmail(newEmail)) c.add('newEmail', 'invalid email');
  if (c.details.length) fail(Errors.validation(c.details));
  const email = newEmail!.toLowerCase();
  if (email === u!.email.toLowerCase()) fail(Errors.validation([{ field: 'newEmail', issue: 'same as current email' }]));
  if (await getUserByEmail(email)) fail(new AppError(409, 'EMAIL_TAKEN', 'البريد الإلكتروني مستخدم بالفعل.', 'This email is already in use.'));
  if (await openRecoveryFor(u!.id)) fail(Errors.conflict('RECOVERY_PENDING', 'يوجد طلب استرداد مفتوح على هذا الحساب.', 'An account recovery request is already open for this account.'));
  // المستند الرسمي إجباري (PDF، نفس فحوص مستندات الطلبات).
  const stored = acceptPdf(file);
  const cancel = newCancelToken();
  const id = newId('rec');
  const now = nowIso();
  await tx(async () => {
    await getDb().prepare(`INSERT INTO shams_account_recovery_requests (id, userId, oldEmail, newEmail, reason, requestReference, documentOriginalName, documentStoredName,
        documentSizeBytes, documentSha256, status, requestedBy, requestedAt, cancelTokenHash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)`).run(
      id, u!.id, u!.email, email, reason!, requestReference!, stored.originalName, stored.storedName, stored.sizeBytes, stored.sha256, actor.actorUserId, now, cancel.hash,
    );
    await addAuditLog({ ...actor, action: 'account_recovery.request', entityType: 'account_recovery', entityId: id,
      summaryAr: `طلب استرداد حساب مصنع بتغيير البريد (مرجع ${requestReference}) — بانتظار موافقة PMU`,
      details: { userId: u!.id, oldEmail: u!.email, newEmail: email, reason, requestReference, documentSha256: stored.sha256 } });
    await dispatch('auth.recovery_requested', { name: u!.nameAr, link: cancel.link }, ownerRecipients(u!), { dedupePrefix: `rec-req:${id}`, sensitive: true, channels: ['email', 'sms'] });
    await dispatch('ops.recovery_pending', { companyName: await companyOf(u!), reference: requestReference }, await pmuRecipients(), { dedupePrefix: `rec-pmu:${id}`, channels: ['email'] });
  });
  kickNotificationWorker();
  return await publicRecovery((await getRecovery(id))!);
}

async function loadOpen(id: string): Promise<RecoveryRow> {
  const r = await getRecovery(id);
  if (!r) throw Errors.notFound();
  if (!OPEN.includes(r.status)) throw Errors.conflict('RECOVERY_CLOSED', 'هذا الطلب مغلق بالفعل.', 'This request is already closed.');
  return r;
}

function userActor(u: UserInternal, ip: string): AuditActor {
  return { actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.role, actorOrgId: u.organizationId, ip };
}

/** 2) موافقة PMU ← مهلة الانتظار. */
export async function approveRecovery(user: UserInternal, id: string, body: unknown, ip: string) {
  const r = await loadOpen(id);
  if (!canDecide(user, r)) throw Errors.forbidden('الموافقة على الاسترداد لوحدة إدارة المبادرة (وليس مقدم الطلب).', 'Only the PMU (not the requester) can approve a recovery.');
  if (r.status !== 'pending_approval') throw Errors.conflict('RECOVERY_ALREADY_APPROVED', 'اعتُمد الطلب بالفعل وهو في مهلة الانتظار.', 'Already approved; in the waiting period.');
  const b = onlyKeys(body ?? {}, ['note']);
  const c = new Checker();
  const note = c.text(b, 'note', { max: 1000 });
  c.throwIfAny();
  const owner = (await getUserById(r.userId))!;
  const until = new Date(Date.now() + shamsPolicy.accountRecoveryCoolingHours * 3600_000).toISOString();
  const cancel = newCancelToken();
  await tx(async () => {
    const changed = await getDb().prepare(`UPDATE shams_account_recovery_requests SET status = 'cooling', approvedBy = ?, approvedAt = ?, coolingEndsAt = ?, cancelTokenHash = ?
      WHERE id = ? AND status = 'pending_approval'`).run(user.id, nowIso(), until, cancel.hash, id);
    if (Number(changed.changes) !== 1) throw Errors.conflict('RECOVERY_CLOSED', 'هذا الطلب مغلق بالفعل.', 'This request is already closed.');
    await addAuditLog({ ...userActor(user, ip), action: 'account_recovery.approve', entityType: 'account_recovery', entityId: id,
      summaryAr: `موافقة PMU على استرداد حساب مصنع — التنفيذ بعد ${shamsPolicy.accountRecoveryCoolingHours} ساعة`, details: { coolingEndsAt: until, note: note ?? '' } });
    await dispatch('auth.recovery_approved', { name: owner.nameAr, link: cancel.link, until }, ownerRecipients(owner), { dedupePrefix: `rec-ok:${id}`, sensitive: true, channels: ['email', 'sms'] });
  });
  kickNotificationWorker();
  return await publicRecovery((await getRecovery(id))!);
}

async function closeRecovery(r: RecoveryRow, status: 'cancelled' | 'rejected', closedBy: string, reason: string, actor: AuditActor, eventAr: string, eventEn: string): Promise<void> {
  const owner = await getUserById(r.userId);
  const requester = await getUserById(r.requestedBy);
  await tx(async () => {
    const changed = await getDb().prepare(`UPDATE shams_account_recovery_requests SET status = ?, closedBy = ?, closedAt = ?, closeReason = ?, cancelTokenHash = NULL
      WHERE id = ? AND status IN ('pending_approval','cooling')`).run(status, closedBy, nowIso(), reason, r.id);
    if (Number(changed.changes) !== 1) throw Errors.conflict('RECOVERY_CLOSED', 'هذا الطلب مغلق بالفعل.', 'This request is already closed.');
    await addAuditLog({ ...actor, action: `account_recovery.${status === 'rejected' ? 'reject' : 'cancel'}`, entityType: 'account_recovery', entityId: r.id,
      summaryAr: `${eventAr} — طلب استرداد حساب مصنع`, details: { closedBy, reason } });
    const to: Recipient[] = [...(owner ? ownerRecipients(owner) : []), ...(requester ? [{ userId: requester.id, email: requester.email }] : []), ...await pmuRecipients()];
    await dispatch('auth.recovery_closed', { eventAr, eventEn, reason }, to, { dedupePrefix: `rec-close:${r.id}`, channels: ['email'] });
  });
  kickNotificationWorker();
}

export async function rejectRecovery(user: UserInternal, id: string, body: unknown, ip: string) {
  const r = await loadOpen(id);
  if (!canDecide(user, r)) throw Errors.forbidden();
  const b = onlyKeys(body ?? {}, ['reason']);
  const c = new Checker();
  const reason = c.text(b, 'reason', { required: true, min: 3, max: 1000 });
  c.throwIfAny();
  await closeRecovery(r, 'rejected', user.id, reason!, userActor(user, ip), 'رفضت وحدة إدارة المبادرة الطلب', 'rejected by the PMU');
  return await publicRecovery((await getRecovery(id))!);
}

/** إلغاء من PMU في أي وقت قبل التنفيذ. */
export async function cancelRecoveryByPmu(user: UserInternal, id: string, body: unknown, ip: string) {
  const r = await loadOpen(id);
  if (!(shamsPolicy.accountRecoveryApproverRoles.includes(user.role) && user.organizationId === ORG_IDS.pmu)) throw Errors.forbidden();
  const b = onlyKeys(body ?? {}, ['reason']);
  const c = new Checker();
  const reason = c.text(b, 'reason', { required: true, min: 3, max: 1000 });
  c.throwIfAny();
  await closeRecovery(r, 'cancelled', user.id, reason!, userActor(user, ip), 'ألغت وحدة إدارة المبادرة الطلب', 'cancelled by the PMU');
  return await publicRecovery((await getRecovery(id))!);
}

/** 3) إلغاء صاحب الحساب برابط/رمز لمرة واحدة (بلا تسجيل دخول). رد عام لا يكشف شيئًا. */
export async function cancelRecoveryByOwner(token: unknown, ip: string): Promise<boolean> {
  const t = typeof token === 'string' ? token.trim() : '';
  if (!/^[a-f0-9]{64}$/.test(t)) return false;
  const r = await getDb().prepare("SELECT * FROM shams_account_recovery_requests WHERE cancelTokenHash = ? AND status IN ('pending_approval','cooling')").get(sha256(t)) as unknown as RecoveryRow | undefined;
  if (!r) return false;
  await closeRecovery(r, 'cancelled', 'owner', 'ألغاه صاحب الحساب برابط الإلغاء', { actorType: 'anonymous', ip }, 'ألغى صاحب الحساب الطلب', 'cancelled by the account owner');
  return true;
}

/** 4) التنفيذ بعد المهلة (العامل الدوري). يرجع عدد الطلبات المنفذة. */
export async function executeDueRecoveries(now = Date.now()): Promise<number> {
  const due = await getDb().prepare("SELECT * FROM shams_account_recovery_requests WHERE status = 'cooling' AND coolingEndsAt <= ?").all(new Date(now).toISOString()) as unknown as RecoveryRow[];
  let n = 0;
  for (const r of due) {
    const u = await getUserById(r.userId);
    const system: AuditActor = { actorType: 'system', actorName: 'recovery-worker' };
    if (!u || u.role !== 'factory_owner' || await getUserByEmail(r.newEmail)) {
      await closeRecovery(r, 'cancelled', 'system', 'تعذر التنفيذ: الحساب غير متاح أو البريد الجديد أصبح مستخدمًا', system, 'تعذر تنفيذ الطلب', 'could not be executed');
      continue;
    }
    const token = randomBytes(32).toString('hex');
    const hash = sha256(token);
    await tx(async () => {
      const changed = await getDb().prepare("UPDATE shams_account_recovery_requests SET status = 'executed', executedAt = ?, cancelTokenHash = NULL WHERE id = ? AND status = 'cooling'").run(nowIso(), r.id);
      if (Number(changed.changes) !== 1) return;
      const oldEmail = u.email;
      await changeEmail(u.id, r.newEmail);
      await setVerifyToken(u.id, hash, new Date(Date.now() + 24 * 3600_000).toISOString());
      await revokeAllSessions(u.id);
      await addAuditLog({ ...system, action: 'user.recover_email', entityType: 'user', entityId: u.id,
        summaryAr: `تنفيذ استرداد حساب مصنع: تغيير البريد (مرجع ${r.requestReference})`,
        details: { recoveryId: r.id, oldEmail, newEmail: r.newEmail, reason: r.reason, requestReference: r.requestReference, approvedBy: r.approvedBy, sessionsRevoked: true } });
      await dispatch('auth.email_changed_old', { name: u.nameAr }, ownerRecipients(u), { dedupePrefix: `recover-old:${hash.slice(0, 16)}`, channels: ['email', 'sms'] });
      await dispatch('auth.email_changed_new', { name: u.nameAr, link: `${config.appUrl}/#verify-email/${token}` }, [{ userId: u.id, email: r.newEmail }],
        { dedupePrefix: `recover-new:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
      n++;
    });
  }
  if (n) kickNotificationWorker();
  return n;
}

export async function listRecoveries(): Promise<Array<Awaited<ReturnType<typeof publicRecovery>>>> {
  return mapSeq(await getDb().prepare(`SELECT * FROM shams_account_recovery_requests
    ORDER BY CASE WHEN status IN ('pending_approval','cooling') THEN 0 ELSE 1 END, requestedAt DESC LIMIT 200`).all() as unknown as RecoveryRow[], (r) => publicRecovery(r));
}

/** المستند الرسمي: PMU (المراجِع) والأدمن (مقدم الطلب) فقط. */
export async function recoveryDocument(user: UserInternal, id: string): Promise<RecoveryRow> {
  const r = await getRecovery(id);
  if (!r || !(user.role === 'system_admin' || (shamsPolicy.accountRecoveryApproverRoles.includes(user.role) && user.organizationId === ORG_IDS.pmu))) throw Errors.notFound();
  return r;
}

// ── العامل الدوري ──
let timer: NodeJS.Timeout | null = null;
export async function startRecoveryWorker(): Promise<void> {
  if (timer) return;
  const run = () => trackJob((async () => { try { await withJobLock('recovery', () => executeDueRecoveries()); } catch (e) { console.error('[recovery] worker error:', (e as Error).message); } })());
  timer = setInterval(run, config.recoverySweepMs);
  timer.unref();
  await run();
}
export function stopRecoveryWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
