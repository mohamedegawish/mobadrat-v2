-- 001_init (MySQL 8.4) — the Sona'a El-Mostaqbal (صُنّاع المستقبل) initiative module, written from the original application's
-- SQLite migrations 001–003 with the same mapping rules as the platform core:
--  * TEXT ids → VARCHAR(64); code values → VARCHAR with the same CHECK lists; length() → CHAR_LENGTH().
--  * Timestamps/dates stay ISO-8601 strings; JSON stays text.
--  * Partial unique indexes → STORED generated flag columns + composite UNIQUE keys (`_`-prefixed, stripped by the driver).
--  * `_seq` AUTO_INCREMENT replaces SQLite's rowid where the code orders by it.
--  * Triggers → SIGNAL. Identity (users), audit and notifications live in the platform core; tables here are `sona3_`.

CREATE TABLE sona3_organizations (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  type VARCHAR(16) NOT NULL CHECK (type IN ('applicant','imc','committee','funder','admin')),
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 1 AND 200),
  nameEn VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameEn) BETWEEN 1 AND 200),
  contactEmail TEXT NOT NULL DEFAULT (''),
  isActive TINYINT NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  KEY idx_sona3_orgs_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- The applicant's file (one applicant organization per applicant). userId = the person's platform account.
CREATE TABLE sona3_applicants (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  organizationId VARCHAR(64) NOT NULL,
  userId VARCHAR(64) NULL,
  fullName VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(fullName) BETWEEN 1 AND 200),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_sona3_applicants_org (organizationId),
  KEY idx_sona3_applicants_user (userId),
  CONSTRAINT fk_sona3_applicants_org FOREIGN KEY (organizationId) REFERENCES sona3_organizations(id),
  CONSTRAINT fk_sona3_applicants_user FOREIGN KEY (userId) REFERENCES users(id),
  CONSTRAINT fk_sona3_applicants_creator FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_experts (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT (''),
  specialty TEXT NOT NULL DEFAULT (''),
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
  KEY idx_sona3_experts_status (status),
  CONSTRAINT fk_sona3_experts_approved_by FOREIGN KEY (approvedBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_experts_suspended_by FOREIGN KEY (suspendedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_cohorts (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  nameAr VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT (''),
  opensAt VARCHAR(10) NOT NULL,
  closesAt VARCHAR(10) NOT NULL,
  evaluationTarget INT NOT NULL DEFAULT 60 CHECK (evaluationTarget >= 1),
  selectionTarget INT NOT NULL DEFAULT 15 CHECK (selectionTarget >= 1),
  maxAge INT NOT NULL DEFAULT 35 CHECK (maxAge BETWEEN 16 AND 100),
  ageReference VARCHAR(16) NOT NULL DEFAULT 'cohort_close' CHECK (ageReference IN ('cohort_close','submission')),
  weights MEDIUMTEXT NOT NULL,
  minTotalScore DOUBLE NOT NULL DEFAULT 50 CHECK (minTotalScore BETWEEN 0 AND 100),
  minFinancialScore DOUBLE NOT NULL DEFAULT 50 CHECK (minFinancialScore BETWEEN 0 AND 100),
  minTechnicalScore DOUBLE NOT NULL DEFAULT 50 CHECK (minTechnicalScore BETWEEN 0 AND 100),
  minEvaluators INT NOT NULL DEFAULT 1 CHECK (minEvaluators BETWEEN 1 AND 20),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  CONSTRAINT chk_sona3_cohorts_dates CHECK (closesAt >= opensAt),
  CONSTRAINT fk_sona3_cohorts_creator FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_applications (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  number VARCHAR(32) NULL,
  applicantId VARCHAR(64) NOT NULL,
  cohortId VARCHAR(64) NOT NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','ELIGIBILITY_REVIEW','ELIGIBILITY_CORRECTION','STUDY_PREPARATION','STUDY_REVIEW','STUDY_CORRECTION',
    'COMMITTEE_EVALUATION','EVALUATED','SELECTED','FUNDING_SEARCH','FUNDER_REVIEW','IMPLEMENTATION','OPERATING',
    'REJECTED','NOT_SELECTED','NOT_APPROVED','CLOSED_NOT_FUNDED','COMPLETED','WITHDRAWN')),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  attempt INT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  expertId VARCHAR(64) NULL,
  funderOrgId VARCHAR(64) NULL,
  applicantName TEXT NOT NULL DEFAULT (''),
  projectName TEXT NOT NULL DEFAULT (''),
  sector VARCHAR(64) NOT NULL DEFAULT '',
  governorate VARCHAR(64) NOT NULL DEFAULT '',
  nationalId VARCHAR(20) NULL,
  birthDate VARCHAR(10) NULL,
  teamSize INT NOT NULL DEFAULT 1 CHECK (teamSize >= 1),
  estimatedCost DOUBLE NOT NULL DEFAULT 0 CHECK (estimatedCost >= 0),
  requestedFunding DOUBLE NOT NULL DEFAULT 0 CHECK (requestedFunding >= 0),
  totalInvestment DOUBLE NOT NULL DEFAULT 0 CHECK (totalInvestment >= 0),
  expectedJobs INT NOT NULL DEFAULT 0 CHECK (expectedJobs >= 0),
  score DOUBLE NULL,
  passedMinimums TINYINT NULL CHECK (passedMinimums IN (0,1)),
  isStalled TINYINT NOT NULL DEFAULT 0 CHECK (isStalled IN (0,1)),
  stalledNote TEXT NOT NULL DEFAULT (''),
  createdBy VARCHAR(64) NULL,
  submittedAt VARCHAR(32) NULL,
  stateEnteredAt VARCHAR(32) NOT NULL,
  closedAt VARCHAR(32) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  -- ux_apps_open_applicant: one non-final application per applicant.
  _openApplicant TINYINT GENERATED ALWAYS AS (CASE WHEN state NOT IN ('REJECTED','NOT_SELECTED','NOT_APPROVED','CLOSED_NOT_FUNDED','COMPLETED','WITHDRAWN') THEN 1 END) STORED,
  -- ux_apps_open_national_id: one submitted non-final application per national ID (drafts are checked explicitly on submit).
  _openNationalId TINYINT GENERATED ALWAYS AS (CASE WHEN nationalId IS NOT NULL
    AND state NOT IN ('DRAFT','REJECTED','NOT_SELECTED','NOT_APPROVED','CLOSED_NOT_FUNDED','COMPLETED','WITHDRAWN') THEN 1 END) STORED,
  UNIQUE KEY ux_sona3_apps_number (number),
  UNIQUE KEY ux_apps_open_applicant (_openApplicant, applicantId),
  UNIQUE KEY ux_apps_open_national_id (_openNationalId, nationalId),
  KEY idx_sona3_apps_state (state),
  KEY idx_sona3_apps_applicant (applicantId),
  KEY idx_sona3_apps_cohort (cohortId, state),
  KEY idx_sona3_apps_funder (funderOrgId),
  KEY idx_sona3_apps_governorate (governorate),
  KEY idx_sona3_apps_sector (sector),
  KEY idx_sona3_apps_created (createdAt),
  CONSTRAINT fk_sona3_apps_applicant FOREIGN KEY (applicantId) REFERENCES sona3_applicants(id),
  CONSTRAINT fk_sona3_apps_cohort FOREIGN KEY (cohortId) REFERENCES sona3_cohorts(id),
  CONSTRAINT fk_sona3_apps_expert FOREIGN KEY (expertId) REFERENCES sona3_experts(id),
  CONSTRAINT fk_sona3_apps_funder FOREIGN KEY (funderOrgId) REFERENCES sona3_organizations(id),
  CONSTRAINT fk_sona3_apps_created_by FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_application_counters (
  year INT NOT NULL PRIMARY KEY,
  lastSeq INT NOT NULL CHECK (lastSeq >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_application_data (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  section VARCHAR(32) NOT NULL CHECK (section IN (
    'personal','team','project','idea','readiness','declarations',
    'study_market','study_technical','study_financial','study_risks','study_impact','study_plan',
    'expert','approval')),
  attempt INT NOT NULL CHECK (attempt >= 1),
  data MEDIUMTEXT NOT NULL,
  updatedBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_sona3_app_data (applicationId, section, attempt),
  CONSTRAINT fk_sona3_app_data_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sona3_app_data_user FOREIGN KEY (updatedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_documents (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  kind VARCHAR(40) NOT NULL CHECK (kind IN ('nationalIdFile','qualificationFile','supportingFile','studyFile','quotationFile',
    'approvalFile','fundingDecisionFile','milestoneEvidence')),
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
  UNIQUE KEY ux_sona3_docs_stored (storedName),
  UNIQUE KEY ux_sona3_docs_version (applicationId, kind, version),
  KEY idx_sona3_docs_app (applicationId, kind),
  CONSTRAINT fk_sona3_docs_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sona3_docs_user FOREIGN KEY (uploadedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_application_transitions (
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
  UNIQUE KEY ux_sona3_transitions_seq (_seq),
  KEY idx_sona3_transitions_app (applicationId, createdAt),
  KEY idx_sona3_transitions_to (toState),
  CONSTRAINT fk_sona3_transitions_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id),
  CONSTRAINT fk_sona3_transitions_actor FOREIGN KEY (actorUserId) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_deficiencies (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  transitionId VARCHAR(64) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  field VARCHAR(100) NOT NULL,
  note TEXT NOT NULL DEFAULT (''),
  resolvedAtTransitionId VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  KEY idx_sona3_deficiencies_app (applicationId, resolvedAtTransitionId),
  CONSTRAINT fk_sona3_def_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id),
  CONSTRAINT fk_sona3_def_transition FOREIGN KEY (transitionId) REFERENCES sona3_application_transitions(id),
  CONSTRAINT fk_sona3_def_resolved FOREIGN KEY (resolvedAtTransitionId) REFERENCES sona3_application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_evaluator_assignments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  evaluatorUserId VARCHAR(64) NOT NULL,
  assignedBy VARCHAR(64) NULL,
  assignedAt VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','draft','submitted','conflict','removed')),
  coiDeclaredAt VARCHAR(32) NULL,
  coiNote TEXT NOT NULL DEFAULT (''),
  scores MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  notes MEDIUMTEXT NOT NULL DEFAULT ('{}'),
  recommendation VARCHAR(64) NOT NULL DEFAULT '',
  weightedScore DOUBLE NULL,
  submittedAt VARCHAR(32) NULL,
  removedAt VARCHAR(32) NULL,
  removedBy VARCHAR(64) NULL,
  removeReason TEXT NOT NULL DEFAULT (''),
  updatedAt VARCHAR(32) NOT NULL,
  -- ux_assign_active: one active assignment per (application, evaluator).
  _active TINYINT GENERATED ALWAYS AS (CASE WHEN status <> 'removed' THEN 1 END) STORED,
  UNIQUE KEY ux_assign_active (_active, applicationId, evaluatorUserId),
  KEY idx_sona3_assign_app (applicationId),
  KEY idx_sona3_assign_user (evaluatorUserId, status),
  CONSTRAINT fk_sona3_assign_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sona3_assign_user FOREIGN KEY (evaluatorUserId) REFERENCES users(id),
  CONSTRAINT fk_sona3_assign_by FOREIGN KEY (assignedBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_assign_removed_by FOREIGN KEY (removedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_funding_referrals (
  _seq BIGINT NOT NULL AUTO_INCREMENT,
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  funderOrgId VARCHAR(64) NOT NULL,
  referredAt VARCHAR(32) NOT NULL,
  referredBy VARCHAR(64) NULL,
  referralNote TEXT NOT NULL DEFAULT (''),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  decidedAt VARCHAR(32) NULL,
  decidedBy VARCHAR(64) NULL,
  amount DOUBLE NULL CHECK (amount IS NULL OR amount > 0),
  model VARCHAR(16) NULL CHECK (model IS NULL OR model IN ('soft_loan','equity','grant','blended')),
  terms TEXT NOT NULL DEFAULT (''),
  declineReason TEXT NOT NULL DEFAULT (''),
  -- ux_funding_pending: one pending referral per application.
  _pending TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN 1 END) STORED,
  UNIQUE KEY ux_sona3_funding_seq (_seq),
  UNIQUE KEY ux_funding_pending (_pending, applicationId),
  KEY idx_sona3_funding_app (applicationId, referredAt),
  KEY idx_sona3_funding_funder (funderOrgId, status),
  CONSTRAINT fk_sona3_funding_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sona3_funding_funder FOREIGN KEY (funderOrgId) REFERENCES sona3_organizations(id),
  CONSTRAINT fk_sona3_funding_referred_by FOREIGN KEY (referredBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_funding_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_milestones (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  seq INT NOT NULL CHECK (seq >= 1),
  title VARCHAR(200) NOT NULL CHECK (CHAR_LENGTH(title) BETWEEN 1 AND 200),
  dueDate VARCHAR(10) NULL,
  amount DOUBLE NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','reported','verified','returned','disbursed')),
  reportNote TEXT NOT NULL DEFAULT (''),
  reportedAt VARCHAR(32) NULL,
  reportedBy VARCHAR(64) NULL,
  evidenceDocId VARCHAR(64) NULL,
  reviewNote TEXT NOT NULL DEFAULT (''),
  verifiedAt VARCHAR(32) NULL,
  verifiedBy VARCHAR(64) NULL,
  disbursedAt VARCHAR(32) NULL,
  disbursedBy VARCHAR(64) NULL,
  disbursementRef TEXT NOT NULL DEFAULT (''),
  createdAt VARCHAR(32) NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_sona3_milestones_seq (applicationId, seq),
  CONSTRAINT fk_sona3_ms_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sona3_ms_reported_by FOREIGN KEY (reportedBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_ms_evidence FOREIGN KEY (evidenceDocId) REFERENCES sona3_documents(id),
  CONSTRAINT fk_sona3_ms_verified_by FOREIGN KEY (verifiedBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_ms_disbursed_by FOREIGN KEY (disbursedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_impact_reports (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  periodStart VARCHAR(10) NOT NULL,
  periodEnd VARCHAR(10) NOT NULL,
  revenue DOUBLE NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  costs DOUBLE NOT NULL DEFAULT 0 CHECK (costs >= 0),
  production TEXT NOT NULL DEFAULT (''),
  directJobs INT NOT NULL DEFAULT 0 CHECK (directJobs >= 0),
  indirectJobs INT NOT NULL DEFAULT 0 CHECK (indirectJobs >= 0),
  issues TEXT NOT NULL DEFAULT (''),
  submittedBy VARCHAR(64) NULL,
  submittedAt VARCHAR(32) NOT NULL,
  CONSTRAINT chk_sona3_impact_period CHECK (periodEnd >= periodStart),
  KEY idx_sona3_impact_app (applicationId, periodEnd),
  CONSTRAINT fk_sona3_impact_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sona3_impact_by FOREIGN KEY (submittedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_appeals (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  applicationId VARCHAR(64) NOT NULL,
  decisionTransitionId VARCHAR(64) NOT NULL,
  reviewState VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL CHECK (CHAR_LENGTH(reason) >= 10),
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decidedBy VARCHAR(64) NULL,
  decidedAt VARCHAR(32) NULL,
  decisionNote TEXT NOT NULL DEFAULT (''),
  createdBy VARCHAR(64) NULL,
  createdAt VARCHAR(32) NOT NULL,
  UNIQUE KEY ux_sona3_appeals_app (applicationId),
  KEY idx_sona3_appeals_status (status),
  CONSTRAINT fk_sona3_appeals_app FOREIGN KEY (applicationId) REFERENCES sona3_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_sona3_appeals_transition FOREIGN KEY (decisionTransitionId) REFERENCES sona3_application_transitions(id),
  CONSTRAINT fk_sona3_appeals_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_appeals_created_by FOREIGN KEY (createdBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_webhook_outbox (
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
  UNIQUE KEY ux_sona3_webhook_event (eventId),
  UNIQUE KEY ux_sona3_webhook_transition (transitionId),
  KEY idx_sona3_webhook_due (status, nextAttemptAt),
  CONSTRAINT fk_sona3_webhook_transition FOREIGN KEY (transitionId) REFERENCES sona3_application_transitions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_integration_keys (
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
  UNIQUE KEY ux_sona3_keys_prefix (keyPrefix),
  UNIQUE KEY ux_sona3_keys_hash (keyHash),
  CONSTRAINT fk_sona3_keys_created_by FOREIGN KEY (createdBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_keys_revoked_by FOREIGN KEY (revokedBy) REFERENCES users(id),
  CONSTRAINT fk_sona3_keys_rotated_from FOREIGN KEY (rotatedFromId) REFERENCES sona3_integration_keys(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sona3_integration_key_scopes (
  keyId VARCHAR(64) NOT NULL,
  scope VARCHAR(32) NOT NULL CHECK (scope IN ('read','read_documents','manage_users','manage_experts','read_audit')),
  PRIMARY KEY (keyId, scope),
  CONSTRAINT fk_sona3_scopes_key FOREIGN KEY (keyId) REFERENCES sona3_integration_keys(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Public-site text overrides of the initiative (edited by its administrator).
CREATE TABLE sona3_site_content (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  value MEDIUMTEXT NOT NULL,
  updatedAt VARCHAR(32) NOT NULL,
  updatedBy VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Structural organizations (needed in production). Funders are created by the administrator.
INSERT INTO sona3_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES
  ('org-imc', 'imc', 'مركز تحديث الصناعة (IMC)', 'Industrial Modernization Center (IMC)', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-committee', 'committee', 'لجنة التقييم', 'Evaluation Committee', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
  ('org-admin', 'admin', 'إدارة النظام', 'System Administration', CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'), CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z'));

DELIMITER //

-- A Sona3 membership's role must match the type of its Sona3 organization (applies to initiativeId = 'sona3' only).
CREATE TRIGGER sona3_membership_role_org BEFORE INSERT ON initiative_memberships FOR EACH ROW
BEGIN
  IF NEW.initiativeId = 'sona3' AND NOT EXISTS (
    SELECT 1 FROM sona3_organizations o WHERE o.id = NEW.organizationId AND o.type = CASE NEW.role
      WHEN 'applicant' THEN 'applicant' WHEN 'imc_officer' THEN 'imc' WHEN 'evaluator' THEN 'committee'
      WHEN 'funder_reviewer' THEN 'funder' WHEN 'system_admin' THEN 'admin' END) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'role does not match organization type';
  END IF;
END//

DELIMITER ;
