import { getDb, nowIso, parseJson } from '../db/sqlite.js';
import { newId, type SqlParam } from '../http/helpers.js';

/** Backoff بالدقائق بين المحاولات (نفس طابور البريد في المنصة الأصلية). */
export const BACKOFF_MIN = [1, 5, 15, 60];
export const MAX_ATTEMPTS = 5;

export type Channel = 'email' | 'sms';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface NotificationInput {
  dedupeKey: string; channel: Channel; templateKey: string; applicationId?: string | null; recipientUserId?: string | null;
  recipientAddress: string; subject: string; body: string; textBody?: string; sensitive?: boolean;
  /** يُحدد عند الإدخال: لا مزود للقناة → skipped ظاهرة للأدمن. */
  skipReason?: string;
}

export interface NotificationRow {
  id: string; dedupeKey: string; channel: Channel; templateKey: string; applicationId: string | null; recipientUserId: string | null;
  recipientAddress: string; subject: string; body: string; textBody: string; sensitive: number; status: NotificationStatus;
  skipReason: string; attempts: number; nextAttemptAt: string; lastError: string; createdAt: string; sentAt: string | null;
}

/** INSERT OR IGNORE على dedupeKey: لا تتكرر الرسالة لنفس الانتقال والمستلم والقناة. */
export function enqueueNotification(m: NotificationInput): boolean {
  const now = nowIso();
  const skipped = Boolean(m.skipReason);
  const r = getDb().prepare(`INSERT OR IGNORE INTO notification_outbox (id, dedupeKey, channel, templateKey, applicationId, recipientUserId,
      recipientAddress, subject, body, textBody, sensitive, status, skipReason, attempts, nextAttemptAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
    newId('ntf'), m.dedupeKey, m.channel, m.templateKey, m.applicationId ?? null, m.recipientUserId ?? null, m.recipientAddress,
    m.subject, skipped && m.sensitive ? '' : m.body, skipped && m.sensitive ? '' : (m.textBody ?? ''), m.sensitive ? 1 : 0,
    skipped ? 'skipped' : 'pending', m.skipReason ?? '', now, now,
  );
  return Number(r.changes) > 0;
}

export function listDueNotifications(nowIso_: string, limit = 20): NotificationRow[] {
  return getDb().prepare("SELECT * FROM notification_outbox WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY nextAttemptAt LIMIT ?")
    .all(nowIso_, limit) as unknown as NotificationRow[];
}

/** حجز الرسالة قبل الإرسال (يمنع إرسالها مرتين لو تداخل عاملان). */
export function claimNotification(id: string): boolean {
  return Number(getDb().prepare("UPDATE notification_outbox SET status = 'sending' WHERE id = ? AND status = 'pending'").run(id).changes) > 0;
}

export function markNotificationSent(id: string): void {
  getDb().prepare(`UPDATE notification_outbox SET status = 'sent', sentAt = ?, attempts = attempts + 1, lastError = '',
    body = CASE WHEN sensitive = 1 THEN '' ELSE body END, textBody = CASE WHEN sensitive = 1 THEN '' ELSE textBody END WHERE id = ?`).run(nowIso(), id);
}

export function markNotificationSkipped(id: string, reason: string): void {
  getDb().prepare(`UPDATE notification_outbox SET status = 'skipped', skipReason = ?,
    body = CASE WHEN sensitive = 1 THEN '' ELSE body END, textBody = CASE WHEN sensitive = 1 THEN '' ELSE textBody END WHERE id = ?`).run(reason, id);
}

export function markNotificationRetry(id: string, err: string, nowMs = Date.now()): NotificationStatus {
  const row = getDb().prepare('SELECT attempts FROM notification_outbox WHERE id = ?').get(id) as { attempts: number } | undefined;
  const attempts = (row?.attempts ?? 0) + 1;
  const failed = attempts >= MAX_ATTEMPTS;
  const next = new Date(nowMs + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000)).toISOString();
  getDb().prepare(`UPDATE notification_outbox SET status = ?, attempts = ?, nextAttemptAt = ?, lastError = ?,
    body = CASE WHEN ? = 1 AND sensitive = 1 THEN '' ELSE body END WHERE id = ?`).run(failed ? 'failed' : 'pending', attempts, next, err.slice(0, 500), failed ? 1 : 0, id);
  return failed ? 'failed' : 'pending';
}

/** إعادة محاولة يدوية من الأدمن لرسالة فاشلة أو متخطاة (إن بقي محتواها). */
export function requeueNotification(id: string): 'requeued' | 'not_found' | 'not_retryable' {
  const r = getDb().prepare('SELECT status, sensitive, body FROM notification_outbox WHERE id = ?').get(id) as { status: string; sensitive: number; body: string } | undefined;
  if (!r) return 'not_found';
  if (!['failed', 'skipped'].includes(r.status) || (r.sensitive === 1 && !r.body)) return 'not_retryable';
  getDb().prepare("UPDATE notification_outbox SET status = 'pending', attempts = 0, skipReason = '', nextAttemptAt = ? WHERE id = ?").run(nowIso(), id);
  return 'requeued';
}

export function listNotifications(f: { status?: string; channel?: string; applicationId?: string }, page: number, pageSize: number) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.status) { where.push('n.status = ?'); params.push(f.status); }
  if (f.channel) { where.push('n.channel = ?'); params.push(f.channel); }
  if (f.applicationId) { where.push('n.applicationId = ?'); params.push(f.applicationId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM notification_outbox n ${w}`).get(...params) as { n: number }).n;
  // لا يُرجع جسم الرسالة أبدًا (قد يحوي روابط تفعيل) — metadata فقط، مع رقم الطلب (M6).
  const rows = db.prepare(`SELECT n.id, n.channel, n.templateKey, n.applicationId, a.number AS applicationNumber, n.recipientUserId, n.recipientAddress, n.subject, n.status, n.skipReason,
      n.attempts, n.nextAttemptAt, n.lastError, n.createdAt, n.sentAt FROM notification_outbox n LEFT JOIN applications a ON a.id = n.applicationId ${w} ORDER BY n.createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  return { total, rows };
}

export function countNotifications(where: { applicationId?: string; templateKey?: string } = {}): number {
  const parts: string[] = [];
  const params: SqlParam[] = [];
  if (where.applicationId) { parts.push('applicationId = ?'); params.push(where.applicationId); }
  if (where.templateKey) { parts.push('templateKey = ?'); params.push(where.templateKey); }
  const w = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM notification_outbox ${w}`).get(...params) as { n: number }).n;
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export type WebhookStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped';

export interface WebhookRow {
  id: string; eventId: string; eventType: string; transitionId: string | null; payload: string; status: WebhookStatus; attempts: number;
  nextAttemptAt: string; lastStatusCode: number | null; lastError: string; createdAt: string; deliveredAt: string | null;
}

export function enqueueWebhook(eventId: string, eventType: string, transitionId: string | null, payload: unknown, skipped: boolean): void {
  const now = nowIso();
  getDb().prepare(`INSERT OR IGNORE INTO webhook_outbox (id, eventId, eventType, transitionId, payload, status, attempts, nextAttemptAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(newId('whk'), eventId, eventType, transitionId, JSON.stringify(payload), skipped ? 'skipped' : 'pending', now, now);
}

export function listDueWebhooks(nowIso_: string, limit = 20): WebhookRow[] {
  return getDb().prepare("SELECT * FROM webhook_outbox WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY createdAt LIMIT ?").all(nowIso_, limit) as unknown as WebhookRow[];
}

export function claimWebhook(id: string): boolean {
  return Number(getDb().prepare("UPDATE webhook_outbox SET status = 'sending' WHERE id = ? AND status = 'pending'").run(id).changes) > 0;
}

export function markWebhookDelivered(id: string, statusCode: number): void {
  getDb().prepare("UPDATE webhook_outbox SET status = 'delivered', attempts = attempts + 1, lastStatusCode = ?, lastError = '', deliveredAt = ? WHERE id = ?").run(statusCode, nowIso(), id);
}

export function markWebhookRetry(id: string, statusCode: number | null, err: string, nowMs = Date.now()): WebhookStatus {
  const row = getDb().prepare('SELECT attempts FROM webhook_outbox WHERE id = ?').get(id) as { attempts: number } | undefined;
  const attempts = (row?.attempts ?? 0) + 1;
  const failed = attempts >= MAX_ATTEMPTS;
  const next = new Date(nowMs + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000).toISOString();
  getDb().prepare('UPDATE webhook_outbox SET status = ?, attempts = ?, nextAttemptAt = ?, lastStatusCode = ?, lastError = ? WHERE id = ?')
    .run(failed ? 'failed' : 'pending', attempts, next, statusCode, err.slice(0, 500), id);
  return failed ? 'failed' : 'pending';
}

export function requeueWebhook(id: string): 'requeued' | 'not_found' | 'not_retryable' {
  const r = getDb().prepare('SELECT status FROM webhook_outbox WHERE id = ?').get(id) as { status: string } | undefined;
  if (!r) return 'not_found';
  if (!['failed', 'skipped'].includes(r.status)) return 'not_retryable';
  getDb().prepare("UPDATE webhook_outbox SET status = 'pending', attempts = 0, nextAttemptAt = ? WHERE id = ?").run(nowIso(), id);
  return 'requeued';
}

export function listWebhooks(f: { status?: string }, page: number, pageSize: number) {
  const w = f.status ? 'WHERE status = ?' : '';
  const params: SqlParam[] = f.status ? [f.status] : [];
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM webhook_outbox ${w}`).get(...params) as { n: number }).n;
  const rows = (db.prepare(`SELECT * FROM webhook_outbox ${w} ORDER BY createdAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as unknown as WebhookRow[])
    .map((r) => ({ ...r, payload: parseJson(r.payload, {}) }));
  return { total, rows };
}
