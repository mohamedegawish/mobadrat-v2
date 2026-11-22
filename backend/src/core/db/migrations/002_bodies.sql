-- The platform's unified directory of participating bodies (جهات المنصة).
-- Each initiative keeps its own organizations (its workflow and permissions depend on them); a platform body links the
-- organizations that are the same real body across initiatives (e.g. IMC in Shams El-Senaa and in Sona'a El-Mostaqbal),
-- so the platform can report on a body as a whole. A body taking part in one initiative simply has one link.
-- Links are informational: they never grant access (access stays the person's membership in each initiative).

CREATE TABLE platform_bodies (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 2 AND 200),
  nameEn VARCHAR(200) NOT NULL DEFAULT '',
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('government','center','financial','company','committee','other')),
  description TEXT NOT NULL DEFAULT (''),
  contactEmail VARCHAR(254) NOT NULL DEFAULT '',
  contactPhone VARCHAR(40) NOT NULL DEFAULT '',
  website VARCHAR(300) NOT NULL DEFAULT '',
  isActive TINYINT NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  -- Two bodies with the same Arabic name would be the same body: case/accents ignored.
  nameKey VARCHAR(200) COLLATE utf8mb4_0900_ai_ci GENERATED ALWAYS AS (TRIM(nameAr)) STORED,
  UNIQUE KEY ux_platform_bodies_name (nameKey),
  KEY idx_platform_bodies_kind (kind, isActive),
  CONSTRAINT fk_platform_bodies_creator FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- One initiative organization belongs to at most one body; one body has at most one organization per initiative.
-- organizationId points into the initiative's own table (<id>_organizations): checked by the platform when linking.
CREATE TABLE platform_body_links (
  bodyId VARCHAR(64) NOT NULL,
  initiativeId VARCHAR(64) NOT NULL,
  organizationId VARCHAR(64) NOT NULL,
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  PRIMARY KEY (initiativeId, organizationId),
  UNIQUE KEY ux_body_links_body_initiative (bodyId, initiativeId),
  CONSTRAINT fk_body_links_body FOREIGN KEY (bodyId) REFERENCES platform_bodies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_body_links_creator FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
