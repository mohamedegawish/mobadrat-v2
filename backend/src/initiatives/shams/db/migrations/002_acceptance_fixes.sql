-- 002_acceptance_fixes — جداول إصلاحات مراجعة القبول (docs/FIX_REPORT.md): سجل الإحالات السابقة،
-- تعارضات رقم السجل الصناعي، وحظر إعادة استخدام الرقم بعد رفض «عدم تطابق الملكية».

-- I4: كل إحالة سابقة قبل إعادة الإحالة لبنك آخر (الإحالة الحالية تبقى في bank_referrals).
CREATE TABLE bank_referral_history (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  bankOrgId TEXT NOT NULL REFERENCES organizations(id),
  referredAt TEXT NOT NULL,
  referredBy TEXT REFERENCES users(id),
  endedAt TEXT NOT NULL,
  endedBy TEXT REFERENCES users(id),
  endReason TEXT NOT NULL CHECK (length(endReason) >= 3),
  transitionId TEXT NOT NULL REFERENCES application_transitions(id)
);
CREATE INDEX idx_ref_history_app ON bank_referral_history(applicationId);

-- I3: محاولة إرسال برقم سجل محجوز بطلب مفتوح لمصنع آخر (DUPLICATE_REGISTRY).
CREATE TABLE registry_conflicts (
  id TEXT PRIMARY KEY,
  registryNumber TEXT NOT NULL,
  attemptedApplicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  attemptedFactoryId TEXT NOT NULL REFERENCES factories(id),
  holdingApplicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  attemptedBy TEXT REFERENCES users(id),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  createdAt TEXT NOT NULL,
  lastAttemptAt TEXT NOT NULL,
  UNIQUE (attemptedApplicationId, holdingApplicationId)
);
CREATE INDEX idx_conflicts_holding ON registry_conflicts(holdingApplicationId);
CREATE INDEX idx_conflicts_registry ON registry_conflicts(registryNumber);

-- I3: رفض IMC بسبب registry_ownership_mismatch يمنع نفس المصنع من الرقم نفسه حتى إجراء موثق من PMU.
CREATE TABLE registry_blocks (
  id TEXT PRIMARY KEY,
  factoryId TEXT NOT NULL REFERENCES factories(id),
  registryNumber TEXT NOT NULL,
  applicationId TEXT NOT NULL REFERENCES applications(id),
  transitionId TEXT NOT NULL REFERENCES application_transitions(id),
  createdBy TEXT REFERENCES users(id),
  createdAt TEXT NOT NULL,
  releasedAt TEXT,
  releasedBy TEXT REFERENCES users(id),
  releaseReason TEXT NOT NULL DEFAULT '',
  releaseReference TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_blocks_factory ON registry_blocks(factoryId, registryNumber);
CREATE UNIQUE INDEX ux_blocks_active ON registry_blocks(factoryId, registryNumber) WHERE releasedAt IS NULL;
