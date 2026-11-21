-- 009_factory_account_status — قبول حساب المصنع قبل الدخول.
-- المصنع المسجَّل ذاتيًا لا يدخل المنصة إلا بعد تفعيل بريده وقبول IMC لطلب تسجيله (قرار المراجعة الأولى):
--   pending       سُجّل ولم يُرسل طلبه لـIMC بعد (قبل تفعيل البريد، أو تعذر الإرسال الآلي عند التفعيل)
--   under_review  طلب التسجيل لدى IMC — لا دخول
--   correction    طلبت IMC تعديل بيانات — دخول مقيّد بتعديل البنود وإعادة الإرسال
--   approved      قبلته IMC — دخول كامل
--   rejected      رفضته IMC — لا دخول
-- الافتراضي 'approved': كل المصانع الموجودة (والمنشأة بأمر CLI أو البذرة) تبقى كما هي؛ التسجيل الذاتي وحده يبدأ بـ'pending'.
ALTER TABLE factories ADD COLUMN accountStatus TEXT NOT NULL DEFAULT 'approved'
  CHECK (accountStatus IN ('pending','under_review','correction','approved','rejected'));
ALTER TABLE factories ADD COLUMN approvedAt TEXT;
