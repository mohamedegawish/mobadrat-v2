/** قوالب الإشعارات (بريد HTML بالقالب الرسمي + SMS قصير) — عربي أولًا مع ملخص إنجليزي. */
import { config } from '../config.js';
import { detailsTable, escapeHtml, escapeMultiline, paragraph, renderEmail, statusPanel, type EmailTone } from '../mail/layout.js';

const BRAND = 'صُنّاع المستقبل';

export type TemplateKey =
  | 'auth.verify_email' | 'auth.reset_password' | 'auth.email_changed_old' | 'auth.email_changed_new'
  | 'app.submitted' | 'app.review_assigned' | 'app.resubmitted' | 'app.correction_requested' | 'app.rejected'
  | 'app.eligible' | 'app.evaluation_assigned' | 'app.selected' | 'app.not_selected' | 'app.approved' | 'app.not_approved'
  | 'app.funder_referred' | 'app.funding_approved' | 'app.funding_declined'
  | 'app.milestone_reported' | 'app.milestone_reviewed' | 'app.milestone_verified' | 'app.milestone_disbursed'
  | 'app.operating' | 'app.closed' | 'app.appeal_submitted' | 'app.appeal_decided' | 'app.sla_overdue'
  | 'ops.no_recipients' | 'ops.coi_declared' | 'ops.evaluations_complete';

export interface TemplateVars {
  name?: string;
  link?: string;
  appId?: string;
  number?: string | null;
  projectName?: string;
  stateAr?: string;
  stateEn?: string;
  reason?: string;
  deficiencies?: Array<{ labelAr: string; labelEn: string; note: string }>;
  outcome?: 'CLOSED_NOT_FUNDED' | 'COMPLETED' | 'WITHDRAWN';
  daysOverdue?: number;
  funderNameAr?: string;
  /** الجهة التي لا يوجد فيها مستلم نشط (ops.no_recipients). */
  orgNameAr?: string;
  amount?: number;
  modelAr?: string;
  milestoneTitle?: string;
  verified?: boolean;
  accepted?: boolean;
  evaluatorName?: string;
  count?: number;
}

export interface Rendered { subject: string; html: string; text: string; sms: string }

/** رابط الطلب — بلا أي توكن، ويتطلب تسجيل الدخول. */
export function applicationLink(appId: string): string {
  return `${config.appUrl}/#application/${encodeURIComponent(appId)}`;
}

function ref(v: TemplateVars): string { return v.number ?? 'مسودة'; }
const money = (n?: number) => `${(n ?? 0).toLocaleString('en-US')} جنيه`;

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
  const text = [o.heading, o.panelText, ...(o.rows ?? []).map(([k, v]) => `${k}: ${v}`), o.body ? htmlToText(o.body) : '', o.link ? `الرابط: ${o.link}` : '', '', o.english].filter(Boolean).join('\n');
  return { subject: `${o.subject} — ${BRAND}`, html, text, sms: `${BRAND}: ${o.sms}` };
}

/** متن HTML المبني بمساعدات القالب → نص عادي. */
function htmlToText(html: string): string {
  return html.replace(/<li[^>]*>/g, '\n- ').replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n').trim();
}

function appRows(v: TemplateVars): Array<[string, string]> {
  const rows: Array<[string, string]> = [['رقم الطلب', ref(v)]];
  if (v.projectName) rows.push(['المشروع', v.projectName]);
  if (v.stateAr) rows.push(['الحالة', v.stateAr]);
  return rows;
}

function reasonHtml(v: TemplateVars, label = 'السبب'): string {
  return v.reason ? paragraph(`<b>${label}:</b> ${escapeMultiline(v.reason)}`) : '';
}

function deficienciesHtml(v: TemplateVars): string {
  if (!v.deficiencies?.length) return '';
  const items = v.deficiencies.map((d) => `<li style="margin-bottom:6px;"><b>${escapeHtml(d.labelAr)}</b>${d.note ? ` — ${escapeMultiline(d.note)}` : ''}</li>`).join('');
  return paragraph(`<b>المطلوب استيفاؤه:</b><ul style="margin:8px 0 0 0;padding-right:20px;">${items}</ul>`);
}

export function renderTemplate(key: TemplateKey, v: TemplateVars): Rendered {
  const link = v.link ?? (v.appId ? applicationLink(v.appId) : config.appUrl);
  const open = { ctaLabel: 'فتح الطلب', link };
  switch (key) {
    case 'auth.verify_email':
      return build({
        subject: 'تفعيل حسابك', heading: 'تفعيل البريد الإلكتروني', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`, panelText: `اضغط الزر لتفعيل حسابك على منصة «${BRAND}». الرابط صالح لمدة 24 ساعة ولمرة واحدة.`,
        ctaLabel: 'تفعيل الحساب', link, english: 'Activate your Future Makers account using the button above (valid for 24 hours, single use).',
        sms: 'تم إرسال رابط تفعيل الحساب إلى بريدك الإلكتروني.',
      });
    case 'auth.reset_password':
      return build({
        subject: 'استعادة كلمة المرور', heading: 'استعادة كلمة المرور', tone: 'warning',
        panelTitle: 'طلب استعادة كلمة المرور', panelText: 'اضغط الزر لتعيين كلمة مرور جديدة. الرابط صالح لمدة ساعة ولمرة واحدة. إذا لم تطلب ذلك فتجاهل الرسالة.',
        ctaLabel: 'تعيين كلمة مرور جديدة', link, english: 'Use the button above to set a new password (valid for 1 hour, single use).',
        sms: 'تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني.',
      });
    case 'auth.email_changed_old':
      return build({
        subject: 'تغيير البريد الإلكتروني لحسابك', heading: 'تم تغيير بريد الحساب', tone: 'warning',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'غيّرت إدارة النظام البريد الإلكتروني لحسابك بناءً على طلب رسمي، وأُنهيت كل الجلسات المفتوحة. إذا لم تطلب ذلك فتواصل مع قناة الاستفسار فورًا.',
        english: 'The email address of your account was changed by the system administration on a formal request.',
        sms: 'تم تغيير البريد الإلكتروني لحسابك.',
      });
    case 'auth.email_changed_new':
      return build({
        subject: 'تفعيل البريد الجديد لحسابك', heading: 'تفعيل البريد الإلكتروني الجديد', tone: 'info',
        panelTitle: `مرحبًا ${v.name ?? ''}`,
        panelText: 'نُقل حسابك إلى هذا البريد بناءً على طلب رسمي. اضغط الزر لتفعيله، ثم استخدم «نسيت كلمة المرور» لتعيين كلمة مرور جديدة.',
        ctaLabel: 'تفعيل البريد', link, english: 'Your account was moved to this email address. Activate it, then reset your password.',
        sms: 'أُرسل رابط تفعيل البريد الجديد لحسابك.',
      });
    case 'app.submitted':
      return build({
        subject: `تم استلام طلبك ${ref(v)}`, heading: 'تم استلام طلبك', tone: 'success',
        panelTitle: `رقم الطلب: ${ref(v)}`, panelText: 'أُحيل طلبك لفحص الأهلية والفرز الأولي. احتفظ برقم الطلب للمتابعة، وستصلك رسالة عند كل قرار.',
        rows: appRows(v), ctaLabel: 'متابعة الطلب', link, english: `Your application ${v.number ?? ''} was received and sent for eligibility review.`,
        sms: `تم استلام طلبك برقم ${ref(v)} وأُحيل لفحص الأهلية.`,
      });
    case 'app.review_assigned':
      return build({
        subject: `الطلب ${ref(v)} بانتظاركم`, heading: 'طلب بانتظار إجرائكم', tone: 'info',
        panelTitle: v.stateAr ?? 'مراجعة', panelText: 'دخل الطلب مرحلة تخص جهتكم. يرجى المراجعة واتخاذ الإجراء.', rows: appRows(v),
        ...open, english: `Application ${v.number ?? ''} is awaiting your action (${v.stateEn ?? ''}).`,
        sms: `الطلب ${ref(v)} بانتظار إجرائكم.`,
      });
    case 'app.resubmitted':
      return build({
        subject: `إعادة تقديم الطلب ${ref(v)}`, heading: 'أعاد المتقدم التقديم', tone: 'info',
        panelTitle: v.stateAr ?? 'مراجعة', panelText: 'استكمل المتقدم المطلوب وأعاد التقديم، والطلب عاد لمراجعتكم.', rows: appRows(v),
        ...open, english: `Application ${v.number ?? ''} was resubmitted and is back for your review.`,
        sms: `أُعيد تقديم الطلب ${ref(v)} وهو بانتظار مراجعتكم.`,
      });
    case 'app.correction_requested':
      return build({
        subject: `مطلوب استيفاء على الطلب ${ref(v)}`, heading: 'مطلوب منك تعديل/استيفاء', tone: 'warning',
        panelTitle: v.stateAr ?? 'استيفاء', panelText: 'طلب فريق المبادرة استيفاء بعض البنود. عدّل البنود المطلوبة فقط ثم أعد الإرسال.',
        rows: appRows(v), body: `${deficienciesHtml(v)}${reasonHtml(v, 'ملاحظات')}`,
        ctaLabel: 'استكمال الطلب', link, english: `Corrections were requested on application ${v.number ?? ''}. Update the listed items and resubmit.`,
        sms: `مطلوب استيفاء على الطلب ${ref(v)}. ادخل على المنصة لمعرفة البنود.`,
      });
    case 'app.rejected':
      return build({
        subject: `قرار بشأن الطلب ${ref(v)}`, heading: 'لم يستوفِ الطلب شروط المرحلة', tone: 'danger',
        panelTitle: 'قرار نهائي', panelText: 'نأسف لإبلاغك بأن الطلب لم يستوفِ متطلبات المرحلة. يمكنك تقديم تظلم مسبب خلال المدة المعلنة من صفحة الطلب.',
        rows: appRows(v), body: reasonHtml(v, 'سبب القرار'), ...open,
        english: `Application ${v.number ?? ''} was not accepted. The reason is shown above. You may file one appeal within the announced period.`,
        sms: `صدر قرار بعدم قبول الطلب ${ref(v)}. السبب وإمكانية التظلم على المنصة.`,
      });
    case 'app.eligible':
      return build({
        subject: `مستوفٍ للأهلية — ابدأ دراسة الجدوى (${ref(v)})`, heading: 'اجتاز طلبك فحص الأهلية', tone: 'success',
        panelTitle: 'المرحلة التالية: دراسة الجدوى',
        panelText: 'اجتاز طلبك الفحص الأولي. أعدّ دراسة الجدوى على النموذج الموحد في المنصة (السوق، الفني، المالي، المخاطر، الأثر، خطة التنفيذ)، ويمكنك الاستعانة بأحد الخبراء المعتمدين.',
        rows: appRows(v), ctaLabel: 'إعداد دراسة الجدوى', link, english: `Application ${v.number ?? ''} passed eligibility. Next: prepare the feasibility study.`,
        sms: `اجتاز الطلب ${ref(v)} فحص الأهلية. ابدأ إعداد دراسة الجدوى على المنصة.`,
      });
    case 'app.evaluation_assigned':
      return build({
        subject: `مشروع مسند إليك للتقييم (${ref(v)})`, heading: 'مشروع جديد للتقييم', tone: 'info',
        panelTitle: v.projectName ?? 'مشروع', panelText: 'أُسند إليك تقييم هذا المشروع. ابدأ بإقرار عدم تضارب المصالح، ثم سجّل درجاتك على المعايير الستة.',
        rows: [['رقم الطلب', ref(v)]], ctaLabel: 'بدء التقييم', link, english: `You were assigned to evaluate application ${v.number ?? ''}.`,
        sms: `أُسند إليك تقييم المشروع ${ref(v)}.`,
      });
    case 'app.selected':
      return build({
        subject: `تهانينا — اختير مشروعك (${ref(v)})`, heading: 'اختير مشروعك ضمن أفضل المشروعات', tone: 'success',
        panelTitle: 'مرحلة العرض والاعتماد',
        panelText: 'اختير مشروعك بعد التقييم. الاختيار لا يعني ضمان التمويل، وإنما يؤهل المشروع لاستكمال إجراءات الاعتماد والتحقق المالي والقانوني لدى الجهات المختصة.',
        rows: appRows(v), ...open, english: `Application ${v.number ?? ''} was selected. Selection qualifies the project for approval and funding procedures; it does not guarantee funding.`,
        sms: `اختير مشروعك ${ref(v)}. التفاصيل على المنصة.`,
      });
    case 'app.not_selected':
      return build({
        subject: `نتيجة الاختيار — الطلب ${ref(v)}`, heading: 'لم يُختر المشروع في هذه الدورة', tone: 'neutral',
        panelTitle: 'نتيجة الاختيار', panelText: 'شكرًا لمشاركتك. لم يُختر المشروع ضمن مستهدف هذه الدورة. يمكنك تقديم تظلم مسبب خلال المدة المعلنة، أو التقديم في دورة قادمة.',
        rows: appRows(v), body: reasonHtml(v), ...open, english: `Application ${v.number ?? ''} was not selected in this cohort.`,
        sms: `لم يُختر المشروع ${ref(v)} في هذه الدورة. التفاصيل على المنصة.`,
      });
    case 'app.approved':
      return build({
        subject: `اعتماد المشروع ${ref(v)}`, heading: 'اعتُمد مشروعك', tone: 'success',
        panelTitle: 'ترتيبات التمويل', panelText: 'اعتُمد المشروع، ويجري فريق المبادرة الآن التنسيق مع جهات التمويل.', rows: appRows(v), ...open,
        english: `Application ${v.number ?? ''} was approved. The initiative team is arranging funding.`,
        sms: `اعتُمد المشروع ${ref(v)} وجارٍ ترتيب التمويل.`,
      });
    case 'app.not_approved':
      return build({
        subject: `قرار الاعتماد — الطلب ${ref(v)}`, heading: 'لم يُعتمد المشروع', tone: 'neutral',
        panelTitle: 'قرار نهائي', panelText: 'لم يُعتمد المشروع في مرحلة العرض والاعتماد.', rows: appRows(v), body: reasonHtml(v), ...open,
        english: `Application ${v.number ?? ''} was not approved.`, sms: `لم يُعتمد المشروع ${ref(v)}. التفاصيل على المنصة.`,
      });
    case 'app.funder_referred':
      return build({
        subject: `إحالة المشروع ${ref(v)} لجهة تمويل`, heading: 'أُحيل الملف لجهة تمويل', tone: 'info',
        panelTitle: v.funderNameAr ?? 'جهة التمويل', panelText: 'أُحيل ملف المشروع المعتمد لدراسة التمويل.', rows: appRows(v), ...open,
        english: `Application ${v.number ?? ''} was referred to a funder.`, sms: `أُحيل المشروع ${ref(v)} لجهة تمويل.`,
      });
    case 'app.funding_approved':
      return build({
        subject: `الموافقة على تمويل المشروع ${ref(v)}`, heading: 'تمت الموافقة على التمويل', tone: 'success',
        panelTitle: money(v.amount), panelText: `وافقت ${v.funderNameAr ?? 'جهة التمويل'} على تمويل المشروع${v.modelAr ? ` (${v.modelAr})` : ''}. يُصرف التمويل على مراحل مرتبطة بالإنجاز: أبلغ عن كل مرحلة بالدليل لصرف دفعتها.`,
        rows: appRows(v), ctaLabel: 'مراحل التنفيذ', link, english: `Funding for ${v.number ?? ''} was approved. Funds are released per verified milestone.`,
        sms: `تمت الموافقة على تمويل المشروع ${ref(v)}. التفاصيل على المنصة.`,
      });
    case 'app.funding_declined':
      return build({
        subject: `اعتذار جهة تمويل — الطلب ${ref(v)}`, heading: 'اعتذرت جهة التمويل', tone: 'warning',
        panelTitle: v.funderNameAr ?? 'جهة التمويل', panelText: 'اعتذرت جهة التمويل عن تمويل المشروع، وعاد الملف لفريق المبادرة لإحالته لجهة أخرى أو إغلاقه.',
        rows: appRows(v), body: reasonHtml(v), ...open, english: `The funder declined application ${v.number ?? ''}. It is back with the initiative team.`,
        sms: `اعتذرت جهة التمويل عن المشروع ${ref(v)}.`,
      });
    case 'app.milestone_reported':
      return build({
        subject: `إبلاغ عن إنجاز مرحلة — ${ref(v)}`, heading: 'مرحلة إنجاز بانتظار التحقق', tone: 'info',
        panelTitle: v.milestoneTitle ?? 'مرحلة', panelText: 'أبلغ المتقدم عن إنجاز مرحلة وأرفق الدليل. يرجى التحقق.', rows: appRows(v), ...open,
        english: `A milestone on ${v.number ?? ''} was reported and awaits verification.`, sms: `مرحلة إنجاز بانتظار التحقق على ${ref(v)}.`,
      });
    case 'app.milestone_reviewed':
      return build({
        subject: `نتيجة التحقق من مرحلة — ${ref(v)}`, heading: v.verified ? 'تم التحقق من المرحلة' : 'المرحلة تحتاج استكمالًا', tone: v.verified ? 'success' : 'warning',
        panelTitle: v.milestoneTitle ?? 'مرحلة',
        panelText: v.verified ? 'تحقق فريق المبادرة من إنجاز المرحلة، وأُبلغت جهة التمويل لصرف الدفعة.' : 'أعاد فريق المبادرة المرحلة لاستكمال الدليل أو الإنجاز.',
        rows: appRows(v), body: reasonHtml(v, 'ملاحظات'), ...open,
        english: `Milestone ${v.verified ? 'verified' : 'returned'} on ${v.number ?? ''}.`, sms: `مرحلة ${v.milestoneTitle ?? ''}: ${v.verified ? 'تم التحقق' : 'تحتاج استكمالًا'}.`,
      });
    case 'app.milestone_verified':
      return build({
        subject: `دفعة جاهزة للصرف — ${ref(v)}`, heading: 'مرحلة متحقق منها جاهزة للصرف', tone: 'info',
        panelTitle: v.milestoneTitle ?? 'مرحلة', panelText: `تحقق فريق المبادرة من إنجاز المرحلة. قيمة الدفعة: ${money(v.amount)}. سجّلوا الصرف بعد تنفيذه.`,
        rows: appRows(v), ...open, english: `A verified milestone on ${v.number ?? ''} is ready for disbursement.`, sms: `دفعة جاهزة للصرف على ${ref(v)}.`,
      });
    case 'app.milestone_disbursed':
      return build({
        subject: `صرف دفعة — ${ref(v)}`, heading: 'تم صرف دفعة', tone: 'success',
        panelTitle: v.milestoneTitle ?? 'مرحلة', panelText: `سجلت جهة التمويل صرف دفعة بقيمة ${money(v.amount)}.`, rows: appRows(v), ...open,
        english: `A tranche was disbursed on ${v.number ?? ''}.`, sms: `تم صرف دفعة ${money(v.amount)} للمشروع ${ref(v)}.`,
      });
    case 'app.operating':
      return build({
        subject: `بدء التشغيل — ${ref(v)}`, heading: 'دخل المشروع مرحلة التشغيل', tone: 'success',
        panelTitle: 'المتابعة وقياس الأثر', panelText: 'تهانينا ببدء التشغيل. المطلوب الآن تقارير أثر دورية (الإيرادات والإنتاج وفرص العمل) من صفحة المشروع.',
        rows: appRows(v), ctaLabel: 'تقارير الأثر', link, english: `Project ${v.number ?? ''} is now operating. Please submit periodic impact reports.`,
        sms: `دخل المشروع ${ref(v)} مرحلة التشغيل. أرسل تقارير الأثر الدورية.`,
      });
    case 'app.closed': {
      const map = {
        CLOSED_NOT_FUNDED: { t: 'أُغلق — تعذر التمويل', tone: 'neutral' as EmailTone, en: 'closed — not funded' },
        COMPLETED: { t: 'اكتملت متابعة المشروع', tone: 'success' as EmailTone, en: 'monitoring completed' },
        WITHDRAWN: { t: 'انسحب المتقدم', tone: 'neutral' as EmailTone, en: 'withdrawn by the applicant' },
      }[v.outcome ?? 'COMPLETED'];
      return build({
        subject: `${map.t}: الطلب ${ref(v)}`, heading: map.t, tone: map.tone,
        panelTitle: 'حالة نهائية', panelText: `الحالة النهائية للطلب: ${map.t}.`, rows: appRows(v), body: reasonHtml(v), ...open,
        english: `Application ${v.number ?? ''} is ${map.en}.`, sms: `الطلب ${ref(v)} — ${map.t}.`,
      });
    }
    case 'app.appeal_submitted':
      return build({
        subject: `تظلم على الطلب ${ref(v)}`, heading: 'تظلم جديد', tone: 'warning',
        panelTitle: 'تظلم بانتظار القرار', panelText: 'قدم المتقدم تظلمًا مسببًا على قرار المرحلة. يرجى دراسته وإصدار قرار مسبب.', rows: appRows(v), body: reasonHtml(v, 'أسباب التظلم'), ...open,
        english: `An appeal was filed on application ${v.number ?? ''}.`, sms: `تظلم جديد على الطلب ${ref(v)}.`,
      });
    case 'app.appeal_decided':
      return build({
        subject: `قرار التظلم — الطلب ${ref(v)}`, heading: v.accepted ? 'قُبل تظلمك' : 'رُفض التظلم', tone: v.accepted ? 'success' : 'neutral',
        panelTitle: 'قرار التظلم',
        panelText: v.accepted ? 'قُبل تظلمك وأُعيد الطلب لمرحلة المراجعة التي صدر منها القرار.' : 'دُرس تظلمك ورُفض، ويبقى القرار السابق نهائيًا.',
        rows: appRows(v), body: reasonHtml(v, 'أسباب القرار'), ...open, english: `Your appeal on ${v.number ?? ''} was ${v.accepted ? 'accepted' : 'rejected'}.`,
        sms: `قرار التظلم على الطلب ${ref(v)}: ${v.accepted ? 'مقبول' : 'مرفوض'}.`,
      });
    case 'app.sla_overdue':
      return build({
        subject: `تأخر في الطلب ${ref(v)}`, heading: 'تجاوز المهلة المحددة', tone: 'warning',
        panelTitle: v.stateAr ?? 'تأخر', panelText: `تجاوز الطلب المهلة المحددة لهذه المرحلة${v.daysOverdue ? ` بنحو ${v.daysOverdue} يوم` : ''}.`, rows: appRows(v),
        ...open, english: `Application ${v.number ?? ''} is overdue in stage "${v.stateEn ?? ''}".`, sms: `الطلب ${ref(v)} تجاوز مهلة مرحلة ${v.stateAr ?? ''}.`,
      });
    case 'ops.no_recipients':
      return build({
        subject: `تنبيه تشغيلي: الطلب ${ref(v)} أُحيل لجهة بلا مستخدمين نشطين`, heading: 'طلب بلا مستلم', tone: 'danger',
        panelTitle: v.orgNameAr ?? 'جهة بلا مستخدمين', panelText: 'دخل الطلب مرحلة تخص جهة لا يوجد فيها مستخدم نشط. أضف مستخدمًا للجهة أو فعّله.',
        rows: appRows(v), ...open, english: `Operational alert: application ${v.number ?? ''} entered a stage whose organization has no active users.`,
        sms: `تنبيه — الطلب ${ref(v)} أُحيل لجهة بلا مستخدمين نشطين.`,
      });
    case 'ops.coi_declared':
      return build({
        subject: `إقرار تضارب مصالح — ${ref(v)}`, heading: 'مقيّم أقر بتضارب المصالح', tone: 'warning',
        panelTitle: v.evaluatorName ?? 'مقيّم', panelText: 'أقر المقيّم بوجود تضارب مصالح واستُبعد من تقييم المشروع. أسند مقيّمًا بديلًا إن لزم.',
        rows: appRows(v), body: reasonHtml(v, 'ملاحظة المقيّم'), ...open, english: `An evaluator declared a conflict of interest on ${v.number ?? ''}.`,
        sms: `مقيّم أقر بتضارب مصالح على ${ref(v)}. أسند بديلًا.`,
      });
    case 'ops.evaluations_complete':
      return build({
        subject: `اكتمل تقييم المشروع ${ref(v)}`, heading: 'سلّم كل المقيّمين درجاتهم', tone: 'info',
        panelTitle: `${v.count ?? 0} تقييم`, panelText: 'سلّم كل المقيّمين المسندين درجاتهم. يمكنكم اعتماد نتيجة التقييم.', rows: appRows(v), ...open,
        english: `All evaluators submitted scores for ${v.number ?? ''}.`, sms: `اكتمل تقييم المشروع ${ref(v)}.`,
      });
  }
}
