/** Public site: home, initiatives catalog, initiative page (details + registration / apply), impact. */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, LogIn, UserPlus, LayoutDashboard, Layers } from 'lucide-react';
import { api, type Banner, type Initiative } from '../api';
import { usePlatform, store } from '../store';
import { Alert, Loading, statusLabel } from '../layout';
import { formatEGP } from '../../utils/format';

/** Catalog lists may hold plain strings or {xAr, xEn} objects (content edited over time): show the right language. */
export function txt(v: unknown, isAr: boolean): string {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  const suffix = isAr ? 'Ar' : 'En';
  for (const base of ['text', 'title', 'label', 'name', 'description', 'desc', 'value', '']) {
    const k = `${base}${suffix}`;
    if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  }
  for (const k of Object.keys(o)) if (k.endsWith('Ar') && typeof o[k] === 'string') return String(isAr ? o[k] : (o[`${k.slice(0, -2)}En`] ?? o[k]));
  return '';
}

const Arrow: React.FC = () => (document.documentElement.dir === 'rtl' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />);

const cover = (i: Initiative) => i.coverImage || '/covers/solar-2026.jpg';

export const InitiativeCard: React.FC<{ i: Initiative }> = ({ i }) => {
  const { isAr, t, me } = usePlatform();
  const st = statusLabel(i.status, isAr);
  const membership = me?.memberships.find((m) => m.initiativeId === i.moduleId);
  return (
    <article className="pf-card">
      <div className="pf-card-cover" style={{ backgroundImage: `url(${cover(i)})` }}>
        <span className="pf-card-badge" style={{ color: i.themeColor }}>{(isAr ? i.badgeTextAr : i.badgeTextEn) || st.label}</span>
      </div>
      <div className="pf-card-body">
        <span className="pf-chip">{isAr ? i.category : (i.categoryEn || i.category)}</span>
        <div className="pf-card-title" style={{ color: i.themeColor }}>{isAr ? i.titleAr : (i.titleEn || i.titleAr)}</div>
        <p className="pf-card-text">{isAr ? i.taglineAr : (i.taglineEn || i.taglineAr)}</p>
        <div className="pf-card-foot">
          <a className="btn btn-outline btn-sm" href={`#initiative/${i.slug}`}>{t('التفاصيل', 'Details')} <Arrow /></a>
          {membership ? <a className="btn btn-primary btn-sm" href={`#i/${membership.initiativeId}/${membership.card?.view ?? membership.defaultView}`}>{t('لوحة المبادرة', 'Open dashboard')}</a>
            : i.hasModule && i.status === 'active' && i.registrationOpen ? <a className="btn btn-primary btn-sm" href={`#initiative/${i.slug}`}>{t('قدّم الآن', 'Apply now')}</a> : null}
        </div>
      </div>
    </article>
  );
};

const BannerStrip: React.FC = () => {
  const { isAr } = usePlatform();
  const [banners, setBanners] = useState<Banner[]>([]);
  useEffect(() => { api.banners().then(setBanners).catch(() => setBanners([])); }, []);
  if (!banners.length) return null;
  return (
    <section className="pf-section">
      <div className="pf-grid">
        {banners.map((b) => {
          const href = b.linkType === 'initiative' ? `#initiative/${b.linkTarget}` : b.linkType === 'url' ? b.linkTarget : undefined;
          return (
            <a key={b.id} className="pf-card" href={href} target={b.linkType === 'url' ? '_blank' : undefined} rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="pf-card-cover" style={{ backgroundImage: `url(${b.imageUrl})` }} />
              <div className="pf-card-body">
                <div className="pf-card-title">{isAr ? b.titleAr : (b.titleEn || b.titleAr)}</div>
                <p className="pf-card-text">{isAr ? b.subtitleAr : (b.subtitleEn || b.subtitleAr)}</p>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
};

export const HomePage: React.FC = () => {
  const { t, isAr, initiatives, me } = usePlatform();
  const [impact, setImpact] = useState<Awaited<ReturnType<typeof api.impact>> | null>(null);
  useEffect(() => { api.impact().then(setImpact).catch(() => undefined); }, []);
  const list = initiatives ?? [];
  return (
    <>
      <section className="pf-hero">
        <div className="pf-container">
          <h1>{t('بوابة واحدة لكل مبادرات الصناعة المصرية', 'One gateway to every Egyptian industrial initiative')}</h1>
          <p>{t('سجّل مرة واحدة، أكمل بياناتك وبيانات منشأتك مرة واحدة، ثم قدّم على أي مبادرة — والمنصة تطلب منك فقط ما ينقص كل مبادرة. تابع كل طلباتك من مكان واحد.',
            'Register once, complete your data and your facility\'s data once, then apply to any initiative — the platform only asks what each initiative still needs. Follow all your applications in one place.')}</p>
          <div className="pf-hero-actions">
            <a className="btn btn-primary btn-lg" href="#initiatives"><Layers size={18} /> {t('تصفح المبادرات', 'Browse initiatives')}</a>
            {me ? <a className="btn btn-outline btn-lg" href="#hub"><LayoutDashboard size={18} /> {t('مبادراتي', 'My initiatives')}</a>
              : <a className="btn btn-outline btn-lg" href="#register"><UserPlus size={18} /> {t('أنشئ حسابك', 'Create your account')}</a>}
          </div>
          <div className="pf-stats">
            <div className="pf-stat"><b>{list.length}</b><span>{t('مبادرة على المنصة', 'initiatives on the platform')}</span></div>
            <div className="pf-stat"><b>{impact?.totals.applications ?? '—'}</b><span>{t('طلب مُقدَّم', 'applications submitted')}</span></div>
            <div className="pf-stat"><b>{impact?.totals.open ?? '—'}</b><span>{t('طلب قيد المتابعة', 'applications in progress')}</span></div>
            <div className="pf-stat"><b>{impact?.totals.positiveOutcome ?? '—'}</b><span>{t('مشروع ناجح', 'successful projects')}</span></div>
          </div>
        </div>
      </section>
      <div className="pf-container">
        <section className="pf-section">
          <div className="pf-section-head">
            <div><h2>{t('المبادرات المتاحة', 'Available initiatives')}</h2><p>{t('لكل مبادرة شروطها ومراحلها ولوحة متابعة خاصة بها.', 'Each initiative has its own conditions, stages and dashboard.')}</p></div>
            <a className="btn btn-ghost" href="#initiatives">{t('كل المبادرات', 'All initiatives')} <Arrow /></a>
          </div>
          {initiatives === null ? <Loading /> : <div className="pf-grid">{list.slice(0, 6).map((i) => <InitiativeCard key={i.id} i={i} />)}</div>}
        </section>
        <BannerStrip />
        <section className="pf-section">
          <div className="pf-section-head"><h2>{t('كيف تعمل المنصة؟', 'How does it work?')}</h2></div>
          <div className="pf-grid">
            {[
              [t('حساب واحد', 'One account'), t('سجّل ببريدك مرة واحدة — من أي مبادرة أو من المنصة مباشرة.', 'Register with your e-mail once — from any initiative or from the platform.')],
              [t('بياناتك المشتركة', 'Your shared data'), t('بياناتك الشخصية وبيانات منشأتك ومستنداتك تُحفظ مرة وتُستخدم في كل المبادرات.', 'Your personal data, your facility data and documents are kept once and reused everywhere.')],
              [t('النواقص فقط', 'Only what is missing'), t('عند التقديم على مبادرة جديدة تعرض المنصة ما ينقص متطلباتها فقط لتستكمله.', 'When you apply to another initiative the platform shows only what its requirements still miss.')],
              [t('لوحة لكل مبادرة', 'A dashboard per initiative'), t('اختر المبادرة من «مبادراتي» وادخل لوحتها لمتابعة مراحل طلبك.', 'Pick the initiative from "My initiatives" and open its dashboard to follow your application.')],
            ].map(([h, p], k) => (
              <div key={k} className="pf-box"><h3><CheckCircle2 size={18} style={{ color: '#047857', verticalAlign: 'middle' }} /> {h}</h3><p className="pf-card-text">{p}</p></div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
};

export const InitiativesPage: React.FC = () => {
  const { t, initiatives, isAr } = usePlatform();
  const [q, setQ] = useState('');
  const list = (initiatives ?? []).filter((i) => !q || `${i.titleAr} ${i.titleEn} ${i.taglineAr} ${i.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="pf-container pf-page">
      <div className="pf-section-head">
        <div><h2>{t('دليل المبادرات', 'Initiatives directory')}</h2><p>{t('اختر مبادرة لعرض تفاصيلها ومتطلباتها والتسجيل فيها.', 'Choose an initiative to see its details, requirements and registration.')}</p></div>
        <div className="pf-field" style={{ minWidth: 260 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isAr ? 'بحث…' : 'Search…'} /></div>
      </div>
      {initiatives === null ? <Loading /> : list.length ? <div className="pf-grid">{list.map((i) => <InitiativeCard key={i.id} i={i} />)}</div>
        : <div className="pf-empty">{t('لا توجد نتائج.', 'No results.')}</div>}
    </div>
  );
};

const Section: React.FC<{ title: string; items: unknown[]; ordered?: boolean }> = ({ title, items, ordered }) => {
  const { isAr } = usePlatform();
  const list = items.map((x) => txt(x, isAr)).filter(Boolean);
  if (!list.length) return null;
  return (
    <div className="pf-box">
      <h3>{title}</h3>
      {ordered ? <ol className="pf-steps">{list.map((x, k) => <li key={k}>{x}</li>)}</ol> : <ul className="pf-list">{list.map((x, k) => <li key={k}>{x}</li>)}</ul>}
    </div>
  );
};

export const InitiativePage: React.FC = () => {
  const { t, isAr, param, me } = usePlatform();
  const [i, setI] = useState<Initiative | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setI(null); setErr(''); if (param) api.initiative(param).then(setI).catch(() => setErr('not found')); }, [param]);
  if (err) return <div className="pf-container pf-page"><Alert tone="err">{t('المبادرة غير موجودة.', 'Initiative not found.')}</Alert></div>;
  if (!i) return <Loading />;
  const st = statusLabel(i.status, isAr);
  const membership = me?.memberships.find((m) => m.initiativeId === i.moduleId);
  const open = i.hasModule && i.status === 'active' && i.registrationOpen;
  const steps = isAr ? i.moduleStepsAr : i.moduleStepsEn;
  const apply = () => { if (!me) { store.rememberReturn(`apply/${i.slug}`); store.go('login'); } else store.go(`apply/${i.slug}`); };
  return (
    <>
      <section className="pf-ini-hero" style={{ backgroundImage: `url(${cover(i)})` }}>
        <div className="pf-container">
          <span className={`pf-chip ${st.tone}`}>{st.label}</span>
          <h1>{isAr ? i.titleAr : (i.titleEn || i.titleAr)}</h1>
          <p style={{ maxWidth: 760, lineHeight: 1.9, opacity: 0.92 }}>{isAr ? i.taglineAr : (i.taglineEn || i.taglineAr)}</p>
        </div>
      </section>
      <div className="pf-container pf-ini-layout">
        <div className="pf-gap">
          <div className="pf-box"><h3>{t('عن المبادرة', 'About the initiative')}</h3><p className="pf-card-text" style={{ whiteSpace: 'pre-line' }}>{isAr ? i.descriptionAr : (i.descriptionEn || i.descriptionAr)}</p></div>
          <Section title={t('الأهداف', 'Objectives')} items={i.objectives} />
          <Section title={t('شروط الأهلية', 'Eligibility')} items={i.eligibilityRequirements} />
          <Section title={t('المزايا', 'Benefits')} items={i.benefits} />
          <Section title={t('معايير الاختيار', 'Selection criteria')} items={i.selectionCriteria} />
          <Section title={t('المستندات المطلوبة', 'Required documents')} items={i.requiredDocsList} />
          {i.faqs?.length ? (
            <div className="pf-box pf-faq"><h3>{t('أسئلة شائعة', 'FAQ')}</h3>
              {i.faqs.map((f, k) => <details key={k}><summary>{txt({ textAr: f.questionAr ?? f.qAr, textEn: f.questionEn ?? f.qEn }, isAr) || txt(f, isAr)}</summary><p className="pf-card-text">{txt({ textAr: f.answerAr ?? f.aAr, textEn: f.answerEn ?? f.aEn }, isAr)}</p></details>)}
            </div>
          ) : null}
          {i.hasModule ? (
            <div className="pf-box">
              <h3>{t('الموقع الكامل للمبادرة', 'The initiative\'s full site')}</h3>
              <p className="pf-card-text">{t('للمبادرة صفحتها التفصيلية الخاصة (المراحل والشروط والأسئلة).', 'The initiative has its own detailed page (stages, conditions, FAQ).')}</p>
              <a className="btn btn-outline btn-sm" href={`#i/${i.moduleId}/home`}>{t('فتح صفحة المبادرة', 'Open the initiative page')} <Arrow /></a>
            </div>
          ) : null}
        </div>
        <aside className="pf-sticky">
          <div className="pf-box">
            <h3>{t('التقديم', 'Apply')}</h3>
            {membership ? (
              <div className="pf-gap">
                <Alert tone="ok">{t('أنت مسجل في هذه المبادرة.', 'You are enrolled in this initiative.')} {membership.card ? `${t('الحالة', 'Status')}: ${isAr ? membership.card.statusAr : membership.card.statusEn}` : ''}</Alert>
                <a className="btn btn-primary" href={`#i/${membership.initiativeId}/${membership.card?.view ?? membership.defaultView}`}><LayoutDashboard size={16} /> {t('ادخل لوحة المبادرة', 'Open the dashboard')}</a>
              </div>
            ) : !i.hasModule ? <p className="pf-muted">{t('هذه صفحة تعريفية — التقديم عبر الجهة المسؤولة عن المبادرة.', 'Information page — applications go through the responsible body.')}</p>
              : !open ? <Alert tone="warn">{t('التقديم غير متاح حاليًا.', 'Applications are not open now.')}</Alert>
              : me ? (
                <div className="pf-gap">
                  <p className="pf-card-text">{t('سنستخدم بياناتك المسجلة على المنصة ونعرض لك فقط ما ينقص متطلبات هذه المبادرة.', 'We use your platform data and show only what this initiative still needs.')}</p>
                  <button type="button" className="btn btn-primary" onClick={apply}><FileText size={16} /> {t('قدّم على المبادرة', 'Apply to this initiative')}</button>
                </div>
              ) : (
                <div className="pf-gap">
                  {i.registerView ? <a className="btn btn-primary" href={`#${i.registerView}`}><UserPlus size={16} /> {t('سجّل وقدّم (أول مرة)', 'Register and apply (first time)')}</a> : null}
                  <button type="button" className="btn btn-outline" onClick={apply}><LogIn size={16} /> {t('لدي حساب على المنصة — دخول', 'I have a platform account — sign in')}</button>
                  <p className="pf-muted" style={{ fontSize: 13 }}>{t('إن كان لديك حساب من مبادرة أخرى فادخل به، ولن نطلب منك إلا البيانات الناقصة.', 'If you already have an account from another initiative, sign in — we only ask what is missing.')}</p>
                </div>
              )}
          </div>
          {steps.length && i.hasModule ? <div className="pf-box"><h3>{t('بعد التقديم', 'After applying')}</h3><ol className="pf-steps">{steps.map((s, k) => <li key={k}>{s}</li>)}</ol></div> : null}
          <div className="pf-box">
            <h3>{t('بيانات سريعة', 'Key facts')}</h3>
            <ul className="pf-list" style={{ listStyle: 'none', paddingInlineStart: 0 }}>
              {i.budgetTotalEGP ? <li>{t('الميزانية', 'Budget')}: <b>{formatEGP(i.budgetTotalEGP, isAr)}</b></li> : null}
              {i.startDate ? <li>{t('البداية', 'Start')}: <b>{i.startDate.slice(0, 10)}</b></li> : null}
              {i.endDate ? <li>{t('النهاية', 'End')}: <b>{i.endDate.slice(0, 10)}</b></li> : null}
              <li>{t('المتقدم', 'Applicant')}: <b>{i.subject === 'factory' ? t('منشأة صناعية', 'Industrial facility') : i.subject === 'person' ? t('فرد / رائد أعمال', 'Individual / founder') : '—'}</b></li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
};

export const ImpactPage: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.impact>> | null>(null);
  useEffect(() => { api.impact().then(setD).catch(() => undefined); }, []);
  if (!d) return <Loading />;
  const max = Math.max(1, ...d.byGovernorate.map((g) => g.count));
  return (
    <div className="pf-container pf-page pf-gap">
      <div className="pf-section-head"><h2>{t('أثر المبادرات', 'Initiatives impact')}</h2></div>
      <div className="pf-kpis">
        <div className="pf-kpi"><b>{d.totals.applications}</b><span>{t('طلب مُقدَّم', 'Applications')}</span></div>
        <div className="pf-kpi"><b>{d.totals.open}</b><span>{t('قيد المتابعة', 'In progress')}</span></div>
        <div className="pf-kpi"><b>{d.totals.positiveOutcome}</b><span>{t('نتيجة ناجحة', 'Successful')}</span></div>
      </div>
      <div className="pf-grid">
        {d.initiatives.map((i) => (
          <div key={i.initiativeId} className="pf-box">
            <h3 style={{ color: i.themeColor }}>{isAr ? i.titleAr : i.titleEn}</h3>
            <div className="pf-kpis">
              <div className="pf-kpi"><b>{i.applications}</b><span>{t('طلب', 'Applications')}</span></div>
              {i.kpis.slice(0, 3).map((k) => <div key={k.key} className="pf-kpi"><b>{k.value.toLocaleString(isAr ? 'ar-EG' : 'en-US')}{k.unit ? ` ${k.unit}` : ''}</b><span>{isAr ? k.labelAr : k.labelEn}</span></div>)}
            </div>
          </div>
        ))}
      </div>
      {d.byGovernorate.length ? (
        <div className="pf-box"><h3>{t('التوزيع الجغرافي', 'By governorate')}</h3>
          <div className="pf-bars">{d.byGovernorate.slice(0, 15).map((g) => (
            <div key={g.governorate} className="pf-bar"><span>{g.governorate}</span><div className="track"><div className="fill" style={{ width: `${(g.count / max) * 100}%`, background: '#0B2545' }} /></div><b>{g.count}</b></div>
          ))}</div>
        </div>
      ) : null}
    </div>
  );
};
