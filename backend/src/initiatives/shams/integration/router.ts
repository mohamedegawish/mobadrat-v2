/**
 * Integration API لأدمن المنصة الأصلية — /api/integration/v1 (موثق في contracts/integration.openapi.json).
 * مصادقة بمفتاح API (مخزن hash) بنطاقات، rate limit وتدقيق لكل مفتاح.
 * حد الصلاحيات: لا يوجد أي endpoint يتخذ قرارًا على الطلبات — القرار للجهة المسؤولة فقط.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ah, apiError, okMessage, Errors, rateLimitedBody } from '../http/errors.js';
import { clientIp, normPage, normPageSize, paginate, str, mapSeq } from '../http/helpers.js';
import { countAuthFailure, findActiveKey, touchKey, type IntegrationKey, type IntegrationScope } from '../store/integrationKeys.js';
import { keyAllows } from '../services/integrationKeys.js';
import { addAuditLog, actorFromReq, listAuditLogs } from '../store/audit.js';
import { getApplication, listApplications } from '../store/applications.js';
import { getDocument, wasSubmitted } from '../store/documents.js';
import { listOrganizations } from '../store/organizations.js';
import { listUsers, toPublicUser } from '../store/users.js';
import { createProvider, getProvider, listProviders, updateProvider, type ProviderInput, type ProviderStatus } from '../store/providers.js';
import { metadataDetail, metadataItem } from './metadataView.js';
import { buildSummary, ALL_SCOPE } from '../services/reports.js';
import { createOrg, requestStaffAccount, updateOrg, updateStaffUser } from '../services/accounts.js';
import { cleanProviderInput, publicProvider } from '../routes/providers.js';
import { recordProviderChange } from '../services/providerChanges.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { tx } from '../db/database.js';
import { sendStoredPdf } from '../http/upload.js';
import { APPLICATION_STATES, type ApplicationState } from '../workflow/shamsWorkflow.js';
import { ORG_TYPES, ROLES, type OrgType, type Role } from '../domain.js';

interface KeyedRequest extends Request { integrationKey?: IntegrationKey }

export const integrationRouter = Router();
const LIMITED = { allowAdminAccounts: false };

async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const raw = (h?.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-api-key'] as string | undefined) ?? '').trim();
  const key = raw ? await findActiveKey(raw) : null;
  if (!key) {
    // M4: سطر تدقيق واحد لكل (IP، نافذة 10 دقائق) بدل سطر لكل طلب فاشل (السجل append-only).
    const ip = clientIp(req);
    if ((await countAuthFailure(ip)).first) {
      await addAuditLog({ actorType: 'anonymous', ip, action: 'integration.auth_failed', entityType: 'integration', entityId: req.path.slice(0, 100), summaryAr: 'محاولة وصول بمفتاح ربط غير صالح أو ملغى أو غير معتمد' });
    }
    return apiError(res, 401, 'INVALID_API_KEY', 'مفتاح الربط غير صالح أو ملغى.', 'Invalid or revoked API key.');
  }
  (req as KeyedRequest).integrationKey = key;
  await touchKey(key.id);
  next();
}

const perKeyLimiter = rateLimit({
  windowMs: 60_000,
  limit: (req: Request) => (req as KeyedRequest).integrationKey?.rateLimitPerMinute ?? 60,
  keyGenerator: (req: Request) => `ik:${(req as KeyedRequest).integrationKey?.id ?? 'none'}`,
  standardHeaders: true, legacyHeaders: false, message: rateLimitedBody(),
});

/** تدقيق كل طلب ربط (القراءة والكتابة) بعد انتهاء الرد. */
function auditRequest(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    // After the response: a failed audit insert is logged, never an unhandled rejection.
    addAuditLog({ ...actorFromReq(req), action: `integration.${req.method.toLowerCase()}`, entityType: 'integration', entityId: req.route?.path ? String(req.route.path) : req.path.slice(0, 100),
      summaryAr: `طلب ربط ${req.method} ${req.path.slice(0, 120)} → ${res.statusCode}` }).catch((e: unknown) => console.error('[audit] integration request audit failed:', (e as Error).message));
  });
  next();
}

function requireScope(scope: IntegrationScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = (req as KeyedRequest).integrationKey;
    const verdict = key ? keyAllows(key, scope) : 'missing';
    if (verdict === 'data_disabled') {
      return apiError(res, 403, 'DATA_SCOPES_DISABLED', 'نطاقات البيانات الكاملة معطلة بقرار المشروع (بيانات وصفية فقط).', 'Full-data integration scopes are disabled by project decision (metadata only).');
    }
    if (verdict !== 'ok') {
      return apiError(res, 403, 'INSUFFICIENT_SCOPE', `المفتاح لا يملك النطاق ${scope}.`, `The API key lacks the "${scope}" scope.`);
    }
    next();
  };
}

integrationRouter.use(ah(apiKeyAuth), perKeyLimiter, auditRequest);

// ── read — بيانات وصفية فقط (F-02): العرض من metadataView.ts بقائمة سماح صريحة ──
integrationRouter.get('/summary', requireScope('read'), ah(async (_req, res) => okMessage(res, 200, 'ok', await buildSummary(ALL_SCOPE))));

integrationRouter.get('/applications', requireScope('read'), ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const states = str(req.query.state).split(',').filter((s): s is ApplicationState => (APPLICATION_STATES as readonly string[]).includes(s));
  const { rows, total } = await listApplications({
    scopeSql: '1 = 1', scopeParams: [], includeDrafts: req.query.includeDrafts === '1', states: states.length ? states : undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined, governorate: str(req.query.governorate) || undefined,
    bankOrgId: str(req.query.bankOrgId) || undefined, q: str(req.query.q).slice(0, 100) || undefined, qNumberOnly: true,
  }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(await mapSeq(rows, (a) => metadataItem(a)), total, page, pageSize));
}));

integrationRouter.get('/applications/:id', requireScope('read'), ah(async (req, res) => {
  const app = await getApplication(req.params.id);
  if (!app) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return okMessage(res, 200, 'ok', await metadataDetail(app));
}));

integrationRouter.get('/applications/:id/documents/:docId', requireScope('read_documents'), ah(async (req, res) => {
  const app = await getApplication(req.params.id);
  const doc = app ? await getDocument(app.id, req.params.docId) : null;
  // المستندات المُرسلة فقط (لا يُكشف ما لم يرسله المصنع بعد).
  if (!app || !doc || !wasSubmitted(doc, app.attempt)) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  sendStoredPdf(res, doc.storedName, doc.originalName, false);
}));

// ── manage_users ──
integrationRouter.get('/organizations', requireScope('manage_users'), ah(async (req, res) => {
  const type = (ORG_TYPES as readonly string[]).includes(str(req.query.type)) ? (str(req.query.type) as OrgType) : undefined;
  return okMessage(res, 200, 'ok', { items: await listOrganizations({ type, includeFactories: type === 'factory' }) });
}));
integrationRouter.post('/organizations', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 201, 'created', await createOrg(actorFromReq(req), req.body))));
integrationRouter.put('/organizations/:id', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 200, 'updated', await updateOrg(actorFromReq(req), req.params.id, req.body, LIMITED))));

integrationRouter.get('/users', requireScope('manage_users'), ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const role = (ROLES as readonly string[]).includes(str(req.query.role)) ? (str(req.query.role) as Role) : undefined;
  const { rows, total } = await listUsers({ role, organizationId: str(req.query.organizationId) || undefined, excludeFactories: !role }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows.map(toPublicUser), total, page, pageSize));
}));
/** H2: لا يُنشئ حسابًا مباشرة — يسجل طلبًا تعتمده الجهة (لا يمكن إنشاء مدير نظام عبر الربط). */
integrationRouter.post('/users', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 202, 'account request created — awaiting organization approval', await requestStaffAccount(actorFromReq(req), req.body, LIMITED))));
integrationRouter.put('/users/:id', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 200, 'updated', await updateStaffUser(actorFromReq(req), req.params.id, req.body, LIMITED))));

// ── manage_providers ──
integrationRouter.get('/service-providers', requireScope('manage_providers'), ah(async (req, res) => {
  const status = ['pending', 'approved', 'suspended'].includes(str(req.query.status)) ? (str(req.query.status) as ProviderStatus) : undefined;
  return okMessage(res, 200, 'ok', { items: (await listProviders({ status })).map((p) => publicProvider(p, true)) });
}));
integrationRouter.post('/service-providers', requireScope('manage_providers'), ah(async (req, res) => {
  const p = await createProvider(cleanProviderInput(req.body, true) as ProviderInput & { nameAr: string }, null);
  await addAuditLog({ ...actorFromReq(req), action: 'provider.create', entityType: 'service_provider', entityId: p.id, summaryAr: `إضافة مقدم خدمة عبر الربط: ${p.nameAr}` });
  return okMessage(res, 201, 'created', publicProvider(p, true));
}));
/** M5: الربط لا يغيّر حالة الاعتماد/الإيقاف (قرار PMU فقط)؛ يعدّل البيانات الوصفية لمقدم الخدمة فقط. */
integrationRouter.put('/service-providers/:id', requireScope('manage_providers'), ah(async (req, res) => {
  const before = await getProvider(req.params.id);
  if (!before) throw Errors.notFound();
  const patch = cleanProviderInput(req.body, false);
  // F-04: نفس أثر تعديل ENCPC (فرق منظم + تنبيه PMU للمعتمد) والفاعل هو مفتاح الربط.
  const p = await tx(async () => {
    const after = (await updateProvider(before.id, patch))!;
    await recordProviderChange({ before, after, source: 'integration', actor: actorFromReq(req), action: 'provider.update', summaryAr: `تعديل مقدم خدمة عبر الربط: ${after.nameAr}` });
    return after;
  });
  kickNotificationWorker();
  return okMessage(res, 200, 'updated', publicProvider(p, true));
}));

// ── read_audit ──
integrationRouter.get('/audit-logs', requireScope('read_audit'), ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 100, 500);
  const { rows, total } = await listAuditLogs({
    action: str(req.query.action) || undefined, applicationId: str(req.query.applicationId) || undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
  }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows, total, page, pageSize));
}));

integrationRouter.use((req, res) => apiError(res, 404, 'NOT_FOUND', 'المسار غير موجود.', `Route not found: ${req.method} ${req.path}`));
