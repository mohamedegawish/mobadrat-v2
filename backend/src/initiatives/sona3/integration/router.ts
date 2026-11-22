/**
 * Integration API لأدمن المنصة الأصلية — /api/integration/v1 (موثق في contracts/integration.openapi.json).
 * مصادقة بمفتاح API (مخزن hash) بنطاقات، rate limit وتدقيق لكل مفتاح.
 * حد الصلاحيات: لا يوجد أي endpoint يتخذ قرارًا على الطلبات — القرار للجهة المسؤولة فقط.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ah, apiError, okMessage, Errors, rateLimitedBody } from '../http/errors.js';
import { clientIp, normPage, normPageSize, paginate, str, mapSeq } from '../http/helpers.js';
import { onlyKeys } from '../http/validate.js';
import { findActiveKey, touchKey, type IntegrationKey, type IntegrationScope } from '../store/integrationKeys.js';
import { addAuditLog, actorFromReq, listAuditLogs } from '../store/audit.js';
import { getApplication, listApplications } from '../store/applications.js';
import { getDocument } from '../store/documents.js';
import { listOrganizations } from '../store/organizations.js';
import { listUsers, toPublicUser, type UserInternal } from '../store/users.js';
import { createExpert, getExpert, listExperts, setExpertStatus, updateExpert, type ExpertInput, type ExpertStatus } from '../store/experts.js';
import { buildDetail, buildListItem } from '../workflow/applicationView.js';
import { buildSummary, ALL_SCOPE } from '../services/reports.js';
import { createOrg, createStaffUser, updateOrg, updateStaffUser } from '../services/accounts.js';
import { cleanExpertInput, publicExpert } from '../routes/experts.js';
import { sendStoredPdf } from '../http/upload.js';
import { APPLICATION_STATES, type ApplicationState } from '../workflow/workflow.js';
import { ORG_IDS, ORG_TYPES, ROLES, type OrgType, type Role } from '../domain.js';

interface KeyedRequest extends Request { integrationKey?: IntegrationKey }

export const integrationRouter = Router();
const LIMITED = { allowAdminAccounts: false };

/** مراقب قراءة فقط بصلاحيات العرض الكاملة (مثل الأدمن) — بلا أي إجراءات متاحة. */
const OBSERVER = {
  id: 'integration', organizationId: ORG_IDS.admin, role: 'system_admin', email: '', nameAr: 'Integration', nameEn: 'Integration', phone: '',
  passwordHash: '', isActive: true, mustChangePassword: false, emailVerifiedAt: null, failedLoginCount: 0, lockedUntil: null, lastLoginAt: null,
  createdAt: '', updatedAt: '', organizationType: 'admin', organizationNameAr: '', organizationNameEn: '', organizationActive: true,
} as unknown as UserInternal;

async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const raw = (h?.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-api-key'] as string | undefined) ?? '').trim();
  const key = raw ? await findActiveKey(raw) : null;
  if (!key) {
    await addAuditLog({ actorType: 'anonymous', ip: clientIp(req), action: 'integration.auth_failed', entityType: 'integration', entityId: req.path.slice(0, 100), summaryAr: 'محاولة وصول بمفتاح ربط غير صالح أو ملغى' });
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
  res.on('finish', async () => {
    await addAuditLog({ ...actorFromReq(req), action: `integration.${req.method.toLowerCase()}`, entityType: 'integration', entityId: req.route?.path ? String(req.route.path) : req.path.slice(0, 100),
      summaryAr: `طلب ربط ${req.method} ${req.path.slice(0, 120)} → ${res.statusCode}` });
  });
  next();
}

function requireScope(scope: IntegrationScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!(req as KeyedRequest).integrationKey?.scopes.includes(scope)) {
      return apiError(res, 403, 'INSUFFICIENT_SCOPE', `المفتاح لا يملك النطاق ${scope}.`, `The API key lacks the "${scope}" scope.`);
    }
    next();
  };
}

integrationRouter.use(apiKeyAuth, perKeyLimiter, auditRequest);

function stripActions<T extends Record<string, unknown>>(o: T) {
  const { allowedActions, editableFields, isMine, pendingAttempt, hasPendingDocuments, ...rest } = o as Record<string, unknown>;
  void allowedActions; void editableFields; void isMine; void pendingAttempt; void hasPendingDocuments;
  if (rest.currentTask && typeof rest.currentTask === 'object') {
    const { isMine: _m, ...task } = rest.currentTask as Record<string, unknown>;
    void _m;
    rest.currentTask = task;
  }
  return rest;
}

// ── read ──
integrationRouter.get('/summary', requireScope('read'), ah(async (_req, res) => okMessage(res, 200, 'ok', await buildSummary(ALL_SCOPE))));

integrationRouter.get('/applications', requireScope('read'), ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const states = str(req.query.state).split(',').filter((s): s is ApplicationState => (APPLICATION_STATES as readonly string[]).includes(s));
  const { rows, total } = await listApplications({
    scopeSql: '1 = 1', scopeParams: [], includeDrafts: req.query.includeDrafts === '1', states: states.length ? states : undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined, governorate: str(req.query.governorate) || undefined,
    funderOrgId: str(req.query.funderOrgId) || undefined, q: str(req.query.q).slice(0, 100) || undefined,
  }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(await mapSeq(rows, async (a) => stripActions(await buildListItem(OBSERVER, a))), total, page, pageSize));
}));

integrationRouter.get('/applications/:id', requireScope('read'), ah(async (req, res) => {
  const app = await getApplication(req.params.id);
  if (!app) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return okMessage(res, 200, 'ok', stripActions(await buildDetail(OBSERVER, app)));
}));

integrationRouter.get('/applications/:id/documents/:docId', requireScope('read_documents'), ah(async (req, res) => {
  const app = await getApplication(req.params.id);
  const doc = app ? await getDocument(app.id, req.params.docId) : null;
  // المستندات المُرسلة فقط (لا يُكشف ما لم يرسله المتقدم بعد).
  if (!app || !doc || doc.attempt > app.attempt) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  sendStoredPdf(res, doc.storedName, doc.originalName, false);
}));

// ── manage_users ──
integrationRouter.get('/organizations', requireScope('manage_users'), ah(async (req, res) => {
  const type = (ORG_TYPES as readonly string[]).includes(str(req.query.type)) ? (str(req.query.type) as OrgType) : undefined;
  return okMessage(res, 200, 'ok', { items: await listOrganizations({ type, includeApplicants: type === 'applicant' }) });
}));
integrationRouter.post('/organizations', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 201, 'created', await createOrg(actorFromReq(req), req.body))));
integrationRouter.put('/organizations/:id', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 200, 'updated', await updateOrg(actorFromReq(req), req.params.id, req.body, LIMITED))));

integrationRouter.get('/users', requireScope('manage_users'), ah(async (req, res) => {
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 50, 200);
  const role = (ROLES as readonly string[]).includes(str(req.query.role)) ? (str(req.query.role) as Role) : undefined;
  const { rows, total } = await listUsers({ role, organizationId: str(req.query.organizationId) || undefined, excludeApplicants: !role }, page, pageSize);
  return okMessage(res, 200, 'ok', paginate(rows.map(toPublicUser), total, page, pageSize));
}));
integrationRouter.post('/users', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 201, 'created', await createStaffUser(actorFromReq(req), req.body, LIMITED))));
integrationRouter.put('/users/:id', requireScope('manage_users'), ah(async (req, res) => okMessage(res, 200, 'updated', await updateStaffUser(actorFromReq(req), req.params.id, req.body, LIMITED))));

// ── manage_experts (دليل الخبراء) ──
integrationRouter.get('/experts', requireScope('manage_experts'), ah(async (req, res) => {
  const status = ['pending', 'approved', 'suspended'].includes(str(req.query.status)) ? (str(req.query.status) as ExpertStatus) : undefined;
  return okMessage(res, 200, 'ok', { items: (await listExperts({ status })).map((p) => publicExpert(p, true)) });
}));
integrationRouter.post('/experts', requireScope('manage_experts'), ah(async (req, res) => {
  const p = await createExpert(cleanExpertInput(req.body, true) as ExpertInput & { nameAr: string }, null);
  await addAuditLog({ ...actorFromReq(req), action: 'expert.create', entityType: 'expert', entityId: p.id, summaryAr: `إضافة خبير عبر الربط: ${p.nameAr}` });
  return okMessage(res, 201, 'created', publicExpert(p, true));
}));
integrationRouter.put('/experts/:id', requireScope('manage_experts'), ah(async (req, res) => {
  if (!await getExpert(req.params.id)) throw Errors.notFound();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { status, ...fields } = body;
  if (status !== undefined && !['pending', 'approved', 'suspended'].includes(String(status))) throw Errors.validation([{ field: 'status', issue: 'pending | approved | suspended' }]);
  if (Object.keys(fields).length) await updateExpert(req.params.id, cleanExpertInput(fields, false));
  else onlyKeys(fields, []);
  if (status !== undefined) await setExpertStatus(req.params.id, status as ExpertStatus, null);
  const p = (await getExpert(req.params.id))!;
  await addAuditLog({ ...actorFromReq(req), action: 'expert.update', entityType: 'expert', entityId: p.id, summaryAr: `تعديل خبير عبر الربط: ${p.nameAr}`, details: { status } });
  return okMessage(res, 200, 'updated', publicExpert(p, true));
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
