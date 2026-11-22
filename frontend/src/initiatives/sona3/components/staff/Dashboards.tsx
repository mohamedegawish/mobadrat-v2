/* eslint-disable @typescript-eslint/no-explicit-any */
// لوحات الجهات: قائمة العمل (مؤشرات + مراحل + بحث + تصدير) ولوحة المتابعة وقياس الأثر (قمع الرحلة والتمويل والوظائف).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { Loading, ErrorState, Empty } from '../common/StateViews';
import { useToast } from '../common/ToastSystem';
import { Pill, money } from '../common/FormKit';

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { isAr } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { fn().then((d) => { setData(d); setError(''); }).catch((e) => setError(errorText(e, isAr))); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  return { data, error, load };
}

const fmt = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
const pct = (a: number, b: number) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'blue' | 'orange' | 'green' | 'red'; onClick?: () => void }> = ({ label, value, hint, tone = 'blue', onClick }) => (
  <button type="button" className={`stat-card tone-${tone}`} onClick={onClick} disabled={!onClick}>
    <span className="stat-label">{label}</span><b>{value}</b>{hint ? <small>{hint}</small> : null}
  </button>
);

const Bar: React.FC<{ label: string; value: number; max: number; right?: string; tone?: string }> = ({ label, value, max, right, tone = 'blue' }) => (
  <div className="hbar">
    <div className="hbar-head"><span>{label}</span><b>{right ?? fmt(value)}</b></div>
    <div className="hbar-track"><div className={`hbar-fill ${tone}`} style={{ width: `${pct(value, max)}%` }} /></div>
  </div>
);

/** تصدير الجدول الحالي CSV (UTF-8 مع BOM ليفتح بالعربية في Excel). */
function downloadCsv(name: string, headers: string[], rows: Array<Array<string | number | null>>) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

const GROUPS: Array<{ key: string; ar: string; en: string; states: string[] }> = [
  { key: 'all', ar: 'الكل', en: 'All', states: [] },
  { key: 'review', ar: 'مراجعة', en: 'Review', states: ['ELIGIBILITY_REVIEW', 'STUDY_REVIEW'] },
  { key: 'wait', ar: 'بانتظار المتقدم', en: 'With applicant', states: ['ELIGIBILITY_CORRECTION', 'STUDY_PREPARATION', 'STUDY_CORRECTION'] },
  { key: 'eval', ar: 'التقييم والاختيار', en: 'Evaluation', states: ['COMMITTEE_EVALUATION', 'EVALUATED', 'SELECTED'] },
  { key: 'fund', ar: 'التمويل', en: 'Funding', states: ['FUNDING_SEARCH', 'FUNDER_REVIEW'] },
  { key: 'run', ar: 'التنفيذ والتشغيل', en: 'Delivery', states: ['IMPLEMENTATION', 'OPERATING'] },
  { key: 'done', ar: 'منتهية', en: 'Closed', states: ['REJECTED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED', 'COMPLETED', 'WITHDRAWN'] },
];

export const WorkQueueDashboard: React.FC = () => {
  const { t, isAr, user } = useStore();
  const toast = useToast();
  const isImc = user?.role === 'imc_officer';
  const [group, setGroup] = useState('all');
  const [mine, setMine] = useState(isImc || user?.role === 'funder_reviewer');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const sum = useLoad(() => api.reportSummary() as Promise<any>);
  const states = GROUPS.find((g) => g.key === group)?.states ?? [];
  const list = useLoad(() => api.listApplications({ page, pageSize: 25, q: q || undefined, state: states.length ? states.join(',') : undefined, ...(mine ? { mine: '1' as const } : {}) }), [group, mine, q, page]);
  useEffect(() => { setPage(1); }, [group, mine, q]);
  const s: any = sum.data;
  const count = (g: typeof GROUPS[number]) => (s ? (g.states.length ? g.states.reduce((a, k) => a + (s.byState?.[k] ?? 0), 0) : Object.values(s.byState ?? {}).reduce((a: number, b: any) => a + b, 0) - (s.byState?.DRAFT ?? 0)) : null);
  const exportCsv = async () => {
    try { const r: any = await api.reportApplications(); downloadCsv(`sona3-applications-${new Date().toISOString().slice(0, 10)}.csv`, r.sheet.headers, r.sheet.rows); } catch (e) { toast.toast('error', errorText(e, isAr)); }
  };
  return (
    <div className="container-custom page">
      <div className="page-head">
        <div><h1>{t('قائمة العمل', 'Work queue')}</h1><p className="lead">{isImc ? t('الطلبات التي تنتظر قرارك الآن، وكل ما يمر على المبادرة.', 'What is waiting for your decision, and everything in the initiative.') : t('الملفات المحالة إليك.', 'Files referred to you.')}</p></div>
        {isImc || user?.role === 'system_admin' ? <button className="btn btn-secondary" onClick={exportCsv}>{t('تصدير إلى Excel (CSV)', 'Export to Excel (CSV)')}</button> : null}
      </div>
      {s ? (
        <div className="stat-grid">
          <Stat label={t('طلبات مفتوحة', 'Open')} value={fmt(s.open)} onClick={() => { setGroup('all'); setMine(false); }} />
          <Stat label={t('تنتظر قراري', 'Waiting for me')} tone="orange" value={list.data && mine ? fmt(list.data.total) : '—'} hint={t('حسب الدور', 'by role')} onClick={() => setMine(true)} />
          <Stat label={t('مختارة / المستهدف', 'Selected / target')} tone="green" value={`${fmt(s.kpis?.selected)}/${fmt(s.kpis?.selectionTarget)}`} onClick={isImc ? () => store.navigate('ranking') : undefined} />
          {s.slaConfigured ? <Stat label={t('متأخرة', 'Overdue')} tone="red" value={fmt(s.overdue)} /> : <Stat label={t('مسودات لم تُرسل', 'Unsent drafts')} value={fmt(s.drafts)} />}
        </div>
      ) : null}
      <div className="chips" role="tablist">
        {GROUPS.map((g) => <button key={g.key} role="tab" aria-selected={group === g.key} className={`chip${group === g.key ? ' on' : ''}`} onClick={() => setGroup(g.key)}>{isAr ? g.ar : g.en}{s ? <span>{fmt(count(g))}</span> : null}</button>)}
      </div>
      <div className="toolbar">
        <div className="seg">
          <button className={mine ? 'on' : ''} onClick={() => setMine(true)}>{t('بانتظار قراري', 'Waiting for me')}</button>
          <button className={!mine ? 'on' : ''} onClick={() => setMine(false)}>{t('كل الطلبات', 'All')}</button>
        </div>
        <input className="input search" placeholder={t('ابحث برقم الطلب أو اسم المشروع أو المتقدم', 'Search by number, project or applicant')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.error ? <ErrorState message={list.error} onRetry={list.load} /> : !list.data ? <Loading variant="table" /> : !list.data.items.length ? (
        <Empty title={mine ? t('لا شيء ينتظر قرارك', 'Nothing is waiting for you') : t('لا توجد طلبات مطابقة', 'No matching applications')} hint={mine ? t('اضغط «كل الطلبات» لرؤية الجميع.', 'Switch to “All” to see everything.') : undefined} />
      ) : (
        <>
          <div className="tbl-wrap card"><table className="tbl">
            <thead><tr><th>{t('الطلب', 'Application')}</th><th>{t('القطاع', 'Sector')}</th><th>{t('التمويل المطلوب', 'Requested')}</th><th>{t('الدرجة', 'Score')}</th><th>{t('المرحلة', 'Stage')}</th><th>{t('في المرحلة', 'In stage')}</th></tr></thead>
            <tbody>{list.data.items.map((a: any) => (
              <tr key={a.id} className="clickable" onClick={() => store.navigate('application', a.id)}>
                <td><b>{a.projectName || t('بدون اسم', 'Untitled')}</b><div className="hint">{a.number ?? t('مسودة', 'Draft')} · {a.applicantName}</div></td>
                <td>{isAr ? a.sectorLabelAr : a.sectorLabelEn}</td>
                <td className="num">{money(a.requestedFunding)}</td>
                <td className="num">{a.score ?? '—'}{a.passedMinimums === false ? <Pill kind="bad">{t('دون الحد', 'below min')}</Pill> : null}</td>
                <td><Pill kind={a.overdue ? 'bad' : 'blue'}>{isAr ? a.stateLabelAr : a.stateLabelEn}</Pill>{a.isStalled ? <Pill kind="bad">{t('متعثر', 'stalled')}</Pill> : null}</td>
                <td className="num">{a.daysInState} {t('يوم', 'd')}</td>
              </tr>))}</tbody></table></div>
          <div className="pager"><span>{t(`${list.data.total} طلب`, `${list.data.total} applications`)}</span>
            <div className="row-gap"><button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Prev')}</button>
              <span className="num">{page} / {list.data.totalPages}</span>
              <button className="btn btn-secondary" disabled={page >= list.data.totalPages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button></div></div>
        </>
      )}
    </div>
  );
};

const FUNNEL: Array<{ key: string; ar: string; en: string }> = [
  { key: 'applications', ar: 'طلبات مُرسلة', en: 'Submitted' }, { key: 'eligible', ar: 'مستوفية للأهلية', en: 'Eligible' },
  { key: 'studyCompleted', ar: 'أكملت دراسة الجدوى', en: 'Study completed' }, { key: 'evaluated', ar: 'تم تقييمها', en: 'Evaluated' },
  { key: 'selected', ar: 'مختارة', en: 'Selected' }, { key: 'approved', ar: 'معتمدة', en: 'Approved' },
  { key: 'funded', ar: 'ممولة', en: 'Funded' }, { key: 'operating', ar: 'في التشغيل', en: 'Operating' },
];

export const MonitoringDashboard: React.FC = () => {
  const { t, isAr } = useStore();
  const [cohort, setCohort] = useState('');
  const { data, error, load } = useLoad(() => api.reportSummary(cohort ? { cohortId: cohort } : undefined) as Promise<any>, [cohort]);
  const s: any = data;
  const maxFunnel = useMemo(() => Math.max(1, ...(s ? FUNNEL.map((f) => Number(s.kpis?.[f.key] ?? 0)) : [1])), [s]);
  if (error) return <div className="container-custom page"><ErrorState message={error} onRetry={load} /></div>;
  if (!s) return <div className="container-custom page"><Loading /></div>;
  const maxSector = Math.max(1, ...s.bySector.map((x: any) => x.count));
  const maxGov = Math.max(1, ...s.byGovernorate.map((x: any) => x.count));
  const f = s.funding ?? {};
  const days = Object.entries(s.avgDaysPerState ?? {}).filter(([k]) => s.stateLabels?.[k]) as Array<[string, any]>;
  return (
    <div className="container-custom page">
      <div className="page-head">
        <div><h1>{t('المتابعة وقياس الأثر', 'Monitoring & impact')}</h1><p className="lead">{t('من التقديم إلى التشغيل: أين المشروعات، وكم صُرف، وما الأثر على التوظيف.', 'From application to operation: where projects are, what was disbursed and the jobs impact.')}</p></div>
        {s.cohorts?.length > 1 ? <select className="input" style={{ maxWidth: 240 }} value={cohort} onChange={(e) => setCohort(e.target.value)}><option value="">{t('كل الدورات', 'All cohorts')}</option>{s.cohorts.map((c: any) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}</select> : null}
      </div>
      <div className="stat-grid">
        <Stat label={t('متقدمون', 'Applicants')} value={fmt(s.kpis.applicants)} />
        <Stat label={t('مختارة من المستهدف', 'Selected of target')} tone="green" value={`${fmt(s.kpis.selected)}/${fmt(s.kpis.selectionTarget)}`} />
        <Stat label={t('في التنفيذ والتشغيل', 'In delivery')} tone="orange" value={fmt((s.kpis.inImplementation ?? 0) + (s.kpis.operating ?? 0))} />
        {s.averageScore ? <Stat label={t('متوسط الدرجات', 'Average score')} value={s.averageScore.value ?? '—'} hint={t(`${s.averageScore.scored} مشروع`, `${s.averageScore.scored} projects`)} /> : <Stat label={t('طلبات مفتوحة', 'Open')} value={fmt(s.open)} />}
      </div>
      <div className="two-col">
        <section className="card sec"><h2>{t('قمع الرحلة', 'Journey funnel')}</h2>
          {FUNNEL.map((x, i) => <Bar key={x.key} label={`${i + 1}. ${isAr ? x.ar : x.en}`} value={Number(s.kpis[x.key] ?? 0)} max={maxFunnel} tone={i < 4 ? 'blue' : 'orange'} />)}
        </section>
        <section className="card sec"><h2>{t('التمويل', 'Funding')}</h2>
          <Bar label={t('المطلوب من المتقدمين', 'Requested')} value={f.requested} max={Math.max(1, f.requested)} right={money(f.requested)} />
          <Bar label={t('المعتمد من جهات التمويل', 'Approved by funders')} value={f.approved} max={Math.max(1, f.requested)} right={money(f.approved)} tone="orange" />
          <Bar label={t('المصروف فعليًا', 'Disbursed')} value={f.disbursed} max={Math.max(1, f.approved || f.requested)} right={money(f.disbursed)} tone="green" />
          <h2 style={{ marginTop: '1.4rem' }}>{t('فرص العمل', 'Jobs')}</h2>
          <Bar label={t('المتوقعة في الدراسات', 'Expected in studies')} value={s.jobs.expected} max={Math.max(1, s.jobs.expected)} />
          <Bar label={t('الفعلية في تقارير الأثر', 'Actual in impact reports')} value={s.jobs.actual} max={Math.max(1, s.jobs.expected)} tone="green" />
        </section>
      </div>
      <div className="two-col">
        <section className="card sec"><h2>{t('حسب القطاع', 'By sector')}</h2>
          {s.bySector.length ? s.bySector.map((x: any) => <Bar key={x.sector} label={x.label ? (isAr ? x.label.labelAr : x.label.labelEn) : x.sector} value={x.count} max={maxSector} />) : <p className="hint">{t('لا بيانات بعد.', 'No data yet.')}</p>}
        </section>
        <section className="card sec"><h2>{t('حسب المحافظة', 'By governorate')}</h2>
          {s.byGovernorate.length ? s.byGovernorate.slice(0, 8).map((x: any) => <Bar key={x.governorate} label={x.label} value={x.count} max={maxGov} />) : <p className="hint">{t('لا بيانات بعد.', 'No data yet.')}</p>}
        </section>
      </div>
      {days.length ? (
        <section className="card sec"><h2>{t('متوسط البقاء في كل مرحلة', 'Average time per stage')}</h2>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>{t('المرحلة', 'Stage')}</th><th>{t('متوسط الأيام', 'Avg days')}</th><th>{t('عينات', 'Samples')}</th></tr></thead>
            <tbody>{days.map(([k, v]) => <tr key={k}><td>{isAr ? s.stateLabels[k].ar : s.stateLabels[k].en}</td><td className="num">{v.avgDays}</td><td className="num">{v.samples}</td></tr>)}</tbody></table></div></section>
      ) : null}
    </div>
  );
};
