import React, { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { errorText, useStore } from '../../store/state';

/** I12: إرشاد لمن يملك صورة للمستند لا ملف PDF (لا يغير شرط PDF). */
const PDF_HINT_AR = 'لديك صورة للمستند؟ استخدم «مسح المستندات» في تطبيق الكاميرا أو الملاحظات أو Google Drive بهاتفك ليحفظه PDF، أو افتح الصورة واختر «طباعة» ← «حفظ بصيغة PDF».';
const PDF_HINT_EN = 'Only have a photo? Use “Scan document” in your phone’s camera, Notes or Google Drive app to save it as PDF, or open the image and choose Print → Save as PDF.';

/**
 * اختيار ملف PDF (سحب وإفلات أو تصفح) مع فحص أولي للحجم والامتداد قبل الرفع — الفحص الحقيقي في السيرفر
 * (الامتداد + النوع + توقيع %PDF- + الحجم). خطأ الرفع من السيرفر يظهر تحت الحقل نفسه بالعربية.
 */
export const PdfUploader: React.FC<{
  onFile: (file: File) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
  testId?: string;
}> = ({ onFile, disabled, label, testId }) => {
  const { t, meta, isAr } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const maxMB = meta?.form.maxFileSizeMB ?? 15;

  const handle = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    const reset = () => { if (input.current) input.current.value = ''; };
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && !['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(file.type))) {
      setError(t(`صيغة الملف «${file.name}» غير مدعومة — المقبول ملفات PDF فقط. ${PDF_HINT_AR}`, `“${file.name}” is not supported — only PDF files are accepted. ${PDF_HINT_EN}`));
      reset();
      return;
    }
    if (file.size === 0) { setError(t('الملف فارغ.', 'The file is empty.')); reset(); return; }
    if (file.size > maxMB * 1024 * 1024) {
      setError(t(`حجم الملف (${(file.size / 1024 / 1024).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى ${maxMB} ميجابايت.`, `The file (${(file.size / 1024 / 1024).toFixed(1)} MB) exceeds the ${maxMB} MB limit.`));
      reset();
      return;
    }
    setBusy(true);
    try { await onFile(file); } catch (e) { setError(errorText(e, isAr)); } finally {
      setBusy(false);
      reset();
    }
  };

  return (
    <div>
      <div
        className={`dropzone${drag ? ' is-drag' : ''}${busy ? ' is-busy' : ''}`}
        aria-busy={busy}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled && !busy) void handle(e.dataTransfer.files?.[0]); }}
      >
        <Upload size={20} aria-hidden />
        <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          {busy ? t('جارٍ رفع الملف والتحقق منه…', 'Uploading and checking the file…') : <>{label ?? t('اسحب ملف PDF هنا أو اختر من جهازك', 'Drop a PDF here or browse')} · {t(`PDF حتى ${maxMB} ميجابايت`, `PDF up to ${maxMB} MB`)}</>}
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
      {error ? <div className="field-error" role="alert" data-testid={testId ? `${testId}-error` : undefined}>{error}</div> : null}
    </div>
  );
};
