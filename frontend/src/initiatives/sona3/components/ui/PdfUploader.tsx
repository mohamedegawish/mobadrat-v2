import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useStore } from '../../store/state';

/** I12: إرشاد لمن يملك صورة للمستند لا ملف PDF (لا يغير شرط PDF). */
const PDF_HINT_AR = 'لديك صورة للمستند؟ استخدم «مسح المستندات» في تطبيق الكاميرا أو الملاحظات أو Google Drive بهاتفك ليحفظه PDF، أو افتح الصورة واختر «طباعة» ← «حفظ بصيغة PDF».';
const PDF_HINT_EN = 'Only have a photo? Use “Scan document” in your phone’s camera, Notes or Google Drive app to save it as PDF, or open the image and choose Print → Save as PDF.';

/** اختيار ملف PDF (سحب وإفلات أو تصفح) مع فحص أولي للحجم والامتداد — الفحص الحقيقي في السيرفر. */
export const PdfUploader: React.FC<{
  onFile: (file: File) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}> = ({ onFile, disabled, label, testId }) => {
  const { t, meta } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const maxMB = meta?.form.maxFileSizeMB ?? 15;

  const handle = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError(t(`الملف يجب أن يكون PDF. ${PDF_HINT_AR}`, `The file must be a PDF. ${PDF_HINT_EN}`)); return; }
    if (file.size > maxMB * 1024 * 1024) { setError(t(`الحد الأقصى ${maxMB} ميجابايت.`, `Maximum ${maxMB} MB.`)); return; }
    setBusy(true);
    try { await onFile(file); } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <div
        className={`dropzone${drag ? ' is-drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled) void handle(e.dataTransfer.files?.[0]); }}
      >
        <Upload size={20} aria-hidden />
        <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          {label ?? t('اسحب ملف PDF هنا أو اختر من جهازك', 'Drop a PDF here or browse')} · {t(`حتى ${maxMB} ميجابايت`, `up to ${maxMB} MB`)}
        </span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? t('جارٍ الرفع…', 'Uploading…') : t('اختيار ملف', 'Choose file')}
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="visually-hidden"
          data-testid={testId}
          disabled={disabled || busy}
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </div>
      <div className="form-helper" data-testid="pdf-hint">{t(PDF_HINT_AR, PDF_HINT_EN)}</div>
      {error ? <div className="field-error" role="alert">{error}</div> : null}
    </div>
  );
};
