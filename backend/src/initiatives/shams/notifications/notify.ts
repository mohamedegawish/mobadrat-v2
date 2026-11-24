/**
 * إدخال الإشعارات في outbox — يُستدعى داخل معاملة الانتقال، والإرسال الفعلي بالعامل لاحقًا (القرار لا ينتظر الإرسال).
 */
import type { Channel } from '../store/outbox.js';
import { activeUsersOf } from '../store/users.js';
import type { AppRow } from '../store/applications.js';
import { getOrganization } from '../store/organizations.js';
import { getProvider, listSelectableProviders } from '../store/providers.js';
import { renderTemplate, type TemplateKey, type TemplateVars } from './templates.js';
import type { AccountEvent } from '../services/factoryAccount.js';
import { ORG_IDS, type Role } from '../domain.js';
import { MODULE_ID } from '../config.js';
import { dispatchRendered } from '../../../core/notify/dispatch.js';
import type { DecisionReason } from '../../../core/notify/decisionText.js';
import {
  STATE_LABELS, STATE_RESPONSIBLE, responsibleOrgId, type ApplicationState, type TransitionDef,
} from '../workflow/shamsWorkflow.js';
import type { TransitionRow } from '../store/applications.js';

export interface Recipient { userId?: string | null; email?: string; phone?: string }

/** صفحات داخلية لقوالب التشغيل التي لا تحمل appId. */
const INBOX_VIEW: Partial<Record<TemplateKey, string>> = {
  'ops.registry_objection': 'approvals', 'ops.provider_pending': 'providers', 'ops.provider_changed': 'providers', 'ops.recovery_pending': 'approvals', 'ops.account_request': 'approvals', 'ops.integration_key': 'approvals',
};

/** مسار hash داخلي للإشعار (لا رابط خارجي ولا توكن). الواجهة تتحقق منه مجددًا قبل التنقل. */
function inboxLink(key: TemplateKey, v: TemplateVars): string {
  if (v.appId) return `application/${encodeURIComponent(v.appId)}`;
  return INBOX_VIEW[key] ?? '';
}

/**
 * D10: قوالب القرارات السلبية — السبب يصل في الإشعار الداخلي كاملًا وفي الـ SMS مختصرًا (الطبقة المشتركة core/notify).
 * الإيميل يحمل السبب أصلًا من القالب.
 */
const REASON_LABEL: Partial<Record<TemplateKey, string>> = {
  'app.correction_requested': 'المطلوب', 'account.correction_requested': 'المطلوب',
  'app.rejected': 'سبب الرفض', 'account.rejected': 'سبب الرفض',
  'app.closed': 'السبب', 'registry.objection_decided': 'السبب', 'registry.released': 'السبب', 'registry.decision_lost': 'السبب',
};

/** نص السبب: النواقص (البند: الملاحظة) ثم السبب العام إن لم يكن تكرارًا لملاحظة. null = لا سبب لهذا القرار. */
export function decisionReason(key: TemplateKey, v: TemplateVars): DecisionReason | undefined {
  const labelAr = REASON_LABEL[key];
  if (!labelAr) return undefined;
  if (key === 'app.closed' && v.outcome === 'CONTRACTED') return undefined; // ملاحظات تعاقد ناجح ليست سبب قرار سلبي
  const notes = (v.deficiencies ?? []).map((d) => (d.note ? `${d.labelAr}: ${d.note}` : d.labelAr));
  const reason = v.reason?.trim();
  if (reason && !(v.deficiencies ?? []).some((d) => d.note?.trim() === reason)) notes.push(reason);
  return notes.length ? { labelAr, text: notes.join(' — ') } : undefined;
}

/** يُصيّر القالب ويضعه في الطابور المشترك للمنصة (core/notify/dispatch) موسومًا بهذه المبادرة. */
export async function dispatch(
  key: TemplateKey, vars: TemplateVars, recipients: Recipient[],
  opts: { dedupePrefix: string; applicationId?: string | null; sensitive?: boolean; channels?: Channel[] },
): Promise<number> {
  return await dispatchRendered(renderTemplate(key, vars), recipients, {
    initiativeId: MODULE_ID, templateKey: key, dedupePrefix: opts.dedupePrefix, applicationId: opts.applicationId ?? null,
    sensitive: opts.sensitive, channels: opts.channels, inboxLink: inboxLink(key, vars), reason: decisionReason(key, vars),
  });
}

/**
 * مستلمو المصنع: مستخدموه النشطون ذوو البريد المفعّل فقط (M11).
 * `contactEmail` المُدخل في الفورم لا يُستخدم للإشعارات حتى يُعتمد قرار بشأنه، لأنه غير مُفعّل.
 */
export async function factoryRecipients(app: AppRow): Promise<Recipient[]> {
  return (await activeUsersOf(app.factoryOrgId, 'factory_owner'))
    .filter((u) => u.emailVerifiedAt)
    .map((u) => ({ userId: u.id, email: u.email, phone: u.phone || undefined }));
}

export async function orgRecipients(orgId: string | null, role?: Role): Promise<Recipient[]> {
  if (!orgId) return [];
  return (await activeUsersOf(orgId, role)).map((u) => ({ userId: u.id, email: u.email, phone: u.phone || undefined }));
}

/** مستلمو التنبيهات التشغيلية: PMU + الأدمن. */
export async function opsRecipients(): Promise<Recipient[]> {
  return [...await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer'), ...await orgRecipients(ORG_IDS.admin, 'system_admin')];
}

const ROLE_FOR_STATE: Partial<Record<ApplicationState, Role>> = {
  IMC_REVIEW: 'imc_reviewer', ENCPC_REVIEW: 'encpc_reviewer', OFFER_REVIEW: 'pmu_reviewer', ELECTRICITY_REVIEW: 'pmu_reviewer',
  DISTRIBUTION_REVIEW: 'pmu_reviewer',
};

function baseVars(app: AppRow, state: ApplicationState): TemplateVars {
  return { appId: app.id, number: app.number, companyName: app.companyName, stateAr: STATE_LABELS[state].ar, stateEn: STATE_LABELS[state].en };
}

const ACCOUNT_TEMPLATE: Record<AccountEvent, TemplateKey> = {
  under_review: 'account.under_review', approved: 'account.approved', correction_requested: 'account.correction_requested', rejected: 'account.rejected',
};

export interface TransitionNotifyCtx {
  app: AppRow;            // بعد الانتقال
  def: TransitionDef;
  transition: TransitionRow;
  reason?: string;
  deficiencies?: Array<{ labelAr: string; labelEn: string; note: string }>;
  registryResult?: 'invalid' | 'unavailable';
  isResubmission?: boolean;
  bankNameAr?: string;
  /** قرار يخص حساب مصنع لم يُقبل بعد → إيميل account.* للمصنع بدل إيميل الطلب المعتاد (لا إيميلان). */
  accountEvent?: AccountEvent | null;
}

/**
 * يرسل للجهة المسؤولة، وإن لم يوجد فيها مستخدم نشط ينبّه PMU والأدمن بدل أن يضيع الطلب صامتًا (B2).
 */
async function dispatchToOrg(key: TemplateKey, vars: TemplateVars, orgId: string | null, role: Role | undefined, opts: { dedupePrefix: string; applicationId: string }): Promise<number> {
  const recipients = await orgRecipients(orgId, role);
  if (recipients.length) return await dispatch(key, vars, recipients, opts);
  const org = orgId ? await getOrganization(orgId) : null;
  return await dispatch('ops.no_recipients', { ...vars, orgNameAr: org?.nameAr ?? 'جهة غير محددة' }, await opsRecipients(), opts);
}

/** يحدد الأحداث والمستلمين لكل انتقال (جدول الإشعارات في القسم 7). */
export async function notifyTransition(ctx: TransitionNotifyCtx): Promise<number> {
  const { app, transition: t } = ctx;
  const from = t.fromState;
  const to = t.toState;
  const prefix = t.id;
  const vars = { ...baseVars(app, to), reason: ctx.reason, deficiencies: ctx.deficiencies };
  const opts = { dedupePrefix: prefix, applicationId: app.id };
  let n = 0;

  if (from === to && ctx.registryResult) {
    return await dispatch('app.registry_failed', { ...vars, registryResult: ctx.registryResult }, await factoryRecipients(app), opts);
  }
  if (from === 'OFFER_UPLOAD' && to === 'OFFER_UPLOAD') return 0; // إعادة اختيار مقدم الخدمة — المصنع نفسه المنفذ
  // حساب المصنع غير المقبول: إيميل القرار للمصنع بقالب الحساب، وإشعار الجهة المراجعة كما هو.
  const accountKey = ctx.accountEvent ? ACCOUNT_TEMPLATE[ctx.accountEvent] : null;
  const factoryKey = (k: TemplateKey): TemplateKey => accountKey ?? k;
  switch (to) {
    case 'IMC_REVIEW': case 'ENCPC_REVIEW': case 'OFFER_REVIEW': case 'ELECTRICITY_REVIEW': case 'DISTRIBUTION_REVIEW':
      n += await dispatchToOrg(ctx.isResubmission ? 'app.resubmitted' : 'app.review_assigned', vars, responsibleOrgId(app), ROLE_FOR_STATE[to], opts);
      // I9: إيصال استلام للمصنع برقم الطلب، وإشعار بقبول IMC.
      if (to === 'IMC_REVIEW' && (t.action === 'submit' || accountKey)) n += await dispatch(factoryKey('app.submitted'), vars, await factoryRecipients(app), opts);
      if (to === 'ENCPC_REVIEW' && from === 'IMC_REVIEW') n += await dispatch(factoryKey('app.imc_accepted'), vars, await factoryRecipients(app), opts);
      // إيصال استلام العرض الفني للمصنع (إرسال أول أو إعادة رفع).
      if (to === 'OFFER_REVIEW') n += await dispatch('app.offer_received', vars, await factoryRecipients(app), opts);
      // إيصال استلام موافقة الكهرباء + تأكيد البنك المختار (المرحلتان 6 و8 تتمان في نفس الإرسال).
      if (to === 'ELECTRICITY_REVIEW') n += await dispatch('app.electricity_received', vars, await factoryRecipients(app), opts);
      // إيصال استلام موافقة شركة التوزيع للمصنع (ومعه ملاحظته إن أرفقها).
      if (to === 'DISTRIBUTION_REVIEW') n += await dispatch('app.distribution_received', vars, await factoryRecipients(app), opts);
      break;
    case 'DISTRIBUTION_UPLOAD':
      // اختيار مسار شركة توزيع الكهرباء: المطلوب التالي رفع موافقتها.
      n += await dispatch('app.distribution_path_selected', vars, await factoryRecipients(app), opts);
      break;
    case 'OFFER_UPLOAD':
      // اختيار مقدم الخدمة (المرحلة 4): تأكيد للمصنع باسم المقدم.
      if (from === 'PROVIDER_SELECTION') n += await dispatch('app.provider_selected', { ...vars, providerNameAr: app.providerId ? (await getProvider(app.providerId))?.nameAr : undefined }, await factoryRecipients(app), opts);
      break;
    case 'IMC_CORRECTION': case 'ENCPC_CORRECTION': case 'OFFER_CORRECTION':
      n += await dispatch(factoryKey('app.correction_requested'), vars, await factoryRecipients(app), opts);
      break;
    case 'ELECTRICITY_UPLOAD':
      n += from === 'ELECTRICITY_REVIEW'
        ? await dispatch('app.correction_requested', vars, await factoryRecipients(app), opts)
        : await dispatch('app.offer_accepted', vars, await factoryRecipients(app), opts);
      break;
    case 'REJECTED':
      n += await dispatch(factoryKey('app.rejected'), vars, await factoryRecipients(app), opts);
      break;
    case 'PROVIDER_SELECTION': {
      // لقطة الدليل وقت المطابقة الفنية: الاسم والتفاصيل والموقع وشعار كل مقدم متاح، مع رابط صفحة الاختيار داخل الحساب.
      const available = await listSelectableProviders();
      const providers = available.map((p) => ({ id: p.id, nameAr: p.nameAr, description: p.description, website: p.website, hasLogo: Boolean(p.logoStoredName) }));
      n += await dispatch('app.encpc_compliant', { ...vars, providers }, await factoryRecipients(app), opts);
      // B2: قائمة مقدمي الخدمة فارغة → المصنع لا يستطيع المتابعة؛ نبّه PMU والأدمن.
      if (!available.length) n += await dispatch('ops.no_providers', vars, await opsRecipients(), opts);
      break;
    }
    case 'CONTRACT_OUTCOME':
      // G-01: قبول موافقة الكهرباء → المصنع يختار البنك. اختيار البنك → تأكيد للمصنع بالتواصل مع البنك خارج المنصة (G-02: لا إشعار للبنك).
      if (from === 'ELECTRICITY_REVIEW') n += await dispatch('app.electricity_accepted', vars, await factoryRecipients(app), opts);
      else if (t.action === 'select_bank') n += await dispatch('app.bank_selected', { ...vars, bankNameAr: ctx.bankNameAr }, await factoryRecipients(app), opts);
      break;
    case 'CONTRACTED': case 'CLOSED_NOT_CONTRACTED': case 'WITHDRAWN': {
      // المصنع + الجهة الحالية (صاحبة الخطوة قبل الإغلاق) + PMU
      const prevOrg = STATE_RESPONSIBLE[from] === 'factory' ? null : responsibleOrgId({ ...app, state: from });
      const recipients = [...await factoryRecipients(app), ...await orgRecipients(prevOrg), ...(prevOrg === ORG_IDS.pmu ? [] : await orgRecipients(ORG_IDS.pmu, 'pmu_reviewer'))];
      n += await dispatch('app.closed', { ...vars, outcome: to, contractPath: to === 'WITHDRAWN' ? null : app.contractPath, bankNameAr: ctx.bankNameAr }, recipients, opts);
      break;
    }
    default:
      break;
  }
  return n;
}
