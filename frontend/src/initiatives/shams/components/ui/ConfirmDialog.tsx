import React from 'react';
import { Modal } from './Modal';
import { useStore } from '../../store/state';

/** تأكيد قبل القرارات النهائية والمؤثرة. */
export const ConfirmDialog: React.FC<{
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, confirmLabel, danger, busy, onConfirm, onCancel }) => {
  const { t } = useStore();
  return (
    <Modal
      onClose={busy ? () => undefined : onCancel}
      title={title}
      maxWidth="480px"
      footer={
        <div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{t('إلغاء', 'Cancel')}</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy} data-testid="confirm-action">
            {busy ? t('جارٍ التنفيذ…', 'Working…') : confirmLabel}
          </button>
        </div>
      }
    >
      <div style={{ fontSize: '0.92rem', lineHeight: 1.8 }}>{message}</div>
    </Modal>
  );
};
