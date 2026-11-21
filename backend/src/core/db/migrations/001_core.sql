-- 001_core (MySQL 8.4) — the platform core: identity, memberships, shared profiles, catalog, notifications, audit.
--
-- Conventions (same as the initiative modules, inherited from the Shams El-Senaa MySQL schema):
--  * TEXT ids → VARCHAR(64); timestamps are ISO-8601 UTC strings VARCHAR(32) written by the application.
--  * JSON stays text parsed by the application (the JSON type would re-serialise and reorder keys).
--  * utf8mb4_0900_bin by default (binary comparisons); utf8mb4_0900_as_ci on e-mail columns (case-insensitive).
--  * Columns prefixed `_` exist only for MySQL mechanics (insertion order, partial-unique emulation) and are stripped from
--    query results by the driver.
--  * Constraint and trigger names are schema-global in MySQL: core names carry no prefix, module names carry `<module>_`.
--  * References from core tables to module rows (applicationId) have no foreign key and are paired with initiativeId.

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- One row per person (unique e-mail). Initiative roles live in initiative_memberships; platformRole is the platform-wide role.
CREATE TABLE users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email VARCHAR(254) COLLATE utf8mb4_0900_as_ci NOT NULL CHECK (CHAR_LENGTH(email) BETWEEN 3 AND 254),
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT (''),
  phone TEXT NOT NULL DEFAULT (''),
  passwordHash VARCHAR(255) NOT NULL,
  isActive TINYINT NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  mustChangePassword TINYINT NOT NULL DEFAULT 0 CHECK (mustChangePassword IN (0,1)),
  platformRole VARCHAR(32) NULL CHECK (platformRole IS NULL OR platformRole IN ('super_admin','ministry_viewer','auditor','catalog_manager')),
  emailVerifiedAt VARCHAR(32) NULL,
  emailVerifyTokenHash VARCHAR(64) NULL,
  emailVerifyExpiresAt VARCHAR(32) NULL,
  passwordResetTokenHash VARCHAR(64) NULL,
  passwordResetExpiresAt VARCHAR(32) NULL,
  failedLoginCount INT NOT NULL DEFAULT 0 CHECK (failedLoginCount >= 0),
  lockedUntil VARCHAR(32) NULL,
  lastLoginAt VARCHAR(32) NULL,
  notificationsSeenAt VARCHAR(32) NULL,
  tokenVersion INT NOT NULL DEFAULT 0 CHECK (tokenVersion >= 0),
  createdBy VARCHAR(255) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_users_email (email),
  UNIQUE KEY ux_users_verify_token (emailVerifyTokenHash),
  UNIQUE KEY ux_users_reset_token (passwordResetTokenHash),
  KEY idx_users_platform_role (platformRole),
  KEY idx_users_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE refresh_tokens (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  userId VARCHAR(64) NOT NULL,
  familyId VARCHAR(64) NOT NULL,
  tokenHash VARCHAR(64) NOT NULL,
  expiresAt VARCHAR(32) NOT NULL,
  revokedAt VARCHAR(32) NULL,
  replacedById VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_refresh_token (tokenHash),
  KEY idx_refresh_user (userId),
  KEY idx_refresh_family (familyId),
  CONSTRAINT fk_refresh_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE login_throttle (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0 CHECK (failures >= 0),
  lastFailureAt VARCHAR(32) NOT NULL,
  nextAllowedAt VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Initiative catalog (public site) ───────────────────────────────────────────────────────────────────────────────────
-- moduleId = the coded module that runs the initiative (NULL = information page only, no registration).
CREATE TABLE initiatives (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  slug VARCHAR(80) COLLATE utf8mb4_0900_as_ci NOT NULL,
  moduleId VARCHAR(32) NULL,
  titleAr VARCHAR(300) NOT NULL CHECK (CHAR_LENGTH(titleAr) BETWEEN 1 AND 300),
  titleEn VARCHAR(300) NOT NULL DEFAULT '',
  taglineAr TEXT NOT NULL DEFAULT (''),
  taglineEn TEXT NOT NULL DEFAULT (''),
  descriptionAr MEDIUMTEXT NOT NULL DEFAULT (''),
  descriptionEn MEDIUMTEXT NOT NULL DEFAULT (''),
  category VARCHAR(200) NOT NULL DEFAULT '',
  categoryEn VARCHAR(200) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('active','draft','coming_soon','closed','archived','completed')),
  registrationOpen TINYINT NOT NULL DEFAULT 1 CHECK (registrationOpen IN (0,1)),
  targetSectors MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  targetSectorsEn MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  targetGovernorates MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  budgetTotalEGP DOUBLE NOT NULL DEFAULT 0 CHECK (budgetTotalEGP >= 0),
  budgetAllocatedEGP DOUBLE NOT NULL DEFAULT 0 CHECK (budgetAllocatedEGP >= 0),
  startDate VARCHAR(32) NOT NULL DEFAULT '',
  endDate VARCHAR(32) NOT NULL DEFAULT '',
  coverImage TEXT NOT NULL DEFAULT (''),
  logoImage TEXT NOT NULL DEFAULT (''),
  themeColor VARCHAR(16) NOT NULL DEFAULT '#0B2545',
  accentColor VARCHAR(16) NOT NULL DEFAULT '#C8102E',
  badgeTextAr VARCHAR(200) NOT NULL DEFAULT '',
  badgeTextEn VARCHAR(200) NOT NULL DEFAULT '',
  participatingOrgs MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  benefits MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  faqs MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  preEligibilityQuestions MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  requiredDocsList MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  impactMetrics MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  objectives MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  eligibilityRequirements MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  selectionCriteria MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  financialTerms MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  executionNotesAr MEDIUMTEXT NOT NULL DEFAULT (''),
  executionNotesEn MEDIUMTEXT NOT NULL DEFAULT (''),
  kpis MEDIUMTEXT NOT NULL DEFAULT ('[]'),
  sortOrder INT NOT NULL DEFAULT 0,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_initiatives_slug (slug),
  UNIQUE KEY ux_initiatives_module (moduleId),
  KEY idx_initiatives_status (status, sortOrder)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- One role per person per initiative. organizationId = a row of the module's own organizations table (no FK: module table).
-- Role and organization never change (revoke the membership and create a new one) — enforced by a trigger.
CREATE TABLE initiative_memberships (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  userId VARCHAR(64) NOT NULL,
  initiativeId VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  organizationId VARCHAR(64) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_memberships_user_initiative (userId, initiativeId),
  KEY idx_memberships_initiative (initiativeId, role, status),
  KEY idx_memberships_org (initiativeId, organizationId),
  CONSTRAINT fk_memberships_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_memberships_initiative FOREIGN KEY (initiativeId) REFERENCES initiatives(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Shared profiles (the "already registered" data every initiative can reuse) ────────────────────────────────────────
CREATE TABLE person_profiles (
  userId VARCHAR(64) NOT NULL PRIMARY KEY,
  fullNameAr VARCHAR(200) NOT NULL DEFAULT '',
  fullNameEn VARCHAR(200) NOT NULL DEFAULT '',
  nationalId VARCHAR(20) NULL,
  birthDate VARCHAR(10) NULL,
  gender VARCHAR(10) NULL,
  nationality VARCHAR(20) NULL,
  nationalityOther VARCHAR(100) NOT NULL DEFAULT '',
  governorate VARCHAR(40) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT (''),
  phone VARCHAR(40) NOT NULL DEFAULT '',
  qualification VARCHAR(300) NOT NULL DEFAULT '',
  experience TEXT NOT NULL DEFAULT (''),
  attributes MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  KEY idx_person_national_id (nationalId),
  CONSTRAINT fk_person_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- A factory / company a person represents. Registry numbers are indexed, NOT unique: duplicates and disputes are handled
-- by the initiatives that care (Shams registry conflicts) and listed in the admin report.
CREATE TABLE factory_profiles (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  companyName VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(companyName) BETWEEN 1 AND 200),
  commercialRegisterNumber VARCHAR(50) NOT NULL DEFAULT '',
  industrialRegistryNumber VARCHAR(50) NOT NULL DEFAULT '',
  taxNumber VARCHAR(50) NOT NULL DEFAULT '',
  governorate VARCHAR(40) NOT NULL DEFAULT '',
  industrialZone VARCHAR(60) NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT (''),
  phone1 VARCHAR(40) NOT NULL DEFAULT '',
  phone2 VARCHAR(40) NOT NULL DEFAULT '',
  fax VARCHAR(40) NOT NULL DEFAULT '',
  website VARCHAR(300) NOT NULL DEFAULT '',
  contactName VARCHAR(200) NOT NULL DEFAULT '',
  contactTitle VARCHAR(200) NOT NULL DEFAULT '',
  contactMobile VARCHAR(40) NOT NULL DEFAULT '',
  contactPhone VARCHAR(40) NOT NULL DEFAULT '',
  contactFax VARCHAR(40) NOT NULL DEFAULT '',
  contactEmail VARCHAR(254) NOT NULL DEFAULT '',
  attributes MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  KEY idx_factory_ir (industrialRegistryNumber),
  KEY idx_factory_cr (commercialRegisterNumber),
  CONSTRAINT fk_factory_profile_creator FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE factory_profile_members (
  factoryProfileId VARCHAR(64) NOT NULL,
  userId VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','member')),
  createdAt VARCHAR(32) NOT NULL,
  PRIMARY KEY (factoryProfileId, userId),
  KEY idx_fpm_user (userId),
  CONSTRAINT fk_fpm_factory FOREIGN KEY (factoryProfileId) REFERENCES factory_profiles(id) ON DELETE CASCADE,
  CONSTRAINT fk_fpm_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Reusable documents of a profile (national ID, commercial register…). On enrollment an initiative copies the file into
-- its own storage and document table (same sha256): module history and visibility rules stay intact.
CREATE TABLE profile_documents (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  ownerType VARCHAR(16) NOT NULL CHECK (ownerType IN ('person','factory')),
  ownerId VARCHAR(64) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  version INT NOT NULL CHECK (version >= 1),
  status VARCHAR(16) NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  originalName TEXT NOT NULL,
  storedName VARCHAR(255) NOT NULL,
  mimeType VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  sizeBytes BIGINT NOT NULL CHECK (sizeBytes > 0),
  sha256 VARCHAR(64) NOT NULL CHECK (CHAR_LENGTH(sha256) = 64),
  uploadedBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_profile_docs_seq (_seq),
  UNIQUE KEY ux_profile_docs_stored (storedName),
  UNIQUE KEY ux_profile_docs_version (ownerType, ownerId, kind, version),
  KEY idx_profile_docs_owner (ownerType, ownerId, kind, status),
  CONSTRAINT fk_profile_docs_user FOREIGN KEY (uploadedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Reference data ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- Industrial zones per governorate (seeded on every boot from core/reference/industrialZones.ts).
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

-- ── Audit (append-only) ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  at VARCHAR(32) NOT NULL,
  initiativeId VARCHAR(64) NULL,
  actorType VARCHAR(32) NOT NULL CHECK (actorType IN ('user','integration_key','system','anonymous')),
  actorUserId VARCHAR(64) NULL,
  actorName TEXT NOT NULL DEFAULT (''),
  actorRole VARCHAR(64) NOT NULL DEFAULT '',
  actorOrgId VARCHAR(64) NULL,
  integrationKeyId VARCHAR(64) NULL,
  action VARCHAR(255) NOT NULL,
  entityType VARCHAR(64) NOT NULL,
  entityId TEXT NOT NULL DEFAULT (''),
  applicationId VARCHAR(64) NULL,
  summaryAr TEXT NOT NULL DEFAULT (''),
  details MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  ip VARCHAR(64) NOT NULL DEFAULT '',
  UNIQUE KEY ux_audit_seq (_seq),
  KEY idx_audit_at (at DESC),
  KEY idx_audit_at_id (at, id),
  KEY idx_audit_actor (actorUserId),
  KEY idx_audit_entity (entityType, entityId(191)),
  KEY idx_audit_app (applicationId),
  KEY idx_audit_initiative (initiativeId, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Notifications (one outbox and one in-app inbox for the whole platform) ─────────────────────────────────────────────
CREATE TABLE notification_outbox (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  initiativeId VARCHAR(64) NULL,
  dedupeKey TEXT NOT NULL,
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('email','sms')),
  templateKey VARCHAR(100) NOT NULL,
  applicationId VARCHAR(64) NULL,
  recipientUserId VARCHAR(64) NULL,
  recipientAddress TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT (''),
  body MEDIUMTEXT NOT NULL DEFAULT (''),
  textBody MEDIUMTEXT NOT NULL DEFAULT (''),
  `sensitive` TINYINT NOT NULL DEFAULT 0 CHECK (`sensitive` IN (0,1)),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  skipReason TEXT NOT NULL DEFAULT (''),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  nextAttemptAt VARCHAR(32) NOT NULL,
  lastError TEXT NOT NULL DEFAULT (''),
  createdAt VARCHAR(32) NOT NULL,
  sentAt VARCHAR(32) NULL,
  claimedAt VARCHAR(32) NULL,
  _dedupeHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (SHA2(dedupeKey, 256)) STORED,
  UNIQUE KEY ux_notif_dedupe (_dedupeHash),
  KEY idx_notif_due (status, nextAttemptAt),
  KEY idx_notif_app (applicationId),
  KEY idx_notif_created (createdAt),
  KEY idx_notif_initiative (initiativeId, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE user_notifications (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  initiativeId VARCHAR(64) NULL,
  userId VARCHAR(64) NOT NULL,
  applicationId VARCHAR(64) NULL,
  templateKey VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL CHECK (CHAR_LENGTH(title) BETWEEN 1 AND 300),
  body MEDIUMTEXT NOT NULL DEFAULT (''),
  link VARCHAR(200) NOT NULL DEFAULT '' CHECK (CHAR_LENGTH(link) <= 200),
  dedupeKey TEXT NOT NULL,
  readAt VARCHAR(32) NULL,
  createdAt VARCHAR(32) NOT NULL,
  _dedupeHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (SHA2(dedupeKey, 256)) STORED,
  UNIQUE KEY ux_user_notifications_seq (_seq),
  UNIQUE KEY ux_user_notifications_dedupe (_dedupeHash),
  KEY idx_user_notifications_user (userId, readAt, createdAt DESC),
  KEY idx_user_notifications_initiative (userId, initiativeId, createdAt),
  CONSTRAINT fk_un_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Public site content ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE home_banners (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  imageUrl MEDIUMTEXT NOT NULL,
  titleAr TEXT NOT NULL DEFAULT (''),
  titleEn TEXT NOT NULL DEFAULT (''),
  subtitleAr TEXT NOT NULL DEFAULT (''),
  subtitleEn TEXT NOT NULL DEFAULT (''),
  ctaLabelAr VARCHAR(200) NOT NULL DEFAULT '',
  ctaLabelEn VARCHAR(200) NOT NULL DEFAULT '',
  linkType VARCHAR(16) NOT NULL DEFAULT 'none' CHECK (linkType IN ('none','initiative','url')),
  linkTarget TEXT NOT NULL DEFAULT (''),
  placement VARCHAR(32) NOT NULL DEFAULT 'before_about' CHECK (placement IN ('before_about','before_steps','before_cta')),
  sortOrder INT NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  startsAt VARCHAR(32) NOT NULL DEFAULT '',
  endsAt VARCHAR(32) NOT NULL DEFAULT '',
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  KEY idx_banners_order (placement, sortOrder)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE site_content (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  value MEDIUMTEXT NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  updatedBy VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE meta (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  value MEDIUMTEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Legacy import bookkeeping (cli/legacy-import) ──────────────────────────────────────────────────────────────────────
CREATE TABLE legacy_import_runs (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  sourceFingerprint CHAR(64) NOT NULL,
  startedAt VARCHAR(32) NOT NULL,
  finishedAt VARCHAR(32) NULL,
  report MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  KEY idx_legacy_runs_fp (sourceFingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE legacy_id_map (
  source VARCHAR(16) NOT NULL,
  entity VARCHAR(40) NOT NULL,
  oldId VARCHAR(255) NOT NULL,
  newId VARCHAR(255) NOT NULL,
  PRIMARY KEY (source, entity, oldId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Read-only archive of the old platform's generic records (applications, initiative configs) that have no module.
CREATE TABLE legacy_platform_archive (
  id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  importedAt VARCHAR(32) NOT NULL,
  PRIMARY KEY (kind, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

DELIMITER //

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
END//

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
END//

-- A membership's role and organization never change (an initiative's history refers to them).
CREATE TRIGGER memberships_identity_locked BEFORE UPDATE ON initiative_memberships FOR EACH ROW
BEGIN
  IF OLD.role <> NEW.role OR NOT (OLD.organizationId <=> NEW.organizationId) OR OLD.userId <> NEW.userId OR OLD.initiativeId <> NEW.initiativeId THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'membership role and organization cannot change';
  END IF;
END//

DELIMITER ;
