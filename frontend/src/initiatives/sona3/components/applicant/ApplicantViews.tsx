/* eslint-disable @typescript-eslint/no-explicit-any */
// شاشات المتقدم: صفحتي، استمارة التقديم، دراسة الجدوى، متابعة طلبي (التنفيذ والتقارير والتظلم).
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { errorDetails, errorText, store, useStore } from '../../store/state';
import type { ApplicantProfile, ApplicationDetail } from '../../api/schemas';
import { Loading, ErrorState } from '../common/StateViews';
import { useToast } from '../common/ToastSystem';
import { ActionPanel, DataSummary, DocsList, DynamicForm, History, Pill, Totals, money } from '../common/FormKit';

const JOURNEY_FALLBACK = ['التسجيل والتقديم', 'فحص الأهلية', 'دراسة الجدوى', 'المراجعة والتقييم', 'اختيار أفضل المشروعات', 'الاعتماد والتمويل', 'التأسيس والتنفيذ', 'المتابعة وقياس الأثر'];

export const Journey: React.FC<{ step: number }> = ({ step }) => {
  const { meta, isAr } = useStore();
  const items: any[] = (meta as any)?.journey ?? JOURNEY_FALLBACK.map((ar, i) => ({ step: i + 1, ar, en: ar }));
  return (
    <ol className="journey" aria-label="journey">
      {items.map((j) => <li key={j.step} className={j.step < step ? 'done' : j.step === step ? 'now' : ''}><b>{j.step}</b><span>{isAr ? j.ar : j.en}</span></li>)}
    </ol>
  );
};

function useApp(id: string | null) {
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState('');
  const { isAr } = useStore();
  const reload = useCallback(async () => {
    if (!id) return;
    try { setApp(await api.getApplication(id)); setError(''); } catch (e) { setError(errorText(e, isAr)); }
  }, [id, isAr]);
  useEffect(() => { void reload(); }, [reload]);
  return { app, setApp, error, reload };
}

function useProfile() {
  const [p, setP] = useState<ApplicantProfile | null>(null);
  const [error, setError] = useState('');
  const { isAr } = useStore();
  const load = useCallback(() => { api.applicantProfile().then(setP).catch((e) => setError(errorText(e, isAr))); }, [isAr]);
  useEffect(load, [load]);
  return { p, error, load };
}

export const ApplicantDashboardView: React.FC = () => {
  const { isAr, t } = useStore();
  const toast = useToast();
  const { p, error, load } = useProfile();
  if (error) return <div className="container-custom page"><ErrorState message={error} onRetry={load} /></div>;
  if (!p) return <div className="container-custom page"><Loading /></div>;
  const open = p.applications.find((a) => p.openApplicationId === a.id);
  const start = async () => {
    try { const a = await api.createApplication(); store.navigate('apply', a.id); } catch (e) { toast.toast('error', errorText(e, isAr)); }
  };
  const go = (a: any) => store.navigate(a.state === 'DRAFT' || a.state === 'ELIGIBILITY_CORRECTION' ? 'apply' : a.state === 'STUDY_PREPARATION' || a.state === 'STUDY_CORRECTION' ? 'study' : 'my-application', a.id);
  return (
    <div className="container-custom page">
      <h1>{t('صفحتي', 'My page')}</h1>
      <p>{t('مرحبًا', 'Welcome')} {p.applicant.fullName}</p>
      {p.openCohort ? <div className="card sec"><b>{isAr ? p.openCohort.nameAr : p.openCohort.nameEn || p.openCohort.nameAr}</b> — {t('باب التقديم مفتوح حتى', 'Applications open until')} {p.openCohort.closesAt} · {t('الحد الأقصى للسن', 'Max age')} {p.openCohort.maxAge}</div>
        : <div className="card sec">{t('باب التقديم مغلق حاليًا — تابع الإعلان عن الدورة القادمة.', 'Applications are closed right now.')}</div>}
      {open ? (
        <div className="card sec">
          <Journey step={open.step} />
          <h3>{open.projectName || t('مشروع بدون اسم', 'Untitled project')} <Pill>{isAr ? open.stateLabelAr : open.stateLabelEn}</Pill></h3>
          <button className="btn btn-primary" onClick={() => go(open)}>{t('متابعة', 'Continue')}</button>
        </div>
      ) : p.canStartNew ? <button className="btn btn-primary" onClick={start}>{t('ابدأ طلبًا جديدًا', 'Start a new application')}</button> : null}
      {p.applications.filter((a) => a.id !== p.openApplicationId).length ? (
        <>
          <h2>{t('طلباتي السابقة', 'Previous applications')}</h2>
          {p.applications.filter((a) => a.id !== p.openApplicationId).map((a) => (
            <div key={a.id} className="card sec row-gap between"><span>{a.number} — {a.projectName}</span><span><Pill kind="neutral">{isAr ? a.stateLabelAr : a.stateLabelEn}</Pill> <button className="btn btn-secondary" onClick={() => go(a)}>{t('عرض', 'View')}</button></span></div>
          ))}
        </>
      ) : null}
    </div>
  );
};

const FormView: React.FC<{ kind: 'application' | 'study' }> = ({ kind }) => {
  const { param, isAr, t } = useStore();
  const toast = useToast();
  const { app, setApp, error, reload } = useApp(param);
  const [errs, setErrs] = useState<Record<string, string>>({});
  if (error) return <div className="container-custom page"><ErrorState message={error} onRetry={reload} /></div>;
  if (!app) return <div className="container-custom page"><Loading /></div>;
  const submitAction = app.allowedActions.find((a) => ['submit', 'resubmit', 'submit_study'].includes(a.action));
  const submit = async () => {
    if (!submitAction) return;
    setErrs({});
    try { const r = await api.performAction(app.id, submitAction.action, { expectedVersion: app.version }); setApp(r); toast.toast('success', t('تم الإرسال', 'Submitted')); store.navigate('my-application', app.id); }
    catch (e) { setErrs(errorDetails(e, isAr)); toast.toast('error', errorText(e, isAr)); }
  };
  const tasks = app.currentTask?.deficiencies ?? [];
  return (
    <div className="container-custom page">
      <Journey step={app.step} />
      <h1>{kind === 'application' ? t('استمارة التقديم', 'Application form') : t('دراسة الجدوى', 'Feasibility study')}</h1>
      {tasks.length ? (
        <div className="card sec warn"><b>{t('المطلوب استيفاؤه', 'Items to complete')}</b>
          <ul>{tasks.map((d) => <li key={d.id}>{isAr ? d.labelAr : d.labelEn}{d.note ? ` — ${d.note}` : ''}</li>)}</ul></div>
      ) : null}
      <p className="hint">{t('يُحفظ كل حقل تلقائيًا عند الانتقال منه.', 'Each field is saved automatically when you leave it.')}</p>
      <DynamicForm app={app} kind={kind} errors={errs} onChanged={(a) => (a ? setApp(a) : void reload())} />
      {Object.keys(errs).length ? <div className="card sec warn" role="alert">{t('راجع الحقول المعلّمة بالأحمر في الأقسام.', 'Review the highlighted fields in the sections.')}</div> : null}
      {submitAction ? <div className="sticky-bar"><button className="btn btn-primary" onClick={submit}>{isAr ? submitAction.labelAr : submitAction.labelEn}</button></div> : null}
      {app.allowedActions.some((a) => a.action === 'withdraw') ? <ActionPanel app={{ ...app, allowedActions: app.allowedActions.filter((a) => a.action === 'withdraw') }} onDone={(a) => { setApp(a); store.navigate('applicant-dashboard'); }} /> : null}
    </div>
  );
};

export const ApplyView: React.FC = () => <FormView kind="application" />;
export const StudyView: React.FC = () => <FormView kind="study" />;

const Milestones: React.FC<{ app: ApplicationDetail; onDone: (a: ApplicationDetail) => void }> = ({ app, onDone }) => {
  const { isAr, t } = useStore();
  const toast = useToast();
  const [note, setNote] = useState<Record<string, string>>({});
  const [file, setFile] = useState<Record<string, File | undefined>>({});
  const stLabel: any = { planned: ['مخطط', 'Planned'], reported: ['بانتظار التحقق', 'Awaiting verification'], verified: ['متحقق منه', 'Verified'], returned: ['معاد للاستكمال', 'Returned'], disbursed: ['تم الصرف', 'Disbursed'] };
  const report = async (id: string) => {
    if (!file[id]) { toast.toast('error', t('أرفق دليل الإنجاز (PDF)', 'Attach evidence (PDF)')); return; }
    try { onDone(await api.reportMilestone(app.id, id, note[id] ?? '', file[id]!)); } catch (e) { toast.toast('error', errorText(e, isAr)); }
  };
  if (!app.milestones.length) return null;
  return (
    <div className="card sec"><h3>{t('مراحل التنفيذ والصرف', 'Milestones & disbursement')}</h3>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>#</th><th>{t('المرحلة', 'Milestone')}</th><th>{t('الموعد', 'Due')}</th><th>{t('الدفعة', 'Tranche')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
        <tbody>{app.milestones.map((m: any) => (
          <tr key={m.id}><td>{m.seq}</td><td>{m.title}{m.reviewNote ? <div className="hint">{m.reviewNote}</div> : null}</td><td>{m.dueDate ?? '—'}</td><td>{money(m.amount)}</td><td><Pill kind={m.status === 'disbursed' ? 'ok' : m.status === 'returned' ? 'bad' : 'blue'}>{stLabel[m.status][isAr ? 0 : 1]}</Pill></td>
            <td>{app.state === 'IMPLEMENTATION' && (m.status === 'planned' || m.status === 'returned') ? (
              <div className="rep"><input className="input" placeholder={t('وصف الإنجاز', 'What was achieved')} onChange={(e) => setNote({ ...note, [m.id]: e.target.value })} /><input type="file" accept="application/pdf" onChange={(e) => setFile({ ...file, [m.id]: e.target.files?.[0] })} /><button className="btn btn-primary" onClick={() => report(m.id)}>{t('إبلاغ', 'Report')}</button></div>) : null}</td></tr>
        ))}</tbody></table></div></div>
  );
};

const ImpactForm: React.FC<{ app: ApplicationDetail; onDone: (a: ApplicationDetail) => void }> = ({ app, onDone }) => {
  const { isAr, t } = useStore();
  const toast = useToast();
  const [f, setF] = useState<any>({});
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const send = async () => {
    try {
      onDone(await api.submitImpactReport(app.id, { periodStart: f.periodStart, periodEnd: f.periodEnd, revenue: Number(f.revenue), costs: Number(f.costs), production: f.production ?? '',
        directJobs: Number(f.directJobs), indirectJobs: Number(f.indirectJobs), issues: f.issues ?? '' } as any));
      setF({}); toast.toast('success', t('تم إرسال التقرير', 'Report sent'));
    } catch (e) { toast.toast('error', errorText(e, isAr)); }
  };
  const L = (ar: string, en: string, k: string, type = 'text') => <div className="fld"><label>{t(ar, en)}</label><input className="input" type={type} dir={type === 'number' ? 'ltr' : undefined} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></div>;
  return (
    <div className="card sec"><h3>{t('تقارير الأثر الدورية', 'Periodic impact reports')}</h3>
      {app.impactReports.map((r: any) => <div key={r.id} className="row-gap between"><span>{r.periodStart} → {r.periodEnd}</span><span>{t('إيرادات', 'Revenue')} {money(r.revenue)} · {t('وظائف', 'Jobs')} {r.directJobs + r.indirectJobs}</span></div>)}
      {app.state === 'OPERATING' ? (
        <div className="grid2">{L('من', 'From', 'periodStart', 'date')}{L('إلى', 'To', 'periodEnd', 'date')}{L('الإيرادات', 'Revenue', 'revenue', 'number')}{L('التكاليف', 'Costs', 'costs', 'number')}
          {L('الإنتاج', 'Production', 'production')}{L('فرص عمل مباشرة', 'Direct jobs', 'directJobs', 'number')}{L('فرص عمل غير مباشرة', 'Indirect jobs', 'indirectJobs', 'number')}{L('مشكلات', 'Issues', 'issues')}
          <button className="btn btn-primary" onClick={send}>{t('إرسال التقرير', 'Send report')}</button></div>) : null}
    </div>
  );
};

const Appeal: React.FC<{ app: ApplicationDetail; onDone: (a: ApplicationDetail) => void }> = ({ app, onDone }) => {
  const { isAr, t } = useStore();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const ap: any = app.appeal;
  if (!ap) return null;
  return (
    <div className="card sec"><h3>{t('التظلم', 'Appeal')}</h3>
      {ap.appeal ? <p>{t('حالة التظلم:', 'Appeal status:')} <Pill>{ap.appeal.status}</Pill> {ap.appeal.decisionNote}</p> : null}
      {ap.canAppeal ? (
        <><p className="hint">{t(`يمكنك تقديم تظلم واحد مسبب حتى ${String(ap.deadline).slice(0, 10)}.`, `One reasoned appeal allowed until ${String(ap.deadline).slice(0, 10)}.`)}</p>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-primary" onClick={async () => { try { onDone(await api.fileAppeal(app.id, reason)); } catch (e) { toast.toast('error', errorText(e, isAr)); } }}>{t('تقديم التظلم', 'File appeal')}</button></>
      ) : null}
    </div>
  );
};

export const MyApplicationView: React.FC = () => {
  const { param, isAr, t } = useStore();
  const { app, setApp, error, reload } = useApp(param);
  if (error) return <div className="container-custom page"><ErrorState message={error} onRetry={reload} /></div>;
  if (!app) return <div className="container-custom page"><Loading /></div>;
  const task = app.currentTask;
  return (
    <div className="container-custom page">
      <button className="btn btn-ghost" onClick={() => store.navigate('applicant-dashboard')}>← {t('صفحتي', 'My page')}</button>
      <Journey step={app.step} />
      <h1>{app.projectName} <small>{app.number}</small></h1>
      <p><Pill>{isAr ? app.stateLabelAr : app.stateLabelEn}</Pill> {app.isStalled ? <Pill kind="bad">{t('متعثر', 'Stalled')}</Pill> : null}</p>
      {app.score !== null ? <p>{t('الدرجة الإجمالية:', 'Overall score:')} <b>{app.score}</b></p> : null}
      {task ? <div className="card sec"><b>{t('المطلوب الآن', 'Next')}:</b> {isAr ? task.labelAr : task.labelEn} — {isAr ? task.responsible.labelAr : task.responsible.labelEn}</div> : null}
      {['DRAFT', 'ELIGIBILITY_CORRECTION'].includes(app.state) ? <button className="btn btn-primary" onClick={() => store.navigate('apply', app.id)}>{t('فتح الاستمارة', 'Open form')}</button> : null}
      {['STUDY_PREPARATION', 'STUDY_CORRECTION'].includes(app.state) ? <button className="btn btn-primary" onClick={() => store.navigate('study', app.id)}>{t('فتح دراسة الجدوى', 'Open study')}</button> : null}
      {app.eligibility ? <div className="card sec"><h3>{t('شروط الأهلية', 'Eligibility')}</h3><ul>{app.eligibility.checks.map((c: any) => <li key={c.key}>{c.ok === null ? '•' : c.ok ? '✔' : '✘'} {isAr ? c.labelAr : c.labelEn} — {c.valueAr}</li>)}</ul></div> : null}
      {app.studyTotals ? <Totals t={app.studyTotals} isAr={isAr} /> : null}
      {app.referrals.filter((r: any) => r.status === 'approved').map((r: any) => <div key={r.id} className="card sec ok">{t('تمويل معتمد:', 'Funding approved:')} <b>{money(r.amount)}</b> — {r.funderNameAr} ({r.modelLabelAr})</div>)}
      <Milestones app={app} onDone={setApp} />
      {['OPERATING', 'COMPLETED'].includes(app.state) ? <ImpactForm app={app} onDone={setApp} /> : null}
      <Appeal app={app} onDone={setApp} />
      <ActionPanel app={app} onDone={setApp} />
      <DataSummary app={app} />
      <DocsList app={app} />
      <History app={app} />
    </div>
  );
};
