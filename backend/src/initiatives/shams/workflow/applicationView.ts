/** بناء ردود الطلب حسب المستخدم: البيانات المسموح بها فقط + allowedActions + currentTask. */
import type { UserInternal } from '../store/users.js';
import { mapSeq, filterSeq } from '../http/helpers.js';
import {
  getApplication, getSection, listTransitions, listDeficiencies, openDeficiencies, getBankReferral, getRegistryVerification, latestRegistryVerification, referralHistory,
  getDistributionContract, findOpenSubmittedByRegistry, type AppRow, type TransitionRow,
} from '../store/applications.js';
import { listDocuments, isActiveAt, wasSubmitted, type DocumentRow } from '../store/documents.js';
import { getOrganization, getOrganizationsByIds, isBankAvailable, type Organization } from '../store/organizations.js';
import { getUserNamesByIds } from '../store/users.js';
import { getProvider, isSelectable } from '../store/providers.js';
import { conflictsForApplication, listObjections, pendingObjectionAgainst, registryAccess } from '../store/registry.js';
import { AppError, Errors } from '../http/errors.js';
import {
  allowedActions, STATE_LABELS, STATE_RESPONSIBLE, RESPONSIBLE_LABELS, RETURN_ACTIONS, stateStep, stateTask,
  FORM_CORRECTION_STATES, responsibleOrgId, isTerminal, type ApplicationState, type AllowedAction, type ActionName,
} from './shamsWorkflow.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import {
  visibleDeficiencies, visibleDocuments, visibleSections, visibleTransitions, viewAttempt, isFactoryOwnerOf,
} from '../access/visibility.js';
import { FORM_SECTIONS, FIELD_BY_KEY, DOCUMENT_LABELS, docKindForField, fieldForDocKind, type DataSection } from './applicationForm.js';
import { ALL_FORM_FIELD_KEYS, normalizeRegistryNumber } from './validate.js';
import type { FormFieldKey } from '../config/shamsPolicy.js';

/** I5: هل حُددت أي مهلة؟ لا مهلة = لا معنى لعدّ «متأخرة: 0». */
export function slaConfigured(): boolean {
  return Object.values(shamsPolicy.slaDays).some((d) => d !== null && d !== undefined);
}

export interface SlaInfo { slaDays: number | null; dueAt: string | null; overdue: boolean; daysInState: number }

export function slaInfo(app: Pick<AppRow, 'state' | 'stateEnteredAt'>, now = Date.now()): SlaInfo {
  const entered = Date.parse(app.stateEnteredAt);
  const daysInState = Math.max(0, Math.floor((now - entered) / 86_400_000));
  const days = isTerminal(app.state) ? null : (shamsPolicy.slaDays[app.state] ?? null);
  if (days === null || days === undefined) return { slaDays: null, dueAt: null, overdue: false, daysInState };
  const due = entered + days * 86_400_000;
  return { slaDays: days, dueAt: new Date(due).toISOString(), overdue: now > due, daysInState };
}

/**
 * PERF-3: organizations already loaded for a list page or an export (preloadListOrgs), keyed by id; null = not found.
 * Without it every list row looked its organizations up one by one (750 queries for one IMC work list with ?mine=1).
 */
export type OrgCache = Map<string, Organization | null>;

async function orgLabel(orgId: string | null, orgs?: OrgCache) {
  if (!orgId) return null;
  const o = orgs?.has(orgId) ? orgs.get(orgId)! : await getOrganization(orgId);
  return o ? { id: o.id, nameAr: o.nameAr, nameEn: o.nameEn, type: o.type } : null;
}

/** Loads, in one query, every organization that buildListItem / responsibleInfo will show for these rows. */
export async function preloadListOrgs(apps: AppRow[]): Promise<OrgCache> {
  const ids = new Set<string>();
  for (const a of apps) { const r = responsibleOrgId(a); if (r) ids.add(r); if (a.bankOrgId) ids.add(a.bankOrgId); }
  const found = await getOrganizationsByIds(ids);
  const cache: OrgCache = new Map();
  for (const id of ids) cache.set(id, found.get(id) ?? null);
  return cache;
}

export async function responsibleInfo(app: AppRow, orgs?: OrgCache) {
  const type = STATE_RESPONSIBLE[app.state];
  const org = await orgLabel(responsibleOrgId(app), orgs);
  return {
    type, labelAr: RESPONSIBLE_LABELS[type].ar, labelEn: RESPONSIBLE_LABELS[type].en,
    orgId: org?.id ?? null, orgNameAr: org?.nameAr ?? null, orgNameEn: org?.nameEn ?? null,
  };
}

/**
 * قيود السياسة فوق جدول الانتقالات — نفس الدالة تحدد الأزرار وترفض التنفيذ في السيرفر:
 * البنك يُختار مرة واحدة ثم تُسجَّل النتيجة (G-01)؛ مقدم خدمة لم يعد معتمدًا → لا إرسال عرض، ويُتاح إعادة الاختيار (I11).
 */
export async function actionBlock(app: AppRow, action: ActionName): Promise<AppError | null> {
  // D4: while another factory's objection to this registry number is under PMU review, the holder's application does not move
  // forward (withdrawal stays possible). PMU's decision unfreezes it — or closes it (registryDisputes.ts).
  if (action !== 'withdraw' && app.state !== 'DRAFT' && app.industrialRegistryNumber && await pendingObjectionAgainst(app.industrialRegistryNumber, app.factoryId)) {
    return Errors.conflict('REGISTRY_DISPUTE_OPEN', 'على رقم السجل الصناعي لهذا الطلب اعتراض قيد مراجعة وحدة إدارة المبادرة — لا يتقدم الطلب حتى صدور قرارها.',
      "An objection to this application's registry number is under PMU review — the application cannot move forward until the decision.");
  }
  if (app.state === 'CONTRACT_OUTCOME') {
    if (action === 'select_bank' && app.bankOrgId) {
      return Errors.conflict('BANK_ALREADY_SELECTED', 'سُجّل البنك المختار لهذا الطلب بالفعل.', 'A bank has already been chosen for this application.');
    }
    if ((action === 'record_contract' || action === 'record_no_contract') && !app.bankOrgId) {
      return Errors.conflict('BANK_NOT_SELECTED', 'اختر البنك أولًا، ثم سجّل نتيجة التعاقد.', 'Choose the bank first, then record the contract outcome.');
    }
    // D2: no contract is recorded with a bank that is no longer active (deactivation releases the application first).
    if (action === 'record_contract' && app.bankOrgId && !await isBankAvailable(app.bankOrgId)) {
      return Errors.conflict('BANK_INACTIVE', 'البنك المختار لم يعد نشطًا — اختر بنكًا نشطًا آخر قبل تسجيل التعاقد.', 'The chosen bank is no longer active — choose another active bank before recording the contract.');
    }
    // مسار التعاقد يُختار مرة واحدة: بعد اختيار بنك لا يُتاح مسار شركة التوزيع (والعكس مضمون بالحالة DISTRIBUTION_* نفسها).
    if (action === 'select_distribution_path' && (app.bankOrgId || app.contractPath)) {
      return Errors.conflict('CONTRACT_PATH_LOCKED', 'سُجّل مسار التعاقد لهذا الطلب بالفعل ولا يمكن تغييره.', 'The contracting path for this application is already set and cannot be changed.');
    }
    if (action === 'select_bank' && app.contractPath === 'distribution') {
      return Errors.conflict('CONTRACT_PATH_LOCKED', 'هذا الطلب على مسار التعاقد عن طريق شركة التوزيع — لا يمكن اختيار بنك.', 'This application is on the distribution company path — a bank cannot be chosen.');
    }
  }
  if (app.state === 'OFFER_UPLOAD') {
    const approved = app.providerId ? isSelectable(await getProvider(app.providerId)) : false;
    if (action === 'submit_offer' && !approved) {
      return new AppError(422, 'PROVIDER_SUSPENDED', 'مقدم الخدمة المختار لم يعد معتمدًا — اختر مقدم خدمة معتمدًا آخر قبل إرسال العرض.',
        'The selected service provider is no longer approved — choose another approved provider before submitting the offer.', [{ field: 'providerId', issue: 'not approved' }]);
    }
    if (action === 'select_provider' && approved) {
      return Errors.conflict('INVALID_STATE', 'مقدم الخدمة المختار ما زال معتمدًا — لا يمكن تغييره في هذه المرحلة.', 'The selected provider is still approved and cannot be changed at this stage.');
    }
  }
  return null;
}

/** الإجراءات المتاحة بعد تطبيق قيود السياسة. */
export async function effectiveActions(user: UserInternal, app: AppRow): Promise<AllowedAction[]> {
  return filterSeq(allowedActions({ role: user.role, organizationId: user.organizationId }, app), async (a) => !(await actionBlock(app, a.action)));
}

/** الأدمن يرى البيانات الوصفية فقط ما لم تسمح السياسة (shamsPolicy.adminCanViewApplicationDocuments). API الربط له عرضه الوصفي الخاص (integration/metadataView.ts). */
export function adminMetadataOnly(user: UserInternal): boolean {
  return user.role === 'system_admin' && !shamsPolicy.adminCanViewApplicationDocuments;
}

const REGISTRY_FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  registryNumber: { ar: 'رقم السجل', en: 'Registry number' },
  facilityName: { ar: 'اسم المنشأة في السجل', en: 'Facility name (registry)' },
  activity: { ar: 'النشاط', en: 'Activity' },
  governorate: { ar: 'المحافظة', en: 'Governorate' },
  status: { ar: 'حالة القيد', en: 'Registration status' },
};
const REGISTRY_STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  active: { ar: 'سارٍ', en: 'Active' }, suspended: { ar: 'موقوف', en: 'Suspended' }, cancelled: { ar: 'ملغى', en: 'Cancelled' },
};

/** تطبيع اسم للمقارنة: بلا تشكيل ولا مسافات زائدة، والألف/الياء/التاء المربوطة موحدة. */
function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

/** بيانات السجل بتسميات عربية + مقارنة الاسم بالطلب (تمييز فقط، لا منع آلي — I3/M1). */
export function registryView(facility: Record<string, unknown> | null, companyName: string) {
  const fields = facility ? Object.entries(facility).filter(([, v]) => typeof v === 'string' && v).map(([k, v]) => {
    const l = REGISTRY_FIELD_LABELS[k] ?? { ar: k, en: k };
    const st = k === 'status' ? REGISTRY_STATUS_LABELS[String(v)] : undefined;
    return { key: k, labelAr: l.ar, labelEn: l.en, valueAr: st?.ar ?? String(v), valueEn: st?.en ?? String(v) };
  }) : [];
  const registryName = typeof facility?.facilityName === 'string' ? facility.facilityName : null;
  const nameCheck = registryName ? {
    applicationName: companyName, registryName,
    matches: Boolean(normalizeName(companyName)) && (normalizeName(registryName).includes(normalizeName(companyName)) || normalizeName(companyName).includes(normalizeName(registryName))),
  } : null;
  return { fields, nameCheck };
}

/** M8: بنود النواقص المفتوحة التي لم يُعدَّل فيها شيء منذ آخر إرسال (تنبيه فقط). */
async function unchangedDeficiencies(app: AppRow, open: Array<{ field: string }>): Promise<string[]> {
  const pending = app.attempt + 1;
  return filterSeq([...new Set(open.map((d) => d.field))], async (field) => {
    const kind = docKindForField(field);
    // تغيير المستند = نسخة جديدة سارية في المحاولة القادمة، أو إزالة نسخة أُرسلت سابقًا. رفعٌ ثم إزالته قبل الإرسال ليس تغييرًا.
    if (kind) return !(await listDocuments(app.id)).some((d) => d.kind === kind
      && ((d.attempt === pending && d.supersededAtAttempt === null) || (d.status === 'removed' && d.attempt < pending && d.supersededAtAttempt === pending)));
    const def = FIELD_BY_KEY.get(field as FormFieldKey);
    if (!def) return false;
    const before = (await getSection(app.id, def.section, app.attempt))?.[field];
    const now = (await getSection(app.id, def.section))?.[field];
    return JSON.stringify(before ?? null) === JSON.stringify(now ?? null);
  });
}

function fieldLabel(field: string): { ar: string; en: string } {
  const f = FIELD_BY_KEY.get(field as FormFieldKey);
  if (f) return { ar: f.labelAr, en: f.labelEn };
  if (field === 'technicalOfferFile') return DOCUMENT_LABELS.technicalOfferFile;
  if (field === 'electricityApprovalFile') return DOCUMENT_LABELS.electricityApprovalFile;
  if (field === 'distributionApprovalFile') return DOCUMENT_LABELS.distributionApprovalFile;
  if (field === 'distributionCompany') return { ar: 'شركة التوزيع', en: 'Distribution company' };
  if (field === 'bankOrgId') return { ar: 'البنك', en: 'Bank' };
  return { ar: field, en: field };
}

export function deficiencyLabels(items: Array<{ field: string; note: string }>) {
  return items.map((d) => { const l = fieldLabel(d.field); return { labelAr: l.ar, labelEn: l.en, note: d.note }; });
}

function mapTransition(t: TransitionRow) {
  return {
    id: t.id, fromState: t.fromState, toState: t.toState, action: t.action, actorRole: t.actorRole, actorOrgId: t.actorOrgId,
    actorName: t.actorName, reason: t.reason, attempt: t.attempt, createdAt: t.createdAt,
    fromLabelAr: STATE_LABELS[t.fromState].ar, fromLabelEn: STATE_LABELS[t.fromState].en,
    toLabelAr: STATE_LABELS[t.toState].ar, toLabelEn: STATE_LABELS[t.toState].en,
    registryResult: (t.payload.registryResult as string | undefined) ?? null,
  };
}

function mapDocument(d: DocumentRow, app: AppRow, downloadable: boolean, names: Map<string, string>) {
  return {
    downloadable, uploadedByName: names.get(d.uploadedBy) ?? '',
    id: d.id, kind: d.kind, field: fieldForDocKind(d.kind), labelAr: DOCUMENT_LABELS[d.kind].ar, labelEn: DOCUMENT_LABELS[d.kind].en,
    version: d.version, attempt: d.attempt, status: d.status, uploadedInState: d.uploadedInState,
    isCurrent: d.supersededAtAttempt === null, submitted: wasSubmitted(d, app.attempt),
    originalName: d.originalName, sizeBytes: d.sizeBytes, sha256: d.sha256, createdAt: d.createdAt,
  };
}

/** عدد مرات الإرجاع لكل مرحلة (يُعرض لـ PMU). */
export function returnCounts(transitions: TransitionRow[]): Partial<Record<ApplicationState, number>> {
  const out: Partial<Record<ApplicationState, number>> = {};
  for (const t of transitions) {
    if (RETURN_ACTIONS.some((r) => r.from === t.fromState && r.action === t.action)) out[t.fromState] = (out[t.fromState] ?? 0) + 1;
  }
  return out;
}

/**
 * PR-P2: the two per-application flags the dashboard counts. One function for both the work list and the dashboard, so the
 * card numbers keep matching the rows; the dashboard no longer builds full list items (organisation lookups) for every application.
 */
export async function listFlags(user: UserInternal, app: AppRow): Promise<{ isMine: boolean; overdue: boolean }> {
  return { isMine: (await effectiveActions(user, app)).some((a) => a.action !== 'withdraw'), overdue: slaInfo(app).overdue };
}

export async function buildListItem(user: UserInternal, app: AppRow, orgs?: OrgCache) {
  const sla = slaInfo(app);
  const flags = await listFlags(user, app);
  const bank = (user.role === 'pmu_reviewer' || user.role === 'system_admin' || isFactoryOwnerOf(user, app))
    ? await orgLabel(app.bankOrgId, orgs) : null;
  return {
    id: app.id, number: app.number, state: app.state, stateLabelAr: STATE_LABELS[app.state].ar, stateLabelEn: STATE_LABELS[app.state].en,
    step: stateStep(app), companyName: app.companyName, governorate: app.governorate, industrialZone: app.industrialZone,
    industrialRegistryNumber: app.industrialRegistryNumber, totalRoofArea: app.totalRoofArea, attempt: app.attempt, version: app.version,
    submittedAt: app.submittedAt, stateEnteredAt: app.stateEnteredAt, closedAt: app.closedAt, createdAt: app.createdAt, updatedAt: app.updatedAt,
    responsible: await responsibleInfo(app, orgs), isMine: flags.isMine, overdue: flags.overdue, dueAt: sla.dueAt,
    daysInState: sla.daysInState, bank: bank ? { id: bank.id, nameAr: bank.nameAr, nameEn: bank.nameEn } : null,
    contractPath: app.contractPath,
  };
}

export async function buildDetail(user: UserInternal, app: AppRow) {
  const sections = visibleSections(user);
  const metaOnly = adminMetadataOnly(user);
  const maxAttempt = viewAttempt(user, app);
  const isOwner = isFactoryOwnerOf(user, app);
  const data: Partial<Record<DataSection, Record<string, unknown>>> = {};
  for (const s of [...FORM_SECTIONS, 'provider', 'electricity', 'bank_result', 'contract'] as DataSection[]) {
    if (!sections.has(s) || (metaOnly && s !== 'provider')) continue;
    const d = await getSection(app.id, s, maxAttempt);
    if (d) data[s] = d;
  }
  const allTransitions = await listTransitions(app.id);
  const transitions = visibleTransitions(user, allTransitions);
  const deficiencies = visibleDeficiencies(user, await listDeficiencies(app.id));
  const open = await openDeficiencies(app.id);
  const actions = await effectiveActions(user, app);
  const sla = slaInfo(app);
  const docs = visibleDocuments(user, app, await listDocuments(app.id));
  const registry = await getRegistryVerification(app.registryVerificationId) ?? (isOwner ? await latestRegistryVerification(app.id) : null);
  const referral = await getBankReferral(app.id);
  const seesStageData = sections.has('provider');
  const distribution = seesStageData ? await getDistributionContract(app.id) : null;
  const names = await getUserNamesByIds(new Set([...docs.map((d) => d.uploadedBy), ...(distribution?.decidedBy ? [distribution.decidedBy] : []), ...(distribution?.selectedBy ? [distribution.selectedBy] : [])]));

  const showOpenDefs = isOwner || user.role === 'pmu_reviewer' || user.role === 'system_admin'
    || (user.role === 'imc_reviewer' && app.state === 'IMC_CORRECTION') || (user.role === 'encpc_reviewer' && (app.state === 'ENCPC_CORRECTION'));
  const openList = showOpenDefs ? open.map((d) => ({ id: d.id, stage: d.stage, field: d.field, note: metaOnly ? '' : d.note, ...(() => { const l = fieldLabel(d.field); return { labelAr: l.ar, labelEn: l.en }; })() })) : [];

  let editableFields: string[] = [];
  if (isOwner && app.state === 'DRAFT') editableFields = [...ALL_FORM_FIELD_KEYS];
  else if (isOwner && FORM_CORRECTION_STATES.includes(app.state)) editableFields = open.map((d) => d.field).filter((f) => ALL_FORM_FIELD_KEYS.has(f));

  const provider = seesStageData && app.providerId ? await getProvider(app.providerId) : null;
  const conflicts = (user.role === 'imc_reviewer' || user.role === 'pmu_reviewer' || metaOnly) ? await mapSeq(await conflictsForApplication(app.id), async (c) => {
    const holds = c.holdingApplicationId === app.id;
    const other = await getApplication(holds ? c.attemptedApplicationId : c.holdingApplicationId);
    return { id: c.id, registryNumber: c.registryNumber, thisApplicationHoldsNumber: holds, attempts: c.attempts, createdAt: c.createdAt, lastAttemptAt: c.lastAttemptAt,
      other: other ? { id: other.id, number: other.number, companyName: other.companyName, state: other.state, stateLabelAr: STATE_LABELS[other.state].ar, stateLabelEn: STATE_LABELS[other.state].en } : null };
  }) : [];
  const regView = registry && !metaOnly ? registryView(registry.facilityData, app.companyName) : null;
  const registryHold = isOwner && (app.state === 'DRAFT' || app.state === 'IMC_CORRECTION') ? await holdOf(app, data) : null;
  const bank = seesStageData ? await orgLabel(app.bankOrgId) : null;
  const canSeeAllHistory = user.role === 'pmu_reviewer' || user.role === 'system_admin';

  return {
    ...await buildListItem(user, app),
    factoryId: isOwner || canSeeAllHistory ? app.factoryId : undefined,
    data,
    registry: registry ? {
      result: registry.result, registryNumber: registry.registryNumber, checkedAt: registry.checkedAt, errorCode: registry.errorCode,
      facility: metaOnly ? null : registry.facilityData, fields: regView?.fields ?? [], nameCheck: regView?.nameCheck ?? null,
    } : null,
    registryConflicts: conflicts,
    // D4: frozen by an objection under PMU review (only withdrawal remains).
    registryDisputeOpen: !isTerminal(app.state) && app.state !== 'DRAFT' && Boolean(app.industrialRegistryNumber) && await pendingObjectionAgainst(app.industrialRegistryNumber!, app.factoryId),
    // F2 / D3: the owner's draft holds a number used by another open application (or on hold) → the objection is offered.
    registryHold,
    provider: provider ? { id: provider.id, nameAr: provider.nameAr, nameEn: provider.nameEn, contactName: metaOnly ? '' : provider.contactName, contactPhone: metaOnly ? '' : provider.contactPhone, contactEmail: metaOnly ? '' : provider.contactEmail, status: provider.status,
      description: provider.description, isActive: provider.isActive === 1, selectable: isSelectable(provider) } : null,
    referralHistory: seesStageData ? await mapSeq(await referralHistory(app.id), async (h) => {
      const org = await getOrganization(h.bankOrgId);
      return { bankOrgId: h.bankOrgId, bankNameAr: org?.nameAr ?? h.bankOrgId, bankNameEn: org?.nameEn ?? h.bankOrgId, referredAt: h.referredAt, endedAt: h.endedAt, endReason: metaOnly ? '' : h.endReason };
    }) : [],
    bank: bank ? { id: bank.id, nameAr: bank.nameAr, nameEn: bank.nameEn } : null,
    bankReferral: referral && seesStageData ? {
      referredAt: referral.referredAt, studyResult: referral.studyResult, studyDate: referral.studyDate, bankNotes: metaOnly ? '' : referral.bankNotes,
      contractStatus: referral.contractStatus, contractDate: referral.contractDate, contractAmount: metaOnly ? null : referral.contractAmount,
      contractAmountRecordedBy: 'factory' as const,
      contractAmountAboveAlert: referral.contractAmount !== null && referral.contractAmount > shamsPolicy.contractAmountAlertEGP,
      contractNotes: metaOnly ? '' : referral.contractNotes, notContractedReason: metaOnly ? '' : referral.notContractedReason,
    } : null,
    // التعاقد عن طريق شركة توزيع الكهرباء: الاختيار والإرسال وقرار PMU (لمن يرى بيانات المراحل اللاحقة فقط).
    distributionContract: distribution ? {
      selectedAt: distribution.selectedAt, selectedByName: names.get(distribution.selectedBy ?? '') ?? '',
      submittedAt: distribution.submittedAt, submissionCount: distribution.submissionCount, approvalDocumentId: distribution.approvalDocumentId,
      reviewStatus: distribution.reviewStatus, decidedAt: distribution.decidedAt, decidedByName: metaOnly ? '' : names.get(distribution.decidedBy ?? '') ?? '',
      decisionNotes: metaOnly ? '' : distribution.decisionNotes,
    } : null,
    documents: docs.map((d) => mapDocument(d, app, !metaOnly, metaOnly ? new Map() : names)),
    transitions: transitions.map(mapTransition).map((t) => (metaOnly ? { ...t, reason: '' } : t)),
    deficiencies: deficiencies.map((d) => ({ id: d.id, stage: d.stage, field: d.field, note: metaOnly ? '' : d.note, resolved: d.resolvedAtTransitionId !== null, createdAt: d.createdAt, ...(() => { const l = fieldLabel(d.field); return { labelAr: l.ar, labelEn: l.en }; })() })),
    returnCounts: canSeeAllHistory ? returnCounts(allTransitions) : undefined,
    allowedActions: actions,
    editableFields,
    currentTask: isTerminal(app.state) ? null : {
      state: app.state,
      labelAr: stateTask(app).ar,
      labelEn: stateTask(app).en,
      responsible: await responsibleInfo(app),
      isMine: actions.some((a) => a.action !== 'withdraw'),
      dueAt: sla.dueAt, overdue: sla.overdue, slaDays: sla.slaDays, daysInState: sla.daysInState,
      deficiencies: openList,
    },
    pendingAttempt: isOwner ? app.attempt + 1 : undefined,
    unchangedDeficiencies: isOwner && FORM_CORRECTION_STATES.includes(app.state) ? await unchangedDeficiencies(app, open) : undefined,
    metadataOnly: metaOnly || undefined,
    hasPendingDocuments: isOwner ? docs.some((d) => !isActiveAt(d, app.attempt) && d.attempt > app.attempt) : undefined,
  };
}

export type ApplicationDetail = ReturnType<typeof buildDetail>;

/**
 * F2 / D3: is the owner's draft held on its registry number? `in_use` = another factory's open application holds it,
 * `blocked` / `reserved` = on hold until a documented PMU decision. Carries the factory's own latest objection on that number.
 */
async function holdOf(app: AppRow, data: Partial<Record<DataSection, Record<string, unknown>>>) {
  const raw = String(data.company?.industrialRegistryNumber ?? app.industrialRegistryNumber ?? '').trim();
  if (!raw) return null;
  const registryNumber = normalizeRegistryNumber(raw);
  const access = await registryAccess(registryNumber, app.factoryId);
  const holder = await findOpenSubmittedByRegistry(registryNumber, app.id);
  const inUse = Boolean(holder && holder.factoryId !== app.factoryId);
  if (access.allowed && !inUse) return null;
  const mine = (await listObjections({ factoryId: app.factoryId })).filter((o) => o.registryNumber === registryNumber);
  const latest = mine.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  return { registryNumber, reason: inUse ? 'in_use' as const : (access.allowed ? 'blocked' as const : access.reason), objection: latest ? { id: latest.id, status: latest.status, decisionReason: latest.decisionReason, decisionReference: latest.decisionReference } : null };
}
