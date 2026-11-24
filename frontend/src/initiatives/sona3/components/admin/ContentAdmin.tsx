/* eslint-disable @typescript-eslint/no-explicit-any */
// شاشة الأدمن: تحرير كل نصوص الواجهة العامة (الاسم، الأرقام، الرحلة، الشروط، التمويل، الصفحات التعريفية) بدون نشر جديد.
import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { errorText, useStore } from '../../store/state';
import { useToast } from '../common/ToastSystem';
import {
  CONTENT_SCHEMA, DEFAULTS, getOverrides, resetContent, saveContent, useSiteContent,
  type Bi, type ContentKey, type Kind,
} from '../../content/siteContent';

const emptyBi = (): Bi => ({ ar: '', en: '' });

const BiInput: React.FC<{ label: string; value: Bi; onChange: (v: Bi) => void; long?: boolean }> = ({ label, value, onChange, long }) => {
  const { t } = useStore();
  const Tag: any = long ? 'textarea' : 'input';
  return (
    <div className="bi-field">
      <span className="bi-label">{label}</span>
      <div className="bi-pair">
        <Tag className="input" dir="rtl" lang="ar" rows={long ? 3 : undefined} value={value.ar} aria-label={`${label} — ${t('عربي', 'Arabic')}`} placeholder={t('عربي', 'Arabic')} onChange={(e: any) => onChange({ ...value, ar: e.target.value })} />
        <Tag className="input" dir="ltr" lang="en" rows={long ? 3 : undefined} value={value.en} aria-label={`${label} — ${t('إنجليزي', 'English')}`} placeholder="English" onChange={(e: any) => onChange({ ...value, en: e.target.value })} />
      </div>
    </div>
  );
};

function ListEditor<T>({ items, onChange, blank, render, addLabel }: { items: T[]; onChange: (v: T[]) => void; blank: () => T; render: (item: T, set: (v: T) => void, i: number) => React.ReactNode; addLabel: string }) {
  const { t } = useStore();
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="list-ed">
      {items.map((it, i) => (
        <div key={i} className="list-ed-row">
          <span className="list-ed-no">{i + 1}</span>
          <div className="list-ed-body">{render(it, (v) => onChange(items.map((x, k) => (k === i ? v : x))), i)}</div>
          <div className="list-ed-tools">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('نقل لأعلى', 'Move up')}><ArrowUp size={15} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={t('نقل لأسفل', 'Move down')}><ArrowDown size={15} /></button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label={t('حذف العنصر', 'Delete item')}><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...items, blank()])}><Plus size={15} /> {addLabel}</button>
    </div>
  );
}

const Fields: React.FC<{ kind: Kind; label: string; value: any; onChange: (v: any) => void }> = ({ kind, label, value, onChange }) => {
  const { t } = useStore();
  const add = t('إضافة عنصر', 'Add item');
  switch (kind) {
    case 'bi': return <BiInput label={label} value={value} onChange={onChange} long={String(value.ar).length > 90} />;
    case 'bilist': return <ListEditor<Bi> items={value} onChange={onChange} blank={emptyBi} addLabel={add} render={(it, set) => <BiInput label={t('النص', 'Text')} value={it} onChange={set} long />} />;
    case 'figures': return (
      <ListEditor<any> items={value} onChange={onChange} blank={() => ({ value: '', label: emptyBi() })} addLabel={add} render={(it, set) => (
        <>
          <div className="bi-field"><span className="bi-label">{t('الرقم / القيمة', 'Value')}</span>
            <input className="input" dir="ltr" value={it.value} aria-label={t('الرقم / القيمة', 'Value')} onChange={(e) => set({ ...it, value: e.target.value })} /></div>
          <BiInput label={t('الوصف', 'Label')} value={it.label} onChange={(label) => set({ ...it, label })} />
        </>
      )} />
    );
    case 'journey': return (
      <ListEditor<any> items={value} onChange={onChange} blank={() => ({ title: emptyBi(), desc: emptyBi() })} addLabel={t('إضافة مرحلة', 'Add stage')} render={(it, set) => (
        <>
          <BiInput label={t('عنوان المرحلة', 'Stage title')} value={it.title} onChange={(title) => set({ ...it, title })} />
          <BiInput label={t('الوصف', 'Description')} value={it.desc} onChange={(desc) => set({ ...it, desc })} long />
        </>
      )} />
    );
    case 'faq': return (
      <ListEditor<any> items={value} onChange={onChange} blank={() => ({ q: emptyBi(), a: emptyBi() })} addLabel={t('إضافة سؤال', 'Add question')} render={(it, set) => (
        <>
          <BiInput label={t('السؤال', 'Question')} value={it.q} onChange={(q) => set({ ...it, q })} />
          <BiInput label={t('الإجابة', 'Answer')} value={it.a} onChange={(a) => set({ ...it, a })} long />
        </>
      )} />
    );
  }
};

const Editor: React.FC<{ k: ContentKey }> = ({ k }) => {
  const { t, isAr } = useStore();
  const toast = useToast();
  const meta = CONTENT_SCHEMA.find((s) => s.key === k)!;
  const live = useSiteContent()[k];
  const [draft, setDraft] = useState<any>(() => structuredClone(live));
  const [busy, setBusy] = useState(false);
  const customised = k in getOverrides();
  const dirty = JSON.stringify(draft) !== JSON.stringify(live);
  const title = isAr ? meta.ar : meta.en;

  const run = async (fn: () => Promise<void>, okMsg: string, after?: () => void) => {
    setBusy(true);
    try { await fn(); toast.toast('success', okMsg); after?.(); } catch (e) { toast.toast('error', errorText(e, isAr)); } finally { setBusy(false); }
  };

  return (
    <section className="card sec content-editor" aria-label={title}>
      <header className="row-gap between" style={{ marginTop: 0 }}>
        <div>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className={`pill ${customised ? 'ok' : ''}`}>{customised ? t('معدَّل', 'Customised') : t('الافتراضي', 'Default')}</span>
        </div>
        <div className="row-gap wrap">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !customised} onClick={() => void run(() => resetContent(k), t('تمت الاستعادة', 'Restored'), () => setDraft(structuredClone(DEFAULTS[k])))}>
            <RotateCcw size={15} /> {t('استعادة الافتراضي', 'Restore default')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => void run(() => saveContent(k, draft), t('تم الحفظ', 'Saved'))}>
            <Save size={15} /> {t('حفظ', 'Save')}
          </button>
        </div>
      </header>
      <Fields kind={meta.kind} label={title} value={draft} onChange={setDraft} />
    </section>
  );
};

export const ContentAdminView: React.FC = () => {
  const { t, isAr } = useStore();
  const [key, setKey] = useState<ContentKey>('siteName');
  const groups: Array<{ id: 'brand' | 'home' | 'pages'; ar: string; en: string }> = [
    { id: 'brand', ar: 'الهوية والنصوص العامة', en: 'Brand & global text' },
    { id: 'home', ar: 'الصفحة الرئيسية', en: 'Home page' },
    { id: 'pages', ar: 'الصفحات التعريفية', en: 'Info pages' },
  ];
  return (
    <div className="container-custom page">
      <h1>{t('محتوى الموقع', 'Site content')}</h1>
      <p className="hint">{t('عدّل نصوص الواجهة العامة (عربي/إنجليزي). التغيير يظهر للزوار فور الحفظ ويُسجَّل في سجل التدقيق. «استعادة الافتراضي» تعيد النص الأصلي.', 'Edit the public site text (Arabic/English). Changes go live on save and are written to the audit log. “Restore default” brings back the original text.')}</p>
      <div className="content-admin">
        <nav className="content-nav" aria-label={t('أقسام المحتوى', 'Content sections')}>
          {groups.map((g) => (
            <div key={g.id}>
              <div className="content-nav-title">{isAr ? g.ar : g.en}</div>
              {CONTENT_SCHEMA.filter((s) => s.group === g.id).map((s) => (
                <button key={s.key} type="button" className={`content-nav-item${key === s.key ? ' active' : ''}`} onClick={() => setKey(s.key)} aria-current={key === s.key}>
                  {isAr ? s.ar : s.en}{s.key in getOverrides() ? <span className="dot" aria-label={t('معدَّل', 'Customised')} /> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <Editor key={key} k={key} />
      </div>
    </div>
  );
};
