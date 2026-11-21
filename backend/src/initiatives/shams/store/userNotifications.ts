/** صندوق الإشعارات داخل المنصة. كل دالة قراءة/تعديل مقيدة بـuserId صاحب الصف — لا يرى مستخدم إشعار غيره. */
import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';

export interface UserNotification {
  id: string; userId: string; applicationId: string | null; templateKey: string; title: string; body: string; link: string;
  dedupeKey: string; readAt: string | null; createdAt: string;
}

/** يدخل الإشعار إن لم يوجد بنفس المفتاح. يرجع true عند الإدخال الفعلي. */
export async function insertUserNotification(n: { userId: string; applicationId?: string | null; templateKey: string; title: string; body: string; link: string; dedupeKey: string }): Promise<boolean> {
  const r = await getDb().prepare(`INSERT OR IGNORE INTO user_notifications (id, userId, applicationId, templateKey, title, body, link, dedupeKey, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId('inb'), n.userId, n.applicationId ?? null, n.templateKey, n.title.slice(0, 300), n.body, n.link.slice(0, 200), n.dedupeKey, nowIso());
  return Number(r.changes) > 0;
}

export async function listUserNotifications(userId: string, f: { unreadOnly?: boolean }, page: number, pageSize: number): Promise<{ rows: UserNotification[]; total: number }> {
  const where = `userId = ?${f.unreadOnly ? ' AND readAt IS NULL' : ''}`;
  const db = getDb();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM user_notifications WHERE ${where}`).get(userId) as { n: number }).n;
  const rows = await db.prepare(`SELECT * FROM user_notifications WHERE ${where} ORDER BY createdAt DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(userId, pageSize, (page - 1) * pageSize) as unknown as UserNotification[];
  return { rows, total };
}

export async function unreadCount(userId: string): Promise<number> {
  return (await getDb().prepare('SELECT COUNT(*) AS n FROM user_notifications WHERE userId = ? AND readAt IS NULL').get(userId) as { n: number }).n;
}

/** true = وُسم الآن مقروءًا؛ false = غير موجود لهذا المستخدم (أو مقروء من قبل). */
export async function markRead(userId: string, id: string): Promise<'marked' | 'already' | 'not_found'> {
  const db = getDb();
  const r = await db.prepare('UPDATE user_notifications SET readAt = ? WHERE id = ? AND userId = ? AND readAt IS NULL').run(nowIso(), id, userId);
  if (Number(r.changes) > 0) return 'marked';
  return await db.prepare('SELECT 1 FROM user_notifications WHERE id = ? AND userId = ?').get(id, userId) ? 'already' : 'not_found';
}

export async function markAllRead(userId: string): Promise<number> {
  return Number((await getDb().prepare('UPDATE user_notifications SET readAt = ? WHERE userId = ? AND readAt IS NULL').run(nowIso(), userId)).changes);
}
