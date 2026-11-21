-- 001_init — مخطط موقع «شمس الصناعة». أعمدة حقيقية + CHECK + فهارس. كل التواريخ ISO UTC (TEXT).

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('factory','imc','encpc','pmu','bank','admin')),
  nameAr TEXT NOT NULL CHECK (length(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL CHECK (length(nameEn) BETWEEN 1 AND 200),
  contactEmail TEXT NOT NULL DEFAULT '',
  isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_orgs_type ON organizations(type);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('factory_owner','imc_reviewer','encpc_reviewer','pmu_reviewer','bank_reviewer','system_admin')),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
  nameAr TEXT NOT NULL CHECK (length(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  passwordHash TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0,1)),
  mustChangePassword INTEGER NOT NULL DEFAULT 0 CHECK (mustChangePassword IN (0,1)),
  emailVerifiedAt TEXT,
  emailVerifyTokenHash TEXT,
  emailVerifyExpiresAt TEXT,
  passwordResetTokenHash TEXT,
  passwordResetExpiresAt TEXT,
  failedLoginCount INTEGER NOT NULL DEFAULT 0 CHECK (failedLoginCount >= 0),
  lockedUntil TEXT,
  lastLoginAt TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_users_org ON users(organizationId);
CREATE INDEX idx_users_role ON users(role);
CREATE UNIQUE INDEX ux_users_verify_token ON users(emailVerifyTokenHash) WHERE emailVerifyTokenHash IS NOT NULL;
CREATE UNIQUE INDEX ux_users_reset_token ON users(passwordResetTokenHash) WHERE passwordResetTokenHash IS NOT NULL;

-- الدور يجب أن يطابق نوع الجهة (دفاع في العمق؛ الكود يفحص أيضًا).
CREATE TRIGGER users_role_org_insert BEFORE INSERT ON users BEGIN
  SELECT RAISE(ABORT, 'role does not match organization type')
  WHERE NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organizationId AND o.type = CASE NEW.role
      WHEN 'factory_owner' THEN 'factory' WHEN 'imc_reviewer' THEN 'imc' WHEN 'encpc_reviewer' THEN 'encpc'
      WHEN 'pmu_reviewer' THEN 'pmu' WHEN 'bank_reviewer' THEN 'bank' WHEN 'system_admin' THEN 'admin' END);
END;
CREATE TRIGGER users_role_org_update BEFORE UPDATE OF role, organizationId ON users BEGIN
  SELECT RAISE(ABORT, 'role does not match organization type')
  WHERE NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organizationId AND o.type = CASE NEW.role
      WHEN 'factory_owner' THEN 'factory' WHEN 'imc_reviewer' THEN 'imc' WHEN 'encpc_reviewer' THEN 'encpc'
      WHEN 'pmu_reviewer' THEN 'pmu' WHEN 'bank_reviewer' THEN 'bank' WHEN 'system_admin' THEN 'admin' END);
END;

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  familyId TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  expiresAt TEXT NOT NULL,
  revokedAt TEXT,
  replacedById TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_refresh_user ON refresh_tokens(userId);
CREATE INDEX idx_refresh_family ON refresh_tokens(familyId);

CREATE TABLE factories (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  companyName TEXT NOT NULL CHECK (length(companyName) BETWEEN 1 AND 200),
  createdBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE service_providers (
  id TEXT PRIMARY KEY,
  nameAr TEXT NOT NULL CHECK (length(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT '',
  contactName TEXT NOT NULL DEFAULT '',
  contactPhone TEXT NOT NULL DEFAULT '',
  contactEmail TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  approvedBy TEXT REFERENCES users(id),
  approvedAt TEXT,
  suspendedBy TEXT REFERENCES users(id),
  suspendedAt TEXT,
  createdBy TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_providers_status ON service_providers(status);

CREATE TABLE registry_verifications (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL,
  registryNumber TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('valid','invalid','unavailable')),
  facilityData TEXT,               -- JSON: بيانات المنشأة الواردة من السجل (valid فقط)
  adapter TEXT NOT NULL CHECK (adapter IN ('mock','http')),
  errorCode TEXT,
  checkedBy TEXT REFERENCES users(id),
  checkedAt TEXT NOT NULL
);
CREATE INDEX idx_registry_app ON registry_verifications(applicationId);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,              -- SHAMS-<YYYY>-<seq> يصدر عند أول إرسال ناجح
  factoryId TEXT NOT NULL REFERENCES factories(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','IMC_REVIEW','IMC_CORRECTION','ENCPC_REVIEW','ENCPC_CORRECTION','PROVIDER_SELECTION','OFFER_UPLOAD',
    'OFFER_REVIEW','OFFER_CORRECTION','ELECTRICITY_UPLOAD','ELECTRICITY_REVIEW','BANK_STUDY','CONTRACT_OUTCOME',
    'REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  providerId TEXT REFERENCES service_providers(id),
  bankOrgId TEXT REFERENCES organizations(id),
  companyName TEXT NOT NULL DEFAULT '',
  governorate TEXT NOT NULL DEFAULT '',
  industrialZone TEXT NOT NULL DEFAULT '',
  industrialRegistryNumber TEXT,
  totalRoofArea REAL NOT NULL DEFAULT 0 CHECK (totalRoofArea >= 0),
  registryVerificationId TEXT REFERENCES registry_verifications(id),
  verifiedRegistryNumber TEXT,
  createdBy TEXT REFERENCES users(id),
  submittedAt TEXT,
  stateEnteredAt TEXT NOT NULL,
  closedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_apps_state ON applications(state);
CREATE INDEX idx_apps_factory ON applications(factoryId);
CREATE INDEX idx_apps_bank ON applications(bankOrgId);
CREATE INDEX idx_apps_governorate ON applications(governorate);
CREATE INDEX idx_apps_created ON applications(createdAt);
-- طلب واحد غير نهائي لكل مصنع.
CREATE UNIQUE INDEX ux_apps_open_factory ON applications(factoryId)
  WHERE state NOT IN ('REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN');
-- طلب واحد غير نهائي (مُرسل) لكل رقم سجل صناعي. المسودات تُفحص صراحة عند الإرسال (لا حجز بمسودة).
CREATE UNIQUE INDEX ux_apps_open_registry ON applications(industrialRegistryNumber)
  WHERE industrialRegistryNumber IS NOT NULL AND state NOT IN ('DRAFT','REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN');

CREATE TABLE application_counters (
  year INTEGER PRIMARY KEY,
  lastSeq INTEGER NOT NULL CHECK (lastSeq >= 0)
);

CREATE TABLE application_data (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('general','contact','company','engineering','provider','offer','electricity','bank_result','contract')),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  data TEXT NOT NULL,              -- JSON مُتحقق بقائمة حقول مسموح بها لكل قسم
  updatedBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (applicationId, section, attempt)
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile')),
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
CREATE INDEX idx_docs_app ON documents(applicationId, kind);

CREATE TABLE application_transitions (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  fromState TEXT NOT NULL,
  toState TEXT NOT NULL,
  action TEXT NOT NULL,
  actorUserId TEXT REFERENCES users(id),
  actorRole TEXT NOT NULL,
  actorOrgId TEXT,
  actorName TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  payload TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_transitions_app ON application_transitions(applicationId, createdAt);
CREATE INDEX idx_transitions_to ON application_transitions(toState);

CREATE TABLE deficiencies (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  transitionId TEXT NOT NULL REFERENCES application_transitions(id),
  stage TEXT NOT NULL,             -- حالة المراجعة التي طلبت التصحيح
  field TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  resolvedAtTransitionId TEXT REFERENCES application_transitions(id),
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_deficiencies_app ON deficiencies(applicationId, resolvedAtTransitionId);

CREATE TABLE bank_referrals (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  bankOrgId TEXT NOT NULL REFERENCES organizations(id),
  referredAt TEXT NOT NULL,
  referredBy TEXT REFERENCES users(id),
  studyResult TEXT CHECK (studyResult IN ('approved','declined')),
  studyDate TEXT,
  bankNotes TEXT NOT NULL DEFAULT '',
  resultRecordedBy TEXT REFERENCES users(id),
  resultRecordedAt TEXT,
  contractStatus TEXT CHECK (contractStatus IN ('contracted','not_contracted')),
  contractDate TEXT,
  contractAmount REAL CHECK (contractAmount IS NULL OR contractAmount >= 0),
  contractNotes TEXT NOT NULL DEFAULT '',
  notContractedReason TEXT NOT NULL DEFAULT '',
  outcomeRecordedBy TEXT REFERENCES users(id),
  outcomeRecordedAt TEXT
);
CREATE INDEX idx_referrals_bank ON bank_referrals(bankOrgId);

CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  dedupeKey TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  templateKey TEXT NOT NULL,
  applicationId TEXT,
  recipientUserId TEXT,
  recipientAddress TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',   -- HTML (email) أو نص (SMS). يُمسح لرسائل المصادقة بعد الإرسال.
  textBody TEXT NOT NULL DEFAULT '',
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','skipped')),
  skipReason TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  nextAttemptAt TEXT NOT NULL,
  lastError TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  sentAt TEXT
);
CREATE INDEX idx_notif_due ON notification_outbox(status, nextAttemptAt);
CREATE INDEX idx_notif_app ON notification_outbox(applicationId);

CREATE TABLE webhook_outbox (
  id TEXT PRIMARY KEY,
  eventId TEXT NOT NULL UNIQUE,
  eventType TEXT NOT NULL,
  transitionId TEXT UNIQUE REFERENCES application_transitions(id),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  nextAttemptAt TEXT NOT NULL,
  lastStatusCode INTEGER,
  lastError TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  deliveredAt TEXT
);
CREATE INDEX idx_webhook_due ON webhook_outbox(status, nextAttemptAt);

CREATE TABLE integration_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  keyPrefix TEXT NOT NULL UNIQUE,
  keyHash TEXT NOT NULL UNIQUE CHECK (length(keyHash) = 64),
  rateLimitPerMinute INTEGER NOT NULL DEFAULT 60 CHECK (rateLimitPerMinute BETWEEN 1 AND 10000),
  createdBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  lastUsedAt TEXT,
  revokedAt TEXT,
  revokedBy TEXT REFERENCES users(id),
  rotatedFromId TEXT REFERENCES integration_keys(id)
);

CREATE TABLE integration_key_scopes (
  keyId TEXT NOT NULL REFERENCES integration_keys(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('read','read_documents','manage_users','manage_providers','read_audit')),
  PRIMARY KEY (keyId, scope)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actorType TEXT NOT NULL CHECK (actorType IN ('user','integration_key','system','anonymous')),
  actorUserId TEXT,
  actorName TEXT NOT NULL DEFAULT '',
  actorRole TEXT NOT NULL DEFAULT '',
  actorOrgId TEXT,
  integrationKeyId TEXT,
  action TEXT NOT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL DEFAULT '',
  applicationId TEXT,
  summaryAr TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',  -- JSON بعد إزالة الأسرار
  ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_audit_at ON audit_logs(at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entityType, entityId);
CREATE INDEX idx_audit_app ON audit_logs(applicationId);
CREATE INDEX idx_audit_actor ON audit_logs(actorUserId);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;

-- الجهات الهيكلية (لازمة في الإنتاج). البنوك ينشئها الأدمن.
-- TODO(محتوى): الاسم الكامل لـ ENCPC غير وارد في مصادر المبادرة — يُعرض الاختصار حتى يُعتمد.
INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES
  ('org-imc', 'imc', 'مركز تحديث الصناعة (IMC)', 'Industrial Modernization Center (IMC)', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('org-encpc', 'encpc', 'ENCPC', 'ENCPC', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('org-pmu', 'pmu', 'وحدة إدارة المبادرة (PMU)', 'Initiative Management Unit (PMU)', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('org-admin', 'admin', 'إدارة النظام', 'System Administration', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
