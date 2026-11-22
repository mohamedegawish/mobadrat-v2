import React, { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, type ServiceProvider } from '../../api';
import { errorDetails, errorText, useStore } from '../../store/state';
import { useAsync } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { AdminPageHeader } from '../admin/AdminLayout';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ProviderLogo } from '../common/ProviderLogo';
import { useToast } from '../common/ToastSystem';

const EMPTY = { nameAr: '', nameEn: '', description: '', website: '', contactName: '', contactPhone: '', contactEmail: '', notes: '' };
/** نفس حد السيرفر (shamsPolicy.providerLogo) — الفحص الحقيقي هناك. */
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

type Filter = 'all' | 'visible' | 'inactive' | 'awaiting' | 'suspended';
type Pending = { p: ServiceProvider; op: 'activate' | 'deactivate' | 'approve' | 'suspend' };

/**
 * دليل مقدمي الخدمة. ليس بوابة مقدمين: لا حسابات ولا دخول لهم.
 *  - ENCPC: تضيف وتعدّل (الاسم والتفاصيل والشعار) وتفعّل وتلغي التفعيل.
 *  - PMU: تعتمد وتوقف (★ مقترح؛ عندما يكون الاعتماد مطلوبًا لا يظهر المقدم للمصانع قبله).
 */
export const ProvidersView: React.FC = () => {
  const { isAr, t, user } = useStore();
  const { toast } = useToast();
  const isManager = user?.role === 'encpc_reviewer';
  const isApprover = user?.role === 'pmu_reviewer';
  const res = useAsync(() => api.providerDirectory(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ServiceProvider | 'new' | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const approvalRequired = res.data?.approvalRequired ?? true;
  const all = res.data?.items ?? [];
  const awaiting = (p: ServiceProvider) => approvalRequired && p.status === 'pending';
  const items = all.filter((p) => {
    if (q.trim() && !`${p.nameAr} ${p.nameEn}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    switch (filter) {
      case 'visible': return Boolean(p.selectable);
      case 'inactive': return !p.isActive;
      case 'awaiting': return Boolean(p.isActive) && awaiting(p);
      case 'suspended': return p.status === 'suspended';
      default: return true;
    }
  });

  /** سبب ظهور/عدم ظهور المقدم للمصنع، بلغة واضحة. */
  const visibility = (p: ServiceProvider): { tone: string; label: string } => {
    if (p.selectable) return { tone: 'approved', label: t('ظاهر للمصانع', 'Visible to factories') };
    if (p.status === 'suspended') return { tone: 'suspended', label: t('موقوف من PMU', 'Suspended by PMU') };
    if (!p.isActive) return { tone: 'pending', label: t('غير مفعّل', 'Not activated') };
    if (awaiting(p)) return { tone: 'pending', label: t('بانتظار اعتماد PMU', 'Awaiting PMU approval') };
    return { tone: 'pending', label: t('غير متاح', 'Unavailable') };
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.op === 'activate' || pending.op === 'deactivate') await api.setProviderActive(pending.p.id, pending.op === 'activate');
      else await api.setProviderStatus(pending.p.id, pending.op);
      toast('success', t('تم التحديث.', 'Updated.'));
      setPending(null);
      await res.reload();
    } catch (e) { toast('error', errorText(e, isAr)); setPending(null); } finally { setBusy(false); }
  };

  const FILTERS: Array<[Filter, string]> = [
    ['all', t('الكل', 'All')], ['visible', t('ظاهر للمصانع', 'Visible')], ['inactive', t('غير مفعّل', 'Not activated')],
    ['awaiting', t('بانتظار الاعتماد', 'Awaiting approval')], ['suspended', t('موقوف', 'Suspended')],
  ];

  const confirmText = (p: Pending): { title: string; message: string; label: string; danger: boolean } => {
    const name = p.p.nameAr;
    switch (p.op) {
      case 'activate': return { title: t('تفعيل مقدم الخدمة', 'Activate provider'), danger: false, label: t('تفعيل', 'Activate'),
        message: approvalRequired && p.p.status !== 'approved'
          ? t(`سيُفعَّل «${name}» لكنه لن يظهر للمصانع قبل اعتماد وحدة إدارة المبادرة، وستُنبَّه الوحدة.`, `“${name}” will be activated but stays hidden from factories until the PMU approves it; the PMU will be notified.`)
          : t(`سيظهر «${name}» للمصانع في قائمة الاختيار.`, `“${name}” will appear in the factories’ selection list.`) };
      case 'deactivate': return { title: t('إلغاء تفعيل مقدم الخدمة', 'Deactivate provider'), danger: true, label: t('إلغاء التفعيل', 'Deactivate'),
        message: t(`سيختفي «${name}» عن المصانع. الطلبات التي اختارته: قبل إرسال العرض يعيد المصنع الاختيار، وأثناء مراجعة العرض أو تصحيحه يعود الطلب تلقائيًا لرفع عرض جديد، وبعد قبول العرض تصل PMU تنبيهًا فقط.`,
          `“${name}” disappears for factories. Applications that chose it: before the offer is sent the factory chooses again; during offer review or correction the application returns automatically to offer upload; after the offer is accepted only the PMU is alerted.`) };
      case 'approve': return { title: t('اعتماد مقدم الخدمة', 'Approve provider'), danger: false, label: t('اعتماد', 'Approve'),
        message: p.p.isActive ? t(`سيظهر «${name}» للمصانع.`, `“${name}” becomes visible to factories.`) : t(`سيُعتمد «${name}» لكنه لن يظهر قبل أن تفعّله ENCPC.`, `“${name}” is approved but stays hidden until ENCPC activates it.`) };
      default: return { title: t('إيقاف مقدم الخدمة', 'Suspend provider'), danger: true, label: t('إيقاف', 'Suspend'),
        message: t(`سيُوقف «${name}»: يختفي عن المصانع وتسري عليه القاعدة نفسها لإلغاء التفعيل على الطلبات التي اختارته.`, `“${name}” is suspended: hidden from factories, with the same effect on applications that chose it as deactivation.`) };
    }
  };

  return (
    <>
      <AdminPageHeader
        title={isManager ? t('إدارة مقدمي الخدمة', 'Manage service providers') : t('اعتماد مقدمي الخدمة', 'Approve service providers')}
        description={isManager
          ? t('دليل بسيط: الاسم والتفاصيل والشعار. مقدمو الخدمة ليسوا مستخدمين ولا يدخلون الموقع؛ المصانع ترى المفعّلين (والمعتمدين من PMU) وتختار منهم.', 'A simple directory: name, details and logo. Providers are not users and never sign in; factories see the active (and PMU-approved) ones and choose from them.')
          : t('تعتمد وحدة إدارة المبادرة مقدمي الخدمة الذين تضيفهم ENCPC، وتوقف من يلزم إيقافه.', 'The PMU approves the providers ENCPC adds and suspends those that must be suspended.')}
        actions={isManager ? <button type="button" className="btn btn-primary" onClick={() => setEditing('new')} data-testid="add-provider"><Plus size={16} /> {t('إضافة مقدم خدمة', 'Add provider')}</button> : undefined} />
      {approvalRequired ? (
        <p className="form-helper" data-testid="approval-note">{t('★ اعتماد وحدة إدارة المبادرة مطلوب حاليًا قبل ظهور المقدم للمصانع (بند مقترح بانتظار قرار الحوكمة النهائي).', '★ PMU approval is currently required before a provider becomes visible to factories (a proposed item awaiting the final governance decision).')}</p>
      ) : (
        <p className="form-helper">{t('اعتماد PMU غير مطلوب حاليًا: يكفي تفعيل ENCPC.', 'PMU approval is not required at the moment: ENCPC activation is enough.')}</p>
      )}
      <div className="toolbar">
        <input className="form-control" placeholder={t('بحث بالاسم', 'Search by name')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('بحث', 'Search')} />
      </div>
      <div className="tabs">
        {FILTERS.map(([k, l]) => <button key={k} type="button" className={`tab${filter === k ? ' active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {res.loading && !res.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : res.error ? <ErrorState message={res.error} onRetry={res.reload} />
          : !items.length ? <Empty title={t('لا يوجد مقدمو خدمة بهذا الفلتر', 'No providers match this filter')} /> : (
            <div className="table-responsive">
              <table className="eng-table" data-testid="providers-table">
                <thead><tr><th>{t('مقدم الخدمة', 'Provider')}</th><th>{t('التفاصيل', 'Details')}</th><th>{t('الظهور للمصانع', 'Visibility')}</th><th /></tr></thead>
                <tbody>
                  {items.map((p) => {
                    const v = visibility(p);
                    return (
                      <tr key={p.id} data-testid={`provider-row-${p.id}`}>
                        <td>
                          <div className="row" style={{ gap: '0.6rem', flexWrap: 'nowrap' }}>
                            <ProviderLogo logoUrl={p.logoUrl} name={p.nameAr} size={44} />
                            <div><b>{p.nameAr}</b>{p.nameEn ? <div className="doc-meta" dir="ltr">{p.nameEn}</div> : null}</div>
                          </div>
                        </td>
                        <td style={{ maxWidth: 360 }}>
                          <div style={{ whiteSpace: 'pre-line', fontSize: '0.86rem' }}>{p.description || '—'}</div>
                          {p.website ? <a className="doc-meta" href={p.website} target="_blank" rel="noopener noreferrer" dir="ltr">{p.website}</a> : null}
                        </td>
                        <td>
                          <Badge status={v.tone}>{v.label}</Badge>
                          <div className="doc-meta">
                            {p.isActive ? t('مفعّل (ENCPC)', 'Activated (ENCPC)') : t('غير مفعّل (ENCPC)', 'Not activated (ENCPC)')}
                            {approvalRequired ? <> · {p.status === 'approved' ? t('معتمد (PMU)', 'Approved (PMU)') : p.status === 'suspended' ? t('موقوف (PMU)', 'Suspended (PMU)') : t('غير معتمد (PMU)', 'Not approved (PMU)')}</> : null}
                          </div>
                        </td>
                        <td className="row" style={{ gap: '0.3rem' }}>
                          {isManager ? <>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(p)} data-testid={`edit-${p.id}`}>{t('تعديل', 'Edit')}</button>
                            {p.isActive
                              ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ p, op: 'deactivate' })} data-testid={`deactivate-${p.id}`}>{t('إلغاء التفعيل', 'Deactivate')}</button>
                              : <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPending({ p, op: 'activate' })} data-testid={`activate-${p.id}`}>{t('تفعيل', 'Activate')}</button>}
                          </> : null}
                          {isApprover && approvalRequired ? <>
                            {p.status !== 'approved' ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPending({ p, op: 'approve' })} data-testid={`approve-${p.id}`}>{t('اعتماد', 'Approve')}</button> : null}
                            {p.status !== 'suspended' ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ p, op: 'suspend' })} data-testid={`suspend-${p.id}`}>{t('إيقاف', 'Suspend')}</button> : null}
                          </> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {editing ? <ProviderForm provider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await res.reload(); }} /> : null}
      {pending ? (() => {
        const c = confirmText(pending);
        return <ConfirmDialog title={c.title} danger={c.danger} message={c.message} confirmLabel={c.label} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void apply()} />;
      })() : null}
    </>
  );
};

const ProviderForm: React.FC<{ provider: ServiceProvider | null; onClose: () => void; onSaved: () => Promise<void> }> = ({ provider, onClose, onSaved }) => {
  const { t, isAr } = useStore();
  const { toast } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ ...EMPTY, ...(provider ? {
    nameAr: provider.nameAr, nameEn: provider.nameEn, description: provider.description ?? '', website: provider.website,
    contactName: provider.contactName ?? '', contactPhone: provider.contactPhone ?? '', contactEmail: provider.contactEmail ?? '', notes: provider.notes ?? '',
  } : {}) });
  const [logo, setLogo] = useState<File | null>(null);
  const [logoError, setLogoError] = useState('');
  const [error, setError] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const pickLogo = (picked: File | undefined) => {
    setLogoError('');
    if (!picked) return;
    if (!LOGO_TYPES.includes(picked.type)) { setLogoError(t('الشعار يجب أن يكون PNG أو JPEG أو WebP.', 'The logo must be PNG, JPEG or WebP.')); return; }
    if (picked.size > LOGO_MAX_BYTES) { setLogoError(t('الحد الأقصى لحجم الشعار 1 ميجابايت.', 'The logo may be at most 1 MB.')); return; }
    setLogo(picked);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true); setError(''); setErrs({});
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => v !== '' || k === 'nameAr' || (provider && k !== 'nameAr')));
    try {
      const saved = provider ? await api.updateProvider(provider.id, body) : await api.createProvider(body);
      if (logo) {
        try { await api.uploadProviderLogo(saved.id, logo); }
        catch (e) { toast('error', t(`حُفظت البيانات لكن تعذر رفع الشعار: ${errorText(e, isAr)}`, `Saved, but the logo upload failed: ${errorText(e, isAr)}`)); }
      }
      await onSaved();
    } catch (e) { setError(errorText(e, isAr)); setErrs(errorDetails(e, isAr)); } finally { setBusy(false); }
  };

  const input = (k: keyof typeof EMPTY, label: string, type = 'text', required = false) => (
    <div className="form-group">
      <label className={`form-label${required ? ' required' : ''}`} htmlFor={`sp-${k}`}>{label}</label>
      <input id={`sp-${k}`} type={type} className={`form-control${errs[k] ? ' is-invalid' : ''}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} dir={['tel', 'email', 'url'].includes(type) ? 'ltr' : undefined} data-testid={`sp-${k}`} />
      {errs[k] ? <div className="field-error">{errs[k]}</div> : null}
    </div>
  );

  return (
    <Modal onClose={busy ? () => undefined : onClose} title={provider ? t('تعديل مقدم خدمة', 'Edit provider') : t('إضافة مقدم خدمة', 'Add provider')} maxWidth="600px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || f.nameAr.trim().length < 2} data-testid="provider-save">{busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ', 'Save')}</button>
      </div>}>
      <div className="field-grid">
        {input('nameAr', t('الاسم بالعربية', 'Arabic name'), 'text', true)}
        {input('nameEn', t('الاسم بالإنجليزية', 'English name'))}
        <div className="form-group span-2">
          <label className="form-label" htmlFor="sp-description">{t('التفاصيل / نبذة', 'Details / description')}</label>
          <textarea id="sp-description" rows={4} maxLength={2000} className={`form-control${errs.description ? ' is-invalid' : ''}`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="sp-description" />
          <div className="form-helper">{t('تظهر للمصنع في صفحة الاختيار وفي البريد: التخصص، الخبرة، طريقة التواصل للحصول على العرض…', 'Shown to the factory on the selection page and in the email: specialty, experience, how to reach the provider for the offer…')}</div>
        </div>
        {input('website', t('الموقع الإلكتروني', 'Website'), 'url')}
        <div className="form-group">
          <span className="form-label">{t('الشعار', 'Logo')}</span>
          <div className="row" style={{ gap: '0.5rem' }}>
            {provider && !logo ? <ProviderLogo logoUrl={provider.logoUrl} name={provider.nameAr} size={44} /> : null}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => file.current?.click()} data-testid="logo-choose">{logo ? logo.name : provider?.hasLogo ? t('استبدال الشعار', 'Replace logo') : t('اختيار صورة', 'Choose image')}</button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" data-testid="logo-input" onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="form-helper">{t('PNG أو JPEG أو WebP حتى 1 ميجابايت.', 'PNG, JPEG or WebP up to 1 MB.')}</div>
          {logoError ? <div className="field-error" role="alert">{logoError}</div> : null}
        </div>
      </div>
      <details style={{ marginTop: '0.6rem' }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.88rem' }}>{t('بيانات اتصال اختيارية (تظهر لـENCPC وPMU فقط)', 'Optional contact data (visible to ENCPC and PMU only)')}</summary>
        <div className="field-grid" style={{ marginTop: '0.5rem' }}>
          {input('contactName', t('مسؤول التواصل', 'Contact person'))}
          {input('contactPhone', t('التليفون', 'Phone'), 'tel')}
          {input('contactEmail', t('البريد', 'Email'), 'email')}
          <div className="form-group span-2"><label className="form-label" htmlFor="sp-notes">{t('ملاحظات داخلية', 'Internal notes')}</label><textarea id="sp-notes" className="form-control" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
      </details>
      {!provider ? <p className="form-helper">{t('يُضاف غير مفعّل: أكمل البيانات والشعار ثم فعّله ليظهر للمصانع.', 'Added as not activated: complete the details and logo, then activate it to show it to factories.')}</p> : null}
      <ErrorBox message={error} />
    </Modal>
  );
};
