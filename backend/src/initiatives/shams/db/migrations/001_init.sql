-- 001_init (MySQL 8.4) — the Shams El-Senaa (شمس الصناعة) initiative module, consolidated from the original application's
-- MySQL migrations 001–011. Module tables are prefixed `shams_`; identity, audit and notifications live in the platform core.
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

CREATE TABLE shams_organizations (
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

CREATE TABLE shams_factories (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizationId VARCHAR(64) NOT NULL,
  companyName VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(companyName) BETWEEN 1 AND 200),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  accountStatus VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (accountStatus IN ('pending','under_review','correction','approved','rejected')),
  approvedAt VARCHAR(32) NULL,
  -- The shared factory profile (platform core) this initiative file belongs to.
  factoryProfileId VARCHAR(64) NULL,
  UNIQUE KEY ux_factories_org (organizationId),
  KEY idx_factories_profile (factoryProfileId),
  CONSTRAINT fk_shams_factories_profile FOREIGN KEY (factoryProfileId) REFERENCES factory_profiles(id),
  CONSTRAINT fk_shams_factories_org FOREIGN KEY (organizationId) REFERENCES shams_organizations(id),
  CONSTRAINT fk_shams_factories_creator FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_service_providers (
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
  CONSTRAINT fk_shams_providers_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_providers_suspended_by FOREIGN KEY (suspendedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_providers_deactivated_by FOREIGN KEY (deactivatedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_integration_keys (
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
  CONSTRAINT fk_shams_keys_created_by FOREIGN KEY (createdBy) REFERENCES users(id),
  CONSTRAINT fk_shams_keys_revoked_by FOREIGN KEY (revokedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_keys_rotated_from FOREIGN KEY (rotatedFromId) REFERENCES shams_integration_keys(id),
  CONSTRAINT fk_shams_keys_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_integration_key_scopes (
  keyId VARCHAR(64) NOT NULL,
  scope VARCHAR(32) NOT NULL CHECK (scope IN ('read','read_full','read_documents','manage_users','manage_providers','read_audit')),
  PRIMARY KEY (keyId, scope),
  CONSTRAINT fk_shams_scopes_key FOREIGN KEY (keyId) REFERENCES shams_integration_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_registry_verifications (
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
  CONSTRAINT fk_shams_registry_checked_by FOREIGN KEY (checkedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_applications (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  number VARCHAR(32) NULL,
  factoryId VARCHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  attempt INT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  providerId VARCHAR(64) NULL,
  bankOrgId VARCHAR(64) NULL,
  contractPath VARCHAR(16) NULL,
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
  KEY idx_apps_contract_path (contractPath),
  CONSTRAINT chk_shams_apps_state CHECK (state IN (
    'DRAFT','IMC_REVIEW','IMC_CORRECTION','ENCPC_REVIEW','ENCPC_CORRECTION','PROVIDER_SELECTION','OFFER_UPLOAD',
    'OFFER_REVIEW','OFFER_CORRECTION','ELECTRICITY_UPLOAD','ELECTRICITY_REVIEW','BANK_STUDY','CONTRACT_OUTCOME',
    'DISTRIBUTION_UPLOAD','DISTRIBUTION_REVIEW',
    'REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')),
  CONSTRAINT chk_shams_apps_contract_path CHECK (contractPath IS NULL OR contractPath IN ('bank','distribution')),
  CONSTRAINT chk_shams_apps_path_no_bank CHECK (contractPath IS NULL OR contractPath <> 'distribution' OR bankOrgId IS NULL),
  CONSTRAINT chk_shams_apps_path_state CHECK (state NOT IN ('DISTRIBUTION_UPLOAD','DISTRIBUTION_REVIEW') OR COALESCE(contractPath, '') = 'distribution'),
  CONSTRAINT fk_shams_apps_factory FOREIGN KEY (factoryId) REFERENCES shams_factories(id),
  CONSTRAINT fk_shams_apps_provider FOREIGN KEY (providerId) REFERENCES shams_service_providers(id),
  CONSTRAINT fk_shams_apps_bank FOREIGN KEY (bankOrgId) REFERENCES shams_organizations(id),
  CONSTRAINT fk_shams_apps_registry FOREIGN KEY (registryVerificationId) REFERENCES shams_registry_verifications(id),
  CONSTRAINT fk_shams_apps_created_by FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_application_data (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  section VARCHAR(32) NOT NULL CHECK (section IN ('general','contact','company','engineering','provider','offer','electricity','bank_result','contract')),
  attempt INT NOT NULL CHECK (attempt >= 1),
  data MEDIUMTEXT NOT NULL,
  updatedBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_app_data (applicationId, section, attempt),
  CONSTRAINT fk_shams_app_data_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_shams_app_data_user FOREIGN KEY (updatedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_application_transitions (
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
  CONSTRAINT fk_shams_transitions_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id),
  CONSTRAINT fk_shams_transitions_actor FOREIGN KEY (actorUserId) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_deficiencies (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  transitionId VARCHAR(64) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  field VARCHAR(100) NOT NULL,
  note TEXT NOT NULL DEFAULT (''),
  resolvedAtTransitionId VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  KEY idx_deficiencies_app (applicationId, resolvedAtTransitionId),
  CONSTRAINT fk_shams_def_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id),
  CONSTRAINT fk_shams_def_transition FOREIGN KEY (transitionId) REFERENCES shams_application_transitions(id),
  CONSTRAINT fk_shams_def_resolved FOREIGN KEY (resolvedAtTransitionId) REFERENCES shams_application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_documents (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  kind VARCHAR(40) NOT NULL,
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
  CONSTRAINT chk_shams_docs_kind CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile','contractFile','distributionApprovalFile')),
  CONSTRAINT fk_shams_docs_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_shams_docs_user FOREIGN KEY (uploadedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_bank_referrals (
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
  CONSTRAINT fk_shams_ref_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_shams_ref_bank FOREIGN KEY (bankOrgId) REFERENCES shams_organizations(id),
  CONSTRAINT fk_shams_ref_referred_by FOREIGN KEY (referredBy) REFERENCES users(id),
  CONSTRAINT fk_shams_ref_result_by FOREIGN KEY (resultRecordedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_ref_outcome_by FOREIGN KEY (outcomeRecordedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_bank_referral_history (
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
  CONSTRAINT fk_shams_refh_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id),
  CONSTRAINT fk_shams_refh_bank FOREIGN KEY (bankOrgId) REFERENCES shams_organizations(id),
  CONSTRAINT fk_shams_refh_referred_by FOREIGN KEY (referredBy) REFERENCES users(id),
  CONSTRAINT fk_shams_refh_ended_by FOREIGN KEY (endedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_refh_transition FOREIGN KEY (transitionId) REFERENCES shams_application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_webhook_outbox (
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
  CONSTRAINT fk_shams_webhook_transition FOREIGN KEY (transitionId) REFERENCES shams_application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_application_counters (
  year INT NOT NULL PRIMARY KEY,
  lastSeq INT NOT NULL CHECK (lastSeq >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_registry_conflicts (
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
  CONSTRAINT fk_shams_conf_attempted_app FOREIGN KEY (attemptedApplicationId) REFERENCES shams_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_shams_conf_attempted_factory FOREIGN KEY (attemptedFactoryId) REFERENCES shams_factories(id),
  CONSTRAINT fk_shams_conf_holding_app FOREIGN KEY (holdingApplicationId) REFERENCES shams_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_shams_conf_attempted_by FOREIGN KEY (attemptedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_registry_blocks (
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
  CONSTRAINT fk_shams_blocks_factory FOREIGN KEY (factoryId) REFERENCES shams_factories(id),
  CONSTRAINT fk_shams_blocks_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id),
  CONSTRAINT fk_shams_blocks_transition FOREIGN KEY (transitionId) REFERENCES shams_application_transitions(id),
  CONSTRAINT fk_shams_blocks_created_by FOREIGN KEY (createdBy) REFERENCES users(id),
  CONSTRAINT fk_shams_blocks_released_by FOREIGN KEY (releasedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_blocks_allowed_factory FOREIGN KEY (allowedFactoryId) REFERENCES shams_factories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_registry_objections (
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
  CONSTRAINT fk_shams_obj_factory FOREIGN KEY (factoryId) REFERENCES shams_factories(id),
  CONSTRAINT fk_shams_obj_submitted_by FOREIGN KEY (submittedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_obj_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_account_requests (
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
  CONSTRAINT fk_shams_acr_org FOREIGN KEY (organizationId) REFERENCES shams_organizations(id),
  CONSTRAINT fk_shams_acr_target FOREIGN KEY (targetUserId) REFERENCES users(id),
  CONSTRAINT fk_shams_acr_requested_by FOREIGN KEY (requestedByUserId) REFERENCES users(id),
  CONSTRAINT fk_shams_acr_requested_key FOREIGN KEY (requestedByKeyId) REFERENCES shams_integration_keys(id),
  CONSTRAINT fk_shams_acr_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_acr_result_user FOREIGN KEY (resultUserId) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_account_recovery_requests (
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
  CONSTRAINT fk_shams_rec_user FOREIGN KEY (userId) REFERENCES users(id),
  CONSTRAINT fk_shams_rec_requested_by FOREIGN KEY (requestedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_rec_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_integration_auth_failures (
  ip VARCHAR(64) NOT NULL,
  windowStart VARCHAR(32) NOT NULL,
  count INT NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (ip, windowStart)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE shams_distribution_contracts (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  selectedAt VARCHAR(32) NOT NULL,
  selectedBy VARCHAR(64) NULL,
  submittedAt VARCHAR(32) NULL,
  submittedBy VARCHAR(64) NULL,
  submissionCount INT NOT NULL DEFAULT 0 CHECK (submissionCount >= 0),
  approvalDocumentId VARCHAR(64) NULL,
  reviewStatus VARCHAR(16) NULL CHECK (reviewStatus IS NULL OR reviewStatus IN ('pending','approved','rejected')),
  decidedBy VARCHAR(64) NULL,
  decidedAt VARCHAR(32) NULL,
  decisionNotes TEXT NOT NULL DEFAULT (''),
  CONSTRAINT chk_shams_distribution_decided CHECK (reviewStatus IS NULL OR reviewStatus = 'pending' OR (decidedAt IS NOT NULL AND approvalDocumentId IS NOT NULL)),
  UNIQUE KEY ux_distribution_app (applicationId),
  KEY idx_distribution_status (reviewStatus),
  CONSTRAINT fk_shams_dist_app FOREIGN KEY (applicationId) REFERENCES shams_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_shams_dist_selected_by FOREIGN KEY (selectedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_dist_submitted_by FOREIGN KEY (submittedBy) REFERENCES users(id),
  CONSTRAINT fk_shams_dist_document FOREIGN KEY (approvalDocumentId) REFERENCES shams_documents(id),
  CONSTRAINT fk_shams_dist_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- ── Data created by the SQLite migrations on a fresh database ──────────────────────────────────────────────────────────
-- الجهات الهيكلية (لازمة في الإنتاج). البنوك ينشئها الأدمن. Same ids and names as SQLite 001_init.sql; timestamps in the
-- application's ISO-8601 UTC format. (The other INSERTs of 003/007 only rewrite existing rows: on a fresh database they do
-- nothing, and an imported SQLite database already contains their result.)
INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES
  ('org-imc', 'imc', 'مركز تحديث الصناعة (IMC)', 'Industrial Modernization Center (IMC)', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-encpc', 'encpc', 'ENCPC', 'ENCPC', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-pmu', 'pmu', 'وحدة إدارة المبادرة (PMU)', 'Initiative Management Unit (PMU)', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-admin', 'admin', 'إدارة النظام', 'System Administration', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'));

-- ── Triggers (defence in depth, same rules and messages as SQLite) ─────────────────────────────────────────────────────

DELIMITER //

CREATE TRIGGER shams_transitions_no_update BEFORE UPDATE ON shams_application_transitions FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'shams_application_transitions is append-only';
END//

CREATE TRIGGER shams_transitions_no_delete BEFORE DELETE ON shams_application_transitions FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'shams_application_transitions is append-only';
END//

CREATE TRIGGER shams_referral_history_no_update BEFORE UPDATE ON shams_bank_referral_history FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'shams_bank_referral_history is append-only';
END//

CREATE TRIGGER shams_referral_history_no_delete BEFORE DELETE ON shams_bank_referral_history FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'shams_bank_referral_history is append-only';
END//

CREATE TRIGGER shams_deficiencies_no_delete BEFORE DELETE ON shams_deficiencies FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'deficiencies cannot be deleted';
END//

-- The only allowed change: closing an open deficiency (resolvedAtTransitionId from NULL to a value). A closed item is final.
CREATE TRIGGER shams_deficiencies_immutable BEFORE UPDATE ON shams_deficiencies FOR EACH ROW
BEGIN
  IF OLD.resolvedAtTransitionId IS NOT NULL
    OR NEW.id <> OLD.id OR NEW.applicationId <> OLD.applicationId OR NEW.transitionId <> OLD.transitionId
    OR NEW.stage <> OLD.stage OR NEW.field <> OLD.field OR NEW.note <> OLD.note OR NEW.createdAt <> OLD.createdAt THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'deficiency history is immutable except resolution of an open item';
  END IF;
END//

-- A Shams membership's role must match the type of its Shams organization (applies to initiativeId = 'shams' only).
CREATE TRIGGER shams_membership_role_org BEFORE INSERT ON initiative_memberships FOR EACH ROW
BEGIN
  IF NEW.initiativeId = 'shams' AND NOT EXISTS (
    SELECT 1 FROM shams_organizations o WHERE o.id = NEW.organizationId AND o.type = CASE NEW.role
      WHEN 'factory_owner' THEN 'factory' WHEN 'imc_reviewer' THEN 'imc' WHEN 'encpc_reviewer' THEN 'encpc'
      WHEN 'pmu_reviewer' THEN 'pmu' WHEN 'bank_reviewer' THEN 'bank' WHEN 'system_admin' THEN 'admin' END) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'role does not match organization type';
  END IF;
END//

DELIMITER ;
