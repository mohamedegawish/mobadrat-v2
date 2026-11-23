/**
 * Notifications go to the platform outbox (tagged with this initiative); webhooks stay in the module's own outbox.
 */
import { getDb, nowIso, parseJson } from '../db/database.js';
import { newId, type SqlParam } from '../http/helpers.js';
import * as core from '../../../core/store/outbox.js';
import { MODULE_ID } from '../config.js';

export { BACKOFF_MIN, MAX_ATTEMPTS, claimNotification, listDueNotifications, markNotificationRetry, markNotificationSent, markNotificationSkipped } from '../../../core/store/outbox.js';
export type { Channel, NotificationStatus, NotificationRow } from '../../../core/store/outbox.js';
import { BACKOFF_MIN, MAX_ATTEMPTS } from '../../../core/store/outbox.js';

export type NotificationInput = Omit<core.NotificationInput, 'initiativeId'>;

export async function enqueueNotification(m: NotificationInput): Promise<boolean> {
  return await core.enqueueNotification({ ...m, initiativeId: MODULE_ID });
}

/** Stale `sending` rows go back to `pending` (the platform outbox, or this module's webhook outbox). */
export async function reclaimStaleSending(table: 'notification_outbox' | 'webhook_outbox', staleAfterMs = 10 * 60_000, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - staleAfterMs).toISOString();
  const sql = table === 'notification_outbox'
    ? "UPDATE notification_outbox SET status = 'pending' WHERE status = 'sending' AND (claimedAt IS NULL OR claimedAt < ?)"
    : "UPDATE sona3_webhook_outbox SET status = 'pending' WHERE status = 'sending' AND (claimedAt IS NULL OR claimedAt < ?)";
  return Number((await getDb().prepare(sql).run(cutoff)).changes);
}

/** Admin re-queue of one of THIS initiative's messages. */
export async function requeueNotification(id: string): Promise<'requeued' | 'not_found' | 'not_retryable'> {
  const own = await getDb().prepare('SELECT 1 FROM notification_outbox WHERE id = ? AND initiativeId = ?').get(id, MODULE_ID);
  if (!own) return 'not_found';
  return core.requeueNotification(id);
}

export async function listNotifications(f: { status?: string; channel?: string; applicationId?: string }, page: number, pageSize: number) {
  return await core.listNotifications({ ...f, initiativeId: MODULE_ID }, page, pageSize, `${MODULE_ID}_applications`);
}

export async function countNotifications(where: { applicationId?: string; templateKey?: string } = {}): Promise<number> {
  return await core.countNotifications({ ...where, initiativeId: MODULE_ID });
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export type WebhookStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped';

export interface WebhookRow {
  id: string; eventId: string; eventType: string; transitionId: string | null; payload: string; status: WebhookStatus; attempts: number;
  nextAttemptAt: string; lastStatusCode: number | null; lastError: string; createdAt: string; deliveredAt: string | null;
}

export async function enqueueWebhook(eventId: string, eventType: string, transitionId: string | null, payload: unknown, skipped: boolean): Promise<void> {
  const now = nowIso();
  await getDb().prepare(`INSERT OR IGNORE INTO sona3_webhook_outbox (id, eventId, eventType, transitionId, payload, status, attempts, nextAttemptAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(newId('whk'), eventId, eventType, transitionId, JSON.stringify(payload), skipped ? 'skipped' : 'pending', now, now);
}

export async function listDueWebhooks(nowIso_: string, limit = 20): Promise<WebhookRow[]> {
  return await getDb().prepare("SELECT * FROM sona3_webhook_outbox WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY createdAt LIMIT ?").all(nowIso_, limit) as unknown as WebhookRow[];
}

export async function claimWebhook(id: string): Promise<boolean> {
  return Number((await getDb().prepare("UPDATE sona3_webhook_outbox SET status = 'sending' WHERE id = ? AND status = 'pending'").run(id)).changes) > 0;
}

export async function markWebhookDelivered(id: string, statusCode: number): Promise<void> {
  await getDb().prepare("UPDATE sona3_webhook_outbox SET status = 'delivered', attempts = attempts + 1, lastStatusCode = ?, lastError = '', deliveredAt = ? WHERE id = ?").run(statusCode, nowIso(), id);
}

export async function markWebhookRetry(id: string, statusCode: number | null, err: string, nowMs = Date.now()): Promise<WebhookStatus> {
  const row = await getDb().prepare('SELECT attempts FROM sona3_webhook_outbox WHERE id = ?').get(id) as { attempts: number } | undefined;
  const attempts = (row?.attempts ?? 0) + 1;
  const failed = attempts >= MAX_ATTEMPTS;
  const next = new Date(nowMs + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000).toISOString();
  await getDb().prepare('UPDATE sona3_webhook_outbox SET status = ?, attempts = ?, nextAttemptAt = ?, lastStatusCode = ?, lastError = ? WHERE id = ?')
    .run(failed ? 'failed' : 'pending', attempts, next, statusCode, err.slice(0, 500), id);
  return failed ? 'failed' : 'pending';
}

export async function requeueWebhook(id: string): Promise<'requeued' | 'not_found' | 'not_retryable'> {
  const r = await getDb().prepare('SELECT status FROM sona3_webhook_outbox WHERE id = ?').get(id) as { status: string } | undefined;
  if (!r) return 'not_found';
  if (!['failed', 'skipped'].includes(r.status)) return 'not_retryable';
  await getDb().prepare("UPDATE sona3_webhook_outbox SET status = 'pending', attempts = 0, nextAttemptAt = ? WHERE id = ?").run(nowIso(), id);
  return 'requeued';
}

export async function listWebhooks(f: { status?: string }, page: number, pageSize: number) {
  const w = f.status ? 'WHERE status = ?' : '';
  const params: SqlParam[] = f.status ? [f.status] : [];
  const db = getDb();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM sona3_webhook_outbox ${w}`).get(...params) as { n: number }).n;
  const rows = (await db.prepare(`SELECT * FROM sona3_webhook_outbox ${w} ORDER BY createdAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as unknown as WebhookRow[])
    .map((r) => ({ ...r, payload: parseJson(r.payload, {}) }));
  return { total, rows };
}
