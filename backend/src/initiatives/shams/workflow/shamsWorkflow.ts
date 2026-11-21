/**
 * دورة عمل «شمس الصناعة» — المصدر الوحيد للحالات والانتقالات (القسم 5 من المواصفة).
 * لا يُنفَّذ أي انتقال خارج جدول TRANSITIONS. الصفوف المعلّمة proposed = بنود ★ تنتظر الاعتماد.
 */
import { ORG_IDS, type Role } from '../domain.js';

export const APPLICATION_STATES = [
  'DRAFT',
  'IMC_REVIEW', 'IMC_CORRECTION',
  'ENCPC_REVIEW', 'ENCPC_CORRECTION',
  'PROVIDER_SELECTION',
  'OFFER_UPLOAD',
  'OFFER_REVIEW', 'OFFER_CORRECTION',
  'ELECTRICITY_UPLOAD',
  'ELECTRICITY_REVIEW',
  // مرحلة ملغاة (G-02): لا دراسة بنكية داخل المنصة. تبقى في القائمة لأنها في قيد CHECK وفي السجل التاريخي؛
  // لا يدخلها أي انتقال، والـmigration 007 نقلت أي طلب كان فيها.
  'BANK_STUDY',
  'CONTRACT_OUTCOME',
  // المسار الثاني للتعاقد: عن طريق شركة توزيع الكهرباء (رفع موافقتها ثم مراجعة PMU — قرار نهائي).
  'DISTRIBUTION_UPLOAD', 'DISTRIBUTION_REVIEW',
  'REJECTED', 'CONTRACTED', 'CLOSED_NOT_CONTRACTED', 'WITHDRAWN',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const TERMINAL_STATES: readonly ApplicationState[] = ['REJECTED', 'CONTRACTED', 'CLOSED_NOT_CONTRACTED', 'WITHDRAWN'];
/** حالات ملغاة: لا يدخلها أي انتقال، وأي طلب كان فيها نُقل بالـmigration (G-02: BANK_STUDY). */
export const RETIRED_STATES: readonly ApplicationState[] = ['BANK_STUDY'];
export function isTerminal(s: ApplicationState): boolean { return TERMINAL_STATES.includes(s); }
/**
 * PA-04: every state that can still carry a per-application flag. A terminal application has no transition (so no action:
 * isMine = false) and no SLA (overdue = false), so the "awaiting me" / overdue / open computations only need these rows.
 */
export const NON_TERMINAL_STATES: readonly ApplicationState[] = APPLICATION_STATES.filter((s) => !TERMINAL_STATES.includes(s));

export const ACTIONS = [
  'submit', 'resubmit', 'accept', 'request_correction', 'reject', 'compliant', 'non_compliant',
  'select_provider', 'submit_offer', 'submit_electricity', 'select_bank', 'record_contract', 'record_no_contract', 'withdraw',
  'select_distribution_path', 'submit_distribution_approval', 'reject_distribution',
] as const;

/**
 * مسارا التعاقد بعد قبول PMU لموافقة الكهرباء: البنك (القائم — اختيار البنك نفسه يثبّت المسار)، أو شركة توزيع الكهرباء.
 * يُخزن في applications.contractPath؛ قيود CHECK في قاعدة البيانات تمنع الجمع بين المسارين.
 */
export const CONTRACT_PATHS = ['bank', 'distribution'] as const;
export type ContractPath = (typeof CONTRACT_PATHS)[number];
export const CONTRACT_PATH_LABELS: Record<ContractPath, { ar: string; en: string }> = {
  bank: { ar: 'التعاقد من خلال بنك', en: 'Contracting through a bank' },
  distribution: { ar: 'التعاقد من خلال شركة توزيع الكهرباء', en: 'Contracting through the electricity distribution company' },
};

/** إجراءات ملغاة تبقى أسماؤها في السجل التاريخي فقط (دراسة البنك وإعادة الإحالة — G-02). لا يقبلها الخادم. */
export const RETIRED_ACTION_LABELS: Record<string, { ar: string; en: string }> = {
  record_result: { ar: 'تسجيل نتيجة دراسة البنك (مرحلة ملغاة)', en: 'Bank study result (retired step)' },
  reassign_bank: { ar: 'إعادة الإحالة لبنك آخر (مرحلة ملغاة)', en: 'Bank reassignment (retired step)' },
  bank_study_retired: { ar: 'إلغاء مرحلة دراسة البنك — نقل آلي إلى اختيار البنك والتعاقد', en: 'Bank study retired — moved to bank choice & contracting' },
};
export type ActionName = (typeof ACTIONS)[number];

/** الجهة المسؤولة عن الخطوة الحالية. */
export type Responsible = 'factory' | 'imc' | 'encpc' | 'pmu' | 'none';

export type RegistryCheck = 'always' | 'if_changed';

export interface TransitionDef {
  /** رقم الصف في جدول المواصفة (1..9، و0 للانسحاب). */
  step: number;
  from: ApplicationState | 'ANY_NON_TERMINAL';
  action: ActionName;
  actorRole: Role;
  to: ApplicationState;
  /** شرط نتيجة السجل الصناعي لصفّي الإرسال (صحيح → IMC، خطأ/تعذر → يبقى). */
  when?: 'registry_valid' | 'registry_not_valid';
  registryCheck?: RegistryCheck;
  requires?: {
    completeForm?: boolean;
    reason?: boolean;
    deficiencies?: boolean;
    providerId?: boolean;
    bankOrgId?: boolean;
    newDocument?: 'technicalOfferFile' | 'electricityApprovalFile' | 'contractFile' | 'distributionApprovalFile';
    electricity?: boolean;
    contract?: boolean;
    /** يتطلب أن يكون المصنع قد سجّل البنك المختار (بعد قبول موافقة الكهرباء). */
    bankSelected?: boolean;
  };
  /** قرار نهائي/مؤثر — الواجهة تطلب تأكيدًا قبل الإرسال. */
  confirm?: boolean;
  proposed?: boolean;
  labelAr: string;
  labelEn: string;
}

export const TRANSITIONS: readonly TransitionDef[] = [
  // 1 — التسجيل والتحقق من السجل
  { step: 1, from: 'DRAFT', action: 'submit', actorRole: 'factory_owner', to: 'IMC_REVIEW', when: 'registry_valid', registryCheck: 'always',
    requires: { completeForm: true }, confirm: true, labelAr: 'إرسال الطلب', labelEn: 'Submit application' },
  { step: 1, from: 'DRAFT', action: 'submit', actorRole: 'factory_owner', to: 'DRAFT', when: 'registry_not_valid', registryCheck: 'always',
    requires: { completeForm: true }, proposed: true, labelAr: 'إرسال الطلب', labelEn: 'Submit application' },
  // 2 — مراجعة IMC
  { step: 2, from: 'IMC_REVIEW', action: 'accept', actorRole: 'imc_reviewer', to: 'ENCPC_REVIEW', confirm: true,
    labelAr: 'قبول الطلب', labelEn: 'Accept application' },
  { step: 2, from: 'IMC_REVIEW', action: 'request_correction', actorRole: 'imc_reviewer', to: 'IMC_CORRECTION',
    requires: { deficiencies: true }, confirm: true, labelAr: 'طلب استيفاء', labelEn: 'Request completion' },
  { step: 2, from: 'IMC_REVIEW', action: 'reject', actorRole: 'imc_reviewer', to: 'REJECTED',
    requires: { reason: true }, confirm: true, labelAr: 'رفض الطلب', labelEn: 'Reject application' },
  { step: 2, from: 'IMC_CORRECTION', action: 'resubmit', actorRole: 'factory_owner', to: 'IMC_REVIEW', when: 'registry_valid', registryCheck: 'if_changed',
    requires: { completeForm: true }, confirm: true, labelAr: 'إعادة التقديم', labelEn: 'Resubmit' },
  { step: 2, from: 'IMC_CORRECTION', action: 'resubmit', actorRole: 'factory_owner', to: 'IMC_CORRECTION', when: 'registry_not_valid', registryCheck: 'if_changed',
    requires: { completeForm: true }, proposed: true, labelAr: 'إعادة التقديم', labelEn: 'Resubmit' },
  // 3 — المراجعة الفنية ENCPC (لا يوجد رفض)
  { step: 3, from: 'ENCPC_REVIEW', action: 'compliant', actorRole: 'encpc_reviewer', to: 'PROVIDER_SELECTION', confirm: true,
    labelAr: 'مطابق فنيًا', labelEn: 'Technically compliant' },
  { step: 3, from: 'ENCPC_REVIEW', action: 'non_compliant', actorRole: 'encpc_reviewer', to: 'ENCPC_CORRECTION',
    requires: { deficiencies: true }, confirm: true, labelAr: 'غير مطابق — طلب تصحيح', labelEn: 'Not compliant — request correction' },
  { step: 3, from: 'ENCPC_CORRECTION', action: 'resubmit', actorRole: 'factory_owner', to: 'ENCPC_REVIEW', when: 'registry_valid', registryCheck: 'if_changed',
    requires: { completeForm: true }, confirm: true, labelAr: 'إعادة التقديم', labelEn: 'Resubmit' },
  { step: 3, from: 'ENCPC_CORRECTION', action: 'resubmit', actorRole: 'factory_owner', to: 'ENCPC_CORRECTION', when: 'registry_not_valid', registryCheck: 'if_changed',
    requires: { completeForm: true }, proposed: true, labelAr: 'إعادة التقديم', labelEn: 'Resubmit' },
  // 4 — اختيار مقدم الخدمة
  { step: 4, from: 'PROVIDER_SELECTION', action: 'select_provider', actorRole: 'factory_owner', to: 'OFFER_UPLOAD',
    requires: { providerId: true }, confirm: true, labelAr: 'اختيار مقدم الخدمة', labelEn: 'Select service provider' },
  // 5 — رفع العرض الفني
  // ★ I11: إعادة اختيار مقدم الخدمة من OFFER_UPLOAD — متاحة فقط إذا لم يعد مقدم الخدمة المختار معتمدًا (effectiveActions).
  { step: 5, from: 'OFFER_UPLOAD', action: 'select_provider', actorRole: 'factory_owner', to: 'OFFER_UPLOAD',
    requires: { providerId: true }, confirm: true, proposed: true, labelAr: 'إعادة اختيار مقدم الخدمة', labelEn: 'Choose another service provider' },
  { step: 5, from: 'OFFER_UPLOAD', action: 'submit_offer', actorRole: 'factory_owner', to: 'OFFER_REVIEW',
    requires: { newDocument: 'technicalOfferFile' }, confirm: true, labelAr: 'إرسال العرض الفني', labelEn: 'Submit technical offer' },
  // 6 — مراجعة PMU للعرض (لا يوجد رفض)
  { step: 6, from: 'OFFER_REVIEW', action: 'accept', actorRole: 'pmu_reviewer', to: 'ELECTRICITY_UPLOAD', confirm: true,
    labelAr: 'قبول العرض الفني', labelEn: 'Accept technical offer' },
  { step: 6, from: 'OFFER_REVIEW', action: 'request_correction', actorRole: 'pmu_reviewer', to: 'OFFER_CORRECTION',
    requires: { reason: true }, confirm: true, labelAr: 'طلب تعديل العرض', labelEn: 'Request offer revision' },
  { step: 6, from: 'OFFER_CORRECTION', action: 'resubmit', actorRole: 'factory_owner', to: 'OFFER_REVIEW',
    requires: { newDocument: 'technicalOfferFile' }, confirm: true, labelAr: 'إعادة رفع العرض', labelEn: 'Resubmit offer' },
  // 7 — موافقة الكهرباء
  { step: 7, from: 'ELECTRICITY_UPLOAD', action: 'submit_electricity', actorRole: 'factory_owner', to: 'ELECTRICITY_REVIEW',
    requires: { newDocument: 'electricityApprovalFile', electricity: true }, confirm: true,
    labelAr: 'إرسال موافقة الكهرباء', labelEn: 'Submit electricity approval' },
  // G-01: القبول يفتح للمصنع اختيار مسار التعاقد: بنك (لا إحالة ولا دراسة بنكية داخل المنصة — G-02) أو شركة توزيع الكهرباء.
  { step: 7, from: 'ELECTRICITY_REVIEW', action: 'accept', actorRole: 'pmu_reviewer', to: 'CONTRACT_OUTCOME', confirm: true,
    labelAr: 'الموافقة مستوفاة — يختار المصنع مسار التعاقد', labelEn: 'Approval complete — factory chooses the contracting path' },
  { step: 7, from: 'ELECTRICITY_REVIEW', action: 'request_correction', actorRole: 'pmu_reviewer', to: 'ELECTRICITY_UPLOAD',
    requires: { reason: true }, confirm: true, proposed: true, labelAr: 'غير مستوفاة — استكمال المستند', labelEn: 'Incomplete — request document' },
  // 8 — اختيار البنك (G-01): مرة واحدة، وبعد قبول PMU لموافقة الكهرباء فقط. البنك جهة خارجية بلا حساب (G-02).
  { step: 8, from: 'CONTRACT_OUTCOME', action: 'select_bank', actorRole: 'factory_owner', to: 'CONTRACT_OUTCOME',
    requires: { bankOrgId: true }, confirm: true, labelAr: 'اختيار البنك', labelEn: 'Choose the bank' },
  // 9 — يسجل المصنع نتيجة التعاقد مباشرة بعد تواصله مع البنك خارج المنصة (G-02)، مع مستند إثبات للتعاقد (G-03).
  { step: 9, from: 'CONTRACT_OUTCOME', action: 'record_contract', actorRole: 'factory_owner', to: 'CONTRACTED',
    requires: { contract: true, bankSelected: true, newDocument: 'contractFile' }, confirm: true, labelAr: 'تسجيل التعاقد', labelEn: 'Record contract' },
  { step: 9, from: 'CONTRACT_OUTCOME', action: 'record_no_contract', actorRole: 'factory_owner', to: 'CLOSED_NOT_CONTRACTED',
    requires: { reason: true, bankSelected: true }, confirm: true, labelAr: 'لم يتم التعاقد', labelEn: 'No contract' },
  // 8/9 — المسار الثاني: التعاقد عن طريق شركة توزيع الكهرباء. الاختيار مرة واحدة ويثبّت المسار (لا بنك بعده — actionBlock + CHECK).
  { step: 8, from: 'CONTRACT_OUTCOME', action: 'select_distribution_path', actorRole: 'factory_owner', to: 'DISTRIBUTION_UPLOAD', confirm: true,
    labelAr: 'التعاقد من خلال شركة توزيع الكهرباء', labelEn: 'Contract through the distribution company' },
  { step: 9, from: 'DISTRIBUTION_UPLOAD', action: 'submit_distribution_approval', actorRole: 'factory_owner', to: 'DISTRIBUTION_REVIEW',
    requires: { newDocument: 'distributionApprovalFile' }, confirm: true, labelAr: 'إرسال موافقة شركة التوزيع', labelEn: 'Submit the distribution company approval' },
  // قرار PMU نهائي في الاتجاهين: القبول = تم التعاقد، والرفض = إغلاق بلا تعاقد (نفس نتيجة التعاقد البنكي غير المكتمل).
  { step: 9, from: 'DISTRIBUTION_REVIEW', action: 'accept', actorRole: 'pmu_reviewer', to: 'CONTRACTED', confirm: true,
    labelAr: 'قبول موافقة شركة التوزيع — تم التعاقد', labelEn: 'Accept the distribution approval — contracted' },
  // فعل مستقل عن «reject» (رفض IMC للطلب → REJECTED): هنا رفض مستند التعاقد → إغلاق بلا تعاقد.
  { step: 9, from: 'DISTRIBUTION_REVIEW', action: 'reject_distribution', actorRole: 'pmu_reviewer', to: 'CLOSED_NOT_CONTRACTED',
    requires: { reason: true }, confirm: true, labelAr: 'رفض موافقة شركة التوزيع — إغلاق نهائي', labelEn: 'Reject the distribution approval — final closure' },
  // — الانسحاب من أي حالة غير نهائية
  { step: 0, from: 'ANY_NON_TERMINAL', action: 'withdraw', actorRole: 'factory_owner', to: 'WITHDRAWN',
    requires: { reason: true }, confirm: true, proposed: true, labelAr: 'الانسحاب من الطلب', labelEn: 'Withdraw application' },
];

export function transitionsFrom(state: ApplicationState, action?: ActionName): TransitionDef[] {
  if (isTerminal(state)) return [];
  return TRANSITIONS.filter((t) => (t.from === state || t.from === 'ANY_NON_TERMINAL') && (!action || t.action === action));
}

/** الصف المطبق لنتيجة السجل (للإرسال/إعادة التقديم ذات صفّي النتيجة). */
export function pickTransition(defs: TransitionDef[], registryOutcome?: 'valid' | 'not_valid'): TransitionDef {
  if (defs.length === 1) return defs[0];
  const want = registryOutcome === 'not_valid' ? 'registry_not_valid' : 'registry_valid';
  return defs.find((d) => d.when === want) ?? defs[0];
}

// ── الجهات المسؤولة والتسميات ────────────────────────────────────────────────

export const STATE_RESPONSIBLE: Record<ApplicationState, Responsible> = {
  DRAFT: 'factory',
  IMC_REVIEW: 'imc', IMC_CORRECTION: 'factory',
  ENCPC_REVIEW: 'encpc', ENCPC_CORRECTION: 'factory',
  PROVIDER_SELECTION: 'factory', OFFER_UPLOAD: 'factory',
  OFFER_REVIEW: 'pmu', OFFER_CORRECTION: 'factory',
  ELECTRICITY_UPLOAD: 'factory', ELECTRICITY_REVIEW: 'pmu',
  BANK_STUDY: 'none', CONTRACT_OUTCOME: 'factory',
  DISTRIBUTION_UPLOAD: 'factory', DISTRIBUTION_REVIEW: 'pmu',
  REJECTED: 'none', CONTRACTED: 'none', CLOSED_NOT_CONTRACTED: 'none', WITHDRAWN: 'none',
};

/** رقم المرحلة (1–9) على خريطة الإجراءات. */
export const STATE_STEP: Record<ApplicationState, number> = {
  DRAFT: 1, IMC_REVIEW: 2, IMC_CORRECTION: 2, ENCPC_REVIEW: 3, ENCPC_CORRECTION: 3, PROVIDER_SELECTION: 4,
  OFFER_UPLOAD: 5, OFFER_REVIEW: 6, OFFER_CORRECTION: 6, ELECTRICITY_UPLOAD: 7, ELECTRICITY_REVIEW: 7,
  BANK_STUDY: 8, CONTRACT_OUTCOME: 9, DISTRIBUTION_UPLOAD: 9, DISTRIBUTION_REVIEW: 9, REJECTED: 2, CONTRACTED: 9, CLOSED_NOT_CONTRACTED: 9, WITHDRAWN: 0,
};

export const STATE_LABELS: Record<ApplicationState, { ar: string; en: string }> = {
  DRAFT: { ar: 'مسودة', en: 'Draft' },
  IMC_REVIEW: { ar: 'مراجعة الطلب — IMC', en: 'Application review — IMC' },
  IMC_CORRECTION: { ar: 'استيفاء البيانات', en: 'Data completion' },
  ENCPC_REVIEW: { ar: 'المراجعة الفنية — ENCPC', en: 'Technical review — ENCPC' },
  ENCPC_CORRECTION: { ar: 'تصحيح الملف الفني', en: 'Technical file correction' },
  PROVIDER_SELECTION: { ar: 'اختيار مقدم الخدمة', en: 'Service provider selection' },
  OFFER_UPLOAD: { ar: 'رفع العرض الفني', en: 'Technical offer upload' },
  OFFER_REVIEW: { ar: 'مراجعة العرض الفني — PMU', en: 'Technical offer review — PMU' },
  OFFER_CORRECTION: { ar: 'تعديل العرض الفني', en: 'Technical offer revision' },
  ELECTRICITY_UPLOAD: { ar: 'رفع موافقة الكهرباء', en: 'Electricity approval upload' },
  ELECTRICITY_REVIEW: { ar: 'مراجعة موافقة الكهرباء — PMU', en: 'Electricity approval review — PMU' },
  BANK_STUDY: { ar: 'دراسة البنك (مرحلة ملغاة)', en: 'Bank study (retired)' },
  CONTRACT_OUTCOME: { ar: 'مسار التعاقد / التعاقد البنكي', en: 'Contracting path / bank contracting' },
  DISTRIBUTION_UPLOAD: { ar: 'رفع موافقة شركة توزيع الكهرباء', en: 'Distribution company approval upload' },
  DISTRIBUTION_REVIEW: { ar: 'مراجعة موافقة شركة التوزيع — PMU', en: 'Distribution company approval review — PMU' },
  REJECTED: { ar: 'طلب مرفوض', en: 'Rejected' },
  CONTRACTED: { ar: 'اكتمل — تم التعاقد', en: 'Completed — contracted' },
  CLOSED_NOT_CONTRACTED: { ar: 'مغلق — لم يتم التعاقد', en: 'Closed — not contracted' },
  WITHDRAWN: { ar: 'منسحب', en: 'Withdrawn' },
};

/** «المطلوب الآن» لكل حالة — يُعرض للمصنع وللجهة المسؤولة. */
export const STATE_TASKS: Partial<Record<ApplicationState, { ar: string; en: string }>> = {
  DRAFT: { ar: 'أكمل بيانات الطلب ومستنداته ثم أرسله', en: 'Complete the application and its documents, then submit' },
  IMC_REVIEW: { ar: 'مراجعة الطلب والمستندات واتخاذ القرار', en: 'Review the application and documents, then decide' },
  IMC_CORRECTION: { ar: 'استكمل النواقص المطلوبة وأعد التقديم', en: 'Complete the requested items and resubmit' },
  ENCPC_REVIEW: { ar: 'التقييم الفني للطلب', en: 'Technical evaluation of the application' },
  ENCPC_CORRECTION: { ar: 'صحّح البيانات والمستندات الفنية وأعد التقديم', en: 'Correct the technical data and documents, then resubmit' },
  PROVIDER_SELECTION: { ar: 'اختر مقدم الخدمة من القائمة المعتمدة', en: 'Select a service provider from the approved list' },
  OFFER_UPLOAD: { ar: 'تواصل مع مقدم الخدمة خارج المنصة للحصول على العرض الفني، ثم ارفعه', en: 'Contact the provider outside the platform for the technical offer, then upload it' },
  OFFER_REVIEW: { ar: 'مراجعة العرض الفني', en: 'Review the technical offer' },
  OFFER_CORRECTION: { ar: 'عدّل العرض الفني وأعد رفعه', en: 'Revise the technical offer and upload it again' },
  ELECTRICITY_UPLOAD: { ar: 'ارفع موافقة شركة الكهرباء', en: 'Upload the electricity company approval' },
  ELECTRICITY_REVIEW: { ar: 'مراجعة موافقة الكهرباء', en: 'Review the electricity approval' },
  CONTRACT_OUTCOME: { ar: 'اختر مسار التعاقد: من خلال بنك أو من خلال شركة توزيع الكهرباء', en: 'Choose the contracting path: through a bank or through the electricity distribution company' },
  DISTRIBUTION_UPLOAD: { ar: 'ارفع موافقة شركة توزيع الكهرباء على التعاقد ثم أرسلها للمراجعة', en: 'Upload the distribution company’s contracting approval, then send it for review' },
  DISTRIBUTION_REVIEW: { ar: 'مراجعة موافقة شركة توزيع الكهرباء واتخاذ القرار النهائي', en: 'Review the distribution company approval and take the final decision' },
};

/** مهمة المرحلة الأخيرة بعد اختيار البنك: التواصل خارج المنصة ثم تسجيل النتيجة. */
export const CONTRACT_TASK_AFTER_BANK = { ar: 'تواصل مع البنك خارج المنصة، ثم سجّل نتيجة التعاقد', en: 'Contact the bank outside the platform, then record the contract outcome' };

/** المهمة الحالية للطلب (داخل CONTRACT_OUTCOME تتغير بحسب اختيار البنك). */
export function stateTask(app: { state: ApplicationState; bankOrgId: string | null }): { ar: string; en: string } {
  if (app.state === 'CONTRACT_OUTCOME' && app.bankOrgId) return CONTRACT_TASK_AFTER_BANK;
  return STATE_TASKS[app.state] ?? STATE_LABELS[app.state];
}

/** رقم المرحلة: «مسار التعاقد» (8) حتى يختار المصنع البنك أو شركة التوزيع، ثم «التعاقد» (9). */
export function stateStep(app: { state: ApplicationState; bankOrgId: string | null }): number {
  if (app.state === 'CONTRACT_OUTCOME' && !app.bankOrgId) return 8;
  return STATE_STEP[app.state];
}

export const RESPONSIBLE_LABELS: Record<Responsible, { ar: string; en: string }> = {
  factory: { ar: 'المصنع', en: 'Factory' },
  imc: { ar: 'IMC', en: 'IMC' },
  encpc: { ar: 'ENCPC', en: 'ENCPC' },
  pmu: { ar: 'وحدة إدارة المبادرة (PMU)', en: 'Initiative Management Unit (PMU)' },
  none: { ar: '—', en: '—' },
};

/** حالات التصحيح التي تقيّد التعديل بقائمة النواقص. */
export const FORM_CORRECTION_STATES: readonly ApplicationState[] = ['IMC_CORRECTION', 'ENCPC_CORRECTION'];

/** حالة المراجعة التي يعود إليها كل تصحيح (لعدّ الإرجاعات). */
export const RETURN_ACTIONS: ReadonlyArray<{ from: ApplicationState; action: ActionName }> = [
  { from: 'IMC_REVIEW', action: 'request_correction' },
  { from: 'ENCPC_REVIEW', action: 'non_compliant' },
  { from: 'OFFER_REVIEW', action: 'request_correction' },
  { from: 'ELECTRICITY_REVIEW', action: 'request_correction' },
];

// ── من يملك تنفيذ الصف ─────────────────────────────────────────────────────

export interface ActorLike { role: Role; organizationId: string }
export interface AppLike { state: ApplicationState; factoryOrgId: string; bankOrgId: string | null }

/** الجهة الفعلية المسؤولة عن الحالة (org id) — للإشعارات وعرض المهمة. */
export function responsibleOrgId(app: AppLike): string | null {
  switch (STATE_RESPONSIBLE[app.state]) {
    case 'factory': return app.factoryOrgId;
    case 'imc': return ORG_IDS.imc;
    case 'encpc': return ORG_IDS.encpc;
    case 'pmu': return ORG_IDS.pmu;
    default: return null;
  }
}

/** فحص الجهة: الدور وحده لا يكفي — يجب أن ينتمي المنفذ للجهة المعنية بهذا الطلب. */
export function actorOwnsRow(actor: ActorLike, app: AppLike, def: TransitionDef): boolean {
  if (actor.role !== def.actorRole) return false;
  switch (def.actorRole) {
    case 'factory_owner': return actor.organizationId === app.factoryOrgId;
    case 'imc_reviewer': return actor.organizationId === ORG_IDS.imc;
    case 'encpc_reviewer': return actor.organizationId === ORG_IDS.encpc;
    case 'pmu_reviewer': return actor.organizationId === ORG_IDS.pmu;
    default: return false; // system_admin لا يملك أي قرار؛ bank_reviewer دور ملغى (G-02) بلا أي إجراء
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
    if (t.when === 'registry_not_valid') continue;
    seen.add(t.action);
    out.push({ action: t.action, labelAr: t.labelAr, labelEn: t.labelEn, to: t.to, confirm: Boolean(t.confirm), requires: t.requires ?? {} });
  }
  return out;
}
