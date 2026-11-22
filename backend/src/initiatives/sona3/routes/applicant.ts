import { mapSeq } from '../http/helpers.js';
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { Checker, onlyKeys } from '../http/validate.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getApplicantByOrg, renameApplicant } from '../store/applicants.js';
import { findOpenApplicationForApplicant, listApplicantApplications } from '../store/applications.js';
import { openCohort } from '../store/cohorts.js';
import { toPublicUser } from '../store/users.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { buildListItem } from '../workflow/applicationView.js';
import { policy } from '../config/initiativePolicy.js';

export const applicantRouter = Router();
applicantRouter.use('/applicant', requireRole('applicant'));

/** ملف المتقدم + طلباته (الحالي والسابقة) + الدورة المفتوحة — «صفحتي». */
applicantRouter.get('/applicant/profile', ah(async (req, res) => {
  const user = currentUser(req);
  const applicant = await getApplicantByOrg(user.organizationId);
  if (!applicant) throw Errors.notFound('ملف المتقدم غير موجود.', 'Applicant profile not found.');
  const apps = await listApplicantApplications(applicant.id);
  const open = await findOpenApplicationForApplicant(applicant.id);
  const cohort = await openCohort();
  return okMessage(res, 200, 'ok', {
    applicant: { id: applicant.id, fullName: applicant.fullName, createdAt: applicant.createdAt },
    user: toPublicUser(user),
    applications: await mapSeq(apps, async (a) => await buildListItem(user, a)),
    openApplicationId: open?.id ?? null,
    openCohort: cohort ? { id: cohort.id, nameAr: cohort.nameAr, nameEn: cohort.nameEn, opensAt: cohort.opensAt, closesAt: cohort.closesAt, maxAge: cohort.maxAge } : null,
    canStartNew: Boolean(cohort) && !open && (apps.length === 0 || policy.allowReapplyAfterTerminal),
  });
}));

applicantRouter.put('/applicant/profile', ah(async (req, res) => {
  const user = currentUser(req);
  const applicant = await getApplicantByOrg(user.organizationId);
  if (!applicant) throw Errors.notFound();
  const b = onlyKeys(req.body, ['fullName']);
  const c = new Checker();
  const fullName = c.text(b, 'fullName', { required: true, min: 2, max: 200 });
  c.throwIfAny();
  await renameApplicant(applicant.id, fullName!);
  await addAuditLog({ ...actorFromReq(req), action: 'applicant.update', entityType: 'applicant', entityId: applicant.id, summaryAr: 'تعديل اسم المتقدم' });
  return okMessage(res, 200, 'تم الحفظ.', { id: applicant.id, fullName });
}));
