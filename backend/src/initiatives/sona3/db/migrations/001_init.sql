-- 001_init — مخطط منصة «صُنّاع المستقبل» (docs/SONA3_DESIGN.md). أعمدة حقيقية + CHECK + فهارس. كل التواريخ ISO UTC (TEXT).

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('applicant','imc','committee','funder','admin')),
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
  role TEXT NOT NULL CHECK (role IN ('applicant','imc_officer','evaluator','funder_reviewer','system_admin')),
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
      WHEN 'applicant' THEN 'applicant' WHEN 'imc_officer' THEN 'imc' WHEN 'evaluator' THEN 'committee'
      WHEN 'funder_reviewer' THEN 'funder' WHEN 'system_admin' THEN 'admin' END);
END;
CREATE TRIGGER users_role_org_update BEFORE UPDATE OF role, organizationId ON users BEGIN
  SELECT RAISE(ABORT, 'role does not match organization type')
  WHERE NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = NEW.organizationId AND o.type = CASE NEW.role
      WHEN 'applicant' THEN 'applicant' WHEN 'imc_officer' THEN 'imc' WHEN 'evaluator' THEN 'committee'
      WHEN 'funder_reviewer' THEN 'funder' WHEN 'system_admin' THEN 'admin' END);
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

-- ملف المتقدم (جهة نوع applicant لكل متقدم).
CREATE TABLE applicants (
  id TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  fullName TEXT NOT NULL CHECK (length(fullName) BETWEEN 1 AND 200),
  createdBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- دليل الخبراء ومقدمي الخدمات الداعمين لإعداد الدراسات (يعتمدهم IMC).
CREATE TABLE experts (
  id TEXT PRIMARY KEY,
  nameAr TEXT NOT NULL CHECK (length(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT '',
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
CREATE INDEX idx_experts_status ON experts(status);

-- دورات التقديم: المواعيد والمستهدفات وأوزان التقييم (يديرها الأدمن).
CREATE TABLE cohorts (
  id TEXT PRIMARY KEY,
  nameAr TEXT NOT NULL CHECK (length(nameAr) BETWEEN 1 AND 200),
  nameEn TEXT NOT NULL DEFAULT '',
  opensAt TEXT NOT NULL,           -- YYYY-MM-DD (شامل)
  closesAt TEXT NOT NULL,          -- YYYY-MM-DD (شامل)
  evaluationTarget INTEGER NOT NULL DEFAULT 60 CHECK (evaluationTarget >= 1),
  selectionTarget INTEGER NOT NULL DEFAULT 15 CHECK (selectionTarget >= 1),
  maxAge INTEGER NOT NULL DEFAULT 35 CHECK (maxAge BETWEEN 16 AND 100),
  ageReference TEXT NOT NULL DEFAULT 'cohort_close' CHECK (ageReference IN ('cohort_close','submission')),
  weights TEXT NOT NULL,           -- JSON: { criterionKey: weight } مجموعها 100
  minTotalScore REAL NOT NULL DEFAULT 50 CHECK (minTotalScore BETWEEN 0 AND 100),
  minFinancialScore REAL NOT NULL DEFAULT 50 CHECK (minFinancialScore BETWEEN 0 AND 100),
  minTechnicalScore REAL NOT NULL DEFAULT 50 CHECK (minTechnicalScore BETWEEN 0 AND 100),
  minEvaluators INTEGER NOT NULL DEFAULT 1 CHECK (minEvaluators BETWEEN 1 AND 20),
  createdBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK (closesAt >= opensAt)
);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,              -- SONA3-<YYYY>-<seq> يصدر عند أول إرسال
  applicantId TEXT NOT NULL REFERENCES applicants(id) ON DELETE RESTRICT,
  cohortId TEXT NOT NULL REFERENCES cohorts(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','ELIGIBILITY_REVIEW','ELIGIBILITY_CORRECTION','STUDY_PREPARATION','STUDY_REVIEW','STUDY_CORRECTION',
    'COMMITTEE_EVALUATION','EVALUATED','SELECTED','FUNDING_SEARCH','FUNDER_REVIEW','IMPLEMENTATION','OPERATING',
    'REJECTED','NOT_SELECTED','NOT_APPROVED','CLOSED_NOT_FUNDED','COMPLETED','WITHDRAWN')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  expertId TEXT REFERENCES experts(id),
  funderOrgId TEXT REFERENCES organizations(id),
  applicantName TEXT NOT NULL DEFAULT '',
  projectName TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  governorate TEXT NOT NULL DEFAULT '',
  nationalId TEXT,
  birthDate TEXT,
  teamSize INTEGER NOT NULL DEFAULT 1 CHECK (teamSize >= 1),
  estimatedCost REAL NOT NULL DEFAULT 0 CHECK (estimatedCost >= 0),
  requestedFunding REAL NOT NULL DEFAULT 0 CHECK (requestedFunding >= 0),
  totalInvestment REAL NOT NULL DEFAULT 0 CHECK (totalInvestment >= 0),
  expectedJobs INTEGER NOT NULL DEFAULT 0 CHECK (expectedJobs >= 0),
  score REAL,                      -- متوسط الدرجات الموزونة للمقيّمين (عند إغلاق التقييم)
  passedMinimums INTEGER CHECK (passedMinimums IN (0,1)),
  isStalled INTEGER NOT NULL DEFAULT 0 CHECK (isStalled IN (0,1)),
  stalledNote TEXT NOT NULL DEFAULT '',
  createdBy TEXT REFERENCES users(id),
  submittedAt TEXT,
  stateEnteredAt TEXT NOT NULL,
  closedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_apps_state ON applications(state);
CREATE INDEX idx_apps_applicant ON applications(applicantId);
CREATE INDEX idx_apps_cohort ON applications(cohortId, state);
CREATE INDEX idx_apps_funder ON applications(funderOrgId);
CREATE INDEX idx_apps_governorate ON applications(governorate);
CREATE INDEX idx_apps_sector ON applications(sector);
CREATE INDEX idx_apps_created ON applications(createdAt);
-- طلب واحد غير نهائي لكل متقدم.
CREATE UNIQUE INDEX ux_apps_open_applicant ON applications(applicantId)
  WHERE state NOT IN ('REJECTED','NOT_SELECTED','NOT_APPROVED','CLOSED_NOT_FUNDED','COMPLETED','WITHDRAWN');
-- طلب واحد مُرسل غير نهائي لكل رقم قومي. المسودات تُفحص صراحة عند الإرسال.
CREATE UNIQUE INDEX ux_apps_open_national_id ON applications(nationalId)
  WHERE nationalId IS NOT NULL AND state NOT IN ('DRAFT','REJECTED','NOT_SELECTED','NOT_APPROVED','CLOSED_NOT_FUNDED','COMPLETED','WITHDRAWN');

CREATE TABLE application_counters (
  year INTEGER PRIMARY KEY,
  lastSeq INTEGER NOT NULL CHECK (lastSeq >= 0)
);

CREATE TABLE application_data (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN (
    'personal','team','project','idea','readiness','declarations',
    'study_market','study_technical','study_financial','study_risks','study_impact','study_plan',
    'expert','approval')),
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
  kind TEXT NOT NULL CHECK (kind IN ('nationalIdFile','qualificationFile','supportingFile','studyFile','quotationFile',
    'approvalFile','fundingDecisionFile','milestoneEvidence')),
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

-- إسناد المقيّمين ودرجاتهم (§8). المقيّم لا يرى درجات غيره.
CREATE TABLE evaluator_assignments (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  evaluatorUserId TEXT NOT NULL REFERENCES users(id),
  assignedBy TEXT REFERENCES users(id),
  assignedAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','draft','submitted','conflict','removed')),
  coiDeclaredAt TEXT,
  coiNote TEXT NOT NULL DEFAULT '',
  scores TEXT NOT NULL DEFAULT '{}',      -- JSON: { criterionKey: 0..100 }
  notes TEXT NOT NULL DEFAULT '{}',       -- JSON: { criterionKey: text }
  recommendation TEXT NOT NULL DEFAULT '',
  weightedScore REAL,
  submittedAt TEXT,
  removedAt TEXT,
  removedBy TEXT REFERENCES users(id),
  removeReason TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_assign_app ON evaluator_assignments(applicationId);
CREATE INDEX idx_assign_user ON evaluator_assignments(evaluatorUserId, status);
CREATE UNIQUE INDEX ux_assign_active ON evaluator_assignments(applicationId, evaluatorUserId) WHERE status <> 'removed';

-- إحالات التمويل — كل إحالة سجل مستقل (التاريخ محفوظ).
CREATE TABLE funding_referrals (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  funderOrgId TEXT NOT NULL REFERENCES organizations(id),
  referredAt TEXT NOT NULL,
  referredBy TEXT REFERENCES users(id),
  referralNote TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  decidedAt TEXT,
  decidedBy TEXT REFERENCES users(id),
  amount REAL CHECK (amount IS NULL OR amount > 0),
  model TEXT CHECK (model IS NULL OR model IN ('soft_loan','equity','grant','blended')),
  terms TEXT NOT NULL DEFAULT '',
  declineReason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_funding_app ON funding_referrals(applicationId, referredAt);
CREATE INDEX idx_funding_funder ON funding_referrals(funderOrgId, status);
CREATE UNIQUE INDEX ux_funding_pending ON funding_referrals(applicationId) WHERE status = 'pending';

-- مراحل الإنجاز والصرف (§11). الصرف مرتبط بالتحقق من الإنجاز.
CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  dueDate TEXT,
  amount REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','reported','verified','returned','disbursed')),
  reportNote TEXT NOT NULL DEFAULT '',
  reportedAt TEXT,
  reportedBy TEXT REFERENCES users(id),
  evidenceDocId TEXT REFERENCES documents(id),
  reviewNote TEXT NOT NULL DEFAULT '',
  verifiedAt TEXT,
  verifiedBy TEXT REFERENCES users(id),
  disbursedAt TEXT,
  disbursedBy TEXT REFERENCES users(id),
  disbursementRef TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  UNIQUE (applicationId, seq)
);

-- تقارير الأثر الدورية بعد التشغيل.
CREATE TABLE impact_reports (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  periodStart TEXT NOT NULL,
  periodEnd TEXT NOT NULL,
  revenue REAL NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  costs REAL NOT NULL DEFAULT 0 CHECK (costs >= 0),
  production TEXT NOT NULL DEFAULT '',
  directJobs INTEGER NOT NULL DEFAULT 0 CHECK (directJobs >= 0),
  indirectJobs INTEGER NOT NULL DEFAULT 0 CHECK (indirectJobs >= 0),
  issues TEXT NOT NULL DEFAULT '',
  submittedBy TEXT REFERENCES users(id),
  submittedAt TEXT NOT NULL,
  CHECK (periodEnd >= periodStart)
);
CREATE INDEX idx_impact_app ON impact_reports(applicationId, periodEnd);

-- التظلمات (§5): تظلم واحد لكل طلب على قرار رفض أو عدم اختيار.
CREATE TABLE appeals (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  decisionTransitionId TEXT NOT NULL REFERENCES application_transitions(id),
  reviewState TEXT NOT NULL,       -- حالة المراجعة التي صدر منها القرار (يُعاد إليها عند القبول)
  reason TEXT NOT NULL CHECK (length(reason) >= 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decidedBy TEXT REFERENCES users(id),
  decidedAt TEXT,
  decisionNote TEXT NOT NULL DEFAULT '',
  createdBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_appeals_status ON appeals(status);

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
  scope TEXT NOT NULL CHECK (scope IN ('read','read_documents','manage_users','manage_experts','read_audit')),
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

-- الجهات الهيكلية (لازمة في الإنتاج). جهات التمويل ينشئها الأدمن.
INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES
  ('org-imc', 'imc', 'مركز تحديث الصناعة (IMC)', 'Industrial Modernization Center (IMC)', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('org-committee', 'committee', 'لجنة التقييم', 'Evaluation Committee', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('org-admin', 'admin', 'إدارة النظام', 'System Administration', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
