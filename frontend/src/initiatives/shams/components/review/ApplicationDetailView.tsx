import React, { useState } from 'react';
import { Building, Building2, FileStack, Gavel, Landmark, ShieldAlert } from 'lucide-react';
import { api, type AllowedAction, type ApplicationDetail } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { useAsync, formatDate, formatNumber } from '../../hooks/useAsync';
import { Loading, ErrorState, NotAvailable } from '../common/StateViews';
import { StateBadge } from '../ui/StateBadge';
import { ErrorBox } from '../ui/ErrorBox';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataSections, DocumentsList, FinalOutcomeCard, StageTracker, TaskCard, contractPathLabel, factoryTarget } from '../application/shared';
import { useToast } from '../common/ToastSystem';

type Tab = 'data' | 'documents';

/** تفاصيل الطلب لكل الأدوار — يعرض فقط ما يرجعه السيرفر حسب قواعد الرؤية، والأزرار من allowedActions. */
export const ApplicationDetailView: React.FC = () => {
  const { param, isAr, t, user } = useStore();
  // بلا معرف كان الطلب يذهب إلى /applications/ فيرجع القائمة وتنهار الصفحة — لا نجلب شيئًا ونعرض «غير متاح».
  const res = useAsync<ApplicationDetail | null>(() => (param ? api.getApplication(param) : Promise.resolve(null)), [param]);
  const [tab, setTab] = useState<Tab>('data');
  const app = res.data;
  if (!param) return <div className="container-custom page"><NotAvailable /></div>;
  if (res.loading && !app) return <div className="container-custom page"><Loading /></div>;
  if (res.notAvailable) return <div className="container-custom page"><NotAvailable /></div>;
  if (res.error || !app) return <div className="container-custom page"><ErrorState message={res.error} onRetry={res.reload} /></div>;

  const isFactory = user?.role === 'factory_owner';
  // المصنع لا يرى هنا إلا الانسحاب: باقي إجراءاته (إرسال، اختيار مقدم الخدمة، رفع العرض/الكهرباء، التعاقد) تحتاج مدخلات
  // لا تعرضها هذه اللوحة، فتُنفَّذ من صفحاتها عبر «تنفيذ المطلوب» — وإلا أُرسلت فارغة وفشلت في السيرفر.
  const decisions = app.allowedActions.filter((a) => (isFactory ? a.action === 'withdraw' : a.action !== 'withdraw'));
  const back = () => store.navigate(isFactory ? 'factory-dashboard' : 'work-queue');
  // D10: the closing decision's own words (IMC rejection, withdrawal) — the final card is where they are read.
  const closingReason = [...app.transitions].reverse().find((x) => x.toState === app.state && x.fromState !== x.toState)?.reason || null;

  return (
    <div className="container-custom page">
      <div className="page-head">
        <div>
          <div className="row">
            <h1 className="page-title num-ltr">{app.number ?? t('مسودة', 'Draft')}</h1>
            <StateBadge state={app.state} labelAr={app.stateLabelAr} labelEn={app.stateLabelEn} />
            {app.overdue ? <span className="overdue-flag"><ShieldAlert size={14} /> {t('متأخر', 'Overdue')}</span> : null}
          </div>
          <p className="page-sub">{app.companyName} · {t('المحاولة', 'Attempt')} {formatNumber(app.attempt, isAr)} · {t('دخل المرحلة', 'In stage since')} {formatDate(app.stateEnteredAt, isAr, true)}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={back}>{t('رجوع', 'Back')}</button>
      </div>

      {app.closedAt ? (
        <div style={{ marginBottom: '1rem' }}>
          <FinalOutcomeCard
            state={app.state} closedAt={app.closedAt} contractPath={app.contractPath}
            bankName={app.bank ? (isAr ? app.bank.nameAr : app.bank.nameEn) : null}
            contractDate={app.contractPath === 'distribution' ? null : app.bankReferral?.contractDate ?? null}
            reason={app.state === 'REJECTED' || app.state === 'WITHDRAWN' ? closingReason : app.contractPath === 'distribution' ? (app.distributionContract?.decisionNotes || null) : app.bankReferral?.notContractedReason ?? null}
          >
            {app.contractPath === 'distribution' && app.documents.some((d) => d.kind === 'distributionApprovalFile')
              ? <div style={{ marginTop: '0.5rem' }}><DocumentsList app={app} kinds={['distributionApprovalFile']} /></div> : null}
          </FinalOutcomeCard>
        </div>
      ) : null}
      <div className="card" style={{ marginBottom: '1rem' }}><StageTracker step={app.step} state={app.state} /></div>
      <div style={{ marginBottom: '1rem' }}>
        <TaskCard task={app.currentTask} onAct={isFactory ? () => store.navigate(factoryTarget(app.state), app.id) : undefined} actLabel={t('تنفيذ المطلوب', 'Do it now')} />
      </div>

      {app.metadataOnly ? (
        <p className="form-helper" style={{ marginBottom: '1rem' }} data-testid="metadata-only">
          {t('تعرض هذه الشاشة للأدمن البيانات الوصفية فقط (الرقم والحالة والتواريخ وقائمة المستندات) — بيانات المصنع ومستنداته لا تُعرض ولا تُنزَّل.', 'Administrators see metadata only (number, state, dates, document list) — factory data and documents are not shown or downloadable.')}
        </p>
      ) : null}

      {app.registryDisputeOpen ? (
        <div className="account-banner" role="status" data-testid="registry-dispute-open" style={{ marginBottom: '1rem' }}>
          <b>{t('على رقم السجل الصناعي لهذا الطلب اعتراض قيد مراجعة وحدة إدارة المبادرة', 'An objection to this application’s registry number is under PMU review')}</b>
          <span>{t('لا يتقدم الطلب حتى صدور قرارها؛ يبقى الانسحاب متاحًا للمصنع.', 'The application cannot move forward until the decision; the factory can still withdraw.')}</span>
        </div>
      ) : null}

      {app.registryConflicts.length ? <ConflictsPanel app={app} /> : null}

      {/* مراجعة موافقة شركة التوزيع: المستند ونسخه وتاريخ الإرسال أمام المراجع مباشرةً فوق القرار */}
      {app.state === 'DISTRIBUTION_REVIEW' && app.distributionContract ? <div style={{ marginBottom: '1rem' }}><DistributionPanel app={app} /></div> : null}

      {decisions.length ? <DecisionPanel app={app} actions={decisions} onDone={async () => res.setData(await api.getApplication(app.id))} /> : null}

      <div className="tabs" role="tablist" style={{ marginTop: '1rem' }}>
        {([['data', t('البيانات', 'Data'), <Building key="i" size={14} />], ['documents', t('المستندات', 'Documents'), <FileStack key="i" size={14} />]] as const).map(([k, l, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{icon} {l}</button>
        ))}
      </div>

      {tab === 'data' ? (
        <div className="stack">
          <ContractPathPanel app={app} />
          <DataSections app={app} />
        </div>
      ) : null}

      {tab === 'documents' ? <div className="card"><DocumentsList app={app} /></div> : null}

    </div>
  );
};

export const ProviderStatus: React.FC<{ status: 'pending' | 'approved' | 'suspended' }> = ({ status }) => {
  const { t } = useStore();
  const m = { approved: ['badge-approved', t('معتمد', 'Approved')], suspended: ['badge-rejected', t('موقوف', 'Suspended')], pending: ['badge-pending', t('بانتظار الاعتماد', 'Pending')] }[status];
  return <span className={`badge ${m[0]}`} data-testid="provider-status">{m[1]}</span>;
};

/** I3: تعارض رقم السجل مع طلب مصنع آخر — يظهر لـ IMC وPMU أعلى الطلب. */
const ConflictsPanel: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { isAr, t } = useStore();
  return (
    <div className="error-box" style={{ marginBottom: '1rem' }} data-testid="registry-conflicts">
      <b><ShieldAlert size={15} style={{ verticalAlign: '-3px' }} /> {t('تعارض على رقم السجل الصناعي', 'Industrial registry number conflict')}</b>
      <ul style={{ margin: '0.4rem 0 0' }}>
        {app.registryConflicts.map((c) => (
          <li key={c.id}>
            {c.thisApplicationHoldsNumber
              ? t(`حاولت منشأة أخرى «${c.other?.companyName ?? '—'}» (${c.other?.number ?? 'مسودة'}) إرسال طلب بنفس الرقم ${c.registryNumber}`, `Another facility “${c.other?.companyName ?? '—'}” (${c.other?.number ?? 'draft'}) tried to submit with the same number ${c.registryNumber}`)
              : t(`هذا الطلب حاول استخدام رقم يحجزه الطلب ${c.other?.number ?? ''} لـ«${c.other?.companyName ?? '—'}»`, `This application tried to use a number held by ${c.other?.number ?? ''} (“${c.other?.companyName ?? '—'}”)`)}
            {' · '}{t('عدد المحاولات', 'attempts')}: {formatNumber(c.attempts, isAr)} · {formatDate(c.lastAttemptAt, isAr, true)}
          </li>
        ))}
      </ul>
      <div className="form-helper">{t('راجع ملكية الرقم. عند ثبوت عدم التطابق ارفض بسبب «عدم تطابق ملكية رقم السجل».', 'Review ownership. If it does not belong to this applicant, reject with “registry ownership mismatch”.')}</div>
    </div>
  );
};

/** «مسار التعاقد»: المسار المختار، وبنك المصنع ونتيجة تعاقده، أو موافقة شركة التوزيع. لا يظهر قبل اختيار المسار. */
const ContractPathPanel: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { isAr, t, meta } = useStore();
  const path = contractPathLabel(app.contractPath, t);
  if (!path && !app.bankReferral && !app.distributionContract) return null;
  return (
    <>
      <div className="card" data-testid="contract-path">
        <h3 style={{ marginTop: 0, fontSize: '0.98rem' }}><Landmark size={16} style={{ verticalAlign: '-3px' }} /> {t('مسار التعاقد', 'Contracting path')}</h3>
        {path ? <p className="form-helper" data-testid="contract-path-chosen">{t('مسار التعاقد المختار', 'Chosen contracting path')}: <b>{path}</b></p> : null}
        {app.bankReferral ? (
          <>
            <dl className="kv" data-testid="bank-outcome">
              <dt>{t('البنك المختار', 'Chosen bank')}</dt><dd>{app.bank ? (isAr ? app.bank.nameAr : app.bank.nameEn) : '—'}</dd>
              <dt>{t('تاريخ اختيار البنك', 'Bank chosen on')}</dt><dd>{formatDate(app.bankReferral.referredAt, isAr)}</dd>
              {/* سجل تاريخي فقط: نتيجة «دراسة البنك» من قبل إلغاء هذه المرحلة (G-02) */}
              {app.bankReferral.studyResult ? <><dt>{t('نتيجة دراسة البنك (مرحلة ملغاة)', 'Bank study result (retired step)')}</dt><dd>{app.bankReferral.studyResult === 'approved' ? t('موافقة', 'Approved') : t('عدم موافقة', 'Declined')}</dd></> : null}
              <dt>{t('نتيجة التعاقد', 'Contract outcome')}</dt><dd>{app.bankReferral.contractStatus === 'contracted' ? t('تم التعاقد', 'Contracted') : app.bankReferral.contractStatus === 'not_contracted' ? t('لم يتم التعاقد', 'Not contracted') : '—'}</dd>
              {app.bankReferral.contractAmount !== null ? (
                <><dt>{t('قيمة التعاقد — مسجلة من المصنع', 'Contract amount — recorded by the factory')}</dt>
                  <dd>{formatNumber(app.bankReferral.contractAmount, isAr)} {t('جنيه', 'EGP')}
                    {app.bankReferral.contractAmountAboveAlert ? <div className="overdue-flag" data-testid="amount-alert">{t(`أعلى من ${formatNumber(meta?.policy.contractAmountAlertEGP ?? 0, isAr)} جنيه (حد وثيقة المبادرة) — للمراجعة`, 'Above the initiative limit — for review')}</div> : null}
                  </dd></>
              ) : null}
              {app.bankReferral.contractDate ? <><dt>{t('تاريخ التعاقد', 'Contract date')}</dt><dd className="num-ltr">{app.bankReferral.contractDate}</dd></> : null}
              {app.bankReferral.notContractedReason ? <><dt>{t('سبب عدم التعاقد', 'Reason')}</dt><dd>{app.bankReferral.notContractedReason}</dd></> : null}
              {app.bankReferral.contractNotes ? <><dt>{t('ملاحظات', 'Notes')}</dt><dd>{app.bankReferral.contractNotes}</dd></> : null}
            </dl>
            {app.documents.some((d) => d.kind === 'contractFile') ? (
              <div style={{ marginTop: '0.75rem' }} data-testid="stage-files-contractFile">
                <div className="form-label">{t('مستند إثبات التعاقد', 'Contract evidence')}</div>
                <DocumentsList app={app} kinds={['contractFile']} />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {/* during its review the distribution panel already sits above the decision */}
      {app.distributionContract && app.state !== 'DISTRIBUTION_REVIEW' ? <DistributionPanel app={app} /> : null}
    </>
  );
};

/** التعاقد عن طريق شركة توزيع الكهرباء: تاريخ الاختيار والإرسال، نسخ المستند (الرفع وإعادة الرفع)، والقرار وملاحظاته. */
const DistributionPanel: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { isAr, t } = useStore();
  const d = app.distributionContract;
  if (!d) return null;
  // A decision is final; without one, a closed application (withdrawn on this path) must not read as "under review" or "awaiting upload".
  const closedUndecided = Boolean(app.closedAt) && d.reviewStatus !== 'approved' && d.reviewStatus !== 'rejected';
  const status = d.reviewStatus === 'approved' ? { cls: 'badge-approved', label: t('مقبولة — تم التعاقد', 'Accepted — contracted') }
    : d.reviewStatus === 'rejected' ? { cls: 'badge-rejected', label: t('مرفوضة — أُغلق الطلب', 'Rejected — application closed') }
    : closedUndecided ? { cls: 'badge-draft', label: t('أُغلق الطلب دون قرار (انسحاب المصنع)', 'Closed without a decision (factory withdrew)') }
    : d.reviewStatus === 'pending' ? { cls: 'badge-pending', label: t('قيد مراجعة PMU', 'Under PMU review') }
    : { cls: 'badge-info', label: t('بانتظار رفع المصنع للموافقة', 'Awaiting the factory’s upload') };
  return (
    <div className="card" data-testid="distribution-panel">
      <h3 style={{ marginTop: 0, fontSize: '0.98rem' }}><Building2 size={16} style={{ verticalAlign: '-3px' }} /> {t('التعاقد عن طريق شركة توزيع الكهرباء', 'Contracting through the distribution company')}</h3>
      <dl className="kv">
        <dt>{t('حالة المراجعة', 'Review status')}</dt><dd><span className={`badge ${status.cls}`} data-testid="distribution-status">{status.label}</span></dd>
        <dt>{t('اختيار المسار', 'Path chosen on')}</dt><dd>{formatDate(d.selectedAt, isAr, true)}{d.selectedByName ? ` · ${d.selectedByName}` : ''}</dd>
        {d.submittedAt ? <><dt>{t('تاريخ الإرسال للمراجعة', 'Sent for review on')}</dt><dd>{formatDate(d.submittedAt, isAr, true)}</dd></> : null}
        <dt>{t('عدد مرات الإرسال', 'Submissions')}</dt><dd>{formatNumber(d.submissionCount, isAr)}</dd>
        {d.decidedAt ? <><dt>{t('تاريخ القرار', 'Decided on')}</dt><dd>{formatDate(d.decidedAt, isAr, true)}{d.decidedByName ? ` · ${d.decidedByName}` : ''}</dd></> : null}
        {d.decisionNotes ? <><dt>{d.reviewStatus === 'rejected' ? t('سبب الرفض', 'Rejection reason') : t('ملاحظات المراجعة', 'Review notes')}</dt><dd data-testid="distribution-notes">{d.decisionNotes}</dd></> : null}
      </dl>
      <div style={{ marginTop: '0.75rem' }}>
        <div className="form-label">{t('موافقة شركة التوزيع — كل النسخ (الأحدث أولًا)', 'Distribution company approval — all versions (newest first)')}</div>
        <DocumentsList app={app} kinds={['distributionApprovalFile']} />
      </div>
    </div>
  );
};

/** The registry API is not connected yet (REGISTRY_ADAPTER=manual): the number was not verified — IMC checks it by hand. */
const RegistryManualNotice: React.FC = () => {
  const { t } = useStore();
  return (
    <div className="error-box" style={{ marginTop: '0.6rem' }} data-testid="registry-manual">
      <ShieldAlert size={15} style={{ verticalAlign: '-3px' }} /> {t(
        'خدمة السجل الصناعي غير مربوطة بعد، فلم يُتحقق من الرقم آليًا. قبل القرار: افتح «شهادة السجل الصناعي» في المستندات وتأكد أن رقم السجل واسم المنشأة فيها يطابقان الطلب.',
        'The industrial registry service is not connected yet, so the number was not verified automatically. Before deciding, open the industrial registry certificate in the documents and check that its number and facility name match the application.')}
    </div>
  );
};

/** أزرار القرار من allowedActions + نموذج القرار (سبب / نواقص) + تأكيد. لا قرارات بنكية (G-02). */
const DecisionPanel: React.FC<{ app: ApplicationDetail; actions: AllowedAction[]; onDone: () => Promise<void> }> = ({ app, actions, onDone }) => {
  const { isAr, t, meta } = useStore();
  const { toast } = useToast();
  const [active, setActive] = useState<AllowedAction | null>(null);
  const [reason, setReason] = useState('');
  const [defs, setDefs] = useState<Array<{ field: string; note: string }>>([{ field: '', note: '' }]);
  const [reasonCode, setReasonCode] = useState<'' | 'registry_ownership_mismatch' | 'other'>('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const formFields = (meta?.form.fields ?? []).map((f) => ({ key: f.key, label: isAr ? f.labelAr : f.labelEn }));
  const electricityFields = [
    { key: 'electricityApprovalFile', label: t('ملف موافقة الكهرباء', 'Electricity approval file') },
    { key: 'distributionCompany', label: t('شركة التوزيع', 'Distribution company') },
  ];
  const isElectricity = app.state === 'ELECTRICITY_REVIEW';
  const needDefs = Boolean(active?.requires.deficiencies);
  const showReason = active ? (active.requires.reason || needDefs || ['accept', 'compliant'].includes(active.action) || isElectricity) : false;
  const cleanDefs = defs.filter((d) => d.field && d.note.trim());
  const valid = !active ? false
    : needDefs ? cleanDefs.length > 0
    : active.action === 'reject' ? Boolean(reasonCode) && reason.trim().length >= 3
    : active.requires.reason ? reason.trim().length >= 3 : true;

  const choose = (a: AllowedAction) => { setActive(a); setError(''); setReason(''); setDefs([{ field: '', note: '' }]); setReasonCode(''); };

  const submit = async () => {
    if (!active) return;
    setBusy(true); setError('');
    const body: Record<string, unknown> = { expectedVersion: app.version };
    if (active.action === 'reject') Object.assign(body, { reason: reason.trim(), reasonCode });
    else if (needDefs) Object.assign(body, { deficiencies: cleanDefs.map((d) => ({ field: d.field, note: d.note.trim() })), reason: reason.trim() || undefined });
    else if (active.requires.reason) Object.assign(body, { reason: reason.trim(), ...(isElectricity && cleanDefs.length ? { deficiencies: cleanDefs } : {}) });
    else if (reason.trim()) body.note = reason.trim();
    try {
      await api.performAction(app.id, active.action, body as never);
      toast('success', t('تم تسجيل القرار.', 'Decision recorded.'));
      setActive(null); setConfirm(false);
      await onDone();
      store.bump();
    } catch (e) {
      setError(errorText(e, isAr)); setConfirm(false);
      if ((e as { http?: number }).http === 409) await onDone();
    } finally { setBusy(false); }
  };

  const danger = active ? ['reject', 'withdraw', 'record_no_contract', 'reject_distribution'].includes(active.action) : false;
  const finalDistribution = app.state === 'DISTRIBUTION_REVIEW';
  const fieldsForDefs = isElectricity ? electricityFields : formFields;

  return (
    <div className="decision-panel" data-testid="decision-panel">
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}><Gavel size={16} style={{ verticalAlign: '-3px' }} /> {t('القرار', 'Decision')}</h3>
      {app.registry?.result === 'manual' && app.state === 'IMC_REVIEW' ? <RegistryManualNotice /> : null}
      <div className="decision-actions">
        {actions.map((a) => (
          <button key={a.action} type="button" data-testid={`action-${a.action}`}
            className={`btn ${active?.action === a.action ? 'btn-primary' : ['reject', 'withdraw', 'reject_distribution'].includes(a.action) ? 'btn-outline' : 'btn-secondary'}`}
            onClick={() => choose(a)}>{isAr ? a.labelAr : a.labelEn}</button>
        ))}
      </div>
      {active ? (
        <div className="stack" style={{ marginTop: '1rem' }}>
          {needDefs || (isElectricity && active.action === 'request_correction') ? (
            <div>
              <div className="form-label required">{t('قائمة النواقص (الحقل والملاحظة)', 'Deficiency list (field and note)')}</div>
              {defs.map((d, i) => (
                <div key={i} className="roof-row">
                  <select className="form-control" value={d.field} aria-label={t('الحقل', 'Field')} data-testid={`def-field-${i}`} onChange={(e) => setDefs(defs.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                    <option value="">{t('— الحقل —', '— Field —')}</option>
                    {fieldsForDefs.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <input className="form-control" value={d.note} placeholder={t('الملاحظة', 'Note')} aria-label={t('الملاحظة', 'Note')} data-testid={`def-note-${i}`} onChange={(e) => setDefs(defs.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDefs(defs.length > 1 ? defs.filter((_, j) => j !== i) : [{ field: '', note: '' }])}>✕</button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDefs([...defs, { field: '', note: '' }])}>{t('إضافة بند', 'Add item')}</button>
            </div>
          ) : null}
          {active.action === 'reject' ? (
            <div className="form-group">
              <label className="form-label required" htmlFor="reasonCode">{t('نوع سبب الرفض', 'Rejection reason type')}</label>
              <select id="reasonCode" className="form-control" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)} data-testid="reject-reason-code">
                <option value="">{t('— اختر —', '— Select —')}</option>
                <option value="registry_ownership_mismatch">{t('عدم تطابق ملكية رقم السجل الصناعي', 'Industrial registry ownership mismatch')}</option>
                <option value="other">{t('سبب آخر', 'Other reason')}</option>
              </select>
              {reasonCode === 'registry_ownership_mismatch' ? <div className="form-helper">{t('لن يستطيع هذا الحساب استخدام رقم السجل نفسه مجددًا إلا بعد مراجعة موثقة من وحدة إدارة المبادرة.', 'This account will not be able to reuse the same registry number until a documented PMU review.')}</div> : null}
            </div>
          ) : null}
          {showReason ? (
            <div className="form-group">
              <label className={`form-label${active.requires.reason ? ' required' : ''}`} htmlFor="reason">{active.requires.reason ? t('السبب', 'Reason') : t('ملاحظة (اختيارية)', 'Note (optional)')}</label>
              <textarea id="reason" rows={3} className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} data-testid="decision-reason" />
            </div>
          ) : null}
          <ErrorBox message={error} />
          <div className="row">
            <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!valid || busy} onClick={() => (active.confirm ? setConfirm(true) : void submit())} data-testid="decision-submit">
              {isAr ? active.labelAr : active.labelEn}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setActive(null)}>{t('إلغاء', 'Cancel')}</button>
          </div>
        </div>
      ) : null}
      {confirm && active ? (
        <ConfirmDialog title={t('تأكيد القرار', 'Confirm decision')} danger={danger}
          message={<>
            {t(`سيتم تنفيذ «${active.labelAr}» على الطلب ${app.number ?? ''}. هل أنت متأكد؟`, `“${active.labelEn}” will be applied to ${app.number ?? 'this application'}. Are you sure?`)}
            {finalDistribution && active.action !== 'withdraw' ? <div style={{ marginTop: '0.5rem' }} data-testid="final-decision-warning">{active.action === 'reject_distribution'
              ? t('قرار نهائي: سيُغلق الطلب بحالة «لم يتم التعاقد» ولا يمكن للمصنع استكماله. يُبلَّغ المصنع بالسبب.', 'Final decision: the application closes as “not contracted” and the factory cannot continue it. The factory is notified of the reason.')
              : t('قرار نهائي: سيُغلق الطلب بحالة «تم التعاقد عن طريق شركة توزيع الكهرباء».', 'Final decision: the application closes as “contracted through the distribution company”.')}</div> : null}
            {['request_correction', 'non_compliant'].includes(active.action) ? <div style={{ marginTop: '0.5rem' }} data-testid="returns-to-factory">{t('سيعود الطلب إلى المصنع ويُبلَّغ بالمطلوب، ثم يعود إليك بعد إعادة التقديم.', 'The application returns to the factory, which is notified of what is required, then comes back to you after resubmission.')}</div> : null}
          </>}
          confirmLabel={isAr ? active.labelAr : active.labelEn} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void submit()} />
      ) : null}
    </div>
  );
};
