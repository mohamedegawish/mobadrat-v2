-- 009_factory_account_status — MySQL counterpart of migrations/009 (factory account acceptance before sign-in).
-- Default 'approved' keeps every existing factory unchanged; only self-registration starts at 'pending'.
ALTER TABLE factories ADD COLUMN accountStatus VARCHAR(20) NOT NULL DEFAULT 'approved'
  CHECK (accountStatus IN ('pending','under_review','correction','approved','rejected'));
ALTER TABLE factories ADD COLUMN approvedAt VARCHAR(32) NULL;
