import React, { useState } from 'react';
import { api } from '../../api';
import { errorText, useStore } from '../../store/state';
import { Modal } from '../ui/Modal';
import { ErrorBox } from '../ui/ErrorBox';
import { PdfUploader } from '../ui/PdfUploader';
import { useToast } from '../common/ToastSystem';

/**
 * اعتراض المصنع على حظر/حجز رقم السجل الصناعي (القاعدة G): مستند PDF يثبت الملكية أو التفويض + ملاحظة.
 * يراجعه PMU فقط؛ يبقى الرقم موقوفًا حتى القرار ولا يتغير شيء في طلبك.
 */
export const ObjectionDialog: React.FC<{ registryNumber: string; onClose: () => void; onDone?: () => void }> = ({ registryNumber, onClose, onDone }) => {
  const { isAr, t } = useStore();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!file || busy) return;
    setBusy(true); setError('');
    try {
      await api.createRegistryObjection(registryNumber, note.trim(), file);
      toast('success', t('استُلم اعتراضك — ستراجعه وحدة إدارة المبادرة وتُبلغك بالقرار.', 'Your objection was received — the PMU will review it and notify you.'));
      onDone?.();
      onClose();
    } catch (e) { setError(errorText(e, isAr)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={busy ? () => undefined : onClose} title={t('اعتراض على رقم السجل الصناعي', 'Object to the industrial registry number hold')} maxWidth="520px"
      footer={<div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('إلغاء', 'Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !file} onClick={() => void send()} data-testid="objection-send">{busy ? t('جارٍ الإرسال…', 'Sending…') : t('إرسال الاعتراض', 'Send objection')}</button>
      </div>}>
      <p style={{ fontSize: '0.88rem', lineHeight: 1.9 }}>
        {t(`الرقم ${registryNumber} موقوف الاستخدام (محجوز لطلب آخر أو محظور). إن كان الرقم لمنشأتك فأرفق صورة السجل الصناعي وما يثبت تفويضك عن المنشأة بصيغة PDF. تراجع وحدة إدارة المبادرة الاعتراض وحدها وتبلغك بالقرار.`,
          `The number ${registryNumber} is on hold (held by another application or blocked). If it belongs to your facility, attach the industrial register and proof of your authorization as a PDF. Only the PMU reviews objections and tells you the decision.`)}
      </p>
      <div className="form-group">
        <span className="form-label required">{t('المستند (PDF)', 'Document (PDF)')}</span>
        <PdfUploader testId="objection-file" onFile={(f) => setFile(f)} label={file ? file.name : undefined} />
      </div>
      <div className="form-group"><label className="form-label" htmlFor="o-note">{t('ملاحظات', 'Notes')}</label><textarea id="o-note" rows={3} className="form-control" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <ErrorBox message={error} />
    </Modal>
  );
};
