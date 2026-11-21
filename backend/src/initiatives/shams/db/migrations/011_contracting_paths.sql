-- migrate:foreign-keys-off
-- 011_contracting_paths — مسارا التعاقد بعد قبول PMU لموافقة الكهرباء: البنك (القائم) أو شركة توزيع الكهرباء (جديد).
--
-- السطر الأول يطلب من المشغّل تعطيل المفاتيح الأجنبية قبل المعاملة (إجراء SQLite الموثق لإعادة بناء جدول له مراجع):
-- 12 جدولًا تشير إلى applications، وبعضها ON DELETE CASCADE؛ مع المفاتيح مفعّلة كان DROP TABLE سيحذف صفوفها تتاليًا
-- (أو يصطدم بمحفّزات منع الحذف في السجل التاريخي). المشغّل يفحص PRAGMA foreign_key_check كاملًا قبل الالتزام.
--
--  * applications: حالتان جديدتان (DISTRIBUTION_UPLOAD / DISTRIBUTION_REVIEW) + عمود contractPath مع قيود تمنع الجمع بين
--    المسارين على مستوى قاعدة البيانات. الطلبات التي اختير لها بنك تُعلَّم contractPath = 'bank' (لا تغيير آخر في أي صف).
--  * documents: نوع مستند جديد distributionApprovalFile (لا شيء يشير إلى documents؛ نفس نمط 007).
--  * distribution_contracts: نتيجة التعاقد عن طريق شركة التوزيع (مقابل bank_referrals للمسار البنكي).

-- ── applications ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE applications_v11 (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,
  factoryId TEXT NOT NULL REFERENCES factories(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','IMC_REVIEW','IMC_CORRECTION','ENCPC_REVIEW','ENCPC_CORRECTION','PROVIDER_SELECTION','OFFER_UPLOAD',
    'OFFER_REVIEW','OFFER_CORRECTION','ELECTRICITY_UPLOAD','ELECTRICITY_REVIEW','BANK_STUDY','CONTRACT_OUTCOME',
    'DISTRIBUTION_UPLOAD','DISTRIBUTION_REVIEW',
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
  updatedAt TEXT NOT NULL,
  contractPath TEXT CHECK (contractPath IS NULL OR contractPath IN ('bank','distribution')),
  -- لا يجتمع المساران: مسار شركة التوزيع بلا بنك، ومراحل شركة التوزيع لا تكون إلا على مسارها.
  CHECK (contractPath IS NULL OR contractPath <> 'distribution' OR bankOrgId IS NULL),
  CHECK (state NOT IN ('DISTRIBUTION_UPLOAD','DISTRIBUTION_REVIEW') OR COALESCE(contractPath, '') = 'distribution')
);
INSERT INTO applications_v11 (id, number, factoryId, state, version, attempt, providerId, bankOrgId, companyName, governorate, industrialZone,
  industrialRegistryNumber, totalRoofArea, registryVerificationId, verifiedRegistryNumber, createdBy, submittedAt, stateEnteredAt, closedAt,
  createdAt, updatedAt, contractPath)
  SELECT id, number, factoryId, state, version, attempt, providerId, bankOrgId, companyName, governorate, industrialZone,
  industrialRegistryNumber, totalRoofArea, registryVerificationId, verifiedRegistryNumber, createdBy, submittedAt, stateEnteredAt, closedAt,
  createdAt, updatedAt, CASE WHEN bankOrgId IS NOT NULL THEN 'bank' END FROM applications;
DROP TABLE applications;
ALTER TABLE applications_v11 RENAME TO applications;
CREATE INDEX idx_apps_state ON applications(state);
CREATE INDEX idx_apps_factory ON applications(factoryId);
CREATE INDEX idx_apps_bank ON applications(bankOrgId);
CREATE INDEX idx_apps_governorate ON applications(governorate);
CREATE INDEX idx_apps_created ON applications(createdAt);
CREATE INDEX idx_apps_contract_path ON applications(contractPath);
CREATE UNIQUE INDEX ux_apps_open_factory ON applications(factoryId)
  WHERE state NOT IN ('REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN');
CREATE UNIQUE INDEX ux_apps_open_registry ON applications(industrialRegistryNumber)
  WHERE industrialRegistryNumber IS NOT NULL AND state NOT IN ('DRAFT','REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN');

-- ── documents.kind gains 'distributionApprovalFile' ──────────────────────────────────────────────────────────────────
CREATE TABLE documents_v11 (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile','contractFile','distributionApprovalFile')),
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
INSERT INTO documents_v11 (id, applicationId, kind, version, attempt, supersededAtAttempt, status, uploadedInState, originalName,
  storedName, mimeType, sizeBytes, sha256, uploadedBy, createdAt)
  SELECT id, applicationId, kind, version, attempt, supersededAtAttempt, status, uploadedInState, originalName,
  storedName, mimeType, sizeBytes, sha256, uploadedBy, createdAt FROM documents;
DROP TABLE documents;
ALTER TABLE documents_v11 RENAME TO documents;
CREATE INDEX idx_docs_app ON documents(applicationId, kind);

-- ── distribution_contracts: نتيجة التعاقد عن طريق شركة توزيع الكهرباء (صف واحد لكل طلب) ──────────────────────────────
-- تاريخ الرفع وإعادة الرفع محفوظ في نسخ documents (الرافع، الوقت، المحاولة)، والإرسال والقرار في application_transitions (غير قابلة للتعديل).
CREATE TABLE distribution_contracts (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  selectedAt TEXT NOT NULL,
  selectedBy TEXT REFERENCES users(id),
  submittedAt TEXT,
  submittedBy TEXT REFERENCES users(id),
  submissionCount INTEGER NOT NULL DEFAULT 0 CHECK (submissionCount >= 0),
  approvalDocumentId TEXT REFERENCES documents(id),
  reviewStatus TEXT CHECK (reviewStatus IS NULL OR reviewStatus IN ('pending','approved','rejected')),
  decidedBy TEXT REFERENCES users(id),
  decidedAt TEXT,
  decisionNotes TEXT NOT NULL DEFAULT '',
  CHECK (reviewStatus IS NULL OR reviewStatus = 'pending' OR (decidedAt IS NOT NULL AND approvalDocumentId IS NOT NULL))
);
CREATE INDEX idx_distribution_status ON distribution_contracts(reviewStatus);
