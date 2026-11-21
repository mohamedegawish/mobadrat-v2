/** صندوق الإشعارات داخل المنصة + قائمة التظلمات لـ IMC. */
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getDb, nowIso } from '../db/sqlite.js';
import { getApplication } from '../store/applications.js';
import { listPendingAppeals } from '../store/lifecycle.js';
import { buildListItem } from '../workflow/applicationView.js';

export const inboxRouter = Router();

/** إشعارات المستخدم (بريد الطلبات فقط — بلا رسائل الحساب الحساسة) مع عدّاد غير المقروء. */
inboxRouter.get('/notifications/mine', ah((req, res) => {
  const user = currentUser(req);
  const db = getDb();
  const seen = (db.prepare('SELECT notificationsSeenAt AS s FROM users WHERE id = ?').get(user.id) as { s: string | null } | undefined)?.s ?? '';
  const rows = db.prepare(`SELECT id, templateKey, subject, applicationId, createdAt FROM notification_outbox
    WHERE recipientUserId = ? AND channel = 'email' AND templateKey NOT LIKE 'auth.%' AND templateKey NOT LIKE 'ops.%'
    ORDER BY createdAt DESC LIMIT 100`).all(user.id) as Array<{ id: string; templateKey: string; subject: string; applicationId: string | null; createdAt: string }>;
  const items = rows.map((r) => ({ ...r, unread: r.createdAt > seen }));
  return okMessage(res, 200, 'ok', { items, unreadCount: items.filter((i) => i.unread).length });
}));

inboxRouter.post('/notifications/seen', ah((req, res) => {
  const user = currentUser(req);
  getDb().prepare('UPDATE users SET notificationsSeenAt = ? WHERE id = ?').run(nowIso(), user.id);
  return okMessage(res, 200, 'ok');
}));

/** التظلمات بانتظار القرار (IMC). */
inboxRouter.get('/appeals', requireRole('imc_officer'), ah((req, res) => {
  const user = currentUser(req);
  const items = listPendingAppeals().map((a) => {
    const app = getApplication(a.applicationId);
    if (!app) return null;
    return { id: a.id, applicationId: a.applicationId, reason: a.reason, createdAt: a.createdAt, application: buildListItem(user, app) };
  }).filter(Boolean);
  if (!items) throw Errors.notFound();
  return okMessage(res, 200, 'ok', { items });
}));
