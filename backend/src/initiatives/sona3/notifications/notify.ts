/**
 * إدخال الإشعارات في outbox — يُستدعى داخل معاملة الانتقال، والإرسال الفعلي بالعامل لاحقًا (القرار لا ينتظر الإرسال).
 */
import type { Channel } from '../store/outbox.js';
import { dispatchRendered } from '../../../core/notify/dispatch.js';
import type { DecisionReason } from '../../../core/notify/decisionText.js';
import { MODULE_ID } from '../config.js';
import { activeUsersOf } from '../store/users.js';
import type { AppRow, TransitionRow } from '../store/applications.js';
import { getOrganization } from '../store/organizations.js';
import { renderTemplate, type TemplateKey, type TemplateVars } from './templates.js';
import { ORG_IDS, type Role } from '../domain.js';
import { STATE_LABELS, responsibleOrgId, type ApplicationState, type TransitionDef } from '../workflow/workflow.js';

export interface Recipient { userId?: string | null; email?: string; phone?: string }

/**
 * Renders with this initiative's templates (its branding) and queues into the platform outbox + the in-app inbox
 * (core/notify/dispatch.ts), tagged with this initiative. Inbox links are relative to this module's screens.
 */
export async function dispatch(
  key: TemplateKey, vars: TemplateVars, recipients: Recipient[],
  opts: { dedupePrefix: string; applicationId?: string | null; sensitive?: boolean; channels?: Channel[] },
): Promise<number> {
  const rendered = renderTemplate(key, vars);
  const appId = opts.applicationId ?? (vars as { appId?: string }).appId ?? null;
  return await dispatchRendered(rendered, recipients, {
    initiativeId: MODULE_ID, templateKey: key, dedupePrefix: opts.dedupePrefix, applicationId: opts.applicationId ?? null,
    sensitive: opts.sensitive, channels: opts.channels, inboxLink: appId ? `application/${encodeURIComponent(appId)}` : '',
    reason: decisionReason(key, vars),
  });
}

/** D10 (shared with every initiative): negative decisions carry their reason in-app and in the SMS (core/notify). */
const REASON_LABEL: Partial<Record<TemplateKey, string>> = {
  'app.correction_requested': 'المطلوب', 'app.rejected': 'سبب القرار', 'app.not_selected': 'السبب', 'app.not_approved': 'السبب',
  'app.funding_declined': 'السبب', 'app.closed': 'السبب', 'app.appeal_decided': 'أسباب القرار', 'app.milestone_reviewed': 'الملاحظات',
};

export function decisionReason(key: TemplateKey, v: TemplateVars): DecisionReason | undefined {
  const labelAr = REASON_LABEL[key];
  if (!labelAr) return undefined;
  if (key === 'app.closed' && v.outcome === 'COMPLETED') return undefined;
  if (key === 'app.appeal_decided' && v.accepted) return undefined;
  if (key === 'app.milestone_reviewed' && v.verified) return undefined;
  const notes = (v.deficiencies ?? []).map((d) => (d.note ? `${d.labelAr}: ${d.note}` : d.labelAr));
  const reason = v.reason?.trim();
  if (reason && !(v.deficiencies ?? []).some((d) => d.note?.trim() === reason)) notes.push(reason);
  return notes.length ? { labelAr, text: notes.join(' — ') } : undefined;
}

/** مستلمو المتقدم: مستخدموه النشطون ذوو البريد المفعّل فقط. */
export async function applicantRecipients(app: AppRow): Promise<Recipient[]> {
  return (await activeUsersOf(app.applicantOrgId, 'applicant'))
    .filter((u) => u.emailVerifiedAt)
    .map((u) => ({ userId: u.id, email: u.email, phone: u.phone || undefined }));
}

export async function orgRecipients(orgId: string | null, role?: Role): Promise<Recipient[]> {
  if (!orgId) return [];
  return (await activeUsersOf(orgId, role)).map((u) => ({ userId: u.id, email: u.email, phone: u.phone || undefined }));
}

export async function imcRecipients(): Promise<Recipient[]> {
  return await orgRecipients(ORG_IDS.imc, 'imc_officer');
}

/** مستلمو التنبيهات التشغيلية: IMC + الأدمن. */
export async function opsRecipients(): Promise<Recipient[]> {
  return [...await imcRecipients(), ...await orgRecipients(ORG_IDS.admin, 'system_admin')];
}

export function baseVars(app: AppRow, state: ApplicationState = app.state): TemplateVars {
  return { appId: app.id, number: app.number, projectName: app.projectName, stateAr: STATE_LABELS[state].ar, stateEn: STATE_LABELS[state].en };
}

export interface TransitionNotifyCtx {
  app: AppRow;            // بعد الانتقال
  def: TransitionDef;
  transition: TransitionRow;
  reason?: string;
  deficiencies?: Array<{ labelAr: string; labelEn: string; note: string }>;
  funderNameAr?: string;
  amount?: number;
  modelAr?: string;
}

/** يرسل للجهة المسؤولة، وإن لم يوجد فيها مستخدم نشط ينبّه IMC والأدمن بدل أن يضيع الطلب صامتًا. */
export async function dispatchToOrg(key: TemplateKey, vars: TemplateVars, orgId: string | null, role: Role | undefined, opts: { dedupePrefix: string; applicationId: string }): Promise<number> {
  const recipients = await orgRecipients(orgId, role);
  if (recipients.length) return await dispatch(key, vars, recipients, opts);
  const org = orgId ? await getOrganization(orgId) : null;
  return await dispatch('ops.no_recipients', { ...vars, orgNameAr: org?.nameAr ?? 'جهة غير محددة' }, await opsRecipients(), opts);
}

/** يحدد الأحداث والمستلمين لكل انتقال. */
export async function notifyTransition(ctx: TransitionNotifyCtx): Promise<number> {
  const { app, transition: t } = ctx;
  const from = t.fromState;
  const to = t.toState;
  const vars: TemplateVars = { ...baseVars(app, to), reason: ctx.reason, deficiencies: ctx.deficiencies, funderNameAr: ctx.funderNameAr, amount: ctx.amount, modelAr: ctx.modelAr };
  const opts = { dedupePrefix: t.id, applicationId: app.id };
  const toApplicant = async (key: TemplateKey) => await dispatch(key, vars, await applicantRecipients(app), opts);
  const toImc = async (key: TemplateKey) => await dispatchToOrg(key, vars, ORG_IDS.imc, 'imc_officer', opts);
  let n = 0;

  switch (to) {
    case 'ELIGIBILITY_REVIEW':
      n += await toImc(t.action === 'submit' ? 'app.review_assigned' : 'app.resubmitted');
      if (t.action === 'submit') n += await toApplicant('app.submitted');
      break;
    case 'STUDY_REVIEW':
      n += await toImc(t.action === 'submit_study' ? 'app.review_assigned' : 'app.resubmitted');
      break;
    case 'ELIGIBILITY_CORRECTION':
    case 'STUDY_CORRECTION':
      n += await toApplicant('app.correction_requested');
      break;
    case 'STUDY_PREPARATION':
      n += await toApplicant('app.eligible');
      break;
    case 'REJECTED':
      n += await toApplicant('app.rejected');
      break;
    case 'SELECTED':
      n += await toApplicant('app.selected');
      break;
    case 'NOT_SELECTED':
      n += await toApplicant('app.not_selected');
      break;
    case 'FUNDING_SEARCH':
      if (from === 'SELECTED') n += await toApplicant('app.approved');
      if (from === 'FUNDER_REVIEW') n += await toImc('app.funding_declined');
      break;
    case 'NOT_APPROVED':
      n += await toApplicant('app.not_approved');
      break;
    case 'FUNDER_REVIEW':
      n += await dispatchToOrg('app.review_assigned', vars, responsibleOrgId(app), 'funder_reviewer', opts);
      n += await toApplicant('app.funder_referred');
      break;
    case 'IMPLEMENTATION':
      n += await dispatch('app.funding_approved', vars, [...await applicantRecipients(app), ...await imcRecipients()], opts);
      break;
    case 'OPERATING':
      n += await toApplicant('app.operating');
      break;
    case 'CLOSED_NOT_FUNDED': case 'COMPLETED': case 'WITHDRAWN':
      n += await dispatch('app.closed', { ...vars, outcome: to }, [...await applicantRecipients(app), ...await imcRecipients(),
        ...(from === 'FUNDER_REVIEW' ? await orgRecipients(t.payload.funderOrgId as string ?? null, 'funder_reviewer') : [])], opts);
      break;
    default:
      break;
  }
  return n;
}
