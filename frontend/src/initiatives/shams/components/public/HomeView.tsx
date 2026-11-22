import React from 'react';
import { ArrowLeft, ArrowRight, Building2, FileText, Landmark, ShieldCheck, Sun, Target } from 'lucide-react';
import { store, useStore } from '../../store/state';
import {
  ELIGIBILITY, FILE_RULES, FINANCING_TERMS, GENERAL_GOAL, JOURNEY, OBJECTIVES, OFFICIAL_FIGURES, OPERATING_BODIES, PARTICIPANTS,
  REQUIRED_DOCUMENTS, SELECTION_CRITERIA, SITE_NAME, SITE_TAGLINE,
} from '../../content/shams';

const Section: React.FC<{ id: string; title: string; sub?: string; icon: React.ReactNode; children: React.ReactNode }> = ({ id, title, sub, icon, children }) => (
  <section className="home-section" id={id} style={{ scrollMarginTop: 90 }} aria-labelledby={`${id}-title`}>
    <div className="section-anchor row">
      <span className="home-card-icon">{icon}</span>
      <div>
        <h2 id={`${id}-title`} style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>{title}</h2>
        {sub ? <p className="home-section-sub" style={{ margin: '0.2rem 0 0' }}>{sub}</p> : null}
      </div>
    </div>
    {children}
  </section>
);

export const HomeView: React.FC = () => {
  const { isAr, t, user } = useStore();
  const L = (b: { ar: string; en: string }) => (isAr ? b.ar : b.en);
  const Arrow = isAr ? ArrowLeft : ArrowRight;
  // زائر → تسجيل مصنع؛ مصنع → لوحته؛ مراجع/أدمن → مساحة عمله (لا زر بلا أثر).
  const apply = () => (user ? store.goHome() : store.navigate('register'));
  const ctaLabel = !user ? t('سجّل مصنعك وقدّم الآن', 'Register your factory & apply')
    : user.role === 'factory_owner' ? t('لوحة المصنع', 'Factory dashboard') : t('الانتقال إلى مساحة العمل', 'Go to your workspace');

  return (
    <div className="container-custom home-page reveal-stagger page">
      <section className="hero-shell card" style={{ padding: 0, overflow: 'hidden', marginBottom: '2rem' }}>
        <div className="hero-slider-grid" style={{ display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 0 }}>
          <div style={{ padding: 'clamp(1.25rem, 4vw, 2.5rem)' }}>
            <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontWeight: 900, margin: '0 0 0.5rem', lineHeight: 1.3, textWrap: 'balance' }}>
              {isAr ? `مبادرة «${SITE_NAME.ar}»` : `${SITE_NAME.en} Initiative`}
            </h1>
            <p style={{ fontSize: '1.02rem', color: 'var(--text-secondary)', lineHeight: 1.9, margin: '0 0 1.2rem' }}>{L(SITE_TAGLINE)}</p>
            <div className="row">
              <button type="button" className="btn btn-primary btn-lg" onClick={apply} data-testid="hero-apply">
                {ctaLabel} <span className="btn-arrow"><Arrow size={16} /></span>
              </button>
              {!user ? <button type="button" className="btn btn-outline btn-lg" onClick={() => store.navigate('login')}>{t('تسجيل الدخول', 'Sign in')}</button> : null}
            </div>
            <div className="home-figures">
              {OFFICIAL_FIGURES.map((f) => (
                <div key={f.label.en} className="metric-bento card home-figure">
                  <div className="home-figure-value">{L(f.value)}</div>
                  <div className="home-figure-label">{L(f.label)}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ minHeight: 280 }}>
            <img className="hero-image" src="/covers/solar-2026.jpg" alt={t('ألواح طاقة شمسية على سطح مصنع', 'Solar panels on a factory roof')} style={{ borderRadius: 0 }} />
          </div>
        </div>
      </section>

      <Section id="about" title={t('عن المبادرة', 'About the initiative')} icon={<Target size={20} />}>
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="home-about-label" style={{ fontWeight: 800, marginBottom: '0.4rem' }}>{t('الهدف العام', 'General goal')}</div>
          <p className="home-about-lead" style={{ margin: 0, lineHeight: 1.9 }}>{L(GENERAL_GOAL)}</p>
        </div>
        <div className="grid-2">
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('المستهدفات الرئيسية', 'Main targets')}</h3>
            <ul className="home-list">{OBJECTIVES.map((o) => <li key={o.en}>{L(o)}</li>)}</ul>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('المحددات المالية والتمويلية', 'Financial terms')}</h3>
            <ul className="home-list">{FINANCING_TERMS.map((o) => <li key={o.en}>{L(o)}</li>)}</ul>
          </div>
        </div>
      </Section>

      <Section id="how" title={t('كيف تعمل المبادرة', 'How it works')} sub={t('رحلة طلب المصنع من التسجيل حتى التعاقد مع البنك', 'The factory’s journey from registration to contracting with a bank')} icon={<Sun size={20} />}>
        <div className="home-steps">
          {JOURNEY.map((s, i) => (
            <div key={s.title.en} className="card home-step">
              <span className="home-step-num">{(i + 1).toLocaleString(isAr ? 'ar-EG' : 'en-US')}</span>
              <div>
                <div style={{ fontWeight: 800 }}>{L(s.title)}</div>
                <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{L(s.desc)}</div>
                <span className="badge badge-info" style={{ marginTop: '0.35rem' }}>{L(s.who)}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="docs" title={t('المستندات المطلوبة', 'Required documents')} sub={L(FILE_RULES)} icon={<FileText size={20} />}>
        <div className="grid-2">
          <div className="card">
            <ul className="home-list">
              {REQUIRED_DOCUMENTS.map((d) => <li key={d.title.en}><b>{L(d.title)}</b> — <span style={{ color: 'var(--text-muted)' }}>{L(d.when)}</span></li>)}
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>{t('اشتراطات تأهيل المنشأة والمشروع', 'Facility and project eligibility')}</h3>
            <ul className="home-list">{ELIGIBILITY.map((e) => <li key={e.en}>{L(e)}</li>)}</ul>
          </div>
        </div>
      </Section>

      <Section id="criteria" title={t('معايير اختيار المصانع', 'Factory selection criteria')} icon={<ShieldCheck size={20} />}>
        <div className="card"><ul className="home-list">{SELECTION_CRITERIA.map((e) => <li key={e.en}>{L(e)}</li>)}</ul></div>
      </Section>

      <Section id="partners" title={t('الجهات المشاركة', 'Participating entities')} icon={<Landmark size={20} />}>
        <div className="home-stakeholders row" style={{ marginBottom: '1rem' }}>
          {PARTICIPANTS.map((p) => <span key={p.en} className="badge badge-teal" style={{ fontSize: '0.84rem' }}>{L(p)}</span>)}
        </div>
        <div className="home-grid home-grid-4">
          {OPERATING_BODIES.map((b) => (
            <div key={b.name.en} className="home-card">
              {b.logo
                ? <img src={b.logo} alt={t(`شعار ${b.name.ar}`, `${b.name.en} logo`)} className="home-card-logo" width={58} height={52} />
                : <span className="home-card-icon"><Building2 size={18} /></span>}
              <div className="home-card-title" style={{ fontWeight: 800 }}>{L(b.name)}</div>
              <div className="home-card-desc" style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{L(b.role)}</div>
            </div>
          ))}
        </div>
      </Section>

      <section className="hero-shell card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
        <h2 style={{ marginTop: 0 }}>{t('جاهز لتحويل مصنعك إلى الطاقة الشمسية؟', 'Ready to move your factory to solar?')}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{t('سجّل المصنع، أكمل البيانات والمستندات، وتابع طلبك خطوة بخطوة.', 'Register, complete your data and documents, and follow your application step by step.')}</p>
        {!user || user.role === 'factory_owner'
          ? <button type="button" className="btn btn-primary btn-lg" onClick={apply} data-testid="cta-bottom">{user ? t('لوحة المصنع', 'Factory dashboard') : t('ابدأ التقديم', 'Start your application')}</button>
          : null}
      </section>
    </div>
  );
};
