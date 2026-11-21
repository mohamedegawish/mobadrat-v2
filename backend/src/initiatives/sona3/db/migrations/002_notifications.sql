-- 002_notifications — وقت آخر اطلاع للمستخدم على إشعاراته داخل المنصة.
ALTER TABLE users ADD COLUMN notificationsSeenAt TEXT;
