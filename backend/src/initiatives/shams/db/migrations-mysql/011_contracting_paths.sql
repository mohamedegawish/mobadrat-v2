-- 011_contracting_paths — MySQL counterpart of migrations/011 (two contracting paths: bank / electricity distribution company).
--
-- 001 declared the state and kind CHECKs inline, so MySQL named them itself (applications_chk_N / documents_chk_N, numbered by
-- position). They are found through information_schema and dropped (DROP CONSTRAINT: MySQL 8.0.19+ and MariaDB) with a prepared statement, then re-added under explicit names.
-- A missing constraint (already migrated by hand) turns the DROP into a no-op instead of failing.

-- ── applications.contractPath (+ backfill: an application with a chosen bank is on the bank path) ──────────────────────
ALTER TABLE applications ADD COLUMN contractPath VARCHAR(16) NULL;
UPDATE applications SET contractPath = 'bank' WHERE bankOrgId IS NOT NULL;
ALTER TABLE applications ADD KEY idx_apps_contract_path (contractPath);

-- ── applications.state gains DISTRIBUTION_UPLOAD / DISTRIBUTION_REVIEW ────────────────────────────────────────────────
SET @chk = (SELECT tc.CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'applications' AND tc.CONSTRAINT_TYPE = 'CHECK'
    AND cc.CHECK_CLAUSE LIKE '%CONTRACT_OUTCOME%' AND cc.CHECK_CLAUSE NOT LIKE '%DISTRIBUTION_REVIEW%' LIMIT 1);
SET @sql = IF(@chk IS NULL, 'DO 0', CONCAT('ALTER TABLE applications DROP CONSTRAINT `', @chk, '`'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
ALTER TABLE applications ADD CONSTRAINT chk_apps_state CHECK (state IN (
    'DRAFT','IMC_REVIEW','IMC_CORRECTION','ENCPC_REVIEW','ENCPC_CORRECTION','PROVIDER_SELECTION','OFFER_UPLOAD',
    'OFFER_REVIEW','OFFER_CORRECTION','ELECTRICITY_UPLOAD','ELECTRICITY_REVIEW','BANK_STUDY','CONTRACT_OUTCOME',
    'DISTRIBUTION_UPLOAD','DISTRIBUTION_REVIEW',
    'REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN'));
ALTER TABLE applications ADD CONSTRAINT chk_apps_contract_path CHECK (contractPath IS NULL OR contractPath IN ('bank','distribution'));
-- The two paths never coexist: the distribution path has no bank, and the distribution stages exist only on that path.
ALTER TABLE applications ADD CONSTRAINT chk_apps_path_no_bank CHECK (contractPath IS NULL OR contractPath <> 'distribution' OR bankOrgId IS NULL);
ALTER TABLE applications ADD CONSTRAINT chk_apps_path_state CHECK (state NOT IN ('DISTRIBUTION_UPLOAD','DISTRIBUTION_REVIEW') OR COALESCE(contractPath, '') = 'distribution');

-- ── documents.kind gains distributionApprovalFile ──────────────────────────────────────────────────────────────────────
SET @chk = (SELECT tc.CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'documents' AND tc.CONSTRAINT_TYPE = 'CHECK'
    AND cc.CHECK_CLAUSE LIKE '%electricityApprovalFile%' AND cc.CHECK_CLAUSE NOT LIKE '%distributionApprovalFile%' LIMIT 1);
SET @sql = IF(@chk IS NULL, 'DO 0', CONCAT('ALTER TABLE documents DROP CONSTRAINT `', @chk, '`'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
ALTER TABLE documents ADD CONSTRAINT chk_docs_kind CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile','contractFile','distributionApprovalFile'));

-- ── distribution_contracts ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE distribution_contracts (
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
  CONSTRAINT chk_distribution_decided CHECK (reviewStatus IS NULL OR reviewStatus = 'pending' OR (decidedAt IS NOT NULL AND approvalDocumentId IS NOT NULL)),
  UNIQUE KEY ux_distribution_app (applicationId),
  KEY idx_distribution_status (reviewStatus),
  CONSTRAINT fk_dist_app FOREIGN KEY (applicationId) REFERENCES applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_dist_selected_by FOREIGN KEY (selectedBy) REFERENCES users(id),
  CONSTRAINT fk_dist_submitted_by FOREIGN KEY (submittedBy) REFERENCES users(id),
  CONSTRAINT fk_dist_document FOREIGN KEY (approvalDocumentId) REFERENCES documents(id),
  CONSTRAINT fk_dist_decided_by FOREIGN KEY (decidedBy) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
