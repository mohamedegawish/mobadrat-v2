/**
 * عناصر فورم التسجيل المشتركة بين صفحة التسجيل (قبل وجود الحساب) ومعالج الطلب (بعد الدخول):
 * عرض حقول البيانات، والتحقق من الاكتمال، والملخص النهائي. تعريف الحقول نفسه من GET /meta (مصدر واحد مع السيرفر).
 * المستندات تختلف بين الشاشتين (محلية قبل التفعيل، على السيرفر بعده)، فتُمرَّر لكل منهما من الخارج.
 */
import React from 'react';
import { AlertCircle, Check, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FieldMeta, FormSection, Meta } from '../../api';
import { useStore } from '../../store/state';
import { formatBytes, formatDate, formatNumber } from '../../hooks/useAsync';
import { toLatinDigits } from '../../utils/validation';

export type SectionData = Record<string, unknown>;
export type FormState = Record<FormSection, SectionData>;
export const emptyForm = (): FormState => ({ general: {}, contact: {}, company: {}, engineering: {} });

/** الأقسام الأربعة بترتيب Registration Form V01.xlsx. */
export const FORM_SECTION_STEPS: Array<{ section: FormSection; ar: string; en: string }> = [
  { section: 'general', ar: 'البيانات العامة', en: 'General data' },
  { section: 'contact', ar: 'مسؤول الاتصال', en: 'Contact person' },
  { section: 'company', ar: 'أوراق الشركة', en: 'Company papers' },
  { section: 'engineering', ar: 'البيانات الهندسية', en: 'Engineering data' },
];

/** حقول نصية أرقامها تُحوَّل للاتينية (أرقام السجلات). */
const DIGIT_TEXT_FIELDS = new Set(['industrialRegistryNumber', 'commercialRegisterNumber', 'taxNumber']);

/** I2: أرقام لوحة المفاتيح العربية في الهاتف والأرقام والتواريخ وأرقام السجلات. */
export function normalizeFieldInput(f: FieldMeta | undefined, value: unknown): unknown {
  return typeof value === 'string' && f && (['phone', 'date'].includes(f.type) || DIGIT_TEXT_FIELDS.has(f.key)) ? toLatinDigits(value) : value;
}

/** صفوف الأسطح المكتملة فقط (لا يُرسل للسيرفر نصف صف). */
export function completeRoofRows(value: unknown): Array<{ name: string; area: number }> {
  return (Array.isArray(value) ? (value as Array<{ name: string; area: unknown }>) : [])
    .filter((r) => typeof r?.name === 'string' && r.name.trim() && Number(r.area) > 0).map((r) => ({ name: r.name.trim(), area: Number(r.area) }));
}

/** I12: نص مساعد تعريفي للحقول الهندسية — يشرح المصطلح ولا يضيف أي شرط. */
const UNIT_HELP = {
  ar: 'kW (كيلووات) وحدة القدرة الفعلية، وkVA (كيلو فولت أمبير) وحدة القدرة الظاهرية. اختر الوحدة المكتوبة بجانب القيمة.',
  en: 'kW (kilowatt) is real power; kVA (kilovolt-ampere) is apparent power. Choose the unit written next to the value.',
};
export const FIELD_HELP: Record<string, { ar: string; en: string }> = {
  contractedCapacity: {
    ar: 'القدرة الكهربائية المتفق عليها في عقد توريد الكهرباء مع شركة التوزيع. تظهر عادةً في فاتورة الكهرباء.',
    en: 'The electrical capacity agreed in the supply contract with the distribution company. It usually appears on the electricity bill.',
  },
  peakLoad: {
    ar: 'أعلى حمل كهربائي استهلكه المصنع في وقت واحد. يظهر عادةً في الفاتورة باسم «أقصى حمل» أو «الحد الأقصى للطلب».',
    en: 'The highest electrical load the factory drew at one time. It usually appears on the bill as “maximum demand” or “peak load”.',
  },
  capacityUnit: UNIT_HELP,
  loadUnit: UNIT_HELP,
};

export const FieldLabel: React.FC<{ field: FieldMeta; htmlFor?: string; flagged?: boolean; children?: React.ReactNode }> = ({ field: f, htmlFor, flagged, children }) => {
  const { isAr, t } = useStore();
  return (
    <label className={`form-label${f.required ? ' required' : ''}`} htmlFor={htmlFor}>
      {isAr ? f.labelAr : f.labelEn}
      {flagged ? <span className="field-flag">{t('مطلوب تعديله', 'To correct')}</span> : null}
      {children}
    </label>
  );
};

/** حقل بيانات واحد (كل الأنواع عدا الملفات). المعرّف `f-<key>` ثابت في الشاشتين. */
export const DataFieldControl: React.FC<{
  field: FieldMeta; value: unknown; governorate: string; locked?: boolean; flagged?: boolean; note?: string; error?: string; hint?: React.ReactNode;
  onChange: (v: unknown) => void;
}> = ({ field: f, value, governorate, locked = false, flagged, note, error, hint, onChange }) => {
  const { isAr, t, meta } = useStore();
  const id = `f-${f.key}`;
  const lbl = <FieldLabel field={f} htmlFor={f.type === 'roofTable' ? undefined : id} flagged={flagged} />;
  const common = { id, name: f.key, disabled: locked, 'aria-invalid': Boolean(error), className: `form-control${error ? ' is-invalid' : ''}` };
  const str = value === undefined || value === null ? '' : String(value);
  let input: React.ReactNode;

  if (f.type === 'roofTable') {
    const rows = Array.isArray(value) ? (value as Array<{ name: string; area: number | string }>) : [];
    const setRows = (r: typeof rows) => onChange(r.map((x) => ({ name: x.name, area: x.area === '' ? '' : Number(x.area) })));
    const total = rows.reduce((s, r) => s + (Number(r.area) || 0), 0);
    return (
      <div className={`form-group span-2${locked ? ' field-locked' : ''}`} data-field={f.key}>
        {lbl}
        {note ? <div className="deficiency-note">{note}</div> : null}
        {rows.map((r, i) => (
          <div key={i} className="roof-row">
            <input className="form-control" disabled={locked} aria-label={t('اسم السطح', 'Roof name')} placeholder={t('اسم السطح/المبنى', 'Roof / building name')} value={r.name} data-testid={`roof-name-${i}`}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="form-control num-ltr" disabled={locked} type="text" inputMode="decimal" aria-label={t('المساحة م²', 'Area m²')} placeholder={t('المساحة م²', 'Area m²')} value={r.area} data-testid={`roof-area-${i}`}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, area: toLatinDigits(e.target.value) } : x)))} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t('حذف الصف', 'Remove row')}><Trash2 size={15} /></button>
          </div>
        ))}
        {!locked ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows([...rows, { name: '', area: '' }])} data-testid="roof-add"><Plus size={14} /> {t('إضافة سطح', 'Add roof')}</button> : null}
        <div className="roof-total" style={{ marginTop: '0.5rem' }}>{t('إجمالي المساحات', 'Total area')}: <span>{formatNumber(total, isAr)}</span> {t('م²', 'm²')}</div>
        {error ? <div className="field-error">{error}</div> : null}
      </div>
    );
  }

  if (f.type === 'select') {
    let options: Array<{ value: string; label: string }> = [];
    if (f.options === 'governorates') options = (meta?.governorates ?? []).map((g) => ({ value: g.value, label: isAr ? g.labelAr : g.labelEn }));
    if (f.options === 'zones') options = (meta?.governorates.find((g) => g.value === governorate)?.zones ?? []).map((z) => ({ value: z.value, label: isAr ? z.labelAr : z.labelEn }));
    if (f.options === 'capacityUnits') options = (meta?.form.capacityUnits ?? []).map((u) => ({ value: u, label: u }));
    if (f.options === 'loadUnits') options = (meta?.form.loadUnits ?? []).map((u) => ({ value: u, label: u }));
    if (f.options === 'ownershipTypes') options = (meta?.form.ownershipTypes ?? []).map((o) => ({ value: o.value, label: isAr ? o.labelAr : o.labelEn }));
    input = (
      <select {...common} value={str} onChange={(e) => onChange(e.target.value)} disabled={locked || (f.options === 'zones' && !governorate)}>
        <option value="">{f.options === 'zones' && !governorate ? t('اختر المحافظة أولًا', 'Select the governorate first') : t('— اختر —', '— Select —')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else if (f.type === 'textarea') {
    input = <textarea {...common} rows={2} maxLength={f.maxLength} value={str} onChange={(e) => onChange(e.target.value)} />;
  } else if (f.type === 'number') {
    // نص بلوحة أرقام: type=number يرفض الأرقام العربية على بعض الهواتف (I2).
    input = <input {...common} className={`${common.className} num-ltr`} type="text" inputMode="decimal" value={str}
      onChange={(e) => { const v = toLatinDigits(e.target.value.trim()); onChange(v === '' ? '' : Number.isFinite(Number(v)) ? Number(v) : v); }} />;
  } else {
    // url: نص عادي حتى يُقبل www.factory.com (يُكمل السيرفر https://).
    const type = f.type === 'phone' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text';
    input = <input {...common} type={type} lang={f.type === 'date' ? (isAr ? 'ar-EG' : 'en-GB') : undefined} inputMode={f.type === 'url' ? 'url' : undefined}
      dir={['phone', 'email', 'url'].includes(f.type) ? 'ltr' : undefined} maxLength={f.maxLength} value={str} onChange={(e) => onChange(e.target.value)} />;
  }
  const help = FIELD_HELP[f.key];

  return (
    <div className={`form-group${f.type === 'textarea' ? ' span-2' : ''}${locked ? ' field-locked' : ''}`} data-field={f.key}>
      {lbl}
      {input}
      {hint ? <div className="form-helper">{hint}</div> : null}
      {help ? <div className="form-helper" data-testid={`help-${f.key}`}>{isAr ? help.ar : help.en}</div> : null}
      {f.type === 'url' ? <div className="form-helper">{t('مثال: www.factory.com', 'Example: www.factory.com')}</div> : null}
      {/* M3: المتصفح قد يعرض الحقل بترتيب mm/dd/yyyy — نعرض التاريخ المختار بصيغة عربية واضحة */}
      {f.type === 'date' && str ? <div className="form-helper" data-testid={`date-readable-${f.key}`}>{t('التاريخ المختار', 'Selected date')}: <b>{formatDate(str, isAr)}</b></div> : null}
      {note ? <div className="deficiency-note">{note}</div> : null}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
};

/** البنود الإجبارية الناقصة. `fileCount(kind)` = عدد الملفات الحالية لنوع المستند في الشاشة المعنية. */
export function missingFields(fields: FieldMeta[], form: FormState, fileCount: (kind: string) => number, minBills: number): FieldMeta[] {
  return fields.filter((f) => {
    if (!f.required) return false;
    if (f.type === 'file') return fileCount(f.docKind!) < 1;
    if (f.type === 'files') return fileCount(f.docKind!) < minBills;
    const v = f.type === 'roofTable' ? completeRoofRows(form[f.section][f.key]) : form[f.section][f.key];
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}

/** قيمة حقل كما تُعرض في الملخص (أسماء القوائم بدل قيمها، والتواريخ والأرقام بصيغة مقروءة). */
export function displayValue(f: FieldMeta, v: unknown, form: FormState, meta: Meta, isAr: boolean): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (f.options === 'governorates') { const g = meta.governorates.find((x) => x.value === v); return g ? (isAr ? g.labelAr : g.labelEn) : String(v); }
  if (f.options === 'zones') {
    const z = meta.governorates.find((x) => x.value === form.general.governorate)?.zones.find((x) => x.value === v);
    return z ? (isAr ? z.labelAr : z.labelEn) : String(v);
  }
  if (f.options === 'ownershipTypes') { const o = meta.form.ownershipTypes.find((x) => x.value === v); return o ? (isAr ? o.labelAr : o.labelEn) : String(v); }
  if (f.type === 'date') return formatDate(String(v), isAr);
  if (f.type === 'number') return formatNumber(Number(v), isAr);
  return String(v);
}

export interface SummaryFile { id: string; name: string; sizeBytes: number }

/** ملخص الأقسام الأربعة: كل قيمة كما أُدخلت، وأسماء الملفات، مع «تعديل» لكل قسم وتمييز الناقص وغير الصحيح. */
export const FormSummary: React.FC<{
  form: FormState; missing: FieldMeta[]; invalid: FieldMeta[]; filesOf: (f: FieldMeta) => SummaryFile[]; onEdit: (section: FormSection) => void;
  /** صفوف إضافية في أول قسم معيّن (مثل بيانات الدخول في صفحة التسجيل). */
  extraRows?: Partial<Record<FormSection, Array<{ key: string; label: string; value: React.ReactNode }>>>;
}> = ({ form, missing, invalid, filesOf, onEdit, extraRows }) => {
  const { isAr, t, meta } = useStore();
  if (!meta) return null;
  const missingKeys = new Set(missing.map((f) => f.key));
  const invalidKeys = new Set(invalid.map((f) => f.key));
  return (
    <>
      {FORM_SECTION_STEPS.map((s) => {
        const fields = meta.form.fields.filter((f) => f.section === s.section);
        const issues = fields.filter((f) => missingKeys.has(f.key) || invalidKeys.has(f.key)).length;
        return (
          <section key={s.section} className="review-section" data-testid={`review-${s.section}`} aria-labelledby={`review-h-${s.section}`}>
            <div className="review-section-head">
              <h3 id={`review-h-${s.section}`}>{isAr ? s.ar : s.en}</h3>
              {issues ? <span className="review-chip is-warn"><AlertCircle size={13} /> {t(`${formatNumber(issues, true)} بند يحتاج استكمالًا`, `${issues} item(s) to complete`)}</span>
                : <span className="review-chip is-ok"><CheckCircle2 size={13} /> {t('مكتمل', 'Complete')}</span>}
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: 'auto' }} onClick={() => onEdit(s.section)} data-testid={`review-edit-${s.section}`}>
                <Pencil size={14} /> {t('تعديل', 'Edit')}
              </button>
            </div>
            <dl className="kv review-kv">
              {fields.map((f) => {
                const flag = missingKeys.has(f.key) ? 'is-missing' : invalidKeys.has(f.key) ? 'is-invalid' : '';
                let shown: React.ReactNode;
                if (f.type === 'file' || f.type === 'files') {
                  const docs = filesOf(f);
                  shown = docs.length
                    ? <span className="review-files">{docs.map((d) => <span key={d.id} className="review-file"><Check size={13} aria-hidden /> <span dir="auto">{d.name}</span> <span className="doc-meta">({formatBytes(d.sizeBytes)})</span></span>)}</span>
                    : null;
                } else if (f.type === 'roofTable') {
                  const rows = completeRoofRows(form[f.section][f.key]);
                  const total = rows.reduce((sum, r) => sum + r.area, 0);
                  shown = rows.length ? (
                    <span>
                      {rows.map((r, i) => <span key={i} style={{ display: 'block' }}>{r.name}: {formatNumber(r.area, isAr)} {t('م²', 'm²')}</span>)}
                      <b>{t('الإجمالي', 'Total')}: {formatNumber(Math.round(total * 100) / 100, isAr)} {t('م²', 'm²')}</b>
                    </span>
                  ) : null;
                } else {
                  const v = displayValue(f, form[f.section][f.key], form, meta, isAr);
                  shown = v === null ? null : <span dir={['phone', 'email', 'url'].includes(f.type) ? 'ltr' : undefined}>{v}</span>;
                }
                return (
                  <React.Fragment key={f.key}>
                    <dt className={flag}>{isAr ? f.labelAr : f.labelEn}{f.required ? null : <span className="review-optional"> {t('(اختياري)', '(optional)')}</span>}</dt>
                    <dd className={flag} data-testid={`review-value-${f.key}`}>
                      {shown ?? <span className="review-empty">{f.required ? t('مطلوب — لم يُستكمل', 'Required — not provided') : t('لم يُدخل', 'Not provided')}</span>}
                      {flag === 'is-invalid' ? <span className="review-empty"> · {t('قيمة غير صحيحة', 'invalid value')}</span> : null}
                    </dd>
                  </React.Fragment>
                );
              })}
              {(extraRows?.[s.section] ?? []).map((r) => (
                <React.Fragment key={r.key}><dt>{r.label}</dt><dd data-testid={`review-value-${r.key}`}>{r.value}</dd></React.Fragment>
              ))}
            </dl>
          </section>
        );
      })}
    </>
  );
};

/** قائمة البنود الناقصة / غير الصحيحة بروابط تفتح كل بند في قسمه. */
export const IssueList: React.FC<{ testId: string; title: string; items: FieldMeta[]; prefix: string; onGo: (key: string) => void }> = ({ testId, title, items, prefix, onGo }) => {
  const { isAr } = useStore();
  if (!items.length) return null;
  const sectionName = (s: FormSection) => { const x = FORM_SECTION_STEPS.find((y) => y.section === s); return x ? (isAr ? x.ar : x.en) : s; };
  return (
    <div className="error-box" data-testid={testId}>
      <b>{title}:</b>
      <ul style={{ margin: '0.4rem 0 0' }}>
        {items.map((f) => (
          <li key={f.key}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGo(f.key)} data-testid={`${prefix}-${f.key}`}>
              {isAr ? f.labelAr : f.labelEn} <span className="form-helper">— {sectionName(f.section)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
