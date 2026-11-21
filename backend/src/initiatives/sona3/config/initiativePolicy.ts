/**
 * سياسة مبادرة «صُنّاع المستقبل» — المكان الوحيد للقيم التي لم تُعتمد نهائيًا (البنود ★ في docs/SONA3_DESIGN.md).
 * غيّر القيم هنا فقط؛ لا تبعثرها في الكود. أي قيمة تُعرض للواجهة تمر عبر GET /api/v1/meta.
 * قيم كل دورة (المواعيد والمستهدفات والأوزان والحدود الدنيا) في جدول cohorts ويديرها الأدمن.
 */
import { config } from '../config.js';
import type { ApplicationState } from '../workflow/workflow.js';

/** معايير التقييم الستة (المقترح التنفيذي — سابعًا). المفاتيح ثابتة؛ الأوزان لكل دورة. */
export const CRITERIA = [
  { key: 'financial', labelAr: 'الجدوى المالية والاستدامة', labelEn: 'Financial feasibility & sustainability',
    hintAr: 'مدى قابلية المشروع للاستمرار وتحقيق عائد اقتصادي', hintEn: 'Ability to sustain and generate economic return' },
  { key: 'technical', labelAr: 'الجدوى الفنية وقابلية التنفيذ', labelEn: 'Technical feasibility & implementability',
    hintAr: 'مدى توافر الإمكانات الفنية والتكنولوجية اللازمة للتنفيذ', hintEn: 'Availability of technical and technological capabilities' },
  { key: 'market', labelAr: 'احتياجات السوق وفرص النمو', labelEn: 'Market need & growth',
    hintAr: 'مدى ارتباط المشروع باحتياجات السوق وإمكانات التوسع', hintEn: 'Fit with market needs and expansion potential' },
  { key: 'innovation', labelAr: 'الابتكار والقيمة المضافة', labelEn: 'Innovation & added value',
    hintAr: 'مستوى الابتكار وما يقدمه من حلول أو منتجات ذات قيمة مضافة', hintEn: 'Level of innovation and value-added solutions' },
  { key: 'jobs', labelAr: 'فرص العمل والأثر الاقتصادي', labelEn: 'Jobs & economic impact',
    hintAr: 'مساهمة المشروع في خلق فرص عمل وتعزيز الإنتاجية والاقتصاد', hintEn: 'Contribution to jobs, productivity and the economy' },
  { key: 'team', labelAr: 'جاهزية فريق العمل', labelEn: 'Team readiness',
    hintAr: 'توافر الخبرات والمهارات والقدرات اللازمة لتنفيذ المشروع', hintEn: 'Experience, skills and capacity to deliver' },
] as const;
export type CriterionKey = (typeof CRITERIA)[number]['key'];
export const CRITERION_KEYS = CRITERIA.map((c) => c.key) as CriterionKey[];

const opt = (value: string, labelAr: string, labelEn: string) => ({ value, labelAr, labelEn });

export const policy = {
  /** حجم ملف PDF الأقصى بالميجابايت (قابل للضبط بـ MAX_FILE_SIZE_MB). */
  get maxFileSizeMB(): number { return config.maxFileSizeMB; },

  /** ★ أوزان افتراضية للدورة الجديدة (يعدّلها الأدمن لكل دورة؛ مجموعها 100). */
  defaultWeights: { financial: 20, technical: 20, market: 15, innovation: 15, jobs: 15, team: 15 } as Record<CriterionKey, number>,

  team: { maxPartners: 10 },
  idea: { maxWords: 100 },
  files: { supportingMax: 5, quotationMax: 10, evidenceMax: 20 },
  study: { maxAssetRows: 50, maxMaterialRows: 50, maxPlanRows: 20, minPlanRows: 1 },

  sectors: [
    opt('manufacturing', 'الصناعات التحويلية (هندسية، غذائية، كيماوية، ملابس، طبية...)', 'Manufacturing (engineering, food, chemical, apparel, medical...)'),
    opt('industrial_tech', 'التكنولوجيا الصناعية (أتمتة، ذكاء اصطناعي، إنترنت الأشياء...)', 'Industrial technology (automation, AI, IoT...)'),
    opt('import_substitution', 'إحلال الواردات (تصنيع بدائل للمنتجات المستوردة)', 'Import substitution'),
    opt('industrial_services', 'المشروعات الخدمية الداعمة للصناعة (صيانة، لوجستيات، سلاسل إمداد)', 'Industry support services (maintenance, logistics, supply chain)'),
    opt('innovation', 'مشروعات ابتكارية وتطوير منتجات', 'Innovation & product development'),
  ],
  projectStages: [
    opt('new_idea', 'فكرة جديدة', 'New idea'),
    opt('founding', 'مشروع قيد التأسيس', 'Under establishment'),
    opt('existing_expansion', 'مشروع قائم يبحث عن توسع/تطوير', 'Existing project seeking expansion'),
  ],
  startTimelines: [
    opt('immediate', 'فورًا (خلال شهر)', 'Immediately (within a month)'),
    opt('1_3_months', 'من 1 إلى 3 أشهر', '1 to 3 months'),
    opt('over_3_months', 'أكثر من 3 أشهر', 'More than 3 months'),
  ],
  applicationTypes: [opt('individual', 'تقديم فردي', 'Individual'), opt('team', 'فريق عمل', 'Team')],
  nationalities: [opt('egyptian', 'مصري', 'Egyptian'), opt('other', 'أخرى', 'Other')],
  technologyLevels: [
    opt('manual', 'يدوية', 'Manual'), opt('semi_auto', 'نصف آلية', 'Semi-automated'),
    opt('full_auto', 'آلية بالكامل', 'Fully automated'), opt('ai_automation', 'معتمدة على الذكاء الاصطناعي/الأتمتة', 'AI / automation based'),
  ],
  materialSources: [opt('local', 'محلي', 'Local'), opt('imported', 'مستورد', 'Imported')],
  /** نماذج التمويل (المقترح — ثامنًا/2). */
  financingModels: [
    opt('soft_loan', 'تمويل ميسر', 'Soft loan'),
    opt('equity', 'مشاركة استثمارية (حقوق ملكية)', 'Equity participation'),
    opt('grant', 'دعم تأسيسي', 'Establishment grant'),
    opt('blended', 'تمويل مختلط', 'Blended finance'),
  ],
  recommendations: [
    opt('strongly_recommend', 'يُوصى به بشدة', 'Strongly recommend'),
    opt('recommend', 'يُوصى به', 'Recommend'),
    opt('recommend_with_conditions', 'يُوصى به بشروط', 'Recommend with conditions'),
    opt('not_recommend', 'لا يُوصى به', 'Do not recommend'),
  ],

  /**
   * ★ المهل بالأيام لكل حالة انتظار. `null` = غير محددة → لا يُعرض تجاوز.
   * عند التجاوز: إشعار وعلامة تأخر فقط — لا رفض ولا إغلاق تلقائي.
   */
  slaDays: {
    ELIGIBILITY_REVIEW: null, ELIGIBILITY_CORRECTION: null,
    STUDY_PREPARATION: null, STUDY_REVIEW: null, STUDY_CORRECTION: null,
    COMMITTEE_EVALUATION: null, EVALUATED: null, SELECTED: null,
    FUNDING_SEARCH: null, FUNDER_REVIEW: null,
  } as Partial<Record<ApplicationState, number | null>>,

  /** ★ التظلم: مرة واحدة خلال N يومًا من القرار. */
  appealWindowDays: 15,
  /** ★ الانسحاب مسموح قبل التمويل فقط (بعده يُغلق المشروع بقرار IMC). */
  withdrawBefore: ['IMPLEMENTATION', 'OPERATING'] as ApplicationState[],
  /** ★ هل يرى الأدمن بيانات الطلبات ومستنداتها؟ false = البيانات الوصفية فقط. */
  adminCanViewApplicationDocuments: false,
  /** ★ الرقم القومي يظهر مقنّعًا للمقيّم وجهة التمويل. */
  maskNationalIdForExternal: true,
  /** ★ المتقدم يرى درجته الإجمالية بعد قرار الاختيار فقط. */
  applicantSeesScoreAfterSelection: true,
  /** ★ اختيار طلب خارج ترتيب الدرجات يحتاج سببًا مكتوبًا. */
  requireReasonForOutOfRankSelection: true,
  /** ★ إعادة التقديم بعد حالة نهائية: مسموحة بطلب جديد في دورة مفتوحة. */
  allowReapplyAfterTerminal: true,
  /** TODO(محتوى): الأسماء الرسمية للجهات حتى الاعتماد. */
  content: {
    initiativeNameAr: 'صُنّاع المستقبل',
    initiativeNameEn: 'Future Makers',
    imcFullName: 'مركز تحديث الصناعة (IMC)',
  },
};

export type InitiativePolicy = typeof policy;
