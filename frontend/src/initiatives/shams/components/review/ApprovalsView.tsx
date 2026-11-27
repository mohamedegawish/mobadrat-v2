import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { api, type AccountRequest, type IntegrationKey, type RecoveryRequest } from '../../api';
import { errorText, useStore, store } from '../../store/state';
import { useAsync, formatDate } from '../../hooks/useAsync';
import { Loading, Empty, ErrorState } from '../common/StateViews';
import { AdminPageHeader } from '../admin/AdminLayout';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../common/ToastSystem';
import { RegistryDisputesPanel } from '../pmu/RegistryDisputesPanel';

/** نافذة سبب إجباري (رفض/إلغاء) — الحد الأدنى 3 أحرف مثل السيرفر. */
const ReasonDialog: React.FC<{ title: string; label: string; confirmLabel: string; min?: number; onCancel: () => void; onConfirm: (reason: string) => Promise<void> }> =
  ({ title, label, confirmLabel, min = 3, onCancel, onConfirm }) => {
    const { isAr, t } = useStore();
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const go = async () => {
      setBusy(true); setError('');
      try { await onConfirm(reason.trim()); } catch (e) { setError(errorText(e, isAr)); } finally { setBusy(false); }
    };
    return (
      <Modal onClose={busy ? () => undefined : onCancel} title={title} maxWidth="480px"
        footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>{t('إلغاء', 'Cancel')}</button>
          <button type="button" className="btn btn-danger" disabled={busy || reason.trim().length < min} onClick={() => void go()} data-testid="reason-confirm">{busy ? t('جارٍ التنفيذ…', 'Working…') : confirmLabel}</button>
        </div>}>
        <div className="form-group">
          <label className="form-label required" htmlFor="reason-text">{label}</label>
          <textarea id="reason-text" rows={3} className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="form-helper">{t(`${min} أحرف على الأقل.`, `At least ${min} characters.`)}</div>
        </div>
        <ErrorBox message={error} />
      </Modal>
    );
  };

type Pending =
  | { kind: 'account'; op: 'approve' | 'reject'; item: AccountRequest }
  | { kind: 'recovery'; op: 'approve' | 'reject' | 'cancel'; item: RecoveryRequest }
  | { kind: 'key'; op: 'approve' | 'reject'; item: IntegrationKey };

const RECOVERY_LABEL: Record<RecoveryRequest['status'], [string, string]> = {
  pending_approval: ['بانتظار موافقتكم', 'Awaiting your approval'], cooling: ['في مهلة الانتظار', 'In the waiting period'],
  executed: ['نُفّذ', 'Executed'], cancelled: ['أُلغي', 'Cancelled'], rejected: ['مرفوض', 'Rejected'],
};

export const ApprovalsView: React.FC = () => {
  const { isAr, t, user } = useStore();
  const { toast } = useToast();
  const isPmu = user?.role === 'pmu_reviewer';
  const isImc = user?.role === 'imc_reviewer';
  // IMC: the applications awaiting its own decision (the server's «mine» queue).
  const queue = useAsync(() => (isImc ? api.listApplications({ mine: '1', pageSize: 50 }) : Promise.resolve(null)), [isImc]);
  const accounts = useAsync(() => api.accountRequests(), []);
  const recoveries = useAsync(() => (isPmu ? api.recoveryRequests() : Promise.resolve([] as RecoveryRequest[])), [isPmu]);
  const keys = useAsync(() => (isPmu ? api.pendingIntegrationKeys() : Promise.resolve([] as IntegrationKey[])), [isPmu]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadAll = async () => { await Promise.all([accounts.reload(), recoveries.reload(), keys.reload()]); };

  const run = async (p: Pending, reason?: string) => {
    if (p.kind === 'account') await api.decideAccountRequest(p.item.id, p.op, reason);
    else if (p.kind === 'recovery') await api.decideRecovery(p.item.id, p.op, p.op === 'approve' ? {} : { reason });
    else await api.decideIntegrationKey(p.item.id, p.op, reason);
    setPending(null);
    toast('success', t('تم تسجيل القرار.', 'Decision recorded.'));
    await reloadAll();
  };
  const confirmSimple = async () => {
    if (!pending) return;
    setBusy(true);
    try { await run(pending); } catch (e) { toast('error', errorText(e, isAr)); setPending(null); } finally { setBusy(false); }
  };

  const downloadDoc = async (r: RecoveryRequest) => {
    try {
      const blob = await api.recoveryDocument(r.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = r.document.originalName || 'document.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast('error', errorText(e, isAr)); }
  };

  const needsReason = pending && ((pending.op === 'reject') || pending.op === 'cancel');
  const acctPending = (accounts.data ?? []).filter((a) => a.status === 'pending');

  return (
    <>
      <AdminPageHeader
        title={t('الموافقات', 'Approvals')}
        description={t((isImc ? 'الطلبات بانتظار مراجعتكم، و' : '') + 'قرارات لا يتخذها من قدّم الطلب: حسابات جهتك الجديدة وتغيير بريدها'
          + (isPmu ? '، ونزاعات أرقام السجل، واسترداد حسابات المصانع، ومفاتيح الربط ذات نطاقات البيانات.' : '.'),
        (isImc ? 'Applications awaiting your review, and ' : '') + 'decisions the requester cannot take: new accounts of your organization and email changes'
          + (isPmu ? ', registry number disputes, factory account recovery, and integration keys with data scopes.' : '.'))} />

      {isImc ? (
        <section className="card" style={{ padding: 0, marginBottom: '1rem' }} aria-labelledby="ap-apps" data-testid="imc-review-queue">
          <h2 id="ap-apps" className="section-title" style={{ padding: '0.9rem 1rem 0' }}>{t('طلبات بانتظار مراجعة IMC', 'Applications awaiting IMC review')}</h2>
          {queue.loading && !queue.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : queue.error ? <ErrorState message={queue.error} onRetry={queue.reload} />
            : !queue.data?.items.length ? <Empty title={t('لا توجد طلبات بانتظار مراجعتكم', 'No applications awaiting your review')} /> : (
              <div className="table-responsive">
                <table className="eng-table">
                  <thead><tr><th>{t('رقم الطلب', 'Number')}</th><th>{t('المصنع', 'Factory')}</th><th>{t('المحافظة', 'Governorate')}</th><th>{t('الحالة', 'Status')}</th><th>{t('منذ', 'Since')}</th><th /></tr></thead>
                  <tbody>
                    {queue.data.items.map((a) => (
                      <tr key={a.id}>
                        <td dir="ltr">{a.number ?? '—'}</td>
                        <td><b>{a.companyName}</b></td>
                        <td>{a.governorate}</td>
                        <td><Badge status={a.state}>{isAr ? a.stateLabelAr : a.stateLabelEn}</Badge>{a.overdue ? <div className="doc-meta">{t('متأخر', 'Overdue')}</div> : null}</td>
                        <td>{formatDate(a.stateEnteredAt, isAr, true)}</td>
                        <td><button type="button" className="btn btn-primary btn-sm" onClick={() => store.navigate('application', a.id)}>{t('مراجعة', 'Review')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      ) : null}

      <section className="card" style={{ padding: 0, marginBottom: '1rem' }} aria-labelledby="ap-accounts">
        <h2 id="ap-accounts" className="section-title" style={{ padding: '0.9rem 1rem 0' }}>{t('طلبات الحسابات', 'Account requests')}</h2>
        {accounts.loading && !accounts.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : accounts.error ? <ErrorState message={accounts.error} onRetry={accounts.reload} />
          : !acctPending.length ? <Empty title={t('لا توجد طلبات حسابات بانتظار موافقتكم', 'No account requests awaiting your approval')} /> : (
            <div className="table-responsive">
              <table className="eng-table">
                <thead><tr><th>{t('الطلب', 'Request')}</th><th>{t('الحساب', 'Account')}</th><th>{t('الدور / الجهة', 'Role / organization')}</th><th>{t('مقدم الطلب', 'Requested by')}</th><th>{t('التاريخ', 'Date')}</th><th /></tr></thead>
                <tbody>
                  {acctPending.map((a) => (
                    <tr key={a.id}>
                      <td>{a.kind === 'create_user' ? t('إنشاء حساب', 'New account') : t('تغيير بريد', 'Email change')}</td>
                      <td><b>{a.nameAr}</b><div className="doc-meta" dir="ltr">{a.kind === 'change_email' ? `${a.targetCurrentEmail ?? ''} → ${a.email}` : a.email}</div>{a.reason ? <div className="doc-meta">{a.reason}</div> : null}</td>
                      <td>{isAr ? a.roleLabelAr : a.roleLabelEn}<div className="doc-meta">{isAr ? a.organizationNameAr : a.organizationNameEn}</div></td>
                      <td>{a.requestedByName || (a.requestedByType === 'integration_key' ? 'API' : '—')}</td>
                      <td>{formatDate(a.createdAt, isAr, true)}</td>
                      <td className="row" style={{ gap: '0.3rem' }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setPending({ kind: 'account', op: 'approve', item: a })} data-testid={`approve-${a.id}`}>{t('موافقة', 'Approve')}</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ kind: 'account', op: 'reject', item: a })}>{t('رفض', 'Reject')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {isPmu ? (
        <>
          <RegistryDisputesPanel />
          <section className="card" style={{ padding: 0, marginBottom: '1rem' }} aria-labelledby="ap-recovery">
            <h2 id="ap-recovery" className="section-title" style={{ padding: '0.9rem 1rem 0' }}>{t('استرداد حسابات المصانع (تغيير البريد)', 'Factory account recovery (email change)')}</h2>
            <p className="form-helper" style={{ padding: '0 1rem' }}>{t('الأدمن يسجل الطلب بمستند رسمي، وموافقتكم تبدأ مهلة انتظار 48 ساعة يُبلَّغ فيها المالك ويستطيع الإلغاء. لا يتغير البريد قبل انتهائها.', 'The admin files the request with an official document. Your approval starts a 48-hour waiting period in which the owner is notified and may cancel. The email does not change before it ends.')}</p>
            {recoveries.loading && !recoveries.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : recoveries.error ? <ErrorState message={recoveries.error} onRetry={recoveries.reload} />
              : !recoveries.data?.length ? <Empty title={t('لا توجد طلبات استرداد', 'No recovery requests')} /> : (
                <div className="table-responsive">
                  <table className="eng-table">
                    <thead><tr><th>{t('المصنع', 'Factory')}</th><th>{t('البريد', 'Email')}</th><th>{t('المرجع والسبب', 'Reference & reason')}</th><th>{t('الحالة', 'Status')}</th><th /></tr></thead>
                    <tbody>
                      {recoveries.data.map((r) => {
                        const open = r.status === 'pending_approval' || r.status === 'cooling';
                        const label = RECOVERY_LABEL[r.status];
                        return (
                          <tr key={r.id}>
                            <td><b>{r.companyName}</b><div className="doc-meta">{t('قدّمه', 'Filed by')}: {r.requestedByName}</div></td>
                            <td dir="ltr">{r.oldEmail}<br />→ {r.newEmail}</td>
                            <td>{r.requestReference}<div className="doc-meta">{r.reason}</div>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadDoc(r)}><Download size={14} /> {t('المستند الرسمي', 'Official document')}</button></td>
                            <td><Badge status={r.status}>{isAr ? label[0] : label[1]}</Badge>
                              {r.status === 'cooling' ? <div className="doc-meta">{t('تنتهي', 'Ends')}: {formatDate(r.coolingEndsAt, isAr, true)}</div> : null}
                              {r.closeReason && !open ? <div className="doc-meta">{r.closeReason}</div> : null}</td>
                            <td className="row" style={{ gap: '0.3rem' }}>
                              {r.status === 'pending_approval' ? <>
                                <button type="button" className="btn btn-primary btn-sm" onClick={() => setPending({ kind: 'recovery', op: 'approve', item: r })} data-testid={`approve-recovery-${r.id}`}>{t('موافقة', 'Approve')}</button>
                                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ kind: 'recovery', op: 'reject', item: r })}>{t('رفض', 'Reject')}</button>
                              </> : null}
                              {r.status === 'cooling' ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ kind: 'recovery', op: 'cancel', item: r })}>{t('إلغاء الطلب', 'Cancel request')}</button> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
          </section>

          <section className="card" style={{ padding: 0 }} aria-labelledby="ap-keys">
            <h2 id="ap-keys" className="section-title" style={{ padding: '0.9rem 1rem 0' }}>{t('مفاتيح الربط بانتظار الاعتماد', 'Integration keys awaiting approval')}</h2>
            {keys.loading && !keys.data ? <div style={{ padding: '1rem' }}><Loading variant="table" /></div> : keys.error ? <ErrorState message={keys.error} onRetry={keys.reload} />
              : !keys.data?.length ? <Empty title={t('لا توجد مفاتيح بانتظار الاعتماد', 'No keys awaiting approval')} /> : (
                <div className="table-responsive">
                  <table className="eng-table">
                    <thead><tr><th>{t('الاسم', 'Name')}</th><th>{t('النطاقات', 'Scopes')}</th><th>{t('التاريخ', 'Date')}</th><th /></tr></thead>
                    <tbody>
                      {keys.data.map((k) => (
                        <tr key={k.id}>
                          <td>{k.name}<div className="doc-meta" dir="ltr">{k.keyPrefix}</div></td>
                          <td dir="ltr">{k.scopes.join(', ')}</td>
                          <td>{formatDate(k.createdAt, isAr, true)}</td>
                          <td className="row" style={{ gap: '0.3rem' }}>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPending({ kind: 'key', op: 'approve', item: k })}>{t('اعتماد', 'Approve')}</button>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => setPending({ kind: 'key', op: 'reject', item: k })}>{t('رفض', 'Reject')}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
        </>
      ) : null}

      {pending && !needsReason ? (
        <ConfirmDialog title={t('تأكيد الموافقة', 'Confirm approval')} busy={busy} confirmLabel={t('موافقة', 'Approve')} onCancel={() => setPending(null)} onConfirm={() => void confirmSimple()}
          message={pending.kind === 'account'
            ? t(`سيُنفَّذ الطلب على الحساب ${pending.item.email}، ويصل صاحب الحساب رابط تعيين كلمة المرور على بريده.`, `This applies the request for ${pending.item.email}. The owner receives a one-time password link by email.`)
            : pending.kind === 'recovery'
              ? t(`بعد الموافقة تبدأ مهلة 48 ساعة قبل نقل حساب «${pending.item.companyName}» إلى ${pending.item.newEmail}.`, `After approval a 48-hour waiting period starts before “${pending.item.companyName}” moves to ${pending.item.newEmail}.`)
              : t(`سيعمل المفتاح «${pending.item.name}» بنطاقاته: ${pending.item.scopes.join(', ')}.`, `The key “${pending.item.name}” becomes active with scopes: ${pending.item.scopes.join(', ')}.`)} />
      ) : null}
      {pending && needsReason ? (
        <ReasonDialog title={pending.op === 'cancel' ? t('إلغاء طلب الاسترداد', 'Cancel the recovery request') : t('رفض الطلب', 'Reject the request')}
          label={t('السبب (يُسجل في التدقيق)', 'Reason (recorded in the audit log)')} confirmLabel={pending.op === 'cancel' ? t('إلغاء الطلب', 'Cancel request') : t('رفض', 'Reject')}
          onCancel={() => setPending(null)} onConfirm={(reason) => run(pending, reason)} />
      ) : null}
    </>
  );
};
