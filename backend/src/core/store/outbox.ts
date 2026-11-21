import { getDb, nowIso } from '../db/index.js';
import { newId, type SqlParam } from '../http/helpers.js';

/** Backoff بالدقائق بين المحاولات (نفس طابور البريد في المنصة الأصلية). */
export const BACKOFF_MIN = [1, 5, 15, 60];
export const MAX_ATTEMPTS = 5;

export type Channel = 'email' | 'sms';
export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface NotificationInput {
  /** The initiative module that produced the message (null = platform core). */
  initiativeId?: string | null;
  dedupeKey: string; channel: Channel; templateKey: string; applicationId?: string | null; recipientUserId?: string | null;
  recipientAddress: string; subject: string; body: string; textBody?: string; sensitive?: boolean;
  /** يُحدد عند الإدخال: لا مزود للقناة → skipped ظاهرة للأدمن. */
  skipReason?: string;
}

export interface NotificationRow {
  id: string; initiativeId: string | null; dedupeKey: string; channel: Channel; templateKey: string; applicationId: string | null; recipientUserId: string | null;
  recipientAddress: string; subject: string; body: string; textBody: string; sensitive: number; status: NotificationStatus;
  skipReason: string; attempts: number; nextAttemptAt: string; lastError: string; createdAt: string; sentAt: string | null;
}

/** INSERT OR IGNORE على dedupeKey: لا تتكرر الرسالة لنفس الانتقال والمستلم والقناة. */
export async function enqueueNotification(m: NotificationInput): Promise<boolean> {
  const now = nowIso();
  const skipped = Boolean(m.skipReason);
  const r = await getDb().prepare(`INSERT OR IGNORE INTO notification_outbox (id, initiativeId, dedupeKey, channel, templateKey, applicationId, recipientUserId,
      recipientAddress, subject, body, textBody, \`sensitive\`, status, skipReason, attempts, nextAttemptAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
    newId('ntf'), m.initiativeId ?? null, m.dedupeKey, m.channel, m.templateKey, m.applicationId ?? null, m.recipientUserId ?? null, m.recipientAddress,
    m.subject, skipped && m.sensitive ? '' : m.body, skipped && m.sensitive ? '' : (m.textBody ?? ''), m.sensitive ? 1 : 0,
    skipped ? 'skipped' : 'pending', m.skipReason ?? '', now, now,
  );
  return Number(r.changes) > 0;
}

export async function listDueNotifications(nowIso_: string, limit = 20): Promise<NotificationRow[]> {
  return await getDb().prepare("SELECT * FROM notification_outbox WHERE status = 'pending' AND nextAttemptAt <= ? ORDER BY nextAttemptAt LIMIT ?")
    .all(nowIso_, limit) as unknown as NotificationRow[];
}

/**
 * L4: ما بقي في `sending` أكثر من staleAfterMs (توقف العملية أثناء الإرسال) يعود إلى `pending`.
 * التسليم «مرة على الأقل»: في أسوأ الأحوال تصل رسالة مكررة بدل أن تضيع رسالة (dedupeKey يمنع التكرار عند الإنشاء فقط).
 */
export async function reclaimStaleSending(table: 'notification_outbox' | 'webhook_outbox', staleAfterMs = 10 * 60_000, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - staleAfterMs).toISOString();
  return Number((await getDb().prepare(`UPDATE ${table} SET status = 'pending' WHERE status = 'sending' AND (claimedAt IS NULL OR claimedAt < ?)`).run(cutoff)).changes);
}

/** حجز الرسالة قبل الإرسال (يمنع إرسالها مرتين لو تداخل عاملان). */
export async function claimNotification(id: string): Promise<boolean> {
  return Number((await getDb().prepare("UPDATE notification_outbox SET status = 'sending', claimedAt = ? WHERE id = ? AND status = 'pending'").run(nowIso(), id)).changes) > 0;
}

export async function markNotificationSent(id: string): Promise<void> {
  await getDb().prepare(`UPDATE notification_outbox SET status = 'sent', sentAt = ?, attempts = attempts + 1, lastError = '',
    body = CASE WHEN \`sensitive\` = 1 THEN '' ELSE body END, textBody = CASE WHEN \`sensitive\` = 1 THEN '' ELSE textBody END WHERE id = ?`).run(nowIso(), id);
}

export async function markNotificationSkipped(id: string, reason: string): Promise<void> {
  await getDb().prepare(`UPDATE notification_outbox SET status = 'skipped', skipReason = ?,
    body = CASE WHEN \`sensitive\` = 1 THEN '' ELSE body END, textBody = CASE WHEN \`sensitive\` = 1 THEN '' ELSE textBody END WHERE id = ?`).run(reason, id);
}

export async function markNotificationRetry(id: string, err: string, nowMs = Date.now()): Promise<NotificationStatus> {
  const row = await getDb().prepare('SELECT attempts FROM notification_outbox WHERE id = ?').get(id) as { attempts: number } | undefined;
  const attempts = (row?.attempts ?? 0) + 1;
  const failed = attempts >= MAX_ATTEMPTS;
  const next = new Date(nowMs + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000)).toISOString();
  await getDb().prepare(`UPDATE notification_outbox SET status = ?, attempts = ?, nextAttemptAt = ?, lastError = ?,
    body = CASE WHEN ? = 1 AND \`sensitive\` = 1 THEN '' ELSE body END WHERE id = ?`).run(failed ? 'failed' : 'pending', attempts, next, err.slice(0, 500), failed ? 1 : 0, id);
  return failed ? 'failed' : 'pending';
}

/** إعادة محاولة يدوية من الأدمن لرسالة فاشلة أو متخطاة (إن بقي محتواها). */
export async function requeueNotification(id: string): Promise<'requeued' | 'not_found' | 'not_retryable'> {
  const r = await getDb().prepare('SELECT status, `sensitive`, body FROM notification_outbox WHERE id = ?').get(id) as { status: string; sensitive: number; body: string } | undefined;
  if (!r) return 'not_found';
  if (!['failed', 'skipped'].includes(r.status) || (r.sensitive === 1 && !r.body)) return 'not_retryable';
  await getDb().prepare("UPDATE notification_outbox SET status = 'pending', attempts = 0, skipReason = '', nextAttemptAt = ? WHERE id = ?").run(nowIso(), id);
  return 'requeued';
}

/**
 * Admin list (metadata only — never the body). `appTable` = the initiative's applications table, joined for the application
 * number (module admin screens); omitted for the platform-wide list.
 */
export async function listNotifications(f: { status?: string; channel?: string; applicationId?: string; initiativeId?: string }, page: number, pageSize: number, appTable?: string) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.initiativeId) { where.push('n.initiativeId = ?'); params.push(f.initiativeId); }
  if (f.status) { where.push('n.status = ?'); params.push(f.status); }
  if (f.channel) { where.push('n.channel = ?'); params.push(f.channel); }
  if (f.applicationId) { where.push('n.applicationId = ?'); params.push(f.applicationId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = Number((await db.prepare(`SELECT COUNT(*) AS n FROM notification_outbox n ${w}`).get(...params) as { n: number }).n);
  // لا يُرجع جسم الرسالة أبدًا (قد يحوي روابط تفعيل) — metadata فقط، مع رقم الطلب (M6).
  if (appTable && !/^[a-z0-9_]+$/.test(appTable)) throw new Error('invalid table');
  const num = appTable ? 'a.number' : 'NULL';
  const join = appTable ? `LEFT JOIN ${appTable} a ON a.id = n.applicationId` : '';
  const rows = await db.prepare(`SELECT n.id, n.initiativeId, n.channel, n.templateKey, n.applicationId, ${num} AS applicationNumber, n.recipientUserId, n.recipientAddress, n.subject, n.status, n.skipReason,
      n.attempts, n.nextAttemptAt, n.lastError, n.createdAt, n.sentAt FROM notification_outbox n ${join} ${w} ORDER BY n.createdAt DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize);
  return { total, rows };
}

export async function countNotifications(where: { applicationId?: string; templateKey?: string; initiativeId?: string } = {}): Promise<number> {
  const parts: string[] = [];
  const params: SqlParam[] = [];
  if (where.initiativeId) { parts.push('initiativeId = ?'); params.push(where.initiativeId); }
  if (where.applicationId) { parts.push('applicationId = ?'); params.push(where.applicationId); }
  if (where.templateKey) { parts.push('templateKey = ?'); params.push(where.templateKey); }
  const w = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  return (await getDb().prepare(`SELECT COUNT(*) AS n FROM notification_outbox ${w}`).get(...params) as { n: number }).n;
}

