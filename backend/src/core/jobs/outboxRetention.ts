/**
 * PA-05 (2026-11-06 audit): optional retention for notification_outbox. Every e-mail/SMS is kept with its body forever, so
 * the table only grows (169 k rows, ~600 MB after the load tests). OFF unless NOTIFICATION_OUTBOX_RETENTION_DAYS is set to a
 * positive number of days. When on, it deletes only FINISHED messages (sent, skipped, failed) created before the cutoff —
 * never pending or sending ones — in small batches, each in its own short transaction (the MySQL write lock is global).
 * Note: a deleted failed/skipped message can no longer be re-queued by an admin (store/outbox.ts requeueNotification).
 * One audit row per sweep that removed anything.
 */
import { config } from '../../config.js';
import { getDb, tx, withJobLock } from '../db/index.js';
import { addAuditLog } from '../store/audit.js';
import { trackJob } from './inflight.js';

const FINISHED = "('sent','skipped','failed')";
let timer: NodeJS.Timeout | null = null;
let first: NodeJS.Timeout | null = null;

/** Deletes finished outbox rows older than `retentionDays`; returns how many. 0 / negative days = disabled (returns 0). */
export async function purgeOutbox(retentionDays: number, now = Date.now(), batch = 500): Promise<number> {
  if (!(retentionDays > 0)) return 0;
  const cutoff = new Date(now - retentionDays * 86_400_000).toISOString();
  const db = getDb();
  let total = 0;
  for (;;) {
    const ids = (await db.prepare(`SELECT id FROM notification_outbox WHERE createdAt < ? AND status IN ${FINISHED} ORDER BY createdAt LIMIT ${Number(batch)}`)
      .all(cutoff) as Array<{ id: string }>).map((r) => r.id);
    if (!ids.length) break;
    // The status is checked again: a row re-queued by an admin between the two statements is kept.
    total += await tx(async () => (await db.prepare(`DELETE FROM notification_outbox WHERE id IN (${ids.map(() => '?').join(',')}) AND status IN ${FINISHED}`)
      .run(...ids)).changes);
    if (ids.length < batch) break;
    await new Promise((r) => setImmediate(r)); // let requests run between batches
  }
  if (total) {
    await addAuditLog({ actorType: 'system', actorName: 'outbox-retention', action: 'system.outbox_purged', entityType: 'notification_outbox', entityId: 'retention',
      summaryAr: `حذف ${total} رسالة منتهية أقدم من ${retentionDays} يومًا من سجل الإشعارات الصادرة` });
  }
  return total;
}

function sweep(): void {
  void trackJob((async () => {
    try { await withJobLock('outbox-retention', () => purgeOutbox(config.outboxRetentionDays)); } catch (e) { console.error('[outbox-retention] sweep error:', (e as Error).message); }
  })());
}

export function startOutboxRetention(): void {
  if (timer || !(config.outboxRetentionDays > 0)) return;
  first = setTimeout(sweep, 60_000); first.unref();
  timer = setInterval(sweep, config.outboxRetentionSweepMs); timer.unref();
}

export function stopOutboxRetention(): void {
  if (first) clearTimeout(first);
  if (timer) clearInterval(timer);
  first = null; timer = null;
}
