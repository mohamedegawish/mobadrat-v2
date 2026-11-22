import React from 'react';
import { Award, Check, ClipboardCheck, Eye, Target, Wallet } from 'lucide-react';
import { store, useStore } from '../../store/state';
import { useSiteContent, type Bi } from '../../content/siteContent';

const Head: React.FC<{ icon: React.ReactNode; title: string; count: number; tone?: 'blue' | 'green' | 'orange' }> = ({ icon, title, count, tone = 'blue' }) => (
  <header className="info-head">
    <span className={`info-icon ${tone}`} aria-hidden>{icon}</span>
    <h2>{title}</h2>
    <span className="info-count">{count}</span>
  </header>
);

export const HomeView: React.FC = () => {
  const { isAr, t, user } = useStore();
  const C = useSiteContent();
  const L = (b: Bi) => (isAr ? b.ar : b.en);
  const apply = () => store.navigate(user ? (user.role === 'applicant' ? 'applicant-dashboard' : 'work-queue') : 'register');
  return (
    <div className="container-custom home-page page">
      <section className="card hero">
        <div>
          <span className="eyebrow">{L(C.heroEyebrow)}</span>
          <h1>{isAr ? `مبادرة «${C.siteName.ar}»` : `${C.siteName.en} Initiative`}</h1>
          <p>{L(C.siteTagline)}</p>
          <div className="row-gap wrap">
            <button type="button" className="btn btn-primary" onClick={apply} data-testid="hero-apply">{user ? t('الدخول لمساحة عملي', 'Open my workspace') : t('سجّل وقدّم فكرتك', 'Register & apply')}</button>
            {!user ? <button type="button" className="btn btn-secondary" onClick={() => store.navigate('login')}>{t('تسجيل الدخول', 'Sign in')}</button> : null}
          </div>
          <div className="stats">{C.figures.map((f, i) => <div key={i}><b>{f.value}</b><span>{L(f.label)}</span></div>)}</div>
        </div>
      </section>

      <div className="vm-grid">
        <section className="card vm-card vision" aria-label={t('الرؤية', 'Vision')}>
          <span className="info-icon" aria-hidden><Eye size={20} /></span>
          <h2>{t('الرؤية', 'Vision')}</h2>
          <p>{L(C.vision)}</p>
        </section>
        <section className="card vm-card mission" aria-label={t('الرسالة', 'Mission')}>
          <span className="info-icon orange" aria-hidden><Target size={20} /></span>
          <h2>{t('الرسالة', 'Mission')}</h2>
          <p>{L(C.mission)}</p>
        </section>
      </div>

      <h2>{t('رحلة مشروعك: من الفكرة إلى التشغيل', 'Your project journey: from idea to operation')}</h2>
      <ol className="line">{C.journey.map((j, i) => <li key={i}><span className="stn-no">{String(i + 1).padStart(2, '0')}</span><strong>{L(j.title)}</strong><p>{L(j.desc)}</p></li>)}</ol>

      <div className="info-grid">
        <section className="card info-card info-wide" aria-labelledby="h-elig">
          <Head icon={<ClipboardCheck size={20} />} title={t('شروط التقديم', 'Eligibility')} count={C.eligibility.length} />
          <ol className="step-list">
            {C.eligibility.map((e, i) => <li key={i}><span className="step-no">{i + 1}</span><span>{L(e)}</span></li>)}
          </ol>
        </section>
        <div className="info-stack">
          <section className="card info-card" aria-labelledby="h-crit">
            <Head icon={<Award size={20} />} title={t('معايير التقييم', 'Evaluation criteria')} count={C.criteria.length} tone="green" />
            <ul className="check-list">
              {C.criteria.map((e, i) => <li key={i}><span className="check-dot"><Check size={13} strokeWidth={3} /></span><span>{L(e)}</span></li>)}
            </ul>
          </section>
          <section className="card info-card" aria-labelledby="h-fin">
            <Head icon={<Wallet size={20} />} title={t('نماذج التمويل', 'Financing models')} count={C.financing.length} tone="orange" />
            <div className="tile-grid">
              {C.financing.map((e, i) => <div key={i} className="tile">{L(e)}</div>)}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
