-- 003_security_fixes — إصلاحات المراجعة الأمنية (docs/SECURITY_REVIEW.md → docs/SECURITY_FIX_REPORT.md).

-- ── M1: إلغاء الـ access token فورًا — رقم إصدار الجلسات في التوكن يُقارن بالقاعدة في كل طلب ──
ALTER TABLE users ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0 CHECK (tokenVersion >= 0);

-- ── H2: الكلمات المؤقتة المعلقة (عرفها من أنشأ الحساب) تُبطل، ويُعاد التعيين برابط على بريد صاحب الحساب ──
INSERT INTO audit_logs (id, at, actorType, actorName, action, entityType, entityId, summaryAr, details)
  SELECT 'aud-mig-' || lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'system', 'migration-003',
    'user.temp_password_invalidated', 'user', id, 'إبطال كلمة مؤقتة لم تُغيَّر — يلزم تعيين كلمة المرور برابط البريد',
    json_object('email', email, 'role', role)
  FROM users WHERE mustChangePassword = 1 AND role <> 'factory_owner';
UPDATE refresh_tokens SET revokedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE revokedAt IS NULL AND userId IN (SELECT id FROM users WHERE mustChangePassword = 1 AND role <> 'factory_owner');
UPDATE users SET passwordHash = '', mustChangePassword = 0, tokenVersion = tokenVersion + 1, updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE mustChangePassword = 1 AND role <> 'factory_owner';

-- H2: دور الحساب وجهته لا يتغيران أبدًا (دفاع في العمق — لا يوجد مسار في الكود يغيرهما).
CREATE TRIGGER users_identity_locked BEFORE UPDATE OF role, organizationId ON users
WHEN OLD.role <> NEW.role OR OLD.organizationId <> NEW.organizationId BEGIN
  SELECT RAISE(ABORT, 'account role and organization cannot change');
END;

-- H2: طلبات حسابات جهات القرار (إنشاء، أو تغيير بريد) — لا حساب ولا تغيير قبل موافقة مستخدم نشط من الجهة (أو PMU للبنوك).
CREATE TABLE account_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('create_user','change_email')),
  organizationId TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN ('imc_reviewer','encpc_reviewer','pmu_reviewer','bank_reviewer')),
  targetUserId TEXT REFERENCES users(id),
  email TEXT NOT NULL COLLATE NOCASE CHECK (length(email) BETWEEN 3 AND 254),
  nameAr TEXT NOT NULL DEFAULT '',
  nameEn TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requestedByType TEXT NOT NULL CHECK (requestedByType IN ('user','integration_key')),
  requestedByUserId TEXT REFERENCES users(id),
  requestedByKeyId TEXT REFERENCES integration_keys(id),
  decidedBy TEXT REFERENCES users(id),
  decidedAt TEXT,
  decisionNote TEXT NOT NULL DEFAULT '',
  resultUserId TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  CHECK (kind <> 'change_email' OR targetUserId IS NOT NULL)
);
CREATE INDEX idx_account_requests_org ON account_requests(organizationId, status);
CREATE UNIQUE INDEX ux_account_requests_pending_email ON account_requests(email) WHERE status = 'pending';
CREATE UNIQUE INDEX ux_account_requests_pending_target ON account_requests(targetUserId) WHERE status = 'pending' AND targetUserId IS NOT NULL;

-- ── H1: مفاتيح الربط — نطاق read_full، وحالة اعتماد (نطاقات البيانات تحتاج موافقة PMU عند تفعيلها) ──
ALTER TABLE integration_keys ADD COLUMN approvalStatus TEXT NOT NULL DEFAULT 'active' CHECK (approvalStatus IN ('active','pending_approval','rejected'));
ALTER TABLE integration_keys ADD COLUMN approvedBy TEXT REFERENCES users(id);
ALTER TABLE integration_keys ADD COLUMN approvedAt TEXT;

-- المفاتيح القديمة: نطاقات البيانات (read_documents, read_audit) تُزال مع سطر تدقيق لكل مفتاح.
INSERT INTO audit_logs (id, at, actorType, actorName, action, entityType, entityId, summaryAr, details)
  SELECT 'aud-mig-' || lower(hex(randomblob(16))), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'system', 'migration-003',
    'integration_key.data_scopes_removed', 'integration_key', keyId, 'إزالة نطاقات البيانات من مفتاح ربط قديم (معطلة بقرار المشروع)',
    json_object('removedScopes', json_group_array(scope))
  FROM integration_key_scopes WHERE scope IN ('read_documents','read_audit') GROUP BY keyId;
CREATE TABLE integration_key_scopes_v3 (
  keyId TEXT NOT NULL REFERENCES integration_keys(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('read','read_full','read_documents','manage_users','manage_providers','read_audit')),
  PRIMARY KEY (keyId, scope)
);
INSERT INTO integration_key_scopes_v3 (keyId, scope) SELECT keyId, scope FROM integration_key_scopes WHERE scope NOT IN ('read_documents','read_audit');
DROP TABLE integration_key_scopes;
ALTER TABLE integration_key_scopes_v3 RENAME TO integration_key_scopes;

-- M4: فشل مصادقة الربط يُعدّ هنا (لكل IP ونافذة)، والتدقيق سطر واحد لكل نافذة.
CREATE TABLE integration_auth_failures (
  ip TEXT NOT NULL,
  windowStart TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (ip, windowStart)
);

-- ── H3: حظر رقم السجل على الرقم نفسه لكل الحسابات؛ الرفع من PMU لمصنع محدد (allowedFactoryId) ──
CREATE TABLE registry_blocks_v3 (
  id TEXT PRIMARY KEY,
  registryNumber TEXT NOT NULL,
  factoryId TEXT REFERENCES factories(id),               -- المصنع الذي رُفض طلبه (طرف الحظر) — قد يكون NULL
  applicationId TEXT REFERENCES applications(id),
  transitionId TEXT REFERENCES application_transitions(id),
  source TEXT NOT NULL DEFAULT 'imc_reject' CHECK (source IN ('imc_reject','pmu_dispute','objection')),
  createdBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  releasedAt TEXT,
  releasedBy TEXT REFERENCES users(id),
  releaseReason TEXT NOT NULL DEFAULT '',
  releaseReference TEXT NOT NULL DEFAULT '',
  allowedFactoryId TEXT REFERENCES factories(id),       -- بعد الرفع: المصنع الوحيد المسموح له بالرقم
  CHECK (releasedAt IS NULL OR allowedFactoryId IS NOT NULL)
);
-- الحظر القديم كان على المصنع؛ الرفع القديم كان له هو → allowedFactoryId = factoryId.
INSERT INTO registry_blocks_v3 (id, registryNumber, factoryId, applicationId, transitionId, source, createdBy, createdAt, releasedAt, releasedBy, releaseReason, releaseReference, allowedFactoryId)
  SELECT id, registryNumber, factoryId, applicationId, transitionId, 'imc_reject', createdBy, createdAt, releasedAt, releasedBy, releaseReason, releaseReference,
    CASE WHEN releasedAt IS NULL THEN NULL ELSE factoryId END
  FROM registry_blocks;
DROP TABLE registry_blocks;
ALTER TABLE registry_blocks_v3 RENAME TO registry_blocks;
CREATE INDEX idx_blocks_number ON registry_blocks(registryNumber, createdAt);

-- H3 (القرار 4): اعتراض مالك الرقم بمستند — تراجعه PMU.
CREATE TABLE registry_objections (
  id TEXT PRIMARY KEY,
  registryNumber TEXT NOT NULL CHECK (length(registryNumber) BETWEEN 1 AND 100),
  factoryId TEXT NOT NULL REFERENCES factories(id),
  submittedBy TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  originalName TEXT NOT NULL,
  storedName TEXT NOT NULL UNIQUE,
  sizeBytes INTEGER NOT NULL CHECK (sizeBytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decidedBy TEXT REFERENCES users(id),
  decidedAt TEXT,
  decisionReason TEXT NOT NULL DEFAULT '',
  decisionReference TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);
CREATE INDEX idx_objections_status ON registry_objections(status, createdAt);
CREATE UNIQUE INDEX ux_objections_pending ON registry_objections(factoryId, registryNumber) WHERE status = 'pending';

-- H3 (القرار 5): موضع نتيجة مطابقة المالك/المفوض عند توفر API السجل (JSON). لا منع آلي.
ALTER TABLE registry_verifications ADD COLUMN ownershipCheck TEXT;

-- ── H4: استرداد بريد المصنع — طلب من الأدمن بمستند، موافقة PMU، ثم مهلة انتظار، ثم التنفيذ ──
CREATE TABLE account_recovery_requests (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id),
  oldEmail TEXT NOT NULL,
  newEmail TEXT NOT NULL COLLATE NOCASE,
  reason TEXT NOT NULL CHECK (length(reason) >= 10),
  requestReference TEXT NOT NULL CHECK (length(requestReference) >= 3),
  documentOriginalName TEXT NOT NULL,
  documentStoredName TEXT NOT NULL UNIQUE,
  documentSizeBytes INTEGER NOT NULL CHECK (documentSizeBytes > 0),
  documentSha256 TEXT NOT NULL CHECK (length(documentSha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','cooling','executed','cancelled','rejected')),
  requestedBy TEXT NOT NULL REFERENCES users(id),
  requestedAt TEXT NOT NULL,
  approvedBy TEXT REFERENCES users(id),
  approvedAt TEXT,
  coolingEndsAt TEXT,
  cancelTokenHash TEXT UNIQUE,
  closedBy TEXT,                -- معرف المستخدم، أو 'owner' (رابط الإلغاء)، أو 'system'
  closedAt TEXT,
  closeReason TEXT NOT NULL DEFAULT '',
  executedAt TEXT,
  CHECK (status <> 'cooling' OR coolingEndsAt IS NOT NULL)
);
CREATE INDEX idx_recovery_status ON account_recovery_requests(status, coolingEndsAt);
CREATE UNIQUE INDEX ux_recovery_open ON account_recovery_requests(userId) WHERE status IN ('pending_approval','cooling');

-- ── M3: تأخير متصاعد لكل (بريد، IP) بدل قفل الحساب ──
CREATE TABLE login_throttle (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  lastFailureAt TEXT NOT NULL,
  nextAllowedAt TEXT NOT NULL
);
UPDATE users SET lockedUntil = NULL, failedLoginCount = 0;

-- ── L4: وقت حجز الرسالة/الحدث — لإعادة ما توقف في `sending` عند الإقلاع ──
ALTER TABLE notification_outbox ADD COLUMN claimedAt TEXT;
ALTER TABLE webhook_outbox ADD COLUMN claimedAt TEXT;
