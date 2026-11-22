import React, { useState } from 'react';
import { FileSpreadsheet, KeyRound, Plus, RefreshCw, RotateCw } from 'lucide-react';
import { api, type IntegrationKey, type IntegrationScope } from '../../api';
import { errorText, useStore } from '../../store/state';
import { useAsync, formatDate, formatNumber } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { AdminPageHeader } from './AdminLayout';
import { SecretOnce } from './AccountsViews';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { downloadExcel } from '../../utils/reports';
import { useToast } from '../common/ToastSystem';

const Pager: React.FC<{ page: number; totalPages: number; onPage: (p: number) => void }> = ({ page, totalPages, onPage }) => {
  const { t, isAr } = useStore();
  if (totalPages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'center', marginTop: '0.8rem' }}>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('السابق', 'Previous')}</button>
      <span>{formatNumber(page, isAr)} / {formatNumber(totalPages, isAr)}</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>{t('التالي', 'Next')}</button>
    </div>
  );
};

/** سجل التدقيق (append-only): عرض بصفحات + تصدير Excel (التصدير نفسه يُدقَّق). */
export const AuditLogsView: React.FC = () => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const res = useAsync(() => api.adminAuditLogs({ page, pageSize: 50, q: q.trim() || undefined }), [page, q]);
  const [exporting, setExporting] = useState(false);

  const exportAll = async () => {
    setExporting(true);
    try {
      const rows: Array<Array<string | null>> = [];
      for (let p = 1; p <= 40; p++) {
        const r = await api.adminAuditLogs({ page: p, pageSize: 500, q: q.trim() || undefined });
        rows.push(...r.items.map((l) => [l.at, l.actorType, l.actorName, l.actorRole, l.action, l.entityType, l.entityId, l.applicationId, l.summaryAr, l.ip, JSON.stringify(l.details)]));
        if (p >= r.totalPages) break;
      }
      await downloadExcel(`shams-audit-${new Date().toISOString().slice(0, 10)}.xlsx`, ['at', 'actorType', 'actorName', 'actorRole', 'action', 'entityType', 'entityId', 'applicationId', 'summaryAr', 'ip', 'details'], rows, 'Audit');
      await api.adminLogAuditExport('xlsx', rows.length);
    } catch (e) { toast('error', errorText(e, isAr)); } finally { setExporting(false); }
  };

  return (
    <>
      <AdminPageHeader title={t('سجل التدقيق', 'Audit log')} description={t('سجل غير قابل للتعديل أو الحذف لكل كتابة حساسة.', 'An append-only record of every sensitive write.')}
        actions={<button type="button" className="btn btn-primary" onClick={exportAll} disabled={exporting}><FileSpreadsheet size={16} /> {exporting ? t('جارٍ التصدير…', 'Exporting…') : t('تصدير Excel', 'Export Excel')}</button>} />
      <div className="toolbar"><input className="form-control" placeholder={t('بحث بالإجراء أو المستخدم أو المعرف', 'Search action, user or id')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      <div className="card" style={{ padding: 0 }}>
        {res.loading && !res.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : res.error ? <ErrorState message={res.error} onRetry={res.reload} />
          : !res.data?.items.length ? <Empty title={t('لا توجد سجلات', 'No entries')} /> : (
            <div className="table-responsive">
              <table className="eng-table">
                <thead><tr><th>{t('الوقت', 'Time')}</th><th>{t('الفاعل', 'Actor')}</th><th>{t('الإجراء', 'Action')}</th><th>{t('الوصف', 'Summary')}</th><th>IP</th></tr></thead>
                <tbody>
                  {res.data.items.map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(l.at, isAr, true)}</td>
                      <td>{l.actorName || l.actorType}<div className="doc-meta">{l.actorRole}</div></td>
                      <td dir="ltr" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{l.action}</td>
                      <td>{l.summaryAr}</td>
                      <td dir="ltr" style={{ fontSize: '0.75rem' }}>{l.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {res.data ? <Pager page={page} totalPages={res.data.totalPages} onPage={setPage} /> : null}
    </>
  );
};

/** مفاتيح الربط بأدمن المنصة الأصلية: إنشاء (يظهر مرة) وإلغاء وتدوير. */
export const IntegrationKeysView: React.FC = () => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const res = useAsync(() => api.adminIntegrationKeys(), []);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: IntegrationKey; op: 'revoke' | 'rotate' } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.op === 'revoke') await api.adminRevokeIntegrationKey(pending.key.id);
      else setSecret((await api.adminRotateIntegrationKey(pending.key.id)).plaintextKey);
      setPending(null); await res.reload();
    } catch (e) { toast('error', errorText(e, isAr)); } finally { setBusy(false); }
  };

  return (
    <>
      <AdminPageHeader title={t('مفاتيح الربط', 'Integration keys')} description={t('مفاتيح API الربط /api/integration/v1 — تُخزن مجزأة، ولا يوجد نطاق يتخذ قرارات على الطلبات.', 'Keys for /api/integration/v1 — stored hashed; no scope can decide on applications.')}
        actions={<button type="button" className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> {t('مفتاح جديد', 'New key')}</button>} />
      <div className="card" style={{ padding: 0 }}>
        {res.loading && !res.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : res.error ? <ErrorState message={res.error} onRetry={res.reload} />
          : !res.data?.items.length ? <Empty title={t('لا توجد مفاتيح', 'No keys')} /> : (
            <div className="table-responsive">
              <table className="eng-table">
                <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('البادئة', 'Prefix')}</th><th>{t('النطاقات', 'Scopes')}</th><th>{t('الحد/دقيقة', 'Limit/min')}</th><th>{t('آخر استخدام', 'Last used')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
                <tbody>
                  {res.data.items.map((k) => (
                    <tr key={k.id}>
                      <td><KeyRound size={14} /> {k.name}</td>
                      <td dir="ltr" style={{ fontFamily: 'var(--font-mono)' }}>shk_{k.keyPrefix}_…</td>
                      <td dir="ltr" style={{ fontSize: '0.78rem' }}>{k.scopes.join(', ')}</td>
                      <td>{k.rateLimitPerMinute}</td>
                      <td>{formatDate(k.lastUsedAt, isAr, true)}</td>
                      <td><Badge status={k.revokedAt ? 'rejected' : 'active'}>{k.revokedAt ? t('ملغى', 'Revoked') : t('فعال', 'Active')}</Badge></td>
                      <td className="row" style={{ gap: '0.3rem' }}>
                        {!k.revokedAt ? <>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending({ key: k, op: 'rotate' })}><RotateCw size={14} /> {t('تدوير', 'Rotate')}</button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ key: k, op: 'revoke' })}>{t('إلغاء', 'Revoke')}</button>
                        </> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {creating && res.data ? <CreateKey scopes={res.data.scopes} onClose={() => setCreating(false)} onCreated={async (s) => { setCreating(false); setSecret(s); await res.reload(); }} /> : null}
      {secret ? <SecretOnce title={t('مفتاح الربط', 'Integration key')} secret={secret} hint={t('انسخ المفتاح الآن وأدخله في إعدادات المنصة — لن يظهر مرة أخرى.', 'Copy the key now and configure it in the platform — it will not be shown again.')} onClose={() => setSecret(null)} /> : null}
      {pending ? (
        <ConfirmDialog title={pending.op === 'revoke' ? t('إلغاء المفتاح', 'Revoke key') : t('تدوير المفتاح', 'Rotate key')} danger
          message={pending.op === 'revoke' ? t('سيتوقف المفتاح فورًا.', 'The key stops working immediately.') : t('سيُنشأ مفتاح جديد بنفس النطاقات ويُلغى الحالي فورًا.', 'A new key with the same scopes is created and the current one revoked immediately.')}
          confirmLabel={t('تأكيد', 'Confirm')} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void apply()} />
      ) : null}
    </>
  );
};

const CreateKey: React.FC<{ scopes: IntegrationScope[]; onClose: () => void; onCreated: (plaintext: string) => Promise<void> }> = ({ scopes, onClose, onCreated }) => {
  const { isAr, t } = useStore();
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<IntegrationScope[]>(['read']);
  const [rate, setRate] = useState(60);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await api.adminCreateIntegrationKey({ name: name.trim(), scopes: chosen, rateLimitPerMinute: rate }); await onCreated(r.plaintextKey); }
    catch (e) { setError(errorText(e, isAr)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={t('مفتاح ربط جديد', 'New integration key')} maxWidth="520px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}><button type="button" className="btn btn-secondary" onClick={onClose}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn btn-primary" disabled={busy || name.trim().length < 2 || !chosen.length} onClick={() => void save()}>{t('إنشاء', 'Create')}</button></div>}>
      <div className="form-group"><label className="form-label required" htmlFor="k-name">{t('الاسم', 'Name')}</label><input id="k-name" className="form-control" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="form-group">
        <div className="form-label required">{t('النطاقات', 'Scopes')}</div>
        {scopes.map((s) => (
          <label key={s} className="row" style={{ fontSize: '0.86rem' }}>
            <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} /> <span dir="ltr">{s}</span>
          </label>
        ))}
      </div>
      <div className="form-group"><label className="form-label" htmlFor="k-rate">{t('الحد في الدقيقة', 'Requests per minute')}</label><input id="k-rate" type="number" min={1} max={10000} className="form-control num-ltr" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></div>
      <ErrorBox message={error} />
    </Modal>
  );
};

/** سجل الإشعارات والـwebhooks: عرض الفشل والمتخطى وإعادة المحاولة (بلا محتوى الرسائل). */
/** M6: تسميات مقروءة لسجل الإشعارات بدل المفاتيح البرمجية. */
const TEMPLATE_LABELS: Record<string, { ar: string; en: string }> = {
  'auth.verify_email': { ar: 'تفعيل الحساب', en: 'Account activation' },
  'auth.reset_password': { ar: 'استعادة كلمة المرور', en: 'Password reset' },
  'auth.email_changed_old': { ar: 'إبلاغ البريد القديم بالتغيير', en: 'Email changed (old address)' },
  'auth.email_changed_new': { ar: 'تفعيل البريد الجديد', en: 'Activate new email' },
  'app.registry_failed': { ar: 'تعذر التحقق من السجل', en: 'Registry check failed' },
  'app.submitted': { ar: 'إيصال استلام الطلب', en: 'Submission receipt' },
  'app.review_assigned': { ar: 'طلب بانتظار المراجعة', en: 'Awaiting review' },
  'app.resubmitted': { ar: 'إعادة تقديم', en: 'Resubmitted' },
  'app.correction_requested': { ar: 'طلب استيفاء', en: 'Correction requested' },
  'app.rejected': { ar: 'رفض الطلب', en: 'Rejected' },
  'app.imc_accepted': { ar: 'قبول IMC', en: 'IMC acceptance' },
  'app.encpc_compliant': { ar: 'قبول فني', en: 'Technically compliant' },
  'app.offer_accepted': { ar: 'قبول العرض الفني', en: 'Offer accepted' },
  'app.provider_suspended': { ar: 'إيقاف مقدم الخدمة', en: 'Provider suspended' },
  'app.provider_selected': { ar: 'تأكيد اختيار مقدم الخدمة', en: 'Provider choice confirmed' },
  'app.offer_received': { ar: 'استلام العرض الفني', en: 'Offer received' },
  'app.electricity_received': { ar: 'استلام موافقة الكهرباء', en: 'Electricity approval received' },
  'app.electricity_accepted': { ar: 'قبول الكهرباء — اختر البنك', en: 'Electricity accepted — choose the bank' },
  'app.bank_selected': { ar: 'تأكيد اختيار البنك', en: 'Bank choice confirmed' },
  // سجل تاريخي (مراحل ملغاة — G-02)
  'app.bank_referred': { ar: 'إحالة للبنك (مرحلة ملغاة)', en: 'Bank referral (retired)' },
  'app.bank_reassigned': { ar: 'إعادة الإحالة لبنك آخر (مرحلة ملغاة)', en: 'Re-referred to another bank (retired)' },
  'app.bank_result': { ar: 'نتيجة دراسة البنك (مرحلة ملغاة)', en: 'Bank study result (retired)' },
  'app.closed': { ar: 'إغلاق الطلب', en: 'Application closed' },
  'app.sla_overdue': { ar: 'تأخر عن المهلة', en: 'Overdue' },
  'ops.no_recipients': { ar: 'تنبيه: جهة بلا مستخدمين', en: 'Alert: organization without users' },
  'ops.no_providers': { ar: 'تنبيه: لا مقدمي خدمة معتمدين', en: 'Alert: no approved providers' },
  'ops.registry_conflict': { ar: 'تنبيه: تعارض رقم السجل', en: 'Alert: registry number conflict' },
  'ops.contract_amount_alert': { ar: 'تنبيه: قيمة تعاقد مرتفعة', en: 'Alert: high contract amount' },
  'ops.bank_unavailable': { ar: 'تنبيه: بنك موقوف بطلبات مفتوحة', en: 'Alert: bank disabled with open applications' },
};
const STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  pending: { ar: 'في الطابور', en: 'Queued' }, sending: { ar: 'جارٍ الإرسال', en: 'Sending' }, sent: { ar: 'أُرسلت', en: 'Sent' },
  delivered: { ar: 'سُلِّمت', en: 'Delivered' }, failed: { ar: 'فشلت', en: 'Failed' }, skipped: { ar: 'متخطاة', en: 'Skipped' },
};
const SKIP_LABELS: Record<string, { ar: string; en: string }> = {
  mail_not_configured: { ar: 'البريد غير مضبوط', en: 'Mail not configured' },
  sms_provider_not_configured: { ar: 'مزود SMS غير مضبوط', en: 'SMS provider not configured' },
  not_delivered_outside_production: { ar: 'لم تُرسل خارج الإنتاج (MAIL_REDIRECT_TO غير مضبوط)', en: 'Not delivered outside production (MAIL_REDIRECT_TO not set)' },
};
const CHANNEL_LABELS: Record<string, { ar: string; en: string }> = { email: { ar: 'بريد', en: 'Email' }, sms: { ar: 'SMS', en: 'SMS' } };
const lbl = (map: Record<string, { ar: string; en: string }>, k: string, isAr: boolean) => (map[k] ? (isAr ? map[k].ar : map[k].en) : k);

export const OutboxView: React.FC = () => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const [kind, setKind] = useState<'notifications' | 'webhooks'>('notifications');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const notif = useAsync(() => (kind === 'notifications' ? api.adminNotifications({ page, status: status || undefined }) : Promise.resolve(null)), [kind, page, status]);
  const hooks = useAsync(() => (kind === 'webhooks' ? api.adminWebhooks({ page, status: status || undefined }) : Promise.resolve(null)), [kind, page, status]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const retry = async (id: string) => {
    if (retrying) return;
    setRetrying(id);
    try {
      if (kind === 'notifications') { await api.adminRetryNotification(id); await notif.reload(); } else { await api.adminRetryWebhook(id); await hooks.reload(); }
      toast('success', t('أُعيد إلى الطابور.', 'Re-queued.'));
    } catch (e) { toast('error', errorText(e, isAr)); } finally { setRetrying(null); }
  };
  const statuses = kind === 'notifications' ? ['pending', 'sent', 'failed', 'skipped'] : ['pending', 'delivered', 'failed', 'skipped'];
  const cur = kind === 'notifications' ? notif : hooks;
  return (
    <>
      <AdminPageHeader title={t('سجل الإشعارات', 'Notification log')} description={t('البريد وSMS والـwebhooks. «متخطى» يعني عدم ضبط المزود (مثل SMS).', 'Email, SMS and webhooks. “Skipped” means the provider is not configured (e.g. SMS).')}
        actions={<button type="button" className="btn btn-secondary" onClick={() => void cur.reload()}><RefreshCw size={15} /> {t('تحديث', 'Refresh')}</button>} />
      <div className="tabs">
        <button type="button" className={`tab${kind === 'notifications' ? ' active' : ''}`} onClick={() => { setKind('notifications'); setPage(1); setStatus(''); }}>{t('البريد وSMS', 'Email & SMS')}</button>
        <button type="button" className={`tab${kind === 'webhooks' ? ' active' : ''}`} onClick={() => { setKind('webhooks'); setPage(1); setStatus(''); }}>Webhooks</button>
        <select className="form-control" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={t('الحالة', 'Status')}>
          <option value="">{t('كل الحالات', 'All statuses')}</option>
          {statuses.map((s) => <option key={s} value={s}>{lbl(STATUS_LABELS, s, isAr)}</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {cur.loading && !cur.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : cur.error ? <ErrorState message={cur.error} onRetry={cur.reload} />
          : kind === 'notifications' && notif.data ? (
            !notif.data.items.length ? <Empty title={t('لا توجد رسائل', 'No messages')} /> : (
              <div className="table-responsive">
                <table className="eng-table">
                  <thead><tr><th>{t('الوقت', 'Time')}</th><th>{t('الطلب', 'Application')}</th><th>{t('القناة', 'Channel')}</th><th>{t('الرسالة', 'Message')}</th><th>{t('المستلم', 'Recipient')}</th><th>{t('الحالة', 'Status')}</th><th>{t('المحاولات', 'Attempts')}</th><th>{t('الخطأ', 'Error')}</th><th /></tr></thead>
                  <tbody>
                    {notif.data.items.map((n) => (
                      <tr key={n.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(n.createdAt, isAr, true)}</td>
                        <td className="num-ltr">{n.applicationNumber ?? (n.applicationId ? t('مسودة', 'Draft') : '—')}</td>
                        <td>{lbl(CHANNEL_LABELS, n.channel, isAr)}</td><td>{lbl(TEMPLATE_LABELS, n.templateKey, isAr)}</td>
                        <td dir="ltr" style={{ fontSize: '0.8rem' }}>{n.recipientAddress}</td><td><Badge status={n.status}>{lbl(STATUS_LABELS, n.status, isAr)}</Badge>{n.skipReason ? <div className="doc-meta">{lbl(SKIP_LABELS, n.skipReason, isAr)}</div> : null}</td>
                        <td>{n.attempts}</td><td dir="ltr" style={{ fontSize: '0.75rem', maxWidth: 220 }}>{n.lastError || '—'}</td>
                        <td>{['failed', 'skipped'].includes(n.status) ? <button type="button" className="btn btn-ghost btn-sm" disabled={retrying !== null} onClick={() => void retry(n.id)} data-testid={`retry-${n.id}`}>{retrying === n.id ? t('جارٍ…', '…') : t('إعادة', 'Retry')}</button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : hooks.data ? (
            !hooks.data.items.length ? <Empty title={t('لا توجد أحداث', 'No events')} hint={t('تُسجل الأحداث «متخطاة» عند عدم ضبط PLATFORM_WEBHOOK_URL.', 'Events are recorded as skipped when PLATFORM_WEBHOOK_URL is not set.')} /> : (
              <div className="table-responsive">
                <table className="eng-table">
                  <thead><tr><th>{t('الوقت', 'Time')}</th><th>Event ID</th><th>{t('الانتقال', 'Transition')}</th><th>{t('الحالة', 'Status')}</th><th>{t('المحاولات', 'Attempts')}</th><th>HTTP</th><th /></tr></thead>
                  <tbody>
                    {hooks.data.items.map((w) => {
                      const d = (w.payload as { data?: { fromState?: string; toState?: string; number?: string } }).data;
                      return (
                        <tr key={w.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(w.createdAt, isAr, true)}</td><td dir="ltr" style={{ fontSize: '0.72rem' }}>{w.eventId}</td>
                          <td dir="ltr" style={{ fontSize: '0.78rem' }}>{d?.number ?? ''} {d?.fromState} → {d?.toState}</td>
                          <td><Badge status={w.status}>{lbl(STATUS_LABELS, w.status, isAr)}</Badge></td><td>{w.attempts}</td><td>{w.lastStatusCode ?? '—'}</td>
                          <td>{['failed', 'skipped'].includes(w.status) ? <button type="button" className="btn btn-ghost btn-sm" disabled={retrying !== null} onClick={() => void retry(w.id)} data-testid={`retry-${w.id}`}>{retrying === w.id ? t('جارٍ…', '…') : t('إعادة', 'Retry')}</button> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
      </div>
      {cur.data ? <Pager page={page} totalPages={cur.data.totalPages} onPage={setPage} /> : null}
    </>
  );
};
