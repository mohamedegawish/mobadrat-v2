/** قوالب الإشعارات (بريد HTML بالقالب الرسمي + SMS قصير) — عربي أولًا مع ملخص إنجليزي. */
import { config } from '../config.js';
import { detailsTable, escapeHtml, escapeMultiline, paragraph, renderEmail, sectionTitle, statusPanel, type EmailTone } from '../mail/layout.js';

/** كل مفاتيح القوالب — يمر عليها اختبار القوالب الآلي (لا متغير فارغ، زر واحد على الأكثر). */
export const TEMPLATE_KEYS = [
  'auth.verify_email', 'auth.reset_password',
  'app.registry_failed', 'app.review_assigned', 'app.resubmitted', 'app.correction_requested', 'app.rejected',
  'app.encpc_compliant', 'app.offer_accepted', 'app.closed', 'app.sla_overdue',
  'app.submitted', 'app.imc_accepted', 'app.provider_suspended',
  'auth.email_changed_old', 'auth.email_changed_new',
  'ops.no_recipients', 'ops.no_providers', 'ops.registry_conflict', 'ops.contract_amount_alert', 'ops.bank_unavailable',
  // المراجعة الأمنية
  'auth.account_setup', 'ops.account_request', 'ops.account_event', 'auth.suspicious_logins', 'auth.registration_attempt',
  'ops.integration_key', 'registry.blocked', 'registry.released', 'ops.registry_objection', 'registry.objection_decided',
  'ops.registry_held_by_inactive', 'auth.recovery_requested', 'ops.recovery_pending', 'auth.recovery_approved', 'auth.recovery_closed',
  // دليل مقدمي الخدمة
  'ops.provider_pending', 'ops.provider_changed',
  // إيصالات ونتائج
  'app.provider_selected', 'app.offer_received', 'app.electricity_received',
  // G-01/G-02: اختيار البنك بعد قبول موافقة الكهرباء، والبنك جهة خارجية.
  'app.electricity_accepted', 'app.bank_selected',
  // مسار التعاقد عن طريق شركة توزيع الكهرباء.
  'app.distribution_path_selected', 'app.distribution_received',
  // قبول حساب المصنع المسجَّل ذاتيًا (قرار IMC في المراجعة الأولى = قرار الحساب).
  'account.under_review', 'account.approved', 'account.correction_requested', 'account.rejected',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** بطاقة مقدم خدمة في البريد: الاسم والتفاصيل والموقع، والشعار يُرفق مضمنًا (cid:provider-logo-<id>). */
export interface ProviderCard { id: string; nameAr: string; description: string; website: string; hasLogo: boolean }

/** أقصى عدد بطاقات في البريد، والباقي في صفحة الاختيار داخل الحساب. */
export const MAX_PROVIDERS_IN_EMAIL = 30;
export const LOGO_CID_PREFIX = 'provider-logo-';

export interface TemplateVars {
  name?: string;
  link?: string;
  appId?: string;
  number?: string | null;
  companyName?: string;
  stateAr?: string;
  stateEn?: string;
  reason?: string;
  deficiencies?: Array<{ labelAr: string; labelEn: string; note: string }>;
  registryResult?: 'invalid' | 'unavailable';
  outcome?: 'CONTRACTED' | 'CLOSED_NOT_CONTRACTED' | 'WITHDRAWN';
  /** مسار التعاقد عند الإغلاق (عنوان النتيجة يذكر البنك أو شركة التوزيع). */
  contractPath?: 'bank' | 'distribution' | null;
  daysOverdue?: number;
  bankNameAr?: string;
  /** الجهة التي لا يوجد فيها مستلم نشط (ops.no_recipients). */
  orgNameAr?: string;
  otherNumber?: string | null;
  otherCompanyName?: string;
  registryNumber?: string;
  amount?: number;
  threshold?: number;
  count?: number;
  providerNameAr?: string;
  /** M6: أُعيد الطلب تلقائيًا إلى رفع العرض بعد إيقاف مقدم الخدمة. */
  returned?: boolean;
  /** لقطة دليل مقدمي الخدمة وقت المطابقة الفنية (تُعرض في بريد اختيار المقدم). */
  providers?: ProviderCard[];
  /** بعد قبول العرض: تنبيه لـPMU فقط، دون أي إجراء مطلوب أو تغيير في مسار الطلب. */
  alertOnly?: boolean;
  /** H2: سبب رابط تعيين كلمة المرور. */
  purpose?: 'created' | 'reset';
  /** نص الحدث (حسابات/مفاتيح/استرداد) كما يُعرض. */
  eventAr?: string;
  eventEn?: string;
  email?: string;
  roleAr?: string;
  keyName?: string;
  scopes?: string;
  hours?: number;
  /** ISO — تُعرض بتوقيت القاهرة. */
  until?: string;
  decision?: 'accepted' | 'rejected';
  reference?: string;
}

/** تاريخ ISO بتوقيت القاهرة للرسائل. */
function cairo(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(t)).replace(',', '');
}

/** رابط شاشة داخلية في الموقع (بلا توكن، ويتطلب تسجيل الدخول). */
export function siteLink(view: string): string {
  return `${config.appUrl}/#${view}`;
}

export interface Rendered { subject: string; html: string; text: string; sms: string }

/** رابط الطلب — بلا أي توكن، ويتطلب تسجيل الدخول. */
export function applicationLink(appId: string): string {
  return `${config.appUrl}/#application/${encodeURIComponent(appId)}`;
}

function ref(v: TemplateVars): string { return v.number ?? 'مسودة'; }

function build(o: {
  subject: string; heading: string; tone: EmailTone; panelTitle: string; panelText: string; body?: string;
  rows?: Array<[string, string]>; ctaLabel?: string; link?: string; english: string; sms: string;
}): Rendered {
  const bodyHtml = [
    statusPanel(o.tone, o.panelTitle, o.panelText),
    o.rows?.length ? detailsTable(o.rows) : '',
    o.body ?? '',
  ].join('');
  const html = renderEmail({
    preheader: o.panelText, heading: o.heading, bodyHtml,
    cta: o.link && o.ctaLabel ? { label: o.ctaLabel, href: o.link } : undefined,
    englishSummary: o.english,
  });
  // البديل النصي يحمل نفس المتن (السبب والنواقص) — الملخص الإنجليزي يحيل إليه.
  const text = [o.heading, o.panelText, ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`), o.body ? htmlToText(o.body) : '', o.link ? `الرابط: ${o.link}` : '', '', o.english].filter(Boolean).join('\n');
  return { subject: o.subject, html, text, sms: o.sms };
}

/** متن HTML المبني بمساعدات القالب → نص عادي (قوائم بشرطة، وأسطر، وفك الترميز). */
function htmlToText(html: string): string {
  return html.replace(/<li[^>]*>/g, '\n- ').replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n').trim();
}

function providersHtml(list: ProviderCard[]): string {
  if (!list.length) return paragraph('لا يوجد مقدمو خدمة متاحون حاليًا. ستُبلَّغ حين تتوفر القائمة.');
  const shown = list.slice(0, MAX_PROVIDERS_IN_EMAIL);
  const cards = shown.map((p) => {
    const desc = p.description.length > 300 ? `${p.description.slice(0, 297)}…` : p.description;
    const logo = p.hasLogo
      ? `<img src="cid:${LOGO_CID_PREFIX}${p.id}" width="56" height="56" alt="${escapeHtml(p.nameAr)}" style="display:block;width:56px;height:56px;object-fit:contain;border:1px solid #E2E8F0;border-radius:8px;background:#FFFFFF;">`
      : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;border:1px solid #E2E8F0;border-radius:10px;border-collapse:separate;"><tr>
      <td style="padding:12px 14px;text-align:right;vertical-align:top;">
        <div style="font-size:15px;font-weight:bold;color:#0B2545;">${escapeHtml(p.nameAr)}</div>
        ${desc ? `<div style="font-size:13px;color:#334155;margin-top:4px;line-height:1.8;">${escapeMultiline(desc)}</div>` : ''}
        ${p.website ? `<div style="font-size:12px;color:#64748B;margin-top:4px;" dir="ltr">${escapeHtml(p.website)}</div>` : ''}
      </td>
      ${logo ? `<td width="72" style="padding:12px 14px 12px 0;vertical-align:top;">${logo}</td>` : ''}
    </tr></table><br>`;
  }).join('');
  const more = list.length > shown.length ? paragraph(`و${list.length - shown.length} مقدم خدمة آخر — القائمة الكاملة في صفحة الاختيار داخل حسابك.`) : '';
  return sectionTitle('مقدمو الخدمة المتاحون') + cards + more;
}

function appRows(v: TemplateVars): Array<[string, string]> {
  const rows: Array<[string, string]> = [['رقم الطلب', ref(v)]];
  if (v.companyName) rows.push(['المنشأة', v.companyName]);
  if (v.stateAr) rows.push(['الحالة', v.stateAr]);
  return rows;
}

function deficienciesHtml(v: TemplateVars): string {
  if (!v.deficiencies?.length) return '';
  const items = v.deficiencies.map((d) => `<li style="margin-bottom:6px;"><b>${escapeHtml(d.labelAr)}</b>${d.note ? ` — ${escapeMultiline(d.note)}` : ''}</li>`).join('');
  return paragraph(`<b>المطلوب استيفاؤه:</b><ul style="margin:8px 0 0 0;padding-right:20px;">${items}</ul>`);
}

export function renderTemplate(key: TemplateKey, v: TemplateVars): Rendered {
  const link = v.link ?? (v.appId ? applicationLink(v.appId) : config.appUrl);
  switch (key) {
    case 'auth.verify_email':
      return build({
        subject: 'تفعيل حسابك — مبادرة شمس الصناعة', heading: 'تفعيل البريد الإلكتروني', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`, panelText: 'اضغط الزر لتفعيل حسابك على موقع مبادرة «شمس الصناعة». الرابط صالح لمدة 24 ساعة ولمرة واحدة.',
        ctaLabel: 'تفعيل الحساب', link, english: 'Activate your Shams El-Senaa account using the button above (valid for 24 hours, single use).',
        sms: 'شمس الصناعة: تم إرسال رابط تفعيل الحساب إلى بريدك الإلكتروني.',
      });
    case 'auth.reset_password':
      return build({
        subject: 'استعادة كلمة المرور — مبادرة شمس الصناعة', heading: 'استعادة كلمة المرور', tone: 'warning',
        panelTitle: 'طلب استعادة كلمة المرور', panelText: 'اضغط الزر لتعيين كلمة مرور جديدة. الرابط صالح لمدة ساعة ولمرة واحدة. إذا لم تطلب ذلك فتجاهل الرسالة.',
        ctaLabel: 'تعيين كلمة مرور جديدة', link, english: 'Use the button above to set a new password (valid for 1 hour, single use). Ignore this email if you did not request it.',
        sms: 'شمس الصناعة: تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني.',
      });
    case 'app.registry_failed': {
      const unavailable = v.registryResult === 'unavailable';
      const text = unavailable
        ? 'تعذر التحقق من رقم السجل الصناعي حاليًا بسبب عدم توفر خدمة السجل. طلبك محفوظ كمسودة، ويمكنك إعادة المحاولة لاحقًا دون إعادة إدخال البيانات.'
        : 'رقم السجل الصناعي المُدخل غير صحيح أو غير مسجل. طلبك محفوظ كمسودة — صحّح رقم السجل وأعد الإرسال دون إعادة إدخال باقي البيانات.';
      return build({
        subject: 'تعذر التحقق من السجل الصناعي — شمس الصناعة', heading: 'تعذر التحقق من السجل الصناعي', tone: 'warning',
        panelTitle: unavailable ? 'خدمة السجل غير متاحة' : 'رقم السجل غير صحيح', panelText: text, rows: appRows(v),
        ctaLabel: 'فتح الطلب', link,
        english: unavailable ? 'The industrial registry could not be reached. Your application is saved as a draft — please retry later.'
          : 'The industrial registry number is not valid. Your draft is saved — correct the number and submit again.',
        sms: unavailable ? 'شمس الصناعة: تعذر التحقق من السجل الصناعي حاليًا. طلبك محفوظ ويمكنك إعادة المحاولة.' : 'شمس الصناعة: رقم السجل الصناعي غير صحيح. صحّحه وأعد إرسال الطلب.',
      });
    }
    case 'app.review_assigned':
      return build({
        subject: `طلب ${ref(v)} بانتظار مراجعتكم — شمس الصناعة`, heading: 'طلب جديد بانتظار المراجعة', tone: 'info',
        panelTitle: v.stateAr ?? 'مراجعة', panelText: 'دخل الطلب مرحلة مراجعة جهتكم. يرجى المراجعة واتخاذ القرار.', rows: appRows(v),
        // ملاحظة المصنع المرفقة بالإرسال (تُمرَّر حاليًا لمسار شركة التوزيع وحده — notifyTransition).
        body: v.reason ? paragraph(`<b>ملاحظات المصنع مع الإرسال:</b> ${escapeMultiline(v.reason)}`) : '',
        ctaLabel: 'فتح الطلب', link, english: `Application ${v.number ?? ''} is awaiting your review (${v.stateEn ?? ''}).`,
        sms: `شمس الصناعة: الطلب ${ref(v)} بانتظار مراجعتكم.`,
      });
    case 'app.resubmitted':
      return build({
        subject: `إعادة تقديم الطلب ${ref(v)} — شمس الصناعة`, heading: 'أعاد المصنع تقديم الطلب', tone: 'info',
        panelTitle: v.stateAr ?? 'مراجعة', panelText: 'استكمل المصنع المطلوب وأعاد التقديم، والطلب عاد لمراجعة جهتكم.', rows: appRows(v),
        ctaLabel: 'فتح الطلب', link, english: `Application ${v.number ?? ''} was resubmitted and is back for your review.`,
        sms: `شمس الصناعة: أُعيد تقديم الطلب ${ref(v)} وهو بانتظار مراجعتكم.`,
      });
    case 'app.correction_requested':
      return build({
        subject: `مطلوب استيفاء على الطلب ${ref(v)} — شمس الصناعة`, heading: 'مطلوب منك تصحيح/استيفاء', tone: 'warning',
        panelTitle: v.stateAr ?? 'استيفاء', panelText: 'طلبت الجهة المراجعة استيفاء بعض البيانات أو المستندات. عدّل البنود المطلوبة فقط ثم أعد التقديم.',
        rows: appRows(v), body: `${deficienciesHtml(v)}${v.reason ? paragraph(`<b>ملاحظات:</b> ${escapeMultiline(v.reason)}`) : ''}`,
        ctaLabel: 'استكمال الطلب', link, english: `Corrections were requested on application ${v.number ?? ''}. Update the listed items and resubmit.`,
        sms: `شمس الصناعة: مطلوب استيفاء على الطلب ${ref(v)}. ادخل على الموقع لمعرفة النواقص.`,
      });
    case 'app.rejected':
      return build({
        subject: `قرار بشأن الطلب ${ref(v)} — شمس الصناعة`, heading: 'تم رفض الطلب', tone: 'danger',
        panelTitle: 'طلب مرفوض — حالة نهائية', panelText: 'نأسف لإبلاغكم بأن الطلب رُفض في مرحلة المراجعة.', rows: appRows(v),
        body: v.reason ? paragraph(`<b>سبب الرفض:</b> ${escapeMultiline(v.reason)}`) : '',
        // لا نص عربي حر داخل سطر الملخص الإنجليزي (LTR) — السبب ظاهر في المتن العربي (M7).
        ctaLabel: 'عرض الطلب', link, english: `Application ${v.number ?? ''} was rejected. The reason is shown above.`,
        sms: `شمس الصناعة: رُفض الطلب ${ref(v)}. السبب متاح على الموقع.`,
      });
    case 'app.encpc_compliant': {
      // الرابط يفتح صفحة الاختيار داخل الحساب (يتطلب تسجيل الدخول)؛ لا يختار أحد من الرسالة نفسها ولا يحمل الرابط توكنًا.
      const selectLink = v.appId ? siteLink(`task/${encodeURIComponent(v.appId)}`) : link;
      return build({
        subject: `قبول فني للطلب ${ref(v)} — اختر مقدم الخدمة`, heading: 'تم قبول الطلب فنيًا', tone: 'success',
        panelTitle: 'مطابق فنيًا',
        panelText: 'اجتاز طلبك المراجعة الفنية. الخطوة التالية: اختيار مقدم خدمة واحد من القائمة أدناه. يتم الاختيار من داخل حسابك بعد تسجيل الدخول، وتجد القائمة نفسها في لوحتك.',
        rows: appRows(v), body: v.providers ? providersHtml(v.providers) : '',
        ctaLabel: 'اختيار مقدم الخدمة', link: selectLink,
        english: `Application ${v.number ?? ''} is technically compliant. Next: sign in and choose one service provider (${v.providers?.length ?? 0} available) from your dashboard or the link above.`,
        sms: `شمس الصناعة: قُبل الطلب ${ref(v)} فنيًا. ادخل على حسابك لاختيار مقدم الخدمة.`,
      });
    }
    case 'app.offer_accepted':
      return build({
        subject: `قبول العرض الفني للطلب ${ref(v)} — شمس الصناعة`, heading: 'تم قبول العرض الفني', tone: 'success',
        panelTitle: 'فتح خطوة موافقة الكهرباء', panelText: 'قبلت وحدة إدارة المبادرة العرض الفني. ارفع الآن موافقة شركة الكهرباء؛ بعد قبولها تختار مسار التعاقد.', rows: appRows(v),
        ctaLabel: 'رفع موافقة الكهرباء', link, english: `The technical offer for ${v.number ?? ''} was accepted. Please upload the electricity company approval; once it is accepted you will choose the contracting path.`,
        sms: `شمس الصناعة: قُبل العرض الفني للطلب ${ref(v)}. ارفع موافقة شركة الكهرباء.`,
      });
    case 'app.closed': {
      const viaDistribution = v.contractPath === 'distribution';
      const map = {
        CONTRACTED: viaDistribution
          ? { t: 'تم التعاقد عن طريق شركة توزيع الكهرباء', tone: 'success' as EmailTone, en: 'contracted through the electricity distribution company', panel: 'قبلت وحدة إدارة المبادرة موافقة شركة توزيع الكهرباء، واكتملت رحلة الطلب بنجاح. لا إجراء آخر مطلوب منك.' }
          : { t: v.bankNameAr ? `اكتمل — تم التعاقد عن طريق البنك (${v.bankNameAr})` : 'اكتمل — تم التعاقد', tone: 'success' as EmailTone, en: 'completed — contracted through the bank', panel: 'سُجّلت نتيجة التعاقد واكتملت رحلة الطلب بنجاح. لا إجراء آخر مطلوب.' },
        CLOSED_NOT_CONTRACTED: viaDistribution
          ? { t: 'رُفضت موافقة شركة التوزيع — أُغلق الطلب', tone: 'danger' as EmailTone, en: 'closed — the distribution company approval was rejected', panel: 'رفضت وحدة إدارة المبادرة موافقة شركة توزيع الكهرباء. هذا قرار نهائي: أُغلق الطلب ولا يمكن استكماله، ويمكنك تقديم طلب جديد.' }
          : { t: 'أُغلق — لم يتم التعاقد', tone: 'danger' as EmailTone, en: 'closed — not contracted', panel: 'سُجّلت نتيجة التعاقد بعدم إتمامه، وأُغلق الطلب نهائيًا.' },
        WITHDRAWN: { t: 'انسحب المصنع من الطلب', tone: 'neutral' as EmailTone, en: 'withdrawn by the factory', panel: 'انسحب المصنع من هذا الطلب وأُغلق.' },
      }[v.outcome ?? 'CONTRACTED'];
      const reasonLabel = viaDistribution ? (v.outcome === 'CLOSED_NOT_CONTRACTED' ? 'سبب الرفض' : 'ملاحظات المراجعة') : 'السبب';
      return build({
        subject: `${map.t}: الطلب ${ref(v)} — شمس الصناعة`, heading: map.t, tone: map.tone,
        panelTitle: 'انتهت دورة الطلب', panelText: `الحالة النهائية للطلب: ${map.t}. ${map.panel}`, rows: appRows(v),
        body: v.reason ? paragraph(`<b>${reasonLabel}:</b> ${escapeMultiline(v.reason)}`) : '',
        ctaLabel: 'عرض الطلب', link, english: `Application ${v.number ?? ''} is ${map.en}.`,
        sms: `شمس الصناعة: الطلب ${ref(v)} — ${map.t}.`,
      });
    }
    case 'app.submitted':
      return build({
        subject: `تم استلام طلبك ${ref(v)} — شمس الصناعة`, heading: 'تم استلام طلبك', tone: 'success',
        panelTitle: `رقم الطلب: ${ref(v)}`, panelText: 'تم التحقق من رقم السجل الصناعي وأُحيل طلبك للمراجعة. احتفظ برقم الطلب للمتابعة، وستصلك رسالة عند كل قرار.',
        rows: appRows(v), ctaLabel: 'متابعة الطلب', link,
        english: `Your application ${v.number ?? ''} was received and sent for review. Keep this number for follow-up.`,
        sms: `شمس الصناعة: تم استلام طلبك برقم ${ref(v)} وأُحيل للمراجعة.`,
      });
    // ── قبول حساب المصنع: المصنع المسجَّل ذاتيًا لا يدخل المنصة قبل قرار IMC على طلب تسجيله ──
    case 'account.under_review':
      return build({
        subject: `تم استلام طلب تسجيل مصنعكم ${ref(v)} — شمس الصناعة`, heading: 'طلب التسجيل قيد المراجعة', tone: 'info',
        panelTitle: `رقم الطلب: ${ref(v)}`,
        panelText: 'تم التحقق من رقم السجل الصناعي، وأُحيل طلب التسجيل ومستنداته لمراجعة مركز تحديث الصناعة (IMC). لا يمكن الدخول إلى المنصة أثناء المراجعة.',
        rows: appRows(v),
        body: paragraph('<b>ماذا بعد؟</b><ul style="margin:8px 0 0 0;padding-right:20px;"><li style="margin-bottom:6px;">تراجع IMC البيانات والمستندات المرفوعة.</li><li style="margin-bottom:6px;">ستصلكم رسالة بالقرار: قبول الحساب، أو طلب تعديل بيانات، أو الرفض.</li><li>عند القبول يمكنكم تسجيل الدخول ومتابعة باقي مراحل المبادرة.</li></ul>'),
        english: `Your factory registration ${v.number ?? ''} was received and is under IMC review. You will be notified of the decision; sign-in is available after approval.`,
        sms: `شمس الصناعة: طلب تسجيل مصنعكم ${ref(v)} قيد المراجعة. ستصلكم رسالة بالقرار.`,
      });
    case 'account.approved':
      return build({
        subject: 'تم قبول حساب مصنعكم — شمس الصناعة', heading: 'مرحبًا بكم في مبادرة شمس الصناعة', tone: 'success',
        panelTitle: 'تم قبول حساب المصنع',
        panelText: 'راجع مركز تحديث الصناعة (IMC) بيانات التسجيل ومستنداته وقبِل حسابكم. يمكنكم الآن تسجيل الدخول إلى المنصة بالبريد وكلمة المرور اللذين سجّلتم بهما.',
        rows: appRows(v),
        body: paragraph('<b>الخطوة التالية:</b> أُحيل طلبكم للمراجعة الفنية (ENCPC). تابعوا حالته من «لوحتي»، وستصلكم رسالة عند كل قرار.'),
        ctaLabel: 'تسجيل الدخول', link: siteLink('login'),
        english: 'Your factory account was approved. You can now sign in to the platform; your application moved to technical review.',
        sms: 'شمس الصناعة: تم قبول حساب مصنعكم. يمكنكم تسجيل الدخول الآن.',
      });
    case 'account.correction_requested':
      return build({
        subject: `مطلوب تعديل بيانات تسجيل مصنعكم ${ref(v)} — شمس الصناعة`, heading: 'مطلوب تعديل بيانات التسجيل', tone: 'warning',
        panelTitle: 'لم يُقبل الحساب بعد — مطلوب استيفاء',
        panelText: 'راجع مركز تحديث الصناعة (IMC) طلب التسجيل ويحتاج تعديل البنود التالية قبل قبول الحساب. سجّلوا الدخول لتعديلها ثم أعيدوا الإرسال — لن تتاح باقي المنصة قبل القبول.',
        rows: appRows(v), body: `${deficienciesHtml(v)}${v.reason ? paragraph(`<b>ملاحظات المراجع:</b> ${escapeMultiline(v.reason)}`) : ''}`,
        ctaLabel: 'تسجيل الدخول لتعديل البيانات', link: siteLink('login'),
        english: `Changes were requested on your factory registration ${v.number ?? ''}. Sign in, update the listed items and resubmit; the account is approved after review.`,
        sms: `شمس الصناعة: مطلوب تعديل بيانات تسجيل مصنعكم ${ref(v)}. سجّلوا الدخول لمعرفة البنود.`,
      });
    case 'account.rejected':
      return build({
        subject: `قرار بشأن طلب تسجيل مصنعكم ${ref(v)} — شمس الصناعة`, heading: 'لم يُقبل طلب التسجيل', tone: 'danger',
        panelTitle: 'تم رفض طلب تسجيل المصنع',
        panelText: 'نأسف لإبلاغكم بأن مركز تحديث الصناعة (IMC) رفض طلب تسجيل المصنع بعد مراجعة البيانات والمستندات، ولذلك لن يُفعَّل الحساب.',
        rows: appRows(v),
        body: `${v.reason ? paragraph(`<b>سبب الرفض:</b> ${escapeMultiline(v.reason)}`) : ''}${paragraph('للاستفسار أو التظلم تواصلوا مع الدعم الفني عبر بيانات التواصل أسفل الرسالة.')}`,
        english: `Your factory registration ${v.number ?? ''} was not approved, so the account will not be activated. The reason is shown above.`,
        sms: `شمس الصناعة: لم يُقبل طلب تسجيل مصنعكم ${ref(v)}. السبب في البريد الإلكتروني.`,
      });
    case 'app.imc_accepted':
      return build({
        subject: `قبول الطلب ${ref(v)} وإحالته للمراجعة الفنية — شمس الصناعة`, heading: 'قُبل طلبك في المراجعة الأولى', tone: 'success',
        panelTitle: 'أُحيل الطلب للمراجعة الفنية', panelText: 'قُبل الطلب ومستنداته في المراجعة الأولى، وأُحيل للمراجعة الفنية. لا يُطلب منك شيء الآن.',
        rows: appRows(v), ctaLabel: 'متابعة الطلب', link,
        english: `Application ${v.number ?? ''} passed the first review and moved to technical review. No action is needed now.`,
        sms: `شمس الصناعة: قُبل الطلب ${ref(v)} وأُحيل للمراجعة الفنية.`,
      });
    case 'app.provider_suspended':
      return build({
        subject: `مقدم الخدمة على الطلب ${ref(v)} لم يعد معتمدًا — شمس الصناعة`, heading: 'تغيّر اعتماد مقدم الخدمة', tone: 'warning',
        panelTitle: v.providerNameAr ?? 'مقدم الخدمة',
        panelText: v.alertOnly
          ? 'للعلم فقط: أُوقف اعتماد مقدم الخدمة بعد قبول العرض الفني لهذا الطلب. لا يتغير مسار الطلب ولا يُطلب إجراء من المصنع؛ تظهر حالة المقدم على الطلب.'
          : v.returned
          // M6 (القرار 6): الإيقاف أثناء مراجعة العرض أو تصحيحه يعيد الطلب لرفع العرض.
          ? 'أُوقف اعتماد مقدم الخدمة المختار لهذا الطلب أثناء مراجعة العرض الفني، فأُعيد الطلب تلقائيًا إلى مرحلة رفع العرض. اختر مقدم خدمة معتمدًا آخر وارفع عرضًا فنيًا جديدًا منه.'
          : 'أُوقف اعتماد مقدم الخدمة المختار لهذا الطلب. إذا لم يُرسل العرض الفني بعد، اختر مقدم خدمة معتمدًا آخر من صفحة المهمة.',
        rows: appRows(v), ctaLabel: 'فتح الطلب', link,
        english: v.alertOnly
          ? `FYI: the service provider on application ${v.number ?? ''} was suspended after its offer was accepted. The application is unchanged.`
          : v.returned
          ? `The service provider on application ${v.number ?? ''} was suspended during offer review; the application returned to offer upload.`
          : `The service provider on application ${v.number ?? ''} is no longer approved.`,
        sms: v.returned
          ? `شمس الصناعة: أُوقف مقدم الخدمة على الطلب ${ref(v)} وأُعيد الطلب لرفع عرض جديد.`
          : `شمس الصناعة: مقدم الخدمة على الطلب ${ref(v)} لم يعد معتمدًا. ادخل على الموقع.`,
      });
    // ── المراجعة الأمنية: الحسابات (H2) ──
    case 'auth.account_setup': {
      const reset = v.purpose === 'reset';
      return build({
        subject: reset ? 'إعادة تعيين كلمة المرور لحسابك — مبادرة شمس الصناعة' : 'تعيين كلمة المرور لحسابك الجديد — مبادرة شمس الصناعة',
        heading: reset ? 'إعادة تعيين كلمة المرور' : 'تم إنشاء حسابك', tone: reset ? 'warning' : 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: reset
          ? `طلبت إدارة النظام إعادة تعيين كلمة مرور حسابك، وأُنهيت كل الجلسات المفتوحة. اضغط الزر لتعيين كلمة مرور جديدة. الرابط صالح ${v.hours ?? 72} ساعة ولمرة واحدة. إذا لم تتوقع ذلك فتواصل مع جهتك.`
          : `أُنشئ لك حساب على موقع مبادرة «شمس الصناعة» بعد موافقة جهتك. اضغط الزر لتعيين كلمة المرور. الرابط صالح ${v.hours ?? 72} ساعة ولمرة واحدة.`,
        ctaLabel: 'تعيين كلمة المرور', link,
        english: reset ? 'Your password was reset by the administration. Set a new one with the button above (single use).'
          : 'An account was created for you after your organization approved it. Set your password with the button above (single use).',
        sms: 'شمس الصناعة: أُرسل رابط تعيين كلمة المرور إلى بريدك الإلكتروني.',
      });
    }
    case 'ops.account_request':
      return build({
        subject: `طلب حساب بانتظار موافقتكم — ${v.orgNameAr ?? ''}`, heading: 'طلب حساب بانتظار الموافقة', tone: 'warning',
        panelTitle: v.eventAr ?? 'طلب حساب',
        panelText: 'طلبت إدارة النظام (أو منصة الربط) إجراءً على حساب في جهتكم. لا يُنفَّذ شيء قبل موافقة مستخدم نشط من جهتكم. راجع الطلب وتأكد من صاحب البريد قبل الموافقة.',
        rows: [['البريد', v.email ?? ''], ['الاسم', v.name ?? ''], ['الدور', v.roleAr ?? ''], ['الجهة', v.orgNameAr ?? '']],
        ctaLabel: 'مراجعة الطلب', link: siteLink('approvals'),
        english: 'An account request for your organization awaits approval by one of your active users.',
        sms: 'شمس الصناعة: طلب حساب لجهتكم بانتظار موافقتكم على الموقع.',
      });
    case 'ops.account_event':
      return build({
        subject: `${v.eventAr ?? 'تغيير على حساب'} — ${v.email ?? ''}`, heading: 'تغيير على حساب جهة', tone: 'info',
        panelTitle: v.eventAr ?? 'تغيير على حساب',
        panelText: 'إبلاغ آلي بتغيير على حساب في إحدى جهات القرار. إذا لم يكن متوقعًا فتواصلوا مع إدارة النظام ووحدة إدارة المبادرة فورًا.',
        rows: [['الحساب', v.email ?? ''], ['الاسم', v.name ?? ''], ['الجهة', v.orgNameAr ?? '']],
        english: `Account notice: ${v.eventEn ?? 'an account changed'} (${v.email ?? ''}).`,
        sms: `شمس الصناعة: ${v.eventAr ?? 'تغيير على حساب'} — ${v.email ?? ''}.`,
      });
    case 'auth.suspicious_logins':
      return build({
        subject: 'محاولات دخول فاشلة متكررة على حسابك — مبادرة شمس الصناعة', heading: 'محاولات دخول فاشلة', tone: 'warning',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: `سُجلت ${v.count ?? 0} محاولة دخول فاشلة متتالية على حسابك. لم يُقفل الحساب، لكن المحاولات من نفس العنوان تتأخر تدريجيًا. إذا لم تكن أنت فاختر كلمة مرور قوية من «نسيت كلمة المرور».`,
        english: 'Repeated failed sign-in attempts were recorded on your account. It is not locked; consider changing your password if this was not you.',
        sms: 'شمس الصناعة: محاولات دخول فاشلة متكررة على حسابك.',
      });
    case 'auth.registration_attempt':
      return build({
        subject: 'محاولة تسجيل ببريدك — مبادرة شمس الصناعة', heading: 'بريدك مسجل بالفعل', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'حاول أحد إنشاء حساب جديد ببريدك الإلكتروني، وهو مسجل بالفعل فلم يُنشأ حساب جديد. إذا كنت أنت فسجّل الدخول، أو استخدم «نسيت كلمة المرور».',
        ctaLabel: 'تسجيل الدخول', link: siteLink('login'),
        english: 'Someone tried to register with your email, which already has an account. No new account was created.',
        sms: 'شمس الصناعة: محاولة تسجيل جديدة ببريدك المسجل.',
      });
    // ── مفاتيح الربط (H1) ──
    case 'ops.integration_key':
      return build({
        subject: `مفتاح ربط: ${v.eventAr ?? ''} — ${v.keyName ?? ''}`, heading: 'تغيير على مفاتيح الربط', tone: 'warning',
        panelTitle: v.eventAr ?? 'مفتاح ربط',
        panelText: 'إبلاغ آلي بتغيير على مفتاح API ربط المنصة الأصلية. النطاقات المذكورة هي ما يستطيع حامل المفتاح فعله.',
        rows: [['اسم المفتاح', v.keyName ?? ''], ['النطاقات', v.scopes ?? '']],
        ctaLabel: 'مراجعة المفاتيح', link: siteLink('approvals'),
        english: `Integration key notice: ${v.eventEn ?? ''} (${v.keyName ?? ''}).`,
        sms: `شمس الصناعة: ${v.eventAr ?? 'تغيير'} على مفتاح ربط (${v.keyName ?? ''}).`,
      });
    // ── رقم السجل الصناعي (H3) ──
    case 'registry.blocked':
      return build({
        subject: `حظر استخدام رقم السجل ${v.registryNumber ?? ''} — شمس الصناعة`, heading: 'رقم السجل محظور مؤقتًا', tone: 'danger',
        panelTitle: `رقم السجل: ${v.registryNumber ?? ''}`,
        panelText: 'رُفض الطلب لعدم تطابق ملكية رقم السجل الصناعي، وأصبح الرقم محظورًا على كل الحسابات حتى قرار وحدة إدارة المبادرة. إذا كان الرقم لمنشأتك فاعترض من لوحة المصنع برفع صورة السجل وما يثبت تفويضك.',
        rows: appRows(v), ctaLabel: 'تقديم اعتراض', link: siteLink('factory-dashboard'),
        english: `Registry number ${v.registryNumber ?? ''} is blocked for all accounts pending a PMU decision. The owner can object with documents.`,
        sms: `شمس الصناعة: رقم السجل ${v.registryNumber ?? ''} محظور حتى قرار وحدة إدارة المبادرة. يمكنك الاعتراض من الموقع.`,
      });
    case 'registry.released':
      return build({
        subject: `قرار بشأن رقم السجل ${v.registryNumber ?? ''} — شمس الصناعة`, heading: 'قرار وحدة إدارة المبادرة على رقم السجل', tone: 'success',
        panelTitle: `رقم السجل: ${v.registryNumber ?? ''}`,
        panelText: `قررت وحدة إدارة المبادرة السماح باستخدام رقم السجل للمنشأة: ${v.companyName ?? ''} فقط. أي حساب آخر يبقى ممنوعًا من هذا الرقم.`,
        rows: [['رقم السجل', v.registryNumber ?? ''], ['المرجع', v.reference ?? '']],
        ctaLabel: 'لوحة المصنع', link: siteLink('factory-dashboard'),
        english: `PMU decided that registry number ${v.registryNumber ?? ''} may be used by one facility only.`,
        sms: `شمس الصناعة: صدر قرار بشأن رقم السجل ${v.registryNumber ?? ''}. التفاصيل على الموقع.`,
      });
    case 'ops.registry_objection':
      return build({
        subject: `اعتراض على رقم السجل ${v.registryNumber ?? ''} — بانتظار المراجعة`, heading: 'اعتراض مالك رقم سجل', tone: 'warning',
        panelTitle: `رقم السجل: ${v.registryNumber ?? ''}`,
        panelText: 'رفع مصنع اعتراضًا بمستند على حظر أو حجز رقم السجل الصناعي. راجعوا المستند واتخذوا القرار.',
        rows: [['رقم السجل', v.registryNumber ?? ''], ['المنشأة المعترضة', v.companyName ?? '']],
        ctaLabel: 'مراجعة الاعتراض', link: siteLink('approvals'),
        english: `A factory objected (with a document) regarding registry number ${v.registryNumber ?? ''}.`,
        sms: `شمس الصناعة: اعتراض جديد على رقم السجل ${v.registryNumber ?? ''}.`,
      });
    case 'registry.objection_decided': {
      const ok = v.decision === 'accepted';
      return build({
        subject: `قرار اعتراضك على رقم السجل ${v.registryNumber ?? ''} — شمس الصناعة`, heading: ok ? 'قُبل اعتراضك' : 'لم يُقبل اعتراضك', tone: ok ? 'success' : 'warning',
        panelTitle: `رقم السجل: ${v.registryNumber ?? ''}`,
        panelText: ok ? 'قبلت وحدة إدارة المبادرة اعتراضك، وأصبح الرقم مسموحًا لمنشأتك فقط. إذا كان الرقم ما زال محجوزًا بطلب مفتوح فستُغلقه الوحدة أولًا.'
          : 'راجعت وحدة إدارة المبادرة اعتراضك ولم تقبله.',
        rows: [['رقم السجل', v.registryNumber ?? '']], body: v.reason ? paragraph(`<b>السبب:</b> ${escapeMultiline(v.reason)}`) : '',
        ctaLabel: 'لوحة المصنع', link: siteLink('factory-dashboard'),
        english: ok ? 'Your objection was accepted. The reason is shown above.' : 'Your objection was not accepted. The reason is shown above.',
        sms: `شمس الصناعة: صدر قرار اعتراضك على رقم السجل ${v.registryNumber ?? ''}.`,
      });
    }
    case 'ops.registry_held_by_inactive':
      return build({
        subject: `رقم سجل محجوز بطلب جهة موقوفة — الطلب ${ref(v)}`, heading: 'رقم سجل محجوز', tone: 'warning',
        panelTitle: `رقم السجل: ${v.registryNumber ?? ''}`,
        panelText: 'أُوقفت جهة المصنع صاحب هذا الطلب، والطلب ما زال يحجز رقم السجل الصناعي. الإيقاف لا يحرر الرقم تلقائيًا — إن كان الرقم متنازعًا عليه فأغلقوا النزاع من الطلب.',
        rows: appRows(v), ctaLabel: 'فتح الطلب', link,
        english: `Application ${v.number ?? ''} of a deactivated factory still holds registry number ${v.registryNumber ?? ''}.`,
        sms: `شمس الصناعة: رقم السجل ${v.registryNumber ?? ''} محجوز بطلب جهة موقوفة.`,
      });
    // ── استرداد بريد المصنع (H4) ──
    case 'auth.recovery_requested':
      return build({
        subject: 'طلب نقل حسابك إلى بريد آخر — مبادرة شمس الصناعة', heading: 'طلب استرداد الحساب', tone: 'danger',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'سجّلت إدارة النظام طلبًا رسميًا لنقل حسابك إلى بريد إلكتروني آخر. لن يتغير شيء قبل موافقة وحدة إدارة المبادرة ثم انتهاء مهلة الانتظار. إذا لم تطلب ذلك فألغِ الطلب فورًا من الزر (لمرة واحدة).',
        ctaLabel: 'إلغاء الطلب', link,
        english: 'A formal request to move your account to another email was recorded. Nothing changes before PMU approval and a waiting period. Cancel it with the button if you did not request it.',
        sms: `شمس الصناعة: طلب نقل حسابك لبريد آخر. إن لم تطلبه فألغِه: ${link}`,
      });
    case 'ops.recovery_pending':
      return build({
        subject: 'طلب استرداد حساب مصنع بانتظار موافقتكم — شمس الصناعة', heading: 'استرداد حساب مصنع', tone: 'warning',
        panelTitle: v.companyName ?? 'حساب مصنع',
        panelText: 'سجّلت إدارة النظام طلبًا لنقل حساب مصنع إلى بريد جديد مع مستند رسمي. راجعوا المستند وتأكدوا من الطلب قبل الموافقة. بعد الموافقة تبدأ مهلة انتظار يُبلَّغ فيها صاحب الحساب.',
        rows: [['المنشأة', v.companyName ?? ''], ['المرجع', v.reference ?? '']],
        ctaLabel: 'مراجعة الطلب', link: siteLink('approvals'),
        english: 'A factory account recovery request (email change) awaits PMU review.',
        sms: 'شمس الصناعة: طلب استرداد حساب مصنع بانتظار موافقتكم.',
      });
    case 'auth.recovery_approved':
      return build({
        subject: 'موعد نقل حسابك إلى بريد آخر — مبادرة شمس الصناعة', heading: 'اعتُمد طلب الاسترداد — مهلة انتظار', tone: 'danger',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: `وافقت وحدة إدارة المبادرة على نقل حسابك إلى بريد آخر. سيُنفذ النقل بعد ${cairo(v.until)} بتوقيت القاهرة. إذا لم تطلب ذلك فألغِ الطلب قبل هذا الموعد من الزر (لمرة واحدة).`,
        ctaLabel: 'إلغاء الطلب', link,
        english: 'PMU approved moving your account to another email. It will run after the waiting period unless you cancel it with the button.',
        sms: `شمس الصناعة: سيُنقل حسابك لبريد آخر بعد ${cairo(v.until)}. للإلغاء: ${link}`,
      });
    case 'auth.recovery_closed':
      return build({
        subject: 'طلب استرداد الحساب لم يُنفذ — مبادرة شمس الصناعة', heading: 'أُغلق طلب الاسترداد', tone: 'info',
        panelTitle: v.eventAr ?? 'أُغلق الطلب',
        panelText: 'أُغلق طلب نقل الحساب إلى بريد آخر دون تنفيذ، ولم يتغير بريد الحساب.',
        body: v.reason ? paragraph(`<b>السبب:</b> ${escapeMultiline(v.reason)}`) : '',
        english: `The account recovery request was closed without changes (${v.eventEn ?? ''}).`,
        sms: 'شمس الصناعة: أُغلق طلب نقل حسابك دون تغيير.',
      });
    case 'auth.email_changed_old':
      return build({
        subject: 'تغيير البريد الإلكتروني لحسابك — مبادرة شمس الصناعة', heading: 'تم تغيير بريد الحساب', tone: 'warning',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'غيّرت إدارة النظام البريد الإلكتروني لحسابك بناءً على طلب رسمي، وأُنهيت كل الجلسات المفتوحة. لن تصل رسائل الحساب إلى هذا البريد بعد الآن. إذا لم تطلب ذلك فتواصل مع قناة الاستفسار فورًا.',
        english: 'The email address of your account was changed by the system administration on a formal request. If you did not request this, contact support immediately.',
        sms: 'شمس الصناعة: تم تغيير البريد الإلكتروني لحسابك.',
      });
    case 'auth.email_changed_new':
      return build({
        subject: 'تفعيل البريد الجديد لحسابك — مبادرة شمس الصناعة', heading: 'تفعيل البريد الإلكتروني الجديد', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'نُقل حسابك على موقع مبادرة «شمس الصناعة» إلى هذا البريد بناءً على طلب رسمي. اضغط الزر لتفعيله، ثم استخدم «نسيت كلمة المرور» لتعيين كلمة مرور جديدة. الرابط صالح لمدة 24 ساعة ولمرة واحدة.',
        ctaLabel: 'تفعيل البريد', link, english: 'Your account was moved to this email address. Activate it with the button above (24 hours, single use), then reset your password.',
        sms: 'شمس الصناعة: أُرسل رابط تفعيل البريد الجديد لحسابك.',
      });
    case 'ops.no_recipients':
      return build({
        subject: `تنبيه تشغيلي: الطلب ${ref(v)} أُحيل لجهة بلا مستخدمين نشطين`, heading: 'طلب بلا مستلم', tone: 'danger',
        panelTitle: v.orgNameAr ?? 'جهة بلا مستخدمين',
        panelText: 'دخل الطلب مرحلة تخص جهة لا يوجد فيها مستخدم نشط، فلم تصل الإحالة لأحد. أضف مستخدمًا للجهة أو فعّله، أو أعد الإحالة إن كان ذلك متاحًا.',
        rows: appRows(v), ctaLabel: 'فتح الطلب', link,
        english: `Operational alert: application ${v.number ?? ''} entered a stage whose organization has no active users.`,
        sms: `شمس الصناعة: تنبيه — الطلب ${ref(v)} أُحيل لجهة بلا مستخدمين نشطين.`,
      });
    case 'app.provider_selected':
      return build({
        subject: `تم تسجيل اختيارك لمقدم الخدمة — الطلب ${ref(v)}`, heading: 'تم تسجيل اختيار مقدم الخدمة', tone: 'success',
        panelTitle: v.providerNameAr ?? 'مقدم الخدمة',
        panelText: 'سُجّل اختيارك لمقدم الخدمة المذكور لهذا الطلب. الخطوة التالية: تواصل مع مقدم الخدمة مباشرةً خارج المنصة للحصول على العرض الفني (المنصة لا تدير التفاوض معه)، ثم ارفع العرض الذي أعده لك.',
        rows: appRows(v), ctaLabel: 'رفع العرض الفني', link: v.appId ? siteLink(`task/${encodeURIComponent(v.appId)}`) : link,
        english: `Your service provider choice for application ${v.number ?? ''} was recorded. Next: contact the provider directly, outside the platform, to obtain the technical offer, then upload it.`,
        sms: `شمس الصناعة: سُجّل اختيار مقدم الخدمة للطلب ${ref(v)}. ارفع العرض الفني من الموقع.`,
      });
    case 'app.offer_received':
      return build({
        subject: `استلمنا العرض الفني للطلب ${ref(v)} — شمس الصناعة`, heading: 'تم استلام العرض الفني', tone: 'info',
        panelTitle: 'العرض الفني قيد المراجعة',
        panelText: 'أُرسل العرض الفني إلى وحدة إدارة المبادرة للمراجعة. ستصلك رسالة بالقرار: قبول العرض أو طلب تعديله.',
        rows: appRows(v), ctaLabel: 'متابعة الطلب', link,
        english: `The technical offer for application ${v.number ?? ''} was received and is under PMU review.`,
        sms: `شمس الصناعة: استُلم العرض الفني للطلب ${ref(v)} وهو قيد المراجعة.`,
      });
    case 'app.electricity_received':
      // إيصال للمصنع باستلام موافقة الكهرباء. البنك يُختار بعد قبولها (G-01).
      return build({
        subject: `استلمنا موافقة الكهرباء للطلب ${ref(v)} — شمس الصناعة`, heading: 'تم استلام موافقة الكهرباء', tone: 'info',
        panelTitle: 'موافقة الكهرباء قيد المراجعة',
        panelText: 'أُرسلت موافقة الكهرباء إلى وحدة إدارة المبادرة للمراجعة. ستصلك رسالة بالقرار: قبول الموافقة (ثم تختار مسار التعاقد) أو طلب استكمالها.',
        rows: appRows(v), ctaLabel: 'متابعة الطلب', link,
        english: `The electricity approval for application ${v.number ?? ''} was received and is under PMU review. After it is accepted you will choose the contracting path.`,
        sms: `شمس الصناعة: استُلمت موافقة الكهرباء للطلب ${ref(v)} وهي قيد المراجعة.`,
      });
    case 'app.electricity_accepted':
      return build({
        subject: `قبول موافقة الكهرباء للطلب ${ref(v)} — اختر مسار التعاقد`, heading: 'قُبلت موافقة الكهرباء', tone: 'success',
        panelTitle: 'الخطوة التالية: اختيار مسار التعاقد',
        panelText: 'قبلت وحدة إدارة المبادرة موافقة الكهرباء. اختر الآن من حسابك مسار إتمام التعاقد (اختيار نهائي لا يمكن تغييره).',
        rows: appRows(v),
        body: paragraph('<b>1) التعاقد من خلال بنك:</b> تختار البنك من القائمة، وتتواصل معه مباشرةً خارج المنصة، ثم تسجّل نتيجة التعاقد مع مستند الإثبات.')
          + paragraph('<b>2) التعاقد من خلال شركة توزيع الكهرباء:</b> ترفع موافقة شركة التوزيع على التعاقد، وتراجعها وحدة إدارة المبادرة وتتخذ القرار النهائي.'),
        ctaLabel: 'اختيار مسار التعاقد', link: v.appId ? siteLink(`task/${encodeURIComponent(v.appId)}`) : link,
        english: `The electricity approval for application ${v.number ?? ''} was accepted. Next: choose how to complete the contract in your account — through a bank, or through the electricity distribution company.`,
        sms: `شمس الصناعة: قُبلت موافقة الكهرباء للطلب ${ref(v)}. ادخل على حسابك لاختيار مسار التعاقد.`,
      });
    case 'app.bank_selected':
      return build({
        subject: `تم تسجيل البنك المختار — الطلب ${ref(v)}`, heading: 'تم تسجيل البنك المختار', tone: 'success',
        panelTitle: v.bankNameAr ?? 'البنك',
        panelText: 'سُجّل البنك الذي اخترته لهذا الطلب. تواصل مع البنك مباشرةً خارج المنصة لإتمام الإجراءات (المنصة لا تتواصل مع البنك ولا تنتظر موافقته)، ثم سجّل نتيجة التعاقد من حسابك: «تم التعاقد» مع مستند الإثبات، أو «لم يتم التعاقد» مع السبب.',
        rows: appRows(v), ctaLabel: 'تسجيل نتيجة التعاقد', link: v.appId ? siteLink(`task/${encodeURIComponent(v.appId)}`) : link,
        english: `Your bank choice for application ${v.number ?? ''} was recorded. Contact the bank directly outside the platform, then record the contract outcome in your account.`,
        sms: `شمس الصناعة: سُجّل البنك المختار للطلب ${ref(v)}. تواصل مع البنك ثم سجّل نتيجة التعاقد.`,
      });
    case 'app.distribution_path_selected':
      return build({
        subject: `تم تسجيل مسار التعاقد عن طريق شركة التوزيع — الطلب ${ref(v)}`, heading: 'التعاقد من خلال شركة توزيع الكهرباء', tone: 'success',
        panelTitle: 'الخطوة التالية: رفع موافقة شركة التوزيع',
        panelText: 'سُجّل اختيارك لإتمام التعاقد من خلال شركة توزيع الكهرباء (اختيار نهائي). احصل على موافقة شركة التوزيع على التعاقد، ثم ارفعها من حسابك (PDF) وأرسلها لمراجعة وحدة إدارة المبادرة.',
        rows: appRows(v), ctaLabel: 'رفع موافقة شركة التوزيع', link: v.appId ? siteLink(`task/${encodeURIComponent(v.appId)}`) : link,
        english: `You chose to complete the contract for application ${v.number ?? ''} through the electricity distribution company. Next: upload the distribution company contracting approval and send it for PMU review.`,
        sms: `شمس الصناعة: سُجّل مسار التعاقد عن طريق شركة التوزيع للطلب ${ref(v)}. ارفع موافقة شركة التوزيع.`,
      });
    case 'app.distribution_received':
      return build({
        subject: `استلمنا موافقة شركة التوزيع للطلب ${ref(v)} — شمس الصناعة`, heading: 'تم استلام موافقة شركة التوزيع', tone: 'info',
        panelTitle: 'الموافقة قيد المراجعة',
        panelText: 'أُرسلت موافقة شركة توزيع الكهرباء إلى وحدة إدارة المبادرة. القرار نهائي: القبول يعني اكتمال التعاقد، والرفض يغلق الطلب. لا إجراء مطلوب منك الآن، وستصلك رسالة بالقرار.',
        rows: appRows(v), body: v.reason ? paragraph(`<b>ملاحظاتك المرفقة:</b> ${escapeMultiline(v.reason)}`) : '', ctaLabel: 'متابعة الطلب', link,
        english: `The distribution company approval for application ${v.number ?? ''} was received and is under PMU review (final decision).`,
        sms: `شمس الصناعة: استُلمت موافقة شركة التوزيع للطلب ${ref(v)} وهي قيد المراجعة.`,
      });
    case 'ops.provider_pending':
      return build({
        subject: `مقدم خدمة بانتظار اعتمادكم: ${v.providerNameAr ?? ''}`, heading: 'مقدم خدمة جديد بانتظار الاعتماد', tone: 'info',
        panelTitle: v.providerNameAr ?? 'مقدم الخدمة',
        panelText: 'فعّلت ENCPC مقدم خدمة في دليل المقدمين، ولا يظهر للمصانع قبل اعتماد وحدة إدارة المبادرة له.',
        ctaLabel: 'مراجعة مقدمي الخدمة', link: siteLink('providers'),
        english: `ENCPC activated the service provider "${v.providerNameAr ?? ''}"; it stays hidden from factories until the PMU approves it.`,
        sms: 'شمس الصناعة: مقدم خدمة جديد بانتظار اعتماد وحدة إدارة المبادرة.',
      });
    case 'ops.provider_changed':
      return build({
        subject: `تعديل على مقدم خدمة معتمد: ${v.providerNameAr ?? ''}`, heading: 'عُدّلت بيانات مقدم خدمة معتمد', tone: 'warning',
        panelTitle: v.providerNameAr ?? 'مقدم الخدمة',
        panelText: `${v.eventAr ?? ''}. حالة الاعتماد وظهور المقدم للمصانع لم يتغيرا، وسجل التدقيق يحفظ القيم قبل التعديل وبعده. راجعوا التعديل، ولكم إيقاف المقدم إن لزم.`,
        ctaLabel: 'مراجعة مقدمي الخدمة', link: siteLink('providers'),
        english: `The approved service provider "${v.providerNameAr ?? ''}" was edited — ${v.eventEn ?? ''}. Approval and visibility to factories are unchanged; the audit log keeps the before/after values. Review it, and suspend the provider if needed.`,
        sms: 'شمس الصناعة: عُدّلت بيانات مقدم خدمة معتمد. راجعوا التعديل في صفحة مقدمي الخدمة.',
      });
    case 'ops.no_providers':
      return build({
        subject: `تنبيه تشغيلي: لا يوجد مقدمو خدمة معتمدون — الطلب ${ref(v)}`, heading: 'قائمة مقدمي الخدمة فارغة', tone: 'danger',
        panelTitle: 'لا يوجد مقدم خدمة معتمد',
        panelText: 'وصل طلب لمرحلة اختيار مقدم الخدمة ولا يوجد أي مقدم خدمة معتمد، فلا يستطيع المصنع المتابعة. اعتمد مقدم خدمة واحدًا على الأقل.',
        rows: appRows(v), ctaLabel: 'فتح الطلب', link,
        english: `Operational alert: application ${v.number ?? ''} reached provider selection but no provider is approved.`,
        sms: `شمس الصناعة: تنبيه — لا يوجد مقدمو خدمة معتمدون (الطلب ${ref(v)}).`,
      });
    case 'ops.registry_conflict':
      return build({
        subject: `تعارض على رقم السجل الصناعي ${v.registryNumber ?? ''} — شمس الصناعة`, heading: 'محاولة استخدام رقم سجل محجوز', tone: 'warning',
        panelTitle: `رقم السجل: ${v.registryNumber ?? ''}`,
        panelText: 'حاول مصنع إرسال طلب برقم سجل صناعي مستخدم في طلب مفتوح لمصنع آخر، ولم يُرسل طلبه. راجعوا ملكية الرقم في الطلب المفتوح.',
        rows: [
          ['الطلب المفتوح (الحاجز للرقم)', ref(v)], ['المنشأة في الطلب المفتوح', v.companyName ?? '—'],
          ['الطلب الذي حاول الإرسال', v.otherNumber ?? 'مسودة'], ['المنشأة التي حاولت', v.otherCompanyName ?? '—'],
        ],
        ctaLabel: 'فتح الطلب المفتوح', link,
        english: `Registry number conflict: another factory tried to submit with a number held by application ${v.number ?? ''}.`,
        sms: `شمس الصناعة: تعارض على رقم السجل ${v.registryNumber ?? ''} مع الطلب ${ref(v)}.`,
      });
    case 'ops.contract_amount_alert':
      return build({
        subject: `تنبيه: قيمة تعاقد أعلى من حد المبادرة — الطلب ${ref(v)}`, heading: 'قيمة تعاقد مرتفعة', tone: 'warning',
        panelTitle: 'قيمة مسجلة من المصنع',
        panelText: `سجّل المصنع قيمة تعاقد ${(v.amount ?? 0).toLocaleString('en-US')} جنيه، وهي أعلى من ${(v.threshold ?? 0).toLocaleString('en-US')} جنيه الواردة في وثيقة المبادرة. تنبيه للمراجعة فقط، ولم يُرفض التسجيل.`,
        rows: appRows(v), ctaLabel: 'فتح الطلب', link,
        english: `Alert: the contract amount recorded by the factory on ${v.number ?? ''} exceeds the initiative limit. For review only — not rejected.`,
        sms: `شمس الصناعة: قيمة تعاقد مرتفعة على الطلب ${ref(v)} — للمراجعة.`,
      });
    case 'ops.bank_unavailable':
      return build({
        subject: `تنبيه تشغيلي: إيقاف ${v.bankNameAr ?? 'بنك'} وله طلبات مفتوحة`, heading: 'بنك موقوف بطلبات مفتوحة', tone: 'danger',
        panelTitle: v.bankNameAr ?? 'البنك',
        panelText: `أُوقف بنك اختاره ${v.count ?? 0} طلب لم يسجل نتيجة التعاقد بعد. يستطيع المصنع تسجيل النتيجة كالمعتاد؛ البنك لا يظهر في الاختيارات الجديدة.`,
        english: `Operational alert: a bank chosen by ${v.count ?? 0} open application(s) was disabled. Factories can still record the outcome; the bank is hidden from new choices.`,
        sms: `شمس الصناعة: أُوقف ${v.bankNameAr ?? 'بنك'} وله ${v.count ?? 0} طلب مفتوح.`,
      });
    case 'app.sla_overdue':
      return build({
        subject: `تأخر في الطلب ${ref(v)} — شمس الصناعة`, heading: 'تجاوز المهلة المحددة', tone: 'warning',
        panelTitle: v.stateAr ?? 'تأخر', panelText: `تجاوز الطلب المهلة المحددة لهذه المرحلة${v.daysOverdue ? ` بنحو ${v.daysOverdue} يوم` : ''}.`, rows: appRows(v),
        ctaLabel: 'فتح الطلب', link, english: `Application ${v.number ?? ''} is overdue in stage "${v.stateEn ?? ''}".`,
        sms: `شمس الصناعة: الطلب ${ref(v)} تجاوز مهلة مرحلة ${v.stateAr ?? ''}.`,
      });
  }
}
