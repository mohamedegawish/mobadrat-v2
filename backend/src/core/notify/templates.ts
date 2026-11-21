/**
 * Platform (core) message templates — account messages sent by the platform itself, in the platform's official layout.
 * Each initiative module keeps its own templates and layout (its branding) for its business messages.
 */
import { config } from '../../config.js';
import { detailsTable, escapeHtml, paragraph, renderEmail, statusPanel, type EmailTone } from '../mail/layout.js';

export const CORE_TEMPLATE_KEYS = [
  'auth.verify_email', 'auth.reset_password', 'auth.suspicious_logins', 'auth.registration_attempt',
  'auth.account_setup', 'auth.email_changed_old', 'auth.email_changed_new',
  'platform.membership_added', 'platform.enrolled',
] as const;
export type CoreTemplateKey = (typeof CORE_TEMPLATE_KEYS)[number];

export interface CoreTemplateVars {
  name?: string; link?: string; count?: number; hours?: number; purpose?: 'setup' | 'reset';
  initiativeAr?: string; initiativeEn?: string; roleAr?: string; email?: string;
}

export interface Rendered { subject: string; html: string; text: string; sms: string }

const BRAND = 'المنصة الوطنية للمبادرات الصناعية';

/** Platform screen link (no token; requires sign-in). */
export function platformLink(view: string): string {
  return `${config.appUrl}/#${view}`;
}

function build(o: {
  subject: string; heading: string; tone: EmailTone; panelTitle: string; panelText: string; body?: string;
  rows?: Array<[string, string]>; ctaLabel?: string; link?: string; english: string; sms: string;
}): Rendered {
  const bodyHtml = [statusPanel(o.tone, o.panelTitle, o.panelText), o.rows?.length ? detailsTable(o.rows) : '', o.body ?? ''].join('');
  const html = renderEmail({
    preheader: o.panelText, heading: o.heading, bodyHtml,
    cta: o.link && o.ctaLabel ? { label: o.ctaLabel, href: o.link } : undefined,
    englishSummary: o.english,
  });
  const text = [o.heading, o.panelText, ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`), o.link ? `الرابط: ${o.link}` : '', '', o.english].filter(Boolean).join('\n');
  return { subject: o.subject, html, text, sms: o.sms };
}

export function renderCoreTemplate(key: CoreTemplateKey, v: CoreTemplateVars): Rendered {
  const link = v.link ?? config.appUrl;
  switch (key) {
    case 'auth.verify_email':
      return build({
        subject: `تفعيل حسابك — ${BRAND}`, heading: 'تفعيل البريد الإلكتروني', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`, panelText: 'اضغط الزر لتفعيل حسابك على المنصة الوطنية للمبادرات الصناعية. الرابط صالح لمدة 24 ساعة ولمرة واحدة. حساب واحد يكفيك للتقديم على كل المبادرات.',
        ctaLabel: 'تفعيل الحساب', link, english: 'Activate your account on the National Industrial Initiatives Platform (valid for 24 hours, single use).',
        sms: 'المنصة الوطنية للمبادرات: تم إرسال رابط تفعيل الحساب إلى بريدك الإلكتروني.',
      });
    case 'auth.reset_password':
      return build({
        subject: `استعادة كلمة المرور — ${BRAND}`, heading: 'استعادة كلمة المرور', tone: 'warning',
        panelTitle: 'طلب استعادة كلمة المرور', panelText: 'اضغط الزر لتعيين كلمة مرور جديدة. الرابط صالح لمدة ساعة ولمرة واحدة. إذا لم تطلب ذلك فتجاهل الرسالة.',
        ctaLabel: 'تعيين كلمة مرور جديدة', link, english: 'Use the button above to set a new password (valid for 1 hour, single use). Ignore this email if you did not request it.',
        sms: 'المنصة الوطنية للمبادرات: تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني.',
      });
    case 'auth.suspicious_logins':
      return build({
        subject: `محاولات دخول فاشلة متكررة على حسابك — ${BRAND}`, heading: 'محاولات دخول فاشلة', tone: 'warning',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: `سُجلت ${v.count ?? 0} محاولة دخول فاشلة متتالية على حسابك. لم يُقفل الحساب، لكن المحاولات من نفس العنوان تتأخر تدريجيًا. إذا لم تكن أنت فاختر كلمة مرور قوية من «نسيت كلمة المرور».`,
        english: 'Repeated failed sign-in attempts were recorded on your account. It is not locked; consider changing your password if this was not you.',
        sms: 'المنصة الوطنية للمبادرات: محاولات دخول فاشلة متكررة على حسابك.',
      });
    case 'auth.registration_attempt':
      return build({
        subject: `محاولة تسجيل ببريدك — ${BRAND}`, heading: 'بريدك مسجل بالفعل', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: `حاول أحد إنشاء حساب جديد ببريدك الإلكتروني${v.initiativeAr ? ` للتقديم على «${v.initiativeAr}»` : ''}، وهو مسجل بالفعل فلم يُنشأ حساب جديد. إذا كنت أنت فسجّل الدخول بحسابك الحالي ثم قدّم على المبادرة من صفحتها — ستظهر لك فقط البيانات الناقصة لاستكمالها.`,
        ctaLabel: 'تسجيل الدخول', link: platformLink('login'),
        english: 'Someone tried to register with your email, which already has an account. No new account was created — sign in and apply from the initiative page.',
        sms: 'المنصة الوطنية للمبادرات: محاولة تسجيل جديدة ببريدك المسجل.',
      });
    case 'auth.account_setup': {
      const reset = v.purpose === 'reset';
      return build({
        subject: reset ? `إعادة تعيين كلمة المرور لحسابك — ${BRAND}` : `تعيين كلمة المرور لحسابك الجديد — ${BRAND}`,
        heading: reset ? 'إعادة تعيين كلمة المرور' : 'تم إنشاء حسابك', tone: reset ? 'warning' : 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: reset
          ? `طلبت إدارة المنصة إعادة تعيين كلمة مرور حسابك، وأُنهيت كل الجلسات المفتوحة. اضغط الزر لتعيين كلمة مرور جديدة. الرابط صالح ${v.hours ?? 72} ساعة ولمرة واحدة.`
          : `أُنشئ لك حساب على المنصة الوطنية للمبادرات الصناعية${v.initiativeAr ? ` (${v.initiativeAr})` : ''}. اضغط الزر لتعيين كلمة المرور. الرابط صالح ${v.hours ?? 72} ساعة ولمرة واحدة.`,
        ctaLabel: 'تعيين كلمة المرور', link,
        english: reset ? 'Your password was reset by the administration. Set a new one with the button above (single use).'
          : 'An account was created for you on the National Industrial Initiatives Platform. Set your password with the button above (single use).',
        sms: 'المنصة الوطنية للمبادرات: أُرسل رابط تعيين كلمة المرور إلى بريدك الإلكتروني.',
      });
    }
    case 'auth.email_changed_old':
      return build({
        subject: `تغيير البريد الإلكتروني لحسابك — ${BRAND}`, heading: 'تم تغيير بريد الحساب', tone: 'warning',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'غيّرت إدارة المنصة البريد الإلكتروني لحسابك بناءً على طلب رسمي، وأُنهيت كل الجلسات المفتوحة. إذا لم تطلب ذلك فتواصل مع قناة الاستفسار فورًا.',
        english: 'The email address of your account was changed by the platform administration on a formal request. If you did not request this, contact support immediately.',
        sms: 'المنصة الوطنية للمبادرات: تم تغيير البريد الإلكتروني لحسابك.',
      });
    case 'auth.email_changed_new':
      return build({
        subject: `تفعيل البريد الجديد لحسابك — ${BRAND}`, heading: 'تفعيل البريد الإلكتروني الجديد', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'نُقل حسابك إلى هذا البريد بناءً على طلب رسمي. اضغط الزر لتفعيله، ثم استخدم «نسيت كلمة المرور» لتعيين كلمة مرور جديدة. الرابط صالح لمدة 24 ساعة ولمرة واحدة.',
        ctaLabel: 'تفعيل البريد', link, english: 'Your account was moved to this email address. Activate it with the button above (24 hours, single use), then reset your password.',
        sms: 'المنصة الوطنية للمبادرات: أُرسل رابط تفعيل البريد الجديد لحسابك.',
      });
    case 'platform.membership_added':
      return build({
        subject: `أُضيفت لك صلاحية في «${v.initiativeAr ?? ''}» — ${BRAND}`, heading: 'صلاحية جديدة على حسابك', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: `أُضيف إلى حسابك دور «${v.roleAr ?? ''}» في مبادرة «${v.initiativeAr ?? ''}». ادخل بحسابك الحالي واختر المبادرة من صفحة «مبادراتي».`,
        rows: [['المبادرة', v.initiativeAr ?? ''], ['الدور', v.roleAr ?? '']],
        ctaLabel: 'فتح مبادراتي', link: platformLink('hub'),
        english: `A role was added to your account in the ${v.initiativeEn ?? ''} initiative. Sign in and pick it from "My initiatives".`,
        sms: `المنصة الوطنية للمبادرات: أُضيف لحسابك دور في مبادرة ${v.initiativeAr ?? ''}.`,
      });
    case 'platform.enrolled':
      return build({
        subject: `بدأت التقديم على «${v.initiativeAr ?? ''}» — ${BRAND}`, heading: 'تم فتح ملف التقديم', tone: 'success',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: `فُتح لك ملف تقديم في مبادرة «${v.initiativeAr ?? ''}» واستُخدمت بياناتك المسجلة على المنصة. أكمل الخطوات المطلوبة من لوحة المبادرة.`,
        ctaLabel: 'متابعة التقديم', link,
        english: `Your application file in the ${v.initiativeEn ?? ''} initiative was opened using your platform data. Continue from the initiative dashboard.`,
        sms: `المنصة الوطنية للمبادرات: فُتح لك ملف تقديم في مبادرة ${v.initiativeAr ?? ''}.`,
      });
  }
}

export { escapeHtml, paragraph };
