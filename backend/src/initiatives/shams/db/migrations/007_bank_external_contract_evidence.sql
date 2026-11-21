-- 007_bank_external_contract_evidence — business decisions G-01, G-02, G-03 (docs/review/workflow-audit/business-gaps-and-decisions.md).
--
-- G-02: the bank is an external institution with no account, role or step inside the platform.
--   * Live applications in the retired BANK_STUDY state move to CONTRACT_OUTCOME. Their bank was already chosen, and PMU had
--     accepted the electricity approval. A system transition records the move. No history row is updated or deleted
--     (006 guards stay in force).
--   * bank_reviewer users are deactivated and their sessions revoked (tokenVersion + 1). The rows stay for history; the role
--     value stays in the CHECK constraint because historical transitions and audit rows name it.
-- G-01: a bank chosen together with the electricity approval, before PMU accepted it, is cleared. The factory chooses again after
--   acceptance. The earlier choice stays in application_data (section 'electricity') as history.
-- G-03: the document kind 'contractFile' (evidence of the contract). `documents` is rebuilt because SQLite cannot alter a CHECK
--   constraint. Nothing references `documents` and it has no triggers, so the rebuild cannot cascade.

-- ── G-03: documents.kind gains 'contractFile' ───────────────────────────────────────────────────────────────────────
CREATE TABLE documents_v7 (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile','contractFile')),
  version INTEGER NOT NULL CHECK (version >= 1),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  supersededAtAttempt INTEGER,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','removed')),
  uploadedInState TEXT NOT NULL,
  originalName TEXT NOT NULL,
  storedName TEXT NOT NULL UNIQUE,
  mimeType TEXT NOT NULL DEFAULT 'application/pdf',
  sizeBytes INTEGER NOT NULL CHECK (sizeBytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  uploadedBy TEXT NOT NULL REFERENCES users(id),
  createdAt TEXT NOT NULL,
  UNIQUE (applicationId, kind, version)
);
INSERT INTO documents_v7 (id, applicationId, kind, version, attempt, supersededAtAttempt, status, uploadedInState, originalName,
  storedName, mimeType, sizeBytes, sha256, uploadedBy, createdAt)
  SELECT id, applicationId, kind, version, attempt, supersededAtAttempt, status, uploadedInState, originalName,
  storedName, mimeType, sizeBytes, sha256, uploadedBy, createdAt FROM documents;
DROP TABLE documents;
ALTER TABLE documents_v7 RENAME TO documents;
CREATE INDEX idx_docs_app ON documents(applicationId, kind);

-- ── G-02: live BANK_STUDY applications → CONTRACT_OUTCOME (bank kept) ─────────────────────────────────────────────────
INSERT INTO application_transitions (id, applicationId, fromState, toState, action, actorUserId, actorRole, actorOrgId, actorName, reason, attempt, payload, createdAt)
  SELECT 'tr-m007-' || lower(hex(randomblob(12))), a.id, 'BANK_STUDY', 'CONTRACT_OUTCOME', 'bank_study_retired', NULL, 'system', NULL, 'النظام',
    'إلغاء مرحلة دراسة البنك: البنك جهة خارجية، ويسجل المصنع نتيجة التعاقد مباشرة.', a.attempt,
    json_object('bankOrgId', a.bankOrgId, 'migration', '007'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM applications a WHERE a.state = 'BANK_STUDY';
INSERT INTO audit_logs (id, at, actorType, actorName, action, entityType, entityId, applicationId, summaryAr, details)
  SELECT 'aud-m007-' || lower(hex(randomblob(12))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system', 'النظام', 'application.bank_study_retired',
    'application', a.id, a.id, 'نقل آلي من دراسة البنك (مرحلة ملغاة) إلى اختيار البنك والتعاقد',
    json_object('fromState', 'BANK_STUDY', 'toState', 'CONTRACT_OUTCOME', 'bankOrgId', a.bankOrgId, 'migration', '007')
  FROM applications a WHERE a.state = 'BANK_STUDY';
UPDATE applications SET state = 'CONTRACT_OUTCOME', version = version + 1,
  stateEnteredAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE state = 'BANK_STUDY';

-- ── G-01: a bank chosen before PMU accepted the electricity approval is cleared ───────────────────────────────────────
INSERT INTO audit_logs (id, at, actorType, actorName, action, entityType, entityId, applicationId, summaryAr, details)
  SELECT 'aud-m007-' || lower(hex(randomblob(12))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system', 'النظام', 'application.bank_choice_cleared',
    'application', a.id, a.id, 'إلغاء اختيار بنك سابق لقبول موافقة الكهرباء — يختار المصنع البنك بعد القبول',
    json_object('state', a.state, 'previousBankOrgId', a.bankOrgId, 'migration', '007')
  FROM applications a WHERE a.state IN ('ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW') AND a.bankOrgId IS NOT NULL;
UPDATE applications SET bankOrgId = NULL, version = version + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE state IN ('ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW') AND bankOrgId IS NOT NULL;

-- ── G-02: bank users are retired (no login, sessions revoked) ─────────────────────────────────────────────────────────
INSERT INTO audit_logs (id, at, actorType, actorName, action, entityType, entityId, summaryAr, details)
  SELECT 'aud-m007-' || lower(hex(randomblob(12))), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system', 'النظام', 'user.bank_role_retired',
    'user', u.id, 'إيقاف حساب بنك: لا حسابات للبنوك في المنصة', json_object('organizationId', u.organizationId, 'wasActive', u.isActive, 'migration', '007')
  FROM users u WHERE u.role = 'bank_reviewer';
UPDATE users SET isActive = 0, tokenVersion = tokenVersion + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE role = 'bank_reviewer';
UPDATE refresh_tokens SET revokedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE revokedAt IS NULL AND userId IN (SELECT id FROM users WHERE role = 'bank_reviewer');
-- Pending account requests for bank staff can no longer be granted.
UPDATE account_requests SET status = 'rejected', decidedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), decisionNote = 'لا حسابات للبنوك في المنصة (G-02)', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE status = 'pending' AND role = 'bank_reviewer';
