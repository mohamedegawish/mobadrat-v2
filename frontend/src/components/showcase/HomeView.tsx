import React from 'react';
import { usePlatformStore } from '../../store/state';
import { Layers, LogIn, Briefcase } from 'lucide-react';
import { HomeHero } from './HomeHero';
import { PlatformAbout } from './PlatformAbout';
import { NewsTicker } from './NewsTicker';
import { HomeBanners } from './HomeBanners';
import { InitiativeCard, publicInitiatives } from './InitiativeCard';

/**
 * HomeView — الصفحة التعريفية: شريط أخبار المبادرات + هيرو تحريري + عن المنصة والقطاعات المستهدفة +
 * استكشف المبادرات الصناعية + دعوة ختامية. كل النصوص Ar/En عبر language.
 * بانرات الإعلانات (HomeBanners) في ثلاثة أماكن تختارها الإدارة: قبل «عن المنصة» / القطاعات المستهدفة / الدعوة الختامية.
 */
export const HomeView: React.FC = () => {
  const { language, initiatives, isLoggedIn, navigate } = usePlatformStore();
  const isAr = language === 'ar';

  const active = initiatives.filter(i => i.status === 'active' || i.status === 'coming_soon');
  const base = active.length > 0 ? active : initiatives;
  const activeCount = base.length;
  const targetFactories = base.reduce((s, i) => s + (i.impactMetrics?.targetFactories ?? 0), 0);

  const offered = publicInitiatives(initiatives);

  const sectionTitle: React.CSSProperties = {
    fontFamily: isAr ? 'var(--font-display-ar)' : 'var(--font-display-en)',
    fontSize: '1.25rem',
    fontWeight: 800,
    color: 'var(--text-main)',
    margin: 0,
  };

  return (
    <div className="container-custom home-page reveal-stagger">
      <NewsTicker />

      <HomeHero activeCount={activeCount} targetFactories={targetFactories} />

      <HomeBanners placement="before_about" />

      <PlatformAbout />

      {/* استكشف المبادرات الصناعية */}
      {offered.length > 0 && (
        <section aria-label={isAr ? 'استكشف المبادرات الصناعية' : 'Explore industrial initiatives'} className="home-section">
          <div className="section-anchor">
            <h2 style={sectionTitle}>{isAr ? 'استكشف المبادرات الصناعية' : 'Explore industrial initiatives'}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 380px), 1fr))', gap: '1.5rem' }}>
            {offered.map(initiative => (
              <InitiativeCard key={initiative.id} initiative={initiative} compact />
            ))}
          </div>
        </section>
      )}

      <HomeBanners placement="before_cta" />

      {/* دعوة ختامية */}
      <section
        aria-label={isAr ? 'ابدأ الآن' : 'Get started'}
        className="hero-shell"
        style={{
          position: 'relative',
          borderRadius: 'var(--radius-2xl)',
          overflow: 'hidden',
          background: 'var(--bg-surface)',
          border: '1px solid rgba(226,232,240,0.95)',
          boxShadow: 'var(--shadow-lg)',
          padding: '2rem 1.75rem',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.9rem',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(700px 320px at 50% -10%, rgba(200,16,46,0.06) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />
        <div
          aria-hidden
          style={{ height: '4px', width: '120px', borderRadius: '9999px', background: 'var(--egypt-flag-ribbon)' }}
        />
        <h2 style={{ ...sectionTitle, fontSize: 'clamp(1.15rem, 2vw, 1.5rem)', position: 'relative' }}>
          {isAr ? 'مصنعك يستحق الدعم — ابدأ رحلتك اليوم' : 'Your factory deserves support — start today'}
        </h2>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.8, color: 'var(--text-secondary)', margin: 0, maxWidth: '60ch', position: 'relative' }}>
          {isAr
            ? 'سجل الدخول وتابع مبادراتك، أو استكشف المبادرات المتاحة وقدّم في دقائق.'
            : 'Sign in to follow your initiatives, or explore what is available and apply in minutes.'}
        </p>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', position: 'relative' }}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('initiatives')}>
            <Layers size={16} />
            <span>{isAr ? 'عرض المبادرات' : 'Browse initiatives'}</span>
          </button>
          {isLoggedIn ? (
            <button className="btn btn-secondary" onClick={() => navigate('my-initiatives')} style={{ fontWeight: 700 }}>
              <Briefcase size={16} />
              <span>{isAr ? 'مبادراتي' : 'My initiatives'}</span>
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={() => navigate('login')} style={{ fontWeight: 700 }}>
              <LogIn size={16} />
              <span>{isAr ? 'سجل الدخول' : 'Sign in'}</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
};
