import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { makeLimiter, byUser } from '../http/rateLimits.js';
import { clientIp, normPage, normPageSize, str, mapSeq } from '../http/helpers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getApplication, cohortRanking } from '../store/applications.js';
import { getDocument, listDocuments } from '../store/documents.js';
import { getCohort } from '../store/cohorts.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { canSeeApplication, visibleDocuments } from '../access/visibility.js';
import { adminMetadataOnly, buildDetail, buildListItem } from '../workflow/applicationView.js';
import { performAction } from '../workflow/actionService.js';
import { createDraft, removeDocument, saveSection, uploadDocument, uploadStaffDocument } from '../workflow/applicationService.js';
import { assignEvaluator, unassignEvaluator, declareConflict, saveEvaluation, submitEvaluation, evaluatorQueue } from '../workflow/evaluationService.js';
import { reportMilestoneDone, reviewMilestoneDone, disburse, submitImpactReport, markStalled, fileAppeal, decideAppealOn } from '../workflow/lifecycleService.js';
import { singlePdfUpload, sendStoredPdf } from '../http/upload.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { ORG_IDS } from '../domain.js';
import { listForUser, parseStates } from '../services/applicationList.js';

export const applicationsRouter = Router();

const actionLimiter = makeLimiter('actions', { keyGenerator: byUser });
const uploadLimiter = makeLimiter('upload', { keyGenerator: byUser });

/** يوقظ عامل الإشعارات بعد أي عملية تكتب في outbox. */
function kicked<T>(fn: () => T): T {
  try { return fn(); } finally { kickNotificationWorker(); }
}

applicationsRouter.get('/applications', ah(async (req, res) => {
  return okMessage(res, 200, 'ok', await listForUser(currentUser(req), {
    page: normPage(req.query.page), pageSize: normPageSize(req.query.pageSize, 20, 100), states: parseStates(req.query.state),
    mine: req.query.mine === '1', overdue: req.query.overdue === '1', sort: str(req.query.sort),
    q: str(req.query.q).slice(0, 100) || undefined,
    cohortId: str(req.query.cohortId) || undefined, sector: str(req.query.sector) || undefined,
    governorate: str(req.query.governorate) || undefined, funderOrgId: str(req.query.funderOrgId) || undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
  }));
}));

/** ترتيب الدورة للاختيار (المرحلة 05) — IMC فقط. */
applicationsRouter.get('/cohorts/:id/ranking', requireRole('imc_officer'), ah(async (req, res) => {
  const user = currentUser(req);
  const cohort = await getCohort(req.params.id);
  if (!cohort) throw Errors.notFound();
  const rows = await cohortRanking(cohort.id, ['EVALUATED', 'SELECTED', 'FUNDING_SEARCH', 'FUNDER_REVIEW', 'IMPLEMENTATION', 'OPERATING', 'COMPLETED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED']);
  const selected = rows.filter((a) => !['EVALUATED', 'NOT_SELECTED'].includes(a.state)).length;
  return okMessage(res, 200, 'ok', {
    cohort: { id: cohort.id, nameAr: cohort.nameAr, selectionTarget: cohort.selectionTarget, evaluationTarget: cohort.evaluationTarget, minTotalScore: cohort.minTotalScore },
    selected, items: await mapSeq(rows, async (a, i) => ({ rank: i + 1, ...await buildListItem(user, a) })),
  });
}));

applicationsRouter.get('/evaluations/mine', requireRole('evaluator'), ah(async (req, res) => okMessage(res, 200, 'ok', { items: await evaluatorQueue(currentUser(req)) })));

applicationsRouter.post('/applications', requireRole('applicant'), ah(async (req, res) => {
  const app = await createDraft(currentUser(req), clientIp(req));
  return okMessage(res, 201, 'تم إنشاء مسودة الطلب.', await buildDetail(currentUser(req), app));
}));

applicationsRouter.get('/applications/:id', ah(async (req, res) => {
  const user = currentUser(req);
  const app = await getApplication(req.params.id);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  return okMessage(res, 200, 'ok', await buildDetail(user, app));
}));

applicationsRouter.put('/applications/:id/data/:section', requireRole('applicant'), ah(async (req, res) => {
  const user = currentUser(req);
  const data = await saveSection(user, req.params.id, req.params.section, req.body, clientIp(req));
  return okMessage(res, 200, 'تم الحفظ.', { section: req.params.section, data });
}));

applicationsRouter.post('/applications/:id/documents', uploadLimiter, singlePdfUpload, ah(async (req, res) => {
  const user = currentUser(req);
  const kind = (req.body as Record<string, unknown>)?.kind;
  const doc = user.role === 'applicant'
    ? await uploadDocument(user, req.params.id, kind, req.file, clientIp(req))
    : await uploadStaffDocument(user, req.params.id, kind, req.file, clientIp(req));
  return okMessage(res, 201, 'تم رفع المستند.', {
    id: doc.id, kind: doc.kind, version: doc.version, attempt: doc.attempt, originalName: doc.originalName, sizeBytes: doc.sizeBytes, sha256: doc.sha256, createdAt: doc.createdAt,
  });
}));

applicationsRouter.delete('/applications/:id/documents/:docId', requireRole('applicant'), ah(async (req, res) => {
  await removeDocument(currentUser(req), req.params.id, req.params.docId, clientIp(req));
  return okMessage(res, 200, 'تمت إزالة المستند من المحاولة القادمة.');
}));

applicationsRouter.get('/applications/:id/documents/:docId/download', ah(async (req, res) => {
  const user = currentUser(req);
  const app = await getApplication(req.params.id);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  const doc = await getDocument(app.id, req.params.docId);
  if (!doc || adminMetadataOnly(user) || !(await visibleDocuments(user, app, await listDocuments(app.id))).some((d) => d.id === doc.id)) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  await addAuditLog({ ...actorFromReq(req), action: 'document.download', entityType: 'document', entityId: doc.id, applicationId: app.id, summaryAr: `تنزيل مستند (${doc.kind}) نسخة ${doc.version}` });
  sendStoredPdf(res, doc.storedName, doc.originalName, req.query.inline === '1');
}));

applicationsRouter.post('/applications/:id/actions/:action', actionLimiter, ah(async (req, res) => {
  const user = currentUser(req);
  const app = await kicked(async () => await performAction(user, req.params.id, req.params.action, req.body, { ip: clientIp(req) }));
  return okMessage(res, 200, 'تم تنفيذ الإجراء.', await buildDetail(user, app));
}));

// ── التقييم (المرحلة 04) ──
applicationsRouter.post('/applications/:id/evaluators', requireRole('imc_officer'), ah(async (req, res) => {
  const user = currentUser(req);
  await kicked(async () => await assignEvaluator(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 201, 'تم إسناد المقيّم.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.delete('/applications/:id/evaluators/:assignmentId', requireRole('imc_officer'), ah(async (req, res) => {
  const user = currentUser(req);
  await unassignEvaluator(user, req.params.id, req.params.assignmentId, req.body, clientIp(req));
  return okMessage(res, 200, 'تم إلغاء الإسناد.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.post('/applications/:id/evaluation/coi', requireRole('evaluator'), ah(async (req, res) => {
  const user = currentUser(req);
  await kicked(async () => await declareConflict(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل الإقرار.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.put('/applications/:id/evaluation', requireRole('evaluator'), ah(async (req, res) => {
  const user = currentUser(req);
  await saveEvaluation(user, req.params.id, req.body, clientIp(req));
  return okMessage(res, 200, 'تم الحفظ.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.post('/applications/:id/evaluation/submit', requireRole('evaluator'), ah(async (req, res) => {
  const user = currentUser(req);
  await kicked(async () => await submitEvaluation(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسليم التقييم.', await buildDetail(user, (await getApplication(req.params.id))!));
}));

// ── التنفيذ والمتابعة (07–08) ──
applicationsRouter.post('/applications/:id/milestones/:mid/report', requireRole('applicant'), uploadLimiter, singlePdfUpload, ah(async (req, res) => {
  const user = currentUser(req);
  await kicked(async () => await reportMilestoneDone(user, req.params.id, req.params.mid, (req.body as Record<string, unknown>)?.note, req.file, clientIp(req)));
  return okMessage(res, 200, 'تم الإبلاغ عن إنجاز المرحلة.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.post('/applications/:id/milestones/:mid/review', requireRole('imc_officer'), ah(async (req, res) => {
  const user = currentUser(req);
  await kicked(async () => await reviewMilestoneDone(user, req.params.id, req.params.mid, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل نتيجة التحقق.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.post('/applications/:id/milestones/:mid/disburse', requireRole('funder_reviewer'), ah(async (req, res) => {
  const user = currentUser(req);
  await kicked(async () => await disburse(user, req.params.id, req.params.mid, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل الصرف.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.post('/applications/:id/impact-reports', requireRole('applicant'), ah(async (req, res) => {
  const user = currentUser(req);
  await submitImpactReport(user, req.params.id, req.body, clientIp(req));
  return okMessage(res, 201, 'تم إرسال تقرير الأثر.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.post('/applications/:id/stalled', requireRole('imc_officer'), ah(async (req, res) => {
  const user = currentUser(req);
  const app = await markStalled(user, req.params.id, req.body, clientIp(req));
  return okMessage(res, 200, 'تم التحديث.', await buildDetail(user, app));
}));

// ── التظلمات ──
applicationsRouter.post('/applications/:id/appeal', requireRole('applicant'), ah(async (req, res) => {
  const user = currentUser(req);
  await kicked(async () => await fileAppeal(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 201, 'تم تقديم التظلم.', await buildDetail(user, (await getApplication(req.params.id))!));
}));
applicationsRouter.post('/applications/:id/appeal/decision', requireRole('imc_officer'), ah(async (req, res) => {
  const user = currentUser(req);
  if (user.organizationId !== ORG_IDS.imc) throw Errors.forbidden();
  const app = await kicked(async () => await decideAppealOn(user, req.params.id, req.body, clientIp(req)));
  return okMessage(res, 200, 'تم تسجيل قرار التظلم.', await buildDetail(user, app));
}));
