/**
 * The canonical catalog of shared profile data: every field a person or a factory/company can fill ONCE on the platform
 * and reuse across initiatives. Initiatives declare which of these they need (their requirements manifest), and the
 * platform shows a registered user only what is still missing.
 *
 * Keys are `person.<field>` / `factory.<field>`; storage is a column of person_profiles / factory_profiles, or a key of
 * their `attributes` JSON. Documents are reusable PDFs (profile_documents) of a kind.
 */
import { isEmail, isIsoDate, isPhone, isUrl, normalizeDigits, withHttpScheme } from '../http/validate.js';
import { findGovernorate, isValidZone } from '../reference/locations.js';
import { parseNationalId } from './nationalId.js';

export type ProfileScope = 'person' | 'factory';
export type ProfileFieldType = 'text' | 'textarea' | 'phone' | 'email' | 'url' | 'date' | 'futureDate' | 'nationalId' | 'select' | 'number' | 'integer' | 'roofTable' | 'registryNumber';

export interface Option { value: string; labelAr: string; labelEn: string }

export interface ProfileField {
  key: string;
  scope: ProfileScope;
  /** Column of the profile table, or `attributes.<name>`. */
  storage: string;
  type: ProfileFieldType;
  labelAr: string;
  labelEn: string;
  max?: number;
  /** A fixed option list, or a dynamic source resolved by the API ('governorates' | 'zones'). */
  options?: Option[] | 'governorates' | 'zones';
  /** For 'zones': the field holding the governorate. */
  dependsOn?: string;
  hintAr?: string;
  hintEn?: string;
}

export interface ProfileDocKind { kind: string; scope: ProfileScope; labelAr: string; labelEn: string }

const SECTORS: Option[] = [
  { value: 'manufacturing', labelAr: 'صناعات تحويلية', labelEn: 'Manufacturing' },
  { value: 'food', labelAr: 'صناعات غذائية', labelEn: 'Food industries' },
  { value: 'chemicals', labelAr: 'صناعات كيماوية', labelEn: 'Chemicals' },
  { value: 'engineering', labelAr: 'صناعات هندسية', labelEn: 'Engineering industries' },
  { value: 'textiles', labelAr: 'غزل ونسيج', labelEn: 'Textiles' },
  { value: 'building_materials', labelAr: 'مواد بناء', labelEn: 'Building materials' },
  { value: 'pharma', labelAr: 'أدوية ومستلزمات طبية', labelEn: 'Pharmaceuticals' },
  { value: 'electronics', labelAr: 'إلكترونيات', labelEn: 'Electronics' },
  { value: 'metallurgy', labelAr: 'صناعات معدنية', labelEn: 'Metallurgy' },
  { value: 'other', labelAr: 'أخرى', labelEn: 'Other' },
];

export const PROFILE_FIELDS: readonly ProfileField[] = [
  // ── Person ──
  { key: 'person.fullNameAr', scope: 'person', storage: 'fullNameAr', type: 'text', labelAr: 'الاسم الرباعي', labelEn: 'Full name (Arabic)', max: 200 },
  { key: 'person.fullNameEn', scope: 'person', storage: 'fullNameEn', type: 'text', labelAr: 'الاسم بالإنجليزية', labelEn: 'Full name (English)', max: 200 },
  { key: 'person.nationalId', scope: 'person', storage: 'nationalId', type: 'nationalId', labelAr: 'الرقم القومي', labelEn: 'National ID', hintAr: '14 رقمًا', hintEn: '14 digits' },
  { key: 'person.birthDate', scope: 'person', storage: 'birthDate', type: 'date', labelAr: 'تاريخ الميلاد', labelEn: 'Birth date' },
  {
    key: 'person.nationality', scope: 'person', storage: 'nationality', type: 'select', labelAr: 'الجنسية', labelEn: 'Nationality',
    options: [{ value: 'egyptian', labelAr: 'مصري', labelEn: 'Egyptian' }, { value: 'other', labelAr: 'أخرى', labelEn: 'Other' }],
  },
  { key: 'person.nationalityOther', scope: 'person', storage: 'nationalityOther', type: 'text', labelAr: 'الجنسية (أخرى)', labelEn: 'Nationality (other)', max: 100 },
  { key: 'person.governorate', scope: 'person', storage: 'governorate', type: 'select', labelAr: 'محافظة الإقامة', labelEn: 'Governorate of residence', options: 'governorates' },
  { key: 'person.address', scope: 'person', storage: 'address', type: 'textarea', labelAr: 'العنوان', labelEn: 'Address', max: 500 },
  { key: 'person.phone', scope: 'person', storage: 'phone', type: 'phone', labelAr: 'رقم الموبايل', labelEn: 'Mobile number' },
  { key: 'person.qualification', scope: 'person', storage: 'qualification', type: 'text', labelAr: 'المؤهل الدراسي', labelEn: 'Qualification', max: 300 },
  { key: 'person.experience', scope: 'person', storage: 'experience', type: 'textarea', labelAr: 'الخبرات العملية', labelEn: 'Work experience', max: 2000 },

  // ── Factory / company ──
  { key: 'factory.companyName', scope: 'factory', storage: 'companyName', type: 'text', labelAr: 'اسم الشركة / المنشأة', labelEn: 'Company name', max: 200 },
  { key: 'factory.commercialRegisterNumber', scope: 'factory', storage: 'commercialRegisterNumber', type: 'registryNumber', labelAr: 'رقم السجل التجاري', labelEn: 'Commercial register number', max: 50 },
  { key: 'factory.industrialRegistryNumber', scope: 'factory', storage: 'industrialRegistryNumber', type: 'registryNumber', labelAr: 'رقم السجل الصناعي', labelEn: 'Industrial registry number', max: 50 },
  { key: 'factory.taxNumber', scope: 'factory', storage: 'taxNumber', type: 'registryNumber', labelAr: 'الرقم الضريبي', labelEn: 'Tax number', max: 50 },
  { key: 'factory.governorate', scope: 'factory', storage: 'governorate', type: 'select', labelAr: 'المحافظة', labelEn: 'Governorate', options: 'governorates' },
  { key: 'factory.industrialZone', scope: 'factory', storage: 'industrialZone', type: 'select', labelAr: 'المنطقة الصناعية', labelEn: 'Industrial zone', options: 'zones', dependsOn: 'factory.governorate' },
  { key: 'factory.address', scope: 'factory', storage: 'address', type: 'textarea', labelAr: 'عنوان المنشأة', labelEn: 'Facility address', max: 500 },
  { key: 'factory.phone1', scope: 'factory', storage: 'phone1', type: 'phone', labelAr: 'تليفون (1)', labelEn: 'Phone (1)' },
  { key: 'factory.phone2', scope: 'factory', storage: 'phone2', type: 'phone', labelAr: 'تليفون (2)', labelEn: 'Phone (2)' },
  { key: 'factory.fax', scope: 'factory', storage: 'fax', type: 'phone', labelAr: 'فاكس', labelEn: 'Fax' },
  { key: 'factory.website', scope: 'factory', storage: 'website', type: 'url', labelAr: 'الموقع الإلكتروني', labelEn: 'Website' },
  { key: 'factory.contactName', scope: 'factory', storage: 'contactName', type: 'text', labelAr: 'اسم مسؤول الاتصال', labelEn: 'Contact name', max: 200 },
  { key: 'factory.contactTitle', scope: 'factory', storage: 'contactTitle', type: 'text', labelAr: 'وظيفة مسؤول الاتصال', labelEn: 'Contact job title', max: 200 },
  { key: 'factory.contactMobile', scope: 'factory', storage: 'contactMobile', type: 'phone', labelAr: 'موبايل مسؤول الاتصال', labelEn: 'Contact mobile' },
  { key: 'factory.contactPhone', scope: 'factory', storage: 'contactPhone', type: 'phone', labelAr: 'تليفون مسؤول الاتصال', labelEn: 'Contact phone' },
  { key: 'factory.contactFax', scope: 'factory', storage: 'contactFax', type: 'phone', labelAr: 'فاكس مسؤول الاتصال', labelEn: 'Contact fax' },
  { key: 'factory.contactEmail', scope: 'factory', storage: 'contactEmail', type: 'email', labelAr: 'بريد مسؤول الاتصال', labelEn: 'Contact email' },
  { key: 'factory.sector', scope: 'factory', storage: 'attributes.sector', type: 'select', labelAr: 'القطاع الصناعي', labelEn: 'Industrial sector', options: SECTORS },
  { key: 'factory.employeesCount', scope: 'factory', storage: 'attributes.employeesCount', type: 'integer', labelAr: 'عدد العاملين', labelEn: 'Number of employees' },
  { key: 'factory.roofAreas', scope: 'factory', storage: 'attributes.roofAreas', type: 'roofTable', labelAr: 'المساحات المتاحة من أسطح المنشأة', labelEn: 'Available roof areas' },
  { key: 'factory.contractedCapacity', scope: 'factory', storage: 'attributes.contractedCapacity', type: 'number', labelAr: 'القدرة التعاقدية', labelEn: 'Contracted capacity' },
  {
    key: 'factory.capacityUnit', scope: 'factory', storage: 'attributes.capacityUnit', type: 'select', labelAr: 'وحدة القدرة', labelEn: 'Capacity unit',
    options: [{ value: 'kW', labelAr: 'kW', labelEn: 'kW' }, { value: 'kVA', labelAr: 'kVA', labelEn: 'kVA' }],
  },
  { key: 'factory.peakLoad', scope: 'factory', storage: 'attributes.peakLoad', type: 'number', labelAr: 'أقصى حمل', labelEn: 'Peak load' },
  {
    key: 'factory.loadUnit', scope: 'factory', storage: 'attributes.loadUnit', type: 'select', labelAr: 'وحدة الحمل', labelEn: 'Load unit',
    options: [{ value: 'kW', labelAr: 'kW', labelEn: 'kW' }, { value: 'kVA', labelAr: 'kVA', labelEn: 'kVA' }],
  },
  {
    key: 'factory.ownershipType', scope: 'factory', storage: 'attributes.ownershipType', type: 'select', labelAr: 'نوع الحيازة', labelEn: 'Tenure type',
    options: [
      { value: 'owned', labelAr: 'ملك', labelEn: 'Owned' },
      { value: 'leased', labelAr: 'إيجار', labelEn: 'Leased' },
      { value: 'usufruct', labelAr: 'حق انتفاع', labelEn: 'Usufruct' },
    ],
  },
  { key: 'factory.ownershipExpiresAt', scope: 'factory', storage: 'attributes.ownershipExpiresAt', type: 'futureDate', labelAr: 'تاريخ انتهاء الحيازة', labelEn: 'Tenure expiry date' },
];

export const PROFILE_DOC_KINDS: readonly ProfileDocKind[] = [
  { kind: 'nationalIdFile', scope: 'person', labelAr: 'صورة الرقم القومي', labelEn: 'National ID copy' },
  { kind: 'qualificationFile', scope: 'person', labelAr: 'شهادة المؤهل', labelEn: 'Qualification certificate' },
  { kind: 'commercialRegisterFile', scope: 'factory', labelAr: 'السجل التجاري', labelEn: 'Commercial register' },
  { kind: 'industrialRegisterFile', scope: 'factory', labelAr: 'السجل الصناعي', labelEn: 'Industrial register' },
  { kind: 'taxCardFile', scope: 'factory', labelAr: 'البطاقة الضريبية', labelEn: 'Tax card' },
  { kind: 'ownershipProofFile', scope: 'factory', labelAr: 'إثبات الملكية أو حق الاستخدام', labelEn: 'Ownership / right of use proof' },
];

export const FIELD_BY_KEY = new Map(PROFILE_FIELDS.map((f) => [f.key, f]));
export const DOC_KIND_BY_KEY = new Map(PROFILE_DOC_KINDS.map((d) => [d.kind, d]));

const REGISTER_NUMBER_RE = /^[\p{L}\p{N}][\p{L}\p{N}\s/-]{0,49}$/u;

export function normalizeRegistryNumber(v: string): string {
  return v.trim().replace(/\s+/g, '').toUpperCase();
}

export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Validates and normalises one value. Returns { value } (null = clear) or { issue }.
 * `ctx` gives the other values being saved (for the governorate → zone dependency).
 */
export function cleanProfileValue(f: ProfileField, rawIn: unknown, ctx: Record<string, unknown> = {}): { value: unknown } | { issue: string } {
  if (isEmptyValue(rawIn)) return { value: null };
  const raw = typeof rawIn === 'string' ? normalizeDigits(rawIn) : rawIn;
  switch (f.type) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') return { issue: 'must be a string' };
      const t = raw.trim();
      if (t.length > (f.max ?? 200)) return { issue: `max length ${f.max ?? 200}` };
      return { value: t };
    }
    case 'registryNumber': {
      if (typeof raw !== 'string' || !REGISTER_NUMBER_RE.test(raw.trim())) return { issue: 'invalid format' };
      return { value: f.key === 'factory.industrialRegistryNumber' ? normalizeRegistryNumber(raw) : raw.trim() };
    }
    case 'phone':
      return isPhone(raw) ? { value: (raw as string).trim() } : { issue: 'invalid phone number' };
    case 'email':
      return isEmail(raw) ? { value: (raw as string).trim().toLowerCase() } : { issue: 'invalid email' };
    case 'url': {
      const u = typeof raw === 'string' ? withHttpScheme(raw) : raw;
      if (!isUrl(u) || !new URL(u as string).hostname.includes('.')) return { issue: 'invalid URL (http/https)' };
      return { value: u };
    }
    case 'date':
      return isIsoDate(raw) ? { value: raw } : { issue: 'must be a date YYYY-MM-DD' };
    case 'futureDate':
      if (!isIsoDate(raw)) return { issue: 'must be a date YYYY-MM-DD' };
      return (raw as string) > new Date().toISOString().slice(0, 10) ? { value: raw } : { issue: 'must be in the future' };
    case 'nationalId': {
      const p = parseNationalId(String(raw).trim());
      return p.ok ? { value: String(raw).trim() } : { issue: `invalid national ID (${p.issue})` };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return { issue: 'must be a positive number' };
      return { value: Math.round(n * 1000) / 1000 };
    }
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) return { issue: 'must be a whole number' };
      return { value: n };
    }
    case 'select': {
      if (typeof raw !== 'string') return { issue: 'must be a string' };
      if (f.options === 'governorates') return findGovernorate(raw) ? { value: raw } : { issue: 'unknown governorate' };
      if (f.options === 'zones') {
        const gov = String(ctx[f.dependsOn ?? ''] ?? '');
        return gov && isValidZone(gov, raw) ? { value: raw } : { issue: 'unknown industrial zone for the governorate' };
      }
      return (f.options ?? []).some((o) => o.value === raw) ? { value: raw } : { issue: 'unknown option' };
    }
    case 'roofTable': {
      if (!Array.isArray(raw)) return { issue: 'must be a list' };
      if (raw.length > 50) return { issue: 'max 50 rows' };
      const rows: Array<{ name: string; area: number }> = [];
      for (const r of raw) {
        const o = r as { name?: unknown; area?: unknown };
        const name = typeof o?.name === 'string' ? o.name.trim() : '';
        const area = Number(typeof o?.area === 'string' ? normalizeDigits(o.area) : o?.area);
        if (!name || name.length > 100 || !Number.isFinite(area) || area <= 0) return { issue: 'each row needs a name and a positive area' };
        rows.push({ name, area: Math.round(area * 100) / 100 });
      }
      return { value: rows };
    }
  }
}
