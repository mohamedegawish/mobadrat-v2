/**
 * Outbox sender (e-mail + SMS) with retries — one worker for the whole platform. Decisions never wait for delivery.
 * Inline images (initiative logos, provider logos) are resolved at send time by the resolvers the modules register
 * (core/mail/mailer.ts registerCidResolver).
 */
import { config } from '../../config.js';
import { nowIso, outsideTx } from '../db/index.js';
import { sendMail, isMailConfigured } from '../mail/mailer.js';
import { getSmsAdapter } from '../integrations/sms/index.js';
import { trackJob } from './inflight.js';
import {
  claimNotification, listDueNotifications, markNotificationRetry, markNotificationSent, markNotificationSkipped, reclaimStaleSending,
} from '../store/outbox.js';

export interface ProcessResult { sent: number; skipped: number; retried: number; failed: number }

let timer: NodeJS.Timeout | null = null;
let running = false;
let again = false;

export async function processNotifications(limit = 25): Promise<ProcessResult> {
  const out: ProcessResult = { sent: 0, skipped: 0, retried: 0, failed: 0 };
  await reclaimStaleSending('notification_outbox');
  for (const m of await listDueNotifications(nowIso(), limit)) {
    if (!await claimNotification(m.id)) continue;
    try {
      if (m.channel === 'email') {
        if (!isMailConfigured()) { await markNotificationSkipped(m.id, 'mail_not_configured'); out.skipped++; continue; }
        const r = await sendMail({ to: [m.recipientAddress], subject: m.subject, html: m.body, text: m.textBody });
        if (r === 'skipped') { await markNotificationSkipped(m.id, 'not_delivered_outside_production'); out.skipped++; continue; }
      } else {
        const sms = getSmsAdapter();
        if (!sms) { await markNotificationSkipped(m.id, 'sms_provider_not_configured'); out.skipped++; continue; }
        await sms.send(m.recipientAddress, m.body);
      }
      await markNotificationSent(m.id);
      out.sent++;
    } catch (e) {
      const st = await markNotificationRetry(m.id, (e as Error)?.message ?? 'send failed');
      if (st === 'failed') out.failed++; else out.retried++;
    }
  }
  return out;
}

function tick(): Promise<void> {
  return trackJob(tickNow());
}

async function tickNow(): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  try {
    do { again = false; await processNotifications(); } while (again);
  } catch (e) {
    console.error('[notifications] worker error:', (e as Error).message);
  } finally {
    running = false;
  }
}

/** Wakes the worker right after messages were queued (does not wait for the next round). */
export function kickNotificationWorker(): void {
  // Often called from inside a transaction: the tick must run on its own, after that transaction, never as part of it.
  if (timer) outsideTx(() => setImmediate(() => { void tick(); }));
}

export function startNotificationWorker(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, config.notificationSweepMs);
  timer.unref();
  void tick();
}

export function stopNotificationWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
