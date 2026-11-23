import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { makeLimiter, byUser } from '../http/rateLimits.js';
import { clientIp, normPage, normPageSize, str } from '../http/helpers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getApplication } from '../store/applications.js';
import { getDocument, listDocuments } from '../store/documents.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { canSeeApplication, visibleDocuments } from '../access/visibility.js';
import { adminMetadataOnly, buildDetail } from '../workflow/applicationView.js';
import { performAction } from '../workflow/actionService.js';
import { createDraft, removeDocument, saveSection, uploadDocument } from '../workflow/applicationService.js';
import { singlePdfUpload, sendStoredPdf } from '../http/upload.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { listForUser, parseStates } from '../services/applicationList.js';

export const applicationsRouter = Router();

const actionLimiter = makeLimiter('actions', { keyGenerator: byUser });
const uploadLimiter = makeLimiter('upload', { keyGenerator: byUser });
const registryLimiter = makeLimiter('registryCheck', {
  keyGenerator: byUser, skip: (req) => !['submit', 'resubmit'].includes(String(req.params.action)),
}, 'محاولات تحقق كثيرة من السجل الصناعي — انتظر قليلًا.', 'Too many registry verification attempts, please wait.');

applicationsRouter.get('/applications', ah(async (req, res) => {
  return okMessage(res, 200, 'ok', await listForUser(currentUser(req), {
    page: normPage(req.query.page), pageSize: normPageSize(req.query.pageSize, 20, 100), states: parseStates(req.query.state),
    mine: req.query.mine === '1', overdue: req.query.overdue === '1', sort: str(req.query.sort),
    q: str(req.query.q).slice(0, 100) || undefined,
    governorate: str(req.query.governorate) || undefined, bankOrgId: str(req.query.bankOrgId) || undefined,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined,
  }));
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
