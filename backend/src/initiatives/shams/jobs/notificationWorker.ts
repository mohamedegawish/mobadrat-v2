/** عامل إرسال الإشعارات من outbox (بريد + SMS) مع إعادة محاولة. القرار نفسه لا ينتظر الإرسال. */
import { config } from '../config.js';
import { nowIso, outsideTx } from '../db/sqlite.js';
import { sendMail, isMailConfigured } from '../mail/mailer.js';
import { getSmsAdapter } from '../integrations/sms/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from '../store/providers.js';
import { logoPath } from '../http/upload.js';
import { LOGO_CID_PREFIX } from '../notifications/templates.js';
import type { MailAttachment } from '../mail/mailer.js';
import { trackJob } from './inflight.js';

/** شعارات مقدمي الخدمة المضمنة في الرسالة: تُقرأ من التخزين عند الإرسال (الرسالة المخزنة تحمل cid فقط). */
async function providerLogoAttachments(html: string): Promise<MailAttachment[]> {
  const ids = new Set([...html.matchAll(new RegExp(`cid:${LOGO_CID_PREFIX}([A-Za-z0-9_-]+)`, 'g'))].map((m) => m[1]));
  const out: MailAttachment[] = [];
  for (const id of ids) {
    const p = await getProvider(id);
    if (!p?.logoStoredName) continue;
    const file = logoPath(p.logoStoredName);
    if (!fs.existsSync(file)) continue;
    out.push({ filename: `logo-${id}${path.extname(p.logoStoredName)}`, path: file, cid: `${LOGO_CID_PREFIX}${id}` });
  }
  return out;
}
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
        const r = await sendMail({ to: [m.recipientAddress], subject: m.subject, html: m.body, text: m.textBody, attachments: await providerLogoAttachments(m.body) });
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

/** يوقظ العامل فورًا بعد إدخال رسائل (لا ينتظر الدورة التالية). */
export function kickNotificationWorker(): void {
  // Often called from inside a transaction (right after the outbox rows are written): the tick must run on its own,
  // after that transaction, never as part of it.
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
