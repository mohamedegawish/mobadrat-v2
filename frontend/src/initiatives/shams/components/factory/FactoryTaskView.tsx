import React, { useState } from 'react';
import { Building2, FileSignature, Landmark, Upload, Wrench, Zap } from 'lucide-react';
import { api, type ActionBody, type ActionName, type ApplicationDetail } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { useAsync } from '../../hooks/useAsync';
import { Loading, ErrorState, NotAvailable, Empty } from '../common/StateViews';
import { ErrorBox } from '../ui/ErrorBox';
import { PdfUploader } from '../ui/PdfUploader';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StateBadge } from '../ui/StateBadge';
import { DocumentsList, StageTracker, TaskCard } from '../application/shared';
import { useToast } from '../common/ToastSystem';
import { SupportContact } from '../common/SupportContact';
import { toLatinDigits } from '../../utils/validation';
import { ProviderLogo } from '../common/ProviderLogo';

/**
 * شاشة واحدة لكل مهمة: مقدم الخدمة، العرض الفني، موافقة الكهرباء، ثم بعد قبولها اختيار مسار التعاقد (بنك — G-01 — أو شركة
 * توزيع الكهرباء)، ثم خطوات المسار المختار وحده: اختيار البنك ونتيجة التعاقد، أو رفع موافقة شركة التوزيع.
 */
export const FactoryTaskView: React.FC = () => {
  const { param, t } = useStore();
  const res = useAsync(() => api.getApplication(param ?? ''), [param]);
  const app = res.data;
  if (res.loading && !app) return <div className="container-custom page"><Loading /></div>;
  if (res.notAvailable) return <div className="container-custom page"><NotAvailable /></div>;
  if (res.error || !app) return <div className="container-custom page"><ErrorState message={res.error} onRetry={res.reload} /></div>;
  const reload = async () => res.setData(await api.getApplication(app.id));

  let body: React.ReactNode;
  switch (app.state) {
    case 'PROVIDER_SELECTION': body = <ProviderStep app={app} />; break;
    // I11: مقدم الخدمة المختار أُوقف قبل إرسال العرض → إعادة الاختيار بدل الطريق المغلق.
    case 'OFFER_UPLOAD': case 'OFFER_CORRECTION': body = app.state === 'OFFER_UPLOAD' && app.provider && !app.provider.selectable ? <ProviderStep app={app} reselect /> : <UploadStep app={app} kind="technicalOfferFile" action={app.state === 'OFFER_UPLOAD' ? 'submit_offer' : 'resubmit'} onUploaded={reload} />; break;
    case 'ELECTRICITY_UPLOAD': body = <UploadStep app={app} kind="electricityApprovalFile" action="submit_electricity" onUploaded={reload} />; break;
    // G-01/G-02: بعد قبول PMU لموافقة الكهرباء يختار المصنع مسار التعاقد؛ على مسار البنك يختار البنك ثم يسجل النتيجة بنفسه.
    case 'CONTRACT_OUTCOME': body = app.bank ? <ContractStep app={app} onUploaded={reload} /> : <ContractPathStep app={app} />; break;
    // مسار شركة توزيع الكهرباء: رفع موافقتها (مع حفظ النسخ السابقة) ثم إرسالها لمراجعة PMU.
    case 'DISTRIBUTION_UPLOAD': body = <UploadStep app={app} kind="distributionApprovalFile" action="submit_distribution_approval" onUploaded={reload} />; break;
    default: body = (
      <Empty title={t('لا توجد مهمة مطلوبة منك في هذه المرحلة', 'No task for you at this stage')}
        action={<button type="button" className="btn btn-primary" onClick={() => store.navigate('application', app.id)}>{t('عرض الطلب', 'View application')}</button>} />
    );
  }

  return (
    <div className="container-custom page">
      <div className="page-head">
        <div>
          <div className="row"><h1 className="page-title">{app.number}</h1><StateBadge state={app.state} labelAr={app.stateLabelAr} labelEn={app.stateLabelEn} /></div>
          <p className="page-sub">{app.companyName}</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => store.navigate('factory-dashboard')}>{t('العودة للوحتي', 'Back to dashboard')}</button>
      </div>
      <div className="card" style={{ marginBottom: '1rem' }}><StageTracker step={app.step} state={app.state} /></div>
      <div style={{ marginBottom: '1rem' }}><TaskCard task={app.currentTask} /></div>
      <div className="card">{body}</div>
    </div>
  );
};

function useAct(app: ApplicationDetail) {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: ActionName, body: Omit<ActionBody, 'expectedVersion'>) => {
    setBusy(true); setError('');
    try {
      await api.performAction(app.id, action, { expectedVersion: app.version, ...body });
      toast('success', t('تم التنفيذ.', 'Done.'));
      store.navigate('factory-dashboard');
      return true;
    } catch (e) { setError(errorText(e, isAr)); return false; } finally { setBusy(false); }
  };
  return { busy, error, run };
}

const ProviderStep: React.FC<{ app: ApplicationDetail; reselect?: boolean }> = ({ app, reselect }) => {
  const { isAr, t } = useStore();
  const providers = useAsync(() => api.listProviders(), []);
  const [selected, setSelected] = useState('');
  const [confirm, setConfirm] = useState(false);
  const { busy, error, run } = useAct(app);
  if (providers.loading) return <Loading />;
  if (providers.error) return <ErrorState message={providers.error} onRetry={providers.reload} />;
  const list = (providers.data ?? []).filter((p) => p.id !== app.provider?.id);
  const chosen = list.find((p) => p.id === selected);
  return (
    <div className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}><Wrench size={18} style={{ verticalAlign: '-3px' }} /> {t('اختر مقدم الخدمة من القائمة المعتمدة', 'Choose a service provider from the approved list')}</h2>
      {reselect && app.provider ? (
        <div className="error-box" data-testid="provider-suspended">
          {t(`أُوقف اعتماد مقدم الخدمة «${app.provider.nameAr}» الذي اخترته. اختر مقدم خدمة معتمدًا آخر، ثم ارفع العرض الفني المُعد منه.`, `The provider “${app.provider.nameEn || app.provider.nameAr}” you chose is no longer approved. Choose another approved provider, then upload its technical offer.`)}
        </div>
      ) : null}
      {/* B2: قائمة فارغة — رسالة واضحة بدل طريق مغلق صامت (PMU والأدمن يُنبَّهان آليًا) */}
      {!list.length ? <Empty title={t('لا يوجد حاليًا مقدمو خدمة معتمدون', 'There are no approved service providers right now')}
        hint={<>{t('طلبك محفوظ في هذه المرحلة ولن يضيع. أُبلغت وحدة إدارة المبادرة بأن القائمة فارغة؛ عُد إلى هذه الصفحة لاحقًا لاختيار مقدم الخدمة.', 'Your application is saved at this stage. The PMU has been alerted that the list is empty; come back to this page later to choose a provider.')} <SupportContact /></>} /> : (
        <div className="stack" role="radiogroup" style={{ gap: '0.5rem' }}>
          {list.map((p) => (
            <label key={p.id} className={`doc-item${selected === p.id ? ' is-selected' : ''}`} style={{ cursor: 'pointer', borderColor: selected === p.id ? 'var(--egypt-red)' : undefined }}>
              <input type="radio" name="provider" value={p.id} checked={selected === p.id} onChange={() => setSelected(p.id)} data-testid={`provider-${p.id}`} />
              <ProviderLogo logoUrl={p.logoUrl} name={p.nameAr} size={52} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="doc-name" style={{ display: 'block' }}>{isAr ? p.nameAr : (p.nameEn || p.nameAr)}</span>
                {p.description ? <span className="doc-meta" style={{ display: 'block', whiteSpace: 'pre-line' }}>{p.description}</span> : null}
                {p.website ? <a className="doc-meta" href={p.website} target="_blank" rel="noopener noreferrer" dir="ltr" onClick={(e) => e.stopPropagation()}>{p.website}</a> : null}
              </span>
            </label>
          ))}
        </div>
      )}
      <ErrorBox message={error} />
      <div><button type="button" className="btn btn-primary" disabled={!selected || busy} onClick={() => setConfirm(true)} data-testid="select-provider">{t('تأكيد الاختيار', 'Confirm selection')}</button></div>
      {confirm && chosen ? (
        <ConfirmDialog title={t('تأكيد اختيار مقدم الخدمة', 'Confirm service provider')} message={t(`سيتم اعتماد «${chosen.nameAr}» مقدمًا للخدمة لهذا الطلب، ثم تنتقل لرفع العرض الفني.`, `“${chosen.nameEn || chosen.nameAr}” will be set as the provider; next you upload the technical offer.`)}
          confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setConfirm(false)}
          onConfirm={async () => { if (!(await run('select_provider', { providerId: selected }))) setConfirm(false); }} />
      ) : null}
    </div>
  );
};

const UploadStep: React.FC<{ app: ApplicationDetail; kind: 'technicalOfferFile' | 'electricityApprovalFile' | 'distributionApprovalFile'; action: ActionName; onUploaded: () => Promise<void> }> = ({ app, kind, action, onUploaded }) => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const { busy, error, run } = useAct(app);
  const [confirm, setConfirm] = useState(false);
  const [distributionCompany, setDistributionCompany] = useState(String(app.data.electricity?.distributionCompany ?? ''));
  const [note, setNote] = useState('');
  const isOffer = kind === 'technicalOfferFile';
  const isDistribution = kind === 'distributionApprovalFile';
  const isElectricity = kind === 'electricityApprovalFile';
  const pendingNew = app.documents.some((d) => d.kind === kind && !d.submitted && d.isCurrent);
  const returned = app.currentTask?.deficiencies.some((d) => d.field === kind);
  const needsNew = isOffer || isDistribution || returned;
  const hasFile = app.documents.some((d) => d.kind === kind && d.isCurrent);
  const ready = (needsNew ? pendingNew : hasFile) && (!isElectricity || distributionCompany.trim().length >= 2);

  const upload = async (file: File) => {
    try { await api.uploadDocument(app.id, kind, file); toast('success', t('تم رفع الملف.', 'File uploaded.')); await onUploaded(); } catch (e) { toast('error', errorText(e, isAr)); }
  };

  return (
    <div className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
        {isOffer ? <><Upload size={18} style={{ verticalAlign: '-3px' }} /> {t('رفع العرض الفني المُعد من مقدم الخدمة', 'Upload the technical offer prepared by the provider')}</>
          : isDistribution ? <><Building2 size={18} style={{ verticalAlign: '-3px' }} /> {t('رفع موافقة شركة توزيع الكهرباء على التعاقد', 'Upload the distribution company contracting approval')}</>
          : <><Zap size={18} style={{ verticalAlign: '-3px' }} /> {t('رفع موافقة شركة الكهرباء', 'Upload the electricity company approval')}</>}
      </h2>
      {isDistribution ? (
        <p className="form-helper" data-testid="distribution-step">
          {t('اخترت إتمام التعاقد من خلال شركة توزيع الكهرباء. ارفع موافقة الشركة على التعاقد (PDF). يمكنك رفع نسخة جديدة قبل الإرسال وتُحفظ النسخ السابقة. بعد الإرسال تراجعها وحدة إدارة المبادرة، وقرارها نهائي: القبول يعني «تم التعاقد»، والرفض يغلق الطلب.',
            'You chose to complete the contract through the electricity distribution company. Upload the company’s contracting approval (PDF). You can upload a new version before sending; earlier versions are kept. The PMU then reviews it and its decision is final: acceptance means “contracted”, rejection closes the application.')}
        </p>
      ) : null}
      {app.provider && isOffer ? <p className="form-helper">{t('مقدم الخدمة', 'Service provider')}: <b>{isAr ? app.provider.nameAr : app.provider.nameEn || app.provider.nameAr}</b></p> : null}
      <DocumentsList app={app} kinds={[kind]} />
      <PdfUploader onFile={upload} testId={`upload-${kind}`} label={hasFile ? t('رفع نسخة جديدة (تُحفظ السابقة)', 'Upload a new version (previous kept)') : undefined} />
      {needsNew && !pendingNew ? <p className="form-helper">{t('يجب رفع نسخة جديدة قبل الإرسال.', 'A new version must be uploaded before submitting.')}</p> : null}
      {isDistribution ? (
        <div className="form-group">
          <label className="form-label" htmlFor="distributionNote">{t('ملاحظات للمراجع (اختياري)', 'Notes for the reviewer (optional)')}</label>
          <textarea id="distributionNote" className="form-control" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="distribution-note" />
        </div>
      ) : null}
      {isElectricity ? (
        <div className="field-grid">
          <div className="form-group">
            <label className="form-label required" htmlFor="distributionCompany">{t('شركة التوزيع المصدِرة للموافقة', 'Issuing distribution company')}</label>
            {/* TODO(محتوى): قائمة شركات التوزيع الرسمية — حقل نصي حتى تُعتمد */}
            <input id="distributionCompany" className="form-control" value={distributionCompany} onChange={(e) => setDistributionCompany(e.target.value)} maxLength={200} />
          </div>
        </div>
      ) : null}
      <ErrorBox message={error} />
      <div><button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => setConfirm(true)} data-testid="task-submit">{t('إرسال للمراجعة', 'Send for review')}</button></div>
      {confirm ? (
        <ConfirmDialog title={t('تأكيد الإرسال', 'Confirm submission')}
          message={isOffer ? t('سيُرسل المستند إلى وحدة إدارة المبادرة للمراجعة.', 'The document will be sent to the PMU for review.')
            : isDistribution ? t('ستُرسل موافقة شركة التوزيع إلى وحدة إدارة المبادرة. قرارها نهائي، ولا يمكن تعديل المستند بعد الإرسال.', 'The distribution company approval will be sent to the PMU. Its decision is final and the document cannot be changed after sending.')
            : t('سيُرسل المستند إلى وحدة إدارة المبادرة للمراجعة. بعد قبوله تختار مسار التعاقد (بنك أو شركة توزيع الكهرباء).', 'The document will be sent to the PMU for review. Once it is accepted you will choose the contracting path (bank or distribution company).')}
          confirmLabel={t('إرسال', 'Send')} busy={busy} onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            const body = isElectricity ? { distributionCompany: distributionCompany.trim() } : isDistribution && note.trim() ? { note: note.trim() } : {};
            if (!(await run(action, body))) setConfirm(false);
          }} />
      ) : null}
    </div>
  );
};

/**
 * اختيار مسار التعاقد بعد قبول PMU لموافقة الكهرباء: بطاقتان بوصف مختصر. اختيار البنك نفسه يثبّت المسار البنكي (الإجراء القائم
 * select_bank)، واختيار شركة التوزيع يثبّت مسارها (select_distribution_path). الخادم يرفض أي محاولة للجمع أو التبديل.
 */
const ContractPathStep: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { t } = useStore();
  const { busy, error, run } = useAct(app);
  const [path, setPath] = useState<'' | 'bank' | 'distribution'>('');
  const [confirm, setConfirm] = useState(false);
  const canDistribution = app.allowedActions.some((a) => a.action === 'select_distribution_path');
  const canBank = app.allowedActions.some((a) => a.action === 'select_bank');
  const cards: Array<{ key: 'bank' | 'distribution'; Icon: typeof Landmark; title: string; desc: string; enabled: boolean }> = [
    { key: 'bank', Icon: Landmark, enabled: canBank, title: t('التعاقد من خلال بنك', 'Contract through a bank'),
      desc: t('تختار البنك من القائمة، وتتواصل معه مباشرةً خارج المنصة لإتمام الإجراءات، ثم تسجّل هنا نتيجة التعاقد مع مستند الإثبات.', 'Choose a bank from the list, complete the procedures with it directly outside the platform, then record the contract outcome here with the evidence document.') },
    { key: 'distribution', Icon: Building2, enabled: canDistribution, title: t('التعاقد من خلال شركة توزيع الكهرباء', 'Contract through the electricity distribution company'),
      desc: t('ترفع موافقة شركة توزيع الكهرباء على التعاقد، وتراجعها وحدة إدارة المبادرة وتتخذ القرار النهائي (القبول = تم التعاقد، والرفض يغلق الطلب).', 'Upload the distribution company’s contracting approval; the PMU reviews it and takes the final decision (accept = contracted, reject closes the application).') },
  ];
  return (
    <div className="stack" data-testid="contract-path-step">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}><FileSignature size={18} style={{ verticalAlign: '-3px' }} /> {t('اختر مسار إتمام التعاقد', 'Choose how to complete the contract')}</h2>
      <p className="form-helper">{t('قُبلت موافقة الكهرباء. اختر أحد المسارين. الاختيار نهائي لهذا الطلب ولا يمكن الجمع بين المسارين أو التبديل بينهما بعد التأكيد.', 'Your electricity approval was accepted. Choose one of the two paths. The choice is final for this application: the paths cannot be combined or switched after confirmation.')}</p>
      <div className="grid-2" role="radiogroup" aria-label={t('مسار التعاقد', 'Contracting path')}>
        {cards.map(({ key, Icon, title, desc, enabled }) => (
          <label key={key} className={`doc-item${path === key ? ' is-selected' : ''}`} style={{ cursor: enabled ? 'pointer' : 'not-allowed', alignItems: 'flex-start', borderColor: path === key ? 'var(--egypt-red)' : undefined, opacity: enabled ? 1 : 0.6 }}>
            <input type="radio" name="contractPath" value={key} checked={path === key} disabled={!enabled} onChange={() => setPath(key)} data-testid={`path-${key}`} />
            <Icon size={22} aria-hidden />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="doc-name" style={{ display: 'block' }}>{title}</span>
              <span className="doc-meta" style={{ display: 'block', whiteSpace: 'normal' }}>{desc}</span>
            </span>
          </label>
        ))}
      </div>
      {path === 'bank' ? <BankStep app={app} /> : null}
      {path === 'distribution' ? (
        <>
          <ErrorBox message={error} />
          <div><button type="button" className="btn btn-primary" disabled={busy} onClick={() => setConfirm(true)} data-testid="select-distribution">{t('تأكيد التعاقد من خلال شركة التوزيع', 'Confirm the distribution company path')}</button></div>
          {confirm ? (
            <ConfirmDialog title={t('تأكيد مسار التعاقد', 'Confirm the contracting path')}
              message={t('سيُسجَّل التعاقد لهذا الطلب من خلال شركة توزيع الكهرباء، ولن يمكن اختيار بنك بعد ذلك. الخطوة التالية: رفع موافقة شركة التوزيع.', 'This application will be contracted through the electricity distribution company; a bank can no longer be chosen. Next: upload the distribution company approval.')}
              confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setConfirm(false)}
              onConfirm={async () => { if (!(await run('select_distribution_path', {}))) setConfirm(false); }} />
          ) : null}
        </>
      ) : null}
    </div>
  );
};

/** G-01: اختيار البنك — يظهر فقط بعد قبول PMU لموافقة الكهرباء، ومرة واحدة. البنك جهة خارجية بلا حساب (G-02). */
const BankStep: React.FC<{ app: ApplicationDetail }> = ({ app }) => {
  const { isAr, t, meta } = useStore();
  const { busy, error, run } = useAct(app);
  const [bankOrgId, setBankOrgId] = useState('');
  const [confirm, setConfirm] = useState(false);
  const banks = meta?.banks ?? [];
  const chosen = banks.find((b) => b.id === bankOrgId);
  return (
    <div className="stack" data-testid="bank-step">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}><Landmark size={18} style={{ verticalAlign: '-3px' }} /> {t('اختيار البنك', 'Choose your bank')}</h2>
      <p className="form-helper">{t('قُبلت موافقة الكهرباء. اختر البنك الذي ستتعامل معه للتمويل. يُسجَّل اختيارك مرة واحدة، ثم تتواصل مع البنك مباشرةً خارج المنصة (لا حساب للبنك على المنصة ولا موافقة منه هنا).',
        'Your electricity approval was accepted. Choose the bank you will work with. Your choice is recorded once; then contact the bank directly outside the platform (the bank has no account or approval step here).')}</p>
      <div className="form-group">
        <label className="form-label required" htmlFor="bankOrgId">{t('البنك', 'Bank')}</label>
        <select id="bankOrgId" className="form-control" value={bankOrgId} onChange={(e) => setBankOrgId(e.target.value)} data-testid="bank-select">
          <option value="">{t('— اختر البنك —', '— Select bank —')}</option>
          {banks.map((b) => <option key={b.id} value={b.id}>{isAr ? b.nameAr : b.nameEn}</option>)}
        </select>
        {!banks.length ? <div className="form-helper" data-testid="no-banks">{t('لا يوجد حاليًا بنك متاح للاختيار. طلبك محفوظ — عُد لاحقًا.', 'No bank is available right now. Your application is saved — come back later.')} <SupportContact /></div> : null}
      </div>
      <ErrorBox message={error} />
      <div><button type="button" className="btn btn-primary" disabled={!bankOrgId || busy} onClick={() => setConfirm(true)} data-testid="select-bank">{t('تأكيد اختيار البنك', 'Confirm bank')}</button></div>
      {confirm && chosen ? (
        <ConfirmDialog title={t('تأكيد اختيار البنك', 'Confirm your bank')}
          message={t(`سيُسجَّل «${chosen.nameAr}» بنكًا لهذا الطلب ولا يمكن تغييره بعد ذلك. تواصل معه خارج المنصة، ثم سجّل نتيجة التعاقد.`, `“${chosen.nameEn || chosen.nameAr}” will be recorded as the bank for this application and cannot be changed. Contact it outside the platform, then record the outcome.`)}
          confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setConfirm(false)}
          onConfirm={async () => { if (!(await run('select_bank', { bankOrgId }))) setConfirm(false); }} />
      ) : null}
    </div>
  );
};

/** نتيجة التعاقد يسجلها المصنع مباشرة (G-02): «تم التعاقد» بتاريخ وقيمة ومستند إثبات (G-03)، أو «لم يتم التعاقد» بسبب. */
const ContractStep: React.FC<{ app: ApplicationDetail; onUploaded: () => Promise<void> }> = ({ app, onUploaded }) => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const { busy, error, run } = useAct(app);
  const [mode, setMode] = useState<'contract' | 'none'>('contract');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const hasEvidence = app.documents.some((d) => d.kind === 'contractFile' && d.isCurrent && !d.submitted);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const valid = mode === 'contract' ? Boolean(validDate && Number(amount) > 0 && hasEvidence) : reason.trim().length >= 3;
  const uploadEvidence = async (file: File) => {
    try { await api.uploadDocument(app.id, 'contractFile', file); toast('success', t('تم رفع المستند.', 'Document uploaded.')); await onUploaded(); } catch (e) { toast('error', errorText(e, isAr)); }
  };
  return (
    <div className="stack" data-testid="contract-step">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}><FileSignature size={18} style={{ verticalAlign: '-3px' }} /> {t('تسجيل نتيجة التعاقد', 'Record the contract outcome')}</h2>
      <p className="form-helper" data-testid="chosen-bank">
        {t('البنك المختار', 'Chosen bank')}: <b>{app.bank ? (isAr ? app.bank.nameAr : app.bank.nameEn) : '—'}</b>
        {' — '}{t('تتم إجراءات التعاقد مع البنك خارج المنصة؛ سجّل هنا النتيجة بعد انتهائها.', 'Contracting with the bank happens outside the platform; record the result here when it is done.')}
      </p>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" className={`tab${mode === 'contract' ? ' active' : ''}`} onClick={() => setMode('contract')} data-testid="mode-contract">{t('تم التعاقد', 'Contracted')}</button>
        <button type="button" role="tab" className={`tab${mode === 'none' ? ' active' : ''}`} onClick={() => setMode('none')} data-testid="mode-no-contract">{t('لم يتم التعاقد', 'Not contracted')}</button>
      </div>
      {mode === 'contract' ? (
        <div className="stack">
          <div className="field-grid">
            <div className="form-group"><label className="form-label required" htmlFor="contractDate">{t('تاريخ التعاقد', 'Contract date')}</label><input id="contractDate" type="date" className="form-control" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="form-group"><label className="form-label required" htmlFor="contractAmount">{t('قيمة التمويل المتعاقد عليه (جنيه)', 'Contracted financing amount (EGP)')}</label><div className="form-helper">{t('تُسجَّل القيمة كما تُدخلها، وتظهر لوحدة إدارة المبادرة على أنها «مسجلة من المصنع».', 'The amount is recorded as you enter it and shown to the PMU as “recorded by the factory”.')}</div><input id="contractAmount" type="text" inputMode="decimal" className="form-control num-ltr" value={amount} onChange={(e) => setAmount(toLatinDigits(e.target.value))} /></div>
          </div>
          <div className="form-group">
            <label className="form-label required">{t('مستند إثبات التعاقد (PDF)', 'Contract evidence (PDF)')}</label>
            <div className="form-helper">{t('العقد أو خطاب البنك بإتمام التعاقد. ملف PDF فقط ضمن الحجم المسموح.', 'The contract or the bank letter confirming it. PDF only, within the size limit.')}</div>
            <DocumentsList app={app} kinds={['contractFile']} />
            <PdfUploader onFile={uploadEvidence} testId="upload-contractFile" label={hasEvidence ? t('رفع نسخة جديدة (تُحفظ السابقة)', 'Upload a new version (previous kept)') : undefined} />
            {!hasEvidence ? <p className="form-helper" data-testid="evidence-required">{t('يجب رفع مستند الإثبات قبل تسجيل «تم التعاقد».', 'Upload the evidence before recording “Contracted”.')}</p> : null}
          </div>
          <div className="form-group"><label className="form-label" htmlFor="contractNotes">{t('ملاحظات (اختياري)', 'Notes (optional)')}</label><textarea id="contractNotes" className="form-control" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></div>
        </div>
      ) : (
        <div className="stack">
          <div className="form-group"><label className="form-label required" htmlFor="ncReason">{t('سبب عدم التعاقد', 'Reason for no contract')}</label><textarea id="ncReason" className="form-control" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} /></div>
          <div className="form-group"><label className="form-label" htmlFor="ncNotes">{t('ملاحظات (اختياري)', 'Notes (optional)')}</label><textarea id="ncNotes" className="form-control" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></div>
        </div>
      )}
      <ErrorBox message={error} />
      <div><button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => setConfirm(true)} data-testid="task-submit">{t('تسجيل النتيجة', 'Record outcome')}</button></div>
      {confirm ? (
        <ConfirmDialog title={t('تأكيد — قرار نهائي', 'Confirm — final decision')} danger={mode === 'none'}
          message={mode === 'contract' ? t('سيُغلق الطلب بحالة «تم التعاقد» مع مستند الإثبات. لا يمكن التعديل بعد ذلك.', 'The application will close as “Contracted” with the evidence. It cannot be changed afterwards.') : t('سيُغلق الطلب بحالة «لم يتم التعاقد». لا يمكن التراجع.', 'The application will close as “Not contracted”. This cannot be undone.')}
          confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            const ok = mode === 'contract'
              ? await run('record_contract', { contractDate: date, contractAmount: Number(amount), contractNotes: notes.trim() || undefined })
              : await run('record_no_contract', { reason: reason.trim(), contractNotes: notes.trim() || undefined });
            if (!ok) setConfirm(false);
          }} />
      ) : null}
    </div>
  );
};
