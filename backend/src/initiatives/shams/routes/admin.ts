/** شاشات الأدمن: الحسابات والجهات والبنوك، سجل التدقيق، مفاتيح الربط، سجل الإشعارات والـwebhooks. لا قرارات على الطلبات. */
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { normPage, normPageSize, paginate, str } from '../http/helpers.js';
import { onlyKeys } from '../http/validate.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { listOrganizations } from '../store/organizations.js';
import { listUsers, toPublicUser } from '../store/users.js';
import { addAuditLog, actorFromReq, listAuditLogs } from '../store/audit.js';
import { listIntegrationKeys, INTEGRATION_SCOPES } from '../store/integrationKeys.js';
import { listNotifications, listWebhooks, requeueNotification, requeueWebhook } from '../store/outbox.js';
import { adminResetPassword, createOrg, listAccountRequests, requestEmailChange, requestStaffAccount, updateOrg, updateStaffUser } from '../services/accounts.js';
import { createKey, revokeKey, rotateKey } from '../services/integrationKeys.js';
import { readinessReport } from '../services/readiness.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { ORG_TYPES, ROLES, type OrgType, type Role } from '../domain.js';

export const adminRouter = Router();
adminRouter.use('/admin', requireRole('system_admin'));

const FULL = { allowAdminAccounts: true };

// ── الجاهزية والتشغيل (B2) — لوحة الأدمن ──
adminRouter.get('/admin/readiness', ah(async (_req, res) => okMessage(res, 200, 'ok', await readinessReport())));

// ── الجهات والبنوك ──
adminRouter.get('/admin/organizations', ah(async (req, res) => {
  const type = (ORG_TYPES as readonly string[]).includes(str(req.query.type)) ? (str(req.query.type) as OrgType) : undefined;
  return okMessage(res, 200, 'ok', { items: await listOrganizations({ type, q: str(req.query.q).slice(0, 100) || undefined, includeFactories: type === 'factory' }) });
}));
adminRouter.post('/admin/organizations', ah(async (req, res) => okMessage(res, 201, 'تمت إضافة الجهة.', await createOrg(actorFromReq(req), req.body))));
adminRouter.put('/admin/organizations/:id', ah(async (req, res) => okMessage(res, 200, 'تم الحفظ.', await updateOrg(actorFromReq(req), req.params.id, req.body, FULL))));

// ── الحسابات ──
adminRouter.get('/admin/users', ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 20, 100);
  const role = (ROLES as readonly string[]).includes(str(req.query.role)) ? (str(req.query.role) as Role) : undefined;
  const { rows, total } = await listUsers({ q: str(req.query.q).slice(0, 100) || undefined, role, organizationId: str(req.query.organizationId) || undefined }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows.map(toPublicUser), total, page, pageSize));
}));
/**
 * H2: جهات القرار (IMC/ENCPC/PMU/بنك) → طلب معلق يوافق عليه مستخدم نشط من الجهة نفسها (POST /account-requests/:id/approve).
 * حساب مدير نظام → يُنشأ برابط تعيين على بريده (لا كلمة مؤقتة). لا يُرجع الرد أي سر.
 */
adminRouter.post('/admin/users', ah(async (req, res) => {
  const out = await requestStaffAccount(actorFromReq(req), req.body, FULL);
  return okMessage(res, out.request ? 202 : 201, out.request ? 'سُجّل الطلب — بانتظار موافقة مستخدم نشط من الجهة نفسها.' : 'أُنشئ الحساب — أُرسل رابط تعيين كلمة المرور إلى بريده.', out);
}));
adminRouter.get('/admin/account-requests', ah(async (req, res) => okMessage(res, 200, 'ok', { items: await listAccountRequests(currentUser(req)) })));
adminRouter.put('/admin/users/:id', ah(async (req, res) => okMessage(res, 200, 'تم الحفظ.', await updateStaffUser(actorFromReq(req), req.params.id, req.body, FULL))));
/** إعادة تعيين إدارية: رابط تعيين على بريد الحساب الحالي فقط وإنهاء كل الجلسات (لا كلمة مؤقتة). */
adminRouter.post('/admin/users/:id/reset-password', ah(async (req, res) => {
  onlyKeys(req.body ?? {}, []);
  return okMessage(res, 200, 'أُرسل رابط تعيين كلمة المرور إلى بريد الحساب وأُنهيت جلساته.', await adminResetPassword(actorFromReq(req), req.params.id));
}));
/** تغيير بريد حساب جهة قرار: طلب بموافقة الجهة. (حساب المصنع: مسار الاسترداد /recovery-requests بموافقة PMU.) */
adminRouter.post('/admin/users/:id/email-change-request', ah(async (req, res) =>
  okMessage(res, 202, 'سُجّل طلب تغيير البريد — بانتظار موافقة الجهة.', await requestEmailChange(actorFromReq(req), req.params.id, req.body))));

// ── سجل التدقيق ──
adminRouter.get('/admin/audit-logs', ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 500);
  const { rows, total } = await listAuditLogs({
    q: str(req.query.q).slice(0, 100) || undefined, action: str(req.query.action) || undefined, entityType: str(req.query.entityType) || undefined,
    applicationId: str(req.query.applicationId) || undefined, from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
  }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));
adminRouter.post('/admin/audit-logs/export', ah(async (req, res) => {
  const b = onlyKeys(req.body ?? {}, ['format', 'rows']);
  await addAuditLog({ ...actorFromReq(req), action: 'audit.export', entityType: 'audit_logs', summaryAr: `تصدير سجل التدقيق (${Number(b.rows) || 0} صف، ${str(b.format) || 'xlsx'})` });
  return okMessage(res, 200, 'تم تسجيل التصدير.');
}));

// ── مفاتيح الربط (H1): نطاقات البيانات معطلة افتراضيًا، وعند تفعيلها يعتمدها PMU (POST /integration-keys/:id/approve) ──
adminRouter.get('/admin/integration-keys', ah(async (_req, res) => okMessage(res, 200, 'ok', { items: await listIntegrationKeys(), scopes: INTEGRATION_SCOPES })));
adminRouter.post('/admin/integration-keys', ah(async (req, res) => {
  const { key, plaintext } = await createKey({ ...actorFromReq(req), actorUserId: currentUser(req).id }, req.body);
  return okMessage(res, 201, key.approvalStatus === 'active' ? 'تم إنشاء المفتاح — انسخه الآن، لن يظهر مرة أخرى.' : 'تم إنشاء المفتاح — لن يعمل قبل موافقة وحدة إدارة المبادرة. انسخه الآن، لن يظهر مرة أخرى.', { key, plaintextKey: plaintext });
}));
adminRouter.post('/admin/integration-keys/:id/revoke', ah(async (req, res) =>
  okMessage(res, 200, 'تم إلغاء المفتاح.', await revokeKey({ ...actorFromReq(req), actorUserId: currentUser(req).id }, req.params.id))));
/** التدوير: مفتاح جديد بنفس النطاقات والحد، وإلغاء القديم فورًا. */
adminRouter.post('/admin/integration-keys/:id/rotate', ah(async (req, res) => {
  const { key, plaintext } = await rotateKey({ ...actorFromReq(req), actorUserId: currentUser(req).id }, req.params.id);
  return okMessage(res, 201, 'تم تدوير المفتاح — انسخ الجديد الآن.', { key, plaintextKey: plaintext });
}));

// ── سجل الإشعارات والـwebhooks ──
adminRouter.get('/admin/notifications', ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const { rows, total } = await listNotifications({ status: str(req.query.status) || undefined, channel: str(req.query.channel) || undefined, applicationId: str(req.query.applicationId) || undefined }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));
adminRouter.post('/admin/notifications/:id/retry', ah(async (req, res) => {
  const r = await requeueNotification(req.params.id);
  if (r === 'not_found') throw Errors.notFound();
  if (r === 'not_retryable') throw Errors.conflict('NOT_RETRYABLE', 'لا يمكن إعادة إرسال هذه الرسالة.', 'This message cannot be retried.');
  await addAuditLog({ ...actorFromReq(req), action: 'notification.retry', entityType: 'notification', entityId: req.params.id, summaryAr: 'إعادة محاولة إرسال إشعار' });
  kickNotificationWorker();
  return okMessage(res, 200, 'أُعيدت الرسالة إلى طابور الإرسال.');
}));
adminRouter.get('/admin/webhooks', ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const { rows, total } = await listWebhooks({ status: str(req.query.status) || undefined }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));
adminRouter.post('/admin/webhooks/:id/retry', ah(async (req, res) => {
  const r = await requeueWebhook(req.params.id);
  if (r === 'not_found') throw Errors.notFound();
  if (r === 'not_retryable') throw Errors.conflict('NOT_RETRYABLE', 'لا يمكن إعادة إرسال هذا الحدث.', 'This event cannot be retried.');
  await addAuditLog({ ...actorFromReq(req), action: 'webhook.retry', entityType: 'webhook', entityId: req.params.id, summaryAr: 'إعادة محاولة إرسال webhook' });
  return okMessage(res, 200, 'أُعيد الحدث إلى طابور الإرسال.');
}));
