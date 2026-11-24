/**
 * Queues already-rendered messages into the platform outbox (+ the in-app inbox). Called inside the business transaction;
 * delivery happens later in the worker. Every initiative's own `dispatch` renders with its templates and calls this with
 * its initiativeId; the core uses `dispatchCore` with the platform templates.
 */
import { isMailConfigured } from '../mail/mailer.js';
import { getSmsAdapter } from '../integrations/sms/index.js';
import { enqueueNotification, type Channel } from '../store/outbox.js';
import { insertUserNotification } from '../store/userNotifications.js';
import { renderCoreTemplate, type CoreTemplateKey, type CoreTemplateVars, type Rendered } from './templates.js';
import { composeDecisionTexts, type DecisionReason } from './decisionText.js';
import { config } from '../../config.js';

export interface Recipient { userId?: string | null; email?: string; phone?: string }

export interface DispatchOpts {
  initiativeId: string | null;
  templateKey: string;
  dedupePrefix: string;
  applicationId?: string | null;
  /** Messages with links/tokens: never stored in the inbox, body erased after sending. */
  sensitive?: boolean;
  channels?: Channel[];
  /** In-app link (hash route relative to the initiative's own screens, or a platform route when initiativeId is null). */
  inboxLink?: string;
  /**
   * D10: the reason of a negative decision. In-app gets the decision + the full reason; the SMS gets the decision, the reason
   * cut to fit two segments and `smsLink` (default: the platform address). The e-mail is rendered by the template as before.
   */
  reason?: DecisionReason;
  smsLink?: string;
}

export async function dispatchRendered(rendered: Rendered, recipients: Recipient[], opts: DispatchOpts): Promise<number> {
  const channels = opts.channels ?? ['email', 'sms'];
  const mailOk = isMailConfigured();
  const smsOk = getSmsAdapter() !== null;
  const seen = new Set<string>();
  const inboxSeen = new Set<string>();
  const texts = opts.reason?.text?.trim()
    ? composeDecisionTexts(rendered.sms, opts.reason, opts.smsLink ?? config.appUrl)
    : { inbox: rendered.sms, sms: rendered.sms };
  let n = 0;
  for (const r of recipients) {
    if (r.userId && !opts.sensitive && !inboxSeen.has(r.userId)) {
      inboxSeen.add(r.userId);
      await insertUserNotification({
        initiativeId: opts.initiativeId, userId: r.userId, applicationId: opts.applicationId ?? null, templateKey: opts.templateKey,
        title: rendered.subject, body: texts.inbox, link: opts.inboxLink ?? '', dedupeKey: `${opts.dedupePrefix}:${opts.templateKey}:inbox:${r.userId}`,
      });
    }
    for (const ch of channels) {
      const address = ch === 'email' ? r.email?.trim().toLowerCase() : r.phone?.replace(/\s+/g, '');
      if (!address || seen.has(`${ch}:${address}`)) continue;
      seen.add(`${ch}:${address}`);
      const inserted = await enqueueNotification({
        initiativeId: opts.initiativeId,
        dedupeKey: `${opts.dedupePrefix}:${opts.templateKey}:${ch}:${address}`,
        channel: ch, templateKey: opts.templateKey, applicationId: opts.applicationId ?? null, recipientUserId: r.userId ?? null,
        recipientAddress: address,
        subject: ch === 'email' ? rendered.subject : '',
        // The SMS text is stored even when no provider is configured (status `skipped`), so the outbox shows what would be sent.
        body: ch === 'email' ? rendered.html : texts.sms,
        textBody: ch === 'email' ? rendered.text : '',
        sensitive: opts.sensitive,
        skipReason: ch === 'email' ? (mailOk ? undefined : 'mail_not_configured') : (smsOk ? undefined : 'sms_provider_not_configured'),
      });
      if (inserted) n++;
    }
  }
  return n;
}

/** Platform account messages (verification, reset, setup…) in the platform layout. */
export function dispatchCore(
  key: CoreTemplateKey, vars: CoreTemplateVars, recipients: Recipient[],
  opts: { dedupePrefix: string; sensitive?: boolean; channels?: Channel[]; inboxLink?: string },
): Promise<number> {
  return dispatchRendered(renderCoreTemplate(key, vars), recipients, { ...opts, initiativeId: null, templateKey: key });
}
