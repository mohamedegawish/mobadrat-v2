/**
 * محتوى مبادرة «شمس الصناعة» المعروض للزوار.
 * المصدر: وثيقة المبادرة الرسمية (details/مبادرة شمس الصناعة (2).docx) — النص العربي منقول حرفيًا
 * (مع تصحيح إملائي طفيف فقط: «أتاحته فى» ← «إتاحته في»، و«الصناعى» كما وردت).
 * الترجمة الإنجليزية من بذرة المنصة الأصلية (SHAMS_CONTENT) حيث وُجدت، وما سواها معلّم TODO.
 * خريطة الإجراءات: details/shams-sinaa-diagrams.pdf (الإصدار 2.0).
 * ممنوع إضافة أرقام أو نسب أو شروط تمويل أو أسماء جهات غير واردة في المصدر.
 */

export interface Bi { ar: string; en: string }

export const SITE_NAME: Bi = { ar: 'شمس الصناعة', en: 'Shams El-Senaa' };
export const SITE_TAGLINE: Bi = {
  ar: 'لدعم التحول إلى الطاقة الشمسية للاستهلاك الذاتي في القطاع الصناعي',
  // TODO(محتوى): ترجمة الشعار غير واردة في المصدر — صياغة مقترحة تحتاج اعتمادًا.
  en: 'Supporting the industrial sector’s shift to solar energy for self-consumption',
};
export const MINISTRY: Bi = { ar: 'وزارة الصناعة — جمهورية مصر العربية', en: 'Ministry of Industry — Arab Republic of Egypt' };

export const GENERAL_GOAL: Bi = {
  ar: 'التوسع في استخدام الطاقة الجديدة والمتجددة وخفض تكلفة الطاقة على القطاع الصناعي وتنويع مصادر الطاقة للقطاع الصناعى وتعزيز تنافسية الصناعة المصرية وتوطين صناعات الطاقة الشمسية.',
  en: 'Expand the use of new and renewable energy, cut energy costs for industry, diversify the sector’s energy sources, boost the competitiveness of Egyptian industry, and localize solar manufacturing.',
};

/** أرقام رسمية من الوثيقة فقط (لا إحصاءات حية ولا أرقام تجريبية). */
export const OFFICIAL_FIGURES: Array<{ value: Bi; label: Bi }> = [
  { value: { ar: 'نحو 1000 ميجاوات', en: '≈ 1,000 MW' }, label: { ar: 'قدرات شمسية مستهدفة', en: 'Targeted solar capacity' } },
  { value: { ar: 'نحو 7000 مصنع', en: '≈ 7,000 factories' }, label: { ar: 'وفق الجاهزية الفنية والتمويلية', en: 'Per technical & financing readiness' } },
  { value: { ar: '12,5 مليار جنيه', en: 'EGP 12.5 billion' }, label: { ar: 'الحد الأقصى لقيمة المبادرة (قروض مصرفية)', en: 'Initiative cap (bank loans)' } },
  { value: { ar: 'خمس سنوات', en: 'Five years' }, label: { ar: 'الحد الأقصى لمدة المبادرة من تاريخ إطلاقها', en: 'Maximum initiative duration from launch' } },
];

export const OBJECTIVES: Bi[] = [
  { ar: 'إضافة قدرات تصل إلى نحو 1000 ميجاوات من الطاقة الشمسية لخدمة نحو 7000 مصنع وفق الجاهزية الفنية والتمويلية.', en: 'Add up to about 1,000 MW of solar capacity serving about 7,000 factories, according to technical and financing readiness.' },
  { ar: 'خفض تكلفة الكهرباء وتقليل الكهرباء المسحوبة من الشبكة خلال ساعات النهار.', en: 'Cut electricity costs and reduce power drawn from the grid during daylight hours.' },
  { ar: 'تقليل الطلب على الكهرباء المنتجة باستخدام الوقود الأحفوري وخفض البصمة الكربونية.', en: 'Reduce demand for fossil-fuel-generated electricity and cut the carbon footprint.' },
  { ar: 'رفع تنافسية المنتجات المصرية، خاصة المنتجات الموجهة للتصدير.', en: 'Raise the competitiveness of Egyptian products, especially export-oriented ones.' },
  { ar: 'دعم توطين صناعة الألواح الشمسية والمعدات والمكونات المرتبطة بالطاقة الشمسية.', en: 'Support localizing the manufacture of solar panels and related equipment and components.' },
  { ar: 'خلق طلب مستدام على المنتج المحلي المطابق للمواصفات الدولية.', en: 'Create sustained demand for local products that meet international specifications.' },
  { ar: 'دعم نقل التكنولوجيا والاستثمار في صناعات الطاقة المتجددة.', en: 'Support technology transfer and investment in renewable energy industries.' },
];

export const FINANCING_TERMS: Bi[] = [
  { ar: 'الحد الأقصى لقيمة المبادرة مبلغ 12,5 مليار جنيه يتم إتاحته في صورة قروض من الجهاز المصرفي لتمويل إنشاء وتركيب محطات طاقة شمسية للمصانع المستفيدة.', en: 'The initiative is capped at EGP 12.5 billion, made available as loans from the banking sector to finance building and installing solar plants for beneficiary factories.' },
  { ar: 'يوجه التمويل بالعملة المحلية إلى منشآت القطاع الصناعي الخاص المستوفية للاشتراطات والمعايير المصرفية.', en: 'Financing is extended in local currency to private-sector industrial facilities that meet the banking requirements and standards.' },
  { ar: 'الحد الأقصى لمدة المبادرة خمس سنوات من تاريخ إطلاقها.', en: 'The initiative runs for a maximum of five years from its launch.' },
  { ar: 'يكون الحد الأقصى لتمويل العميل الواحد 100 مليون جنيه، والعميل والأطراف المرتبطة به 200 مليون جنيه، وفقًا للقواعد المصرفية المنظمة.', en: 'Up to EGP 100 million per client and EGP 200 million per client and related parties, under the governing banking rules.' },
];

export const ELIGIBILITY: Bi[] = [
  { ar: 'سجل تجاري وسجل صناعي ورخصة تشغيل سارية.', en: 'Valid commercial register, industrial register, and operating license.' },
  { ar: 'فواتير الكهرباء لآخر 12 شهرًا.', en: 'Electricity bills for the last 12 months.' },
  { ar: 'القدرة التعاقدية وأقصى حمل.', en: 'Contracted capacity and peak load.' },
  { ar: 'بيانات الاستهلاك وملف الأحمال متى كان متاحًا.', en: 'Consumption data and load profile, where available.' },
  { ar: 'ساعات وأيام التشغيل.', en: 'Operating hours and days.' },
  { ar: 'بيان المساحات المتاحة.', en: 'Statement of available areas.' },
  { ar: 'إثبات حق الملكية أو الاستخدام طوال مدة التمويل والتشغيل.', en: 'Proof of ownership or right of use for the full financing and operation period.' },
  { ar: 'تقرير إنشائي معتمد بصلاحية الأسطح والمنشآت لتحمل الألواح والهياكل وأحمال الرياح.', en: 'Certified structural report confirming roofs and structures can bear the panels, mounting structures, and wind loads.' },
  { ar: 'بيانات المحولات ولوحات التوزيع ونقاط الربط ومتطلبات الحماية والقياس.', en: 'Data on transformers, distribution panels, connection points, and protection and metering requirements.' },
  { ar: 'دراسة فنية واقتصادية توضح قدرة المحطة والإنتاج السنوي ونسبة الاستهلاك الذاتي والتكلفة والوفر وفترة الاسترداد.', en: 'Technical and economic study showing plant capacity, annual output, self-consumption share, cost, savings, and payback period.' },
  { ar: 'استخدام معدات مطابقة للمواصفات.', en: 'Use of equipment that complies with specifications.' },
  { ar: 'التنفيذ من خلال شركات متخصصة ومؤهلة وفق القواعد المعتمدة.', en: 'Implementation through specialized, qualified companies under the approved rules.' },
  { ar: 'اجتياز التقييم الائتماني لدى البنك الممول.', en: 'Passing the credit assessment at the financing bank.' },
];

export const SELECTION_CRITERIA: Bi[] = [
  { ar: 'الجاهزية الفنية والإنشائية.', en: 'Technical and structural readiness.' },
  { ar: 'توافر التراخيص والسجلات السارية.', en: 'Valid licenses and registers in place.' },
  { ar: 'انتظام الوضع الائتماني والمصرفي.', en: 'A sound credit and banking standing.' },
  { ar: 'ارتفاع أحمال التشغيل النهارية بما يحقق أكبر نسبة من الاستهلاك الذاتي.', en: 'High daytime operating loads that maximize self-consumption.' },
  { ar: 'توافر المساحات المناسبة.', en: 'Availability of suitable space.' },
  { ar: 'تناسب قدرة المحطة مع الاستهلاك الفعلي.', en: 'Plant capacity matched to actual consumption.' },
  { ar: 'المصانع المصدرة أو المستهدفة للتصدير.', en: 'Exporting factories or factories targeting export.' },
  { ar: 'المصانع التي يحقق خفض البصمة الكربونية بها أثرًا على القدرة التنافسية والتصديرية.', en: 'Factories where cutting the carbon footprint improves competitiveness and exports.' },
  { ar: 'الالتزام بمعايير المكون المحلي.', en: 'Commitment to local-component standards.' },
  { ar: 'مراعاة التوزيع القطاعي والجغرافي للمشروعات.', en: 'Balanced sectoral and geographic distribution of projects.' },
];

/** مراحل رحلة الطلب على الموقع — من خريطة الإجراءات (الإصدار 2.0). */
export const JOURNEY: Array<{ title: Bi; desc: Bi; who: Bi }> = [
  { title: { ar: 'تسجيل الطلب', en: 'Register the application' }, desc: { ar: 'إدخال البيانات ورقم السجل الصناعي ورفع المستندات، مع تحقق آلي من السجل.', en: 'Enter the data and industrial registry number and upload documents; the registry is verified automatically.' }, who: { ar: 'المصنع', en: 'Factory' } },
  { title: { ar: 'مراجعة الطلب', en: 'Application review' }, desc: { ar: 'تراجع IMC الطلب والمستندات: قبول أو استيفاء أو رفض.', en: 'IMC reviews the application and documents: accept, request completion, or reject.' }, who: { ar: 'IMC', en: 'IMC' } },
  { title: { ar: 'المراجعة الفنية', en: 'Technical review' }, desc: { ar: 'تقييم فني للطلب بواسطة ENCPC: مطابق أو تصحيح الملف الفني.', en: 'Technical evaluation by ENCPC: compliant, or correct the technical file.' }, who: { ar: 'ENCPC', en: 'ENCPC' } },
  { title: { ar: 'رفع العرض الفني', en: 'Upload the technical offer' }, desc: { ar: 'تواصل مع مقدم خدمة من القائمة المرسلة إليك، وارفع عرضه وبياناته.', en: 'Contact a provider from the list sent to you, then upload its offer and contact details.' }, who: { ar: 'المصنع', en: 'Factory' } },
  { title: { ar: 'مراجعة العرض الفني', en: 'Technical offer review' }, desc: { ar: 'مراجعة وحدة إدارة المبادرة: مقبول أو تعديل العرض.', en: 'Initiative Management Unit review: accepted or revise the offer.' }, who: { ar: 'PMU', en: 'PMU' } },
  { title: { ar: 'موافقة وزارة الكهرباء', en: 'Electricity ministry approval' }, desc: { ar: 'تراجع الوزارة الطلب، وترفع موافقتها أو ترفض بملاحظات.', en: 'The ministry reviews the application and uploads its approval, or rejects with notes.' }, who: { ar: 'وزارة الكهرباء', en: 'Ministry of Electricity' } },
  { title: { ar: 'دراسة الطلب والتعاقد', en: 'Bank study and contracting' }, desc: { ar: 'يستلم البنك الإحالة ويدرسها ويسجل النتيجة.', en: 'The bank receives the referral, studies it and records the result.' }, who: { ar: 'البنك', en: 'Bank' } },
  { title: { ar: 'تسجيل نتيجة التعاقد', en: 'Record the contract outcome' }, desc: { ar: 'النتيجة وتفاصيل التعاقد أو سبب عدم التعاقد.', en: 'The result and contract details, or the reason for no contract.' }, who: { ar: 'المصنع', en: 'Factory' } },
];

/** الجهات المشاركة — من الوثيقة، وجهات التشغيل من خريطة الإجراءات. */
export const PARTICIPANTS: Bi[] = [
  { ar: 'وزارة الصناعة', en: 'Ministry of Industry' },
  { ar: 'وزارة المالية', en: 'Ministry of Finance' },
  { ar: 'وزارة الكهرباء والطاقة المتجددة', en: 'Ministry of Electricity and Renewable Energy' },
  { ar: 'القطاع المصرفي', en: 'The banking sector' },
  { ar: 'مقدمو الخدمات', en: 'Service providers' },
];

export const OPERATING_BODIES: Array<{ name: Bi; role: Bi; logo?: string }> = [
  // TODO(محتوى): الاسم الكامل «مركز تحديث الصناعة» غير وارد في مصادر المبادرة (docx/PDF تذكر IMC فقط) — M9، يحتاج اعتمادًا.
  { name: { ar: 'مركز تحديث الصناعة (IMC)', en: 'Industrial Modernization Center (IMC)' }, role: { ar: 'مراجعة الطلب والمستندات', en: 'Application and document review' }, logo: '/imc-logo.png' },
  // TODO(محتوى): الاسم الكامل لـ ENCPC غير وارد في مصادر المبادرة — يُعرض الاختصار حتى يُعتمد.
  { name: { ar: 'ENCPC', en: 'ENCPC' }, role: { ar: 'المراجعة الفنية', en: 'Technical review' } },
  { name: { ar: 'وحدة إدارة المبادرة (PMU)', en: 'Initiative Management Unit (PMU)' }, role: { ar: 'الصناعة · الكهرباء · المالية — مراجعة العرض الفني والمتابعة', en: 'Industry · Electricity · Finance — technical offer review and monitoring' } },
  { name: { ar: 'البنوك المشاركة', en: 'Participating banks' }, role: { ar: 'الدراسة والتعاقد', en: 'Study and contracting' } },
];

/** المستندات المطلوبة عند التقديم على الموقع (فورم التسجيل) ثم في المراحل اللاحقة. */
export const REQUIRED_DOCUMENTS: Array<{ title: Bi; when: Bi }> = [
  { title: { ar: 'السجل التجاري (رقم + ملف)', en: 'Commercial register (number + file)' }, when: { ar: 'عند التقديم', en: 'At application' } },
  { title: { ar: 'السجل الصناعي (رقم + ملف)', en: 'Industrial register (number + file)' }, when: { ar: 'عند التقديم', en: 'At application' } },
  { title: { ar: 'البطاقة الضريبية (رقم + ملف)', en: 'Tax card (number + file)' }, when: { ar: 'عند التقديم', en: 'At application' } },
  { title: { ar: 'فواتير الكهرباء لآخر 12 شهرًا', en: 'Electricity bills for the last 12 months' }, when: { ar: 'عند التقديم', en: 'At application' } },
  { title: { ar: 'إثبات حق الملكية أو الاستخدام', en: 'Proof of ownership or right of use' }, when: { ar: 'عند التقديم', en: 'At application' } },
  { title: { ar: 'العرض الفني من مقدم الخدمة', en: 'Technical offer from the service provider' }, when: { ar: 'بعد القبول الفني', en: 'After technical acceptance' } },
  { title: { ar: 'موافقة شركة الكهرباء', en: 'Electricity company approval' }, when: { ar: 'بعد قبول العرض الفني', en: 'After the offer is accepted' } },
];

export const FILE_RULES: Bi = { ar: 'كل الملفات بصيغة PDF فقط.', en: 'All files must be PDF.' };

/** قائمة TODO المحتوى — تُدرج في تقرير التسليم. */
export const CONTENT_TODOS: string[] = [
  'الاسم الكامل لـ ENCPC (عربي/إنجليزي).',
  'الاسم الكامل لـ IMC «مركز تحديث الصناعة» — مستخدم في الموقع والبريد ولم يرد في مصدر معتمد (M9).',
  'الجهة التي تراجع موافقة الكهرباء (★ مقترح PMU) — حُذفت من النص العام حتى الاعتماد (B3).',
  'ترجمة شعار المبادرة الإنجليزية الرسمية.',
  'قائمة المناطق الصناعية الرسمية لكل محافظة (backend/src/config/locations.ts).',
  'أنواع إثبات الملكية/الاستخدام المعتمدة (backend/src/config/shamsPolicy.ts → ownershipTypes).',
  'قائمة شركات توزيع الكهرباء (حاليًا حقل نصي حر).',
  'أسماء البنوك المشاركة (يضيفها الأدمن — لا بنوك في الإنتاج افتراضيًا).',
];
