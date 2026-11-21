-- 005_user_notifications — صندوق الإشعارات داخل المنصة (بجانب البريد/SMS). إضافة فقط.
-- يُكتب صف لكل مستلم له حساب في الوقت نفسه الذي يُدخل فيه البريد/SMS في outbox، بنفس مفتاح عدم التكرار،
-- فإعادة المحاولة أو تكرار الاستدعاء لا ينتج إشعارًا مكررًا. الإشعارات الحساسة (روابط التفعيل/الاستعادة) لا تُخزَّن هنا.
CREATE TABLE user_notifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  applicationId TEXT REFERENCES applications(id) ON DELETE CASCADE,
  templateKey TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '' CHECK (length(link) <= 200),   -- مسار hash داخلي مثل application/<id> أو approvals
  dedupeKey TEXT NOT NULL UNIQUE,
  readAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_user_notifications_user ON user_notifications(userId, readAt, createdAt DESC);
