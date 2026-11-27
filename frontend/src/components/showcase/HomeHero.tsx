import React from 'react';
import { usePlatformStore } from '../../store/state';
import { Layers, LogIn, ArrowLeft, ArrowRight, Briefcase } from 'lucide-react';
import { AdsCarousel } from './AdsCarousel';

export interface HomeHeroProps {
  /** عدد المبادرات النشطة — من الصفحة الأم */
  activeCount?: number;
  /** إجمالي المصانع المستهدفة — من الصفحة الأم */
  targetFactories?: number;
}

/**
 * HomeHero — هيرو تحريري عريض للصفحة التعريفية (منفصل عن HeroSlider).
 * split: نص + سلايدر إعلانات (AdsCarousel) · شريط علم · توهج ناعم · دخول fadeUp · شارات الجهات.
 */
export const HomeHero: React.FC<HomeHeroProps> = ({
  activeCount = 0,
  targetFactories = 0,
}) => {
  const { language, isLoggedIn, navigate } = usePlatformStore();
  const isAr = language === 'ar';
  const fmt = (n: number) => n.toLocaleString(isAr ? 'ar-EG' : 'en-US');

  const stats = [
    {
      value: fmt(activeCount),
      labelAr: 'مبادرة نشطة',
      labelEn: 'Active initiatives',
    },
    {
      value: fmt(targetFactories),
      labelAr: 'مصنع مستهدف',
      labelEn: 'Target factories',
    },
  ];



  return (
    <section
      aria-label={isAr ? 'مقدمة المنصة' : 'Platform intro'}
      className="hero-shell"
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-2xl)',
        overflow: 'hidden',
        background: 'var(--bg-surface)',
        border: '1px solid rgba(226,232,240,0.95)',
        boxShadow: 'var(--shadow-lg)',
        marginBottom: '1.75rem',
      }}
    >
      {/* شريط علم مصر */}
      <div
        aria-hidden
        style={{ height: '4px', width: '100%', background: 'var(--egypt-flag-ribbon)' }}
      />
      {/* توهج خلفي ناعم */}
      <div className="hero-glow-orb" aria-hidden />

      <div
        className="hero-slider-grid reveal-stagger"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.02fr 0.98fr',
          minHeight: '380px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* النص التحريري */}
        <div className="hero-editorial-col">
          <h1 className="hero-editorial-title">
            {isAr
              ? 'مبادراتنا الصناعية'
              : 'Our Industrial Initiatives'}
          </h1>

          <p className="hero-editorial-desc">
            {isAr
              ? 'منصة موحدة تجمع مبادرات وزارة الصناعة دعما للصناعة المصرية'
              : 'A unified platform bringing together Ministry of Industry initiatives in support of Egyptian industry.'}
          </p>

          {/* الزرّان */}
          <div className="hero-btn-row">
            <button
              className="btn btn-primary btn-lg"
              onClick={() => navigate('initiatives')}
              style={{ boxShadow: '0 6px 18px rgba(200,16,46,0.16)' }}
            >
              <Layers size={16} />
              <span>{isAr ? 'عرض المبادرات' : 'Browse initiatives'}</span>
              <span className="btn-arrow">
                {isAr ? <ArrowLeft size={15} /> : <ArrowRight size={15} />}
              </span>
            </button>
            {isLoggedIn ? (
              <button
                className="btn btn-secondary"
                onClick={() => navigate('my-initiatives')}
                style={{ fontWeight: 700 }}
              >
                <Briefcase size={16} />
                <span>{isAr ? 'مبادراتي' : 'My initiatives'}</span>
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                onClick={() => navigate('login')}
                style={{ fontWeight: 700 }}
              >
                <LogIn size={16} />
                <span>{isAr ? 'سجل الدخول' : 'Sign in'}</span>
              </button>
            )}
          </div>

          {/* شريط الإحصاءات */}
          <div className="hero-stats-row">
            {stats.map(s => (
              <div
                key={isAr ? s.labelAr : s.labelEn}
                className="metric-bento"
              >
                <strong className="num-ltr">
                  {s.value}
                </strong>
                <span className="metric-label">
                  {isAr ? s.labelAr : s.labelEn}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* الصور — سلايدر إعلانات المبادرات */}
        <div
          style={{
            position: 'relative',
            padding: '1.15rem 1.15rem 1.15rem 0.75rem',
            display: 'flex',
            alignItems: 'stretch',
          }}
        >
          <AdsCarousel />
        </div>
      </div>
    </section>
  );
};
