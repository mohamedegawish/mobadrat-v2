/**
 * The public page of Shams El-Senaa (شمس الصناعة) as the platform published it before the modules (the initiative's
 * official document: objectives, financing terms, the 13 eligibility requirements, the 10 selection criteria, benefits,
 * FAQ, the instant eligibility check and the page design). The module's catalog row starts from it, and keeps following
 * it until an administrator edits the page (core/catalog/initiatives.ts: syncUneditedCatalogRow).
 */
export const SHAMS_PUBLIC_CONTENT: Record<string, unknown> = {
  taglineAr: 'دعم التحول للطاقة الشمسية للاستهلاك الذاتي صناعياً',
  taglineEn: 'Powering industry with self-consumption solar',
  descriptionAr: 'تهدف مبادرة شمس الصناعة إلى التوسع في استخدام الطاقة الجديدة والمتجددة وخفض تكلفة الطاقة على القطاع الصناعي وتنويع مصادر الطاقة للقطاع الصناعي وتعزيز تنافسية الصناعة المصرية وتوطين صناعات الطاقة الشمسية. تستهدف المبادرة إضافة قدرات تصل إلى نحو 1000 ميجاوات من الطاقة الشمسية للاستهلاك الذاتي لخدمة نحو 7000 مصنع وفق الجاهزية الفنية والتمويلية، بتمويل يصل إلى 12.5 مليار جنيه في صورة قروض من الجهاز المصرفي.',
  descriptionEn: 'Shams El-Senaa expands renewable energy use, cuts industrial energy costs, diversifies energy sources, boosts Egyptian industry competitiveness, and localizes solar manufacturing. It targets about 1,000 MW of self-consumption solar capacity serving about 7,000 factories, funded by up to EGP 12.5B in bank loans.',
  category: 'الطاقة النظيفة والاستدامة',
  categoryEn: 'Clean Energy & Sustainability',
  targetSectors: [
    'الصناعات الهندسية',
    'الغزل والنسيج',
    'الصناعات الكيماوية',
    'الصناعات الغذائية'
  ],
  targetSectorsEn: [
    'Engineering',
    'Textiles',
    'Chemicals',
    'Food & Agro'
  ],
  targetGovernorates: [
    'كافة المحافظات',
    'السادس من أكتوبر',
    'العاشر من رمضان'
  ],
  budgetTotalEGP: 12500000000,
  startDate: '2026-01-01',
  endDate: '2030-12-31',
  badgeTextAr: 'تمويل 5% ميسر مع فترة سماح سنة',
  badgeTextEn: '5% Soft Loan with 1-Year Grace',
  participatingOrgs: [
    'وزارة الصناعة',
    'هيئة التنمية الصناعية (IDA)',
    'مركز تحديث الصناعة (IMC)',
    'البنك الأهلي المصري'
  ],
  benefits: [
    {
      titleAr: 'تمويل بفائدة ميسرة 5% متناقصة',
      titleEn: '5% Decreasing Rate',
      descriptionAr: 'قروض مدعومة حتى 7 سنوات مع سنة سماح.',
      descriptionEn: 'Supported loans up to 7 years with grace.',
      iconName: 'Percent'
    },
    {
      titleAr: 'دراسة جدوى مجانية 100%',
      titleEn: '100% Free Feasibility Study',
      descriptionAr: 'دراسات هندسية مجانية من IMC.',
      descriptionEn: 'Free engineering studies by IMC.',
      iconName: 'FileCheck'
    }
  ],
  faqs: [
    {
      questionAr: 'ما المساحة الدنيا للسطح؟',
      questionEn: 'Minimum roof area?',
      answerAr: '1000 متر مربع أو 100 كيلووات.',
      answerEn: '1,000 sqm or 100 kWp.'
    }
  ],
  preEligibilityQuestions: [
    {
      id: 'q1',
      questionAr: 'هل يمتلك المصنع سجلاً صناعياً سارياً؟',
      questionEn: 'Valid industrial license?',
      type: 'boolean',
      expectedValue: true,
      explanationAr: 'للمصانع المسجلة فقط.',
      explanationEn: 'Registered factories only.'
    },
    {
      id: 'q3',
      questionAr: 'ما متوسط الفاتورة الشهرية؟',
      questionEn: 'Average monthly bill?',
      type: 'select',
      options: [
        {
          labelAr: 'أقل من 50 ألف',
          labelEn: 'Less than 50K',
          isEligible: false,
          value: 'low'
        },
        {
          labelAr: 'أكثر من 200 ألف',
          labelEn: 'More than 200K',
          isEligible: true,
          value: 'high'
        }
      ],
      explanationAr: 'أولوية كثيفة الاستهلاك.',
      explanationEn: 'Priority to heavy consumers.'
    }
  ],
  requiredDocsList: [
    {
      code: 'CR_COPY',
      titleAr: 'صورة السجل التجاري الحديث',
      titleEn: 'Recent Commercial Register',
      mandatory: true
    },
    {
      code: 'IND_LIC',
      titleAr: 'رخصة التشغيل والسجل الصناعي',
      titleEn: 'Industrial License',
      mandatory: true
    },
    {
      code: 'ELEC_BILLS',
      titleAr: 'آخر 3 فواتير كهرباء',
      titleEn: 'Last 3 Electricity Bills',
      mandatory: true
    }
  ],
  impactMetrics: {
    targetFactories: 7000,
    targetCapacityMW: 1000,
    benefitedFactories: 340,
    savedEnergyGWh: 185.4,
    investmentStimulatedEGP: 2150000000,
    jobsCreated: 1450
  },
  objectives: [
    {
      textAr: 'إضافة قدرات تصل إلى نحو 1000 ميجاوات من الطاقة الشمسية لخدمة نحو 7000 مصنع وفق الجاهزية الفنية والتمويلية.',
      textEn: 'Add up to about 1,000 MW of solar capacity serving about 7,000 factories, according to technical and financing readiness.'
    },
    {
      textAr: 'خفض تكلفة الكهرباء وتقليل الكهرباء المسحوبة من الشبكة خلال ساعات النهار.',
      textEn: 'Cut electricity costs and reduce power drawn from the grid during daylight hours.'
    },
    {
      textAr: 'تقليل الطلب على الكهرباء المنتجة باستخدام الوقود الأحفوري وخفض البصمة الكربونية.',
      textEn: 'Reduce demand for fossil-fuel-generated electricity and cut the carbon footprint.'
    },
    {
      textAr: 'رفع تنافسية المنتجات المصرية، خاصة المنتجات الموجهة للتصدير.',
      textEn: 'Raise the competitiveness of Egyptian products, especially export-oriented ones.'
    },
    {
      textAr: 'دعم توطين صناعة الألواح الشمسية والمعدات والمكونات المرتبطة بالطاقة الشمسية.',
      textEn: 'Support localizing the manufacture of solar panels and related equipment and components.'
    },
    {
      textAr: 'خلق طلب مستدام على المنتج المحلي المطابق للمواصفات الدولية.',
      textEn: 'Create sustained demand for local products that meet international specifications.'
    },
    {
      textAr: 'دعم نقل التكنولوجيا والاستثمار في صناعات الطاقة المتجددة.',
      textEn: 'Support technology transfer and investment in renewable energy industries.'
    }
  ],
  eligibilityRequirements: [
    {
      textAr: 'سجل تجاري وسجل صناعي ورخصة تشغيل سارية.',
      textEn: 'Valid commercial register, industrial register, and operating license.'
    },
    {
      textAr: 'فواتير الكهرباء لآخر 12 شهرًا.',
      textEn: 'Electricity bills for the last 12 months.'
    },
    {
      textAr: 'القدرة التعاقدية وأقصى حمل.',
      textEn: 'Contracted capacity and peak load.'
    },
    {
      textAr: 'بيانات الاستهلاك وملف الأحمال متى كان متاحًا.',
      textEn: 'Consumption data and load profile, where available.'
    },
    {
      textAr: 'ساعات وأيام التشغيل.',
      textEn: 'Operating hours and days.'
    },
    {
      textAr: 'بيان المساحات المتاحة.',
      textEn: 'Statement of available areas.'
    },
    {
      textAr: 'إثبات حق الملكية أو الاستخدام طوال مدة التمويل والتشغيل.',
      textEn: 'Proof of ownership or right of use for the full financing and operation period.'
    },
    {
      textAr: 'تقرير إنشائي معتمد بصلاحية الأسطح والمنشآت لتحمل الألواح والهياكل وأحمال الرياح.',
      textEn: 'Certified structural report confirming roofs and structures can bear the panels, mounting structures, and wind loads.'
    },
    {
      textAr: 'بيانات المحولات ولوحات التوزيع ونقاط الربط ومتطلبات الحماية والقياس.',
      textEn: 'Data on transformers, distribution panels, connection points, and protection and metering requirements.'
    },
    {
      textAr: 'دراسة فنية واقتصادية توضح قدرة المحطة والإنتاج السنوي ونسبة الاستهلاك الذاتي والتكلفة والوفر وفترة الاسترداد.',
      textEn: 'Technical and economic study showing plant capacity, annual output, self-consumption share, cost, savings, and payback period.'
    },
    {
      textAr: 'استخدام معدات مطابقة للمواصفات.',
      textEn: 'Use of equipment that complies with specifications.'
    },
    {
      textAr: 'التنفيذ من خلال شركات متخصصة ومؤهلة وفق القواعد المعتمدة.',
      textEn: 'Implementation through specialized, qualified companies under the approved rules.'
    },
    {
      textAr: 'اجتياز التقييم الائتماني لدى البنك الممول.',
      textEn: 'Passing the credit assessment at the financing bank.'
    }
  ],
  selectionCriteria: [
    {
      textAr: 'الجاهزية الفنية والإنشائية.',
      textEn: 'Technical and structural readiness.'
    },
    {
      textAr: 'توافر التراخيص والسجلات السارية.',
      textEn: 'Valid licenses and registers in place.'
    },
    {
      textAr: 'انتظام الوضع الائتماني والمصرفي.',
      textEn: 'A sound credit and banking standing.'
    },
    {
      textAr: 'ارتفاع أحمال التشغيل النهارية بما يحقق أكبر نسبة من الاستهلاك الذاتي.',
      textEn: 'High daytime operating loads that maximize self-consumption.'
    },
    {
      textAr: 'توافر المساحات المناسبة.',
      textEn: 'Availability of suitable space.'
    },
    {
      textAr: 'تناسب قدرة المحطة مع الاستهلاك الفعلي.',
      textEn: 'Plant capacity matched to actual consumption.'
    },
    {
      textAr: 'المصانع المصدرة أو المستهدفة للتصدير.',
      textEn: 'Exporting factories or factories targeting export.'
    },
    {
      textAr: 'المصانع التي يحقق خفض البصمة الكربونية بها أثرًا على القدرة التنافسية والتصديرية.',
      textEn: 'Factories where cutting the carbon footprint improves competitiveness and exports.'
    },
    {
      textAr: 'الالتزام بمعايير المكون المحلي.',
      textEn: 'Commitment to local-component standards.'
    },
    {
      textAr: 'مراعاة التوزيع القطاعي والجغرافي للمشروعات.',
      textEn: 'Balanced sectoral and geographic distribution of projects.'
    }
  ],
  financialTerms: {
    financingType: 'bank_loans',
    currency: 'EGP',
    maxDurationYears: 5,
    maxFinancingPerClientEGP: 100000000,
    maxFinancingPerGroupEGP: 200000000,
    beneficiariesAr: 'منشآت القطاع الصناعي الخاص المستوفية للاشتراطات والمعايير المصرفية.',
    beneficiariesEn: 'Private-sector industrial facilities that meet the banking requirements and standards.',
    purposeAr: 'تمويل إنشاء وتركيب محطات طاقة شمسية للمصانع المستفيدة.',
    purposeEn: 'Financing the construction and installation of solar power plants for beneficiary factories.',
    notesAr: 'الحد الأقصى لقيمة المبادرة 12.5 مليار جنيه تُتاح في صورة قروض من الجهاز المصرفي، ويوجَّه التمويل بالعملة المحلية وفقًا للقواعد المصرفية المنظمة.',
    notesEn: 'The initiative is capped at EGP 12.5 billion, made available as loans from the banking sector and extended in local currency under the governing banking rules.'
  },
  executionNotesAr: 'المسار المقترح: التقديم ← استكمال المستندات ← التقييم الفني ← موافقة جهة الكهرباء المختصة ← التقييم الائتماني ← التعاقد ← التنفيذ ← الفحص والاختبارات ← الربط والتشغيل. وتتم المراجعة الفنية والائتمانية بالتوازي كلما أمكن، مع إنشاء لوحة متابعة مركزية إلكترونية تسمح بمتابعة تقدم المبادرة والمشروعات ومؤشرات الأداء بصورة منتظمة.',
  executionNotesEn: 'Proposed path: application → document completion → technical evaluation → approval by the competent electricity authority → credit assessment → contracting → implementation → inspection and testing → grid connection and commissioning. Technical and credit reviews run in parallel whenever possible, and a central electronic monitoring dashboard tracks the progress of the initiative, its projects, and its performance indicators on a regular basis.',
  customization: {
    showBenefits: true,
    showFaqs: true,
    showImpactMetrics: true,
    showTimeline: true,
    showPartners: true,
    enablePreEligibility: true,
    page: {
      layout: 'spotlight',
      heroTitleAr: 'شمس الصناعة: طاقة مصانعنا من أرضنا',
      heroTitleEn: 'Industry Sun: our factories powered by our land',
      heroSubtitleAr: 'قدرات شمسية تصل إلى 1000 ميجاوات لنحو 7000 مصنع بتمويل مصرفي يصل إلى 12.5 مليار جنيه',
      heroSubtitleEn: 'Up to 1,000 MW of solar for about 7,000 factories with bank financing of up to EGP 12.5B',
      ctaPrimaryLabelAr: 'قدّم الآن',
      ctaPrimaryLabelEn: 'Apply now',
      ctaSecondaryLabelAr: 'افحص الأهلية',
      ctaSecondaryLabelEn: 'Check eligibility',
      galleryImages: [
        '/covers/solar-2026.jpg'
      ],
      sections: [
        {
          id: 'sec-stats',
          kind: 'stats',
          titleAr: 'مؤشرات الأثر',
          titleEn: 'Impact metrics',
          visible: true
        },
        {
          id: 'sec-benefits',
          kind: 'benefits',
          titleAr: 'المزايا',
          titleEn: 'Benefits',
          visible: true
        },
        {
          id: 'sec-timeline',
          kind: 'timeline',
          titleAr: 'المراحل',
          titleEn: 'Timeline',
          visible: true
        },
        {
          id: 'sec-faqs',
          kind: 'faqs',
          titleAr: 'الأسئلة الشائعة',
          titleEn: 'FAQs',
          visible: true
        },
        {
          id: 'sec-partners',
          kind: 'partners',
          titleAr: 'الشركاء',
          titleEn: 'Partners',
          visible: true
        },
        {
          id: 'sec-apply',
          kind: 'apply',
          titleAr: 'التقديم',
          titleEn: 'Apply',
          visible: true
        }
      ]
    }
  }
};
