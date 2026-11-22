/**
 * رسالة نجاح الإرسال: المعالج يضعها قبل الانتقال إلى «لوحتي»، واللوحة تعرضها مرة واحدة.
 * في الذاكرة فقط (لا تخزين) — إعادة تحميل الصفحة تُسقطها، والحالة الحقيقية تبقى في بطاقة الطلب.
 */
export interface SubmitFlash { appId: string; number: string | null; stateLabelAr: string; stateLabelEn: string; resubmitted: boolean; /** حساب غير مقبول: انتهت الجلسة بعد الإرسال (الرسالة في صفحة الدخول). */ signedOut?: boolean }

let pending: SubmitFlash | null = null;

export function setSubmitFlash(f: SubmitFlash): void { pending = f; }

export function takeSubmitFlash(): SubmitFlash | null {
  const f = pending;
  pending = null;
  return f;
}

