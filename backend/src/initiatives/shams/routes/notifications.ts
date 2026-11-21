/**
 * صندوق الإشعارات داخل المنصة — لكل مستخدم صناديقه وحده. كل استعلام وتعديل مقيد بـuserId صاحب الجلسة (لا معرّف مستخدم في الطلب)،
 * وإشعار مستخدم آخر يرجع 404 دون كشف وجوده. متاح لكل الأدوار (مصنع/مراجع/أدمن).
 */
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { normPage, normPageSize, paginate } from '../http/helpers.js';
import { onlyKeys } from '../http/validate.js';
import { currentUser } from '../middleware/auth.js';
import { listUserNotifications, markAllRead, markRead, unreadCount, type UserNotification } from '../store/userNotifications.js';

export const notificationsRouter = Router();

function publicItem(n: UserNotification) {
  return { id: n.id, applicationId: n.applicationId, templateKey: n.templateKey, title: n.title, body: n.body, link: n.link, read: n.readAt !== null, readAt: n.readAt, createdAt: n.createdAt };
}

notificationsRouter.get('/notifications', ah(async (req, res) => {
  const user = currentUser(req);
  const page = normPage(req.query.page);
  const pageSize = normPageSize(req.query.pageSize, 20, 100);
  const { rows, total } = await listUserNotifications(user.id, { unreadOnly: req.query.unread === '1' }, page, pageSize);
  return okMessage(res, 200, 'ok', { ...paginate(rows.map(publicItem), total, page, pageSize), unread: await unreadCount(user.id) });
}));

/** عدّاد خفيف للجرس. */
notificationsRouter.get('/notifications/unread-count', ah(async (req, res) => okMessage(res, 200, 'ok', { unread: await unreadCount(currentUser(req).id) })));

notificationsRouter.post('/notifications/read-all', ah(async (req, res) => {
  onlyKeys(req.body ?? {}, []);
  const user = currentUser(req);
  const changed = await markAllRead(user.id);
  return okMessage(res, 200, 'ok', { changed, unread: 0 });
}));

notificationsRouter.post('/notifications/:id/read', ah(async (req, res) => {
  onlyKeys(req.body ?? {}, []);
  const user = currentUser(req);
  if (await markRead(user.id, req.params.id) === 'not_found') throw Errors.notFound();
  return okMessage(res, 200, 'ok', { unread: await unreadCount(user.id) });
}));
