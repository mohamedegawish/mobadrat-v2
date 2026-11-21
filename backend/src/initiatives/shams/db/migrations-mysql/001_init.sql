-- 001_init (MySQL 8.4) — the complete schema of «شمس الصناعة», equivalent to SQLite migrations 001–007 applied in order
-- (src/db/migrations). On MySQL, versions 002–007 are recorded as already contained here (their files are no-ops).
--
-- Mapping from the SQLite schema (kept deliberately close, so the application SQL and the data are identical):
--  * TEXT ids/keys → VARCHAR(64); short code values (state, role, kind, status…) → VARCHAR(32/64) with the same CHECK lists.
--  * Free text → TEXT/MEDIUMTEXT (never truncated: strict mode turns an oversized value into an error, never a silent cut).
--  * Timestamps stay ISO-8601 UTC strings (VARCHAR(32)), exactly as written by the application: same ordering and
--    comparisons as SQLite, no time-zone conversion anywhere.
--  * JSON stays text parsed by the application (the JSON type would re-serialise and reorder keys).
--  * length() → CHAR_LENGTH() (MySQL's LENGTH counts bytes; the Arabic name limits are in characters).
--  * Collations: utf8mb4_0900_bin by default = SQLite's binary comparisons (ids, tokens, registry numbers);
--    utf8mb4_0900_as_ci on e-mail columns = SQLite's COLLATE NOCASE. Both are NO PAD (trailing spaces significant).
--  * Partial unique indexes (WHERE …) → a STORED generated flag column + a composite UNIQUE key: MySQL allows any number
--    of NULLs in a unique key, so only rows where the flag is 1 compete. Columns prefixed `_` exist only in MySQL and are
--    stripped from query results by the driver.
--  * `_seq` AUTO_INCREMENT = SQLite's rowid (insertion order tie-break in ORDER BY … rowid); the SQLite import fills it
--    from rowid.
--  * Triggers → SIGNAL SQLSTATE '45000' with the same messages.
--  * MySQL does not fire triggers for foreign-key cascades, so the append-only history tables (application_transitions,
--    bank_referral_history, deficiencies) reference applications without ON DELETE CASCADE (= restrict). The outcome is
--    the same as in SQLite, where their delete triggers already make such a cascade fail.
--  * Reserved words used as column names (`key`, `sensitive`) are quoted.

CREATE TABLE organizations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  type VARCHAR(16) NOT NULL CHECK (type IN ('factory','imc','encpc','pmu','bank','admin')),
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 1 AND 200),
  nameEn VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameEn) BETWEEN 1 AND 200),
  contactEmail TEXT NOT NULL DEFAULT (''),
  isActive TINYINT NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  KEY idx_orgs_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizationId VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('factory_owner','imc_reviewer','encpc_reviewer','pmu_reviewer','bank_reviewer','system_admin')),
  email VARCHAR(254) COLLATE utf8mb4_0900_as_ci NOT NULL CHECK (CHAR_LENGTH(email) BETWEEN 3 AND 254),
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT (''),
  phone TEXT NOT NULL DEFAULT (''),
  passwordHash VARCHAR(255) NOT NULL,
  isActive TINYINT NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  mustChangePassword TINYINT NOT NULL DEFAULT 0 CHECK (mustChangePassword IN (0,1)),
  emailVerifiedAt VARCHAR(32) NULL,
  emailVerifyTokenHash VARCHAR(64) NULL,
  emailVerifyExpiresAt VARCHAR(32) NULL,
  passwordResetTokenHash VARCHAR(64) NULL,
  passwordResetExpiresAt VARCHAR(32) NULL,
  failedLoginCount INT NOT NULL DEFAULT 0 CHECK (failedLoginCount >= 0),
  lockedUntil VARCHAR(32) NULL,
  lastLoginAt VARCHAR(32) NULL,
  createdBy VARCHAR(255) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  tokenVersion INT NOT NULL DEFAULT 0 CHECK (tokenVersion >= 0),
  UNIQUE KEY ux_users_email (email),
  UNIQUE KEY ux_users_verify_token (emailVerifyTokenHash),
  UNIQUE KEY ux_users_reset_token (passwordResetTokenHash),
  KEY idx_users_org (organizationId),
  KEY idx_users_role (role),
  CONSTRAINT fk_users_org FOREIGN KEY (organizationId) REFERENCES organizations(id)
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

CREATE TABLE factories (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizationId VARCHAR(64) NOT NULL,
  companyName VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(companyName) BETWEEN 1 AND 200),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_factories_org (organizationId),
  CONSTRAINT fk_factories_org FOREIGN KEY (organizationId) REFERENCES organizations(id),
  CONSTRAINT fk_factories_creator FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE service_providers (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT (''),
  contactName TEXT NOT NULL DEFAULT (''),
  contactPhone TEXT NOT NULL DEFAULT (''),
  contactEmail TEXT NOT NULL DEFAULT (''),
  website TEXT NOT NULL DEFAULT (''),
  notes TEXT NOT NULL DEFAULT (''),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  approvedBy VARCHAR(64) NULL,
  approvedAt VARCHAR(32) NULL,
  suspendedBy VARCHAR(64) NULL,
  suspendedAt VARCHAR(32) NULL,
  createdBy VARCHAR(255) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  description TEXT NOT NULL DEFAULT (''),
  isActive TINYINT NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
  deactivatedBy VARCHAR(64) NULL,
  deactivatedAt VARCHAR(32) NULL,
  logoStoredName VARCHAR(255) NULL,
  logoMime VARCHAR(100) NULL,
  logoSha256 VARCHAR(64) NULL,
  logoUpdatedAt VARCHAR(32) NULL,
  KEY idx_providers_status (status),
  KEY idx_providers_active (isActive, status),
  CONSTRAINT fk_providers_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id),
  CONSTRAINT fk_providers_suspended_by FOREIGN KEY (suspendedBy) REFERENCES users(id),
  CONSTRAINT fk_providers_deactivated_by FOREIGN KEY (deactivatedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE integration_keys (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 120),
  keyPrefix VARCHAR(32) NOT NULL,
  keyHash VARCHAR(64) NOT NULL CHECK (CHAR_LENGTH(keyHash) = 64),
  rateLimitPerMinute INT NOT NULL DEFAULT 60 CHECK (rateLimitPerMinute BETWEEN 1 AND 10000),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  lastUsedAt VARCHAR(32) NULL,
  revokedAt VARCHAR(32) NULL,
  revokedBy VARCHAR(64) NULL,
  rotatedFromId VARCHAR(64) NULL,
  approvalStatus VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (approvalStatus IN ('active','pending_approval','rejected')),
  approvedBy VARCHAR(64) NULL,
  approvedAt VARCHAR(32) NULL,
  UNIQUE KEY ux_keys_prefix (keyPrefix),
  UNIQUE KEY ux_keys_hash (keyHash),
  CONSTRAINT fk_keys_created_by FOREIGN KEY (createdBy) REFERENCES users(id),
  CONSTRAINT fk_keys_revoked_by FOREIGN KEY (revokedBy) REFERENCES users(id),
  CONSTRAINT fk_keys_rotated_from FOREIGN KEY (rotatedFromId) REFERENCES integration_keys(id),
  CONSTRAINT fk_keys_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE integration_key_scopes (
  keyId VARCHAR(64) NOT NULL,
  scope VARCHAR(32) NOT NULL CHECK (scope IN ('read','read_full','read_documents','manage_users','manage_providers','read_audit')),
  PRIMARY KEY (keyId, scope),
  CONSTRAINT fk_scopes_key FOREIGN KEY (keyId) REFERENCES integration_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE registry_verifications (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  registryNumber VARCHAR(255) NOT NULL,
  result VARCHAR(16) NOT NULL CHECK (result IN ('valid','invalid','unavailable')),
  facilityData MEDIUMTEXT NULL,
  adapter VARCHAR(16) NOT NULL CHECK (adapter IN ('mock','http')),
  errorCode VARCHAR(255) NULL,
  checkedBy VARCHAR(64) NULL,
  checkedAt VARCHAR(32) NOT NULL,
  ownershipCheck MEDIUMTEXT NULL,
  UNIQUE KEY ux_registry_seq (_seq),
  KEY idx_registry_app (applicationId),
  CONSTRAINT fk_registry_checked_by FOREIGN KEY (checkedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE applications (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  number VARCHAR(32) NULL,
  factoryId VARCHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','IMC_REVIEW','IMC_CORRECTION','ENCPC_REVIEW','ENCPC_CORRECTION','PROVIDER_SELECTION','OFFER_UPLOAD',
    'OFFER_REVIEW','OFFER_CORRECTION','ELECTRICITY_UPLOAD','ELECTRICITY_REVIEW','BANK_STUDY','CONTRACT_OUTCOME',
    'REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  attempt INT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  providerId VARCHAR(64) NULL,
  bankOrgId VARCHAR(64) NULL,
  companyName TEXT NOT NULL DEFAULT (''),
  governorate VARCHAR(255) NOT NULL DEFAULT '',
  industrialZone TEXT NOT NULL DEFAULT (''),
  industrialRegistryNumber VARCHAR(255) NULL,
  totalRoofArea DOUBLE NOT NULL DEFAULT 0 CHECK (totalRoofArea >= 0),
  registryVerificationId VARCHAR(64) NULL,
  verifiedRegistryNumber VARCHAR(255) NULL,
  createdBy VARCHAR(64) NULL,
  submittedAt VARCHAR(32) NULL,
  stateEnteredAt VARCHAR(32) NOT NULL,
  closedAt VARCHAR(32) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  -- ux_apps_open_factory: one non-final application per factory.
  _openFactory TINYINT GENERATED ALWAYS AS (CASE WHEN state NOT IN ('REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN') THEN 1 END) STORED,
  -- ux_apps_open_registry: one submitted non-final application per industrial registry number (drafts do not reserve it).
  _openRegistry TINYINT GENERATED ALWAYS AS (CASE WHEN industrialRegistryNumber IS NOT NULL
    AND state NOT IN ('DRAFT','REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN') THEN 1 END) STORED,
  UNIQUE KEY ux_apps_number (number),
  UNIQUE KEY ux_apps_open_factory (_openFactory, factoryId),
  UNIQUE KEY ux_apps_open_registry (_openRegistry, industrialRegistryNumber),
  KEY idx_apps_state (state),
  KEY idx_apps_factory (factoryId),
  KEY idx_apps_bank (bankOrgId),
  KEY idx_apps_governorate (governorate),
  KEY idx_apps_created (createdAt),
  CONSTRAINT fk_apps_factory FOREIGN KEY (factoryId) REFERENCES factories(id),
  CONSTRAINT fk_apps_provider FOREIGN KEY (providerId) REFERENCES service_providers(id),
  CONSTRAINT fk_apps_bank FOREIGN KEY (bankOrgId) REFERENCES organizations(id),
  CONSTRAINT fk_apps_registry FOREIGN KEY (registryVerificationId) REFERENCES registry_verifications(id),
  CONSTRAINT fk_apps_created_by FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE application_data (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  section VARCHAR(32) NOT NULL CHECK (section IN ('general','contact','company','engineering','provider','offer','electricity','bank_result','contract')),
  attempt INT NOT NULL CHECK (attempt >= 1),
  data MEDIUMTEXT NOT NULL,
  updatedBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_app_data (applicationId, section, attempt),
  CONSTRAINT fk_app_data_app FOREIGN KEY (applicationId) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_data_user FOREIGN KEY (updatedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE application_transitions (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  fromState VARCHAR(32) NOT NULL,
  toState VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actorUserId VARCHAR(64) NULL,
  actorRole VARCHAR(32) NOT NULL,
  actorOrgId VARCHAR(64) NULL,
  actorName TEXT NOT NULL DEFAULT (''),
  reason TEXT NOT NULL DEFAULT (''),
  attempt INT NOT NULL CHECK (attempt >= 0),
  payload MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  createdAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_transitions_seq (_seq),
  KEY idx_transitions_app (applicationId, createdAt),
  KEY idx_transitions_to (toState),
  CONSTRAINT fk_transitions_app FOREIGN KEY (applicationId) REFERENCES applications(id),
  CONSTRAINT fk_transitions_actor FOREIGN KEY (actorUserId) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE deficiencies (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  transitionId VARCHAR(64) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  field VARCHAR(100) NOT NULL,
  note TEXT NOT NULL DEFAULT (''),
  resolvedAtTransitionId VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  KEY idx_deficiencies_app (applicationId, resolvedAtTransitionId),
  CONSTRAINT fk_def_app FOREIGN KEY (applicationId) REFERENCES applications(id),
  CONSTRAINT fk_def_transition FOREIGN KEY (transitionId) REFERENCES application_transitions(id),
  CONSTRAINT fk_def_resolved FOREIGN KEY (resolvedAtTransitionId) REFERENCES application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE documents (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  kind VARCHAR(40) NOT NULL CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile','contractFile')),
  version INT NOT NULL CHECK (version >= 1),
  attempt INT NOT NULL CHECK (attempt >= 1),
  supersededAtAttempt INT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','removed')),
  uploadedInState VARCHAR(32) NOT NULL,
  originalName TEXT NOT NULL,
  storedName VARCHAR(255) NOT NULL,
  mimeType VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  sizeBytes BIGINT NOT NULL CHECK (sizeBytes > 0),
  sha256 VARCHAR(64) NOT NULL CHECK (CHAR_LENGTH(sha256) = 64),
  uploadedBy VARCHAR(64) NOT NULL,
  createdAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_docs_stored (storedName),
  UNIQUE KEY ux_docs_version (applicationId, kind, version),
  KEY idx_docs_app (applicationId, kind),
  CONSTRAINT fk_docs_app FOREIGN KEY (applicationId) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_docs_user FOREIGN KEY (uploadedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE bank_referrals (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  bankOrgId VARCHAR(64) NOT NULL,
  referredAt VARCHAR(32) NOT NULL,
  referredBy VARCHAR(64) NULL,
  studyResult VARCHAR(16) NULL CHECK (studyResult IN ('approved','declined')),
  studyDate VARCHAR(32) NULL,
  bankNotes TEXT NOT NULL DEFAULT (''),
  resultRecordedBy VARCHAR(64) NULL,
  resultRecordedAt VARCHAR(32) NULL,
  contractStatus VARCHAR(16) NULL CHECK (contractStatus IN ('contracted','not_contracted')),
  contractDate VARCHAR(32) NULL,
  contractAmount DOUBLE NULL CHECK (contractAmount IS NULL OR contractAmount >= 0),
  contractNotes TEXT NOT NULL DEFAULT (''),
  notContractedReason TEXT NOT NULL DEFAULT (''),
  outcomeRecordedBy VARCHAR(64) NULL,
  outcomeRecordedAt VARCHAR(32) NULL,
  UNIQUE KEY ux_referrals_app (applicationId),
  KEY idx_referrals_bank (bankOrgId),
  CONSTRAINT fk_ref_app FOREIGN KEY (applicationId) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_ref_bank FOREIGN KEY (bankOrgId) REFERENCES organizations(id),
  CONSTRAINT fk_ref_referred_by FOREIGN KEY (referredBy) REFERENCES users(id),
  CONSTRAINT fk_ref_result_by FOREIGN KEY (resultRecordedBy) REFERENCES users(id),
  CONSTRAINT fk_ref_outcome_by FOREIGN KEY (outcomeRecordedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE bank_referral_history (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  bankOrgId VARCHAR(64) NOT NULL,
  referredAt VARCHAR(32) NOT NULL,
  referredBy VARCHAR(64) NULL,
  endedAt VARCHAR(32) NOT NULL,
  endedBy VARCHAR(64) NULL,
  endReason TEXT NOT NULL CHECK (CHAR_LENGTH(endReason) >= 3),
  transitionId VARCHAR(64) NOT NULL,
  KEY idx_ref_history_app (applicationId),
  CONSTRAINT fk_refh_app FOREIGN KEY (applicationId) REFERENCES applications(id),
  CONSTRAINT fk_refh_bank FOREIGN KEY (bankOrgId) REFERENCES organizations(id),
  CONSTRAINT fk_refh_referred_by FOREIGN KEY (referredBy) REFERENCES users(id),
  CONSTRAINT fk_refh_ended_by FOREIGN KEY (endedBy) REFERENCES users(id),
  CONSTRAINT fk_refh_transition FOREIGN KEY (transitionId) REFERENCES application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE audit_logs (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  at VARCHAR(32) NOT NULL,
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
  KEY idx_audit_actor (actorUserId),
  KEY idx_audit_entity (entityType, entityId(191)),
  KEY idx_audit_app (applicationId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE notification_outbox (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
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
  -- dedupeKey UNIQUE: the key embeds an address and can exceed MySQL's index-length limit, so uniqueness is on its hash.
  _dedupeHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (SHA2(dedupeKey, 256)) STORED,
  UNIQUE KEY ux_notif_dedupe (_dedupeHash),
  KEY idx_notif_due (status, nextAttemptAt),
  KEY idx_notif_app (applicationId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE webhook_outbox (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  eventId VARCHAR(64) NOT NULL,
  eventType VARCHAR(100) NOT NULL,
  transitionId VARCHAR(64) NULL,
  payload MEDIUMTEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed','skipped')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  nextAttemptAt VARCHAR(32) NOT NULL,
  lastStatusCode INT NULL,
  lastError TEXT NOT NULL DEFAULT (''),
  createdAt VARCHAR(32) NOT NULL,
  deliveredAt VARCHAR(32) NULL,
  claimedAt VARCHAR(32) NULL,
  UNIQUE KEY ux_webhook_event (eventId),
  UNIQUE KEY ux_webhook_transition (transitionId),
  KEY idx_webhook_due (status, nextAttemptAt),
  CONSTRAINT fk_webhook_transition FOREIGN KEY (transitionId) REFERENCES application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE application_counters (
  year INT NOT NULL PRIMARY KEY,
  lastSeq INT NOT NULL CHECK (lastSeq >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE registry_conflicts (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  registryNumber VARCHAR(255) NOT NULL,
  attemptedApplicationId VARCHAR(64) NOT NULL,
  attemptedFactoryId VARCHAR(64) NOT NULL,
  holdingApplicationId VARCHAR(64) NOT NULL,
  attemptedBy VARCHAR(64) NULL,
  attempts INT NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  createdAt VARCHAR(32) NOT NULL,
  lastAttemptAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_conflicts_pair (attemptedApplicationId, holdingApplicationId),
  KEY idx_conflicts_registry (registryNumber),
  KEY idx_conflicts_holding (holdingApplicationId),
  CONSTRAINT fk_conf_attempted_app FOREIGN KEY (attemptedApplicationId) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_conf_attempted_factory FOREIGN KEY (attemptedFactoryId) REFERENCES factories(id),
  CONSTRAINT fk_conf_holding_app FOREIGN KEY (holdingApplicationId) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_conf_attempted_by FOREIGN KEY (attemptedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE registry_blocks (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  registryNumber VARCHAR(255) NOT NULL,
  factoryId VARCHAR(64) NULL,
  applicationId VARCHAR(64) NULL,
  transitionId VARCHAR(64) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'imc_reject' CHECK (source IN ('imc_reject','pmu_dispute','objection')),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  releasedAt VARCHAR(32) NULL,
  releasedBy VARCHAR(64) NULL,
  releaseReason TEXT NOT NULL DEFAULT (''),
  releaseReference TEXT NOT NULL DEFAULT (''),
  allowedFactoryId VARCHAR(64) NULL,
  CHECK (releasedAt IS NULL OR allowedFactoryId IS NOT NULL),
  UNIQUE KEY ux_blocks_seq (_seq),
  KEY idx_blocks_number (registryNumber, createdAt),
  CONSTRAINT fk_blocks_factory FOREIGN KEY (factoryId) REFERENCES factories(id),
  CONSTRAINT fk_blocks_app FOREIGN KEY (applicationId) REFERENCES applications(id),
  CONSTRAINT fk_blocks_transition FOREIGN KEY (transitionId) REFERENCES application_transitions(id),
  CONSTRAINT fk_blocks_created_by FOREIGN KEY (createdBy) REFERENCES users(id),
  CONSTRAINT fk_blocks_released_by FOREIGN KEY (releasedBy) REFERENCES users(id),
  CONSTRAINT fk_blocks_allowed_factory FOREIGN KEY (allowedFactoryId) REFERENCES factories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE registry_objections (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  registryNumber VARCHAR(100) NOT NULL CHECK (CHAR_LENGTH(registryNumber) BETWEEN 1 AND 100),
  factoryId VARCHAR(64) NOT NULL,
  submittedBy VARCHAR(64) NOT NULL,
  note TEXT NOT NULL DEFAULT (''),
  originalName TEXT NOT NULL,
  storedName VARCHAR(255) NOT NULL,
  sizeBytes BIGINT NOT NULL CHECK (sizeBytes > 0),
  sha256 VARCHAR(64) NOT NULL CHECK (CHAR_LENGTH(sha256) = 64),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decidedBy VARCHAR(64) NULL,
  decidedAt VARCHAR(32) NULL,
  decisionReason TEXT NOT NULL DEFAULT (''),
  decisionReference TEXT NOT NULL DEFAULT (''),
  createdAt VARCHAR(32) NOT NULL,
  -- ux_objections_pending: one pending objection per (factory, registry number).
  _pending TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN 1 END) STORED,
  UNIQUE KEY ux_objections_stored (storedName),
  UNIQUE KEY ux_objections_pending (_pending, factoryId, registryNumber),
  KEY idx_objections_status (status, createdAt),
  CONSTRAINT fk_obj_factory FOREIGN KEY (factoryId) REFERENCES factories(id),
  CONSTRAINT fk_obj_submitted_by FOREIGN KEY (submittedBy) REFERENCES users(id),
  CONSTRAINT fk_obj_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE account_requests (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('create_user','change_email')),
  organizationId VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('imc_reviewer','encpc_reviewer','pmu_reviewer','bank_reviewer')),
  targetUserId VARCHAR(64) NULL,
  email VARCHAR(254) COLLATE utf8mb4_0900_as_ci NOT NULL CHECK (CHAR_LENGTH(email) BETWEEN 3 AND 254),
  nameAr TEXT NOT NULL DEFAULT (''),
  nameEn TEXT NOT NULL DEFAULT (''),
  phone TEXT NOT NULL DEFAULT (''),
  reason TEXT NOT NULL DEFAULT (''),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requestedByType VARCHAR(32) NOT NULL CHECK (requestedByType IN ('user','integration_key')),
  requestedByUserId VARCHAR(64) NULL,
  requestedByKeyId VARCHAR(64) NULL,
  decidedBy VARCHAR(64) NULL,
  decidedAt VARCHAR(32) NULL,
  decisionNote TEXT NOT NULL DEFAULT (''),
  resultUserId VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  CHECK (kind <> 'change_email' OR targetUserId IS NOT NULL),
  -- ux_account_requests_pending_email / _target: one pending request per e-mail and per target account.
  _pending TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN 1 END) STORED,
  _pendingTarget TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'pending' AND targetUserId IS NOT NULL THEN 1 END) STORED,
  UNIQUE KEY ux_account_requests_pending_email (_pending, email),
  UNIQUE KEY ux_account_requests_pending_target (_pendingTarget, targetUserId),
  KEY idx_account_requests_org (organizationId, status),
  CONSTRAINT fk_acr_org FOREIGN KEY (organizationId) REFERENCES organizations(id),
  CONSTRAINT fk_acr_target FOREIGN KEY (targetUserId) REFERENCES users(id),
  CONSTRAINT fk_acr_requested_by FOREIGN KEY (requestedByUserId) REFERENCES users(id),
  CONSTRAINT fk_acr_requested_key FOREIGN KEY (requestedByKeyId) REFERENCES integration_keys(id),
  CONSTRAINT fk_acr_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id),
  CONSTRAINT fk_acr_result_user FOREIGN KEY (resultUserId) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE account_recovery_requests (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  userId VARCHAR(64) NOT NULL,
  oldEmail VARCHAR(254) COLLATE utf8mb4_0900_as_ci NOT NULL,
  newEmail VARCHAR(254) COLLATE utf8mb4_0900_as_ci NOT NULL,
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(reason) >= 10),
  requestReference TEXT NOT NULL CHECK (CHAR_LENGTH(requestReference) >= 3),
  documentOriginalName TEXT NOT NULL,
  documentStoredName VARCHAR(255) NOT NULL,
  documentSizeBytes BIGINT NOT NULL CHECK (documentSizeBytes > 0),
  documentSha256 VARCHAR(64) NOT NULL CHECK (CHAR_LENGTH(documentSha256) = 64),
  status VARCHAR(32) NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','cooling','executed','cancelled','rejected')),
  requestedBy VARCHAR(64) NOT NULL,
  requestedAt VARCHAR(32) NOT NULL,
  approvedBy VARCHAR(64) NULL,
  approvedAt VARCHAR(32) NULL,
  coolingEndsAt VARCHAR(32) NULL,
  cancelTokenHash VARCHAR(64) NULL,
  closedBy VARCHAR(255) NULL,
  closedAt VARCHAR(32) NULL,
  closeReason TEXT NOT NULL DEFAULT (''),
  executedAt VARCHAR(32) NULL,
  CHECK (status <> 'cooling' OR coolingEndsAt IS NOT NULL),
  -- ux_recovery_open: one open (pending_approval or cooling) recovery per account.
  _open TINYINT GENERATED ALWAYS AS (CASE WHEN status IN ('pending_approval','cooling') THEN 1 END) STORED,
  UNIQUE KEY ux_recovery_stored (documentStoredName),
  UNIQUE KEY ux_recovery_cancel_token (cancelTokenHash),
  UNIQUE KEY ux_recovery_open (_open, userId),
  KEY idx_recovery_status (status, coolingEndsAt),
  CONSTRAINT fk_rec_user FOREIGN KEY (userId) REFERENCES users(id),
  CONSTRAINT fk_rec_requested_by FOREIGN KEY (requestedBy) REFERENCES users(id),
  CONSTRAINT fk_rec_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE login_throttle (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0 CHECK (failures >= 0),
  lastFailureAt VARCHAR(32) NOT NULL,
  nextAllowedAt VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE integration_auth_failures (
  ip VARCHAR(64) NOT NULL,
  windowStart VARCHAR(32) NOT NULL,
  count INT NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (ip, windowStart)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE user_notifications (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
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
  CONSTRAINT fk_un_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_un_app FOREIGN KEY (applicationId) REFERENCES applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Data created by the SQLite migrations on a fresh database ──────────────────────────────────────────────────────────
-- الجهات الهيكلية (لازمة في الإنتاج). البنوك ينشئها الأدمن. Same ids and names as SQLite 001_init.sql; timestamps in the
-- application's ISO-8601 UTC format. (The other INSERTs of 003/007 only rewrite existing rows: on a fresh database they do
-- nothing, and an imported SQLite database already contains their result.)
INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES
  ('org-imc', 'imc', 'مركز تحديث الصناعة (IMC)', 'Industrial Modernization Center (IMC)', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-encpc', 'encpc', 'ENCPC', 'ENCPC', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-pmu', 'pmu', 'وحدة إدارة المبادرة (PMU)', 'Initiative Management Unit (PMU)', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-admin', 'admin', 'إدارة النظام', 'System Administration', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'));

-- ── Triggers (defence in depth, same rules and messages as SQLite) ─────────────────────────────────────────────────────

DELIMITER //

-- The role must match the organisation type.
CREATE TRIGGER users_role_org_insert BEFORE INSERT ON users FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organizationId AND o.type = CASE NEW.role
      WHEN 'factory_owner' THEN 'factory' WHEN 'imc_reviewer' THEN 'imc' WHEN 'encpc_reviewer' THEN 'encpc'
      WHEN 'pmu_reviewer' THEN 'pmu' WHEN 'bank_reviewer' THEN 'bank' WHEN 'system_admin' THEN 'admin' END) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'role does not match organization type';
  END IF;
END//

-- H2: an account's role and organisation never change (SQLite users_identity_locked + users_role_org_update).
CREATE TRIGGER users_identity_locked BEFORE UPDATE ON users FOR EACH ROW
BEGIN
  IF OLD.role <> NEW.role OR OLD.organizationId <> NEW.organizationId THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'account role and organization cannot change';
  END IF;
END//

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
END//

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only';
END//

CREATE TRIGGER transitions_no_update BEFORE UPDATE ON application_transitions FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'application_transitions is append-only';
END//

CREATE TRIGGER transitions_no_delete BEFORE DELETE ON application_transitions FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'application_transitions is append-only';
END//

CREATE TRIGGER referral_history_no_update BEFORE UPDATE ON bank_referral_history FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'bank_referral_history is append-only';
END//

CREATE TRIGGER referral_history_no_delete BEFORE DELETE ON bank_referral_history FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'bank_referral_history is append-only';
END//

CREATE TRIGGER deficiencies_no_delete BEFORE DELETE ON deficiencies FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'deficiencies cannot be deleted';
END//

-- The only allowed change: closing an open deficiency (resolvedAtTransitionId from NULL to a value). A closed item is final.
CREATE TRIGGER deficiencies_immutable BEFORE UPDATE ON deficiencies FOR EACH ROW
BEGIN
  IF OLD.resolvedAtTransitionId IS NOT NULL
    OR NEW.id <> OLD.id OR NEW.applicationId <> OLD.applicationId OR NEW.transitionId <> OLD.transitionId
    OR NEW.stage <> OLD.stage OR NEW.field <> OLD.field OR NEW.note <> OLD.note OR NEW.createdAt <> OLD.createdAt THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'deficiency history is immutable except resolution of an open item';
  END IF;
END//

DELIMITER ;
