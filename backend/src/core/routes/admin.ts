/**
 * The unified platform administration: cross-initiative statistics, accounts and memberships, audit log, outbox,
 * readiness. Each initiative keeps its own staff screens (reviews, approvals…) inside its module; super admins enter them
 * as the module's administrator.
 */
import { Router, type Request } from 'express';
import { tx, getDb, parseJson } from '../db/index.js';
import { ah, AppError, Errors, okMessage } from '../http/errors.js';
import { clientIp, normPage, normPageSize, paginate } from '../http/helpers.js';
import { Checker, isEmail, onlyKeys } from '../http/validate.js';
import { coreUserOf, requirePlatformRole } from '../middleware/auth.js';
import { addAuditLog, listAuditLogs } from '../store/audit.js';
import { listNotifications, requeueNotification } from '../store/outbox.js';
import {
  getUserByEmail, getUserById, listCoreUsers, PLATFORM_ROLES, PLATFORM_ROLE_LABELS, setPlatformRole, toPublicCoreUser, updateCoreUser, type PlatformRole,
} from '../store/users.js';
import { getMembershipById, listMembershipsOfUser, setMembershipStatus, type MembershipStatus } from '../store/memberships.js';
import { revokeAllSessions } from '../store/refreshTokens.js';
import { changeAccountEmail, ensureInvitedUser, sendSetupLink } from '../identity.js';
import { allStats, initiativeStats } from '../stats.js';
import { MODULES, getModule } from '../../initiatives/registry.js';
import { getPersonProfile, listFactoryProfilesOfUser } from '../profile/store.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { config } from '../../config.js';
import { isMailConfigured } from '../mail/mailer.js';

export const adminRouter = Router();

const VIEW_ROLES: PlatformRole[] = ['super_admin', 'ministry_viewer', 'auditor'];
const viewers = requirePlatformRole(...VIEW_ROLES);
const superAdmin = requirePlatformRole('super_admin');
const auditRoles = requirePlatformRole('super_admin', 'auditor');

async function audit(req: Request, action: string, entityType: string, entityId: string, summaryAr: string, details?: Record<string, unknown>) {
  const u = coreUserOf(req);
  await addAuditLog({ actorType: 'user', actorUserId: u.id, actorName: u.nameAr, actorRole: u.platformRole ?? '', ip: clientIp(req), action, entityType, entityId, summaryAr, details });
}

// ── Statistics ───────────────────────────────────────────────────────────

function dateRange(req: Request): { from?: string; to?: string } {
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : undefined);
  return { from: iso(req.query.from), to: iso(req.query.to) };
}

adminRouter.get('/admin/stats', viewers, ah(async (req, res) => okMessage(res, 200, 'ok', await allStats(dateRange(req)))));

adminRouter.get('/admin/stats/:id', viewers, ah(async (req, res) => {
  const s = await initiativeStats(req.params.id, dateRange(req));
  if (!s) throw Errors.notFound();
  const mod = getModule(req.params.id)!;
  return okMessage(res, 200, 'ok', { ...s, staffEntryPoints: mod.staffEntryPoints });
}));

adminRouter.get('/admin/activity', viewers, ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const items = [];
  for (const m of MODULES) {
    try { for (const a of await m.stats.recentActivity(limit)) items.push({ ...a, initiativeId: m.id, titleAr: m.titleAr, titleEn: m.titleEn }); } catch { /* one module down does not hide the others */ }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return okMessage(res, 200, 'ok', { items: items.slice(0, limit) });
}));

adminRouter.get('/admin/modules', viewers, ah(async (_req, res) => okMessage(res, 200, 'ok', {
  items: MODULES.map((m) => ({ id: m.id, titleAr: m.titleAr, titleEn: m.titleEn, subject: m.subject, roles: m.roles, adminRole: m.adminRole, staffEntryPoints: m.staffEntryPoints, defaultAdminView: m.defaultView(m.adminRole) })),
  platformRoles: PLATFORM_ROLES.map((r) => ({ key: r, ...PLATFORM_ROLE_LABELS[r] })),
})));

// ── Accounts & memberships ───────────────────────────────────────────────

async function userDetails(id: string) {
  const u = await getUserById(id);
  if (!u) return null;
  const memberships = (await listMembershipsOfUser(id)).map((m) => {
    const mod = getModule(m.initiativeId);
    const role = mod?.roles.find((r) => r.key === m.role);
    return { ...m, titleAr: mod?.titleAr ?? m.initiativeId, titleEn: mod?.titleEn ?? m.initiativeId, roleLabelAr: role?.labelAr ?? m.role, roleLabelEn: role?.labelEn ?? m.role, roleKind: role?.kind ?? 'applicant' };
  });
  return { ...toPublicCoreUser(u), memberships };
}

adminRouter.get('/admin/users', viewers, ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 25, 100);
  const pr = typeof req.query.platformRole === 'string' && req.query.platformRole ? req.query.platformRole as PlatformRole | 'any' : undefined;
  const { rows, total } = await listCoreUsers({
    q: typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : undefined, platformRole: pr,
    initiativeId: typeof req.query.initiativeId === 'string' && req.query.initiativeId ? req.query.initiativeId : undefined,
  }, page, pageSize);
  const items = [];
  for (const u of rows) items.push(await userDetails(u.id));
  return okMessage(res, 200, 'ok', paginate(items, total, page, pageSize));
}));

adminRouter.get('/admin/users/:id', viewers, ah(async (req, res) => {
  const d = await userDetails(req.params.id);
  if (!d) throw Errors.notFound();
  const person = await getPersonProfile(req.params.id);
  const factories = await listFactoryProfilesOfUser(req.params.id);
  return okMessage(res, 200, 'ok', { ...d, profile: person.values, factories: factories.map((f) => ({ id: f.id, role: f.role, values: f.values })) });
}));

/** Platform staff (ministry viewers, auditors, content managers, admins): invited by e-mail, no temporary password. */
adminRouter.post('/admin/users', superAdmin, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['email', 'nameAr', 'nameEn', 'phone', 'platformRole']);
  const c = new Checker();
  const email = c.text(b, 'email', { required: true, max: 254 });
  const nameAr = c.text(b, 'nameAr', { required: true, max: 200 });
  const nameEn = c.text(b, 'nameEn', { max: 200 });
  const phone = c.text(b, 'phone', { max: 20 });
  if (email && !isEmail(email)) c.add('email', 'invalid email');
  if (!PLATFORM_ROLES.includes(b.platformRole as PlatformRole)) c.add('platformRole', 'invalid');
  c.throwIfAny();
  const actor = coreUserOf(req);
  const result = await tx(async () => {
    const { user, created } = await ensureInvitedUser({ email: email!, nameAr: nameAr!, nameEn, phone, createdBy: actor.id, source: 'platform' });
    if (user.platformRole && user.platformRole !== b.platformRole) throw new AppError(409, 'HAS_PLATFORM_ROLE', 'لهذا الحساب دور آخر على المنصة — عدّله من صفحة الحساب.', 'This account already has another platform role.');
    await setPlatformRole(user.id, b.platformRole as PlatformRole);
    await audit(req, 'user.platform_role_granted', 'user', user.id, `منح دور «${PLATFORM_ROLE_LABELS[b.platformRole as PlatformRole].ar}» للحساب ${user.email}`, { created });
    return { id: user.id, created };
  });
  kickNotificationWorker();
  return okMessage(res, 201, result.created ? 'أُنشئ الحساب وأُرسل رابط تعيين كلمة المرور إلى بريده.' : 'أُضيف الدور إلى الحساب الموجود.', await userDetails(result.id));
}));

adminRouter.put('/admin/users/:id', superAdmin, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['nameAr', 'nameEn', 'phone', 'isActive', 'platformRole']);
  const actor = coreUserOf(req);
  const u = await getUserById(req.params.id);
  if (!u) throw Errors.notFound();
  if (u.id === actor.id && (b.isActive === false || (b.platformRole !== undefined && b.platformRole !== 'super_admin'))) {
    throw new AppError(409, 'SELF_LOCKOUT', 'لا يمكنك إيقاف حسابك أو سحب دورك بنفسك.', 'You cannot deactivate yourself or remove your own role.');
  }
  if (b.platformRole !== undefined && b.platformRole !== null && !PLATFORM_ROLES.includes(b.platformRole as PlatformRole)) throw Errors.validation([{ field: 'platformRole', issue: 'invalid' }]);
  await tx(async () => {
    await updateCoreUser(u.id, {
      nameAr: typeof b.nameAr === 'string' && b.nameAr.trim() ? b.nameAr.trim().slice(0, 200) : undefined,
      nameEn: typeof b.nameEn === 'string' ? b.nameEn.trim().slice(0, 200) : undefined,
      phone: typeof b.phone === 'string' ? b.phone.trim().slice(0, 20) : undefined,
      isActive: typeof b.isActive === 'boolean' ? b.isActive : undefined,
    });
    if (b.platformRole !== undefined) await setPlatformRole(u.id, (b.platformRole as PlatformRole | null) ?? null);
    if (b.isActive === false) await revokeAllSessions(u.id);
    await audit(req, 'user.updated', 'user', u.id, `تعديل الحساب ${u.email}`, { fields: Object.keys(b) });
  });
  return okMessage(res, 200, 'تم حفظ الحساب.', await userDetails(u.id));
}));

adminRouter.post('/admin/users/:id/reset-password', superAdmin, ah(async (req, res) => {
  const u = await getUserById(req.params.id);
  if (!u) throw Errors.notFound();
  await tx(async () => {
    await sendSetupLink(u, 'reset');
    await audit(req, 'user.password_reset_link', 'user', u.id, `إرسال رابط إعادة تعيين كلمة المرور إلى ${u.email}`);
  });
  kickNotificationWorker();
  return okMessage(res, 200, 'أُرسل رابط تعيين كلمة مرور جديدة إلى بريد الحساب، وأُنهيت جلساته.');
}));

adminRouter.post('/admin/users/:id/change-email', superAdmin, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['email', 'reason']);
  if (!isEmail(b.email)) throw Errors.validation([{ field: 'email', issue: 'invalid email' }]);
  if (typeof b.reason !== 'string' || b.reason.trim().length < 10) throw Errors.validation([{ field: 'reason', issue: 'min length 10' }]);
  const u = await getUserById(req.params.id);
  if (!u) throw Errors.notFound();
  if (await getUserByEmail(b.email as string)) throw Errors.conflict('EMAIL_TAKEN', 'البريد الجديد مستخدم لحساب آخر.', 'The new email is used by another account.');
  const actor = coreUserOf(req);
  await tx(() => changeAccountEmail(u.id, b.email as string, { id: actor.id, name: actor.nameAr, ip: clientIp(req) }));
  kickNotificationWorker();
  return okMessage(res, 200, 'تم تغيير البريد، وأُرسل رابط التفعيل إلى البريد الجديد.', await userDetails(u.id));
}));

adminRouter.put('/admin/memberships/:id', superAdmin, ah(async (req, res) => {
  const b = onlyKeys(req.body, ['status', 'reason']);
  if (!['active', 'suspended'].includes(String(b.status))) throw Errors.validation([{ field: 'status', issue: 'active | suspended' }]);
  const m = await getMembershipById(req.params.id);
  if (!m) throw Errors.notFound();
  await tx(async () => {
    await setMembershipStatus(m.id, b.status as MembershipStatus);
    await addAuditLog({ initiativeId: m.initiativeId, actorType: 'user', actorUserId: coreUserOf(req).id, actorName: coreUserOf(req).nameAr, ip: clientIp(req),
      action: b.status === 'active' ? 'membership.activated' : 'membership.suspended', entityType: 'membership', entityId: m.id,
      summaryAr: b.status === 'active' ? 'تفعيل عضوية في مبادرة' : 'إيقاف عضوية في مبادرة', details: { userId: m.userId, role: m.role, reason: typeof b.reason === 'string' ? b.reason.slice(0, 500) : '' } });
  });
  return okMessage(res, 200, 'تم.', await userDetails(m.userId));
}));

// ── Audit log, outbox, readiness ─────────────────────────────────────────

adminRouter.get('/admin/audit-logs', auditRoles, ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const q = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : undefined);
  const initiative = q('initiativeId');
  const { rows, total } = await listAuditLogs({ initiativeId: initiative === 'core' ? null : initiative, q: q('q')?.slice(0, 100), action: q('action'), entityType: q('entityType'), applicationId: q('applicationId'), from: q('from'), to: q('to') }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));

adminRouter.get('/admin/audit-logs/export', auditRoles, ah(async (req, res) => {
  const initiative = typeof req.query.initiativeId === 'string' && req.query.initiativeId ? req.query.initiativeId : undefined;
  const { rows } = await listAuditLogs({ initiativeId: initiative === 'core' ? null : initiative }, 1, 10_000);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['at,initiative,actorType,actorName,actorRole,action,entityType,entityId,applicationId,summaryAr,ip']
    .concat(rows.map((r) => [r.at, r.initiativeId ?? 'core', r.actorType, r.actorName, r.actorRole, r.action, r.entityType, r.entityId, r.applicationId ?? '', r.summaryAr, r.ip].map(esc).join(','))).join('\n');
  await audit(req, 'audit.export', 'audit_logs', '', `تصدير سجل التدقيق (${rows.length} صف)`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
  res.send(`﻿${csv}`);
}));

adminRouter.get('/admin/notifications', superAdmin, ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const q = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : undefined);
  const { rows, total } = await listNotifications({ status: q('status'), channel: q('channel'), initiativeId: q('initiativeId') }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, Number(total), page, pageSize));
}));

adminRouter.post('/admin/notifications/:id/retry', superAdmin, ah(async (req, res) => {
  const r = await requeueNotification(req.params.id);
  if (r === 'not_found') throw Errors.notFound();
  if (r === 'not_retryable') throw Errors.conflict('NOT_RETRYABLE', 'لا يمكن إعادة إرسال هذه الرسالة.', 'This message cannot be retried.');
  await audit(req, 'notification.retry', 'notification', req.params.id, 'إعادة محاولة إرسال إشعار');
  kickNotificationWorker();
  return okMessage(res, 200, 'أُعيدت الرسالة إلى طابور الإرسال.');
}));

adminRouter.get('/admin/readiness', superAdmin, ah(async (_req, res) => {
  const db = getDb();
  const admins = Number((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE platformRole = 'super_admin' AND isActive = 1").get() as { n: number }).n);
  const failed = Number((await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'failed'").get() as { n: number }).n);
  const core = [
    { key: 'core.mail', ok: isMailConfigured(), labelAr: 'إعداد البريد (SMTP / Gmail)', labelEn: 'Mail configured' },
    { key: 'core.support', ok: Boolean(config.supportEmail && config.supportPhone), labelAr: 'قناة الاستفسار الرسمية (SUPPORT_EMAIL / SUPPORT_PHONE)', labelEn: 'Official support channel' },
    { key: 'core.admins', ok: admins > 0, labelAr: 'مدير منصة نشط واحد على الأقل', labelEn: 'At least one active platform admin', detail: String(admins) },
    { key: 'core.outbox', ok: failed === 0, labelAr: 'لا رسائل فاشلة في طابور الإرسال', labelEn: 'No failed outbox messages', detail: String(failed) },
  ];
  const modules = [];
  for (const m of MODULES) {
    let checks: Array<{ key: string; ok: boolean; labelAr: string; labelEn: string; detail?: string }> = [];
    try { checks = (await m.readiness?.()) ?? []; } catch (e) { checks = [{ key: `${m.id}.error`, ok: false, labelAr: 'تعذر فحص جاهزية المبادرة', labelEn: 'Readiness check failed', detail: (e as Error).message }]; }
    modules.push({ initiativeId: m.id, titleAr: m.titleAr, titleEn: m.titleEn, checks });
  }
  return okMessage(res, 200, 'ok', { core, modules });
}));

adminRouter.get('/admin/legacy-archive', superAdmin, ah(async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
  const rows = await getDb().prepare(`SELECT id, kind, data, importedAt FROM legacy_platform_archive ${kind ? 'WHERE kind = ?' : ''} ORDER BY kind, id`).all(...(kind ? [kind] : []));
  return okMessage(res, 200, 'ok', { items: rows.map((r) => ({ ...r, data: parseJson(r.data, {}) })) });
}));
