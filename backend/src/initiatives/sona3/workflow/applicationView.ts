import { mapSeq, filterSeq } from '../http/helpers.js';
/** بناء ردود الطلب حسب المستخدم: البيانات المسموح بها فقط + allowedActions + currentTask. */
import type { UserInternal } from '../store/users.js';
import {
  getSection, listTransitions, listDeficiencies, openDeficiencies, type AppRow, type TransitionRow,
} from '../store/applications.js';
import { listDocuments, isActiveAt, type DocumentRow } from '../store/documents.js';
import { getOrganization } from '../store/organizations.js';
import { getExpert } from '../store/experts.js';
import { getCohort } from '../store/cohorts.js';
import { listReferrals, listMilestones, listImpactReports } from '../store/lifecycle.js';
import {
  allowedActions, STATE_LABELS, STATE_RESPONSIBLE, STATE_STEP, STATE_TASKS, RESPONSIBLE_LABELS, RETURN_ACTIONS, CORRECTION_STATES,
  responsibleOrgId, isTerminal, type ApplicationState, type AllowedAction,
} from './workflow.js';
import { policy } from '../config/initiativePolicy.js';
import {
  visibleDeficiencies, visibleDocuments, visibleSections, visibleTransitions, viewAttempt, isApplicantOf,
} from '../access/visibility.js';
import { FORM_SECTIONS, FIELD_BY_KEY, DOCUMENT_LABELS, docKindForField, fieldForDocKind, type DataSection } from './applicationForm.js';
import { studyTotals, type FormData } from './validate.js';
import { ageOn, maskNationalId, parseNationalId } from './nationalId.js';
import { evaluationBlock } from './evaluationService.js';
import { appealInfo } from './lifecycleService.js';
import { isOutOfRank, selectedCount } from './actionService.js';
import { findGovernorate } from '../config/locations.js';

/** هل حُددت أي مهلة؟ لا مهلة = لا معنى لعدّ «متأخرة: 0». */
export function slaConfigured(): boolean {
  return Object.values(policy.slaDays).some((d) => d !== null && d !== undefined);
}

export interface SlaInfo { slaDays: number | null; dueAt: string | null; overdue: boolean; daysInState: number }

export function slaInfo(app: Pick<AppRow, 'state' | 'stateEnteredAt'>, now = Date.now()): SlaInfo {
  const entered = Date.parse(app.stateEnteredAt);
  const daysInState = Math.max(0, Math.floor((now - entered) / 86_400_000));
  const days = isTerminal(app.state) ? null : (policy.slaDays[app.state] ?? null);
  if (days === null || days === undefined) return { slaDays: null, dueAt: null, overdue: false, daysInState };
  const due = entered + days * 86_400_000;
  return { slaDays: days, dueAt: new Date(due).toISOString(), overdue: now > due, daysInState };
}

async function orgLabel(orgId: string | null) {
  if (!orgId) return null;
  const o = await getOrganization(orgId);
  return o ? { id: o.id, nameAr: o.nameAr, nameEn: o.nameEn, type: o.type } : null;
}

export async function responsibleInfo(app: AppRow) {
  const type = STATE_RESPONSIBLE[app.state];
  const org = await orgLabel(responsibleOrgId(app));
  return {
    type, labelAr: RESPONSIBLE_LABELS[type].ar, labelEn: RESPONSIBLE_LABELS[type].en,
    orgId: org?.id ?? null, orgNameAr: org?.nameAr ?? null, orgNameEn: org?.nameEn ?? null,
  };
}

/** الإجراءات المتاحة للمستخدم (السياسة الإضافية تُفحص عند التنفيذ وتُعرض كتلميحات). */
export function effectiveActions(user: UserInternal, app: AppRow): AllowedAction[] {
  return allowedActions({ role: user.role, organizationId: user.organizationId }, app);
}

/** الأدمن يرى البيانات الوصفية فقط ما لم تسمح السياسة. */
export function adminMetadataOnly(user: UserInternal): boolean {
  return user.role === 'system_admin' && user.id !== INTEGRATION_OBSERVER_ID && !policy.adminCanViewApplicationDocuments;
}

/** معرف مراقب API الربط — نطاقاته (read_documents) تُدار بمفاتيح الربط لا بسياسة شاشة الأدمن. */
export const INTEGRATION_OBSERVER_ID = 'integration';

function fieldLabel(field: string): { ar: string; en: string } {
  const f = FIELD_BY_KEY.get(field);
  return f ? { ar: f.labelAr, en: f.labelEn } : { ar: field, en: field };
}

export function deficiencyLabels(items: Array<{ field: string; note: string }>) {
  return items.map((d) => { const l = fieldLabel(d.field); return { labelAr: l.ar, labelEn: l.en, note: d.note }; });
}

function optionLabel(list: ReadonlyArray<{ value: string; labelAr: string; labelEn: string }>, v: string) {
  const o = list.find((x) => x.value === v);
  return { ar: o?.labelAr ?? v, en: o?.labelEn ?? v };
}

/** هل يرى المستخدم الدرجة الإجمالية؟ */
function seesScore(user: UserInternal, app: AppRow): boolean {
  if (user.role === 'imc_officer' || user.role === 'funder_reviewer') return true;
  if (isApplicantOf(user, app)) {
    return !policy.applicantSeesScoreAfterSelection || (STATE_STEP[app.state] >= 5 && app.state !== 'EVALUATED' && app.state !== 'WITHDRAWN');
  }
  return false;
}

function maskIds(user: UserInternal, sectionName: DataSection, d: Record<string, unknown>): Record<string, unknown> {
  if (!policy.maskNationalIdForExternal || (user.role !== 'evaluator' && user.role !== 'funder_reviewer')) return d;
  if (sectionName === 'personal' && typeof d.nationalId === 'string') return { ...d, nationalId: maskNationalId(d.nationalId) };
  if (sectionName === 'team' && Array.isArray(d.partners)) {
    return { ...d, partners: (d.partners as Array<Record<string, unknown>>).map((p) => ({ ...p, nationalId: maskNationalId(p.nationalId as string) })) };
  }
  return d;
}

function mapTransition(t: TransitionRow) {
  return {
    id: t.id, fromState: t.fromState, toState: t.toState, action: t.action, actorRole: t.actorRole, actorOrgId: t.actorOrgId,
    actorName: t.actorName, reason: t.reason, attempt: t.attempt, createdAt: t.createdAt,
    fromLabelAr: STATE_LABELS[t.fromState].ar, fromLabelEn: STATE_LABELS[t.fromState].en,
    toLabelAr: STATE_LABELS[t.toState].ar, toLabelEn: STATE_LABELS[t.toState].en,
  };
}

function mapDocument(d: DocumentRow, app: AppRow, downloadable: boolean) {
  return {
    downloadable,
    id: d.id, kind: d.kind, field: fieldForDocKind(d.kind), labelAr: DOCUMENT_LABELS[d.kind].ar, labelEn: DOCUMENT_LABELS[d.kind].en,
    version: d.version, attempt: d.attempt, status: d.status, uploadedInState: d.uploadedInState,
    isCurrent: d.supersededAtAttempt === null, submitted: d.attempt <= app.attempt,
    originalName: d.originalName, sizeBytes: d.sizeBytes, sha256: d.sha256, createdAt: d.createdAt,
  };
}

/** عدد مرات الإرجاع لكل مرحلة. */
export function returnCounts(transitions: TransitionRow[]): Partial<Record<ApplicationState, number>> {
  const out: Partial<Record<ApplicationState, number>> = {};
  for (const t of transitions) {
    if (RETURN_ACTIONS.some((r) => r.from === t.fromState && r.action === t.action)) out[t.fromState] = (out[t.fromState] ?? 0) + 1;
  }
  return out;
}

/** فحوص الأهلية الآلية لمراجع IMC وللمتقدم (المقترح — رابعًا: الشروط). */
async function eligibilityChecks(app: AppRow, data: FormData) {
  const cohort = await getCohort(app.cohortId);
  const p = data.personal ?? {};
  const id = typeof p.nationalId === 'string' ? parseNationalId(p.nationalId) : null;
  const birth = typeof p.birthDate === 'string' ? p.birthDate : null;
  const refDate = cohort ? (cohort.ageReference === 'cohort_close' ? cohort.closesAt : (app.submittedAt ?? new Date().toISOString()).slice(0, 10)) : null;
  const age = birth && refDate ? ageOn(birth, refDate) : null;
  const partners = Array.isArray(data.team?.partners) ? (data.team!.partners as Array<Record<string, unknown>>) : [];
  const checks = [
    { key: 'age', labelAr: `السن ≤ ${cohort?.maxAge ?? 35} عامًا ${cohort?.ageReference === 'cohort_close' ? 'عند إغلاق باب التقديم' : 'عند التقديم'}`, labelEn: 'Age limit',
      ok: age !== null && cohort ? age <= cohort.maxAge : null, valueAr: age !== null ? `${age} عامًا` : '—' },
    { key: 'nationality', labelAr: 'الجنسية مصرية', labelEn: 'Egyptian nationality', ok: p.nationality ? p.nationality === 'egyptian' : null,
      valueAr: p.nationality === 'other' ? `أخرى: ${String(p.nationalityOther ?? '')}` : p.nationality === 'egyptian' ? 'مصري' : '—' },
    { key: 'nationalId', labelAr: 'الرقم القومي صحيح ويطابق تاريخ الميلاد', labelEn: 'National ID valid and matches birth date',
      ok: id ? id.ok && id.info.birthDate === birth : null, valueAr: id?.ok ? `مواليد ${id.info.birthDate}` : '—' },
    { key: 'partnersAge', labelAr: `أعمار الشركاء ≤ ${cohort?.maxAge ?? 35}`, labelEn: 'Partner ages', ok: partners.length ? partners.every((x) => Number(x.age) <= (cohort?.maxAge ?? 35)) : null,
      valueAr: partners.length ? partners.map((x) => String(x.age ?? '—')).join('، ') : 'لا يوجد شركاء' },
  ];
  return { referenceDate: refDate, checks };
}

export async function buildListItem(user: UserInternal, app: AppRow) {
  const sla = slaInfo(app);
  const actions = effectiveActions(user, app);
  const cohort = await getCohort(app.cohortId);
  const showScore = seesScore(user, app);
  const funder = user.role === 'evaluator' ? null : await orgLabel(app.funderOrgId);
  const gov = findGovernorate(app.governorate);
  return {
    id: app.id, number: app.number, state: app.state, stateLabelAr: STATE_LABELS[app.state].ar, stateLabelEn: STATE_LABELS[app.state].en,
    step: STATE_STEP[app.state], applicantName: app.applicantName, projectName: app.projectName,
    sector: app.sector, sectorLabelAr: app.sector ? optionLabel(policy.sectors, app.sector).ar : '', sectorLabelEn: app.sector ? optionLabel(policy.sectors, app.sector).en : '',
    governorate: app.governorate, governorateLabelAr: gov?.labelAr ?? app.governorate, governorateLabelEn: gov?.labelEn ?? app.governorate,
    cohortId: app.cohortId, cohortNameAr: cohort?.nameAr ?? '', teamSize: app.teamSize,
    estimatedCost: app.estimatedCost, requestedFunding: app.requestedFunding, totalInvestment: app.totalInvestment, expectedJobs: app.expectedJobs,
    score: showScore ? app.score : null, passedMinimums: showScore ? app.passedMinimums : null, isStalled: user.role === 'evaluator' ? false : app.isStalled,
    attempt: app.attempt, version: app.version,
    submittedAt: app.submittedAt, stateEnteredAt: app.stateEnteredAt, closedAt: app.closedAt, createdAt: app.createdAt, updatedAt: app.updatedAt,
    responsible: await responsibleInfo(app), isMine: actions.some((a) => a.action !== 'withdraw'), overdue: sla.overdue, dueAt: sla.dueAt,
    daysInState: sla.daysInState, funder: funder ? { id: funder.id, nameAr: funder.nameAr, nameEn: funder.nameEn } : null,
  };
}

export async function buildDetail(user: UserInternal, app: AppRow) {
  const sections = await visibleSections(user, app);
  const metaOnly = adminMetadataOnly(user);
  const maxAttempt = viewAttempt(user, app);
  const isOwner = isApplicantOf(user, app);
  const isImc = user.role === 'imc_officer';
  const data: Partial<Record<DataSection, Record<string, unknown>>> = {};
  for (const s of [...FORM_SECTIONS, 'approval'] as DataSection[]) {
    if (!sections.has(s) || metaOnly) continue;
    const d = await getSection(app.id, s, maxAttempt);
    if (d) data[s] = maskIds(user, s, d);
  }
  const rawForm: FormData = {};
  for (const s of FORM_SECTIONS) rawForm[s] = await getSection(app.id, s, maxAttempt) ?? {};
  const allTransitions = await listTransitions(app.id);
  const transitions = visibleTransitions(user, allTransitions);
  const deficiencies = visibleDeficiencies(user, await listDeficiencies(app.id));
  const open = await openDeficiencies(app.id);
  const actions = effectiveActions(user, app);
  const sla = slaInfo(app);
  const docs = await visibleDocuments(user, app, await listDocuments(app.id));
  const cohort = await getCohort(app.cohortId);
  const seesStudy = sections.has('study_market');
  const corrKind = CORRECTION_STATES[app.state];

  const showOpenDefs = isOwner || isImc || metaOnly;
  const openList = showOpenDefs ? open.map((d) => ({ id: d.id, stage: d.stage, field: d.field, note: metaOnly ? '' : d.note, ...(() => { const l = fieldLabel(d.field); return { labelAr: l.ar, labelEn: l.en }; })() })) : [];

  let editableForm: 'application' | 'study' | null = null;
  let editableFields: string[] | null = null;
  if (isOwner && app.state === 'DRAFT') editableForm = 'application';
  else if (isOwner && app.state === 'STUDY_PREPARATION') editableForm = 'study';
  else if (isOwner && corrKind) { editableForm = corrKind; editableFields = open.map((d) => d.field); }

  const expert = seesStudy && app.expertId ? await getExpert(app.expertId) : null;
  const referrals = (await listReferrals(app.id)).filter((r) => isOwner || isImc || (user.role === 'funder_reviewer' && r.funderOrgId === user.organizationId));
  const showLifecycle = isOwner || isImc || (user.role === 'funder_reviewer' && app.funderOrgId === user.organizationId);
  const selectHint = isImc && app.state === 'EVALUATED' && cohort ? {
    outOfRank: await isOutOfRank(app), selected: await selectedCount(app.cohortId), target: cohort.selectionTarget, passedMinimums: app.passedMinimums,
  } : null;

  return {
    ...await buildListItem(user, app),
    cohort: cohort ? { id: cohort.id, nameAr: cohort.nameAr, opensAt: cohort.opensAt, closesAt: cohort.closesAt, maxAge: cohort.maxAge, selectionTarget: cohort.selectionTarget, evaluationTarget: cohort.evaluationTarget } : null,
    data,
    studyTotals: seesStudy && !metaOnly ? studyTotals(rawForm) : null,
    eligibility: (isImc || isOwner) && !metaOnly ? await eligibilityChecks(app, rawForm) : null,
    expert: expert ? { id: expert.id, nameAr: expert.nameAr, specialty: expert.specialty, status: expert.status } : null,
    evaluation: metaOnly ? null : await evaluationBlock(user, app),
    selectHint,
    referrals: metaOnly ? await mapSeq(referrals, async (r) => ({ id: r.id, funderNameAr: (await getOrganization(r.funderOrgId))?.nameAr ?? r.funderOrgId, status: r.status, referredAt: r.referredAt, decidedAt: r.decidedAt }))
      : await mapSeq(referrals, async (r) => ({
        id: r.id, funderOrgId: r.funderOrgId, funderNameAr: (await getOrganization(r.funderOrgId))?.nameAr ?? r.funderOrgId, funderNameEn: (await getOrganization(r.funderOrgId))?.nameEn ?? r.funderOrgId,
        status: r.status, referredAt: r.referredAt, referralNote: r.referralNote, decidedAt: r.decidedAt, amount: r.amount, model: r.model,
        modelLabelAr: r.model ? optionLabel(policy.financingModels, r.model).ar : null, terms: r.terms, declineReason: r.declineReason,
      })),
    milestones: showLifecycle ? (await listMilestones(app.id)).map((m) => ({ ...m })) : [],
    impactReports: showLifecycle ? await listImpactReports(app.id) : [],
    appeal: metaOnly ? null : await appealInfo(user, app),
    documents: docs.map((d) => mapDocument(d, app, !metaOnly)),
    transitions: transitions.map(mapTransition).map((t) => (metaOnly ? { ...t, reason: '' } : t)),
    deficiencies: deficiencies.map((d) => ({ id: d.id, stage: d.stage, field: d.field, note: metaOnly ? '' : d.note, resolved: d.resolvedAtTransitionId !== null, createdAt: d.createdAt, ...(() => { const l = fieldLabel(d.field); return { labelAr: l.ar, labelEn: l.en }; })() })),
    returnCounts: isImc || metaOnly ? returnCounts(allTransitions) : undefined,
    stalledNote: isImc || isOwner ? app.stalledNote : '',
    allowedActions: actions,
    editableForm,
    editableFields,
    currentTask: isTerminal(app.state) ? null : {
      state: app.state,
      labelAr: STATE_TASKS[app.state]?.ar ?? STATE_LABELS[app.state].ar,
      labelEn: STATE_TASKS[app.state]?.en ?? STATE_LABELS[app.state].en,
      responsible: await responsibleInfo(app),
      isMine: actions.some((a) => a.action !== 'withdraw'),
      dueAt: sla.dueAt, overdue: sla.overdue, slaDays: sla.slaDays, daysInState: sla.daysInState,
      deficiencies: openList,
    },
    pendingAttempt: isOwner ? app.attempt + 1 : undefined,
    unchangedDeficiencies: isOwner && corrKind ? await unchangedDeficiencies(app, open) : undefined,
    metadataOnly: metaOnly || undefined,
    hasPendingDocuments: isOwner ? docs.some((d) => !isActiveAt(d, app.attempt) && d.attempt > app.attempt) : undefined,
  };
}

/** بنود النواقص المفتوحة التي لم يُعدَّل فيها شيء منذ آخر إرسال (تنبيه فقط). */
async function unchangedDeficiencies(app: AppRow, open: Array<{ field: string }>): Promise<string[]> {
  const pending = app.attempt + 1;
  return filterSeq([...new Set(open.map((d) => d.field))], async (field) => {
    const kind = docKindForField(field);
    if (kind) return !(await listDocuments(app.id)).some((d) => d.kind === kind && d.attempt === pending);
    const def = FIELD_BY_KEY.get(field);
    if (!def) return false;
    const before = (await getSection(app.id, def.section, app.attempt))?.[field];
    const now = (await getSection(app.id, def.section))?.[field];
    return JSON.stringify(before ?? null) === JSON.stringify(now ?? null);
  });
}

export type ApplicationDetail = Awaited<ReturnType<typeof buildDetail>>;
