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
   * D12 (2026-11-27): IMC يومان، وENCPC ثلاثة أيام (أيام تقويمية). مهلة العرض الفني في `slaPhases`.
   */
  slaDays: {
    DRAFT: null,
    IMC_REVIEW: 2, IMC_CORRECTION: null,
    ENCPC_REVIEW: 3, ENCPC_CORRECTION: null,
    PROVIDER_SELECTION: null, OFFER_UPLOAD: null,
    OFFER_REVIEW: null, OFFER_CORRECTION: null,
    ELECTRICITY_UPLOAD: null, ELECTRICITY_REVIEW: null,
    BANK_STUDY: null, CONTRACT_OUTCOME: null,
    DISTRIBUTION_UPLOAD: null, DISTRIBUTION_REVIEW: null,
  } as Partial<Record<ApplicationState, number | null>>,

  /**
   * D12: one deadline shared by several states, counted from the moment the application entered the first of them
   * (`slaStartedAt`) and not restarted when it moves between them. Offer phase: from ENCPC's technical acceptance
   * until PMU accepts the offer, revisions included.
   */
  slaPhases: {
    offer: { states: ['OFFER_UPLOAD', 'OFFER_REVIEW', 'OFFER_CORRECTION'], days: 9 },
  } as Record<string, { states: ApplicationState[]; days: number | null }>,

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

  // ── قرارات المالك بعد اختبار QA الشامل (2026-11-23) — D1 إلى D10. تتقدم على المرجع القديم حيث يختلفان. ──
  /**
   * D1 — نموذج البنك: G-01 وG-02 كما بُنيا. البنك جهة بلا حسابات؛ بعد «مستوفاة» يختار المصنع مسار التعاقد، وفي مسار البنك
   * يختار بنكًا نشطًا واحدًا ويتعامل معه خارج المنصة ويسجل النتيجة بنفسه. لا حسابات للبنوك (BUG-01/02 تحديث للمرجع لا للكود).
   * D2 — البنك الموقوف: إيقاف البنك يحرر كل طلب مفتوح مرتبط به؛ يختار المصنع بنكًا نشطًا آخر وتُبلَّغ PMU،
   * ولا يُسجل تعاقد مع بنك غير نشط (services/accounts.ts updateOrg + workflow/actionService.ts).
   */
  bankDeactivation: 'release_open_applications' as const,
  /**
   * D3 — المصنع قبل قبول IMC: يرى طلبه المرسل للقراءة فقط، وينسحب بسبب أثناء مراجعة IMC وأثناء استيفاء البيانات،
   * ويقدم اعتراضًا على رقم السجل. كل ما عدا ذلك مقفل (middleware/factoryAccess.ts).
   */
  unapprovedFactoryMay: ['view_own_application', 'withdraw', 'registry_objection'] as const,
  /**
   * D4 — نزاع رقم السجل: ما دام النزاع مفتوحًا (اعتراض قيد المراجعة) لا يتقدم طلب صاحب الرقم. إن خوّلت PMU المعترض
   * تُغلق المنصة طلب صاحب الرقم المفتوح «مرفوض» بالرمز REGISTRY_OWNERSHIP في أي مرحلة، ويُرفع الحظر عن المعترض. إن خوّلت
   * صاحب الرقم يُغلق الاعتراض ويبقى المعترض محظورًا (services/registryDisputes.ts).
   * D5 — إشعار النزاع: الطرف الخاسر يصله القرار والسبب والمرجع دون اسم الشركة الأخرى؛ PMU وIMC يريان الاسمين.
   */
  registryDispute: { freezeHolderWhileObjectionPending: true, closeHolderReasonCode: 'REGISTRY_OWNERSHIP', loserSeesOtherCompany: false } as const,
  /**
   * D6 — إيقاف مقدم الخدمة أثناء «رفع العرض الفني»: يعود الطلب إلى «اختيار مقدم الخدمة» بقيد في السجل وإشعار للمصنع.
   * D7 — إيقافه بعد قبول العرض (بعد T13): لا تتغير الحالة؛ تنبيه للمصنع وPMU داخل المنصة وبالبريد، وقيد في السجل.
   * (workflow/providerEvents.ts)
   */
  providerSuspendedInOfferUpload: 'return_to_provider_selection' as const,
  providerSuspendedAfterOfferAccepted: 'warn_factory_and_pmu' as const,
  /**
   * D8 — رقم سجل غير صحيح في صفحة التسجيل العامة: كما بُني — رسالة عربية واضحة، البيانات تبقى في النموذج، ولا يُنشأ شيء.
   * T2 في المرجع يخص مسار حساب المنصة فقط.
   * D9 — مسار التعاقد عن طريق شركة توزيع الكهرباء: معتمد كما بُني (T28 فما بعد في المرجع).
   * D10 — الأسباب في الإشعارات (لكل المبادرات): الإشعار الداخلي يحمل السبب كاملًا، والـ SMS القرار والسبب مختصرًا في
   * رسالتين مع رابط، والـ outbox يحفظ نص الـ SMS حتى بلا مزود (core/notify/decisionText.ts).
   * تبقى كما هي: PMU وENCPC يديران دليل مقدمي الخدمة؛ طلب مفتوح واحد لكل مصنع ومسودة جديدة بعد أي حالة نهائية؛ مدير النظام
   * يرى مقدم الخدمة المختار وحالة التعاقد وتاريخه؛ الاستيفاء يعدّل الحقول التي حددتها IMC فقط.
   */
  publicSignupInvalidRegistry: 'refuse_keep_form' as const,
  distributionRouteApproved: true,

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
