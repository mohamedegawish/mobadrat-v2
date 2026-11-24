// I2: رسائل التحقق للمستخدم من قاموس أكواد (issue في ApiError.details)، لا من نص السيرفر الخام.
// الكود غير المعروف يعرض رسالة عامة مفهومة بدل نص إنجليزي تقني.

type Msg = { ar: string; en: string };
type Rule = [RegExp, (m: RegExpMatchArray) => Msg];

const RULES: Rule[] = [
  [/^required$/, () => ({ ar: 'هذا الحقل مطلوب.', en: 'This field is required.' })],
  [/^required file$/, () => ({ ar: 'المستند مطلوب — ارفع ملف PDF.', en: 'This document is required — upload a PDF.' })],
  [/^at least (\d+) file/, (m) => ({ ar: `ارفع ${m[1]} ملف على الأقل.`, en: `Upload at least ${m[1]} file(s).` })],
  [/^at most (\d+) files?/, (m) => ({ ar: `الحد الأقصى ${m[1]} ملف.`, en: `At most ${m[1]} files.` })],
  [/^invalid phone number$/, () => ({ ar: 'رقم هاتف غير صالح — اكتب الأرقام فقط، مثل 01012345678.', en: 'Invalid phone number — digits only, e.g. 01012345678.' })],
  [/^invalid URL/, () => ({ ar: 'رابط موقع غير صالح — مثل www.factory.com.', en: 'Invalid website — e.g. www.factory.com.' })],
  [/^invalid email$/, () => ({ ar: 'بريد إلكتروني غير صالح — مثل name@company.com.', en: 'Invalid email — e.g. name@company.com.' })],
  [/^must be a positive number \(m²\)$/, () => ({ ar: 'المساحة رقم أكبر من صفر بالمتر المربع.', en: 'Area must be a number above zero (m²).' })],
  [/^must be a positive number/, () => ({ ar: 'أدخل رقمًا أكبر من صفر.', en: 'Enter a number above zero.' })],
  [/^must be a date/, () => ({ ar: 'تاريخ غير صالح.', en: 'Invalid date.' })],
  [/^required date/, () => ({ ar: 'التاريخ مطلوب.', en: 'The date is required.' })],
  [/^must be a future date$/, () => ({ ar: 'يجب أن يكون التاريخ بعد اليوم.', en: 'The date must be in the future.' })],
  [/^invalid format$/, () => ({ ar: 'صيغة غير صالحة — حروف وأرقام وشرطة (-) أو (/) فقط.', en: 'Invalid format — letters, digits, “-” or “/” only.' })],
  [/^max length (\d+)$/, (m) => ({ ar: `الحد الأقصى ${m[1]} حرف.`, en: `At most ${m[1]} characters.` })],
  [/^min length (\d+)$/, (m) => ({ ar: `الحد الأدنى ${m[1]} أحرف.`, en: `At least ${m[1]} characters.` })],
  [/^min (\d+) rows$/, (m) => ({ ar: `أضف ${m[1]} صف على الأقل.`, en: `Add at least ${m[1]} row(s).` })],
  [/^max (\d+) rows$/, (m) => ({ ar: `الحد الأقصى ${m[1]} صف.`, en: `At most ${m[1]} rows.` })],
  [/^required \(max 100\)$/, () => ({ ar: 'الاسم مطلوب (حتى 100 حرف).', en: 'Name required (up to 100 characters).' })],
  [/^(unknown governorate|zone does not belong|unknown unit|unknown ownership type)/, () => ({ ar: 'اختر قيمة من القائمة.', en: 'Choose a value from the list.' })],
  [/^min 8 chars/, () => ({ ar: 'كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', en: 'At least 8 characters with letters and digits.' })],
  [/^(not in deficiencies)$/, () => ({ ar: 'هذا الحقل ليس ضمن البنود المطلوب تعديلها.', en: 'This field is not among the requested corrections.' })],
  [/^duplicate$/, () => ({ ar: 'رقم السجل مستخدم في طلب مفتوح لمنشأة أخرى.', en: 'This registry number is used by another open application.' })],
  [/^blocked$/, () => ({ ar: 'رقم السجل محظور على حسابك حتى مراجعة وحدة إدارة المبادرة.', en: 'This registry number is blocked for your account pending PMU review.' })],
  [/^invalid$/, () => ({ ar: 'رقم السجل الصناعي غير صحيح أو غير مسجل.', en: 'The industrial registry number is invalid.' })],
  [/^unavailable$/, () => ({ ar: 'تعذر التحقق من السجل الصناعي حاليًا.', en: 'The registry could not be checked right now.' })],
  [/^(unknown or inactive bank|bank unavailable)$/, () => ({ ar: 'البنك غير متاح حاليًا — اختر بنكًا آخر.', en: 'This bank is not available — choose another.' })],
  [/^not approved$/, () => ({ ar: 'مقدم الخدمة غير معتمد.', en: 'The provider is not approved.' })],
  [/^same as current email$/, () => ({ ar: 'البريد الجديد مطابق للبريد الحالي.', en: 'The new email is the same as the current one.' })],
];

export function validationMessage(issue: string | undefined, isAr: boolean): string {
  if (!issue) return '';
  for (const [re, f] of RULES) {
    const m = issue.match(re);
    if (m) { const r = f(m); return isAr ? r.ar : r.en; }
  }
  return isAr ? 'قيمة غير صالحة — راجع الحقل.' : 'Invalid value — please check this field.';
}

/** I2: أرقام لوحة المفاتيح العربية (٠-٩) والفارسية (۰-۹) → لاتينية. السيرفر يطبق نفس التحويل. */
export function toLatinDigits(v: string): string {
  return v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// ── تحقق فوري في الواجهة يطابق قواعد السيرفر (backend/src/http/validate.ts) — للتنبيه قبل الحفظ؛ السيرفر يبقى المرجع. ──
const PHONE_RE = /^\+?[0-9][0-9\s-]{5,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** F7: صيغة رقم السجل / السجل التجاري / الرقم الضريبي — نفس قاعدة السيرفر (REGISTER_NUMBER_RE في workflow/validate.ts). */
const REGISTER_NUMBER_RE = /^[\p{L}\p{N}][\p{L}\p{N}\s/-]{0,49}$/u;
const REGISTER_NUMBER_KEYS = new Set(['industrialRegistryNumber', 'commercialRegisterNumber', 'taxNumber']);

/** F7: «invalid format» لرقم سجل لا يطابق القاعدة — يُفحص في الصفحة قبل الإرسال. */
export function registerNumberIssue(key: string, value: unknown): string | null {
  if (!REGISTER_NUMBER_KEYS.has(key) || typeof value !== 'string') return null;
  const v = toLatinDigits(value).trim();
  return v === '' || REGISTER_NUMBER_RE.test(v) ? null : 'invalid format';
}

/** كود المشكلة (نفس أكواد السيرفر) لقيمة حقل من نوع معين، أو null إن كانت سليمة أو فارغة. */
export function clientFieldIssue(type: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const v = typeof value === 'string' ? toLatinDigits(value).trim() : value;
  if (v === '') return null;
  switch (type) {
    case 'phone': return typeof v === 'string' && PHONE_RE.test(v) ? null : 'invalid phone number';
    case 'email': return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v) ? null : 'invalid email';
    case 'url': {
      if (typeof v !== 'string') return 'invalid URL (http/https)';
      const u = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
      try { const p = new URL(u); return u.length <= 300 && (p.protocol === 'http:' || p.protocol === 'https:') && p.hostname.includes('.') ? null : 'invalid URL (http/https)'; } catch { return 'invalid URL (http/https)'; }
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) && n > 0 && n <= 10_000_000 ? null : 'must be a positive number';
    }
    default: return null;
  }
}
