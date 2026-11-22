import React, { useState } from 'react';
import { api, type ApplicationDetail } from '../../api';
import { errorText, useStore } from '../../store/state';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { useToast } from '../common/ToastSystem';

/**
 * الانسحاب من طلب غير نهائي (★ مقترح): سبب إجباري وتأكيد صريح قبل الإرسال. القرار نهائي ويُغلق الطلب ويُدقق.
 * الإرسال بنسخة الطلب الحالية (expectedVersion) فلا ينسحب المصنع من طلب تغيّر في الأثناء دون علمه.
 */
export const WithdrawDialog: React.FC<{ app: ApplicationDetail; onClose: () => void; onDone: () => Promise<void> | void }> = ({ app, onClose, onDone }) => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = reason.trim().length >= 3 && ack;

  const submit = async () => {
    if (busy || !ok) return;
    setBusy(true); setError('');
    try {
      await api.performAction(app.id, 'withdraw', { expectedVersion: app.version, reason: reason.trim() });
      toast('success', t('تم الانسحاب من الطلب وأُغلق.', 'You withdrew from the application and it was closed.'));
      await onDone();
    } catch (e) { setError(errorText(e, isAr)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={busy ? () => undefined : onClose} title={t('الانسحاب من الطلب', 'Withdraw the application')} maxWidth="520px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('تراجع', 'Go back')}</button>
        <button type="button" className="btn btn-danger" disabled={busy || !ok} onClick={() => void submit()} data-testid="withdraw-confirm">{busy ? t('جارٍ التنفيذ…', 'Working…') : t('تأكيد الانسحاب', 'Confirm withdrawal')}</button>
      </div>}>
      <p style={{ lineHeight: 1.9, fontSize: '0.92rem' }}>
        {t(`ستنسحب من الطلب ${app.number ?? t('(مسودة)', '(draft)')} نهائيًا. يُغلق الطلب ولا يمكن إعادة فتحه، وتُحفظ بياناته ومستنداته في السجل. يمكنك لاحقًا تقديم طلب جديد.`,
          `You will withdraw from application ${app.number ?? '(draft)'} permanently. It is closed and cannot be reopened; its data and documents stay in the record. You may file a new application later.`)}
      </p>
      <div className="form-group">
        <label className="form-label required" htmlFor="withdraw-reason">{t('سبب الانسحاب', 'Reason for withdrawing')}</label>
        <textarea id="withdraw-reason" rows={3} className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="withdraw-reason" />
        <div className="form-helper">{t('3 أحرف على الأقل. يراه المراجعون ويُسجل في التدقيق.', 'At least 3 characters. Reviewers can see it and it is audited.')}</div>
      </div>
      <label className="row" style={{ gap: '0.5rem', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="withdraw-ack" />
        <span style={{ fontSize: '0.88rem' }}>{t('أفهم أن الانسحاب نهائي ولا يمكن التراجع عنه.', 'I understand that withdrawal is final and cannot be undone.')}</span>
      </label>
      <ErrorBox message={error} />
    </Modal>
  );
};
