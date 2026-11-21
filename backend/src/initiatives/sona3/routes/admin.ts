/** شاشات الأدمن: الحسابات والجهات والبنوك، سجل التدقيق، مفاتيح الربط، سجل الإشعارات والـwebhooks. لا قرارات على الطلبات. */
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { normPage, normPageSize, paginate, str } from '../http/helpers.js';
import { Checker, onlyKeys } from '../http/validate.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { listOrganizations } from '../store/organizations.js';
import { listUsers, toPublicUser } from '../store/users.js';
import { addAuditLog, actorFromReq, listAuditLogs } from '../store/audit.js';
import {
  createIntegrationKey, getIntegrationKey, listIntegrationKeys, revokeIntegrationKey, INTEGRATION_SCOPES, type IntegrationScope,
} from '../store/integrationKeys.js';
import { listNotifications, listWebhooks, requeueNotification, requeueWebhook } from '../store/outbox.js';
import { createOrg, createStaffUser, recoverApplicantEmail, updateOrg, updateStaffUser } from '../services/accounts.js';
import { readinessReport } from '../services/readiness.js';
import { CONTENT_KEYS, isContentKey, listOverrides, resetOverride, setOverride, validateContent } from '../store/siteContent.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { ORG_TYPES, ROLES, type OrgType, type Role } from '../domain.js';

export const adminRouter = Router();
adminRouter.use('/admin', requireRole('system_admin'));

const FULL = { allowAdminAccounts: true };

// ── الجاهزية والتشغيل (B2) — لوحة الأدمن ──
adminRouter.get('/admin/readiness', ah((_req, res) => okMessage(res, 200, 'ok', readinessReport())));

// ── الجهات والبنوك ──
adminRouter.get('/admin/organizations', ah((req, res) => {
  const type = (ORG_TYPES as readonly string[]).includes(str(req.query.type)) ? (str(req.query.type) as OrgType) : undefined;
  return okMessage(res, 200, 'ok', { items: listOrganizations({ type, q: str(req.query.q).slice(0, 100) || undefined, includeApplicants: type === 'applicant' }) });
}));
adminRouter.post('/admin/organizations', ah((req, res) => okMessage(res, 201, 'تمت إضافة الجهة.', createOrg(actorFromReq(req), req.body))));
adminRouter.put('/admin/organizations/:id', ah((req, res) => okMessage(res, 200, 'تم الحفظ.', updateOrg(actorFromReq(req), req.params.id, req.body, FULL))));

// ── الحسابات ──
adminRouter.get('/admin/users', ah((req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 20, 100);
  const role = (ROLES as readonly string[]).includes(str(req.query.role)) ? (str(req.query.role) as Role) : undefined;
  const { rows, total } = listUsers({ q: str(req.query.q).slice(0, 100) || undefined, role, organizationId: str(req.query.organizationId) || undefined }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows.map(toPublicUser), total, page, pageSize));
}));
adminRouter.post('/admin/users', ah((req, res) => okMessage(res, 201, 'تم إنشاء الحساب — سلّم كلمة المرور المؤقتة لصاحبه (تظهر مرة واحدة).', createStaffUser(actorFromReq(req), req.body, FULL))));
adminRouter.put('/admin/users/:id', ah((req, res) => okMessage(res, 200, 'تم الحفظ.', updateStaffUser(actorFromReq(req), req.params.id, req.body, FULL))));
/** استرداد حساب متقدم بتغيير البريد (سبب + مرجع طلب رسمي إجباريان). */
adminRouter.post('/admin/users/:id/recover-email', ah((req, res) => okMessage(res, 200, 'تم تغيير البريد — أُرسل رابط التفعيل للبريد الجديد وأُبلغ البريد القديم.', recoverApplicantEmail(actorFromReq(req), req.params.id, req.body))));

// ── سجل التدقيق ──
adminRouter.get('/admin/audit-logs', ah((req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 500);
  const { rows, total } = listAuditLogs({
    q: str(req.query.q).slice(0, 100) || undefined, action: str(req.query.action) || undefined, entityType: str(req.query.entityType) || undefined,
    applicationId: str(req.query.applicationId) || undefined, from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
  }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));
adminRouter.post('/admin/audit-logs/export', ah((req, res) => {
  const b = onlyKeys(req.body ?? {}, ['format', 'rows']);
  addAuditLog({ ...actorFromReq(req), action: 'audit.export', entityType: 'audit_logs', summaryAr: `تصدير سجل التدقيق (${Number(b.rows) || 0} صف، ${str(b.format) || 'xlsx'})` });
  return okMessage(res, 200, 'تم تسجيل التصدير.');
}));

// ── محتوى الواجهة العامة (نصوص الصفحة الرئيسية والتذييل والصفحات التعريفية) ──
adminRouter.get('/admin/site-content', ah((_req, res) => okMessage(res, 200, 'ok', { keys: CONTENT_KEYS, items: listOverrides() })));
adminRouter.put('/admin/site-content/:key', ah((req, res) => {
  const key = req.params.key;
  if (!isContentKey(key)) throw Errors.notFound();
  const b = onlyKeys(req.body ?? {}, ['value']);
  const row = setOverride(key, validateContent(key, b.value), currentUser(req).id);
  addAuditLog({ ...actorFromReq(req), action: 'site_content.update', entityType: 'site_content', entityId: key, summaryAr: `تعديل محتوى الواجهة: ${key}` });
  return okMessage(res, 200, 'تم الحفظ.', row);
}));
adminRouter.delete('/admin/site-content/:key', ah((req, res) => {
  const key = req.params.key;
  if (!isContentKey(key)) throw Errors.notFound();
  resetOverride(key);
  addAuditLog({ ...actorFromReq(req), action: 'site_content.reset', entityType: 'site_content', entityId: key, summaryAr: `استعادة الافتراضي لمحتوى الواجهة: ${key}` });
  return okMessage(res, 200, 'تمت الاستعادة.');
}));

// ── مفاتيح الربط ──
function cleanKeyInput(body: unknown) {
  const b = onlyKeys(body, ['name', 'scopes', 'rateLimitPerMinute']);
  const c = new Checker();
  const name = c.text(b, 'name', { required: true, min: 2, max: 120 });
  const scopes = Array.isArray(b.scopes) ? b.scopes : [];
  if (!scopes.length || scopes.some((s) => !(INTEGRATION_SCOPES as readonly string[]).includes(s))) c.add('scopes', `non-empty subset of ${INTEGRATION_SCOPES.join(', ')}`);
  const rate = b.rateLimitPerMinute === undefined ? 60 : Number(b.rateLimitPerMinute);
  if (!Number.isInteger(rate) || rate < 1 || rate > 10000) c.add('rateLimitPerMinute', 'integer 1..10000');
  c.throwIfAny();
  return { name: name!, scopes: scopes as IntegrationScope[], rateLimitPerMinute: rate };
}

adminRouter.get('/admin/integration-keys', ah((_req, res) => okMessage(res, 200, 'ok', { items: listIntegrationKeys(), scopes: INTEGRATION_SCOPES })));
adminRouter.post('/admin/integration-keys', ah((req, res) => {
  const input = cleanKeyInput(req.body);
  const { key, plaintext } = createIntegrationKey({ ...input, createdBy: currentUser(req).id });
  addAuditLog({ ...actorFromReq(req), action: 'integration_key.create', entityType: 'integration_key', entityId: key.id, summaryAr: `إنشاء مفتاح ربط: ${key.name}`, details: { scopes: key.scopes, prefix: key.keyPrefix } });
  return okMessage(res, 201, 'تم إنشاء المفتاح — انسخه الآن، لن يظهر مرة أخرى.', { key, plaintextKey: plaintext });
}));
adminRouter.post('/admin/integration-keys/:id/revoke', ah((req, res) => {
  const key = getIntegrationKey(req.params.id);
  if (!key) throw Errors.notFound();
  revokeIntegrationKey(key.id, currentUser(req).id);
  addAuditLog({ ...actorFromReq(req), action: 'integration_key.revoke', entityType: 'integration_key', entityId: key.id, summaryAr: `إلغاء مفتاح ربط: ${key.name}` });
  return okMessage(res, 200, 'تم إلغاء المفتاح.', getIntegrationKey(key.id));
}));
/** التدوير: مفتاح جديد بنفس النطاقات والحد، وإلغاء القديم فورًا. */
adminRouter.post('/admin/integration-keys/:id/rotate', ah((req, res) => {
  const old = getIntegrationKey(req.params.id);
  if (!old) throw Errors.notFound();
  if (old.revokedAt) throw Errors.conflict('KEY_REVOKED', 'المفتاح ملغى بالفعل.', 'The key is already revoked.');
  const user = currentUser(req);
  const { key, plaintext } = createIntegrationKey({ name: old.name, scopes: old.scopes, rateLimitPerMinute: old.rateLimitPerMinute, createdBy: user.id, rotatedFromId: old.id });
  revokeIntegrationKey(old.id, user.id);
  addAuditLog({ ...actorFromReq(req), action: 'integration_key.rotate', entityType: 'integration_key', entityId: key.id, summaryAr: `تدوير مفتاح ربط: ${key.name}`, details: { rotatedFromId: old.id } });
  return okMessage(res, 201, 'تم تدوير المفتاح — انسخ الجديد الآن.', { key, plaintextKey: plaintext });
}));

// ── سجل الإشعارات والـwebhooks ──
adminRouter.get('/admin/notifications', ah((req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const { rows, total } = listNotifications({ status: str(req.query.status) || undefined, channel: str(req.query.channel) || undefined, applicationId: str(req.query.applicationId) || undefined }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));
adminRouter.post('/admin/notifications/:id/retry', ah((req, res) => {
  const r = requeueNotification(req.params.id);
  if (r === 'not_found') throw Errors.notFound();
  if (r === 'not_retryable') throw Errors.conflict('NOT_RETRYABLE', 'لا يمكن إعادة إرسال هذه الرسالة.', 'This message cannot be retried.');
  addAuditLog({ ...actorFromReq(req), action: 'notification.retry', entityType: 'notification', entityId: req.params.id, summaryAr: 'إعادة محاولة إرسال إشعار' });
  kickNotificationWorker();
  return okMessage(res, 200, 'أُعيدت الرسالة إلى طابور الإرسال.');
}));
adminRouter.get('/admin/webhooks', ah((req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const { rows, total } = listWebhooks({ status: str(req.query.status) || undefined }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));
adminRouter.post('/admin/webhooks/:id/retry', ah((req, res) => {
  const r = requeueWebhook(req.params.id);
  if (r === 'not_found') throw Errors.notFound();
  if (r === 'not_retryable') throw Errors.conflict('NOT_RETRYABLE', 'لا يمكن إعادة إرسال هذا الحدث.', 'This event cannot be retried.');
  addAuditLog({ ...actorFromReq(req), action: 'webhook.retry', entityType: 'webhook', entityId: req.params.id, summaryAr: 'إعادة محاولة إرسال webhook' });
  return okMessage(res, 200, 'أُعيد الحدث إلى طابور الإرسال.');
}));
