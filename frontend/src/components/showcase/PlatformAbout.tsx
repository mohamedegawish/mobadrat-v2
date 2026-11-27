import React from 'react';
import { usePlatformStore } from '../../store/state';
import {
  Landmark,
  Building2,
  Briefcase,
  Handshake,
  Lightbulb,
  Rocket,
  TrendingUp,
  Database,
} from 'lucide-react';
import { HomeBanners } from './HomeBanners';

/**
 * PlatformAbout — تعريف المنصة في الصفحة الرئيسية:
 * عن المنصة (الرؤية + شركاء المنظومة + من الفكرة إلى الأثر) · الأهداف الرئيسية.
 * كل النصوص Ar/En عبر language. التنسيق في globals.css (home-*).
 */
export const PlatformAbout: React.FC = () => {
  const { language } = usePlatformStore();
  const isAr = language === 'ar';

  const stakeholders = [
    { icon: <Landmark size={16} />, ar: 'الجهات الحكومية', en: 'Government bodies' },
    { icon: <Building2 size={16} />, ar: 'القطاع الخاص', en: 'Private sector' },
    { icon: <Briefcase size={16} />, ar: 'المستثمرون', en: 'Investors' },
    { icon: <Handshake size={16} />, ar: 'الجهات التمويلية والتنموية', en: 'Financing & development bodies' },
  ];

  const journey = [
    { icon: <Lightbulb size={18} />, ar: 'أفكار ومقترحات', en: 'Ideas & proposals' },
    { icon: <Rocket size={18} />, ar: 'مشروعات قابلة للتنفيذ', en: 'Executable projects' },
    { icon: <TrendingUp size={18} />, ar: 'أثر اقتصادي قابل للقياس', en: 'Measurable economic impact' },
  ];

  const sectors = [
    { ar: 'الصناعات الكيماوية والبترو كيماوية', en: 'Chemical & Petrochemical' },
    { ar: 'الصناعات الهندسية والمعدنية', en: 'Engineering & Metal' },
    { ar: 'المنسوجات والملابس', en: 'Textiles & Garments' },
    { ar: 'الصناعات الغذائية', en: 'Food Industries' },
    { ar: 'مواد البناء والسيراميك', en: 'Building Materials & Ceramics' },
    { ar: 'الورق والتغليف', en: 'Paper & Packaging' },
    { ar: 'الأخشاب والأثاث', en: 'Wood & Furniture' },
    { ar: 'الأدوية والمستحضرات الطبية', en: 'Pharmaceuticals & Medical' },
  ];

  const sectionTitle: React.CSSProperties = {
    fontFamily: isAr ? 'var(--font-display-ar)' : 'var(--font-display-en)',
    fontSize: '1.25rem',
    fontWeight: 800,
    color: 'var(--text-main)',
    margin: 0,
  };

  return (
    <>
      {/* عن المنصة */}
      <section aria-label={isAr ? 'عن المنصة' : 'About the platform'} className="home-section">
        <div className="section-anchor">
          <h2 style={sectionTitle}>{isAr ? 'عن المنصة' : 'About the platform'}</h2>
        </div>
        <div className="card home-about">
          <div>
            <p className="home-about-lead">
              {isAr
                ? 'في إطار حرص وزارة الصناعة على دعم الصناعة المصرية، وتماشياً مع المستهدفات الرئيسية للاستراتيجية الوطنية للصناعة، أطلقت الوزارة منصة وطنية موحدة تهدف إلى حصر وتنسيق وإدارة ومتابعة المبادرات والبرامج ذات الصلة بالتنمية الصناعية.'
                : "As part of the Ministry of Industry's commitment to Egyptian industry, and in line with the key targets of the National Industrial Strategy, the Ministry has launched a unified national platform to catalogue, coordinate, manage and monitor industrial-development initiatives and programs."}
            </p>
            <div className="home-journey" aria-label={isAr ? 'من الفكرة إلى الأثر' : 'From idea to impact'}>
              {journey.map(j => (
                <div key={j.en} className="home-journey-step">
                  <span className="home-journey-dot" aria-hidden>{j.icon}</span>
                  <span>{isAr ? j.ar : j.en}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="home-about-panel">
            <p className="home-about-label">{isAr ? 'تربط المنصة بين' : 'The platform connects'}</p>
            <div className="home-stakeholders">
              {stakeholders.map(s => (
                <span key={s.en} className="home-stakeholder">
                  {s.icon}
                  {isAr ? s.ar : s.en}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* البانر الإعلاني */}
      <HomeBanners placement="before_steps" />

      {/* القطاعات المستهدفة */}
      <section aria-label={isAr ? 'القطاعات المستهدفة' : 'Target sectors'} className="home-section">
        <div className="section-anchor">
          <h2 style={sectionTitle}>{isAr ? 'القطاعات المستهدفة' : 'Target sectors'}</h2>
        </div>
        <div className="home-grid home-grid-4">
          {sectors.map(s => (
            <div key={s.en} className="home-card sector-card">
              <span className="home-card-icon sector-card-icon"><Database size={16} /></span>
              <h3 className="home-card-title">{isAr ? s.ar : s.en}</h3>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};
