import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { makeLimiter, byUser } from '../http/rateLimits.js';
import { clientIp, normPage, normPageSize, paginate, str } from '../http/helpers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getApplication, listApplications, cohortRanking } from '../store/applications.js';
import { getDocument, listDocuments } from '../store/documents.js';
import { getCohort } from '../store/cohorts.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { canSeeApplication, listScope, visibleDocuments } from '../access/visibility.js';
import { adminMetadataOnly, buildDetail, buildListItem } from '../workflow/applicationView.js';
import { performAction } from '../workflow/actionService.js';
import { createDraft, removeDocument, saveSection, uploadDocument, uploadStaffDocument } from '../workflow/applicationService.js';
import { assignEvaluator, unassignEvaluator, declareConflict, saveEvaluation, submitEvaluation, evaluatorQueue } from '../workflow/evaluationService.js';
import { reportMilestoneDone, reviewMilestoneDone, disburse, submitImpactReport, markStalled, fileAppeal, decideAppealOn } from '../workflow/lifecycleService.js';
import { singlePdfUpload, sendStoredPdf } from '../http/upload.js';
import { APPLICATION_STATES, type ApplicationState } from '../workflow/workflow.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { ORG_IDS } from '../domain.js';

export const applicationsRouter = Router();

/** عدد المسودات غير المُرسلة (يُعرض منفصلًا عن قائمة العمل لـ IMC والأدمن). */
function draftsCount(user: ReturnType<typeof currentUser>, scope: ReturnType<typeof listScope>): number | undefined {
  if (user.role !== 'imc_officer' && user.role !== 'system_admin') return undefined;
  return listApplications({ scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: true, states: ['DRAFT'] }, 1, 1).total;
}

const actionLimiter = makeLimiter('actions', { keyGenerator: byUser });
const uploadLimiter = makeLimiter('upload', { keyGenerator: byUser });

function parseStates(raw: unknown): ApplicationState[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter((s): s is ApplicationState => (APPLICATION_STATES as readonly string[]).includes(s));
  return list.length ? list : undefined;
}

/** يوقظ عامل الإشعارات بعد أي عملية تكتب في outbox. */
function kicked<T>(fn: () => T): T {
  try { return fn(); } finally { kickNotificationWorker(); }
}

applicationsRouter.get('/applications', ah((req, res) => {
  const user = currentUser(req);
  const scope = listScope(user);
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 20, 100);
  const states = parseStates(req.query.state);
  const mine = req.query.mine === '1';
  // المسودات غير المُرسلة لا تظهر في قوائم IMC والأدمن إلا بطلب صريح (state=DRAFT).
  const includeDrafts = scope.includeDrafts && (user.role === 'applicant' || Boolean(states?.includes('DRAFT')));
  const computed = req.query.overdue === '1' || mine;
  const { rows, total } = listApplications({
    scopeSql: scope.sql, scopeParams: scope.params, includeDrafts,
    q: str(req.query.q).slice(0, 100) || undefined, states, oldestFirst: mine, byScore: req.query.sort === 'score',
    cohortId: str(req.query.cohortId) || undefined, sector: str(req.query.sector) || undefined,
    governorate: str(req.query.governorate) || undefined, funderOrgId: str(req.query.funderOrgId) || undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
  }, page, pageSize, computed);
  let items = rows.map((a) => buildListItem(user, a));
  if (computed) {
    if (req.query.overdue === '1') items = items.filter((i) => i.overdue);
    if (mine) items = items.filter((i) => i.isMine);
    const t = items.length;
    items = items.slice((page - 1) * pageSize, page * pageSize);
    return okMessage(res, 200, 'ok', { ...paginate(items, t, page, pageSize), draftsCount: draftsCount(user, scope) });
  }
  return okMessage(res, 200, 'ok', { ...paginate(items, total, page, pageSize), draftsCount: draftsCount(user, scope) });
}));

/** ترتيب الدورة للاختيار (المرحلة 05) — IMC فقط. */
applicationsRouter.get('/cohorts/:id/ranking', requireRole('imc_officer'), ah((req, res) => {
  const user = currentUser(req);
  const cohort = getCohort(req.params.id);
  if (!cohort) throw Errors.notFound();
  const rows = cohortRanking(cohort.id, ['EVALUATED', 'SELECTED', 'FUNDING_SEARCH', 'FUNDER_REVIEW', 'IMPLEMENTATION', 'OPERATING', 'COMPLETED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED']);
  const selected = rows.filter((a) => !['EVALUATED', 'NOT_SELECTED'].includes(a.state)).length;
  return okMessage(res, 200, 'ok', {
    cohort: { id: cohort.id, nameAr: cohort.nameAr, selectionTarget: cohort.selectionTarget, evaluationTarget: cohort.evaluationTarget, minTotalScore: cohort.minTotalScore },
    selected, items: rows.map((a, i) => ({ rank: i + 1, ...buildListItem(user, a) })),
  });
}));

applicationsRouter.get('/evaluations/mine', requireRole('evaluator'), ah((req, res) => okMessage(res, 200, 'ok', { items: evaluatorQueue(currentUser(req)) })));

applicationsRouter.post('/applications', requireRole('applicant'), ah((req, res) => {
  const app = createDraft(currentUser(req), clientIp(req));
  return okMessage(res, 201, 'تم إنشاء مسودة الطلب.', buildDetail(currentUser(req), app));
}));

applicationsRouter.get('/applications/:id', ah((req, res) => {
  const user = currentUser(req);
  const app = getApplication(req.params.id);
  if (!app || !canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return okMessage(res, 200, 'ok', buildDetail(user, app));
}));

applicationsRouter.put('/applications/:id/data/:section', requireRole('applicant'), ah((req, res) => {
  const user = currentUser(req);
  const data = saveSection(user, req.params.id, req.params.section, req.body, clientIp(req));
  return okMessage(res, 200, 'تم الحفظ.', { section: req.params.section, data });
}));

applicationsRouter.post('/applications/:id/documents', uploadLimiter, singlePdfUpload, ah((req, res) => {
  const user = currentUser(req);
  const kind = (req.body as Record<string, unknown>)?.kind;
  const doc = user.role === 'applicant'
    ? uploadDocument(user, req.params.id, kind, req.file, clientIp(req))
    : uploadStaffDocument(user, req.params.id, kind, req.file, clientIp(req));
  return okMessage(res, 201, 'تم رفع المستند.', {
    id: doc.id, kind: doc.kind, version: doc.version, attempt: doc.attempt, originalName: doc.originalName, sizeBytes: doc.sizeBytes, sha256: doc.sha256, createdAt: doc.createdAt,
  });
}));

applicationsRouter.delete('/applications/:id/documents/:docId', requireRole('applicant'), ah((req, res) => {
  removeDocument(currentUser(req), req.params.id, req.params.docId, clientIp(req));
  return okMessage(res, 200, 'تمت إزالة المستند من المحاولة القادمة.');
}));

applicationsRouter.get('/applications/:id/documents/:docId/download', ah((req, res) => {
  const user = currentUser(req);
  const app = getApplication(req.params.id);
  if (!app || !canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  const doc = getDocument(app.id, req.params.docId);
  if (!doc || adminMetadataOnly(user) || !visibleDocuments(user, app, listDocuments(app.id)).some((d) => d.id === doc.id)) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  addAuditLog({ ...actorFromReq(req), action: 'document.download', entityType: 'document', entityId: doc.id, applicationId: app.id, summaryAr: `تنزيل مستند (${doc.kind}) نسخة ${doc.version}` });
  sendStoredPdf(res, doc.storedName, doc.originalName, req.query.inline === '1');
}));

applicationsRouter.post('/applications/:id/actions/:action', actionLimiter, ah((req, res) => {
  const user = currentUser(req);
  const app = kicked(() => performAction(user, req.params.id, req.params.action, req.body, { ip: clientIp(req) }));
  return okMessage(res, 200, 'تم تنفيذ الإجراء.', buildDetail(user, app));
}));

// ── التقييم (المرحلة 04) ──
applicationsRouter.post('/applications/:id/evaluators', requireRole('imc_officer'), ah((req, res) => {
  const user = currentUser(req);
  kicked(() => assignEvaluator(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 201, 'تم إسناد المقيّم.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.delete('/applications/:id/evaluators/:assignmentId', requireRole('imc_officer'), ah((req, res) => {
  const user = currentUser(req);
  unassignEvaluator(user, req.params.id, req.params.assignmentId, req.body, clientIp(req));
  return okMessage(res, 200, 'تم إلغاء الإسناد.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.post('/applications/:id/evaluation/coi', requireRole('evaluator'), ah((req, res) => {
  const user = currentUser(req);
  kicked(() => declareConflict(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل الإقرار.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.put('/applications/:id/evaluation', requireRole('evaluator'), ah((req, res) => {
  const user = currentUser(req);
  saveEvaluation(user, req.params.id, req.body, clientIp(req));
  return okMessage(res, 200, 'تم الحفظ.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.post('/applications/:id/evaluation/submit', requireRole('evaluator'), ah((req, res) => {
  const user = currentUser(req);
  kicked(() => submitEvaluation(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسليم التقييم.', buildDetail(user, getApplication(req.params.id)!));
}));

// ── التنفيذ والمتابعة (07–08) ──
applicationsRouter.post('/applications/:id/milestones/:mid/report', requireRole('applicant'), uploadLimiter, singlePdfUpload, ah((req, res) => {
  const user = currentUser(req);
  kicked(() => reportMilestoneDone(user, req.params.id, req.params.mid, (req.body as Record<string, unknown>)?.note, req.file, clientIp(req)));
  return okMessage(res, 200, 'تم الإبلاغ عن إنجاز المرحلة.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.post('/applications/:id/milestones/:mid/review', requireRole('imc_officer'), ah((req, res) => {
  const user = currentUser(req);
  kicked(() => reviewMilestoneDone(user, req.params.id, req.params.mid, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل نتيجة التحقق.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.post('/applications/:id/milestones/:mid/disburse', requireRole('funder_reviewer'), ah((req, res) => {
  const user = currentUser(req);
  kicked(() => disburse(user, req.params.id, req.params.mid, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل الصرف.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.post('/applications/:id/impact-reports', requireRole('applicant'), ah((req, res) => {
  const user = currentUser(req);
  submitImpactReport(user, req.params.id, req.body, clientIp(req));
  return okMessage(res, 201, 'تم إرسال تقرير الأثر.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.post('/applications/:id/stalled', requireRole('imc_officer'), ah((req, res) => {
  const user = currentUser(req);
  const app = markStalled(user, req.params.id, req.body, clientIp(req));
  return okMessage(res, 200, 'تم التحديث.', buildDetail(user, app));
}));

// ── التظلمات ──
applicationsRouter.post('/applications/:id/appeal', requireRole('applicant'), ah((req, res) => {
  const user = currentUser(req);
  kicked(() => fileAppeal(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 201, 'تم تقديم التظلم.', buildDetail(user, getApplication(req.params.id)!));
}));
applicationsRouter.post('/applications/:id/appeal/decision', requireRole('imc_officer'), ah((req, res) => {
  const user = currentUser(req);
  if (user.organizationId !== ORG_IDS.imc) throw Errors.forbidden();
  const app = kicked(() => decideAppealOn(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل قرار التظلم.', buildDetail(user, app));
}));
