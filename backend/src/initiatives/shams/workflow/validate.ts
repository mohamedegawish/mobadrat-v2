/** تحقق بيانات الفورم: قائمة حقول مسموح بها لكل قسم + تحقق النوع + اكتمال الإرسال. */
import { Errors, type ErrorDetail } from '../http/errors.js';
import { isEmail, isIsoDate, isObj, isPhone, isUrl, normalizeDigits, withHttpScheme, type Obj } from '../http/validate.js';
import { shamsPolicy, type FormFieldKey } from '../config/shamsPolicy.js';
import { findGovernorate, isValidZone } from '../config/locations.js';
import { dataFieldsOf, DATA_FIELDS, FILE_FIELDS, isRequired, type FieldDef, type FormSection, type DocumentKind } from './applicationForm.js';

export interface RoofArea { name: string; area: number }
export type SectionData = Record<string, unknown>;
export type FormData = Partial<Record<FormSection, SectionData>>;

const REGISTER_NUMBER_RE = /^[\p{L}\p{N}][\p{L}\p{N}\s/-]{0,49}$/u;

export function normalizeRegistryNumber(v: string): string {
  return v.trim().replace(/\s+/g, '').toUpperCase();
}

/** يتحقق من قيمة حقل واحد. يرجع القيمة المنظفة أو null للمسح. يضيف أخطاء إلى details. */
function cleanField(f: FieldDef, rawIn: unknown, details: ErrorDetail[], section: SectionData): unknown {
  if (rawIn === null || rawIn === '' || rawIn === undefined) return null;
  // I2: أرقام لوحة المفاتيح العربية تُقبل في الأرقام والهواتف والتواريخ وأرقام السجلات.
  const raw = typeof rawIn === 'string' && ['phone', 'number', 'date', 'text', 'url', 'email'].includes(f.type)
    && (f.type !== 'text' || ['industrialRegistryNumber', 'commercialRegisterNumber', 'taxNumber'].includes(f.key)) ? normalizeDigits(rawIn) : rawIn;
  const bad = (issue: string) => { details.push({ field: f.key, issue }); return undefined; };
  switch (f.type) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return bad('must be a string');
      const t = raw.trim();
      if (!t) return null;
      if (t.length > (f.maxLength ?? 200)) return bad(`max length ${f.maxLength ?? 200}`);
      if (f.key === 'industrialRegistryNumber' || f.key === 'commercialRegisterNumber' || f.key === 'taxNumber') {
        if (!REGISTER_NUMBER_RE.test(t)) return bad('invalid format');
        return f.key === 'industrialRegistryNumber' ? normalizeRegistryNumber(t) : t;
      }
      return t;
    }
    case 'phone':
      if (!isPhone(raw)) return bad('invalid phone number');
      return (raw as string).trim();
    case 'url': {
      const u = typeof raw === 'string' ? withHttpScheme(raw) : raw;
      if (!isUrl(u)) return bad('invalid URL (http/https)');
      // موقع الشركة اسم نطاق عام (www.factory.com): «abc» وحده يصير https://abc وهو رابط صالح شكلًا لكنه ليس موقعًا.
      if (!new URL(u).hostname.includes('.')) return bad('invalid URL (http/https)');
      return u;
    }
    case 'email':
      if (!isEmail(raw)) return bad('invalid email');
      return (raw as string).trim().toLowerCase();
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return bad('must be a positive number');
      return Math.round(n * 1000) / 1000;
    }
    case 'date':
      if (!isIsoDate(raw)) return bad('must be a date YYYY-MM-DD');
      return raw;
    case 'select': {
      if (typeof raw !== 'string') return bad('must be a string');
      if (f.options === 'governorates' && !findGovernorate(raw)) return bad('unknown governorate');
      if (f.options === 'zones') {
        const gov = typeof section.governorate === 'string' ? section.governorate : '';
        if (!isValidZone(gov, raw)) return bad('zone does not belong to the selected governorate');
      }
      if (f.options === 'capacityUnits' && !(shamsPolicy.capacityUnits as readonly string[]).includes(raw)) return bad('unknown unit');
      if (f.options === 'loadUnits' && !(shamsPolicy.loadUnits as readonly string[]).includes(raw)) return bad('unknown unit');
      if (f.options === 'ownershipTypes' && !shamsPolicy.ownershipTypes.some((o) => o.value === raw)) return bad('unknown ownership type');
      return raw;
    }
    case 'roofTable': {
      if (!Array.isArray(raw)) return bad('must be a list');
      if (raw.length > shamsPolicy.roofAreas.max) return bad(`max ${shamsPolicy.roofAreas.max} rows`);
      const rows: RoofArea[] = [];
      raw.forEach((r, i) => {
        if (!isObj(r) || Object.keys(r).some((k) => k !== 'name' && k !== 'area')) { details.push({ field: `roofAreas[${i}]`, issue: 'must be { name, area }' }); return; }
        const name = typeof r.name === 'string' ? r.name.trim() : '';
        const area = typeof r.area === 'number' ? r.area : Number(r.area);
        if (!name || name.length > 100) details.push({ field: `roofAreas[${i}].name`, issue: 'required (max 100)' });
        if (!Number.isFinite(area) || area <= 0 || area > 10_000_000) details.push({ field: `roofAreas[${i}].area`, issue: 'must be a positive number (m²)' });
        rows.push({ name, area: Math.round(area * 100) / 100 });
      });
      return rows;
    }
    default:
      return bad('not editable');
  }
}

/**
 * ينظف تعديلًا جزئيًا على قسم: يرفض الحقول غير المعروفة، ويدمج مع البيانات الحالية.
 * `allowedKeys` (اختياري) = حقول النواقص المفتوحة في وضع التصحيح؛ أي حقل خارجها يُرفض.
 */
export function cleanSectionPatch(section: FormSection, patch: unknown, current: SectionData, allowedKeys?: Set<string>): SectionData {
  if (!isObj(patch)) throw Errors.validation([{ field: '_body', issue: 'must be a JSON object' }]);
  const fields = dataFieldsOf(section);
  const known = new Set(fields.map((f) => f.key as string));
  const details: ErrorDetail[] = [];
  for (const k of Object.keys(patch)) if (!known.has(k)) details.push({ field: k, issue: 'unknown field' });
  if (details.length) throw Errors.validation(details);
  if (allowedKeys) {
    const outside = Object.keys(patch).filter((k) => !allowedKeys.has(k));
    if (outside.length) {
      throw Errors.conflict('FIELD_NOT_IN_DEFICIENCIES',
        'لا يمكن تعديل حقول خارج قائمة النواقص المطلوبة.', 'Only fields listed in the deficiencies can be changed.',
        outside.map((k) => ({ field: k, issue: 'not in deficiencies' })));
    }
  }
  const next: SectionData = { ...current };
  // المحافظة أولًا لأن المنطقة تتحقق مقابلها.
  const ordered = [...Object.keys(patch)].sort((a, b) => (a === 'governorate' ? -1 : b === 'governorate' ? 1 : 0));
  for (const k of ordered) {
    const f = fields.find((x) => x.key === k)!;
    const v = cleanField(f, (patch as Obj)[k], details, next);
    if (v === undefined) continue;
    if (v === null) delete next[k]; else next[k] = v;
  }
  // تغيير المحافظة يُسقط منطقة لا تنتمي إليها.
  if (section === 'general' && typeof next.industrialZone === 'string' && !isValidZone(String(next.governorate ?? ''), next.industrialZone)) {
    delete next.industrialZone;
  }
  if (details.length) throw Errors.validation(details);
  return next;
}

export function totalRoofArea(engineering: SectionData | undefined): number {
  const rows = Array.isArray(engineering?.roofAreas) ? (engineering!.roofAreas as RoofArea[]) : [];
  return Math.round(rows.reduce((s, r) => s + (Number(r.area) || 0), 0) * 100) / 100;
}

export interface DocCounts { [kind: string]: number }

/** اكتمال الطلب للإرسال: الحقول الإجبارية + المستندات (عدد فواتير الكهرباء 1..12). */
export function completenessIssues(data: FormData, docs: Partial<Record<DocumentKind, number>>): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const f of DATA_FIELDS) {
    const v = data[f.section]?.[f.key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty && isRequired(f.key)) details.push({ field: f.key, issue: 'required' });
  }
  const roofs = data.engineering?.roofAreas;
  if (Array.isArray(roofs) && roofs.length > 0 && roofs.length < shamsPolicy.roofAreas.min) details.push({ field: 'roofAreas', issue: `min ${shamsPolicy.roofAreas.min} rows` });
  const exp = data.engineering?.ownershipExpiresAt;
  if (typeof exp === 'string' && exp <= new Date().toISOString().slice(0, 10)) details.push({ field: 'ownershipExpiresAt', issue: 'must be a future date' });
  for (const f of FILE_FIELDS) {
    const n = docs[f.docKind!] ?? 0;
    if (f.type === 'files') {
      const { min, max } = shamsPolicy.electricityBills;
      if (isRequired(f.key) && n < min) details.push({ field: f.key, issue: `at least ${min} file(s)` });
      if (n > max) details.push({ field: f.key, issue: `at most ${max} files` });
    } else if (isRequired(f.key) && n < 1) {
      details.push({ field: f.key, issue: 'required file' });
    }
  }
  return details;
}

export const DATA_FIELD_KEYS = new Set<string>(DATA_FIELDS.map((f) => f.key));
export const FILE_FIELD_KEYS = new Set<string>(FILE_FIELDS.map((f) => f.key));
export const ALL_FORM_FIELD_KEYS = new Set<string>([...DATA_FIELD_KEYS, ...FILE_FIELD_KEYS]);
export type { FormFieldKey };
