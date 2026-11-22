/**
 * تنفيذ الإجراءات على الطلب. كل انتقال: تحقق ← معاملة واحدة (الحالة + السجل التاريخي + النواقص + التدقيق
 * + outbox الإشعارات + outbox الـwebhook) مع expectedVersion. لا انتقال خارج TRANSITIONS.
 */
import { createHash, randomUUID } from 'node:crypto';
import { tx, nowIso, getDb } from '../db/sqlite.js';
import { AppError, Errors, type ErrorDetail } from '../http/errors.js';
import { isIsoDate, isObj, onlyKeys, type Obj } from '../http/validate.js';
import type { UserInternal } from '../store/users.js';
import {
  getApplication, getSection, writeSection, insertTransition, insertDeficiency, openDeficiencies, resolveDeficiencies,
  nextApplicationNumber, insertRegistryVerification, findOpenSubmittedByRegistry, type AppRow,
} from '../store/applications.js';
import { countActiveByKind, hasNewVersionAt, activeDocsAt, discardUnsentVersions } from '../store/documents.js';
import { getProvider, isSelectable } from '../store/providers.js';
import { getOrganization, isBankAvailable } from '../store/organizations.js';
import { insertBlock, recordConflict, registryAccess } from '../store/registry.js';
import { renameFactory } from '../store/factories.js';
import { addAuditLog } from '../store/audit.js';
import { enqueueWebhook } from '../store/outbox.js';
import { canSeeApplication } from '../access/visibility.js';
import { getRegistryClient, type RegistryResult } from '../integrations/registry/index.js';
import { syncFactoryAccount } from '../services/factoryAccount.js';
import { dispatch, factoryRecipients, notifyTransition, orgRecipients } from '../notifications/notify.js';
import { kickNotificationWorker } from '../jobs/notificationWorker.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { ORG_IDS } from '../domain.js';
import { config } from '../config.js';
import {
  ACTIONS, TRANSITIONS, transitionsFrom, pickTransition, actorOwnsRow, isTerminal, STATE_LABELS,
  type ActionName, type TransitionDef, type ApplicationState,
} from './shamsWorkflow.js';
import { FORM_SECTIONS, ELECTRICITY_DEFICIENCY_FIELDS } from './applicationForm.js';
import { ALL_FORM_FIELD_KEYS, completenessIssues, totalRoofArea, type FormData } from './validate.js';
import { actionBlock, deficiencyLabels } from './applicationView.js';
import { syncProfileAfterSubmit } from '../profileSync.js';

interface Deficiency { field: string; note: string }

interface Payload {
  expectedVersion: number;
  reason?: string;
  reasonCode?: (typeof shamsPolicy.imcRejectReasonCodes)[number];
  note?: string;
  deficiencies?: Deficiency[];
  providerId?: string;
  distributionCompany?: string;
  bankOrgId?: string;
  contractDate?: string;
  contractAmount?: number;
  contractNotes?: string;
}

const ACTION_FIELDS: Record<ActionName, string[]> = {
  submit: [],
  resubmit: ['note'],
  accept: ['note'],
  compliant: ['note'],
  request_correction: ['deficiencies', 'reason'],
  non_compliant: ['deficiencies', 'reason'],
  reject: ['reason', 'reasonCode'],
  select_provider: ['providerId'],
  submit_offer: ['note'],
  // G-01: لا بنك في إرسال موافقة الكهرباء — حقل bankOrgId هنا يُرفض كحقل غير معروف.
  submit_electricity: ['distributionCompany'],
  select_bank: ['bankOrgId'],
  record_contract: ['contractDate', 'contractAmount', 'contractNotes'],
  record_no_contract: ['reason', 'contractNotes'],
  withdraw: ['reason'],
  select_distribution_path: [],
  submit_distribution_approval: ['note'],
  reject_distribution: ['reason'],
};

/** الأفعال التي يرسل فيها المصنع بيانات/مستندات جديدة → تزيد رقم المحاولة. */
function bumpsAttempt(def: TransitionDef): boolean {
  return def.actorRole === 'factory_owner' && def.action !== 'withdraw';
}

function text(v: unknown, field: string, details: ErrorDetail[], opts: { required?: boolean; min?: number; max?: number }): string | undefined {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (opts.required) details.push({ field, issue: 'required' });
    return undefined;
  }
  if (typeof v !== 'string') { details.push({ field, issue: 'must be a string' }); return undefined; }
  const t = v.trim();
  if (opts.min && t.length < opts.min) details.push({ field, issue: `min length ${opts.min}` });
  if (t.length > (opts.max ?? 2000)) details.push({ field, issue: `max length ${opts.max ?? 2000}` });
  return t;
}

function parseDeficiencies(raw: unknown, allowed: Set<string>, details: ErrorDetail[]): Deficiency[] {
  if (!Array.isArray(raw) || raw.length === 0) { details.push({ field: 'deficiencies', issue: 'required (non-empty list of { field, note })' }); return []; }
  if (raw.length > 40) { details.push({ field: 'deficiencies', issue: 'max 40 items' }); return []; }
  const out: Deficiency[] = [];
  const seen = new Set<string>();
  raw.forEach((d, i) => {
    if (!isObj(d) || Object.keys(d).some((k) => k !== 'field' && k !== 'note')) { details.push({ field: `deficiencies[${i}]`, issue: 'must be { field, note }' }); return; }
    const field = typeof d.field === 'string' ? d.field : '';
    if (!allowed.has(field)) { details.push({ field: `deficiencies[${i}].field`, issue: 'unknown field' }); return; }
    const note = text(d.note, `deficiencies[${i}].note`, details, { required: true, max: 1000 });
    if (seen.has(field)) return;
    seen.add(field);
    out.push({ field, note: note ?? '' });
  });
  return out;
}

function parsePayload(action: ActionName, from: ApplicationState, body: unknown): Payload {
  const allowed = ['expectedVersion', ...ACTION_FIELDS[action]];
  const b: Obj = onlyKeys(body ?? {}, allowed);
  const details: ErrorDetail[] = [];
  const ev = b.expectedVersion;
  if (typeof ev !== 'number' || !Number.isInteger(ev) || ev < 1) details.push({ field: 'expectedVersion', issue: 'required integer' });
  const p: Payload = { expectedVersion: Number(ev) };
  const defs = transitionsFrom(from, action);
  const req = defs[0]?.requires ?? {};

  if (ACTION_FIELDS[action].includes('reason')) p.reason = text(b.reason, 'reason', details, { required: Boolean(req.reason), min: req.reason ? 3 : undefined });
  if (ACTION_FIELDS[action].includes('note')) p.note = text(b.note, 'note', details, { max: 2000 });

  if (action === 'request_correction' || action === 'non_compliant') {
    if (from === 'IMC_REVIEW' || from === 'ENCPC_REVIEW') {
      p.deficiencies = parseDeficiencies(b.deficiencies, ALL_FORM_FIELD_KEYS, details);
    } else if (from === 'ELECTRICITY_REVIEW') {
      p.deficiencies = b.deficiencies === undefined ? [{ field: 'electricityApprovalFile', note: p.reason ?? '' }]
        : parseDeficiencies(b.deficiencies, new Set(ELECTRICITY_DEFICIENCY_FIELDS), details);
    } else if (from === 'OFFER_REVIEW') {
      if (b.deficiencies !== undefined) details.push({ field: 'deficiencies', issue: 'not allowed — the technical offer is the subject of correction' });
      p.deficiencies = [{ field: 'technicalOfferFile', note: p.reason ?? '' }];
    }
  }
  if (action === 'reject' && b.reasonCode !== undefined) {
    if (!(shamsPolicy.imcRejectReasonCodes as readonly unknown[]).includes(b.reasonCode)) details.push({ field: 'reasonCode', issue: `must be one of ${shamsPolicy.imcRejectReasonCodes.join(', ')}` });
    else p.reasonCode = b.reasonCode as Payload['reasonCode'];
  }
  if (action === 'select_bank') p.bankOrgId = text(b.bankOrgId, 'bankOrgId', details, { required: true, max: 100 });
  if (action === 'select_provider') p.providerId = text(b.providerId, 'providerId', details, { required: true, max: 100 });
  if (action === 'submit_electricity') {
    p.distributionCompany = text(b.distributionCompany, 'distributionCompany', details, { required: true, min: 2, max: 200 });
  }
  if (action === 'record_contract') {
    if (!isIsoDate(b.contractDate)) details.push({ field: 'contractDate', issue: 'required date YYYY-MM-DD' }); else p.contractDate = b.contractDate;
    const amt = typeof b.contractAmount === 'number' ? b.contractAmount : NaN;
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1e13) details.push({ field: 'contractAmount', issue: 'required positive number (EGP)' }); else p.contractAmount = amt;
    p.contractNotes = text(b.contractNotes, 'contractNotes', details, { max: 2000 });
  }
  if (action === 'record_no_contract') p.contractNotes = text(b.contractNotes, 'contractNotes', details, { max: 2000 });
  if (details.length) throw Errors.validation(details);
  return p;
}

/** يجمع آخر نسخة من أقسام الفورم (بما فيها غير المُرسل) — أساس فحص الاكتمال. */
export async function pendingFormData(appId: string): Promise<FormData> {
  const data: FormData = {};
  for (const s of FORM_SECTIONS) data[s] = await getSection(appId, s) ?? {};
  return data;
}

/** JSON حتمي: مفاتيح الكائنات مرتبة، فلا يتغير الناتج بترتيب الإدراج. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * F-01: بصمة لقطة التقديم الكاملة — بيانات الأقسام للمحاولة القادمة + المستندات الفعالة (المعرّف والنوع والنسخة والبصمة) + رقم المحاولة.
 * تُؤخذ قبل انتظار رد السجل الصناعي وتُقارن داخل معاملة الالتزام: ما تحقق منه السجل هو بالضبط ما يُقدَّم.
 * لا تحتوي أي طابع زمني؛ تعديل ثم إرجاع القيمة نفسها (ABA) لا يغيّر شيئًا مما يراه المراجع فلا يُرفض.
 * المقارنة داخل BEGIN IMMEDIATE تلتقط كل مسارات الكتابة (حاليًا ومستقبلًا) دون الحاجة لقفل يلتزم به كل كاتب.
 */
export async function submissionFingerprint(appId: string, pending: number, formArg?: FormData): Promise<string> {
  const form = formArg === undefined ? await pendingFormData(appId) : formArg;
  const docs = (await activeDocsAt(appId, pending))
    .map((d) => [d.id, d.kind, d.version, d.attempt, d.sha256] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash('sha256').update(canonicalJson({ pending, form, docs })).digest('hex');
}

function submissionChanged(): AppError {
  return Errors.conflict('SUBMISSION_DATA_CHANGED',
    'تغيّرت بيانات الطلب أو مستنداته أثناء التحقق من السجل الصناعي، فلم يُرسل شيء. راجع البيانات ثم أعد الإرسال.',
    'The application data or documents changed while the industrial registry was being verified, so nothing was submitted. Review the data and submit again.');
}

function supportHintAr(): string {
  const parts = [config.supportEmail, config.supportPhone].filter(Boolean);
  return parts.length ? ` للاعتراض أو الاستفسار: ${parts.join(' — ')}.` : '';
}

/** H3: الحظر على الرقم نفسه لكل الحسابات (دون كشف سببه)، ويُرفع بقرار موثق من PMU لمصنع محدد. */
function registryBlockedError(reason: string): AppError {
  return Errors.conflict('REGISTRY_BLOCKED',
    `رقم السجل الصناعي هذا موقوف الاستخدام حتى مراجعة موثقة من وحدة إدارة المبادرة. إن كان الرقم لمنشأتك فأرسل اعتراضًا مدعومًا بمستندات الملكية.${supportHintAr()}`,
    'This industrial registry number is on hold pending a documented PMU review. If it belongs to your facility, submit an objection with ownership documents.',
    [{ field: 'industrialRegistryNumber', issue: reason }]);
}

function duplicateRegistryError(): AppError {
  return Errors.conflict('DUPLICATE_REGISTRY',
    `يوجد طلب مفتوح آخر بنفس رقم السجل الصناعي، ولم يُرسل طلبك. أُبلغت IMC ووحدة إدارة المبادرة بالتعارض لمراجعة ملكية الرقم. إذا كان الرقم لمنشأتك فاعترض بإرسال صورة السجل الصناعي وما يثبت تفويضك عن المنشأة مع رقم مسودتك.${supportHintAr()} بياناتك محفوظة.`,
    'Another open application uses this industrial registry number, so yours was not submitted. IMC and the PMU were notified to review ownership. If the number belongs to your facility, object by sending the registry certificate and proof of authorization with your draft reference.',
    [{ field: 'industrialRegistryNumber', issue: 'duplicate' }]);
}

function providerNotSelectable(): AppError {
  return new AppError(422, 'PROVIDER_NOT_APPROVED', 'مقدم الخدمة غير متاح للاختيار حاليًا.', 'The service provider is not available for selection.', [{ field: 'providerId', issue: 'not approved' }]);
}

function bankInvalid(): AppError {
  return new AppError(422, 'BANK_INVALID', 'البنك المختار غير متاح (غير نشط أو لا يوجد فيه مستخدم نشط).', 'The selected bank is not available (inactive or without active users).', [{ field: 'bankOrgId', issue: 'unknown or inactive bank' }]);
}

function versionConflict(): AppError {
  return Errors.conflict('VERSION_CONFLICT', 'تم تحديث الطلب بواسطة مستخدم آخر — أعد تحميل الصفحة.', 'The application was updated by someone else. Reload and try again.');
}

function mapUniqueError(e: unknown): never {
  const msg = (e as Error)?.message ?? '';
  if (msg.includes('applications.industrialRegistryNumber')) {
    throw Errors.conflict('DUPLICATE_REGISTRY', 'يوجد طلب مفتوح آخر بنفس رقم السجل الصناعي.', 'Another open application uses this industrial registry number.');
  }
  if (msg.includes('applications.factoryId')) {
    throw Errors.conflict('OPEN_APPLICATION_EXISTS', 'لدى المصنع طلب مفتوح بالفعل.', 'The factory already has an open application.');
  }
  throw e;
}

export interface ActionContext { ip: string }

export async function performAction(user: UserInternal, appId: string, actionRaw: string, body: unknown, ctx: ActionContext): Promise<AppRow> {
  if (!(ACTIONS as readonly string[]).includes(actionRaw)) throw Errors.notFound('الإجراء غير معروف.', 'Unknown action.');
  const action = actionRaw as ActionName;
  let app = await getApplication(appId);
  if (!app || !await canSeeApplication(user, app)) throw Errors.notFound('الطلب غير موجود.', 'Application not found.');
  // المتأخر بين مراجعَين من نفس الجهة: نسخته قديمة → 409 VERSION_CONFLICT قبل فحص الحالة.
  // F-09: لمن يملك هذا الإجراء على هذا الطلب فقط (دور + جهة)؛ من لا يملكه يحصل على 403 العادي ولا يعرف أن الطلب تغيّر.
  const sentVersion = isObj(body) ? body.expectedVersion : undefined;
  if (typeof sentVersion === 'number' && sentVersion !== app.version && !isTerminal(app.state)
    && TRANSITIONS.some((t) => t.action === action && actorOwnsRow(user, app!, t))) throw versionConflict();

  if (isTerminal(app.state)) {
    throw Errors.conflict('INVALID_STATE', 'الطلب في حالة نهائية ولا يقبل أي إجراء.', 'The application is in a final state and accepts no actions.');
  }
  const defs = transitionsFrom(app.state, action);
  if (!defs.length) {
    const roleHasAction = TRANSITIONS.some((t) => t.action === action && t.actorRole === user.role);
    if (!roleHasAction) throw new AppError(403, 'ACTION_NOT_ALLOWED', 'هذا الإجراء غير مسموح لدورك.', 'This action is not allowed for your role.');
    throw Errors.conflict('INVALID_STATE', 'الإجراء غير متاح في الحالة الحالية للطلب.', 'This action is not available in the current state.');
  }
  const owned = defs.filter((d) => actorOwnsRow(user, app!, d));
  if (!owned.length) throw new AppError(403, 'ACTION_NOT_ALLOWED', 'هذا الإجراء غير مسموح لك على هذا الطلب.', 'You are not allowed to perform this action on this application.');
  const blocked = await actionBlock(app, action);
  if (blocked) throw blocked;

  const p = parsePayload(action, app.state, body);
  if (p.expectedVersion !== app.version) throw versionConflict();
  const pending = app.attempt + 1;
  const primary = owned[0];

  // ── فحوص ما قبل المعاملة ──
  let registry: { number: string; result: RegistryResult; adapter: 'mock' | 'http' } | null = null;
  let formData: FormData | null = null;
  let snapshotFp: string | null = null;
  let regNumber = '';
  if (primary.requires?.completeForm) {
    // F-01: لا await بين أخذ اللقطة وبصمتها، فهما متسقتان. الانتظار الوحيد لاحقًا هو رد السجل الصناعي، وتُقارن البصمة بعده داخل معاملة الالتزام.
    formData = await pendingFormData(app.id);
    snapshotFp = await submissionFingerprint(app.id, pending, formData);
    const issues = completenessIssues(formData, await countActiveByKind(app.id, pending));
    if (issues.length) {
      throw new AppError(422, 'INCOMPLETE_APPLICATION', 'الطلب غير مكتمل — استكمل الحقول والمستندات المطلوبة.', 'The application is incomplete.', issues);
    }
    regNumber = String(formData.company?.industrialRegistryNumber ?? '');
    const access = await registryAccess(regNumber, app.factoryId);
    if (!access.allowed) throw registryBlockedError(access.reason);
    const holder = await findOpenSubmittedByRegistry(regNumber, app.id);
    if (holder) {
      await recordRegistryConflict(user, app, holder, regNumber, ctx.ip, String(formData.general?.companyName ?? app.companyName));
      throw duplicateRegistryError();
    }
    const needCheck = primary.registryCheck === 'always' || (primary.registryCheck === 'if_changed' && regNumber !== app.verifiedRegistryNumber);
    if (needCheck) {
      const client = getRegistryClient();
      let result: RegistryResult;
      try { result = await client.verify(regNumber); } catch { result = { result: 'unavailable', errorCode: 'CLIENT_ERROR' }; }
      registry = { number: regNumber, result, adapter: client.name };
      app = (await getApplication(app.id))!;
      if (app.version !== p.expectedVersion) throw versionConflict();
    }
  }
  if (action === 'select_provider') {
    const sp = await getProvider(p.providerId!);
    if (!isSelectable(sp)) throw providerNotSelectable();
  }
  if (action === 'select_bank') {
    // البنك جهة خارجية (G-02): يكفي أن يكون بنكًا مُعرَّفًا ونشطًا في المنصة.
    const bank = await getOrganization(p.bankOrgId!);
    if (!bank || bank.type !== 'bank' || !await isBankAvailable(bank.id)) throw bankInvalid();
  }
  const open = await openDeficiencies(app.id);
  if (primary.requires?.newDocument) {
    const kind = primary.requires.newDocument;
    const mustBeNew = app.state === 'OFFER_UPLOAD' || app.state === 'OFFER_CORRECTION' || kind === 'contractFile' || kind === 'distributionApprovalFile' || open.some((d) => d.field === kind);
    const ok = mustBeNew ? await hasNewVersionAt(app.id, kind, pending) : (await activeDocsAt(app.id, pending)).some((d) => d.kind === kind);
    if (!ok) {
      throw new AppError(422, 'DOCUMENT_REQUIRED', 'يجب رفع نسخة جديدة من المستند المطلوب قبل الإرسال.', 'Upload a new version of the required document before submitting.', [{ field: kind, issue: 'new version required' }]);
    }
  }

  const registryValid = registry ? registry.result.result === 'valid' : true;
  const def = pickTransition(owned, registryValid ? 'valid' : 'not_valid');
  const now = nowIso();
  const actor = { actorUserId: user.id, actorRole: user.role, actorOrgId: user.organizationId, actorName: user.nameAr };

  let outcome: { failedRegistry: 'invalid' | 'unavailable' | null };
  try {
  outcome = await tx(async () => {
    const cur = (await getApplication(app!.id))!;
    if (cur.version !== p.expectedVersion || cur.state !== app!.state) throw versionConflict();
    const db = getDb();

    // F-01: قبل أي كتابة — البيانات والمستندات الآن هي نفسها لقطة ما تحقق منه السجل، وحالة الحظر/الحجز لم تتغير.
    // يسري على فرع «السجل غير صحيح» أيضًا حتى لا يُسجَّل رفض قديم على بيانات جديدة. أي رفض هنا يتراجع بلا رقم ولا تحقق ولا انتقال.
    if (snapshotFp !== null) {
      if (await submissionFingerprint(cur.id, pending) !== snapshotFp) throw submissionChanged();
      const access = await registryAccess(regNumber, cur.factoryId);
      if (!access.allowed) throw registryBlockedError(access.reason);
      if (await findOpenSubmittedByRegistry(regNumber, cur.id)) throw duplicateRegistryError();
    }
    // PR-C2: مقدم الخدمة والبنك فُحصا قبل المعاملة؛ عملية أخرى قد توقف أحدهما قبل أخذ القفل. يُعاد الفحص هنا قبل أي كتابة.
    if (action === 'select_provider' && !isSelectable(await getProvider(p.providerId!))) throw providerNotSelectable();
    if (action === 'select_bank' && !await isBankAvailable(p.bankOrgId!)) throw bankInvalid();

    // ── السجل غير صحيح/متعذر: يبقى الطلب كما هو مع حفظ التحقق والسجل والإشعار ──
    if (registry && !registryValid) {
      const ver = await insertRegistryVerification({
        applicationId: cur.id, registryNumber: registry.number, result: registry.result.result as 'invalid' | 'unavailable', facilityData: null,
        adapter: registry.adapter, errorCode: registry.result.result === 'valid' ? null : (registry.result.errorCode ?? null),
      }, user.id);
      const t = await insertTransition({
        applicationId: cur.id, fromState: cur.state, toState: cur.state, action, ...actor, reason: '', attempt: cur.attempt,
        payload: { registryResult: registry.result.result, registryNumber: registry.number },
      });
      await db.prepare('UPDATE shams_applications SET updatedAt = ? WHERE id = ?').run(now, cur.id);
      await addAuditLog({ actorType: 'user', ...actor, ip: ctx.ip, action: 'application.registry_check', entityType: 'application', entityId: cur.id,
        applicationId: cur.id, summaryAr: `تعذر التحقق من السجل الصناعي (${registry.result.result})`, details: { verificationId: ver.id, result: registry.result.result } });
      await notifyTransition({ app: cur, def, transition: t, registryResult: registry.result.result as 'invalid' | 'unavailable' });
      return { failedRegistry: registry.result.result as 'invalid' | 'unavailable' };
    }

    const nextAttempt = bumpsAttempt(def) ? pending : cur.attempt;
    const sets: string[] = ['state = ?', 'version = version + 1', 'attempt = ?', 'stateEnteredAt = ?', 'updatedAt = ?'];
    const vals: Array<string | number | null> = [def.to, nextAttempt, now, now];
    if (isTerminal(def.to)) { sets.push('closedAt = ?'); vals.push(now); }

    let verificationId: string | null = null;
    if (registry && registryValid) {
      const facility = registry.result.result === 'valid' ? registry.result.facility : null;
      verificationId = (await insertRegistryVerification({
        applicationId: cur.id, registryNumber: registry.number, result: 'valid', facilityData: facility as unknown as Record<string, unknown>,
        adapter: registry.adapter, errorCode: null,
      }, user.id)).id;
      sets.push('registryVerificationId = ?', 'verifiedRegistryNumber = ?'); vals.push(verificationId, registry.number);
    }
    if (formData) {
      sets.push('companyName = ?', 'governorate = ?', 'industrialZone = ?', 'industrialRegistryNumber = ?', 'totalRoofArea = ?');
      vals.push(String(formData.general?.companyName ?? ''), String(formData.general?.governorate ?? ''), String(formData.general?.industrialZone ?? ''),
        String(formData.company?.industrialRegistryNumber ?? ''), totalRoofArea(formData.engineering));
    }
    if (action === 'submit') {
      if (!cur.number) { sets.push('number = ?'); vals.push(await nextApplicationNumber()); }
      sets.push('submittedAt = COALESCE(submittedAt, ?)'); vals.push(now);
    }
    if (action === 'select_provider') { sets.push('providerId = ?'); vals.push(p.providerId!); }
    // اختيار البنك = اختيار المسار البنكي (يثبّته)، واختيار شركة التوزيع يثبّت مسارها؛ قيود CHECK تمنع الجمع بينهما.
    if (action === 'select_bank') { sets.push('bankOrgId = ?', "contractPath = 'bank'"); vals.push(p.bankOrgId!); }
    if (action === 'select_distribution_path') sets.push("contractPath = 'distribution'");
    // F-07: عرض رُفع لمقدم لم يعد متاحًا ولم يُرسل — لا يصل المراجعين بعد أن تُحتسب المحاولة مُرسلة (يبقى للمصنع، دون حذف).
    const discardedOffers = action === 'select_provider' && cur.state === 'OFFER_UPLOAD' ? await discardUnsentVersions(cur.id, 'technicalOfferFile', pending) : [];

    // المستند المُرسل لشركة التوزيع: النسخة السارية في المحاولة التي تُرسل الآن (يُثبَّت معرّفها في النتيجة والسجل).
    const distributionDoc = action === 'submit_distribution_approval'
      ? (await activeDocsAt(cur.id, pending)).filter((d) => d.kind === 'distributionApprovalFile').sort((a, b) => b.version - a.version)[0] ?? null : null;
    if (action === 'submit_distribution_approval' && !distributionDoc) {
      throw new AppError(422, 'DOCUMENT_REQUIRED', 'يجب رفع موافقة شركة التوزيع قبل الإرسال.', 'Upload the distribution company approval before submitting.', [{ field: 'distributionApprovalFile', issue: 'new version required' }]);
    }
    const distributionDecision = cur.state === 'DISTRIBUTION_REVIEW' && (action === 'accept' || action === 'reject_distribution');

    try {
      const r = await db.prepare(`UPDATE shams_applications SET ${sets.join(', ')} WHERE id = ? AND version = ?`).run(...vals, cur.id, p.expectedVersion);
      if (Number(r.changes) !== 1) throw versionConflict();
    } catch (e) {
      if (e instanceof AppError) throw e;
      mapUniqueError(e);
    }

    const t = await insertTransition({
      applicationId: cur.id, fromState: cur.state, toState: def.to, action, ...actor,
      reason: p.reason ?? p.note ?? '', attempt: nextAttempt,
      payload: {
        ...(p.deficiencies ? { deficiencies: p.deficiencies } : {}),
        ...(p.providerId ? { providerId: p.providerId } : {}),
        ...(p.bankOrgId ? { bankOrgId: p.bankOrgId } : {}),
        ...(p.reasonCode ? { reasonCode: p.reasonCode } : {}),
        ...(action === 'select_bank' || action === 'select_distribution_path' ? { contractPath: action === 'select_bank' ? 'bank' : 'distribution' } : {}),
        ...(distributionDoc ? { contractPath: 'distribution', documentId: distributionDoc.id, documentVersion: distributionDoc.version } : {}),
        ...(distributionDecision ? { contractPath: 'distribution', decision: action === 'accept' ? 'approved' : 'rejected' } : {}),
        ...(action === 'select_provider' && cur.providerId ? { previousProviderId: cur.providerId } : {}),
        ...(discardedOffers.length ? { discardedUnsentOfferIds: discardedOffers } : {}),
        ...(verificationId ? { registryResult: 'valid', registryVerificationId: verificationId } : {}),
      },
    });

    // قبول حساب المصنع المسجَّل ذاتيًا يتبع قرار IMC على الطلب نفسه (نفس المعاملة) — services/factoryAccount.ts.
    const accountEvent = await syncFactoryAccount(cur, cur.state, def.to, action, user, ctx.ip);

    if (p.deficiencies && (action === 'request_correction' || action === 'non_compliant')) {
      for (const d of p.deficiencies) await insertDeficiency(cur.id, t.id, cur.state, d.field, d.note || (p.reason ?? ''));
    }
    if (def.actorRole === 'factory_owner' && action !== 'withdraw' && open.length) await resolveDeficiencies(cur.id, t.id);

    // بيانات المراحل: نسخة لكل محاولة في application_data + أعمدة حقيقية للاستعلام.
    if (action === 'select_provider') await writeSection(cur.id, 'provider', nextAttempt, { providerId: p.providerId }, user.id);
    if (action === 'submit_electricity') await writeSection(cur.id, 'electricity', nextAttempt, { distributionCompany: p.distributionCompany }, user.id);
    if (action === 'select_bank') {
      // سجل البنك المختار ونتيجة التعاقد (جدول bank_referrals يحفظ اختيار المصنع؛ لا إحالة ولا دراسة داخل المنصة — G-02).
      await db.prepare(`INSERT INTO shams_bank_referrals (id, applicationId, bankOrgId, referredAt, referredBy) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(applicationId) DO UPDATE SET bankOrgId = excluded.bankOrgId, referredAt = excluded.referredAt, referredBy = excluded.referredBy`)
        .run(`ref-${randomUUID()}`, cur.id, p.bankOrgId!, now, user.id);
      await writeSection(cur.id, 'bank_result', nextAttempt, { bankOrgId: p.bankOrgId }, user.id);
    }
    if (action === 'reject' && p.reasonCode === 'registry_ownership_mismatch') {
      const regNumber = cur.verifiedRegistryNumber ?? cur.industrialRegistryNumber;
      if (regNumber) await insertBlock({ factoryId: cur.factoryId, registryNumber: regNumber, applicationId: cur.id, transitionId: t.id, source: 'imc_reject', createdBy: user.id });
      if (regNumber) {
        const blockedVars = { appId: cur.id, number: cur.number, companyName: cur.companyName, registryNumber: regNumber };
        await dispatch('registry.blocked', blockedVars, [...await factoryRecipients(cur), ...await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer')], { dedupePrefix: `rbl:${t.id}`, applicationId: cur.id, channels: ['email'] });
      }
    }
    if (action === 'record_contract') {
      await db.prepare(`UPDATE shams_bank_referrals SET contractStatus = 'contracted', contractDate = ?, contractAmount = ?, contractNotes = ?, outcomeRecordedBy = ?, outcomeRecordedAt = ? WHERE applicationId = ?`)
        .run(p.contractDate!, p.contractAmount!, p.contractNotes ?? '', user.id, now, cur.id);
      await writeSection(cur.id, 'contract', nextAttempt, { contractStatus: 'contracted', contractDate: p.contractDate, contractAmount: p.contractAmount, contractNotes: p.contractNotes ?? '' }, user.id);
    }
    if (action === 'record_no_contract') {
      await db.prepare(`UPDATE shams_bank_referrals SET contractStatus = 'not_contracted', notContractedReason = ?, contractNotes = ?, outcomeRecordedBy = ?, outcomeRecordedAt = ? WHERE applicationId = ?`)
        .run(p.reason!, p.contractNotes ?? '', user.id, now, cur.id);
      await writeSection(cur.id, 'contract', nextAttempt, { contractStatus: 'not_contracted', notContractedReason: p.reason, contractNotes: p.contractNotes ?? '' }, user.id);
    }
    // ── مسار شركة توزيع الكهرباء: صف النتيجة (مقابل bank_referrals) ──
    if (action === 'select_distribution_path') {
      await db.prepare('INSERT INTO shams_distribution_contracts (id, applicationId, selectedAt, selectedBy) VALUES (?, ?, ?, ?)')
        .run(`dc-${randomUUID()}`, cur.id, now, user.id);
    }
    if (distributionDoc) {
      await db.prepare(`UPDATE shams_distribution_contracts SET submittedAt = ?, submittedBy = ?, submissionCount = submissionCount + 1, approvalDocumentId = ?, reviewStatus = 'pending'
        WHERE applicationId = ?`).run(now, user.id, distributionDoc.id, cur.id);
    }
    if (distributionDecision) {
      const status = action === 'accept' ? 'approved' : 'rejected';
      const notes = (action === 'accept' ? p.note : p.reason) ?? '';
      const r = await db.prepare(`UPDATE shams_distribution_contracts SET reviewStatus = ?, decidedBy = ?, decidedAt = ?, decisionNotes = ? WHERE applicationId = ? AND reviewStatus = 'pending'`)
        .run(status, user.id, now, notes, cur.id);
      if (Number(r.changes) !== 1) throw versionConflict();
      await writeSection(cur.id, 'contract', nextAttempt, { contractPath: 'distribution', contractStatus: action === 'accept' ? 'contracted' : 'not_contracted', decisionNotes: notes }, user.id);
    }
    if (formData && action === 'submit' && formData.general?.companyName) await renameFactory(cur.factoryId, String(formData.general.companyName));

    const after = (await getApplication(cur.id))!;
    await addAuditLog({
      actorType: 'user', ...actor, ip: ctx.ip, action: `application.${action}`, entityType: 'application', entityId: cur.id, applicationId: cur.id,
      summaryAr: `${def.labelAr}: ${STATE_LABELS[cur.state].ar} ← ${STATE_LABELS[def.to].ar}`,
      details: { fromState: cur.state, toState: def.to, attempt: nextAttempt, version: after.version, transitionId: t.id, deficiencies: p.deficiencies?.length ?? 0 },
    });
    await notifyTransition({
      // مسار شركة التوزيع: ملاحظة المصنع عند الإرسال وملاحظة PMU عند القبول تظهر في الرسالة (بقية المراحل كما كانت: السبب فقط).
      app: after, def, transition: t, reason: p.reason ?? (cur.state === 'DISTRIBUTION_UPLOAD' || cur.state === 'DISTRIBUTION_REVIEW' ? p.note : undefined), accountEvent,
      deficiencies: p.deficiencies && (action === 'request_correction' || action === 'non_compliant') ? deficiencyLabels(p.deficiencies) : undefined,
      isResubmission: action === 'resubmit' || (action === 'submit_electricity' && t.attempt > 0 && cur.state === 'ELECTRICITY_UPLOAD' && await hasPriorReview(cur.id)),
      bankNameAr: after.bankOrgId ? (await getOrganization(after.bankOrgId))?.nameAr : undefined,
    });
    if (action === 'record_contract' && p.contractAmount! > shamsPolicy.contractAmountAlertEGP) {
      // I8: تنبيه فقط — لا رفض. القيمة مسجلة من المصنع.
      await dispatch('ops.contract_amount_alert', { appId: after.id, number: after.number, companyName: after.companyName, amount: p.contractAmount, threshold: shamsPolicy.contractAmountAlertEGP },
        await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer'), { dedupePrefix: t.id, applicationId: after.id, channels: ['email'] });
    }
    const eventId = randomUUID();
    await enqueueWebhook(eventId, 'application.state_changed', t.id, {
      id: eventId, type: 'application.state_changed', occurredAt: now,
      data: { applicationId: after.id, number: after.number, fromState: cur.state, toState: def.to, action, actorRole: user.role, actorOrgId: user.organizationId, attempt: nextAttempt, version: after.version },
    }, !(config.platformWebhookUrl && config.platformWebhookSecret));
    return { failedRegistry: null };
  });
  } catch (e) {
    // F-08: خسر هذا الطلب سباقًا على رقم السجل (فحص داخل المعاملة أو الفهرس الفريد) — يُسجَّل التعارض ويُبلَّغ IMC وPMU كما في المسار العادي (I3).
    // يعمل بعد التراجع، في معاملته الخاصة؛ والرسالة الأوضح تقول إن الإبلاغ تم.
    if (e instanceof AppError && e.code === 'DUPLICATE_REGISTRY' && formData) {
      const holder = await findOpenSubmittedByRegistry(regNumber, app.id);
      if (holder) {
        await recordRegistryConflict(user, app, holder, regNumber, ctx.ip, String(formData.general?.companyName ?? app.companyName));
        throw duplicateRegistryError();
      }
    }
    throw e;
  }

  if (outcome.failedRegistry) {
    const unavailable = outcome.failedRegistry === 'unavailable';
    throw new AppError(422, unavailable ? 'REGISTRY_UNAVAILABLE' : 'REGISTRY_INVALID',
      unavailable ? 'تعذر التحقق من السجل الصناعي حاليًا. الطلب محفوظ — أعد المحاولة لاحقًا.' : 'رقم السجل الصناعي غير صحيح أو غير مسجل. صحّح الرقم وأعد الإرسال — بياناتك محفوظة.',
      unavailable ? 'The industrial registry is unavailable right now. Your application is saved — retry later.' : 'The industrial registry number is invalid. Correct it and submit again — your data is saved.',
      [{ field: 'industrialRegistryNumber', issue: outcome.failedRegistry }]);
  }
  // Shared profile write-back: only after the submission committed, only from the submitted form.
  if (formData && (action === 'submit' || action === 'resubmit')) {
    await syncProfileAfterSubmit({ userId: user.id, actorName: user.nameAr, factoryId: app.factoryId, form: formData });
  }
  return (await getApplication(app.id))!;
}

/**
 * I3: محاولة إرسال برقم سجل يحجزه طلب مفتوح لمصنع آخر — يُسجل التعارض ويُبلَّغ IMC وPMU برقمي الطرفين (مرة لكل زوج).
 * معاملة مستقلة لأن الإرسال نفسه يُرفض بعدها.
 */
async function recordRegistryConflict(user: UserInternal, app: AppRow, holder: AppRow, regNumber: string, ip: string, attemptedName: string): Promise<void> {
  await tx(async () => {
    const c = await recordConflict({ registryNumber: regNumber, attemptedApplicationId: app.id, attemptedFactoryId: app.factoryId, holdingApplicationId: holder.id, attemptedBy: user.id });
    await addAuditLog({ actorType: 'user', actorUserId: user.id, actorName: user.nameAr, actorRole: user.role, actorOrgId: user.organizationId, ip,
      action: 'application.registry_conflict', entityType: 'application', entityId: app.id, applicationId: app.id,
      summaryAr: `محاولة إرسال برقم سجل يحجزه الطلب ${holder.number ?? holder.id}`, details: { conflictId: c.id, registryNumber: regNumber, holdingApplicationId: holder.id } });
    if (!c.first) return;
    await dispatch('ops.registry_conflict', {
      appId: holder.id, number: holder.number, companyName: holder.companyName, registryNumber: regNumber,
      otherNumber: app.number, otherCompanyName: attemptedName,
    }, [...await orgRecipients(ORG_IDS.imc, 'imc_reviewer'), ...await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer')], { dedupePrefix: `conflict:${c.id}`, applicationId: holder.id, channels: ['email'] });
  });
  kickNotificationWorker();
}

async function hasPriorReview(appId: string): Promise<boolean> {
  return Boolean(await getDb().prepare("SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND fromState = 'ELECTRICITY_REVIEW' LIMIT 1").get(appId));
}
