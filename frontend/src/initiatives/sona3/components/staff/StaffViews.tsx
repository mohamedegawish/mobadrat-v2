/* eslint-disable @typescript-eslint/no-explicit-any */
// شاشات الجهات: قائمة العمل، تفاصيل الطلب (IMC / المقيّم / جهة التمويل)، الترتيب، تقييماتي، الخبراء، المتابعة.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { apiFetch } from '../../api/client';
import { errorText, store, useStore } from '../../store/state';
import type { ApplicationDetail } from '../../api/schemas';
import { Loading, ErrorState, Empty } from '../common/StateViews';
import { useToast } from '../common/ToastSystem';
import { ActionPanel, DataSummary, DocsList, History, Pill, Totals, money } from '../common/FormKit';
import { Journey } from '../applicant/ApplicantViews';

function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const { isAr } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { fn().then((d) => { setData(d); setError(''); }).catch((e) => setError(errorText(e, isAr))); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  return { data, setData, error, load };
}

const Wrap: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <div className="container-custom page"><h1>{title}</h1>{children}</div>;

const AppRow: React.FC<{ a: any }> = ({ a }) => {
  const { isAr } = useStore();
  return (
    <tr className="clickable" onClick={() => store.navigate('application', a.id)}>
      <td>{a.rank ?? ''}</td><td>{a.number ?? '—'}</td><td>{a.projectName}<div className="hint">{a.applicantName}</div></td>
      <td>{isAr ? a.sectorLabelAr : a.sectorLabelEn}</td><td>{money(a.requestedFunding)}</td>
      <td>{a.score ?? '—'}{a.passedMinimums === false ? ' ⚠' : ''}</td>
      <td><Pill kind={a.overdue ? 'bad' : 'blue'}>{isAr ? a.stateLabelAr : a.stateLabelEn}</Pill>{a.isStalled ? <Pill kind="bad">!</Pill> : null}</td>
    </tr>
  );
};

const AppTable: React.FC<{ items: any[] }> = ({ items }) => {
  const { t } = useStore();
  if (!items.length) return <Empty title={t('لا توجد طلبات', 'No applications')} />;
  return (
    <div className="tbl-wrap"><table className="tbl"><thead><tr><th>#</th><th>{t('الرقم', 'No.')}</th><th>{t('المشروع', 'Project')}</th><th>{t('القطاع', 'Sector')}</th><th>{t('التمويل المطلوب', 'Requested')}</th><th>{t('الدرجة', 'Score')}</th><th>{t('الحالة', 'State')}</th></tr></thead>
      <tbody>{items.map((a) => <AppRow key={a.id} a={a} />)}</tbody></table></div>
  );
};

export const WorkQueueView: React.FC = () => {
  const { t, isAr, user } = useStore();
  const [mine, setMine] = useState(user?.role !== 'system_admin');
  const [q, setQ] = useState('');
  const { data, error, load } = useLoad(() => api.listApplications({ pageSize: 100, q: q || undefined, ...(mine ? { mine: '1' as const } : {}) }), [mine, q]);
  return (
    <Wrap title={t('قائمة العمل', 'Work queue')}>
      <div className="row-gap wrap">
        <button className={`btn ${mine ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMine(true)}>{t('بانتظار قراري', 'Awaiting me')}</button>
        <button className={`btn ${!mine ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMine(false)}>{t('كل الطلبات', 'All')}</button>
        <input className="input" style={{ maxWidth: 260 }} placeholder={t('بحث بالرقم أو اسم المشروع', 'Search')} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading variant="table" /> : <AppTable items={data.items} />}
      <span hidden>{isAr}</span>
    </Wrap>
  );
};

// ── تقييم المقيّم ──
const EvaluatorBlock: React.FC<{ app: ApplicationDetail; ev: any; onDone: (a: ApplicationDetail) => void }> = ({ app, ev, onDone }) => {
  const { t, isAr } = useStore();
  const toast = useToast();
  const mine = ev.mine;
  const [scores, setScores] = useState<any>(mine?.scores ?? {});
  const [notes, setNotes] = useState<any>(mine?.notes ?? {});
  const [rec, setRec] = useState<string>(mine?.recommendation ?? '');
  const [coiNote, setCoiNote] = useState('');
  const run = async (fn: () => Promise<ApplicationDetail>) => { try { onDone(await fn()); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  if (!mine) return null;
  if (mine.status === 'assigned') {
    return (
      <div className="card sec"><h3>{t('إقرار عدم تضارب المصالح', 'Conflict-of-interest declaration')}</h3>
        <p>{t('لا تظهر لك بيانات المشروع قبل الإقرار.', 'Project data is hidden until you declare.')}</p>
        <textarea className="input" placeholder={t('ملاحظة (إجبارية عند وجود تضارب)', 'Note (required if conflict)')} value={coiNote} onChange={(e) => setCoiNote(e.target.value)} />
        <div className="row-gap"><button className="btn btn-primary" onClick={() => run(() => api.declareConflict(app.id, { hasConflict: false }))}>{t('أقر بعدم وجود تضارب', 'No conflict')}</button>
          <button className="btn btn-danger" onClick={() => run(() => api.declareConflict(app.id, { hasConflict: true, note: coiNote }))}>{t('يوجد تضارب — استبعادي', 'Conflict — exclude me')}</button></div></div>
    );
  }
  if (mine.status === 'conflict') return <div className="card sec warn">{t('استُبعدت من تقييم هذا المشروع لتضارب المصالح.', 'You were excluded for a conflict of interest.')}</div>;
  const done = mine.status === 'submitted';
  const total = ev.criteria.reduce((s: number, c: any) => s + (c.weight ?? 0), 0) || 1;
  const live = Math.round(ev.criteria.reduce((s: number, c: any) => s + (Number(scores[c.key]) || 0) * (c.weight ?? 0), 0) / total * 100) / 100;
  const body = { scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])), notes, recommendation: rec };
  return (
    <div className="card sec"><h3>{t('تقييمي', 'My evaluation')} {done ? <Pill kind="ok">{t('سُلّم', 'Submitted')}</Pill> : null}</h3>
      {ev.criteria.map((c: any) => (
        <div key={c.key} className="fld"><label>{isAr ? c.labelAr : c.labelEn} <small>({t('الوزن', 'weight')} {c.weight})</small></label><div className="hint">{isAr ? c.hintAr : c.hintEn}</div>
          <div className="row-gap"><input className="input" style={{ maxWidth: 90 }} type="number" min={0} max={100} disabled={done} dir="ltr" value={scores[c.key] ?? ''} onChange={(e) => setScores({ ...scores, [c.key]: e.target.value })} />
            <input className="input" placeholder={t('ملاحظة', 'Note')} disabled={done} value={notes[c.key] ?? ''} onChange={(e) => setNotes({ ...notes, [c.key]: e.target.value })} /></div></div>
      ))}
      <div className="fld"><label>{t('التوصية', 'Recommendation')}</label>
        <select className="input" disabled={done} value={rec} onChange={(e) => setRec(e.target.value)}><option value="">—</option>{(ev.recommendations ?? []).map((r: any) => <option key={r.value} value={r.value}>{isAr ? r.labelAr : r.labelEn}</option>)}</select></div>
      <p>{t('الدرجة الموزونة:', 'Weighted score:')} <b>{done ? mine.weightedScore : live}</b></p>
      {!done && ev.canScore ? <div className="row-gap"><button className="btn btn-secondary" onClick={() => run(() => api.saveEvaluation(app.id, body))}>{t('حفظ مسودة', 'Save draft')}</button>
        <button className="btn btn-primary" onClick={() => run(() => api.submitEvaluation(app.id, body))}>{t('تسليم التقييم', 'Submit')}</button></div> : null}
    </div>
  );
};

// ── كتلة IMC: المقيّمون والنتائج ──
const ImcEvaluation: React.FC<{ app: ApplicationDetail; ev: any; onDone: (a: ApplicationDetail) => void }> = ({ app, ev, onDone }) => {
  const { t, isAr } = useStore();
  const toast = useToast();
  const [pool, setPool] = useState<any[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { if (ev.canAssign) api.listEvaluators().then(setPool).catch(() => undefined); }, [ev.canAssign]);
  const run = async (fn: () => Promise<ApplicationDetail>) => { try { onDone(await fn()); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  return (
    <div className="card sec"><h3>{t('لجنة التقييم', 'Evaluation committee')}</h3>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>{t('المقيّم', 'Evaluator')}</th><th>{t('الحالة', 'Status')}</th><th>{t('الدرجة', 'Score')}</th><th>{t('التوصية', 'Rec.')}</th><th /></tr></thead>
        <tbody>{ev.assignments.map((a: any) => (
          <tr key={a.id}><td>{a.evaluatorName}</td><td>{isAr ? a.statusLabelAr : a.statusLabelEn}{a.coiNote ? <div className="hint">{a.coiNote}</div> : null}</td><td>{a.weightedScore ?? '—'}</td><td>{a.recommendation ?? ''}</td>
            <td>{ev.canAssign && a.status !== 'submitted' ? <button className="btn btn-ghost" onClick={() => run(() => api.unassignEvaluator(app.id, a.id, {}))}>✕</button> : null}</td></tr>
        ))}</tbody></table></div>
      {ev.aggregate?.score != null ? (
        <p>{t('متوسط الدرجة:', 'Average:')} <b>{ev.aggregate.score}</b> ({ev.aggregate.evaluators} {t('مقيّم', 'evaluators')}) — {ev.criteria.map((c: any) => `${isAr ? c.labelAr : c.labelEn}: ${ev.aggregate.perCriterion[c.key] ?? '—'}`).join(' · ')}</p>
      ) : null}
      {ev.canAssign ? (
        <div className="row-gap"><select className="input" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">{t('اختر مقيّمًا', 'Pick evaluator')}</option>{pool.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}</select>
          <button className="btn btn-primary" disabled={!pick} onClick={() => run(() => api.assignEvaluator(app.id, { evaluatorUserId: pick }))}>{t('إسناد', 'Assign')}</button></div>
      ) : null}
      {ev.minimums ? <p className="hint">{t('الحدود الدنيا:', 'Minimums:')} {t('إجمالي', 'total')} {ev.minimums.total} · {t('مالي', 'financial')} {ev.minimums.financial} · {t('فني', 'technical')} {ev.minimums.technical}</p> : null}
    </div>
  );
};

const MilestonesStaff: React.FC<{ app: ApplicationDetail; onDone: (a: ApplicationDetail) => void }> = ({ app, onDone }) => {
  const { t, isAr, user } = useStore();
  const toast = useToast();
  const run = async (fn: () => Promise<ApplicationDetail>) => { try { onDone(await fn()); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  if (!app.milestones.length) return null;
  return (
    <div className="card sec"><h3>{t('مراحل الصرف', 'Milestones')}</h3>
      <div className="tbl-wrap"><table className="tbl"><tbody>{app.milestones.map((m: any) => (
        <tr key={m.id}><td>{m.seq}. {m.title}<div className="hint">{m.reportNote}</div></td><td>{money(m.amount)}</td><td><Pill>{m.status}</Pill></td>
          <td>
            {m.evidenceDocId ? <a href="#" onClick={async (e) => { e.preventDefault(); const b = await api.downloadDocument(app.id, m.evidenceDocId); window.open(URL.createObjectURL(b), '_blank'); }}>{t('الدليل', 'Evidence')}</a> : null}{' '}
            {user?.role === 'imc_officer' && m.status === 'reported' ? <>
              <button className="btn btn-primary" onClick={() => run(() => api.reviewMilestone(app.id, m.id, { verified: true }))}>{t('تحقق', 'Verify')}</button>
              <button className="btn btn-danger" onClick={() => { const note = window.prompt(t('سبب الإعادة', 'Return reason')) ?? ''; if (note.length > 2) void run(() => api.reviewMilestone(app.id, m.id, { verified: false, note })); }}>{t('إعادة', 'Return')}</button></> : null}
            {user?.role === 'funder_reviewer' && m.status === 'verified' ? <button className="btn btn-primary" onClick={() => { const ref = window.prompt(t('مرجع الصرف', 'Disbursement reference')) ?? ''; if (ref.length > 1) void run(() => api.disburseMilestone(app.id, m.id, { reference: ref })); }}>{t('تسجيل الصرف', 'Disburse')}</button> : null}
          </td></tr>
      ))}</tbody></table></div></div>
  );
};

export const StaffApplicationView: React.FC = () => {
  const { param, t, isAr, user } = useStore();
  const toast = useToast();
  const { data: app, setData: setApp, error, load } = useLoad(() => api.getApplication(param!), [param]);
  if (error) return <Wrap title=""><ErrorState message={error} onRetry={load} /></Wrap>;
  if (!app) return <Wrap title=""><Loading /></Wrap>;
  const ev: any = app.evaluation;
  const sel: any = app.selectHint;
  const ap: any = app.appeal;
  const imc = user?.role === 'imc_officer';
  const decideAppeal = async (accepted: boolean) => {
    const note = window.prompt(t('أسباب القرار', 'Decision reasons')) ?? '';
    if (note.length < 3) return;
    try { setApp(await api.decideAppeal(app.id, { accepted, note, expectedVersion: app.version })); } catch (e) { toast.toast('error', errorText(e, isAr)); }
  };
  const stall = async () => {
    const stalled = !app.isStalled; const note = stalled ? (window.prompt(t('خطة المعالجة', 'Remediation plan')) ?? '') : '';
    if (stalled && note.length < 3) return;
    try { setApp(await api.markStalled(app.id, { stalled, note })); } catch (e) { toast.toast('error', errorText(e, isAr)); }
  };
  return (
    <Wrap title={`${app.number ?? ''} ${app.projectName}`}>
      <button className="btn btn-ghost" onClick={() => history.back()}>←</button>
      <Journey step={app.step} />
      <p><Pill>{isAr ? app.stateLabelAr : app.stateLabelEn}</Pill> {app.score != null ? <>{t('الدرجة', 'Score')} <b>{app.score}</b> {app.passedMinimums === false ? <Pill kind="bad">{t('دون الحد الأدنى', 'below minimum')}</Pill> : null}</> : null}
        {app.isStalled ? <Pill kind="bad">{t('متعثر', 'Stalled')}</Pill> : null} · {app.applicantName} · {app.cohortNameAr}</p>
      {app.currentTask ? <div className="card sec"><b>{t('المطلوب الآن:', 'Now:')}</b> {isAr ? app.currentTask.labelAr : app.currentTask.labelEn}</div> : null}
      {app.eligibility ? <div className="card sec"><h3>{t('فحوص الأهلية الآلية', 'Automated eligibility checks')}</h3><ul>{app.eligibility.checks.map((c: any) => <li key={c.key}>{c.ok === null ? '•' : c.ok ? '✔' : '✘'} {isAr ? c.labelAr : c.labelEn} — {c.valueAr}</li>)}</ul></div> : null}
      {sel ? <div className="card sec">{t('المختارون في الدورة:', 'Selected in cohort:')} {sel.selected}/{sel.target}{sel.outOfRank ? <b> — {t('اختياره خارج ترتيب الدرجات يتطلب سببًا', 'selecting out of score order requires a reason')}</b> : null}</div> : null}
      {app.studyTotals ? <Totals t={app.studyTotals} isAr={isAr} /> : null}
      {imc && ev?.assignments ? <ImcEvaluation app={app} ev={ev} onDone={setApp} /> : null}
      {user?.role === 'evaluator' && ev ? <EvaluatorBlock app={app} ev={ev} onDone={setApp} /> : null}
      {app.referrals.length ? <div className="card sec"><h3>{t('إحالات التمويل', 'Funding referrals')}</h3>{app.referrals.map((r: any) => <div key={r.id}>{r.funderNameAr} — <Pill>{r.status}</Pill> {r.amount ? money(r.amount) : ''} {r.modelLabelAr ?? ''} {r.declineReason}</div>)}</div> : null}
      <MilestonesStaff app={app} onDone={setApp} />
      {app.impactReports.length ? <div className="card sec"><h3>{t('تقارير الأثر', 'Impact reports')}</h3>{app.impactReports.map((r: any) => <div key={r.id}>{r.periodStart} → {r.periodEnd}: {t('إيرادات', 'rev')} {money(r.revenue)} · {t('وظائف', 'jobs')} {r.directJobs + r.indirectJobs}</div>)}</div> : null}
      {imc && ['IMPLEMENTATION', 'OPERATING'].includes(app.state) ? <button className="btn btn-secondary" onClick={stall}>{app.isStalled ? t('رفع علامة التعثر', 'Clear stalled flag') : t('تعليم متعثرًا', 'Mark stalled')}</button> : null}
      {ap?.appeal ? <div className="card sec"><h3>{t('تظلم', 'Appeal')}</h3><p>{ap.appeal.reason}</p><Pill>{ap.appeal.status}</Pill>
        {ap.canDecide ? <div className="row-gap"><button className="btn btn-primary" onClick={() => decideAppeal(true)}>{t('قبول', 'Accept')}</button><button className="btn btn-danger" onClick={() => decideAppeal(false)}>{t('رفض', 'Reject')}</button></div> : null}</div> : null}
      <ActionPanel app={app} onDone={setApp} />
      <DataSummary app={app} />
      <DocsList app={app} />
      <History app={app} />
    </Wrap>
  );
};

export const RankingView: React.FC = () => {
  const { t } = useStore();
  const { data: cohorts } = useLoad(() => apiFetch<any>('/api/v1/cohorts').then((r) => r.data.items as any[]));
  const [cid, setCid] = useState('');
  useEffect(() => { if (!cid && cohorts?.length) setCid(cohorts[0].id); }, [cohorts, cid]);
  const { data, error, load } = useLoad(() => (cid ? api.cohortRanking(cid) : Promise.resolve(null)), [cid]);
  return (
    <Wrap title={t('ترتيب الدورة والاختيار', 'Cohort ranking & selection')}>
      <select className="input" style={{ maxWidth: 320 }} value={cid} onChange={(e) => setCid(e.target.value)}>{(cohorts ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}</select>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading variant="table" /> : (
        <>
          <p>{t('المختارون', 'Selected')}: <b>{data.selected}</b> / {(data.cohort as any).selectionTarget} · {t('مستهدف التقييم', 'Evaluation target')} {(data.cohort as any).evaluationTarget}</p>
          <AppTable items={data.items} />
        </>
      )}
    </Wrap>
  );
};

export const MyEvaluationsView: React.FC = () => {
  const { t, isAr } = useStore();
  const { data, error, load } = useLoad(() => api.myEvaluations() as Promise<any[]>);
  return (
    <Wrap title={t('تقييماتي', 'My evaluations')}>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading variant="table" /> : !data.length ? <Empty title={t('لا توجد مشروعات مسندة إليك', 'Nothing assigned')} /> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{data.map((r) => (
          <tr key={r.id} className="clickable" onClick={() => store.navigate('application', r.applicationId)}><td>{r.number}</td><td>{r.projectName}</td><td><Pill>{isAr ? r.statusLabelAr : r.statusLabelEn}</Pill></td></tr>
        ))}</tbody></table></div>
      )}
    </Wrap>
  );
};

export const ExpertsView: React.FC = () => {
  const { t, isAr } = useStore();
  const toast = useToast();
  const { data, error, load } = useLoad(() => api.listExperts());
  const [f, setF] = useState<any>({});
  const add = async () => { try { await api.createExpert(f); setF({}); load(); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  const op = async (id: string, o: 'approve' | 'suspend') => { try { await api.setExpertStatus(id, o); load(); } catch (e) { toast.toast('error', errorText(e, isAr)); } };
  return (
    <Wrap title={t('دليل الخبراء ومقدمي الخدمات', 'Experts directory')}>
      <div className="card sec grid2">
        <input className="input" placeholder={t('الاسم', 'Name')} value={f.nameAr ?? ''} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        <input className="input" placeholder={t('التخصص', 'Specialty')} value={f.specialty ?? ''} onChange={(e) => setF({ ...f, specialty: e.target.value })} />
        <input className="input" placeholder={t('البريد', 'Email')} value={f.contactEmail ?? ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
        <button className="btn btn-primary" onClick={add}>{t('إضافة', 'Add')}</button>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading variant="table" /> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{data.map((e) => (
          <tr key={e.id}><td>{e.nameAr}</td><td>{e.specialty}</td><td><Pill kind={e.status === 'approved' ? 'ok' : 'neutral'}>{e.status}</Pill></td>
            <td>{e.status !== 'approved' ? <button className="btn btn-primary" onClick={() => op(e.id, 'approve')}>{t('اعتماد', 'Approve')}</button> : <button className="btn btn-secondary" onClick={() => op(e.id, 'suspend')}>{t('إيقاف', 'Suspend')}</button>}</td></tr>
        ))}</tbody></table></div>
      )}
    </Wrap>
  );
};

export const MonitoringView: React.FC = () => {
  const { t } = useStore();
  const { data, error, load } = useLoad(() => api.reportSummary() as Promise<any>);
  const flat = (o: any, p = ''): Array<[string, any]> => Object.entries(o ?? {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [[`${p}${k}`, Array.isArray(v) ? v.length : v] as [string, any]]));
  return (
    <Wrap title={t('لوحة المتابعة وقياس الأثر', 'Monitoring & impact')}>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Loading /> : <div className="totals">{flat(data).map(([k, v]) => <div key={k} className="kpi"><b>{typeof v === 'number' ? v.toLocaleString('en-US') : String(v)}</b><span>{k}</span></div>)}</div>}
    </Wrap>
  );
};
