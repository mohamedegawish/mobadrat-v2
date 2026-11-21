import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { makeLimiter, byUser } from '../http/rateLimits.js';
import { clientIp, normPage, normPageSize, paginate, str, mapSeq } from '../http/helpers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getApplication, listApplications } from '../store/applications.js';
import { getDocument, listDocuments } from '../store/documents.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { canSeeApplication, listScope, visibleDocuments } from '../access/visibility.js';
import { adminMetadataOnly, buildDetail, buildListItem, listFlags, preloadListOrgs } from '../workflow/applicationView.js';
import { performAction } from '../workflow/actionService.js';
import { createDraft, removeDocument, saveSection, uploadDocument } from '../workflow/applicationService.js';
import { singlePdfUpload, sendStoredPdf } from '../http/upload.js';
import { APPLICATION_STATES, NON_TERMINAL_STATES, type ApplicationState } from '../workflow/shamsWorkflow.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';

export const applicationsRouter = Router();

/** عدد المسودات غير المُرسلة (يُعرض منفصلًا عن قائمة العمل لـ PMU والأدمن). */
async function draftsCount(user: ReturnType<typeof currentUser>, scope: ReturnType<typeof listScope>): Promise<number | undefined> {
  if (user.role !== 'pmu_reviewer' && user.role !== 'system_admin') return undefined;
  return (await listApplications({ scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: true, states: ['DRAFT'] }, 1, 1)).total;
}

const actionLimiter = makeLimiter('actions', { keyGenerator: byUser });
const uploadLimiter = makeLimiter('upload', { keyGenerator: byUser });
const registryLimiter = makeLimiter('registryCheck', {
  keyGenerator: byUser, skip: (req) => !['submit', 'resubmit'].includes(String(req.params.action)),
}, 'محاولات تحقق كثيرة من السجل الصناعي — انتظر قليلًا.', 'Too many registry verification attempts, please wait.');

function parseStates(raw: unknown): ApplicationState[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter((s): s is ApplicationState => (APPLICATION_STATES as readonly string[]).includes(s));
  return list.length ? list : undefined;
}

applicationsRouter.get('/applications', ah(async (req, res) => {
  const user = currentUser(req);
  const scope = listScope(user);
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 20, 100);
  const states = parseStates(req.query.state);
  const mine = req.query.mine === '1';
  const flagged = req.query.overdue === '1' || mine;
  // PA-04: "awaiting me" and "overdue" can only be true for a non-terminal application, so those lists load just those rows
  // (the requested states, if any, narrowed to them) instead of every application in scope. Same rows, order and totals.
  const loadStates = flagged ? (states ?? APPLICATION_STATES).filter((s) => NON_TERMINAL_STATES.includes(s)) : states;
  if (flagged && loadStates!.length === 0) return okMessage(res, 200, 'ok', { ...paginate([], 0, page, pageSize), draftsCount: await draftsCount(user, scope) });
  // M5: المسودات غير المُرسلة لا تظهر في قوائم عمل PMU والأدمن إلا بطلب صريح (state=DRAFT)، وتبقى في عدّ منفصل.
  const includeDrafts = scope.includeDrafts && (user.role === 'factory_owner' || Boolean(states?.includes('DRAFT')));
  const { rows, total } = await listApplications({
    scopeSql: scope.sql, scopeParams: scope.params, includeDrafts,
    q: str(req.query.q).slice(0, 100) || undefined, states: loadStates,
    oldestFirst: mine || str(req.query.sort) === 'oldest',
    governorate: str(req.query.governorate) || undefined, bankOrgId: str(req.query.bankOrgId) || undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
  }, page, pageSize, flagged);
  // التأخر و«بانتظاري» محسوبان (لا أعمدة) — يُفلتر بعد الحساب ثم يُقسَّم لصفحات.
  // PERF-3: the filter needs only listFlags (the same values buildListItem puts in isMine/overdue), so the full list item —
  // with its organization lookups — is built for the requested page only, not for every row in scope (was 750 org queries
  // and ~350 ms of CPU per IMC request with ?mine=1). The page's organizations are loaded in one query.
  if (flagged) {
    const flags = await mapSeq(rows, (a) => listFlags(user, a));
    const selected = rows.filter((_, i) => (req.query.overdue !== '1' || flags[i].overdue) && (req.query.mine !== '1' || flags[i].isMine));
    const pageRows = selected.slice((page - 1) * pageSize, page * pageSize);
    const orgs = await preloadListOrgs(pageRows);
    const items = await mapSeq(pageRows, (a) => buildListItem(user, a, orgs));
    return okMessage(res, 200, 'ok', { ...paginate(items, selected.length, page, pageSize), draftsCount: await draftsCount(user, scope) });
  }
  const orgs = await preloadListOrgs(rows);
  const items = await mapSeq(rows, (a) => buildListItem(user, a, orgs));
  return okMessage(res, 200, 'ok', { ...paginate(items, total, page, pageSize), draftsCount: await draftsCount(user, scope) });
}));

applicationsRouter.post('/applications', requireRole('factory_owner'), ah(async (req, res) => {
  const app = await createDraft(currentUser(req), clientIp(req));
  return okMessage(res, 201, 'تم إنشاء مسودة الطلب.', await buildDetail(currentUser(req), app));
}));

applicationsRouter.get('/applications/:id', ah(async (req, res) => {
  const user = currentUser(req);
  const app = await getApplication(req.params.id);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return okMessage(res, 200, 'ok', await buildDetail(user, app));
}));

applicationsRouter.put('/applications/:id/data/:section', requireRole('factory_owner'), ah(async (req, res) => {
  const user = currentUser(req);
  const data = await saveSection(user, req.params.id, req.params.section, req.body, clientIp(req));
  return okMessage(res, 200, 'تم الحفظ.', { section: req.params.section, data });
}));

applicationsRouter.post('/applications/:id/documents', requireRole('factory_owner'), uploadLimiter, singlePdfUpload, ah(async (req, res) => {
  const user = currentUser(req);
  const doc = await uploadDocument(user, req.params.id, (req.body as Record<string, unknown>)?.kind, req.file, clientIp(req));
  return okMessage(res, 201, 'تم رفع المستند.', {
    id: doc.id, kind: doc.kind, version: doc.version, attempt: doc.attempt, originalName: doc.originalName, sizeBytes: doc.sizeBytes, sha256: doc.sha256, createdAt: doc.createdAt,
  });
}));

applicationsRouter.delete('/applications/:id/documents/:docId', requireRole('factory_owner'), ah(async (req, res) => {
  await removeDocument(currentUser(req), req.params.id, req.params.docId, clientIp(req));
  return okMessage(res, 200, 'تمت إزالة المستند من المحاولة القادمة.');
}));

applicationsRouter.get('/applications/:id/documents/:docId/download', ah(async (req, res) => {
  const user = currentUser(req);
  const app = await getApplication(req.params.id);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  const doc = await getDocument(app.id, req.params.docId);
  // نفس قاعدة الرؤية في القراءة: المستند غير المسموح = غير موجود. الأدمن: بيانات وصفية فقط (shamsPolicy).
  if (!doc || adminMetadataOnly(user) || !visibleDocuments(user, app, await listDocuments(app.id)).some((d) => d.id === doc.id)) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  await addAuditLog({ ...actorFromReq(req), action: 'document.download', entityType: 'document', entityId: doc.id, applicationId: app.id, summaryAr: `تنزيل مستند (${doc.kind}) نسخة ${doc.version}` });
  sendStoredPdf(res, doc.storedName, doc.originalName, req.query.inline === '1');
}));

applicationsRouter.post('/applications/:id/actions/:action', actionLimiter, registryLimiter, ah(async (req, res) => {
  const user = currentUser(req);
  try {
    const app = await performAction(user, req.params.id, req.params.action, req.body, { ip: clientIp(req) });
    return okMessage(res, 200, 'تم تنفيذ الإجراء.', await buildDetail(user, app));
  } finally {
    // فشل التحقق من السجل يُدخل إشعارًا قبل رد 422 — أيقظ العامل في الحالتين.
    kickNotificationWorker();
  }
}));
