/** تحقق بيانات الاستمارة والدراسة: قائمة حقول مسموح بها لكل قسم + تحقق النوع + اكتمال الإرسال + الحسابات التلقائية. */
import { Errors, type ErrorDetail } from '../http/errors.js';
import { isEmail, isIsoDate, isObj, isPhone, normalizeDigits, type Obj } from '../http/validate.js';
import { policy } from '../config/initiativePolicy.js';
import { findGovernorate } from '../config/locations.js';
import {
  dataFieldsOf, fieldsOfForm, FIELD_BY_KEY, formOfSection, type ColumnDef, type FieldDef, type FormKind, type FormSection, type DocumentKind, type OptionsKey,
} from './applicationForm.js';
import { parseNationalId } from './nationalId.js';

export type SectionData = Record<string, unknown>;
export type FormData = Partial<Record<FormSection, SectionData>>;

const MAX_MONEY = 1e12;

/** قوائم الخيارات الثابتة (الخبراء يُتحقق منهم في الخدمة لأنهم من قاعدة البيانات). */
function optionValues(key: OptionsKey): readonly string[] | null {
  switch (key) {
    case 'nationalities': return policy.nationalities.map((o) => o.value);
    case 'applicationTypes': return policy.applicationTypes.map((o) => o.value);
    case 'sectors': return policy.sectors.map((o) => o.value);
    case 'projectStages': return policy.projectStages.map((o) => o.value);
    case 'startTimelines': return policy.startTimelines.map((o) => o.value);
    case 'technologyLevels': return policy.technologyLevels.map((o) => o.value);
    case 'materialSources': return policy.materialSources.map((o) => o.value);
    case 'financingModels': return policy.financingModels.map((o) => o.value);
    default: return null;
  }
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/u).filter(Boolean).length;
}

type Scalar = 'text' | 'textarea' | 'phone' | 'email' | 'number' | 'integer' | 'money' | 'percent' | 'date' | 'nationalId' | 'select' | 'yesNo' | 'checkbox';

/** يتحقق من قيمة واحدة. يرجع القيمة المنظفة، أو null للمسح، أو undefined عند الخطأ (مع إضافة الخطأ). */
function cleanScalar(type: Scalar, rawIn: unknown, field: string, details: ErrorDetail[], opts: { maxLength?: number; maxWords?: number; options?: OptionsKey }): unknown {
  if (rawIn === null || rawIn === '' || rawIn === undefined) return null;
  // أرقام لوحة المفاتيح العربية تُقبل في كل الحقول الرقمية والهواتف والتواريخ.
  const raw = typeof rawIn === 'string' && type !== 'text' && type !== 'textarea' ? normalizeDigits(rawIn) : rawIn;
  const bad = (issue: string) => { details.push({ field, issue }); return undefined; };
  switch (type) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return bad('must be a string');
      const t = raw.trim();
      if (!t) return null;
      const max = opts.maxLength ?? 200;
      if (t.length > max) return bad(`max length ${max}`);
      if (opts.maxWords && wordCount(t) > opts.maxWords) return bad(`max ${opts.maxWords} words`);
      return t;
    }
    case 'phone':
      if (!isPhone(raw)) return bad('invalid phone number');
      return (raw as string).trim();
    case 'email':
      if (!isEmail(raw)) return bad('invalid email');
      return (raw as string).trim().toLowerCase();
    case 'number':
    case 'money':
    case 'percent': {
      const n = typeof raw === 'number' ? raw : Number(typeof raw === 'string' ? raw.replace(/,/g, '') : raw);
      if (!Number.isFinite(n) || n < 0) return bad('must be a non-negative number');
      if (type === 'percent' && n > 100) return bad('must be between 0 and 100');
      if (n > MAX_MONEY) return bad('number too large');
      return Math.round(n * 100) / 100;
    }
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return bad('must be a non-negative whole number');
      return n;
    }
    case 'date':
      if (!isIsoDate(raw)) return bad('must be a date YYYY-MM-DD');
      return raw;
    case 'nationalId': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return bad('must be 14 digits');
      const t = String(raw).replace(/\s+/g, '');
      const r = parseNationalId(t);
      if (!r.ok) return bad(`invalid national ID (${r.issue})`);
      return t;
    }
    case 'select': {
      if (typeof raw !== 'string') return bad('must be a string');
      if (opts.options === 'governorates') return findGovernorate(raw) ? raw : bad('unknown governorate');
      const values = opts.options ? optionValues(opts.options) : null;
      if (values && !values.includes(raw)) return bad('unknown option');
      if (opts.options === 'experts' && !/^[\w-]{1,100}$/.test(raw)) return bad('invalid id');
      return raw;
    }
    case 'yesNo':
    case 'checkbox':
      if (typeof raw !== 'boolean') return bad('must be true or false');
      return raw;
    default:
      return bad('not editable');
  }
}

function cleanTable(fd: FieldDef, raw: unknown, details: ErrorDetail[]): unknown {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) { details.push({ field: fd.key, issue: 'must be a list' }); return undefined; }
  if (fd.maxItems && raw.length > fd.maxItems) { details.push({ field: fd.key, issue: `max ${fd.maxItems} rows` }); return undefined; }
  const cols = fd.columns ?? [];
  const known = new Set(cols.map((c) => c.key));
  const rows: Array<Record<string, unknown>> = [];
  raw.forEach((r, i) => {
    if (!isObj(r) || Object.keys(r).some((k) => !known.has(k))) { details.push({ field: `${fd.key}[${i}]`, issue: `must be { ${[...known].join(', ')} }` }); return; }
    const row: Record<string, unknown> = {};
    for (const c of cols) {
      const v = cleanScalar(columnScalar(c), (r as Obj)[c.key], `${fd.key}[${i}].${c.key}`, details, { maxLength: c.maxLength, options: c.options });
      if (v !== undefined && v !== null) row[c.key] = v;
    }
    rows.push(row);
  });
  return rows;
}

function columnScalar(c: ColumnDef): Scalar {
  return c.type === 'nationalId' ? 'nationalId' : c.type;
}

/**
 * ينظف تعديلًا جزئيًا على قسم: يرفض الحقول غير المعروفة، ويدمج مع البيانات الحالية.
 * `allowedKeys` (اختياري) = حقول النواقص المفتوحة في وضع التصحيح؛ أي حقل خارجها يُرفض.
 */
export function cleanSectionPatch(section: FormSection, patch: unknown, current: SectionData, allowedKeys?: Set<string>): SectionData {
  if (!isObj(patch)) throw Errors.validation([{ field: '_body', issue: 'must be a JSON object' }]);
  const fields = dataFieldsOf(section);
  const known = new Set(fields.map((x) => x.key));
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
  for (const k of Object.keys(patch)) {
    const fd = fields.find((x) => x.key === k)!;
    const v = fd.type === 'table' ? cleanTable(fd, (patch as Obj)[k], details)
      : cleanScalar(fd.type as Scalar, (patch as Obj)[k], k, details, { maxLength: fd.maxLength, maxWords: fd.maxWords, options: fd.options });
    if (v === undefined) continue;
    if (v === null) delete next[k]; else next[k] = v;
  }
  if (details.length) throw Errors.validation(details);
  return next;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** هل الحقل إجباري بالنظر لقيم قسمه (requiredWhen)؟ */
export function isFieldRequired(fd: FieldDef, section: SectionData | undefined): boolean {
  if (fd.required) return true;
  if (!fd.requiredWhen) return false;
  return section?.[fd.requiredWhen.field] === fd.requiredWhen.equals;
}

/** اكتمال الاستمارة أو الدراسة للإرسال: الحقول الإجبارية + صفوف الجداول + المستندات + الإقرارات. */
export function completenessIssues(kind: FormKind, data: FormData, docs: Partial<Record<DocumentKind, number>>): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const fd of fieldsOfForm(kind)) {
    const sec = data[fd.section];
    if (fd.type === 'file' || fd.type === 'files') {
      const n = docs[fd.docKind!] ?? 0;
      if (isFieldRequired(fd, sec) && n < 1) details.push({ field: fd.key, issue: 'required file' });
      if (fd.maxItems && n > fd.maxItems) details.push({ field: fd.key, issue: `at most ${fd.maxItems} files` });
      continue;
    }
    const v = sec?.[fd.key];
    if (fd.type === 'checkbox') {
      if (fd.required && v !== true) details.push({ field: fd.key, issue: 'must be accepted' });
      continue;
    }
    if (isEmpty(v)) {
      if (isFieldRequired(fd, sec)) details.push({ field: fd.key, issue: 'required' });
      continue;
    }
    if (fd.type === 'table' && Array.isArray(v)) {
      if (fd.minItems && v.length < fd.minItems && isFieldRequired(fd, sec)) details.push({ field: fd.key, issue: `min ${fd.minItems} rows` });
      v.forEach((row, i) => {
        for (const c of fd.columns ?? []) {
          if (c.required && isEmpty((row as Obj)[c.key])) details.push({ field: `${fd.key}[${i}].${c.key}`, issue: 'required' });
        }
      });
    }
  }
  // اتساق تاريخ الميلاد مع الرقم القومي.
  if (kind === 'application') {
    const p = data.personal;
    const id = typeof p?.nationalId === 'string' ? parseNationalId(p.nationalId) : null;
    if (id?.ok && typeof p?.birthDate === 'string' && id.info.birthDate !== p.birthDate) {
      details.push({ field: 'birthDate', issue: 'does not match the national ID' });
    }
    const partners = Array.isArray(data.team?.partners) ? (data.team!.partners as Obj[]) : [];
    if (data.team?.applicationType === 'individual' && partners.length) details.push({ field: 'partners', issue: 'must be empty for an individual application' });
    const ids = partners.map((x) => x.nationalId).filter(Boolean);
    if (typeof p?.nationalId === 'string' && ids.includes(p.nationalId)) details.push({ field: 'partners', issue: 'a partner cannot have the applicant national ID' });
    if (new Set(ids).size !== ids.length) details.push({ field: 'partners', issue: 'duplicate partner national ID' });
    const r = data.readiness;
    if (typeof r?.requestedFunding === 'number' && typeof r?.estimatedCost === 'number' && r.requestedFunding > r.estimatedCost) {
      details.push({ field: 'requestedFunding', issue: 'cannot exceed the estimated investment' });
    }
  }
  if (kind === 'study') {
    const fin = data.study_financial;
    const totals = studyTotals(data);
    if (typeof fin?.requestedFinancing === 'number' && fin.requestedFinancing > totals.totalInvestment && totals.totalInvestment > 0) {
      details.push({ field: 'requestedFinancing', issue: 'cannot exceed the total investment cost' });
    }
  }
  return details;
}

export interface StudyTotals {
  totalAssets: number;
  monthlyMaterials: number;
  totalInvestment: number;
  firstYearNetProfit: number;
  planTotal: number;
  planWeeks: number;
  totalJobs: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** حسابات الدراسة التلقائية (§7): تُخزن مع الدراسة وتظهر للجنة. */
export function studyTotals(data: FormData): StudyTotals {
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Obj[]) : []);
  const totalAssets = rows(data.study_technical?.assets).reduce((s, r) => s + num(r.cost) * Math.max(1, num(r.quantity) || 1), 0);
  const monthlyMaterials = rows(data.study_technical?.materials).reduce((s, r) => s + num(r.monthlyCost), 0);
  const fin = data.study_financial ?? {};
  const totalInvestment = totalAssets + num(fin.establishmentCosts) + num(fin.workingCapital);
  const plan = rows(data.study_plan?.phases);
  return {
    totalAssets: round2(totalAssets),
    monthlyMaterials: round2(monthlyMaterials),
    totalInvestment: round2(totalInvestment),
    firstYearNetProfit: round2(num(fin.firstYearRevenue) - num(fin.firstYearCosts)),
    planTotal: round2(plan.reduce((s, r) => s + num(r.amount), 0)),
    planWeeks: plan.reduce((s, r) => s + num(r.weeks), 0),
    totalJobs: num(data.study_impact?.directJobs) + num(data.study_impact?.indirectJobs),
  };
}

export const ALL_FIELD_KEYS = new Set<string>([...FIELD_BY_KEY.keys()]);
export function isStudySection(s: FormSection): boolean { return formOfSection(s) === 'study'; }
