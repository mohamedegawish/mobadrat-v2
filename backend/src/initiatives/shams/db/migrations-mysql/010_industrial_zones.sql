-- 010_industrial_zones — MySQL counterpart of migrations/010 (industrial zones per governorate, reference data).
-- Rows are seeded and updated on every boot from src/db/reference/industrialZones.ts (db/referenceSeed.ts), production included.
CREATE TABLE industrial_zones (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  governorate VARCHAR(40) NOT NULL CHECK (CHAR_LENGTH(governorate) BETWEEN 1 AND 40),
  value VARCHAR(60) NOT NULL CHECK (CHAR_LENGTH(value) BETWEEN 1 AND 60),
  labelAr VARCHAR(300) NOT NULL CHECK (CHAR_LENGTH(labelAr) BETWEEN 1 AND 300),
  labelEn VARCHAR(300) NOT NULL DEFAULT '',
  authority VARCHAR(40) NOT NULL DEFAULT '',
  sortOrder INT NOT NULL DEFAULT 0,
  isActive TINYINT NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  source VARCHAR(20) NOT NULL DEFAULT 'seed',
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_industrial_zones_gov_value (governorate, value),
  KEY idx_industrial_zones_gov (governorate, sortOrder)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
