import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { api } from '../../api';
import { errorText, store, useStore } from '../../store/state';
import { useToast } from '../common/ToastSystem';

/** تغيير كلمة المرور — إجباري (لا يُغلق) عند الكلمة المؤقتة، والسيرفر يمنع غيره حتى التغيير. */
export const ChangePasswordModal: React.FC<{ isForced?: boolean; onClose: () => void }> = ({ isForced, onClose }) => {
  const { t, isAr } = useStore();
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) { setError(t('كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', 'At least 8 characters with letters and digits.')); return; }
    if (next !== confirm) { setError(t('التأكيد لا يطابق كلمة المرور الجديدة.', 'Confirmation does not match.')); return; }
    setBusy(true);
    try {
      const { user } = await api.changePassword(current, next);
      store.setUser(user);
      toast('success', t('تم تغيير كلمة المرور.', 'Password changed.'));
      onClose();
      if (isForced) store.goHome();
    } catch (err) {
      setError(errorText(err, isAr));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={isForced ? () => undefined : onClose} title={isForced ? t('يجب تغيير كلمة المرور المؤقتة', 'You must change your temporary password') : t('تغيير كلمة المرور', 'Change password')} maxWidth="440px">
      <form onSubmit={submit} className="stack" style={{ gap: '0.25rem' }}>
        {isForced ? <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: 0 }}>{t('لأمان الحساب، اختر كلمة مرور جديدة قبل المتابعة.', 'For security, choose a new password before continuing.')}</p> : null}
        <div className="form-group">
          <label className="form-label required" htmlFor="pw-current">{t('كلمة المرور الحالية', 'Current password')}</label>
          <input id="pw-current" className="form-control" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label required" htmlFor="pw-new">{t('كلمة المرور الجديدة', 'New password')}</label>
          <input id="pw-new" className="form-control" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          <div className="form-helper">{t('8 أحرف على الأقل، حروف وأرقام.', 'At least 8 characters, letters and digits.')}</div>
        </div>
        <div className="form-group">
          <label className="form-label required" htmlFor="pw-confirm">{t('تأكيد كلمة المرور', 'Confirm password')}</label>
          <input id="pw-confirm" className="form-control" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <ErrorBox message={error} />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          {isForced ? <button type="button" className="btn btn-ghost" onClick={() => void store.logout()}>{t('خروج', 'Sign out')}</button>
            : <button type="button" className="btn btn-secondary" onClick={onClose}>{t('إلغاء', 'Cancel')}</button>}
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('جارٍ الحفظ…', 'Saving…') : t('حفظ', 'Save')}</button>
        </div>
      </form>
    </Modal>
  );
};
