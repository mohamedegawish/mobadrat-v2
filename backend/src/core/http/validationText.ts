/**
 * Field-specific validation messages (F7, QA 2026-11-23 BUG-11). An initiative registers Arabic/English labels for the field
 * keys its forms and actions send (registerFieldLabels). A VALIDATION_ERROR answered to a request of that initiative
 * (/api/v1/i/<id>/…, its public routes included) then names each invalid field in Arabic and says what is wrong, and every
 * detail carries its own message, so no English field code reaches the person. The codes stay in `field` / `issue` for
 * programs. An initiative that registers no labels answers exactly as before.
 */
import type { ErrorDetail } from './errors.js';

export interface FieldLabel { ar: string; en: string }
export interface LocalizedDetail extends ErrorDetail { messageAr: string; messageEn: string }

/** The generic message of Errors.validation — the one replaced by the fields' own messages. */
export const GENERIC_VALIDATION_AR = 'البيانات المرسلة غير صحيحة.';

const SCOPES = new Map<string, Map<string, FieldLabel>>();

export function registerFieldLabels(scope: string, labels: Record<string, FieldLabel>): void {
  const m = SCOPES.get(scope) ?? new Map<string, FieldLabel>();
  for (const [k, v] of Object.entries(labels)) m.set(k, v);
  SCOPES.set(scope, m);
}

/** The initiative a request belongs to (/api/v1/i/<id>/…), or null for the platform's own routes. */
export function scopeOfUrl(url: string | undefined): string | null {
  const m = /^\/api\/v1\/i\/([a-z0-9_-]+)(?:[/?]|$)/.exec(url ?? '');
  return m ? m[1] : null;
}

type Rule = [RegExp, (m: RegExpMatchArray) => FieldLabel];

/** What is wrong, by issue code — the same wording as the screens' dictionary (frontend utils/validation.ts). */
const ISSUES: Rule[] = [
  [/^required file$/, () => ({ ar: 'المستند مطلوب — ارفع ملف PDF.', en: 'This document is required — upload a PDF.' })],
  [/^required date/, () => ({ ar: 'التاريخ مطلوب.', en: 'The date is required.' })],
  [/^required positive number/, () => ({ ar: 'أدخل مبلغًا أكبر من صفر.', en: 'Enter an amount above zero.' })],
  [/^required integer$/, () => ({ ar: 'أدخل رقمًا صحيحًا.', en: 'Enter a whole number.' })],
  [/^required \(non-empty list/, () => ({ ar: 'حدد بندًا واحدًا على الأقل مع ملاحظته.', en: 'Choose at least one item with its note.' })],
  [/^required \(max (\d+)\)$/, (m) => ({ ar: `مطلوب (حتى ${m[1]} حرف).`, en: `Required (up to ${m[1]} characters).` })],
  [/^required: (\d+) open application/, (m) => ({ ar: `أكّد العلم بـ ${m[1]} طلب مفتوح مرتبط بهذه الجهة.`, en: `Confirm the ${m[1]} open application(s) bound to this organization.` })],
  [/^required$/, () => ({ ar: 'هذا الحقل مطلوب.', en: 'This field is required.' })],
  [/^at least (\d+) file/, (m) => ({ ar: `ارفع ${m[1]} ملف على الأقل.`, en: `Upload at least ${m[1]} file(s).` })],
  [/^at most (\d+) files?/, (m) => ({ ar: `الحد الأقصى ${m[1]} ملف.`, en: `At most ${m[1]} files.` })],
  [/^invalid phone number$/, () => ({ ar: 'رقم هاتف غير صالح — اكتب الأرقام فقط، مثل 01012345678.', en: 'Invalid phone number — digits only, e.g. 01012345678.' })],
  [/^invalid URL/, () => ({ ar: 'رابط موقع غير صالح — مثل www.factory.com.', en: 'Invalid website — e.g. www.factory.com.' })],
  [/^invalid email$/, () => ({ ar: 'بريد إلكتروني غير صالح — مثل name@company.com.', en: 'Invalid email — e.g. name@company.com.' })],
  [/^must be a positive number \(m²\)$/, () => ({ ar: 'المساحة رقم أكبر من صفر بالمتر المربع.', en: 'Area must be a number above zero (m²).' })],
  [/^must be a positive number/, () => ({ ar: 'أدخل رقمًا أكبر من صفر.', en: 'Enter a number above zero.' })],
  [/^must be a whole number$|^integer /, () => ({ ar: 'أدخل رقمًا صحيحًا.', en: 'Enter a whole number.' })],
  [/^must be a future date$|^must be in the future$/, () => ({ ar: 'يجب أن يكون التاريخ بعد اليوم.', en: 'The date must be in the future.' })],
  [/^must be a date/, () => ({ ar: 'تاريخ غير صالح.', en: 'Invalid date.' })],
  [/^(invalid format|format)$/, () => ({ ar: 'صيغة غير صالحة — حروف وأرقام وشرطة (-) أو (/) فقط.', en: 'Invalid format — letters, digits, “-” or “/” only.' })],
  [/^max length (\d+)$/, (m) => ({ ar: `الحد الأقصى ${m[1]} حرف.`, en: `At most ${m[1]} characters.` })],
  [/^min length (\d+)$/, (m) => ({ ar: `الحد الأدنى ${m[1]} أحرف.`, en: `At least ${m[1]} characters.` })],
  [/^min (\d+) rows$/, (m) => ({ ar: `أضف ${m[1]} صف على الأقل.`, en: `Add at least ${m[1]} row(s).` })],
  [/^max (\d+) (rows|items)$/, (m) => ({ ar: `الحد الأقصى ${m[1]}.`, en: `At most ${m[1]}.` })],
  [/^each row needs a name and a positive area$|^must be \{ name, area \}$/, () => ({ ar: 'لكل صف اسم ومساحة أكبر من صفر.', en: 'Each row needs a name and an area above zero.' })],
  [/^(unknown governorate|zone does not belong|unknown industrial zone|unknown unit|unknown ownership type|unknown option|must be one of|invalid status|active \| )/,
    () => ({ ar: 'اختر قيمة من القائمة.', en: 'Choose a value from the list.' })],
  [/^min 8 chars/, () => ({ ar: 'كلمة المرور 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.', en: 'At least 8 characters with letters and digits.' })],
  [/^not in deficiencies$/, () => ({ ar: 'هذا الحقل ليس ضمن البنود المطلوب تعديلها.', en: 'This field is not among the requested corrections.' })],
  [/^duplicate$/, () => ({ ar: 'رقم السجل مستخدم في طلب مفتوح لمنشأة أخرى.', en: 'This registry number is used by another open application.' })],
  [/^blocked$/, () => ({ ar: 'رقم السجل محظور على حسابك حتى مراجعة وحدة إدارة المبادرة.', en: 'This registry number is blocked for your account pending PMU review.' })],
  [/^invalid$/, () => ({ ar: 'القيمة غير صحيحة أو غير مسجلة.', en: 'The value is invalid or not registered.' })],
  [/^unavailable$/, () => ({ ar: 'تعذر التحقق حاليًا — أعد المحاولة لاحقًا.', en: 'It could not be checked right now — try again later.' })],
  [/^(unknown or inactive bank|bank unavailable)$/, () => ({ ar: 'البنك غير متاح حاليًا — اختر بنكًا آخر.', en: 'This bank is not available — choose another.' })],
  [/^not approved$/, () => ({ ar: 'غير معتمد.', en: 'Not approved.' })],
  [/^same as current email$/, () => ({ ar: 'البريد الجديد مطابق للبريد الحالي.', en: 'The new email is the same as the current one.' })],
  [/^unknown field$/, () => ({ ar: 'هذا البيان غير مقبول في هذه الخطوة.', en: 'This value is not accepted at this step.' })],
  [/^(not editable|locked)$/, () => ({ ar: 'لا يمكن تعديله الآن.', en: 'It cannot be changed now.' })],
  [/^not allowed/, () => ({ ar: 'لا يمكن تعديله في هذه الخطوة.', en: 'It cannot be changed at this step.' })],
  [/^new version required$/, () => ({ ar: 'ارفع نسخة جديدة من المستند.', en: 'Upload a new version of the document.' })],
  [/^(too many versions|limit reached|storage limit)$/, () => ({ ar: 'تم بلوغ الحد الأقصى المسموح.', en: 'The allowed limit is reached.' })],
  [/^invalid file$/, () => ({ ar: 'ملف غير صالح — ارفع ملف PDF سليمًا.', en: 'Invalid file — upload a valid PDF.' })],
  [/^unknown document kind$/, () => ({ ar: 'نوع مستند غير معروف.', en: 'Unknown document type.' })],
  [/^(unknown factory|unknown organization|factory is not a party)/, () => ({ ar: 'اختيار غير صالح.', en: 'Invalid choice.' })],
  [/^taken$/, () => ({ ar: 'مستخدم بالفعل.', en: 'Already in use.' })],
  [/^must be (a string|boolean|true or false|a list|an object|a JSON object|\{)/, () => ({ ar: 'صيغة القيمة غير صحيحة.', en: 'The value has the wrong form.' })],
];
const GENERIC_ISSUE: FieldLabel = { ar: 'قيمة غير صالحة — راجع هذا الحقل.', en: 'Invalid value — please check this field.' };

export function issueText(issue: string): FieldLabel {
  for (const [re, f] of ISSUES) {
    const m = issue.match(re);
    if (m) return f(m);
  }
  return GENERIC_ISSUE;
}

/**
 * A key's label: itself, then without a scope prefix (application., person., factory.), then its last segment
 * (application.company.taxNumber → taxNumber), then its first one (roofAreas[2].area → roofAreas).
 */
function labelOf(labels: Map<string, FieldLabel>, field: string): FieldLabel | null {
  const bare = field.replace(/^(application|person|factory)\./, '');
  const parts = bare.replace(/\[\d+\]/g, '').split('.').filter(Boolean);
  for (const k of [field, bare, parts[parts.length - 1], parts[0]]) { const l = k ? labels.get(k) : undefined; if (l) return l; }
  return null;
}

/** The fields' own messages for a request of `scope`, or null when the scope registered no labels (answer unchanged). */
export function localizeValidation(scope: string | null, details: ErrorDetail[]): { messageAr: string; messageEn: string; details: LocalizedDetail[] } | null {
  const labels = scope ? SCOPES.get(scope) : undefined;
  if (!labels || !details.length) return null;
  const out: LocalizedDetail[] = details.map((d) => {
    const issue = issueText(String(d.issue ?? ''));
    const l = labelOf(labels, String(d.field ?? ''));
    return { ...d, messageAr: l ? `${l.ar}: ${issue.ar}` : issue.ar, messageEn: l ? `${l.en}: ${issue.en}` : issue.en };
  });
  const ar = [...new Set(out.map((d) => d.messageAr))];
  const en = [...new Set(out.map((d) => d.messageEn))];
  return {
    messageAr: ar.length === 1 ? ar[0] : `راجع الحقول التالية — ${ar.join(' ')}`,
    messageEn: en.length === 1 ? en[0] : `Please check — ${en.join(' ')}`,
    details: out,
  };
}
