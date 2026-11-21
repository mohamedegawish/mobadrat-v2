-- 003_site_content — نصوص الواجهة العامة التي يعدّلها الأدمن (تتجاوز الافتراضي المدمج في الواجهة).
CREATE TABLE IF NOT EXISTS site_content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  updatedBy TEXT
);
