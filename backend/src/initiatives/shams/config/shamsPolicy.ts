/**
 * سياسة مبادرة «شمس الصناعة» — المكان الوحيد للقيم التي لم تُعتمد نهائيًا (البنود ★ والقرارات المفتوحة).
 * غيّر القيم هنا فقط؛ لا تبعثرها في الكود. أي قيمة تُعرض للواجهة تمر عبر GET /api/v1/meta.
 */
import { config } from '../config.js';
import type { ApplicationState } from '../workflow/shamsWorkflow.js';
import type { Role } from '../domain.js';


/** مفاتيح حقول فورم التسجيل والتقديم (القسم 6 من المواصفة). */
export type FormFieldKey =
  | 'companyName' | 'governorate' | 'industrialZone' | 'address' | 'phone1' | 'phone2' | 'fax' | 'website'
  | 'contactName' | 'contactTitle' | 'contactMobile' | 'contactPhone' | 'contactFax' | 'contactEmail'
  | 'commercialRegisterNumber' | 'commercialRegisterFile' | 'industrialRegistryNumber' | 'industrialRegisterFile'
  | 'taxNumber' | 'taxCardFile'
  | 'roofAreas' | 'electricityBills' | 'contractedCapacity' | 'capacityUnit' | 'peakLoad' | 'loadUnit'
  | 'ownershipProofFile' | 'ownershipType' | 'ownershipExpiresAt';

export const shamsPolicy = {
  /**
   * ★ الحقول الإجبارية — لم تُعتمد نهائيًا. القيمة الابتدائية من جدول القسم 6.
   * `ownershipExpiresAt` إجباري لأن البند «إجباري: نعم» يشمل الثلاثة (ملف + نوع + تاريخ).
   */
  requiredFields: {
    companyName: true, governorate: true, industrialZone: true, address: true,
    phone1: true, phone2: false, fax: false, website: false,
    contactName: true, contactTitle: true, contactMobile: true, contactPhone: false, contactFax: false, contactEmail: true,
    commercialRegisterNumber: true, commercialRegisterFile: true,
    industrialRegistryNumber: true, industrialRegisterFile: true,
    taxNumber: true, taxCardFile: true,
    roofAreas: true, electricityBills: true,
    contractedCapacity: true, capacityUnit: true, peakLoad: true, loadUnit: true,
    ownershipProofFile: true, ownershipType: true, ownershipExpiresAt: true,
  } satisfies Record<FormFieldKey, boolean>,

  /** حجم ملف PDF الأقصى بالميجابايت (قابل للضبط بـ MAX_FILE_SIZE_MB). */
  get maxFileSizeMB(): number { return config.maxFileSizeMB; },
  electricityBills: { min: 1, max: 12 },
  roofAreas: { min: 1, max: 50 },
  capacityUnits: ['kW', 'kVA'] as const,
  loadUnits: ['kW', 'kVA'] as const,
  /** TODO(محتوى): أنواع إثبات الملكية/الاستخدام لم تُحدد رسميًا — قيم مبدئية. */
  ownershipTypes: [
    { value: 'owned', labelAr: 'ملكية', labelEn: 'Ownership' },
    { value: 'leased', labelAr: 'إيجار', labelEn: 'Lease' },
    { value: 'usufruct', labelAr: 'حق انتفاع', labelEn: 'Usufruct' },
  ] as const,

  /**
   * ★ المهل بالأيام لكل حالة انتظار (مراجعة الجهات أو رد المصنع). `null` = غير محددة → لا يُعرض تجاوز.
   * تُحسب من `stateEnteredAt`. عند التجاوز: إشعار وعلامة تأخر فقط — لا رفض ولا إغلاق تلقائي.
   */
  slaDays: {
    DRAFT: null,
    IMC_REVIEW: null, IMC_CORRECTION: null,
    ENCPC_REVIEW: null, ENCPC_CORRECTION: null,
    PROVIDER_SELECTION: null, OFFER_UPLOAD: null,
    OFFER_REVIEW: null, OFFER_CORRECTION: null,
    ELECTRICITY_UPLOAD: null, ELECTRICITY_REVIEW: null,
    BANK_STUDY: null, CONTRACT_OUTCOME: null,
    DISTRIBUTION_UPLOAD: null, DISTRIBUTION_REVIEW: null,
  } as Partial<Record<ApplicationState, number | null>>,

  // ── القرارات المفتوحة (القسم 12) ──
  /** حد مرات الإرجاع لكل مرحلة. null = بلا حد (ويُعرض العدد لـ PMU). */
  maxReturnsPerStage: null as number | null,
  /** ★ الانسحاب مسموح من أي حالة غير نهائية. */
  withdrawFrom: 'any_non_terminal' as const,
  /** G-01: بنك واحد يختاره المصنع بعد قبول PMU لموافقة الكهرباء (مرة واحدة). */
  bankSelection: 'single_by_factory_after_electricity' as const,
  /** G-02: لا حساب للبنك؛ المصنع يسجل نتيجة التعاقد مباشرة. */
  contractOutcomeRecordedBy: 'factory' as const,
  /** ★ الجهة التي تراجع موافقة الكهرباء. */
  electricityReviewer: 'pmu' as const,
  /** ★ السجل غير الصحيح: تصحيح مع بقاء المسودة. */
  invalidRegistry: 'stay_draft' as const,
  /**
   * دليل مقدمي الخدمة (ليسوا مستخدمين ولا بوابة): ENCPC تضيف وتعدّل (الاسم والتفاصيل والشعار) وتفعّل وتلغي التفعيل.
   * ظهور المقدم للمصنع = مفعّل من ENCPC + (إن كان providerApprovalRequired) معتمد من PMU.
   */
  providerManagerRoles: ['encpc_reviewer'] as Role[],
  /**
   * ★ هل يلزم اعتماد PMU قبل ظهور المقدم؟ المخطط 5.0 يجعل اعتماد قائمة المقدمين عند PMU، وقرار الحوكمة النهائي لم يصدر،
   * فالقيمة الافتراضية true (لا نحذف ضابطًا قائمًا بصمت). false = تكفي موافقة ENCPC ويبقى لـPMU الإيقاف.
   */
  providerApprovalRequired: true,
  /** ★ من يعتمد مقدمي الخدمة ويوقفهم — PMU فقط حتى يُعتمد غير ذلك (المخطط 5.0). */
  providerApproverRoles: ['pmu_reviewer'] as Role[],
  /** شعار مقدم الخدمة: صور فقط (لا SVG لأنه قد يحمل سكربتات)، بحد أقصى صغير. */
  providerLogo: { maxBytes: 1024 * 1024, mimes: ['image/png', 'image/jpeg', 'image/webp'] as const },
  /**
   * ★ هل يرى الأدمن بيانات الطلبات ومستنداتها؟ false = البيانات الوصفية فقط (الرقم والحالة والتواريخ وقائمة المستندات
   * بلا تنزيل، بلا بيانات الفورم ولا الأسباب والملاحظات). قيمة مؤقتة حتى قرار الجهة المالكة.
   */
  adminCanViewApplicationDocuments: false,
  /**
   * ★ حد تنبيه PMU لقيمة التعاقد المسجلة من المصنع (جنيه). من وثيقة المبادرة: 100 مليون للعميل الواحد.
   * تنبيه فقط — لا رفض، ولا يُطبق حد الأطراف المرتبطة (200 مليون) آليًا.
   */
  contractAmountAlertEGP: 100_000_000,
  /** أسباب الرفض المنظمة لـ IMC. `registry_ownership_mismatch` يحظر على نفس المصنع إعادة استخدام الرقم حتى إجراء موثق من PMU. */
  imcRejectReasonCodes: ['registry_ownership_mismatch', 'other'] as const,
  /** TODO(محتوى): أسماء غير واردة في مصادر المبادرة — تُعرض كما هي حتى الاعتماد (M9). */
  pendingContent: {
    imcFullName: 'مركز تحديث الصناعة (IMC)',
    encpcFullName: 'ENCPC',
  },
  /** رفض البنك: يسجل المصنع عدم التعاقد، ولا إحالة لبنك آخر. */
  bankDeclineFlow: 'factory_records_outcome' as const,
  /** G-09 (معتمد): بعد الحالة النهائية يبقى الطلب في السجل، ويجوز للمصنع بدء طلب جديد (طلب نشط واحد فقط في كل وقت). */
  allowReapplyAfterTerminal: true,
  /** الجداول تدعم عدة مستخدمين للمصنع؛ الواجهة تكتفي بالمالك. */
  factoryDelegatedUsersInUi: false,

  // ── قرارات المراجعة الأمنية (docs/SECURITY_FIX_REPORT.md §القرارات) ──
  /**
   * القرار 1: حسابات جهات القرار (IMC/ENCPC/PMU/البنوك) لا تُنشأ ولا يتغير بريدها إلا بموافقة مستخدم نشط من الجهة نفسها،
   * وللبنوك أيضًا مستخدم نشط من PMU. مقدم الطلب لا يوافق على طلبه. أول مستخدم في أي جهة بأمر CLI على السيرفر فقط.
   */
  accountApproval: {
    approverRolesForBank: ['pmu_reviewer'] as Role[],
    firstUserViaCliOnly: true,
  },
  /** مدة رابط تعيين كلمة المرور (بعد الموافقة على الحساب أو إعادة التعيين الإدارية) — لمرة واحدة. */
  accountSetupLinkHours: 72,
  /** القرار 2: استرداد بريد المصنع — موافقة PMU، ثم مهلة انتظار قبل التنفيذ. */
  accountRecoveryApproverRoles: ['pmu_reviewer'] as Role[],
  accountRecoveryCoolingHours: 48,
  /** القرار 3: API الربط بيانات وصفية فقط — المفتاح الرئيسي في إعدادات النشر (config.integrationDataScopesEnabled). */
  get integrationDataScopesEnabled(): boolean { return config.integrationDataScopesEnabled; },
  /** عند تفعيل نطاقات البيانات لاحقًا: يُفعَّل المفتاح بها بعد موافقة PMU. */
  integrationKeyApproverRoles: ['pmu_reviewer'] as Role[],
  /** القرار 4: حظر رقم السجل على الرقم نفسه لكل الحسابات؛ اعتراض المالك بمستند تراجعه PMU وترفع الحظر لمصنع محدد. */
  registryBlockScope: 'registry_number' as const,
  registryObjectionReviewerRoles: ['pmu_reviewer'] as Role[],
  /** القرار 5: مطابقة المالك/المفوض مع السجل — تُسجَّل فقط عند توفر API السجل، ولا منع آلي. */
  registryOwnershipCheck: 'record_only' as const,
  /** القرار 6: إيقاف مقدم الخدمة أثناء مراجعة العرض أو تصحيحه → عودة تلقائية إلى OFFER_UPLOAD مع طلب عرض جديد. */
  providerSuspendedDuringOfferReview: 'return_to_offer_upload' as const,
  /** L7: حدود تخزين المستندات (ضد ملء القرص من حساب ذاتي التسجيل). */
  documentLimits: { maxVersionsPerKindPerAttempt: 10, maxApplicationStorageMB: 300 },
  /** M3: تأخير متصاعد لكل (بريد، IP) بدل القفل الكامل، وإبلاغ صاحب الحساب عند النشاط المتكرر. */
  loginThrottle: { freeFailures: 3, maxDelaySec: 15 * 60, resetAfterMin: 60, notifyOwnerAfterFailures: 10 },
};

export type ShamsPolicy = typeof shamsPolicy;
