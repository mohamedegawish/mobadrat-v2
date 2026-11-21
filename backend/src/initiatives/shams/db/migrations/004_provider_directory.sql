-- 004_provider_directory — دليل مقدمي الخدمة تديره ENCPC (الاسم + التفاصيل + الشعار + التفعيل).
-- إضافات فقط: لا حذف ولا تغيير لأي عمود موجود، والصفوف الحالية تبقى ظاهرة كما كانت (isActive = 1).
-- الاعتماد (status: pending/approved/suspended) يبقى كما هو ويُفعَّل بقرار PMU ما دام shamsPolicy.providerApprovalRequired = true (★).

ALTER TABLE service_providers ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE service_providers ADD COLUMN isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1));
ALTER TABLE service_providers ADD COLUMN deactivatedBy TEXT REFERENCES users(id);
ALTER TABLE service_providers ADD COLUMN deactivatedAt TEXT;

-- الشعار: ملف صورة صغير يُخزن بالاسم العشوائي خارج المجلد العام ويُقدَّم عبر API بعد فحص الصلاحية.
ALTER TABLE service_providers ADD COLUMN logoStoredName TEXT;
ALTER TABLE service_providers ADD COLUMN logoMime TEXT;
ALTER TABLE service_providers ADD COLUMN logoSha256 TEXT;
ALTER TABLE service_providers ADD COLUMN logoUpdatedAt TEXT;

CREATE INDEX idx_providers_active ON service_providers(isActive, status);
