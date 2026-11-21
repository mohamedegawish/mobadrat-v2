/** عامل إرسال الإشعارات من outbox (بريد + SMS) مع إعادة محاولة. القرار نفسه لا ينتظر الإرسال. */
import { config } from '../config.js';
import { nowIso } from '../db/sqlite.js';
import { sendMail, isMailConfigured } from '../mail/mailer.js';
import { getSmsAdapter } from '../integrations/sms/index.js';
import {
  claimNotification, listDueNotifications, markNotificationRetry, markNotificationSent, markNotificationSkipped,
} from '../store/outbox.js';

export interface ProcessResult { sent: number; skipped: number; retried: number; failed: number }

let timer: NodeJS.Timeout | null = null;
let running = false;
let again = false;

export async function processNotifications(limit = 25): Promise<ProcessResult> {
  const out: ProcessResult = { sent: 0, skipped: 0, retried: 0, failed: 0 };
  for (const m of listDueNotifications(nowIso(), limit)) {
    if (!claimNotification(m.id)) continue;
    try {
      if (m.channel === 'email') {
        if (!isMailConfigured()) { markNotificationSkipped(m.id, 'mail_not_configured'); out.skipped++; continue; }
        const r = await sendMail({ to: [m.recipientAddress], subject: m.subject, html: m.body, text: m.textBody });
        if (r === 'skipped') { markNotificationSkipped(m.id, 'not_delivered_outside_production'); out.skipped++; continue; }
      } else {
        const sms = getSmsAdapter();
        if (!sms) { markNotificationSkipped(m.id, 'sms_provider_not_configured'); out.skipped++; continue; }
        await sms.send(m.recipientAddress, m.body);
      }
      markNotificationSent(m.id);
      out.sent++;
    } catch (e) {
      const st = markNotificationRetry(m.id, (e as Error)?.message ?? 'send failed');
      if (st === 'failed') out.failed++; else out.retried++;
    }
  }
  return out;
}

async function tick(): Promise<void> {
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

/** يوقظ العامل فورًا بعد إدخال رسائل (لا ينتظر الدورة التالية). */
export function kickNotificationWorker(): void {
  if (timer) setImmediate(() => { void tick(); });
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
