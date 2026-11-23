/**
 * The unified platform administration: statistics of every initiative side by side and summed, accounts and memberships,
 * catalog content, banners, audit log, outbox and readiness. Each initiative's own staff screens open inside its module.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Users, BookOpen, Image, ScrollText, Mail, ClipboardCheck, ExternalLink, RefreshCw, Download, Building } from 'lucide-react';
import { api, errText, type AdminStats, type AdminInitiativeStats, type AdminUser, type Banner, type Initiative, type StatsSummary } from '../api';
import { usePlatform, store, canManage, canEditContent } from '../store';
import { Alert, Loading, Forbidden } from '../layout';
import { formatEGP } from '../../utils/format';

const PHASES: Array<{ key: string; ar: string; en: string; color: string }> = [
  { key: 'draft', ar: 'مسودات', en: 'Drafts', color: '#94A3B8' },
  { key: 'screening', ar: 'فحص ومراجعة', en: 'Screening', color: '#2563EB' },
  { key: 'correction', ar: 'استيفاء', en: 'Corrections', color: '#D97706' },
  { key: 'evaluation', ar: 'تقييم', en: 'Evaluation', color: '#7C3AED' },
  { key: 'decision', ar: 'قرار وتعاقد', en: 'Decision', color: '#0891B2' },
  { key: 'execution', ar: 'تنفيذ', en: 'Execution', color: '#0D9488' },
  { key: 'success', ar: 'نجاح', en: 'Success', color: '#059669' },
  { key: 'closed_unsuccessful', ar: 'مغلقة دون نجاح', en: 'Closed', color: '#DC2626' },
  { key: 'withdrawn', ar: 'منسحبة', en: 'Withdrawn', color: '#64748B' },
];

const num = (n: number | undefined, isAr: boolean) => (n ?? 0).toLocaleString(isAr ? 'ar-EG' : 'en-US');

const PhaseBars: React.FC<{ byPhase: Record<string, number> }> = ({ byPhase }) => {
  const { isAr } = usePlatform();
  const max = Math.max(1, ...Object.values(byPhase));
  return (
    <div className="pf-bars">
      {PHASES.map((p) => (
        <div key={p.key} className="pf-bar"><span>{isAr ? p.ar : p.en}</span><div className="track"><div className="fill" style={{ width: `${((byPhase[p.key] ?? 0) / max) * 100}%`, background: p.color }} /></div><b>{byPhase[p.key] ?? 0}</b></div>
      ))}
    </div>
  );
};

const Funnel: React.FC<{ s: StatsSummary; color: string }> = ({ s, color }) => {
  const { isAr } = usePlatform();
  const max = Math.max(1, ...s.funnel.map((f) => f.count));
  return (
    <div className="pf-bars">
      {s.funnel.map((f) => <div key={f.key} className="pf-bar"><span>{isAr ? f.labelAr : f.labelEn}</span><div className="track"><div className="fill" style={{ width: `${(f.count / max) * 100}%`, background: color }} /></div><b>{f.count}</b></div>)}
    </div>
  );
};

export const AdminDashboard: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [s, setS] = useState<AdminStats | null>(null);
  const [act, setAct] = useState<Awaited<ReturnType<typeof api.adminActivity>>['items']>([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api.adminStats({ from: range.from || undefined, to: range.to || undefined }).then(setS).catch((e) => setErr(errText(e, isAr)));
    api.adminActivity().then((d) => setAct(d.items)).catch(() => undefined);
  }, [range, isAr]);
  useEffect(() => { load(); }, [load]);
  if (err) return <Alert tone="err">{err}</Alert>;
  if (!s) return <Loading />;
  const tot = s.totals;
  const govMax = Math.max(1, ...s.byGovernorate.map((g) => g.count));
  return (
    <div className="pf-gap">
      <div className="pf-section-head">
        <div><h2>{t('النظرة العامة على المبادرات', 'Initiatives overview')}</h2><p className="pf-muted">{t('تحديث', 'Updated')}: {new Date(s.generatedAt).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div className="pf-field"><label>{t('من', 'From')}</label><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div className="pf-field"><label>{t('إلى', 'To')}</label><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
          <button type="button" className="btn btn-ghost" onClick={load}><RefreshCw size={15} /></button>
        </div>
      </div>
      <div className="pf-kpis">
        <div className="pf-kpi"><b>{num(s.platform.accounts, isAr)}</b><span>{t('حساب على المنصة', 'Platform accounts')}</span></div>
        <div className="pf-kpi"><b>{num(s.platform.multiInitiativeAccounts, isAr)}</b><span>{t('حساب في أكثر من مبادرة', 'Accounts in 2+ initiatives')}</span></div>
        <div className="pf-kpi"><b>{num(tot.applications - tot.drafts, isAr)}</b><span>{t('طلب مُرسل', 'Submitted applications')}</span></div>
        <div className="pf-kpi"><b>{num(tot.drafts, isAr)}</b><span>{t('مسودة', 'Drafts')}</span></div>
        <div className="pf-kpi"><b>{num(tot.open, isAr)}</b><span>{t('قيد المتابعة', 'In progress')}</span></div>
        <div className="pf-kpi"><b>{num(tot.positiveOutcome, isAr)}</b><span>{t('نتيجة إيجابية', 'Positive outcome')}</span></div>
        <div className="pf-kpi"><b>{num(tot.negativeOutcome, isAr)}</b><span>{t('مغلقة دون نجاح', 'Closed unsuccessful')}</span></div>
        <div className="pf-kpi"><b>{num(tot.overdue, isAr)}</b><span>{t('متأخرة عن المهلة', 'Overdue')}</span></div>
      </div>
      <div className="pf-grid">
        <div className="pf-box"><h3>{t('المراحل (كل المبادرات)', 'Phases (all initiatives)')}</h3><PhaseBars byPhase={s.byPhase} /></div>
        <div className="pf-box"><h3>{t('التوزيع الجغرافي', 'By governorate')}</h3>
          {s.byGovernorate.length ? <div className="pf-bars">{s.byGovernorate.slice(0, 12).map((g) => <div key={g.governorate} className="pf-bar"><span>{g.governorate}</span><div className="track"><div className="fill" style={{ width: `${(g.count / govMax) * 100}%`, background: '#0B2545' }} /></div><b>{g.count}</b></div>)}</div> : <p className="pf-muted">—</p>}
        </div>
      </div>
      <div className="pf-section-head"><h2>{t('كل مبادرة', 'Per initiative')}</h2></div>
      <div className="pf-grid">
        {s.initiatives.map((i) => (
          <div key={i.initiativeId} className="pf-box" style={{ borderTop: `4px solid ${i.themeColor}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h3>{isAr ? i.titleAr : i.titleEn}</h3><a href={`#admin-initiative/${i.initiativeId}`}>{t('التفاصيل', 'Details')}</a></div>
            {i.summary ? (
              <>
                <div className="pf-kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <div className="pf-kpi"><b>{i.summary.totals.applicants}</b><span>{t('متقدم', 'Applicants')}</span></div>
                  <div className="pf-kpi"><b>{i.summary.totals.applications - i.summary.totals.drafts}</b><span>{t('مُرسل', 'Submitted')}</span></div>
                  <div className="pf-kpi"><b>{i.summary.totals.positiveOutcome}</b><span>{t('ناجح', 'Success')}</span></div>
                </div>
                <div style={{ marginTop: 12 }}><Funnel s={i.summary} color={i.themeColor} /></div>
              </>
            ) : <Alert tone="err">{i.error ?? t('تعذر تحميل الإحصاءات', 'Statistics unavailable')}</Alert>}
          </div>
        ))}
      </div>
      <div className="pf-box"><h3>{t('آخر النشاط', 'Recent activity')}</h3>
        {act.length ? <table className="pf-table"><tbody>{act.map((a, k) => (
          <tr key={k}><td style={{ width: 170 }} className="pf-muted">{new Date(a.at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}</td><td><span className="pf-chip">{isAr ? a.titleAr : a.titleEn}</span></td>
            <td><a href={`#i/${a.initiativeId}/${a.view}`}>{isAr ? a.labelAr : a.labelEn}</a></td></tr>
        ))}</tbody></table> : <p className="pf-muted">—</p>}
      </div>
    </div>
  );
};

export const AdminInitiative: React.FC = () => {
  const { t, isAr, param } = usePlatform();
  const [d, setD] = useState<AdminInitiativeStats | null>(null);
  useEffect(() => { setD(null); if (param) void api.adminInitiativeStats(param).then(setD).catch(() => setD(null)); }, [param]);
  if (!d) return <Loading />;
  const s = d.summary;
  return (
    <div className="pf-gap">
      <div className="pf-section-head">
        <div><h2 style={{ color: d.themeColor }}>{isAr ? d.titleAr : d.titleEn}</h2><p className="pf-muted">{t('إحصاءات المبادرة وروابط شاشاتها', 'The initiative\'s statistics and screens')}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{d.staffEntryPoints.map((e) => <a key={e.view} className="btn btn-outline btn-sm" href={`#i/${d.initiativeId}/${e.view}`}><ExternalLink size={14} /> {isAr ? e.labelAr : e.labelEn}</a>)}</div>
      </div>
      {!s ? <Alert tone="err">{d.error}</Alert> : (
        <>
          <div className="pf-kpis">
            <div className="pf-kpi"><b>{s.totals.applicants}</b><span>{t('متقدم', 'Applicants')}</span></div>
            <div className="pf-kpi"><b>{s.totals.applications}</b><span>{t('كل الطلبات', 'All applications')}</span></div>
            <div className="pf-kpi"><b>{s.totals.open}</b><span>{t('مفتوحة', 'Open')}</span></div>
            <div className="pf-kpi"><b>{s.totals.positiveOutcome}</b><span>{t('ناجحة', 'Successful')}</span></div>
            {s.kpis.map((k) => <div key={k.key} className="pf-kpi"><b>{k.unit === 'EGP' ? formatEGP(k.value, isAr) : `${num(k.value, isAr)}${k.unit ? ` ${k.unit}` : ''}`}</b><span>{isAr ? k.labelAr : k.labelEn}</span></div>)}
            {s.jobs ? <div className="pf-kpi"><b>{num(s.jobs.expected, isAr)} / {num(s.jobs.actual, isAr)}</b><span>{t('فرص عمل (متوقعة / فعلية)', 'Jobs (expected / actual)')}</span></div> : null}
          </div>
          <div className="pf-grid">
            <div className="pf-box"><h3>{t('مسار الطلبات', 'Funnel')}</h3><Funnel s={s} color={d.themeColor} /></div>
            <div className="pf-box"><h3>{t('المراحل', 'Phases')}</h3><PhaseBars byPhase={s.byPhase} /></div>
          </div>
          <div className="pf-box"><h3>{t('الحالات التفصيلية للمبادرة', 'The initiative\'s states')}</h3>
            <table className="pf-table"><thead><tr><th>{t('الحالة', 'State')}</th><th>{t('المرحلة', 'Phase')}</th><th>{t('العدد', 'Count')}</th></tr></thead>
              <tbody>{s.byState.filter((x) => x.count).map((x) => <tr key={x.key}><td>{isAr ? x.labelAr : x.labelEn}</td><td>{(PHASES.find((p) => p.key === x.phase) ?? { ar: x.phase, en: x.phase })[isAr ? 'ar' : 'en']}</td><td><b>{x.count}</b></td></tr>)}</tbody></table>
          </div>
          {s.timeline.length ? <div className="pf-box"><h3>{t('شهريًا', 'Monthly')}</h3>
            <table className="pf-table"><thead><tr><th>{t('الشهر', 'Month')}</th><th>{t('مُرسلة', 'Submitted')}</th><th>{t('مغلقة', 'Closed')}</th></tr></thead>
              <tbody>{s.timeline.map((m) => <tr key={m.month}><td>{m.month}</td><td>{m.submitted}</td><td>{m.closed}</td></tr>)}</tbody></table></div> : null}
        </>
      )}
    </div>
  );
};

export const AdminUsers: React.FC = () => {
  const { t, isAr, me } = usePlatform();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminUsers>> | null>(null);
  const [roles, setRoles] = useState<Array<{ key: string; ar: string; en: string }>>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nu, setNu] = useState({ email: '', nameAr: '', platformRole: 'ministry_viewer' });
  const load = useCallback(() => api.adminUsers({ q, page }).then(setD).catch((e) => setMsg({ ok: false, text: errText(e, isAr) })), [q, page, isAr]);
  useEffect(() => { void load(); api.adminModules().then((m) => setRoles(m.platformRoles)).catch(() => undefined); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setMsg(null); try { await fn(); setMsg({ ok: true, text: ok }); void load(); } catch (e) { setMsg({ ok: false, text: errText(e, isAr) }); } };
  const manage = canManage(me);
  return (
    <div className="pf-gap">
      <div className="pf-section-head"><h2>{t('الحسابات والصلاحيات', 'Accounts & roles')}</h2>
        <div className="pf-field" style={{ minWidth: 260 }}><input placeholder={t('بحث بالاسم أو البريد', 'Search by name or e-mail')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div></div>
      {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}
      {manage ? (
        <div className="pf-box"><h3>{t('إضافة صلاحية على المنصة', 'Grant a platform role')}</h3>
          <div className="pf-row">
            <div className="pf-field"><label>{t('البريد', 'E-mail')}</label><input dir="ltr" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} /></div>
            <div className="pf-field"><label>{t('الاسم', 'Name')}</label><input value={nu.nameAr} onChange={(e) => setNu({ ...nu, nameAr: e.target.value })} /></div>
            <div className="pf-field"><label>{t('الدور', 'Role')}</label><select value={nu.platformRole} onChange={(e) => setNu({ ...nu, platformRole: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{isAr ? r.ar : r.en}</option>)}</select></div>
          </div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => void act(() => api.adminCreateUser(nu), t('تم — أُرسل رابط تعيين كلمة المرور إن كان الحساب جديدًا.', 'Done — a set-password link was sent if the account is new.'))}>{t('إضافة', 'Add')}</button>
          <p className="pf-muted" style={{ fontSize: 12.5, marginTop: 8 }}>{t('أدوار المراجعين داخل كل مبادرة تُدار من شاشات المبادرة نفسها (بقواعد الموافقة الخاصة بها).', 'Reviewer roles inside each initiative are managed from that initiative\'s own screens (with its approval rules).')}</p>
        </div>
      ) : null}
      {!d ? <Loading /> : (
        <table className="pf-table">
          <thead><tr><th>{t('الحساب', 'Account')}</th><th>{t('دور المنصة', 'Platform role')}</th><th>{t('المبادرات', 'Initiatives')}</th><th>{t('الحالة', 'Status')}</th>{manage ? <th /> : null}</tr></thead>
          <tbody>{d.items.map((u: AdminUser) => (
            <tr key={u.id}>
              <td><b>{u.nameAr}</b><div className="pf-muted" dir="ltr" style={{ fontSize: 12.5 }}>{u.email}</div></td>
              <td>{u.platformRole ? (roles.find((r) => r.key === u.platformRole)?.[isAr ? 'ar' : 'en'] ?? u.platformRole) : '—'}</td>
              <td>{u.memberships.map((m) => (
                <div key={m.id} style={{ marginBottom: 4 }}>
                  <span className={`pf-chip ${m.status === 'active' ? '' : 'bad'}`}>{isAr ? m.titleAr : m.titleEn} — {isAr ? m.roleLabelAr : m.roleLabelEn}</span>
                  {manage ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => api.adminMembership(m.id, m.status === 'active' ? 'suspended' : 'active'), t('تم.', 'Done.'))}>{m.status === 'active' ? t('إيقاف', 'Suspend') : t('تفعيل', 'Activate')}</button> : null}
                </div>
              ))}</td>
              <td><span className={`pf-chip ${u.isActive ? 'ok' : 'bad'}`}>{u.isActive ? t('نشط', 'Active') : t('موقوف', 'Disabled')}</span>{!u.emailVerified ? <span className="pf-chip warn">{t('غير مفعّل', 'Unverified')}</span> : null}</td>
              {manage ? <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => api.adminResetPassword(u.id), t('أُرسل رابط إعادة التعيين.', 'Reset link sent.'))}>{t('إعادة تعيين كلمة المرور', 'Reset password')}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => api.adminUpdateUser(u.id, { isActive: !u.isActive }), t('تم.', 'Done.'))}>{u.isActive ? t('إيقاف الحساب', 'Disable') : t('تفعيل الحساب', 'Enable')}</button>
              </td> : null}
            </tr>
          ))}</tbody>
        </table>
      )}
      {d && d.totalPages > 1 ? <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button><span className="pf-muted">{page}/{d.totalPages}</span><button type="button" className="btn btn-ghost" disabled={page >= d.totalPages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button></div> : null}
    </div>
  );
};

const CATALOG_TEXT: Array<[string, string, string, 'text' | 'textarea']> = [
  ['titleAr', 'الاسم (عربي)', 'Title (Arabic)', 'text'], ['titleEn', 'الاسم (إنجليزي)', 'Title (English)', 'text'],
  ['taglineAr', 'الوصف المختصر (عربي)', 'Tagline (Arabic)', 'text'], ['taglineEn', 'الوصف المختصر (إنجليزي)', 'Tagline (English)', 'text'],
  ['descriptionAr', 'التعريف (عربي)', 'Description (Arabic)', 'textarea'], ['descriptionEn', 'التعريف (إنجليزي)', 'Description (English)', 'textarea'],
  ['category', 'التصنيف (عربي)', 'Category (Arabic)', 'text'], ['categoryEn', 'التصنيف (إنجليزي)', 'Category (English)', 'text'],
  ['badgeTextAr', 'شارة البطاقة (عربي)', 'Badge (Arabic)', 'text'], ['badgeTextEn', 'شارة البطاقة (إنجليزي)', 'Badge (English)', 'text'],
  ['coverImage', 'صورة الغلاف (رابط)', 'Cover image (URL)', 'text'], ['themeColor', 'اللون الأساسي', 'Main color', 'text'], ['accentColor', 'اللون الثانوي', 'Accent color', 'text'],
  ['startDate', 'تاريخ البداية', 'Start date', 'text'], ['endDate', 'تاريخ النهاية', 'End date', 'text'],
];
const CATALOG_LISTS: Array<[string, string, string]> = [
  ['objectives', 'الأهداف (سطر لكل بند)', 'Objectives (one per line)'], ['eligibilityRequirements', 'شروط الأهلية', 'Eligibility'],
  ['benefits', 'المزايا', 'Benefits'], ['selectionCriteria', 'معايير الاختيار', 'Selection criteria'], ['requiredDocsList', 'المستندات المطلوبة', 'Required documents'],
];

export const AdminCatalog: React.FC = () => {
  const { t, isAr, me } = usePlatform();
  const [items, setItems] = useState<Initiative[] | null>(null);
  const [edit, setEdit] = useState<(Initiative & Record<string, unknown>) | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api.adminCatalog().then((d) => setItems(d.items)).catch((e) => setMsg({ ok: false, text: errText(e, isAr) })), [isAr]);
  useEffect(() => { void load(); }, [load]);
  if (!canEditContent(me)) return <Forbidden />;
  if (!items) return <Loading />;
  const save = async () => {
    if (!edit) return;
    const body: Record<string, unknown> = { status: edit.status, registrationOpen: edit.registrationOpen, budgetTotalEGP: Number(edit.budgetTotalEGP) || 0, sortOrder: Number(edit.sortOrder) || 0 };
    for (const [k] of CATALOG_TEXT) body[k] = edit[k] ?? '';
    for (const [k] of CATALOG_LISTS) {
      const v = edit[k];
      body[k] = typeof v === 'string' ? v.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => ({ textAr: x, textEn: x })) : v;
    }
    try {
      if (edit.id) await api.adminSaveCatalog(edit.id, body); else await api.adminCreateCatalog({ ...body, slug: edit.slug });
      setEdit(null); setMsg({ ok: true, text: t('تم الحفظ.', 'Saved.') }); void load(); void store.loadInitiatives();
    } catch (e) { setMsg({ ok: false, text: errText(e, isAr) }); }
  };
  const listText = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x as Record<string, string>).textAr ?? (x as Record<string, string>).titleAr ?? '')).join('\n') : String(v ?? ''));
  return (
    <div className="pf-gap">
      <div className="pf-section-head"><h2>{t('محتوى المبادرات', 'Initiatives content')}</h2>
        <button type="button" className="btn btn-primary" onClick={() => setEdit({ id: '', slug: '', titleAr: '', status: 'draft', registrationOpen: false } as unknown as Initiative & Record<string, unknown>)}>{t('صفحة تعريفية جديدة', 'New information page')}</button></div>
      {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}
      {edit ? (
        <div className="pf-box pf-gap">
          <h3>{edit.id ? (isAr ? edit.titleAr : edit.titleEn) : t('مبادرة جديدة (صفحة تعريفية)', 'New initiative (information page)')}</h3>
          {!edit.id ? <div className="pf-field"><label>{t('الرابط المختصر (slug)', 'Slug')}</label><input dir="ltr" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></div> : null}
          <div className="pf-row">
            <div className="pf-field"><label>{t('الحالة', 'Status')}</label>
              <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{['active', 'coming_soon', 'closed', 'completed', 'draft', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="pf-field"><label>{t('التسجيل مفتوح', 'Registration open')}</label><select value={edit.registrationOpen ? '1' : '0'} onChange={(e) => setEdit({ ...edit, registrationOpen: e.target.value === '1' })}><option value="1">{t('نعم', 'Yes')}</option><option value="0">{t('لا', 'No')}</option></select></div>
            <div className="pf-field"><label>{t('الميزانية (جنيه)', 'Budget (EGP)')}</label><input dir="ltr" value={String(edit.budgetTotalEGP ?? 0)} onChange={(e) => setEdit({ ...edit, budgetTotalEGP: Number(e.target.value) || 0 })} /></div>
            <div className="pf-field"><label>{t('الترتيب', 'Order')}</label><input dir="ltr" value={String(edit.sortOrder ?? 0)} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) || 0 })} /></div>
          </div>
          <div className="pf-row">
            {CATALOG_TEXT.map(([k, ar, en, type]) => (
              <div key={k} className="pf-field" style={type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}><label>{isAr ? ar : en}</label>
                {type === 'textarea' ? <textarea value={String(edit[k] ?? '')} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /> : <input value={String(edit[k] ?? '')} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />}</div>
            ))}
            {CATALOG_LISTS.map(([k, ar, en]) => (
              <div key={k} className="pf-field" style={{ gridColumn: '1 / -1' }}><label>{isAr ? ar : en}</label><textarea value={typeof edit[k] === 'string' ? String(edit[k]) : listText(edit[k])} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn btn-primary" onClick={() => void save()}>{t('حفظ', 'Save')}</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>{t('إلغاء', 'Cancel')}</button></div>
        </div>
      ) : (
        <table className="pf-table">
          <thead><tr><th>{t('المبادرة', 'Initiative')}</th><th>{t('النوع', 'Type')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.id}><td><b>{isAr ? i.titleAr : i.titleEn}</b><div className="pf-muted" dir="ltr" style={{ fontSize: 12 }}>{i.slug}</div></td>
              <td>{i.moduleId ? <span className="pf-chip info">{t('نظام مبادرة مبرمج', 'Coded initiative module')}</span> : <span className="pf-chip">{t('صفحة تعريفية', 'Information page')}</span>}</td>
              <td>{i.status}{i.registrationOpen ? '' : ` · ${t('التسجيل مغلق', 'registration closed')}`}</td>
              <td><button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit({ ...(i as Initiative & Record<string, unknown>) })}>{t('تعديل', 'Edit')}</button></td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
};

export const AdminBanners: React.FC = () => {
  const { t, isAr, me, initiatives } = usePlatform();
  const [items, setItems] = useState<Banner[] | null>(null);
  const [edit, setEdit] = useState<Partial<Banner> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api.adminBanners().then(setItems).catch((e) => setMsg({ ok: false, text: errText(e, isAr) })), [isAr]);
  useEffect(() => { void load(); }, [load]);
  if (!canEditContent(me)) return <Forbidden />;
  if (!items) return <Loading />;
  const onImage = (file?: File) => { if (!file) return; const r = new FileReader(); r.onload = () => setEdit({ ...edit, imageUrl: String(r.result) }); r.readAsDataURL(file); };
  const save = async () => {
    if (!edit) return;
    const { id, ...rest } = edit;
    try { await api.adminSaveBanner(id ?? null, rest as Record<string, unknown>); setEdit(null); void load(); setMsg({ ok: true, text: t('تم الحفظ.', 'Saved.') }); } catch (e) { setMsg({ ok: false, text: errText(e, isAr) }); }
  };
  return (
    <div className="pf-gap">
      <div className="pf-section-head"><h2>{t('بانرات الصفحة الرئيسية', 'Home banners')}</h2><button type="button" className="btn btn-primary" onClick={() => setEdit({ linkType: 'none', active: true })}>{t('بانر جديد', 'New banner')}</button></div>
      {msg ? <Alert tone={msg.ok ? 'ok' : 'err'}>{msg.text}</Alert> : null}
      {edit ? (
        <div className="pf-box pf-gap">
          <div className="pf-row">
            <div className="pf-field"><label>{t('العنوان (عربي)', 'Title (Arabic)')}</label><input value={edit.titleAr ?? ''} onChange={(e) => setEdit({ ...edit, titleAr: e.target.value })} /></div>
            <div className="pf-field"><label>{t('العنوان (إنجليزي)', 'Title (English)')}</label><input value={edit.titleEn ?? ''} onChange={(e) => setEdit({ ...edit, titleEn: e.target.value })} /></div>
            <div className="pf-field"><label>{t('النص (عربي)', 'Text (Arabic)')}</label><input value={edit.subtitleAr ?? ''} onChange={(e) => setEdit({ ...edit, subtitleAr: e.target.value })} /></div>
            <div className="pf-field"><label>{t('النص (إنجليزي)', 'Text (English)')}</label><input value={edit.subtitleEn ?? ''} onChange={(e) => setEdit({ ...edit, subtitleEn: e.target.value })} /></div>
            <div className="pf-field"><label>{t('الرابط', 'Link')}</label>
              <select value={edit.linkType} onChange={(e) => setEdit({ ...edit, linkType: e.target.value as Banner['linkType'], linkTarget: '' })}><option value="none">{t('بلا رابط', 'None')}</option><option value="initiative">{t('مبادرة', 'Initiative')}</option><option value="url">URL</option></select></div>
            {edit.linkType === 'initiative' ? <div className="pf-field"><label>{t('المبادرة', 'Initiative')}</label><select value={edit.linkTarget ?? ''} onChange={(e) => setEdit({ ...edit, linkTarget: e.target.value })}><option value="" />{(initiatives ?? []).map((i) => <option key={i.id} value={i.slug}>{i.titleAr}</option>)}</select></div>
              : edit.linkType === 'url' ? <div className="pf-field"><label>URL</label><input dir="ltr" value={edit.linkTarget ?? ''} onChange={(e) => setEdit({ ...edit, linkTarget: e.target.value })} /></div> : null}
            <div className="pf-field"><label>{t('الصورة', 'Image')}</label><input type="file" accept="image/*" onChange={(e) => onImage(e.target.files?.[0])} /></div>
            <div className="pf-field"><label>{t('ظاهر', 'Visible')}</label><select value={edit.active ? '1' : '0'} onChange={(e) => setEdit({ ...edit, active: e.target.value === '1' })}><option value="1">{t('نعم', 'Yes')}</option><option value="0">{t('لا', 'No')}</option></select></div>
          </div>
          {edit.imageUrl ? <img src={edit.imageUrl} alt="" style={{ maxHeight: 140, borderRadius: 10, objectFit: 'cover' }} /> : null}
          <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn btn-primary" onClick={() => void save()}>{t('حفظ', 'Save')}</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>{t('إلغاء', 'Cancel')}</button></div>
        </div>
      ) : null}
      <div className="pf-grid">{items.map((b) => (
        <div key={b.id} className="pf-card">
          <div className="pf-card-cover" style={{ backgroundImage: `url(${b.imageUrl})` }} />
          <div className="pf-card-body"><b>{isAr ? b.titleAr : b.titleEn}</b><span className={`pf-chip ${b.active ? 'ok' : ''}`}>{b.active ? t('ظاهر', 'Visible') : t('مخفي', 'Hidden')}</span>
            <div className="pf-card-foot"><button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(b)}>{t('تعديل', 'Edit')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.adminDeleteBanner(b.id).then(load)}>{t('حذف', 'Delete')}</button></div></div>
        </div>
      ))}</div>
    </div>
  );
};

const INITIATIVE_FILTER = (t: (a: string, e: string) => string) => [
  { v: '', l: t('الكل', 'All') }, { v: 'core', l: t('المنصة', 'Platform') }, { v: 'shams', l: t('شمس الصناعة', 'Shams El-Senaa') }, { v: 'sona3', l: t('صُنّاع المستقبل', 'Future Makers') },
];

export const AdminAudit: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [f, setF] = useState({ initiativeId: '', q: '', page: 1 });
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminAudit>> | null>(null);
  useEffect(() => { api.adminAudit(f).then(setD).catch(() => undefined); }, [f]);
  const exportCsv = async () => { const b = await api.adminAuditExport(f.initiativeId || undefined); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'audit-logs.csv'; a.click(); };
  return (
    <div className="pf-gap">
      <div className="pf-section-head"><h2>{t('سجل التدقيق', 'Audit log')}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="pf-field"><label>{t('المبادرة', 'Initiative')}</label><select value={f.initiativeId} onChange={(e) => setF({ ...f, initiativeId: e.target.value, page: 1 })}>{INITIATIVE_FILTER(t).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
          <div className="pf-field"><label>{t('بحث', 'Search')}</label><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /></div>
          <button type="button" className="btn btn-outline" onClick={() => void exportCsv()}><Download size={15} /> CSV</button>
        </div></div>
      {!d ? <Loading /> : (
        <table className="pf-table"><thead><tr><th>{t('الوقت', 'Time')}</th><th>{t('المبادرة', 'Initiative')}</th><th>{t('الفاعل', 'Actor')}</th><th>{t('الحدث', 'Event')}</th></tr></thead>
          <tbody>{d.items.map((r) => <tr key={r.id}><td className="pf-muted" style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}</td><td>{r.initiativeId ?? t('المنصة', 'Platform')}</td><td>{r.actorName || '—'}<div className="pf-muted" style={{ fontSize: 12 }}>{r.actorRole}</div></td><td><b>{r.summaryAr || r.action}</b><div className="pf-muted" dir="ltr" style={{ fontSize: 12 }}>{r.action}</div></td></tr>)}</tbody></table>
      )}
      {d && d.totalPages > 1 ? <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn btn-ghost" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>{t('السابق', 'Previous')}</button><span className="pf-muted">{f.page}/{d.totalPages}</span><button type="button" className="btn btn-ghost" disabled={f.page >= d.totalPages} onClick={() => setF({ ...f, page: f.page + 1 })}>{t('التالي', 'Next')}</button></div> : null}
    </div>
  );
};

export const AdminOutbox: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [f, setF] = useState({ initiativeId: '', status: '', page: 1 });
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminOutbox>> | null>(null);
  const load = useCallback(() => api.adminOutbox({ ...f, initiativeId: f.initiativeId === 'core' ? undefined : f.initiativeId }).then(setD).catch(() => undefined), [f]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="pf-gap">
      <div className="pf-section-head"><h2>{t('سجل الرسائل (بريد / SMS)', 'Messages log (e-mail / SMS)')}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div className="pf-field"><label>{t('المبادرة', 'Initiative')}</label><select value={f.initiativeId} onChange={(e) => setF({ ...f, initiativeId: e.target.value, page: 1 })}>{INITIATIVE_FILTER(t).filter((o) => o.v !== 'core').map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></div>
          <div className="pf-field"><label>{t('الحالة', 'Status')}</label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>{['', 'pending', 'sent', 'failed', 'skipped'].map((s) => <option key={s} value={s}>{s || t('الكل', 'All')}</option>)}</select></div>
        </div></div>
      {!d ? <Loading /> : (
        <table className="pf-table"><thead><tr><th>{t('الوقت', 'Time')}</th><th>{t('المبادرة', 'Initiative')}</th><th>{t('المستلم', 'Recipient')}</th><th>{t('الموضوع', 'Subject')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
          <tbody>{d.items.map((n) => <tr key={n.id}><td className="pf-muted" style={{ whiteSpace: 'nowrap' }}>{new Date(n.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}</td><td>{n.initiativeId ?? t('المنصة', 'Platform')}</td><td dir="ltr">{n.recipientAddress}</td><td>{n.subject || n.templateKey}</td>
            <td><span className={`pf-chip ${n.status === 'sent' ? 'ok' : n.status === 'failed' ? 'bad' : n.status === 'skipped' ? 'warn' : ''}`}>{n.status}</span>{n.skipReason ? <div className="pf-muted" style={{ fontSize: 12 }}>{n.skipReason}</div> : null}</td>
            <td>{['failed', 'skipped'].includes(n.status) ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.adminRetry(n.id).then(load)}>{t('إعادة المحاولة', 'Retry')}</button> : null}</td></tr>)}</tbody></table>
      )}
      {d && d.totalPages > 1 ? <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn btn-ghost" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>{t('السابق', 'Previous')}</button><span className="pf-muted">{f.page}/{d.totalPages}</span><button type="button" className="btn btn-ghost" disabled={f.page >= d.totalPages} onClick={() => setF({ ...f, page: f.page + 1 })}>{t('التالي', 'Next')}</button></div> : null}
    </div>
  );
};

export const AdminReadiness: React.FC = () => {
  const { t, isAr } = usePlatform();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminReadiness>> | null>(null);
  useEffect(() => { api.adminReadiness().then(setD).catch(() => undefined); }, []);
  if (!d) return <Loading />;
  const Row: React.FC<{ c: { ok: boolean; labelAr: string; labelEn: string; detail?: string } }> = ({ c }) => (
    <tr><td style={{ width: 40 }}>{c.ok ? '✅' : '⚠️'}</td><td><b>{isAr ? c.labelAr : c.labelEn}</b>{c.detail ? <div className="pf-muted" style={{ fontSize: 12.5 }}>{c.detail}</div> : null}</td></tr>
  );
  return (
    <div className="pf-gap">
      <div className="pf-section-head"><h2>{t('جاهزية التشغيل', 'Operational readiness')}</h2></div>
      <div className="pf-box"><h3>{t('المنصة', 'Platform')}</h3><table className="pf-table"><tbody>{d.core.map((c) => <Row key={c.key} c={c} />)}</tbody></table></div>
      {d.modules.map((m) => <div key={m.initiativeId} className="pf-box"><h3>{isAr ? m.titleAr : m.titleEn}</h3><table className="pf-table"><tbody>{m.checks.map((c) => <Row key={c.key} c={c} />)}</tbody></table></div>)}
    </div>
  );
};
