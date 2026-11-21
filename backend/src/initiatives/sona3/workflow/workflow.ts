/**
 * دورة عمل «صُنّاع المستقبل» — المصدر الوحيد للحالات والانتقالات (docs/SONA3_DESIGN.md §4–5).
 * لا يُنفَّذ أي انتقال خارج جدول TRANSITIONS. الصفوف المعلّمة proposed = بنود ★ تنتظر الاعتماد.
 */
import { ORG_IDS, type Role } from '../domain.js';

export const APPLICATION_STATES = [
  'DRAFT',
  'ELIGIBILITY_REVIEW', 'ELIGIBILITY_CORRECTION',
  'STUDY_PREPARATION',
  'STUDY_REVIEW', 'STUDY_CORRECTION',
  'COMMITTEE_EVALUATION',
  'EVALUATED',
  'SELECTED',
  'FUNDING_SEARCH', 'FUNDER_REVIEW',
  'IMPLEMENTATION',
  'OPERATING',
  'REJECTED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED', 'COMPLETED', 'WITHDRAWN',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const TERMINAL_STATES: readonly ApplicationState[] = ['REJECTED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED', 'COMPLETED', 'WITHDRAWN'];
export function isTerminal(s: ApplicationState): boolean { return TERMINAL_STATES.includes(s); }

/** القرارات النهائية التي يجوز التظلم منها (§5). */
export const APPEALABLE_STATES: readonly ApplicationState[] = ['REJECTED', 'NOT_SELECTED'];

export const ACTIONS = [
  'submit', 'resubmit', 'accept', 'request_correction', 'reject', 'submit_study', 'complete_evaluation',
  'select', 'not_select', 'record_approval', 'record_not_approved', 'refer_funder', 'close_unfunded',
  'approve_funding', 'decline_funding', 'start_operation', 'complete', 'withdraw', 'reopen',
] as const;
export type ActionName = (typeof ACTIONS)[number];

/** الجهة المسؤولة عن الخطوة الحالية. */
export type Responsible = 'applicant' | 'imc' | 'committee' | 'funder' | 'none';

export interface TransitionDef {
  /** رقم المرحلة على رحلة المشروع (1..8، و0 للانسحاب والتظلم). */
  step: number;
  from: ApplicationState | 'ANY_BEFORE_FUNDING';
  action: ActionName;
  actorRole: Role;
  to: ApplicationState;
  requires?: {
    completeApplication?: boolean;
    completeStudy?: boolean;
    reason?: boolean;
    /** سبب إجباري فقط إن كان الاختيار خارج ترتيب الدرجات (★). */
    reasonIfOutOfRank?: boolean;
    deficiencies?: 'application' | 'study';
    assignedEvaluators?: boolean;
    evaluationsComplete?: boolean;
    selectable?: boolean;
    approval?: boolean;
    funderOrgId?: boolean;
    funding?: boolean;
  };
  /** قرار نهائي/مؤثر — الواجهة تطلب تأكيدًا قبل الإرسال. */
  confirm?: boolean;
  proposed?: boolean;
  labelAr: string;
  labelEn: string;
}

export const TRANSITIONS: readonly TransitionDef[] = [
  // 01 — التسجيل والتقديم
  { step: 1, from: 'DRAFT', action: 'submit', actorRole: 'applicant', to: 'ELIGIBILITY_REVIEW',
    requires: { completeApplication: true }, confirm: true, labelAr: 'إرسال الطلب', labelEn: 'Submit application' },
  // 02 — فحص الأهلية والفرز الأولي
  { step: 2, from: 'ELIGIBILITY_REVIEW', action: 'accept', actorRole: 'imc_officer', to: 'STUDY_PREPARATION', confirm: true,
    labelAr: 'مستوفٍ للأهلية — الانتقال لدراسة الجدوى', labelEn: 'Eligible — proceed to feasibility study' },
  { step: 2, from: 'ELIGIBILITY_REVIEW', action: 'request_correction', actorRole: 'imc_officer', to: 'ELIGIBILITY_CORRECTION',
    requires: { deficiencies: 'application' }, labelAr: 'طلب استيفاء', labelEn: 'Request completion' },
  { step: 2, from: 'ELIGIBILITY_REVIEW', action: 'reject', actorRole: 'imc_officer', to: 'REJECTED',
    requires: { reason: true }, confirm: true, labelAr: 'غير مستوفٍ — رفض الطلب', labelEn: 'Not eligible — reject' },
  { step: 2, from: 'ELIGIBILITY_CORRECTION', action: 'resubmit', actorRole: 'applicant', to: 'ELIGIBILITY_REVIEW',
    requires: { completeApplication: true }, confirm: true, labelAr: 'إعادة التقديم', labelEn: 'Resubmit' },
  // 03 — إعداد دراسة الجدوى
  { step: 3, from: 'STUDY_PREPARATION', action: 'submit_study', actorRole: 'applicant', to: 'STUDY_REVIEW',
    requires: { completeStudy: true }, confirm: true, labelAr: 'إرسال دراسة الجدوى', labelEn: 'Submit feasibility study' },
  // 04 — المراجعة والتقييم الفني والمالي
  { step: 4, from: 'STUDY_REVIEW', action: 'accept', actorRole: 'imc_officer', to: 'COMMITTEE_EVALUATION',
    requires: { assignedEvaluators: true }, confirm: true, labelAr: 'الدراسة مكتملة — إحالة للجنة التقييم', labelEn: 'Study complete — refer to committee' },
  { step: 4, from: 'STUDY_REVIEW', action: 'request_correction', actorRole: 'imc_officer', to: 'STUDY_CORRECTION',
    requires: { deficiencies: 'study' }, labelAr: 'طلب تعديل الدراسة', labelEn: 'Request study revision' },
  { step: 4, from: 'STUDY_REVIEW', action: 'reject', actorRole: 'imc_officer', to: 'REJECTED',
    requires: { reason: true }, confirm: true, labelAr: 'رفض الدراسة', labelEn: 'Reject study' },
  { step: 4, from: 'STUDY_CORRECTION', action: 'resubmit', actorRole: 'applicant', to: 'STUDY_REVIEW',
    requires: { completeStudy: true }, confirm: true, labelAr: 'إعادة إرسال الدراسة', labelEn: 'Resubmit study' },
  { step: 4, from: 'COMMITTEE_EVALUATION', action: 'complete_evaluation', actorRole: 'imc_officer', to: 'EVALUATED',
    requires: { evaluationsComplete: true }, confirm: true, labelAr: 'اعتماد نتيجة التقييم', labelEn: 'Finalize evaluation' },
  // 05 — اختيار أفضل المشروعات (على مستوى الدورة)
  { step: 5, from: 'EVALUATED', action: 'select', actorRole: 'imc_officer', to: 'SELECTED',
    requires: { selectable: true, reasonIfOutOfRank: true }, confirm: true, proposed: true, labelAr: 'اختيار المشروع', labelEn: 'Select project' },
  { step: 5, from: 'EVALUATED', action: 'not_select', actorRole: 'imc_officer', to: 'NOT_SELECTED',
    requires: { reason: true }, confirm: true, labelAr: 'عدم الاختيار', labelEn: 'Not selected' },
  // 06 — العرض والاعتماد وترتيبات التمويل
  { step: 6, from: 'SELECTED', action: 'record_approval', actorRole: 'imc_officer', to: 'FUNDING_SEARCH',
    requires: { approval: true }, confirm: true, labelAr: 'تسجيل اعتماد الوزير', labelEn: 'Record ministerial approval' },
  { step: 6, from: 'SELECTED', action: 'record_not_approved', actorRole: 'imc_officer', to: 'NOT_APPROVED',
    requires: { reason: true }, confirm: true, labelAr: 'لم يُعتمد', labelEn: 'Not approved' },
  { step: 6, from: 'FUNDING_SEARCH', action: 'refer_funder', actorRole: 'imc_officer', to: 'FUNDER_REVIEW',
    requires: { funderOrgId: true }, confirm: true, labelAr: 'إحالة لجهة تمويل', labelEn: 'Refer to funder' },
  { step: 6, from: 'FUNDING_SEARCH', action: 'close_unfunded', actorRole: 'imc_officer', to: 'CLOSED_NOT_FUNDED',
    requires: { reason: true }, confirm: true, labelAr: 'إغلاق — تعذر التمويل', labelEn: 'Close — funding unavailable' },
  { step: 6, from: 'FUNDER_REVIEW', action: 'approve_funding', actorRole: 'funder_reviewer', to: 'IMPLEMENTATION',
    requires: { funding: true }, confirm: true, labelAr: 'الموافقة على التمويل', labelEn: 'Approve funding' },
  { step: 6, from: 'FUNDER_REVIEW', action: 'decline_funding', actorRole: 'funder_reviewer', to: 'FUNDING_SEARCH',
    requires: { reason: true }, confirm: true, labelAr: 'الاعتذار عن التمويل', labelEn: 'Decline funding' },
  // 07 — التأسيس والتنفيذ
  { step: 7, from: 'IMPLEMENTATION', action: 'start_operation', actorRole: 'imc_officer', to: 'OPERATING', confirm: true,
    labelAr: 'بدء التشغيل', labelEn: 'Start operation' },
  // 08 — المتابعة وقياس الأثر
  { step: 8, from: 'OPERATING', action: 'complete', actorRole: 'imc_officer', to: 'COMPLETED', confirm: true,
    labelAr: 'إنهاء المتابعة', labelEn: 'Close monitoring' },
  // — الانسحاب قبل التمويل
  { step: 0, from: 'ANY_BEFORE_FUNDING', action: 'withdraw', actorRole: 'applicant', to: 'WITHDRAWN',
    requires: { reason: true }, confirm: true, proposed: true, labelAr: 'الانسحاب من المبادرة', labelEn: 'Withdraw' },
];

/** صفوف «إعادة الفتح» بعد قبول التظلم — من القرار النهائي إلى حالة المراجعة التي صدر منها (§5). */
export const REOPEN_LABEL = { ar: 'إعادة فتح الطلب بعد قبول التظلم', en: 'Reopen after accepted appeal' };

export function transitionsFrom(state: ApplicationState, action?: ActionName): TransitionDef[] {
  if (isTerminal(state)) return [];
  return TRANSITIONS.filter((t) => (t.from === state || (t.from === 'ANY_BEFORE_FUNDING' && canWithdrawFrom(state)))
    && (!action || t.action === action));
}

function canWithdrawFrom(state: ApplicationState): boolean {
  return !isTerminal(state) && !['IMPLEMENTATION', 'OPERATING'].includes(state);
}

// ── الجهات المسؤولة والتسميات ────────────────────────────────────────────────

export const STATE_RESPONSIBLE: Record<ApplicationState, Responsible> = {
  DRAFT: 'applicant',
  ELIGIBILITY_REVIEW: 'imc', ELIGIBILITY_CORRECTION: 'applicant',
  STUDY_PREPARATION: 'applicant', STUDY_REVIEW: 'imc', STUDY_CORRECTION: 'applicant',
  COMMITTEE_EVALUATION: 'committee', EVALUATED: 'imc', SELECTED: 'imc',
  FUNDING_SEARCH: 'imc', FUNDER_REVIEW: 'funder',
  IMPLEMENTATION: 'applicant', OPERATING: 'applicant',
  REJECTED: 'none', NOT_SELECTED: 'none', NOT_APPROVED: 'none', CLOSED_NOT_FUNDED: 'none', COMPLETED: 'none', WITHDRAWN: 'none',
};

/** رقم المرحلة (01–08) على رحلة المشروع (المقترح — خامسًا). */
export const STATE_STEP: Record<ApplicationState, number> = {
  DRAFT: 1, ELIGIBILITY_REVIEW: 2, ELIGIBILITY_CORRECTION: 2, STUDY_PREPARATION: 3, STUDY_REVIEW: 4, STUDY_CORRECTION: 4,
  COMMITTEE_EVALUATION: 4, EVALUATED: 5, SELECTED: 6, FUNDING_SEARCH: 6, FUNDER_REVIEW: 6, IMPLEMENTATION: 7, OPERATING: 8,
  REJECTED: 2, NOT_SELECTED: 5, NOT_APPROVED: 6, CLOSED_NOT_FUNDED: 6, COMPLETED: 8, WITHDRAWN: 0,
};

/** أسماء المراحل الثماني (المقترح — خامسًا). */
export const JOURNEY_STEPS: ReadonlyArray<{ step: number; ar: string; en: string }> = [
  { step: 1, ar: 'التسجيل والتقديم الإلكتروني', en: 'Registration & online application' },
  { step: 2, ar: 'فحص الأهلية والفرز الأولي', en: 'Eligibility check & screening' },
  { step: 3, ar: 'استكمال الدراسة الفنية ودراسة الجدوى', en: 'Technical & feasibility study' },
  { step: 4, ar: 'المراجعة والتقييم الفني والمالي', en: 'Technical & financial evaluation' },
  { step: 5, ar: 'اختيار أفضل المشروعات', en: 'Selection of top projects' },
  { step: 6, ar: 'العرض والاعتماد وترتيبات التمويل', en: 'Approval & funding arrangements' },
  { step: 7, ar: 'التأسيس والتنفيذ والتشغيل', en: 'Establishment & implementation' },
  { step: 8, ar: 'المتابعة وقياس الأثر', en: 'Monitoring & impact measurement' },
];

export const STATE_LABELS: Record<ApplicationState, { ar: string; en: string }> = {
  DRAFT: { ar: 'مسودة', en: 'Draft' },
  ELIGIBILITY_REVIEW: { ar: 'فحص الأهلية — IMC', en: 'Eligibility review — IMC' },
  ELIGIBILITY_CORRECTION: { ar: 'استيفاء بيانات التقديم', en: 'Application completion' },
  STUDY_PREPARATION: { ar: 'إعداد دراسة الجدوى', en: 'Preparing feasibility study' },
  STUDY_REVIEW: { ar: 'مراجعة الدراسة — IMC', en: 'Study review — IMC' },
  STUDY_CORRECTION: { ar: 'تعديل دراسة الجدوى', en: 'Study revision' },
  COMMITTEE_EVALUATION: { ar: 'تقييم لجنة التقييم', en: 'Committee evaluation' },
  EVALUATED: { ar: 'تم التقييم — بانتظار الاختيار', en: 'Evaluated — awaiting selection' },
  SELECTED: { ar: 'مختار — بانتظار الاعتماد', en: 'Selected — awaiting approval' },
  FUNDING_SEARCH: { ar: 'معتمد — ترتيبات التمويل', en: 'Approved — funding arrangements' },
  FUNDER_REVIEW: { ar: 'دراسة لدى جهة التمويل', en: 'Under funder review' },
  IMPLEMENTATION: { ar: 'التأسيس والتنفيذ', en: 'Implementation' },
  OPERATING: { ar: 'في التشغيل — متابعة الأثر', en: 'Operating — impact monitoring' },
  REJECTED: { ar: 'مرفوض', en: 'Rejected' },
  NOT_SELECTED: { ar: 'لم يُختر', en: 'Not selected' },
  NOT_APPROVED: { ar: 'لم يُعتمد', en: 'Not approved' },
  CLOSED_NOT_FUNDED: { ar: 'مغلق — تعذر التمويل', en: 'Closed — not funded' },
  COMPLETED: { ar: 'اكتملت المتابعة', en: 'Monitoring completed' },
  WITHDRAWN: { ar: 'منسحب', en: 'Withdrawn' },
};

/** «المطلوب الآن» لكل حالة — يُعرض للمتقدم وللجهة المسؤولة. */
export const STATE_TASKS: Partial<Record<ApplicationState, { ar: string; en: string }>> = {
  DRAFT: { ar: 'أكمل استمارة التقديم ومستنداتها ثم أرسلها', en: 'Complete the application form and documents, then submit' },
  ELIGIBILITY_REVIEW: { ar: 'مراجعة السن والشروط واكتمال المستندات وجدية الفكرة', en: 'Check age, conditions, completeness and seriousness' },
  ELIGIBILITY_CORRECTION: { ar: 'استكمل النواقص المطلوبة وأعد التقديم', en: 'Complete the requested items and resubmit' },
  STUDY_PREPARATION: { ar: 'أعدّ دراسة الجدوى على النموذج الموحد ثم أرسلها', en: 'Prepare the feasibility study on the unified template, then submit' },
  STUDY_REVIEW: { ar: 'مراجعة اكتمال الدراسة وواقعية التكاليف والإيرادات، وإسناد المقيّمين', en: 'Review study completeness and realism, and assign evaluators' },
  STUDY_CORRECTION: { ar: 'عدّل بنود الدراسة المطلوبة وأعد إرسالها', en: 'Revise the requested study items and resubmit' },
  COMMITTEE_EVALUATION: { ar: 'تسجيل درجات المقيّمين المسندين', en: 'Assigned evaluators record their scores' },
  EVALUATED: { ar: 'قرار الاختيار ضمن ترتيب الدورة', en: 'Selection decision within the cohort ranking' },
  SELECTED: { ar: 'العرض على الجهات المختصة ورفعه للوزير وتسجيل الاعتماد', en: 'Present to authorities and record ministerial approval' },
  FUNDING_SEARCH: { ar: 'إحالة الملف لجهة تمويل مناسبة', en: 'Refer the file to a suitable funder' },
  FUNDER_REVIEW: { ar: 'دراسة الملف وتسجيل قرار التمويل', en: 'Study the file and record the funding decision' },
  IMPLEMENTATION: { ar: 'نفّذ مراحل الإنجاز وأبلغ عن كل مرحلة بالدليل لصرف دفعتها', en: 'Deliver milestones and report each with evidence to release its tranche' },
  OPERATING: { ar: 'أرسل تقارير الأثر الدورية (الإيرادات والإنتاج وفرص العمل)', en: 'Submit periodic impact reports (revenue, production, jobs)' },
};

export const RESPONSIBLE_LABELS: Record<Responsible, { ar: string; en: string }> = {
  applicant: { ar: 'المتقدم', en: 'Applicant' },
  imc: { ar: 'فريق المبادرة — IMC', en: 'Initiative team — IMC' },
  committee: { ar: 'لجنة التقييم', en: 'Evaluation committee' },
  funder: { ar: 'جهة التمويل', en: 'Funder' },
  none: { ar: '—', en: '—' },
};

/** حالات التصحيح ونوع البيانات المسموح تعديلها فيها. */
export const CORRECTION_STATES: Partial<Record<ApplicationState, 'application' | 'study'>> = {
  ELIGIBILITY_CORRECTION: 'application',
  STUDY_CORRECTION: 'study',
};

/** إجراءات الإرجاع للتصحيح (لعدّ الإرجاعات). */
export const RETURN_ACTIONS: ReadonlyArray<{ from: ApplicationState; action: ActionName }> = [
  { from: 'ELIGIBILITY_REVIEW', action: 'request_correction' },
  { from: 'STUDY_REVIEW', action: 'request_correction' },
];

// ── من يملك تنفيذ الصف ─────────────────────────────────────────────────────

export interface ActorLike { role: Role; organizationId: string }
export interface AppLike { state: ApplicationState; applicantOrgId: string; funderOrgId: string | null }

/** الجهة الفعلية المسؤولة عن الحالة (org id) — للإشعارات وعرض المهمة. */
export function responsibleOrgId(app: AppLike): string | null {
  switch (STATE_RESPONSIBLE[app.state]) {
    case 'applicant': return app.applicantOrgId;
    case 'imc': return ORG_IDS.imc;
    case 'committee': return ORG_IDS.committee;
    case 'funder': return app.funderOrgId;
    default: return null;
  }
}

/** فحص الجهة: الدور وحده لا يكفي — يجب أن ينتمي المنفذ للجهة المعنية بهذا الطلب. */
export function actorOwnsRow(actor: ActorLike, app: AppLike, def: TransitionDef): boolean {
  if (actor.role !== def.actorRole) return false;
  switch (def.actorRole) {
    case 'applicant': return actor.organizationId === app.applicantOrgId;
    case 'imc_officer': return actor.organizationId === ORG_IDS.imc;
    case 'funder_reviewer': return app.funderOrgId !== null && actor.organizationId === app.funderOrgId;
    default: return false; // المقيّم يعمل عبر شاشة التقييم؛ الأدمن لا يملك أي قرار
  }
}

export interface AllowedAction {
  action: ActionName;
  labelAr: string;
  labelEn: string;
  to: ApplicationState;
  confirm: boolean;
  requires: NonNullable<TransitionDef['requires']>;
}

/** الإجراءات المتاحة للمستخدم على الطلب — الواجهة لا تحسب الصلاحيات بنفسها. */
export function allowedActions(actor: ActorLike, app: AppLike): AllowedAction[] {
  const seen = new Set<ActionName>();
  const out: AllowedAction[] = [];
  for (const t of transitionsFrom(app.state)) {
    if (seen.has(t.action) || !actorOwnsRow(actor, app, t)) continue;
    seen.add(t.action);
    out.push({ action: t.action, labelAr: t.labelAr, labelEn: t.labelEn, to: t.to, confirm: Boolean(t.confirm), requires: t.requires ?? {} });
  }
  return out;
}
