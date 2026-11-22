import React, { useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { api, ApiException, type AccountRequest, type Organization, type RecoveryRequest, type Role, type User } from '../../api';
import { errorDetails, errorText, useStore } from '../../store/state';
import { useAsync, formatDate, formatNumber } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { AdminPageHeader } from './AdminLayout';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PdfUploader } from '../ui/PdfUploader';
import { useToast } from '../common/ToastSystem';

// G-02: لا حسابات للبنوك — البنك جهة خارجية تُضاف من «الجهات والبنوك» فقط.
const STAFF_ROLES: Role[] = ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'system_admin'];
const ROLE_ORG: Record<Role, string> = { imc_reviewer: 'imc', encpc_reviewer: 'encpc', pmu_reviewer: 'pmu', bank_reviewer: 'bank', system_admin: 'admin', factory_owner: 'factory' };

/** كلمة المرور المؤقتة تظهر مرة واحدة. */
const SecretOnce: React.FC<{ title: string; secret: string; hint: string; onClose: () => void }> = ({ title, secret, hint, onClose }) => {
  const { t } = useStore();
  const { toast } = useToast();
  return (
    <Modal onClose={onClose} title={title} maxWidth="520px" footer={<button type="button" className="btn btn-primary" onClick={onClose}>{t('تم', 'Done')}</button>}>
      <p style={{ fontSize: '0.88rem' }}>{hint}</p>
      <div className="secret-box" data-testid="secret-value">{secret}</div>
      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.6rem' }} onClick={() => { void navigator.clipboard?.writeText(secret); toast('info', t('تم النسخ.', 'Copied.')); }}><Copy size={14} /> {t('نسخ', 'Copy')}</button>
    </Modal>
  );
};

export const AccountsView: React.FC = () => {
  const { isAr, t, meta } = useStore();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const res = useAsync(() => api.adminUsers({ page, q: q.trim() || undefined, role: role || undefined }), [page, q, role]);
  const [creating, setCreating] = useState(false);
  const [toggle, setToggle] = useState<User | null>(null);
  const [reset, setReset] = useState<User | null>(null);
  const [recover, setRecover] = useState<User | null>(null);
  /** I4: رسالة السيرفر بعدد الطلبات المفتوحة — يُطلب تأكيد صريح ثانٍ. */
  const [openLoad, setOpenLoad] = useState<{ user: User; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const roleLabel = (r: Role) => (meta ? (isAr ? meta.roles[r].ar : meta.roles[r].en) : r);

  const doToggle = async () => {
    if (!toggle) return;
    setBusy(true);
    try { await api.adminUpdateUser(toggle.id, { isActive: !toggle.isActive }); setToggle(null); await res.reload(); }
    catch (e) {
      if (e instanceof ApiException && e.apiError.code === 'OPEN_REFERRALS') { setOpenLoad({ user: toggle, message: errorText(e, isAr) }); setToggle(null); }
      else toast('error', errorText(e, isAr));
    } finally { setBusy(false); }
  };
  const confirmLoad = async () => {
    if (!openLoad) return;
    setBusy(true);
    try { await api.adminUpdateUser(openLoad.user.id, { isActive: false, confirmOpenReferrals: true }); setOpenLoad(null); await res.reload(); } catch (e) { toast('error', errorText(e, isAr)); } finally { setBusy(false); }
  };
  const doReset = async () => {
    if (!reset) return;
    setBusy(true);
    try { await api.adminResetPassword(reset.id); setReset(null); toast('success', t('أُرسل رابط تعيين كلمة المرور إلى بريد الحساب وأُنهيت جلساته.', 'A password setup link was sent to the account email and its sessions were ended.')); await res.reload(); } catch (e) { toast('error', errorText(e, isAr)); } finally { setBusy(false); }
  };

  return (
    <>
      <AdminPageHeader title={t('الحسابات', 'Accounts')} description={t('الأدمن يسجل طلب الحساب، ولا يُنشأ حساب جهة قرار إلا بعد موافقة مستخدم نشط من الجهة نفسها، ويعيّن صاحبه كلمة مروره برابط على بريده. المصانع تسجل بنفسها.', 'The admin files the account request; a decision-body account exists only after an active user of that organization approves it, and its owner sets the password through a link sent by email. Factories self-register.')}
        actions={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="add-user"><Plus size={16} /> {t('إضافة حساب', 'Add account')}</button>} />
      <PendingPanel />
      <div className="toolbar">
        <input className="form-control" placeholder={t('بحث بالاسم أو البريد', 'Search name or email')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <select className="form-control" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">{t('كل الأدوار', 'All roles')}</option>
          {[...STAFF_ROLES, 'factory_owner' as Role].map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {res.loading && !res.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : res.error ? <ErrorState message={res.error} onRetry={res.reload} />
          : !res.data?.items.length ? <Empty title={t('لا توجد حسابات', 'No accounts')} /> : (
            <div className="table-responsive">
              <table className="eng-table">
                <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('البريد', 'Email')}</th><th>{t('الدور', 'Role')}</th><th>{t('الجهة', 'Organization')}</th><th>{t('الحالة', 'Status')}</th><th>{t('آخر دخول', 'Last sign-in')}</th><th /></tr></thead>
                <tbody>
                  {res.data.items.map((u) => (
                    <tr key={u.id}>
                      <td>{u.nameAr}</td><td dir="ltr">{u.email}</td><td>{roleLabel(u.role)}</td><td>{isAr ? u.organizationNameAr : u.organizationNameEn}</td>
                      <td><Badge status={u.isActive ? 'active' : 'suspended'}>{u.isActive ? t('نشط', 'Active') : t('موقوف', 'Disabled')}</Badge>{!u.emailVerified ? <span className="badge badge-pending" style={{ marginInlineStart: 4 }}>{t('لم يُفعَّل', 'Not activated')}</span> : null}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(u.lastLoginAt, isAr, true)}</td>
                      <td className="cell-actions"><div className="row" style={{ gap: '0.3rem' }}>
                        {u.role === 'factory_owner' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRecover(u)} data-testid={`recover-${u.id}`}>{t('طلب استرداد (تغيير البريد)', 'Recovery request (change email)')}</button> : null}
                        {u.role !== 'factory_owner' ? <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReset(u)}>{t('إرسال رابط تعيين كلمة المرور', 'Send password setup link')}</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setToggle(u)}>{u.isActive ? t('إيقاف', 'Disable') : t('تفعيل', 'Enable')}</button>
                        </> : null}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {res.data && res.data.totalPages > 1 ? (
        <div className="row" style={{ justifyContent: 'center', marginTop: '0.8rem' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('السابق', 'Previous')}</button>
          <span>{formatNumber(page, isAr)} / {formatNumber(res.data.totalPages, isAr)}</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={page >= res.data.totalPages} onClick={() => setPage(page + 1)}>{t('التالي', 'Next')}</button>
        </div>
      ) : null}
      {creating ? <CreateUser onClose={() => setCreating(false)} onCreated={async (msg) => { setCreating(false); toast('success', msg); await res.reload(); }} /> : null}
      {toggle ? <ConfirmDialog title={toggle.isActive ? t('إيقاف الحساب', 'Disable account') : t('تفعيل الحساب', 'Enable account')} danger={toggle.isActive} message={`${toggle.nameAr} — ${toggle.email}`} confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setToggle(null)} onConfirm={() => void doToggle()} /> : null}
      {recover ? <RecoverFactory user={recover} onClose={() => setRecover(null)} onDone={async () => { setRecover(null); await res.reload(); }} /> : null}
      {openLoad ? <ConfirmDialog title={t('تأكيد إيقاف آخر مستخدم في البنك', 'Confirm disabling the last bank user')} danger message={openLoad.message} confirmLabel={t('إيقاف رغم الطلبات المفتوحة', 'Disable anyway')} busy={busy} onCancel={() => setOpenLoad(null)} onConfirm={() => void confirmLoad()} /> : null}
      {reset ? <ConfirmDialog title={t('إرسال رابط تعيين كلمة المرور', 'Send a password setup link')} message={t('تُبطل كلمة المرور الحالية وتُنهى جلسات المستخدم، ويصل رابط التعيين لبريد الحساب الحالي فقط، ويُبلَّغ صاحبه وجهته وPMU.', 'The current password is invalidated and sessions end; the setup link goes to the current email only, and the owner, their organization and the PMU are notified.')} confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setReset(null)} onConfirm={() => void doReset()} /> : null}
    </>
  );
};

const CreateUser: React.FC<{ onClose: () => void; onCreated: (message: string) => Promise<void> }> = ({ onClose, onCreated }) => {
  const { isAr, t, meta } = useStore();
  const orgs = useAsync(() => api.adminOrganizations(), []);
  const [f, setF] = useState({ email: '', nameAr: '', nameEn: '', phone: '', role: 'imc_reviewer' as Role, organizationId: '' });
  const [error, setError] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const matching = (orgs.data ?? []).filter((o) => o.type === ROLE_ORG[f.role] && o.isActive);
  const orgId = f.organizationId || (matching.length === 1 ? matching[0].id : '');
  const save = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.adminCreateUser({ email: f.email.trim(), nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim() || undefined, phone: f.phone.trim() || undefined, role: f.role, organizationId: orgId });
      await onCreated(r.request
        ? t('سُجّل الطلب — بانتظار موافقة مستخدم نشط من الجهة نفسها.', 'Request filed — awaiting approval from an active user of the organization.')
        : t('أُنشئ الحساب — أُرسل رابط تعيين كلمة المرور إلى بريده.', 'Account created — a password setup link was sent to its email.'));
    } catch (e) { setError(errorText(e, isAr)); setErrs(errorDetails(e, isAr)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={t('طلب حساب جديد', 'New account request')} maxWidth="560px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}><button type="button" className="btn btn-secondary" onClick={onClose}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn btn-primary" disabled={busy || !orgId || !f.email || !f.nameAr} onClick={() => void save()} data-testid="create-user">{t('تسجيل الطلب', 'File request')}</button></div>}>
      <div className="field-grid">
        <div className="form-group"><label className="form-label required" htmlFor="u-role">{t('الدور', 'Role')}</label>
          <select id="u-role" className="form-control" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role, organizationId: '' })}>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{meta ? (isAr ? meta.roles[r].ar : meta.roles[r].en) : r}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label required" htmlFor="u-org">{t('الجهة', 'Organization')}</label>
          <select id="u-org" className="form-control" value={orgId} onChange={(e) => setF({ ...f, organizationId: e.target.value })}>
            <option value="">{t('— اختر —', '— Select —')}</option>
            {matching.map((o) => <option key={o.id} value={o.id}>{isAr ? o.nameAr : o.nameEn}</option>)}
          </select>
        </div>
        <div className="form-group"><label className="form-label required" htmlFor="u-email">{t('البريد', 'Email')}</label><input id="u-email" dir="ltr" type="email" className={`form-control${errs.email ? ' is-invalid' : ''}`} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="form-group"><label className="form-label required" htmlFor="u-name">{t('الاسم بالعربية', 'Arabic name')}</label><input id="u-name" className="form-control" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="u-nameEn">{t('الاسم بالإنجليزية', 'English name')}</label><input id="u-nameEn" className="form-control" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="u-phone">{t('الموبايل (لإشعارات SMS)', 'Mobile (for SMS)')}</label><input id="u-phone" dir="ltr" type="tel" className="form-control" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      </div>
      <ErrorBox message={error} />
    </Modal>
  );
};

export const OrganizationsView: React.FC = () => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const res = useAsync(() => api.adminOrganizations(), []);
  const [adding, setAdding] = useState(false);
  const [toggle, setToggle] = useState<Organization | null>(null);
  const [openLoad, setOpenLoad] = useState<{ org: Organization; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const typeLabel = (ty: string) => ({ imc: 'IMC', encpc: 'ENCPC', pmu: 'PMU', bank: t('بنك', 'Bank'), admin: t('إدارة النظام', 'Administration'), factory: t('مصنع', 'Factory') }[ty] ?? ty);
  const doToggle = async () => {
    if (!toggle) return;
    setBusy(true);
    try { await api.adminUpdateOrganization(toggle.id, { isActive: !toggle.isActive }); setToggle(null); await res.reload(); }
    catch (e) {
      if (e instanceof ApiException && e.apiError.code === 'OPEN_REFERRALS') { setOpenLoad({ org: toggle, message: errorText(e, isAr) }); setToggle(null); }
      else toast('error', errorText(e, isAr));
    } finally { setBusy(false); }
  };
  const confirmLoad = async () => {
    if (!openLoad) return;
    setBusy(true);
    try { await api.adminUpdateOrganization(openLoad.org.id, { isActive: false, confirmOpenReferrals: true }); setOpenLoad(null); await res.reload(); } catch (e) { toast('error', errorText(e, isAr)); } finally { setBusy(false); }
  };
  return (
    <>
      <AdminPageHeader title={t('الجهات والبنوك', 'Organizations & banks')} description={t('الجهات الهيكلية ثابتة. يضيف الأدمن البنوك المشاركة.', 'Structural organizations are fixed. The admin adds participating banks.')}
        actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> {t('إضافة بنك', 'Add bank')}</button>} />
      <div className="card" style={{ padding: 0 }}>
        {res.loading && !res.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : res.error ? <ErrorState message={res.error} onRetry={res.reload} /> : (
          <div className="table-responsive">
            <table className="eng-table">
              <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('النوع', 'Type')}</th><th>{t('البريد', 'Email')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
              <tbody>
                {(res.data ?? []).map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.nameAr}</b><div className="doc-meta">{o.nameEn}</div></td>
                    <td>{typeLabel(o.type)}{o.isStructural ? <span className="badge badge-info" style={{ marginInlineStart: 4 }}>{t('هيكلية', 'Structural')}</span> : null}</td>
                    <td dir="ltr">{o.contactEmail || '—'}</td>
                    <td><Badge status={o.isActive ? 'active' : 'suspended'}>{o.isActive ? t('نشطة', 'Active') : t('موقوفة', 'Inactive')}</Badge></td>
                    <td>{!o.isStructural ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setToggle(o)}>{o.isActive ? t('إيقاف', 'Deactivate') : t('تفعيل', 'Activate')}</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openLoad ? <ConfirmDialog title={t('تأكيد إيقاف بنك له طلبات مفتوحة', 'Confirm disabling a bank with open applications')} danger message={openLoad.message} confirmLabel={t('إيقاف رغم الطلبات المفتوحة', 'Disable anyway')} busy={busy} onCancel={() => setOpenLoad(null)} onConfirm={() => void confirmLoad()} /> : null}
      {adding ? <AddBank onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await res.reload(); }} /> : null}
      {toggle ? <ConfirmDialog title={t('تغيير حالة الجهة', 'Change organization status')} danger={toggle.isActive} message={toggle.nameAr} confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setToggle(null)} onConfirm={() => void doToggle()} /> : null}
    </>
  );
};

const AddBank: React.FC<{ onClose: () => void; onDone: () => Promise<void> }> = ({ onClose, onDone }) => {
  const { isAr, t, store } = useStore();
  const [f, setF] = useState({ nameAr: '', nameEn: '', contactEmail: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError('');
    try { await api.adminCreateOrganization({ type: 'bank', nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim(), contactEmail: f.contactEmail.trim() || undefined }); await store.reloadMeta(); await onDone(); }
    catch (e) { setError(errorText(e, isAr)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={t('إضافة بنك مشارك', 'Add participating bank')} maxWidth="480px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}><button type="button" className="btn btn-secondary" onClick={onClose}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn btn-primary" disabled={busy || f.nameAr.trim().length < 2 || f.nameEn.trim().length < 2} onClick={() => void save()}>{t('إضافة', 'Add')}</button></div>}>
      <div className="form-group"><label className="form-label required" htmlFor="b-ar">{t('الاسم بالعربية', 'Arabic name')}</label><input id="b-ar" className="form-control" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></div>
      <div className="form-group"><label className="form-label required" htmlFor="b-en">{t('الاسم بالإنجليزية', 'English name')}</label><input id="b-en" className="form-control" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></div>
      <div className="form-group"><label className="form-label" htmlFor="b-mail">{t('بريد التواصل', 'Contact email')}</label><input id="b-mail" dir="ltr" type="email" className="form-control" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></div>
      <ErrorBox message={error} />
    </Modal>
  );
};


/**
 * H4: طلب استرداد حساب مصنع بتغيير بريده — مستند PDF رسمي وسبب ومرجع إجباريون.
 * لا يتغير شيء الآن: توافق PMU ثم تبدأ مهلة 48 ساعة يُبلَّغ فيها المالك ويستطيع الإلغاء.
 */
const RecoverFactory: React.FC<{ user: User; onClose: () => void; onDone: () => Promise<void> }> = ({ user, onClose, onDone }) => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState({ newEmail: '', reason: '', requestReference: '' });
  const [file, setFile] = useState<File | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!file) return;
    setBusy(true); setError(''); setErrs({});
    try {
      await api.createRecoveryRequest(user.id, { newEmail: f.newEmail.trim(), reason: f.reason.trim(), requestReference: f.requestReference.trim() }, file);
      toast('success', t('سُجّل طلب الاسترداد — بانتظار موافقة وحدة إدارة المبادرة، وأُبلغ المالك على بريده الحالي.', 'Recovery request filed — awaiting PMU approval; the owner was told on the current email.'));
      await onDone();
    } catch (e) { setError(errorText(e, isAr)); setErrs(errorDetails(e, isAr)); } finally { setBusy(false); }
  };
  const ok = f.newEmail.includes('@') && f.reason.trim().length >= 10 && f.requestReference.trim().length >= 3 && Boolean(file);
  return (
    <Modal onClose={onClose} title={t('طلب استرداد حساب مصنع', 'Factory account recovery request')} maxWidth="560px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}><button type="button" className="btn btn-secondary" onClick={onClose}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn btn-primary" disabled={busy || !ok} onClick={() => void save()} data-testid="recover-submit">{busy ? t('جارٍ التسجيل…', 'Filing…') : t('تسجيل الطلب', 'File request')}</button></div>}>
      <p style={{ fontSize: '0.88rem', lineHeight: 1.9 }}>
        {t(`الحساب الحالي: ${user.email}. لا يتغير شيء الآن: تراجع وحدة إدارة المبادرة الطلب، وبعد موافقتها تبدأ مهلة 48 ساعة يُبلَّغ فيها المالك (بريدًا وSMS) ويستطيع الإلغاء، ثم يُنقل الحساب للبريد الجديد غير مفعّل وتُنهى كل الجلسات. كل خطوة تُسجل في التدقيق.`,
          `Current account: ${user.email}. Nothing changes now: the PMU reviews the request; once approved, a 48-hour waiting period starts in which the owner is notified (email and SMS) and may cancel; then the account moves to the new address (unverified) and all sessions end. Every step is audited.`)}
      </p>
      <div className="form-group"><label className="form-label required" htmlFor="r-email">{t('البريد الجديد', 'New email')}</label><input id="r-email" dir="ltr" type="email" className={`form-control${errs.newEmail ? ' is-invalid' : ''}`} value={f.newEmail} onChange={(e) => setF({ ...f, newEmail: e.target.value })} />{errs.newEmail ? <div className="field-error">{errs.newEmail}</div> : null}</div>
      <div className="form-group"><label className="form-label required" htmlFor="r-ref">{t('مرجع الطلب الرسمي', 'Formal request reference')}</label><input id="r-ref" className="form-control" value={f.requestReference} onChange={(e) => setF({ ...f, requestReference: e.target.value })} placeholder={t('رقم الخطاب أو الطلب', 'Letter or request number')} /></div>
      <div className="form-group"><label className="form-label required" htmlFor="r-reason">{t('السبب', 'Reason')}</label><textarea id="r-reason" rows={3} className="form-control" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /><div className="form-helper">{t('10 أحرف على الأقل.', 'At least 10 characters.')}</div></div>
      <div className="form-group">
        <span className="form-label required">{t('المستند الرسمي (PDF)', 'Official document (PDF)')}</span>
        <PdfUploader testId="recover-file" onFile={(file2) => setFile(file2)} label={file ? file.name : undefined} />
      </div>
      <ErrorBox message={error} />
    </Modal>
  );
};

/** طلبات الحسابات واسترداد البريد: حالتها للأدمن (يقرأ فقط — لا موافقة له). */
const PendingPanel: React.FC = () => {
  const { isAr, t } = useStore();
  const reqs = useAsync(() => api.adminAccountRequests(), []);
  const recs = useAsync(() => api.recoveryRequests(), []);
  const accountOpen = (reqs.data ?? []).filter((r: AccountRequest) => r.status === 'pending');
  const recoveryOpen = (recs.data ?? []).filter((r: RecoveryRequest) => r.status === 'pending_approval' || r.status === 'cooling');
  if (!accountOpen.length && !recoveryOpen.length) return null;
  return (
    <section className="card" style={{ marginBottom: '1rem' }} aria-label={t('طلبات معلقة', 'Pending requests')} data-testid="pending-panel">
      <h2 className="section-title">{t('طلبات بانتظار موافقة الجهات', 'Requests awaiting organization approval')}</h2>
      <ul style={{ margin: 0, paddingInlineStart: '1.2rem', lineHeight: 2 }}>
        {accountOpen.map((r) => (
          <li key={r.id}>{r.kind === 'create_user' ? t('إنشاء حساب', 'New account') : t('تغيير بريد', 'Email change')} — <b>{r.nameAr}</b> <span dir="ltr">({r.email})</span> — {isAr ? r.organizationNameAr : r.organizationNameEn} · {formatDate(r.createdAt, isAr, true)}</li>
        ))}
        {recoveryOpen.map((r) => (
          <li key={r.id}>{t('استرداد حساب مصنع', 'Factory recovery')} — <b>{r.companyName}</b> — {r.status === 'cooling' ? t(`في مهلة الانتظار حتى ${formatDate(r.coolingEndsAt, isAr, true)}`, `waiting period until ${formatDate(r.coolingEndsAt, isAr, true)}`) : t('بانتظار موافقة وحدة إدارة المبادرة', 'awaiting PMU approval')}</li>
        ))}
      </ul>
      <p className="form-helper">{t('الأدمن لا يوافق على هذه الطلبات ولا يستطيع إلغاءها بعد تسجيلها.', 'The admin cannot approve these requests nor cancel them once filed.')}</p>
    </section>
  );
};

export { SecretOnce };
