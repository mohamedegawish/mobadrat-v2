-- 006_history_guards — حماية السجل الرسمي للقرارات في قاعدة البيانات (دفاع في العمق، إضافات فقط).
-- لا مسار في الكود يعدّل أو يحذف هذه الصفوف؛ هذه الـtriggers تمنع ذلك حتى بـSQL مباشر أو بحذف الطلب (ON DELETE CASCADE).
-- الصفوف الحالية لا تتأثر، ولا يُغيَّر أي جدول أو عمود. (audit_logs محمية بالمثل منذ 001.)

-- الانتقالات بين الحالات: سجل قرارات كل جهة وأسبابها — إلحاق فقط.
CREATE TRIGGER transitions_no_update BEFORE UPDATE ON application_transitions BEGIN
  SELECT RAISE(ABORT, 'application_transitions is append-only');
END;
CREATE TRIGGER transitions_no_delete BEFORE DELETE ON application_transitions BEGIN
  SELECT RAISE(ABORT, 'application_transitions is append-only');
END;

-- الإحالات البنكية السابقة (بعد إعادة الإحالة) — إلحاق فقط.
CREATE TRIGGER referral_history_no_update BEFORE UPDATE ON bank_referral_history BEGIN
  SELECT RAISE(ABORT, 'bank_referral_history is append-only');
END;
CREATE TRIGGER referral_history_no_delete BEFORE DELETE ON bank_referral_history BEGIN
  SELECT RAISE(ABORT, 'bank_referral_history is append-only');
END;

-- النواقص: لا حذف، ولا تعديل لمحتواها، والتغيير الوحيد المسموح إغلاق نقص مفتوح (resolvedAtTransitionId من NULL إلى قيمة).
-- النقص المغلق نهائي (لا إعادة فتح ولا تعديل).
CREATE TRIGGER deficiencies_no_delete BEFORE DELETE ON deficiencies BEGIN
  SELECT RAISE(ABORT, 'deficiencies cannot be deleted');
END;
CREATE TRIGGER deficiencies_immutable BEFORE UPDATE ON deficiencies
WHEN OLD.resolvedAtTransitionId IS NOT NULL
  OR NEW.id <> OLD.id OR NEW.applicationId <> OLD.applicationId OR NEW.transitionId <> OLD.transitionId
  OR NEW.stage <> OLD.stage OR NEW.field <> OLD.field OR NEW.note <> OLD.note OR NEW.createdAt <> OLD.createdAt
BEGIN
  SELECT RAISE(ABORT, 'deficiency history is immutable except resolution of an open item');
END;
