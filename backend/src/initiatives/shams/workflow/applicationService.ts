/** إنشاء المسودة، والحفظ التلقائي، وتعديل حقول النواقص فقط، ورفع/إزالة المستندات. */
import fs from 'node:fs';
import { tx, getDb, nowIso } from '../db/sqlite.js';
import { AppError, Errors } from '../http/errors.js';
import type { UserInternal } from '../store/users.js';
import {
  createDraftApplication, findOpenApplicationForFactory, getApplication, getSection, listFactoryApplications, writeSection, openDeficiencies, type AppRow,
} from '../store/applications.js';
import { addDocumentVersion, activeDocsAt, countVersionsAtAttempt, getDocument, removeDocumentAt, retainedBytes, type DocumentRow } from '../store/documents.js';
import { getFactoryByOrg } from '../store/factories.js';
import { addAuditLog } from '../store/audit.js';
import { canSeeApplication, isFactoryOwnerOf } from '../access/visibility.js';
import { acceptPdf, discardUpload, storedPath } from '../http/upload.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { FORM_CORRECTION_STATES, type ApplicationState } from './shamsWorkflow.js';
import {
  FORM_SECTIONS, FORM_DOCUMENT_KINDS, DOCUMENT_KINDS, fieldForDocKind, type FormSection, type DocumentKind,
} from './applicationForm.js';
import { cleanSectionPatch } from './validate.js';

async function loadOwned(user: UserInternal, appId: string): Promise<AppRow> {
  const app = await getApplication(appId);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  if (!isFactoryOwnerOf(user, app)) throw Errors.forbidden();
  return app;
}

function notEditable(): AppError {
  return Errors.conflict('INVALID_STATE', 'لا يمكن تعديل الطلب في مرحلته الحالية.', 'The application cannot be edited in its current state.');
}

/**
 * PR-C1: الحالة والمحاولة قُرئتا قبل المعاملة. مع أكثر من عملية على ملف SQLite نفسه قد يلتزم إرسالٌ (أو قرار) في عملية أخرى
 * بين القراءة وأخذ قفل الكتابة، فيُكتب الحفظ أو المستند داخل محاولة وصلت للمراجعين. يُعاد الفحص داخل BEGIN IMMEDIATE قبل أي كتابة.
 */
async function assertUnchangedInTx(app: AppRow): Promise<void> {
  const cur = await getApplication(app.id);
  if (!cur || cur.state !== app.state || cur.attempt !== app.attempt) {
    throw Errors.conflict('VERSION_CONFLICT', 'تم تحديث الطلب أثناء الحفظ — أعد تحميل الصفحة.', 'The application changed while saving. Reload and try again.');
  }
}

export async function createDraft(user: UserInternal, ip: string): Promise<AppRow> {
  if (user.role !== 'factory_owner') throw Errors.forbidden();
  const factory = await getFactoryByOrg(user.organizationId);
  if (!factory) throw Errors.notFound('ملف المصنع غير موجود.', 'Factory profile not found.');
  return await tx(async () => {
    if (await findOpenApplicationForFactory(factory.id)) {
      throw Errors.conflict('OPEN_APPLICATION_EXISTS', 'لديك طلب مفتوح بالفعل — لا يمكن فتح طلب آخر حتى يصل لحالة نهائية.',
        'You already have an open application. A new one can be started only after it reaches a final state.');
    }
    // F-11: السياسة ★ (مسموح افتراضيًا) تُطبَّق في الخادم لا في الواجهة فقط؛ نفس الشرط الذي تعرضه `canStartNew` في ملف المصنع.
    if (!shamsPolicy.allowReapplyAfterTerminal && (await listFactoryApplications(factory.id)).length > 0) {
      throw Errors.conflict('REAPPLY_NOT_ALLOWED', 'إعادة التقديم بعد انتهاء طلب سابق غير مسموحة حاليًا.', 'Applying again after a previous application ended is not allowed at the moment.');
    }
    let app: AppRow;
    try { app = await createDraftApplication(factory.id, user.id, factory.companyName); }
    catch (e) {
      if ((e as Error).message?.includes('applications.factoryId')) throw Errors.conflict('OPEN_APPLICATION_EXISTS', 'لديك طلب مفتوح بالفعل.', 'You already have an open application.');
      throw e;
    }
    // تعبئة مبدئية من ملف المصنع وحساب المالك (قابلة للتعديل في المسودة).
    await writeSection(app.id, 'general', 1, { companyName: factory.companyName }, user.id);
    await writeSection(app.id, 'contact', 1, {
      contactName: user.nameAr, contactEmail: user.email.toLowerCase(), ...(user.phone ? { contactMobile: user.phone } : {}),
    }, user.id);
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
      action: 'application.create', entityType: 'application', entityId: app.id, applicationId: app.id, summaryAr: 'إنشاء مسودة طلب' });
    return app;
  });
}

export type RegistrationSections = Partial<Record<FormSection, Record<string, unknown>>>;

/**
 * بيانات الفورم المُدخلة في صفحة التسجيل نفسها (قبل وجود الحساب): نفس تحقق الحفظ في المعالج (cleanSectionPatch) لكل قسم،
 * ويُرمى خطأ التحقق قبل إنشاء أي حساب. undefined = لم تُرسل بيانات.
 */
export function cleanRegistrationApplication(raw: unknown): RegistrationSections | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw Errors.validation([{ field: 'application', issue: 'must be a JSON object' }]);
  const unknown = Object.keys(raw).filter((k) => !(FORM_SECTIONS as readonly string[]).includes(k));
  if (unknown.length) throw Errors.validation(unknown.map((k) => ({ field: `application.${k}`, issue: 'unknown field' })));
  const out: RegistrationSections = {};
  const details: Array<{ field: string; issue: string }> = [];
  for (const section of FORM_SECTIONS) {
    const patch = (raw as Record<string, unknown>)[section];
    if (patch === undefined) continue;
    try { out[section] = cleanSectionPatch(section, patch, {}); } catch (e) {
      if (e instanceof AppError && e.details) details.push(...e.details); else throw e;
    }
  }
  if (details.length) throw Errors.validation(details);
  return out;
}

/**
 * ينشئ مسودة الطلب الأولى لمصنع سُجّل للتو، بالبيانات المُدخلة في صفحة التسجيل. يُستدعى داخل معاملة إنشاء الحساب نفسها
 * (حساب + مسودة معًا أو لا شيء). المستندات لا تُرفع هنا: الحساب غير مفعّل بعد (L7: لا تخزين ملفات لحساب لم يُثبت بريده)،
 * فتبقى في متصفح المصنع وتُرفع بعد التفعيل وأول دخول.
 */
export async function createRegistrationDraft(factory: { id: string; companyName: string }, user: UserInternal, sections: RegistrationSections, ip: string): Promise<AppRow> {
  const app = await createDraftApplication(factory.id, user.id, factory.companyName);
  const general: Record<string, unknown> = { ...(sections.general ?? {}), companyName: factory.companyName };
  const contact = { contactName: user.nameAr, contactEmail: user.email.toLowerCase(), ...(user.phone ? { contactMobile: user.phone } : {}), ...(sections.contact ?? {}) };
  await writeSection(app.id, 'general', 1, general, user.id);
  await writeSection(app.id, 'contact', 1, contact, user.id);
  if (sections.company) await writeSection(app.id, 'company', 1, sections.company, user.id);
  if (sections.engineering) await writeSection(app.id, 'engineering', 1, sections.engineering, user.id);
  await getDb().prepare('UPDATE shams_applications SET governorate = ?, updatedAt = ? WHERE id = ?').run(String(general.governorate ?? ''), nowIso(), app.id);
  await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
    action: 'application.create', entityType: 'application', entityId: app.id, applicationId: app.id, summaryAr: 'إنشاء مسودة طلب من صفحة التسجيل',
    details: { sections: Object.keys(sections) } });
  return app;
}

/** حقول النواقص المفتوحة (وضع التصحيح) — null = كل الحقول (مسودة). */
async function editableKeys(app: AppRow): Promise<Set<string> | null> {
  if (app.state === 'DRAFT') return null;
  if (FORM_CORRECTION_STATES.includes(app.state)) return new Set((await openDeficiencies(app.id)).map((d) => d.field));
  throw notEditable();
}

export async function saveSection(user: UserInternal, appId: string, sectionRaw: string, body: unknown, ip: string): Promise<Record<string, unknown>> {
  if (!(FORM_SECTIONS as readonly string[]).includes(sectionRaw)) throw Errors.notFound('القسم غير معروف.', 'Unknown section.');
  const section = sectionRaw as FormSection;
  const app = await loadOwned(user, appId);
  const allowed = await editableKeys(app);
  const pending = app.attempt + 1;
  return await tx(async () => {
    await assertUnchangedInTx(app);
    const current = await getSection(app.id, section) ?? {};
    const next = cleanSectionPatch(section, body, current, allowed ?? undefined);
    await writeSection(app.id, section, pending, next, user.id);
    if (app.state === 'DRAFT' && section === 'general') {
      // عرض المسودة في القوائم فقط؛ القيم المعتمدة تُثبت عند الإرسال.
      await getDb().prepare('UPDATE shams_applications SET companyName = ?, governorate = ?, updatedAt = ? WHERE id = ?')
        .run(String(next.companyName ?? ''), String(next.governorate ?? ''), nowIso(), app.id);
    }
    if (allowed) {
      await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
        action: 'application.correction_edit', entityType: 'application', entityId: app.id, applicationId: app.id,
        summaryAr: `تعديل حقول نواقص (${section})`, details: { section, fields: Object.keys(body as object), attempt: pending } });
    }
    return next;
  });
}

/** أنواع المستندات المسموح رفعها في الحالة الحالية. */
async function uploadableKinds(app: AppRow): Promise<Set<DocumentKind>> {
  switch (app.state as ApplicationState) {
    case 'DRAFT': return new Set(FORM_DOCUMENT_KINDS);
    case 'IMC_CORRECTION':
    case 'ENCPC_CORRECTION': {
      const fields = new Set((await openDeficiencies(app.id)).map((d) => d.field));
      return new Set(FORM_DOCUMENT_KINDS.filter((k) => fields.has(fieldForDocKind(k))));
    }
    case 'OFFER_UPLOAD':
    case 'OFFER_CORRECTION': return new Set(['technicalOfferFile']);
    case 'ELECTRICITY_UPLOAD': return new Set(['electricityApprovalFile']);
    // G-03: مستند إثبات التعاقد — بعد اختيار البنك فقط، وقبل تسجيل النتيجة (بعدها الطلب نهائي ولا يقبل رفعًا).
    case 'CONTRACT_OUTCOME': return app.bankOrgId ? new Set(['contractFile']) : new Set();
    // مسار شركة توزيع الكهرباء: موافقتها فقط، وقبل الإرسال لـPMU (إعادة الرفع تحفظ النسخ السابقة).
    case 'DISTRIBUTION_UPLOAD': return new Set(['distributionApprovalFile']);
    default: return new Set();
  }
}

export async function uploadDocument(user: UserInternal, appId: string, kindRaw: unknown, file: Express.Multer.File | undefined, ip: string): Promise<DocumentRow> {
  let app: AppRow;
  try { app = await loadOwned(user, appId); } catch (e) { discardUpload(file); throw e; }
  if (typeof kindRaw !== 'string' || !(DOCUMENT_KINDS as readonly string[]).includes(kindRaw)) {
    discardUpload(file);
    throw Errors.validation([{ field: 'kind', issue: 'unknown document kind' }]);
  }
  const kind = kindRaw as DocumentKind;
  const allowed = await uploadableKinds(app);
  if (!allowed.has(kind)) {
    discardUpload(file);
    if (FORM_CORRECTION_STATES.includes(app.state)) {
      throw Errors.conflict('FIELD_NOT_IN_DEFICIENCIES', 'لا يمكن رفع مستند خارج قائمة النواقص المطلوبة.', 'Only documents listed in the deficiencies can be uploaded.', [{ field: fieldForDocKind(kind), issue: 'not in deficiencies' }]);
    }
    throw Errors.conflict('INVALID_STATE', 'لا يمكن رفع هذا المستند في المرحلة الحالية.', 'This document cannot be uploaded in the current state.');
  }
  const pending = app.attempt + 1;
  const multi = kind === 'electricityBill';
  const stored = acceptPdf(file);
  try {
    // F-05: كل الحدود تُفحص داخل معاملة الإدراج نفسها (BEGIN IMMEDIATE)، فلا يمر رفعان متزامنان معًا من فحص واحد حتى عبر عمليات متعددة.
    return await tx(async () => {
      await assertUnchangedInTx(app);
      const limits = shamsPolicy.documentLimits;
      if (multi && (await activeDocsAt(app.id, pending)).filter((d) => d.kind === kind).length >= shamsPolicy.electricityBills.max) {
        throw new AppError(422, 'TOO_MANY_FILES', `الحد الأقصى ${shamsPolicy.electricityBills.max} فاتورة.`, `At most ${shamsPolicy.electricityBills.max} bills.`, [{ field: 'electricityBills', issue: 'limit reached' }]);
      }
      // الفواتير ملفات متعددة لا نسخ لمستند واحد: سقفها 12 ملفًا فعالًا أعلاه، وإعادة رفعها محكومة بحد التخزين.
      if (!multi && await countVersionsAtAttempt(app.id, kind, pending) >= limits.maxVersionsPerKindPerAttempt) {
        throw new AppError(422, 'TOO_MANY_VERSIONS', `بلغ هذا المستند الحد الأقصى (${limits.maxVersionsPerKindPerAttempt}) من النسخ في هذه المحاولة.`,
          `This document reached the maximum of ${limits.maxVersionsPerKindPerAttempt} versions in this attempt.`, [{ field: fieldForDocKind(kind), issue: 'too many versions' }]);
      }
      // الحد على كل النسخ المحفوظة (المستبدَلة أيضًا): الملفات التاريخية لا تُحذف فتبقى على القرص.
      if (await retainedBytes(app.id) + stored.sizeBytes > Math.floor(limits.maxApplicationStorageMB * 1024 * 1024)) {
        throw new AppError(413, 'STORAGE_LIMIT', `بلغ الطلب حد التخزين (${limits.maxApplicationStorageMB} ميجابايت لكل النسخ المحفوظة). تواصل مع الدعم.`,
          `The application reached its storage limit (${limits.maxApplicationStorageMB} MB across all retained versions). Contact support.`, [{ field: fieldForDocKind(kind), issue: 'storage limit' }]);
      }
      const doc = await addDocumentVersion({
        applicationId: app.id, kind, attempt: pending, uploadedInState: app.state, originalName: stored.originalName,
        storedName: stored.storedName, sizeBytes: stored.sizeBytes, sha256: stored.sha256, uploadedBy: user.id,
      }, multi);
      await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
        action: 'document.upload', entityType: 'document', entityId: doc.id, applicationId: app.id,
        summaryAr: `رفع مستند (${kind}) نسخة ${doc.version}`, details: { kind, version: doc.version, attempt: pending, sha256: stored.sha256, sizeBytes: stored.sizeBytes } });
      return doc;
    });
  } catch (e) {
    // رُفض الرفع بعد أن نُقل الملف للتخزين: يُحذف هذا الملف الجديد وحده (اسم عشوائي جديد، لا علاقة له بأي نسخة تاريخية).
    fs.rmSync(storedPath(stored.storedName), { force: true });
    throw e;
  }
}

export async function removeDocument(user: UserInternal, appId: string, docId: string, ip: string): Promise<void> {
  const app = await loadOwned(user, appId);
  const doc = await getDocument(app.id, docId);
  if (!doc) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  const pending = app.attempt + 1;
  // مستندات فورم التسجيل فقط (لا العرض الفني ولا موافقة الكهرباء ولا إثبات التعاقد)، وفقط حيث يجوز رفعها الآن:
  // المسودة كاملةً، وفي الاستيفاء بنود النواقص وحدها. الإزالة لا تحذف الصف ولا الملف: النسخة تُعلَّم «removed» من المحاولة القادمة،
  // فما لم يُرسل لا يراه مراجع (M7)، وما أُرسل سابقًا يبقى في السجل كما رآه المراجع.
  if (!FORM_DOCUMENT_KINDS.includes(doc.kind) || !(await uploadableKinds(app)).has(doc.kind)) {
    throw Errors.conflict('INVALID_STATE', 'لا يمكن إزالة هذا المستند في المرحلة الحالية.', 'This document cannot be removed in the current state.');
  }
  if (!(await activeDocsAt(app.id, pending)).some((d) => d.id === doc.id)) throw Errors.notFound('المستند غير موجود.', 'Document not found.');
  await tx(async () => {
    await assertUnchangedInTx(app);
    await removeDocumentAt(doc, pending);
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
      action: 'document.remove', entityType: 'document', entityId: doc.id, applicationId: app.id,
      summaryAr: `إزالة مستند (${doc.kind}) نسخة ${doc.version} من المحاولة القادمة`, details: { kind: doc.kind, version: doc.version, attempt: pending } });
  });
}
