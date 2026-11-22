// I2: رسائل التحقق للمستخدم من قاموس أكواد (issue في ApiError.details)، لا من نص السيرفر الخام.
// الكود غير المعروف يعرض رسالة عامة مفهومة بدل نص إنجليزي تقني.

type Msg = { ar: string; en: string };
type Rule = [RegExp, (m: RegExpMatchArray) => Msg];

const RULES: Rule[] = [
  [/^invalid national ID \((\w+)\)$/, (m) => ({
    ar: m[1] === 'format' ? 'الرقم القومي 14 رقمًا بالضبط.' : m[1] === 'century' ? 'الرقم القومي يبدأ بـ 2 (مواليد 1900–1999) أو 3 (مواليد 2000 فما بعد).' : m[1] === 'birth_date' || m[1] === 'future_birth_date' ? 'تاريخ الميلاد داخل الرقم القومي غير صحيح.' : 'كود المحافظة داخل الرقم القومي غير معروف.',
    en: m[1] === 'format' ? 'The national ID must be exactly 14 digits.' : m[1] === 'century' ? 'The ID must start with 2 (born 1900–1999) or 3 (born 2000+).' : m[1] === 'birth_date' || m[1] === 'future_birth_date' ? 'The birth date inside the ID is not valid.' : 'The governorate code inside the ID is unknown.',
  })],
  [/^must be 14 digits$/, () => ({ ar: 'الرقم القومي 14 رقمًا.', en: 'The national ID has 14 digits.' })],
  [/^must be a non-negative number$/, () => ({ ar: 'أدخل رقمًا صفرًا أو أكبر.', en: 'Enter a number, zero or higher.' })],
  [/^must be a non-negative whole number$/, () => ({ ar: 'أدخل عددًا صحيحًا صفرًا أو أكبر.', en: 'Enter a whole number, zero or higher.' })],
  [/^must be between 0 and 100$/, () => ({ ar: 'النسبة بين 0 و100.', en: 'The percentage is between 0 and 100.' })],
  [/^max (\d+) words$/, (m) => ({ ar: `الحد الأقصى ${m[1]} كلمة.`, en: `At most ${m[1]} words.` })],
  [/^cannot exceed the total investment cost$/, () => ({ ar: 'التمويل المطلوب لا يتجاوز إجمالي التكلفة الاستثمارية.', en: 'Requested financing cannot exceed the total investment cost.' })],
  [/^unknown option$/, () => ({ ar: 'اختر قيمة من القائمة.', en: 'Choose a value from the list.' })],
  [/^must be true or false$/, () => ({ ar: 'هذا الإقرار مطلوب.', en: 'This declaration is required.' })],
  [/^must be a list$/, () => ({ ar: 'أضف صفًا واحدًا على الأقل.', en: 'Add at least one row.' })],
  [/^must be \{/, () => ({ ar: 'بيانات الصف غير صالحة.', en: 'Invalid row data.' })],
  [/^required \(3\.\.2000\)$/, () => ({ ar: 'اكتب وصفًا من 3 أحرف على الأقل.', en: 'Write at least 3 characters.' })],
  [/^required \(10\.\.4000\)$/, () => ({ ar: 'اكتب سببًا من 10 أحرف على الأقل.', en: 'Write at least 10 characters.' })],
  [/^evidence PDF required$/, () => ({ ar: 'ارفع ملف PDF يثبت الإنجاز.', en: 'Upload a PDF as evidence.' })],
  [/^non-negative (integer|number)$/, () => ({ ar: 'أدخل رقمًا صفرًا أو أكبر.', en: 'Enter a number, zero or higher.' })],
  [/^must be on or after periodStart$/, () => ({ ar: 'نهاية الفترة بعد بدايتها أو تساويها.', en: 'The period must end on or after its start.' })],
  [/^required$/, () => ({ ar: 'هذا الحقل مطلوب.', en: 'This field is required.' })],
  [/^required file$/, () => ({ ar: 'المستند مطلوب — ارفع ملف PDF.', en: 'This document is required — upload a PDF.' })],
  [/^at least (\d+) file/, (m) => ({ ar: `ارفع ${m[1]} ملف على الأقل.`, en: `Upload at least ${m[1]} file(s).` })],
  [/^at most (\d+) files?/, (m) => ({ ar: `الحد الأقصى ${m[1]} ملف.`, en: `At most ${m[1]} files.` })],
  [/^invalid phone number$/, () => ({ ar: 'رقم هاتف غير صالح — اكتب الأرقام فقط، مثل 01012345678.', en: 'Invalid phone number — digits only, e.g. 01012345678.' })],
  [/^invalid URL/, () => ({ ar: 'رابط موقع غير صالح — مثل www.example.com.', en: 'Invalid website — e.g. www.example.com.' })],
  [/^invalid national ID/, () => ({ ar: 'رقم قومي غير صحيح — 14 رقمًا بتاريخ ميلاد صحيح.', en: 'Invalid national ID — 14 digits with a valid birth date.' })],
  [/^does not match the national ID$/, () => ({ ar: 'تاريخ الميلاد لا يطابق الرقم القومي.', en: 'Birth date does not match the national ID.' })],
  [/^age limit exceeded$/, () => ({ ar: 'العمر يتجاوز الحد الأقصى المسموح به للدورة.', en: 'Age exceeds the cohort limit.' })],
  [/^must be accepted$/, () => ({ ar: 'يجب الموافقة على هذا الإقرار.', en: 'This declaration must be accepted.' })],
  [/^max (\d+) words$/, (m) => ({ ar: `الحد الأقصى ${m[1]} كلمة.`, en: `At most ${m[1]} words.` })],
  [/^max (\d+) rows$/, (m) => ({ ar: `الحد الأقصى ${m[1]} صفًا.`, en: `At most ${m[1]} rows.` })],
  [/^min (\d+) rows$/, (m) => ({ ar: `أضف ${m[1]} صفًا على الأقل.`, en: `Add at least ${m[1]} row(s).` })],
  [/^cannot exceed the (estimated investment|total investment cost)$/, () => ({ ar: 'لا يمكن أن يتجاوز التمويل المطلوب التكلفة الاستثمارية.', en: 'Requested funding cannot exceed the investment cost.' })],
  [/^must be empty for an individual application$/, () => ({ ar: 'التقديم فردي — احذف بيانات الشركاء.', en: 'Individual application — remove the partners.' })],
  [/^a partner cannot have the applicant national ID$/, () => ({ ar: 'الرقم القومي للشريك هو رقم المتقدم نفسه.', en: 'A partner cannot use the applicant national ID.' })],
  [/^duplicate partner national ID$/, () => ({ ar: 'رقم قومي مكرر بين الشركاء.', en: 'Duplicate partner national ID.' })],
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
  [/^duplicate$/, () => ({ ar: 'الرقم القومي مستخدم في طلب مفتوح آخر.', en: 'This national ID is used by another open application.' })],
  [/^unknown or inactive funder$/, () => ({ ar: 'جهة التمويل غير متاحة حاليًا — اختر جهة أخرى.', en: 'This funder is not available — choose another.' })],
  [/^not approved$/, () => ({ ar: 'الخبير غير معتمد في الدليل.', en: 'The expert is not on the approved directory.' })],
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
