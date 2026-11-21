/** إنشاء المسودة، والحفظ التلقائي للاستمارة والدراسة، وتعديل حقول النواقص فقط، ورفع/إزالة المستندات. */
import { tx } from '../db/sqlite.js';
import { AppError, Errors } from '../http/errors.js';
import type { UserInternal } from '../store/users.js';
import {
  createDraftApplication, findOpenApplicationForApplicant, getApplication, getSection, writeSection, openDeficiencies, setApplicationColumns, type AppRow,
} from '../store/applications.js';
import { addDocumentVersion, activeDocsAt, getDocument, removeDocumentAt, type DocumentRow } from '../store/documents.js';
import { getApplicantByOrg } from '../store/applicants.js';
import { openCohort } from '../store/cohorts.js';
import { getExpert } from '../store/experts.js';
import { addAuditLog } from '../store/audit.js';
import { canSeeApplication, isApplicantOf } from '../access/visibility.js';
import { acceptPdf, discardUpload } from '../http/upload.js';
import { ORG_IDS } from '../domain.js';
import { CORRECTION_STATES, type ApplicationState } from './workflow.js';
import {
  FORM_SECTIONS, FIELD_BY_KEY, DOCUMENT_KINDS, MULTI_DOCUMENT_KINDS, documentKindsOfForm, fieldForDocKind, formOfSection,
  type FormKind, type FormSection, type DocumentKind,
} from './applicationForm.js';
import { cleanSectionPatch } from './validate.js';

function loadOwned(user: UserInternal, appId: string): AppRow {
  const app = getApplication(appId);
  if (!app || !canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  if (!isApplicantOf(user, app)) throw Errors.forbidden();
  return app;
}

function notEditable(): AppError {
  return Errors.conflict('INVALID_STATE', 'لا يمكن تعديل الطلب في مرحلته الحالية.', 'The application cannot be edited in its current state.');
}

export function createDraft(user: UserInternal, ip: string): AppRow {
  if (user.role !== 'applicant') throw Errors.forbidden();
  const applicant = getApplicantByOrg(user.organizationId);
  if (!applicant) throw Errors.notFound('ملف المتقدم غير موجود.', 'Applicant profile not found.');
  const cohort = openCohort();
  if (!cohort) {
    throw Errors.conflict('NO_OPEN_COHORT', 'باب التقديم مغلق حاليًا — تابع الإعلان عن الدورة القادمة.', 'Applications are currently closed. Watch for the next cohort.');
  }
  return tx(() => {
    if (findOpenApplicationForApplicant(applicant.id)) {
      throw Errors.conflict('OPEN_APPLICATION_EXISTS', 'لديك طلب مفتوح بالفعل — لا يمكن فتح طلب آخر حتى يصل لحالة نهائية.',
        'You already have an open application. A new one can be started only after it reaches a final state.');
    }
    let app: AppRow;
    try { app = createDraftApplication(applicant.id, cohort.id, user.id, applicant.fullName); }
    catch (e) {
      if ((e as Error).message?.includes('applications.applicantId')) throw Errors.conflict('OPEN_APPLICATION_EXISTS', 'لديك طلب مفتوح بالفعل.', 'You already have an open application.');
      throw e;
    }
    // تعبئة مبدئية من حساب المتقدم (قابلة للتعديل في المسودة).
    writeSection(app.id, 'personal', 1, {
      fullName: applicant.fullName, email: user.email.toLowerCase(), ...(user.phone ? { phone: user.phone } : {}), nationality: 'egyptian',
    }, user.id);
    addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
      action: 'application.create', entityType: 'application', entityId: app.id, applicationId: app.id, summaryAr: `إنشاء مسودة طلب في ${cohort.nameAr}` });
    return app;
  });
}

/** الفورم القابل للتعديل الآن، وحقول النواقص المفتوحة (null = كل حقول الفورم). */
export function editableScope(app: AppRow): { form: FormKind; keys: Set<string> | null } | null {
  const st = app.state as ApplicationState;
  if (st === 'DRAFT') return { form: 'application', keys: null };
  if (st === 'STUDY_PREPARATION') return { form: 'study', keys: null };
  const corr = CORRECTION_STATES[st];
  if (corr) return { form: corr, keys: new Set(openDeficiencies(app.id).map((d) => d.field)) };
  return null;
}

export function saveSection(user: UserInternal, appId: string, sectionRaw: string, body: unknown, ip: string): Record<string, unknown> {
  if (!(FORM_SECTIONS as readonly string[]).includes(sectionRaw)) throw Errors.notFound('القسم غير معروف.', 'Unknown section.');
  const section = sectionRaw as FormSection;
  const app = loadOwned(user, appId);
  const scope = editableScope(app);
  if (!scope || formOfSection(section) !== scope.form) throw notEditable();
  const pending = app.attempt + 1;
  if (section === 'expert' && body && typeof body === 'object' && typeof (body as Record<string, unknown>).expertId === 'string') {
    const ex = getExpert((body as Record<string, string>).expertId);
    if (!ex || ex.status !== 'approved') {
      throw new AppError(422, 'EXPERT_NOT_APPROVED', 'الخبير غير موجود في الدليل المعتمد.', 'The expert is not on the approved directory.', [{ field: 'expertId', issue: 'not approved' }]);
    }
  }
  return tx(() => {
    const current = getSection(app.id, section) ?? {};
    const next = cleanSectionPatch(section, body, current, scope.keys ?? undefined);
    writeSection(app.id, section, pending, next, user.id);
    // أعمدة العرض في القوائم أثناء المسودة؛ القيم المعتمدة تُثبت عند الإرسال.
    if (app.state === 'DRAFT' && section === 'personal') setApplicationColumns(app.id, { applicantName: String(next.fullName ?? '') });
    if (app.state === 'DRAFT' && section === 'project') {
      setApplicationColumns(app.id, { projectName: String(next.projectName ?? ''), sector: String(next.sector ?? ''), governorate: String(next.projectGovernorate ?? '') });
    }
    if (scope.keys) {
      addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
        action: 'application.correction_edit', entityType: 'application', entityId: app.id, applicationId: app.id,
        summaryAr: `تعديل حقول نواقص (${section})`, details: { section, fields: Object.keys(body as object), attempt: pending } });
    }
    return next;
  });
}

/** أنواع المستندات المسموح للمتقدم رفعها في الحالة الحالية. */
function uploadableKinds(app: AppRow): Set<DocumentKind> {
  const scope = editableScope(app);
  if (!scope) return new Set();
  const kinds = documentKindsOfForm(scope.form);
  if (!scope.keys) return new Set(kinds);
  return new Set(kinds.filter((k) => scope.keys!.has(fieldForDocKind(k))));
}

function maxFiles(kind: DocumentKind): number {
  return FIELD_BY_KEY.get(fieldForDocKind(kind))?.maxItems ?? 1;
}

export function uploadDocument(user: UserInternal, appId: string, kindRaw: unknown, file: Express.Multer.File | undefined, ip: string): DocumentRow {
  let app: AppRow;
  try { app = loadOwned(user, appId); } catch (e) { discardUpload(file); throw e; }
  if (typeof kindRaw !== 'string' || !(DOCUMENT_KINDS as readonly string[]).includes(kindRaw)) {
    discardUpload(file);
    throw Errors.validation([{ field: 'kind', issue: 'unknown document kind' }]);
  }
  const kind = kindRaw as DocumentKind;
  if (!uploadableKinds(app).has(kind)) {
    discardUpload(file);
    if (CORRECTION_STATES[app.state]) {
      throw Errors.conflict('FIELD_NOT_IN_DEFICIENCIES', 'لا يمكن رفع مستند خارج قائمة النواقص المطلوبة.', 'Only documents listed in the deficiencies can be uploaded.', [{ field: fieldForDocKind(kind), issue: 'not in deficiencies' }]);
    }
    throw Errors.conflict('INVALID_STATE', 'لا يمكن رفع هذا المستند في المرحلة الحالية.', 'This document cannot be uploaded in the current state.');
  }
  const pending = app.attempt + 1;
  const multi = MULTI_DOCUMENT_KINDS.includes(kind);
  const max = maxFiles(kind);
  if (multi && activeDocsAt(app.id, pending).filter((d) => d.kind === kind).length >= max) {
    discardUpload(file);
    throw new AppError(422, 'TOO_MANY_FILES', `الحد الأقصى ${max} ملفات.`, `At most ${max} files.`, [{ field: fieldForDocKind(kind), issue: 'limit reached' }]);
  }
  const stored = acceptPdf(file);
  return tx(() => {
    const doc = addDocumentVersion({
      applicationId: app.id, kind, attempt: pending, uploadedInState: app.state, originalName: stored.originalName,
      storedName: stored.storedName, sizeBytes: stored.sizeBytes, sha256: stored.sha256, uploadedBy: user.id,
    }, multi);
    addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
      action: 'document.upload', entityType: 'document', entityId: doc.id, applicationId: app.id,
      summaryAr: `رفع مستند (${kind}) نسخة ${doc.version}`, details: { kind, version: doc.version, attempt: pending, sha256: stored.sha256, sizeBytes: stored.sizeBytes } });
    return doc;
  });
}

export function removeDocument(user: UserInternal, appId: string, docId: string, ip: string): void {
  const app = loadOwned(user, appId);
  const doc = getDocument(app.id, docId);
  if (!doc) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  const pending = app.attempt + 1;
  if (!MULTI_DOCUMENT_KINDS.includes(doc.kind) || !uploadableKinds(app).has(doc.kind)) {
    throw Errors.conflict('INVALID_STATE', 'لا يمكن إزالة هذا المستند — ارفع نسخة جديدة بدلًا منه.', 'This document cannot be removed — upload a new version instead.');
  }
  if (!activeDocsAt(app.id, pending).some((d) => d.id === doc.id)) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  tx(() => {
    removeDocumentAt(doc, pending);
    addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
      action: 'document.remove', entityType: 'document', entityId: doc.id, applicationId: app.id, summaryAr: 'إزالة مرفق من المحاولة القادمة', details: { attempt: pending, kind: doc.kind } });
  });
}

/**
 * مستندات تصدرها الجهات: قرار الاعتماد (IMC في SELECTED) وقرار التمويل (جهة التمويل في FUNDER_REVIEW).
 * تُسجل على المحاولة الحالية فتظهر فورًا لمن يحق له.
 */
export function uploadStaffDocument(user: UserInternal, appId: string, kindRaw: unknown, file: Express.Multer.File | undefined, ip: string): DocumentRow {
  const app = getApplication(appId);
  if (!app || !canSeeApplication(user, app)) { discardUpload(file); throw Errors.notFound('الطلب غير موجود.', 'Application not found.'); }
  const allowed = (user.role === 'imc_officer' && user.organizationId === ORG_IDS.imc && kindRaw === 'approvalFile' && app.state === 'SELECTED')
    || (user.role === 'funder_reviewer' && app.funderOrgId === user.organizationId && kindRaw === 'fundingDecisionFile' && app.state === 'FUNDER_REVIEW');
  if (!allowed) {
    discardUpload(file);
    throw Errors.conflict('INVALID_STATE', 'لا يمكن رفع هذا المستند في المرحلة الحالية.', 'This document cannot be uploaded in the current state.');
  }
  const kind = kindRaw as DocumentKind;
  const stored = acceptPdf(file);
  const attempt = Math.max(app.attempt, 1);
  return tx(() => {
    const doc = addDocumentVersion({
      applicationId: app.id, kind, attempt, uploadedInState: app.state, originalName: stored.originalName,
      storedName: stored.storedName, sizeBytes: stored.sizeBytes, sha256: stored.sha256, uploadedBy: user.id,
    }, false);
    addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
      action: 'document.upload', entityType: 'document', entityId: doc.id, applicationId: app.id,
      summaryAr: `رفع مستند (${kind}) نسخة ${doc.version}`, details: { kind, version: doc.version, attempt, sha256: stored.sha256 } });
    return doc;
  });
}
