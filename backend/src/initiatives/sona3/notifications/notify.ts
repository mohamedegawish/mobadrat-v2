/**
 * إدخال الإشعارات في outbox — يُستدعى داخل معاملة الانتقال، والإرسال الفعلي بالعامل لاحقًا (القرار لا ينتظر الإرسال).
 */
import { isMailConfigured } from '../mail/mailer.js';
import { getSmsAdapter } from '../integrations/sms/index.js';
import { enqueueNotification, type Channel } from '../store/outbox.js';
import { activeUsersOf } from '../store/users.js';
import type { AppRow, TransitionRow } from '../store/applications.js';
import { getOrganization } from '../store/organizations.js';
import { renderTemplate, type TemplateKey, type TemplateVars } from './templates.js';
import { ORG_IDS, type Role } from '../domain.js';
import { STATE_LABELS, responsibleOrgId, type ApplicationState, type TransitionDef } from '../workflow/workflow.js';

export interface Recipient { userId?: string | null; email?: string; phone?: string }

export function dispatch(
  key: TemplateKey, vars: TemplateVars, recipients: Recipient[],
  opts: { dedupePrefix: string; applicationId?: string | null; sensitive?: boolean; channels?: Channel[] },
): number {
  const rendered = renderTemplate(key, vars);
  const channels = opts.channels ?? ['email', 'sms'];
  const mailOk = isMailConfigured();
  const smsOk = getSmsAdapter() !== null;
  const seen = new Set<string>();
  let n = 0;
  for (const r of recipients) {
    for (const ch of channels) {
      const address = ch === 'email' ? r.email?.trim().toLowerCase() : r.phone?.replace(/\s+/g, '');
      if (!address || seen.has(`${ch}:${address}`)) continue;
      seen.add(`${ch}:${address}`);
      const inserted = enqueueNotification({
        dedupeKey: `${opts.dedupePrefix}:${key}:${ch}:${address}`,
        channel: ch, templateKey: key, applicationId: opts.applicationId ?? null, recipientUserId: r.userId ?? null,
        recipientAddress: address,
        subject: ch === 'email' ? rendered.subject : '',
        body: ch === 'email' ? rendered.html : rendered.sms,
        textBody: ch === 'email' ? rendered.text : '',
        sensitive: opts.sensitive,
        skipReason: ch === 'email' ? (mailOk ? undefined : 'mail_not_configured') : (smsOk ? undefined : 'sms_provider_not_configured'),
      });
      if (inserted) n++;
    }
  }
  return n;
}

/** مستلمو المتقدم: مستخدموه النشطون ذوو البريد المفعّل فقط. */
export function applicantRecipients(app: AppRow): Recipient[] {
  return activeUsersOf(app.applicantOrgId, 'applicant')
    .filter((u) => u.emailVerifiedAt)
    .map((u) => ({ userId: u.id, email: u.email, phone: u.phone || undefined }));
}

export function orgRecipients(orgId: string | null, role?: Role): Recipient[] {
  if (!orgId) return [];
  return activeUsersOf(orgId, role).map((u) => ({ userId: u.id, email: u.email, phone: u.phone || undefined }));
}

export function imcRecipients(): Recipient[] {
  return orgRecipients(ORG_IDS.imc, 'imc_officer');
}

/** مستلمو التنبيهات التشغيلية: IMC + الأدمن. */
export function opsRecipients(): Recipient[] {
  return [...imcRecipients(), ...orgRecipients(ORG_IDS.admin, 'system_admin')];
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
export function dispatchToOrg(key: TemplateKey, vars: TemplateVars, orgId: string | null, role: Role | undefined, opts: { dedupePrefix: string; applicationId: string }): number {
  const recipients = orgRecipients(orgId, role);
  if (recipients.length) return dispatch(key, vars, recipients, opts);
  const org = orgId ? getOrganization(orgId) : null;
  return dispatch('ops.no_recipients', { ...vars, orgNameAr: org?.nameAr ?? 'جهة غير محددة' }, opsRecipients(), opts);
}

/** يحدد الأحداث والمستلمين لكل انتقال. */
export function notifyTransition(ctx: TransitionNotifyCtx): number {
  const { app, transition: t } = ctx;
  const from = t.fromState;
  const to = t.toState;
  const vars: TemplateVars = { ...baseVars(app, to), reason: ctx.reason, deficiencies: ctx.deficiencies, funderNameAr: ctx.funderNameAr, amount: ctx.amount, modelAr: ctx.modelAr };
  const opts = { dedupePrefix: t.id, applicationId: app.id };
  const toApplicant = (key: TemplateKey) => dispatch(key, vars, applicantRecipients(app), opts);
  const toImc = (key: TemplateKey) => dispatchToOrg(key, vars, ORG_IDS.imc, 'imc_officer', opts);
  let n = 0;

  switch (to) {
    case 'ELIGIBILITY_REVIEW':
      n += toImc(t.action === 'submit' ? 'app.review_assigned' : 'app.resubmitted');
      if (t.action === 'submit') n += toApplicant('app.submitted');
      break;
    case 'STUDY_REVIEW':
      n += toImc(t.action === 'submit_study' ? 'app.review_assigned' : 'app.resubmitted');
      break;
    case 'ELIGIBILITY_CORRECTION':
    case 'STUDY_CORRECTION':
      n += toApplicant('app.correction_requested');
      break;
    case 'STUDY_PREPARATION':
      n += toApplicant('app.eligible');
      break;
    case 'REJECTED':
      n += toApplicant('app.rejected');
      break;
    case 'SELECTED':
      n += toApplicant('app.selected');
      break;
    case 'NOT_SELECTED':
      n += toApplicant('app.not_selected');
      break;
    case 'FUNDING_SEARCH':
      if (from === 'SELECTED') n += toApplicant('app.approved');
      if (from === 'FUNDER_REVIEW') n += toImc('app.funding_declined');
      break;
    case 'NOT_APPROVED':
      n += toApplicant('app.not_approved');
      break;
    case 'FUNDER_REVIEW':
      n += dispatchToOrg('app.review_assigned', vars, responsibleOrgId(app), 'funder_reviewer', opts);
      n += toApplicant('app.funder_referred');
      break;
    case 'IMPLEMENTATION':
      n += dispatch('app.funding_approved', vars, [...applicantRecipients(app), ...imcRecipients()], opts);
      break;
    case 'OPERATING':
      n += toApplicant('app.operating');
      break;
    case 'CLOSED_NOT_FUNDED': case 'COMPLETED': case 'WITHDRAWN':
      n += dispatch('app.closed', { ...vars, outcome: to }, [...applicantRecipients(app), ...imcRecipients(),
        ...(from === 'FUNDER_REVIEW' ? orgRecipients(t.payload.funderOrgId as string ?? null, 'funder_reviewer') : [])], opts);
      break;
    default:
      break;
  }
  return n;
}
