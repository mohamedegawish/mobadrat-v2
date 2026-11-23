/**
 * عامل الـwebhooks للمنصة الأصلية: application.state_changed موقّع بـ HMAC-SHA256.
 * نفس eventId في كل إعادة محاولة (المستقبِل يمنع التكرار)، ولا يُعاد إرسال ما سُلِّم.
 */
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { nowIso } from '../db/database.js';
import { claimWebhook, listDueWebhooks, markWebhookDelivered, markWebhookRetry } from '../store/outbox.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export async function processWebhooks(limit = 20): Promise<{ delivered: number; retried: number; failed: number }> {
  const out = { delivered: 0, retried: 0, failed: 0 };
  if (!config.platformWebhookUrl || !config.platformWebhookSecret) return out;
  for (const w of await listDueWebhooks(nowIso(), limit)) {
    if (!await claimWebhook(w.id)) continue;
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const res = await fetch(config.platformWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sona3-Event-Id': w.eventId,
          'X-Sona3-Event-Type': w.eventType,
          'X-Sona3-Timestamp': timestamp,
          'X-Sona3-Signature': signWebhook(config.platformWebhookSecret, timestamp, w.payload),
        },
        body: w.payload,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) { await markWebhookDelivered(w.id, res.status); out.delivered++; }
      else if (await markWebhookRetry(w.id, res.status, `HTTP ${res.status}`) === 'failed') out.failed++;
      else out.retried++;
    } catch (e) {
      if (await markWebhookRetry(w.id, null, (e as Error).message ?? 'network error') === 'failed') out.failed++;
      else out.retried++;
    }
  }
  return out;
}

export function startWebhookWorker(): void {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await processWebhooks(); } catch (e) { console.error('[webhooks] worker error:', (e as Error).message); } finally { running = false; }
  }, config.notificationSweepMs);
  timer.unref();
}

export function stopWebhookWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
