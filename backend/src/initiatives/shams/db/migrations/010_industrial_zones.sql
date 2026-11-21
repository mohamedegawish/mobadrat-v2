-- 010_industrial_zones — المناطق الصناعية لكل محافظة (بيانات مرجعية).
-- الصفوف تُزرع وتُحدَّث تلقائيًا عند كل تشغيل من src/db/reference/industrialZones.ts (db/referenceSeed.ts) في كل البيئات،
-- بما فيها الإنتاج. `value` معرّف ثابت يُخزَّن في الطلبات (application_data.general.industrialZone): لا يُحذف صف أبدًا،
-- والمنطقة الملغاة تُعلَّم isActive = 0 فتختفي من القائمة وتبقى الطلبات القديمة صالحة العرض.
-- source = 'seed' تديره البذرة؛ أي قيمة أخرى (إدخال إداري مستقبلًا) لا تلمسه البذرة.
CREATE TABLE industrial_zones (
  id TEXT PRIMARY KEY,
  governorate TEXT NOT NULL CHECK (length(governorate) BETWEEN 1 AND 40),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 60),
  labelAr TEXT NOT NULL CHECK (length(labelAr) BETWEEN 1 AND 300),
  labelEn TEXT NOT NULL DEFAULT '',
  authority TEXT NOT NULL DEFAULT '',
  sortOrder INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  source TEXT NOT NULL DEFAULT 'seed',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (governorate, value)
);
CREATE INDEX idx_industrial_zones_gov ON industrial_zones(governorate, sortOrder);
