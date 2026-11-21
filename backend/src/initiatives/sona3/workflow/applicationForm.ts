/**
 * تعريف استمارة التقديم (المرحلة 01) ودراسة الجدوى (المرحلة 03) ومستندات المراحل (docs/SONA3_DESIGN.md §6–7).
 * يُعرض كما هو للواجهة عبر GET /meta حتى لا تتكرر القواعد. الإجباري في `required` لكل حقل.
 */
import { policy } from '../config/initiativePolicy.js';

export type FormKind = 'application' | 'study';

export const APPLICATION_SECTIONS = ['personal', 'team', 'project', 'idea', 'readiness', 'declarations'] as const;
export const STUDY_SECTIONS = ['study_market', 'study_technical', 'study_financial', 'study_risks', 'study_impact', 'study_plan', 'expert'] as const;
export type ApplicationSection = (typeof APPLICATION_SECTIONS)[number];
export type StudySection = (typeof STUDY_SECTIONS)[number];
export type FormSection = ApplicationSection | StudySection;
export const FORM_SECTIONS: readonly FormSection[] = [...APPLICATION_SECTIONS, ...STUDY_SECTIONS];
/** أقسام البيانات المخزنة (الفورم + بيانات المراحل). */
export type DataSection = FormSection | 'approval';

export function formOfSection(s: FormSection): FormKind {
  return (APPLICATION_SECTIONS as readonly string[]).includes(s) ? 'application' : 'study';
}

export const SECTION_LABELS: Record<FormSection, { ar: string; en: string }> = {
  personal: { ar: 'البيانات الشخصية للمتقدم', en: 'Applicant personal data' },
  team: { ar: 'فريق العمل والشركاء', en: 'Team & partners' },
  project: { ar: 'الملخص والمجال الاستثماري', en: 'Project summary & sector' },
  idea: { ar: 'تفاصيل الفكرة والمنتج', en: 'Idea & product' },
  readiness: { ar: 'الجاهزية والاحتياجات التمويلية', en: 'Readiness & financing needs' },
  declarations: { ar: 'الإقرارات والتعهدات', en: 'Declarations' },
  study_market: { ar: 'دراسة السوق', en: 'Market feasibility' },
  study_technical: { ar: 'الدراسة الفنية والهندسية', en: 'Technical feasibility' },
  study_financial: { ar: 'الدراسة المالية وخطة التمويل', en: 'Financial feasibility' },
  study_risks: { ar: 'تحليل المخاطر وإدارتها', en: 'Risk analysis' },
  study_impact: { ar: 'الاستدامة والأثر الاقتصادي والمجتمعي', en: 'Sustainability & impact' },
  study_plan: { ar: 'خطة التنفيذ ومراحلها', en: 'Implementation plan' },
  expert: { ar: 'الخبير الداعم (اختياري)', en: 'Supporting expert (optional)' },
};

export type FieldType =
  | 'text' | 'textarea' | 'select' | 'phone' | 'email' | 'number' | 'integer' | 'money' | 'percent' | 'date'
  | 'nationalId' | 'yesNo' | 'checkbox' | 'file' | 'files' | 'table';

export type OptionsKey =
  | 'governorates' | 'nationalities' | 'applicationTypes' | 'sectors' | 'projectStages' | 'startTimelines'
  | 'technologyLevels' | 'materialSources' | 'financingModels' | 'experts';

export const DOCUMENT_KINDS = [
  'nationalIdFile', 'qualificationFile', 'supportingFile', 'studyFile', 'quotationFile',
  'approvalFile', 'fundingDecisionFile', 'milestoneEvidence',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface ColumnDef {
  key: string;
  type: 'text' | 'integer' | 'money' | 'number' | 'select' | 'nationalId';
  labelAr: string;
  labelEn: string;
  required: boolean;
  maxLength?: number;
  options?: OptionsKey;
}

export interface FieldDef {
  key: string;
  section: FormSection;
  type: FieldType;
  labelAr: string;
  labelEn: string;
  required: boolean;
  hintAr?: string;
  hintEn?: string;
  maxLength?: number;
  /** للحقول من نوع textarea: أقصى عدد كلمات. */
  maxWords?: number;
  /** للحقول من نوع ملف: نوع المستند المخزن. */
  docKind?: DocumentKind;
  /** الحد الأقصى لعدد الملفات (files) أو الصفوف (table). */
  maxItems?: number;
  minItems?: number;
  options?: OptionsKey;
  columns?: ColumnDef[];
  /** إجباري فقط عند تحقق شرط على حقل آخر في نفس القسم. */
  requiredWhen?: { field: string; equals: string | boolean };
}

const f = (key: string, section: FormSection, type: FieldType, labelAr: string, labelEn: string, required: boolean, extra: Partial<FieldDef> = {}): FieldDef =>
  ({ key, section, type, labelAr, labelEn, required, ...extra });

const LONG = 2000;

export const FORM_FIELDS: readonly FieldDef[] = [
  // ── 1. البيانات الشخصية ──
  f('fullName', 'personal', 'text', 'الاسم الرباعي', 'Full name (four parts)', true, { maxLength: 200 }),
  f('nationalId', 'personal', 'nationalId', 'الرقم القومي (14 رقم)', 'National ID (14 digits)', true),
  f('birthDate', 'personal', 'date', 'تاريخ الميلاد', 'Date of birth', true, { hintAr: 'يجب ألا يتجاوز العمر الحد المعلن للدورة', hintEn: 'Age must not exceed the cohort limit' }),
  f('nationality', 'personal', 'select', 'الجنسية', 'Nationality', true, { options: 'nationalities' }),
  f('nationalityOther', 'personal', 'text', 'الجنسية (أخرى)', 'Nationality (other)', false, { maxLength: 100, requiredWhen: { field: 'nationality', equals: 'other' } }),
  f('governorate', 'personal', 'select', 'محافظة الإقامة', 'Governorate of residence', true, { options: 'governorates' }),
  f('address', 'personal', 'textarea', 'عنوان الإقامة', 'Address', true, { maxLength: 500 }),
  f('phone', 'personal', 'phone', 'رقم الهاتف / الواتساب', 'Phone / WhatsApp', true),
  f('email', 'personal', 'email', 'البريد الإلكتروني', 'Email', true),
  f('qualification', 'personal', 'text', 'المؤهل الدراسي والتخصص', 'Qualification & major', true, { maxLength: 300 }),
  f('experience', 'personal', 'textarea', 'الخبرات العملية والمهارات ذات الصلة', 'Relevant experience & skills', true, { maxLength: LONG }),
  // ── 2. فريق العمل ──
  f('applicationType', 'team', 'select', 'هل التقديم فردي أم فريق عمل؟', 'Individual or team application?', true, { options: 'applicationTypes' }),
  f('partners', 'team', 'table', 'بيانات الشركاء', 'Partners', false, {
    maxItems: policy.team.maxPartners, minItems: 1, requiredWhen: { field: 'applicationType', equals: 'team' },
    columns: [
      { key: 'name', type: 'text', labelAr: 'اسم الشريك', labelEn: 'Partner name', required: true, maxLength: 200 },
      { key: 'nationalId', type: 'nationalId', labelAr: 'الرقم القومي', labelEn: 'National ID', required: true },
      { key: 'age', type: 'integer', labelAr: 'السن', labelEn: 'Age', required: true },
      { key: 'qualification', type: 'text', labelAr: 'المؤهل الدراسي', labelEn: 'Qualification', required: true, maxLength: 200 },
      { key: 'role', type: 'text', labelAr: 'الدور المسؤول عنه في المشروع', labelEn: 'Role in the project', required: true, maxLength: 200 },
    ],
  }),
  // ── 3. الملخص والمجال ──
  f('projectName', 'project', 'text', 'اسم المشروع / الفكرة المقترحة', 'Project name / proposed idea', true, { maxLength: 200 }),
  f('sector', 'project', 'select', 'القطاع الرئيسي للمشروع', 'Main sector', true, { options: 'sectors' }),
  f('projectStage', 'project', 'select', 'مرحلة المشروع الحالية', 'Current project stage', true, { options: 'projectStages' }),
  f('projectGovernorate', 'project', 'select', 'محافظة الموقع المقترح', 'Proposed location — governorate', true, { options: 'governorates' }),
  f('projectLocation', 'project', 'text', 'المنطقة الصناعية / الموقع', 'Industrial zone / site', false, { maxLength: 200 }),
  // ── 4. الفكرة والمنتج ──
  f('ideaDescription', 'idea', 'textarea', 'وصف مختصر للفكرة', 'Brief idea description', true, {
    maxLength: LONG, maxWords: policy.idea.maxWords, hintAr: 'اشرح طبيعة المنتج أو الخدمة (في حدود 100 كلمة)', hintEn: 'Describe the product or service (up to 100 words)' }),
  f('problem', 'idea', 'textarea', 'المشكلة أو الاحتياج في السوق', 'Market problem or need', true, { maxLength: LONG,
    hintAr: 'ما المشكلة التي يحلها مشروعك؟ أو ما النقص الذي يسده في السوق المحلي؟', hintEn: 'What problem does it solve or what gap does it fill?' }),
  f('targetCustomers', 'idea', 'textarea', 'العملاء المستهدفون', 'Target customers', true, { maxLength: LONG,
    hintAr: 'مصانع، تجار، جهات حكومية، مستهلك نهائي', hintEn: 'Factories, traders, government, end consumers' }),
  f('competitiveAdvantage', 'idea', 'textarea', 'القيمة المضافة والميزة التنافسية', 'Added value & competitive advantage', true, { maxLength: LONG }),
  // ── 5. الجاهزية والتمويل المبدئي ──
  f('startTimeline', 'readiness', 'select', 'المدى الزمني المتوقع للبدء عند الموافقة', 'Expected start after approval', true, { options: 'startTimelines' }),
  f('estimatedCost', 'readiness', 'money', 'التكلفة الاستثمارية المبدئية التقديرية (جنيه)', 'Estimated initial investment (EGP)', true),
  f('requestedFunding', 'readiness', 'money', 'الاحتياج التمويلي المطلوب من المبادرة (جنيه)', 'Funding requested from the initiative (EGP)', true),
  f('hasOwnFunding', 'readiness', 'yesNo', 'هل توجد مصادر تمويل حالية أو مساهمة ذاتية؟', 'Existing funding or own contribution?', true),
  f('ownFundingDetails', 'readiness', 'text', 'القيمة أو المصدر', 'Amount or source', false, { maxLength: 300, requiredWhen: { field: 'hasOwnFunding', equals: true } }),
  // ── 6. الإقرارات ──
  f('declTermsRead', 'declarations', 'checkbox', 'أقر بأنني قرأت واطلعت على الشروط العامة لمبادرة «صُنّاع المستقبل».', 'I have read the general terms of the initiative.', true),
  f('declDataTrue', 'declarations', 'checkbox', 'أقر بأن جميع البيانات والمستندات المقدمة صحيحة وتحت مسؤوليتي الشخصية.', 'All data and documents are true and under my responsibility.', true),
  f('declConfidentiality', 'declarations', 'checkbox', 'أوافق على شروط سرية البيانات وحماية الملكية الفكرية المعتمدة بالمنصة.', 'I accept the confidentiality and IP protection terms.', true),
  f('declParticipation', 'declarations', 'checkbox', 'ألتزم بالمشاركة الفعالة في كافة دورات الدعم الفني وإعداد الدراسات حال ترشح المشروع.', 'I commit to take part in all support sessions and studies if shortlisted.', true),
  // ── مستندات التقديم ──
  f('nationalIdFile', 'personal', 'file', 'صورة بطاقة الرقم القومي', 'National ID card copy', true, { docKind: 'nationalIdFile' }),
  f('qualificationFile', 'personal', 'file', 'شهادة المؤهل الدراسي', 'Qualification certificate', false, { docKind: 'qualificationFile' }),
  f('supportingFiles', 'idea', 'files', 'مرفقات داعمة (عرض تقديمي، صور، نموذج أولي...)', 'Supporting attachments', false, { docKind: 'supportingFile', maxItems: policy.files.supportingMax }),

  // ════ دراسة الجدوى ════
  // ── ثانيًا: دراسة السوق ──
  f('productName', 'study_market', 'text', 'اسم المنتج / الخدمة الأساسية', 'Main product / service', true, { maxLength: 200 }),
  f('technicalDescription', 'study_market', 'textarea', 'الوصف الفني والتفصيلي', 'Technical description', true, { maxLength: LONG }),
  f('marketProblem', 'study_market', 'textarea', 'المشكلة التي يعالجها المنتج في السوق', 'Market problem addressed', true, { maxLength: LONG }),
  f('competitiveEdge', 'study_market', 'textarea', 'الميزة التنافسية', 'Competitive edge', true, { maxLength: LONG }),
  f('targetSegment', 'study_market', 'text', 'الفئة المستهدفة', 'Target segment', true, { maxLength: 300 }),
  f('annualDemand', 'study_market', 'text', 'حجم الطلب المتوقع سنويًا (بالكمية أو القيمة)', 'Expected annual demand', true, { maxLength: 300 }),
  f('importSubstitution', 'study_market', 'yesNo', 'هل يساهم المنتج في إحلال الواردات؟', 'Does it substitute imports?', true),
  f('importedProduct', 'study_market', 'text', 'المنتج المستورد المستهدف بديله', 'Imported product being substituted', false, { maxLength: 300, requiredWhen: { field: 'importSubstitution', equals: true } }),
  f('exportOpportunities', 'study_market', 'textarea', 'فرص التصدير المستقبلية والأسواق المستهدفة', 'Export opportunities & target markets', false, { maxLength: LONG }),
  f('competitors', 'study_market', 'textarea', 'أبرز المنافسين في السوق', 'Main competitors', true, { maxLength: LONG }),
  f('pricing', 'study_market', 'textarea', 'السعر المقترح مقارنة بأسعار المنافسين', 'Proposed price vs competitors', true, { maxLength: LONG }),
  f('salesChannels', 'study_market', 'textarea', 'قنوات البيع والتوزيع المقترحة', 'Sales & distribution channels', true, { maxLength: LONG }),
  // ── ثالثًا: الدراسة الفنية ──
  f('productionCapacity', 'study_technical', 'text', 'الطاقة الإنتاجية المستهدفة (سنويًا/شهريًا)', 'Target production capacity', true, { maxLength: 300 }),
  f('technologyLevel', 'study_technical', 'select', 'التكنولوجيا المستخدمة', 'Technology used', true, { options: 'technologyLevels' }),
  f('assets', 'study_technical', 'table', 'الأصول الثابتة والمعدات', 'Fixed assets & equipment', true, {
    minItems: 1, maxItems: policy.study.maxAssetRows,
    columns: [
      { key: 'item', type: 'text', labelAr: 'البيان', labelEn: 'Item', required: true, maxLength: 200 },
      { key: 'specs', type: 'text', labelAr: 'المواصفات الفنية', labelEn: 'Specifications', required: false, maxLength: 300 },
      { key: 'quantity', type: 'integer', labelAr: 'العدد', labelEn: 'Quantity', required: true },
      { key: 'cost', type: 'money', labelAr: 'التكلفة التقديرية (جنيه)', labelEn: 'Estimated cost (EGP)', required: true },
    ],
  }),
  f('materials', 'study_technical', 'table', 'المستلزمات والمواد الخام (شهريًا)', 'Raw materials (monthly)', false, {
    maxItems: policy.study.maxMaterialRows,
    columns: [
      { key: 'name', type: 'text', labelAr: 'المادة الخام / المكون', labelEn: 'Material', required: true, maxLength: 200 },
      { key: 'source', type: 'select', labelAr: 'المصدر', labelEn: 'Source', required: true, options: 'materialSources' },
      { key: 'monthlyQuantity', type: 'text', labelAr: 'الكمية الشهرية', labelEn: 'Monthly quantity', required: true, maxLength: 100 },
      { key: 'monthlyCost', type: 'money', labelAr: 'التكلفة التقديرية (جنيه)', labelEn: 'Monthly cost (EGP)', required: true },
    ],
  }),
  f('directWorkers', 'study_technical', 'integer', 'عدد العمالة المباشرة (فنيين/عمال)', 'Direct workers', true),
  f('indirectWorkers', 'study_technical', 'integer', 'عدد العمالة غير المباشرة (إدارة/تسويق)', 'Indirect workers', true),
  f('monthlyPayroll', 'study_technical', 'money', 'إجمالي الأجور والمرتبات الشهرية (جنيه)', 'Total monthly payroll (EGP)', true),
  f('siteArea', 'study_technical', 'number', 'مساحة الموقع المطلوبة (م²)', 'Required site area (m²)', true),
  f('utilities', 'study_technical', 'textarea', 'المرافق المطلوبة (كهرباء، مياه، صرف، غاز...)', 'Required utilities', true, { maxLength: LONG }),
  f('licenses', 'study_technical', 'textarea', 'التراخيص والاشتراطات البيئية والصناعية المطلوبة', 'Required licenses & environmental requirements', true, { maxLength: LONG }),
  // ── رابعًا: الدراسة المالية ──
  f('establishmentCosts', 'study_financial', 'money', 'مصروفات التأسيس والتراخيص والدراسات (جنيه)', 'Establishment, licensing & study costs (EGP)', true),
  f('workingCapital', 'study_financial', 'money', 'رأس المال العامل لـ 3 أشهر تشغيل أولى (جنيه)', 'Working capital for first 3 months (EGP)', true),
  f('ownContribution', 'study_financial', 'money', 'المساهمة الذاتية (جنيه)', 'Own contribution (EGP)', false),
  f('requestedFinancing', 'study_financial', 'money', 'التمويل المطلوب من المبادرة/الشركاء (جنيه)', 'Financing requested (EGP)', true),
  f('preferredModel', 'study_financial', 'select', 'نموذج التمويل المفضل', 'Preferred financing model', true, { options: 'financingModels' }),
  f('firstYearRevenue', 'study_financial', 'money', 'إجمالي الإيرادات المتوقعة — السنة الأولى (جنيه)', 'Expected revenue — year 1 (EGP)', true),
  f('firstYearCosts', 'study_financial', 'money', 'إجمالي التكاليف التشغيلية — السنة الأولى (جنيه)', 'Operating costs — year 1 (EGP)', true),
  f('paybackYears', 'study_financial', 'number', 'فترة الاسترداد المتوقعة (سنوات)', 'Payback period (years)', true),
  f('breakEvenPercent', 'study_financial', 'percent', 'نقطة التعادل (% من الطاقة الإنتاجية)', 'Break-even (% of capacity)', true),
  // ── خامسًا: المخاطر ──
  f('marketRisk', 'study_risks', 'textarea', 'مخاطر السوق', 'Market risks', true, { maxLength: LONG, hintAr: 'مثل: انخفاض الطلب أو دخول منافس قوي', hintEn: 'e.g. lower demand or a strong competitor' }),
  f('marketMitigation', 'study_risks', 'textarea', 'إجراءات الحد من مخاطر السوق', 'Market risk mitigation', true, { maxLength: LONG }),
  f('operationalRisk', 'study_risks', 'textarea', 'مخاطر التشغيل والتوريد', 'Operational & supply risks', true, { maxLength: LONG, hintAr: 'مثل: تأخر المواد الخام أو أعطال المعدات', hintEn: 'e.g. raw material delays or equipment failure' }),
  f('operationalMitigation', 'study_risks', 'textarea', 'إجراءات الحد من مخاطر التشغيل', 'Operational risk mitigation', true, { maxLength: LONG }),
  f('financialRisk', 'study_risks', 'textarea', 'المخاطر المالية', 'Financial risks', true, { maxLength: LONG, hintAr: 'مثل: ارتفاع تكاليف التشغيل أو تعثر التدفقات', hintEn: 'e.g. rising costs or cash-flow stress' }),
  f('financialMitigation', 'study_risks', 'textarea', 'إجراءات الحد من المخاطر المالية', 'Financial risk mitigation', true, { maxLength: LONG }),
  // ── سادسًا: الاستدامة والأثر ──
  f('directJobs', 'study_impact', 'integer', 'فرص العمل المباشرة', 'Direct jobs', true),
  f('indirectJobs', 'study_impact', 'integer', 'فرص العمل غير المباشرة المتوقعة', 'Expected indirect jobs', true),
  f('localValueAdded', 'study_impact', 'textarea', 'القيمة المضافة المحلية', 'Local value added', true, { maxLength: LONG,
    hintAr: 'كيف يسهم المشروع في المكون المحلي وإحلال الواردات؟', hintEn: 'How does the project add local content?' }),
  f('environmentalImpact', 'study_impact', 'textarea', 'الأثر البيئي والحلول المستدامة', 'Environmental impact & sustainability', true, { maxLength: LONG }),
  // ── خطة التنفيذ (تصبح مراحل الصرف) ──
  f('phases', 'study_plan', 'table', 'مراحل التنفيذ', 'Implementation phases', true, {
    minItems: policy.study.minPlanRows, maxItems: policy.study.maxPlanRows,
    hintAr: 'كل مرحلة تصبح مرحلة إنجاز يُصرف تمويلها بعد التحقق منها', hintEn: 'Each phase becomes a milestone funded after verification',
    columns: [
      { key: 'title', type: 'text', labelAr: 'المرحلة', labelEn: 'Phase', required: true, maxLength: 200 },
      { key: 'weeks', type: 'integer', labelAr: 'المدة (أسابيع)', labelEn: 'Duration (weeks)', required: true },
      { key: 'amount', type: 'money', labelAr: 'التمويل المطلوب للمرحلة (جنيه)', labelEn: 'Phase funding (EGP)', required: true },
    ],
  }),
  // ── الخبير الداعم ──
  f('expertId', 'expert', 'select', 'الخبير أو مقدم الخدمة الداعم لإعداد الدراسة', 'Supporting expert or service provider', false, { options: 'experts' }),
  // ── مرفقات الدراسة ──
  f('studyFile', 'study_plan', 'file', 'ملف دراسة الجدوى الكاملة (اختياري)', 'Full feasibility study file (optional)', false, { docKind: 'studyFile' }),
  f('quotationFiles', 'study_technical', 'files', 'عروض أسعار المعدات', 'Equipment quotations', false, { docKind: 'quotationFile', maxItems: policy.files.quotationMax }),
];

export const FIELD_BY_KEY = new Map(FORM_FIELDS.map((x) => [x.key, x]));
export const DATA_FIELDS = FORM_FIELDS.filter((x) => x.type !== 'file' && x.type !== 'files');
export const FILE_FIELDS = FORM_FIELDS.filter((x) => x.type === 'file' || x.type === 'files');

export function dataFieldsOf(section: FormSection): FieldDef[] {
  return DATA_FIELDS.filter((x) => x.section === section);
}
export function fieldsOfForm(kind: FormKind): FieldDef[] {
  return FORM_FIELDS.filter((x) => formOfSection(x.section) === kind);
}
export function documentKindsOfForm(kind: FormKind): DocumentKind[] {
  return FILE_FIELDS.filter((x) => formOfSection(x.section) === kind).map((x) => x.docKind!);
}

/** المستندات متعددة النسخ (تُضاف دون استبدال). */
export const MULTI_DOCUMENT_KINDS: readonly DocumentKind[] = ['supportingFile', 'quotationFile', 'milestoneEvidence'];

export const DOCUMENT_LABELS: Record<DocumentKind, { ar: string; en: string }> = {
  nationalIdFile: { ar: 'بطاقة الرقم القومي', en: 'National ID card' },
  qualificationFile: { ar: 'شهادة المؤهل', en: 'Qualification certificate' },
  supportingFile: { ar: 'مرفق داعم', en: 'Supporting attachment' },
  studyFile: { ar: 'ملف دراسة الجدوى', en: 'Feasibility study file' },
  quotationFile: { ar: 'عرض سعر', en: 'Quotation' },
  approvalFile: { ar: 'قرار الاعتماد', en: 'Approval decision' },
  fundingDecisionFile: { ar: 'قرار التمويل', en: 'Funding decision' },
  milestoneEvidence: { ar: 'دليل إنجاز مرحلة', en: 'Milestone evidence' },
};

/** حقل النواقص ← نوع المستند (الحقول التي هي ملفات). */
export function docKindForField(field: string): DocumentKind | null {
  return FIELD_BY_KEY.get(field)?.docKind ?? null;
}

export function fieldForDocKind(kind: DocumentKind): string {
  return FILE_FIELDS.find((x) => x.docKind === kind)?.key ?? kind;
}

/** حقول النواقص المسموح بها لكل نوع تصحيح. */
export function deficiencyFieldsOf(kind: FormKind): Set<string> {
  return new Set(fieldsOfForm(kind).map((x) => x.key));
}
