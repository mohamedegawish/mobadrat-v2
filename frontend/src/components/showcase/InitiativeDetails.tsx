/**
 * The full public details of the initiatives run on the platform, as their own sites published them (Shams El-Senaa:
 * the initiative's official document; Sona'a El-Mostaqbal: the executive proposal + what its administrators edit in
 * «محتوى الواجهة»). Shown on the initiative's page (InitiativeDetailPage) in the platform's design, so an initiative is a
 * page of the one platform instead of a second site. The content itself stays in each initiative's content files.
 */
import React, { useEffect, useState } from 'react';
import { Award, Building2, Check, ClipboardCheck, Eye, FileText, Landmark, Rocket, Sun, Target, Wallet, HelpCircle, Phone, ScrollText, Info } from 'lucide-react';
import { call } from '../../platform/api';
import * as SHAMS from '../../initiatives/shams/content/shams';
import * as SONA3 from '../../initiatives/sona3/content/site';

type Bi = { ar: string; en: string };
type SectionId = string;

/** Section title — the same red-bar heading as the initiative page's other sections. */
const Title: React.FC<{ children: React.ReactNode; sub?: string; icon?: React.ReactNode }> = ({ children, sub, icon }) => (
  <div style={{ margin: '0 0 0.85rem 0' }}>
    <h2 style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-main)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <span style={{ width: '3px', height: '18px', background: 'var(--egypt-red)', borderRadius: '9999px', display: 'inline-block', flexShrink: 0 }} />
      {icon ? <span style={{ color: 'var(--egypt-red)', display: 'inline-flex' }}>{icon}</span> : null}
      {children}
    </h2>
    {sub ? <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: '0.35rem 0 0 0', lineHeight: 1.7 }}>{sub}</p> : null}
  </div>
);

const NumberedList: React.FC<{ items: string[]; isAr: boolean; accent?: boolean }> = ({ items, isAr, accent }) => (
  <div className="card" style={{ padding: '0.4rem 0', borderRadius: 'var(--radius-md)' }}>
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((t, i) => (
        <li key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.7rem 1.1rem', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
          <span style={{ width: '28px', height: '28px', borderRadius: '9px', background: accent ? 'var(--egypt-red-soft)' : 'var(--gov-primary-100, #DBEAFE)', color: accent ? 'var(--egypt-red)' : 'var(--gov-primary-800)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.78rem', fontWeight: 800 }}>
            {(i + 1).toLocaleString(isAr ? 'ar-EG' : 'en-US')}
          </span>
          <span style={{ fontSize: '0.88rem', color: 'var(--text-body)', lineHeight: 1.75, paddingTop: '0.15rem' }}>{t}</span>
        </li>
      ))}
    </ol>
  </div>
);

/** Figure cards — the value above its label. */
const Figures: React.FC<{ items: Array<{ value: string; label: string }> }> = ({ items }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: '0.75rem' }}>
    {items.map((f) => (
      <div key={f.label} className="card metric-bento" style={{ padding: '0.95rem 1rem', borderRadius: 'var(--radius-md)', borderTop: '3px solid var(--egypt-red)' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--egypt-red)', lineHeight: 1.3 }}>{f.value}</div>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.5 }}>{f.label}</div>
      </div>
    ))}
  </div>
);

/** A journey of numbered stages, each with what happens (and who does it). */
const Journey: React.FC<{ items: Array<{ title: string; desc: string; who?: string }>; isAr: boolean }> = ({ items, isAr }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '0.75rem' }}>
    {items.map((s, i) => (
      <div key={s.title} className="card" style={{ padding: '0.95rem 1rem', borderRadius: 'var(--radius-md)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--egypt-black)', color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.82rem', fontWeight: 800 }}>
          {(i + 1).toLocaleString(isAr ? 'ar-EG' : 'en-US')}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--gov-primary-900)' }}>{s.title}</div>
          <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: '0.2rem' }}>{s.desc}</div>
          {s.who ? <span className="badge badge-info" style={{ marginTop: '0.4rem' }}>{s.who}</span> : null}
        </div>
      </div>
    ))}
  </div>
);

// ── شمس الصناعة ──────────────────────────────────────────────────────────

const ShamsDetails: React.FC<{ isAr: boolean }> = ({ isAr }) => {
  const L = (b: Bi) => (isAr ? b.ar : b.en);
  return (
    <>
      <section>
        <Title icon={<Target size={16} />}>{isAr ? 'الهدف العام والأرقام الرسمية' : 'General goal & official figures'}</Title>
        <div className="card" style={{ padding: '1.1rem 1.25rem', borderRadius: 'var(--radius-md)', marginBottom: '0.75rem', borderInlineStart: '3px solid var(--egypt-red)' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-body)', lineHeight: 1.85 }}>{L(SHAMS.GENERAL_GOAL)}</p>
        </div>
        <Figures items={SHAMS.OFFICIAL_FIGURES.map((f) => ({ value: L(f.value), label: L(f.label) }))} />
      </section>

      <section>
        <Title icon={<Sun size={16} />} sub={isAr ? 'رحلة طلب المصنع من التسجيل حتى التعاقد مع البنك' : 'The factory’s journey from registration to contracting with a bank'}>
          {isAr ? 'كيف تعمل المبادرة' : 'How it works'}
        </Title>
        <Journey isAr={isAr} items={SHAMS.JOURNEY.map((s) => ({ title: L(s.title), desc: L(s.desc), who: L(s.who) }))} />
      </section>

      <section>
        <Title icon={<FileText size={16} />} sub={L(SHAMS.FILE_RULES)}>{isAr ? 'المستندات المطلوبة' : 'Required documents'}</Title>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {SHAMS.REQUIRED_DOCUMENTS.map((d) => (
            <div key={d.title.en} className="card" style={{ padding: '0.8rem 1rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', borderInlineStartWidth: '3px', borderInlineStartColor: 'var(--egypt-gold)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                <FileText size={17} style={{ color: 'var(--gov-primary-700)', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: '0.87rem', color: 'var(--gov-primary-900)' }}>{L(d.title)}</span>
              </div>
              <span style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>{L(d.when)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <Title icon={<Landmark size={16} />}>{isAr ? 'الجهات المشاركة' : 'Participating entities'}</Title>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.85rem' }}>
          {SHAMS.PARTICIPANTS.map((p) => (
            <span key={p.en} style={{ background: 'var(--gov-primary-100, #DBEAFE)', color: 'var(--gov-primary-900)', padding: '0.4rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.83rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <Building2 size={13} />{L(p)}
            </span>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: '0.75rem' }}>
          {SHAMS.OPERATING_BODIES.map((b) => (
            <div key={b.name.en} className="card" style={{ padding: '1rem', borderRadius: 'var(--radius-md)' }}>
              {b.logo
                ? <img src={b.logo} alt={isAr ? `شعار ${b.name.ar}` : `${b.name.en} logo`} width={58} height={52} style={{ objectFit: 'contain', marginBottom: '0.5rem' }} />
                : <span style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-sm)', background: 'var(--gov-primary-900)', color: 'var(--gov-gold-bright)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.5rem' }}><Building2 size={18} /></span>}
              <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--gov-primary-900)' }}>{L(b.name)}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '0.2rem' }}>{L(b.role)}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};

// ── صُنّاع المستقبل ──────────────────────────────────────────────────────

interface Sona3Content {
  heroEyebrow: Bi; vision: Bi; mission: Bi;
  figures: Array<{ value: string; label: Bi }>; journey: Array<{ title: Bi; desc: Bi }>;
  eligibility: Bi[]; criteria: Bi[]; financing: Bi[];
  about: Bi[]; contact: Bi[]; terms: Bi[]; faq: Array<{ q: Bi; a: Bi }>;
}

const SONA3_DEFAULTS: Sona3Content = {
  heroEyebrow: SONA3.HERO_EYEBROW, vision: SONA3.VISION, mission: SONA3.MISSION,
  figures: SONA3.FIGURES, journey: SONA3.JOURNEY, eligibility: SONA3.ELIGIBILITY, criteria: SONA3.CRITERIA_TEXT, financing: SONA3.FINANCING_TERMS,
  about: [], contact: [], terms: [], faq: [],
};

/** The initiative's public content: its defaults, with what its administrators edited (public API of the initiative). */
function useSona3Content(): Sona3Content {
  const [c, setC] = useState<Sona3Content>(SONA3_DEFAULTS);
  useEffect(() => {
    let live = true;
    call<{ overrides: Partial<Sona3Content> }>('/i/sona3/public/site-content')
      .then((d) => { if (live) setC({ ...SONA3_DEFAULTS, ...(d.overrides ?? {}) }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return c;
}

const Paragraphs: React.FC<{ items: Bi[]; isAr: boolean }> = ({ items, isAr }) => (
  <div className="card" style={{ padding: '1.1rem 1.25rem', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
    {items.map((p, i) => <p key={i} style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-body)', lineHeight: 1.85, whiteSpace: 'pre-line' }}>{isAr ? p.ar : p.en}</p>)}
  </div>
);

const Sona3Details: React.FC<{ isAr: boolean }> = ({ isAr }) => {
  const C = useSona3Content();
  const L = (b: Bi) => (isAr ? b.ar : b.en);
  return (
    <>
      <section>
        <Title icon={<Rocket size={16} />} sub={L(C.heroEyebrow)}>{isAr ? 'المبادرة في أرقام' : 'The initiative in figures'}</Title>
        <Figures items={C.figures.map((f) => ({ value: f.value, label: L(f.label) }))} />
      </section>

      <section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '0.9rem' }}>
          {[{ icon: <Eye size={18} />, title: isAr ? 'الرؤية' : 'Vision', text: L(C.vision) }, { icon: <Target size={18} />, title: isAr ? 'الرسالة' : 'Mission', text: L(C.mission) }].map((v) => (
            <div key={v.title} className="card" style={{ padding: '1.15rem', borderRadius: 'var(--radius-md)' }}>
              <div style={{ width: '38px', height: '38px', borderRadius: 'var(--radius-sm)', background: 'var(--gov-primary-900)', color: 'var(--gov-gold-bright)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.7rem' }}>{v.icon}</div>
              <h3 style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--gov-primary-900)', margin: '0 0 0.35rem 0' }}>{v.title}</h3>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-body)', lineHeight: 1.8, margin: 0 }}>{v.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <Title icon={<Rocket size={16} />}>{isAr ? 'رحلة مشروعك: من الفكرة إلى التشغيل' : 'Your project journey: from idea to operation'}</Title>
        <Journey isAr={isAr} items={C.journey.map((j) => ({ title: L(j.title), desc: L(j.desc) }))} />
      </section>

      <section>
        <Title icon={<ClipboardCheck size={16} />}>{isAr ? 'شروط التقديم' : 'Eligibility'}</Title>
        <NumberedList isAr={isAr} items={C.eligibility.map(L)} />
      </section>

      <section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '0.9rem', alignItems: 'start' }}>
          <div>
            <Title icon={<Award size={16} />}>{isAr ? 'معايير التقييم' : 'Evaluation criteria'}</Title>
            <div className="card" style={{ padding: '0.4rem 0', borderRadius: 'var(--radius-md)' }}>
              {C.criteria.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', padding: '0.65rem 1.1rem', borderTop: i ? '1px solid var(--border-subtle)' : 'none', fontSize: '0.88rem', color: 'var(--text-body)' }}>
                  <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--status-approved-bg)', color: 'var(--status-approved)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Check size={13} strokeWidth={3} /></span>
                  {L(e)}
                </div>
              ))}
            </div>
          </div>
          <div>
            <Title icon={<Wallet size={16} />}>{isAr ? 'نماذج التمويل' : 'Financing models'}</Title>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.6rem' }}>
              {C.financing.map((e, i) => (
                <div key={i} className="card" style={{ padding: '0.85rem 0.9rem', borderRadius: 'var(--radius-md)', borderInlineStart: '3px solid var(--gov-gold-bright)', fontSize: '0.86rem', fontWeight: 700, color: 'var(--gov-primary-900)', lineHeight: 1.5 }}>{L(e)}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {C.about.length ? <section><Title icon={<Info size={16} />}>{isAr ? 'عن المبادرة' : 'About the initiative'}</Title><Paragraphs items={C.about} isAr={isAr} /></section> : null}

      {C.faq.length ? (
        <section>
          <Title icon={<HelpCircle size={16} />}>{isAr ? 'الأسئلة الشائعة' : 'Frequently asked questions'}</Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {C.faq.map((f, i) => (
              <div key={i} className="card" style={{ padding: '1rem 1.1rem', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 800, color: 'var(--gov-primary-900)', fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                  <HelpCircle size={15} style={{ color: 'var(--gov-gold-dark)', flexShrink: 0 }} /><span>{L(f.q)}</span>
                </div>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-body)', lineHeight: 1.65, margin: 0, paddingInlineStart: '1.35rem' }}>{L(f.a)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {C.contact.length ? <section><Title icon={<Phone size={16} />}>{isAr ? 'تواصل معنا' : 'Contact us'}</Title><Paragraphs items={C.contact} isAr={isAr} /></section> : null}
      {C.terms.length ? <section><Title icon={<ScrollText size={16} />}>{isAr ? 'الشروط والأحكام' : 'Terms & conditions'}</Title><Paragraphs items={C.terms} isAr={isAr} /></section> : null}
    </>
  );
};

/**
 * The details of each initiative run by a module, and the page sections they replace (the initiative's own, authoritative
 * list wins over a shorter catalog one — e.g. its participating entities).
 */
export const INITIATIVE_DETAILS: Record<string, { Details: React.FC<{ isAr: boolean }>; replaces: SectionId[] }> = {
  shams: { Details: ShamsDetails, replaces: ['partners', 'documents'] },
  sona3: { Details: Sona3Details, replaces: [] },
};
