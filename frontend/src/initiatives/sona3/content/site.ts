// محتوى منصة «صُنّاع المستقبل» — من المقترح التنفيذي (مركز تحديث الصناعة IMC).
export interface Bi { ar: string; en: string }

export const SITE_NAME: Bi = { ar: 'صُنّاع المستقبل', en: 'Future Makers' };
export const SITE_TAGLINE: Bi = {
  ar: 'منصة رقمية لتمكين الشباب من تأسيس المشروعات الصناعية والإنتاجية، وتحويل الأفكار إلى فرص استثمارية قابلة للتنفيذ والتمويل.',
  en: 'A digital platform that empowers young people to found industrial and productive projects and turns ideas into fundable investment opportunities.',
};
// المصدر: مبادرة صُنّاع المستقبل.pdf — «ثانيًا: الرؤية والرسالة والأهداف».
export const VISION: Bi = {
  ar: 'بناء جيل جديد من رواد الأعمال الصناعيين القادرين على إنشاء مشروعات إنتاجية مبتكرة ومستدامة، تسهم في تعزيز تنافسية الصناعة المصرية.',
  en: 'Building a new generation of industrial entrepreneurs able to create innovative, sustainable productive projects that help strengthen the competitiveness of Egyptian industry.',
};
export const MISSION: Bi = {
  ar: 'توفير مسار رقمي متكامل يربط الشباب بالخبرة الفنية ودراسات الجدوى والتمويل ومقدمي الخدمات، ويحوّل الأفكار الواعدة إلى مشروعات حقيقية.',
  en: 'Providing an integrated digital pathway that connects young people with technical expertise, feasibility studies, funding and service providers, and turns promising ideas into real projects.',
};
export const HERO_EYEBROW: Bi = { ar: 'مركز تحديث الصناعة — الدورة الأولى', en: 'Industrial Modernization Center — Cohort 1' };

export const MINISTRY: Bi = { ar: 'مركز تحديث الصناعة (IMC)', en: 'Industrial Modernization Center (IMC)' };

export const FIGURES: Array<{ value: string; label: Bi }> = [
  { value: '60', label: { ar: 'مشروعًا للتقييم في المرحلة الأولى', en: 'projects evaluated in phase one' } },
  { value: '15', label: { ar: 'مشروعًا مؤهلًا للتنفيذ', en: 'projects selected for implementation' } },
  { value: '35', label: { ar: 'عامًا الحد الأقصى لسن المتقدم', en: 'maximum applicant age' } },
];

export const JOURNEY: Array<{ title: Bi; desc: Bi }> = [
  { title: { ar: 'التسجيل والتقديم الإلكتروني', en: 'Registration & application' }, desc: { ar: 'إنشاء حساب وبيانات المتقدم والفريق ووصف الفكرة.', en: 'Create an account, applicant and team data, idea description.' } },
  { title: { ar: 'فحص الأهلية والفرز الأولي', en: 'Eligibility screening' }, desc: { ar: 'مراجعة السن والشروط واكتمال المستندات وجدية الفكرة.', en: 'Age, conditions, completeness and seriousness.' } },
  { title: { ar: 'دراسة الجدوى', en: 'Feasibility study' }, desc: { ar: 'السوق والفني والمالي والمخاطر والأثر بنموذج موحد وبدعم الخبراء.', en: 'Market, technical, financial, risk and impact on a unified template.' } },
  { title: { ar: 'المراجعة والتقييم', en: 'Review & evaluation' }, desc: { ar: 'لجنة تقييم بمعايير معلنة وإقرار عدم تضارب المصالح.', en: 'Committee scoring on published criteria.' } },
  { title: { ar: 'اختيار أفضل المشروعات', en: 'Selection' }, desc: { ar: 'اختيار أعلى المشروعات تقييمًا. الاختيار لا يعني ضمان التمويل.', en: 'Top-scoring projects. Selection does not guarantee funding.' } },
  { title: { ar: 'الاعتماد والتمويل', en: 'Approval & funding' }, desc: { ar: 'العرض على الجهات واعتماد الوزير وربط الجهات التمويلية.', en: 'Presentation, ministerial approval and funders.' } },
  { title: { ar: 'التأسيس والتنفيذ', en: 'Implementation' }, desc: { ar: 'صرف التمويل على مراحل مرتبطة بالإنجاز.', en: 'Funds released per verified milestone.' } },
  { title: { ar: 'المتابعة وقياس الأثر', en: 'Monitoring & impact' }, desc: { ar: 'تقارير الإيرادات والإنتاج وفرص العمل.', en: 'Revenue, production and jobs reports.' } },
];

export const ELIGIBILITY: Bi[] = [
  { ar: 'ألا يزيد عمر المتقدم عن 35 عامًا عند إغلاق باب التقديم.', en: 'Applicant is at most 35 at the closing date.' },
  { ar: 'أن يكون المتقدم مصري الجنسية.', en: 'Egyptian nationality.' },
  { ar: 'فكرة مشروع واضحة وجديدة أو مشروع في مرحلة التأسيس.', en: 'A clear new idea or a project being established.' },
  { ar: 'تحديد المنتج أو الخدمة والمشكلة التي يعالجها والعملاء المستهدفين.', en: 'Define the product, the problem and the customers.' },
  { ar: 'تصور أولي للتكاليف الاستثمارية والاحتياجات التمويلية.', en: 'An initial view of costs and funding needs.' },
  { ar: 'الالتزام باستكمال الدراسات وفق النماذج المعتمدة.', en: 'Commit to complete the studies on the approved templates.' },
  { ar: 'الإفصاح عن الشركاء ومصادر التمويل وأي تضارب مصالح.', en: 'Disclose partners, funding sources and conflicts of interest.' },
  { ar: 'تقديم مستندات صحيحة والموافقة على التحقق منها.', en: 'Provide valid documents and accept verification.' },
  { ar: 'الالتزام بالقوانين والاشتراطات البيئية والصناعية والتراخيص.', en: 'Comply with laws, environmental and licensing requirements.' },
  { ar: 'طلب مفتوح واحد لكل متقدم.', en: 'One open application per applicant.' },
];

export const CRITERIA_TEXT: Bi[] = [
  { ar: 'الجدوى المالية والاستدامة', en: 'Financial feasibility & sustainability' },
  { ar: 'الجدوى الفنية وقابلية التنفيذ', en: 'Technical feasibility' },
  { ar: 'احتياجات السوق وفرص النمو', en: 'Market need & growth' },
  { ar: 'الابتكار والقيمة المضافة', en: 'Innovation & added value' },
  { ar: 'فرص العمل والأثر الاقتصادي', en: 'Jobs & economic impact' },
  { ar: 'جاهزية فريق العمل', en: 'Team readiness' },
];

export const FINANCING_TERMS: Bi[] = [
  { ar: 'تمويل ميسر يُسدد وفق جدول معتمد', en: 'Soft loan' },
  { ar: 'مشاركة استثمارية (حقوق ملكية)', en: 'Equity participation' },
  { ar: 'دعم تأسيسي', en: 'Establishment grant' },
  { ar: 'تمويل مختلط', en: 'Blended finance' },
];
