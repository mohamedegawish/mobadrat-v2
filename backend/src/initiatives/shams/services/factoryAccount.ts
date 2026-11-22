/**
 * قبول حساب المصنع المسجَّل ذاتيًا (factories.accountStatus — migration 009).
 * قرار IMC في المراجعة الأولى هو قرار الحساب، دون أي تغيير في منطق IMC نفسه:
 *   إرسال / إعادة إرسال → under_review (لا دخول)        طلب استيفاء → correction (دخول مقيّد بتعديل البنود)
 *   قبول (IMC_REVIEW → ENCPC_REVIEW) → approved (دخول كامل) رفض → rejected (لا دخول)
 * المصنع approved لا يتأثر بعدها بأي انتقال (طلبات لاحقة أو مراحل أخرى).
 */
import { getFactory, setFactoryAccountStatus, type FactoryAccountStatus } from '../store/factories.js';
import { addAuditLog } from '../store/audit.js';
import type { AppRow } from '../store/applications.js';
import type { ApplicationState, ActionName } from '../workflow/shamsWorkflow.js';
import type { UserInternal } from '../store/users.js';

/** حدث الحساب الذي يغيّر إيميل المصنع (قالب account.* بدل app.*). */
export type AccountEvent = 'under_review' | 'approved' | 'correction_requested' | 'rejected';

const LABEL_AR: Record<FactoryAccountStatus, string> = {
  pending: 'بانتظار الإرسال للمراجعة', under_review: 'قيد مراجعة IMC', correction: 'مطلوب تعديل بيانات', approved: 'مقبول', rejected: 'مرفوض',
};

/** الحالة الجديدة للحساب بعد هذا الانتقال، أو null إن لم يتغير شيء. */
function nextStatus(from: ApplicationState, to: ApplicationState, action: ActionName): { status: FactoryAccountStatus; event: AccountEvent } | null {
  if (to === 'IMC_REVIEW' && (action === 'submit' || action === 'resubmit')) return { status: 'under_review', event: 'under_review' };
  if (to === 'IMC_CORRECTION') return { status: 'correction', event: 'correction_requested' };
  if (from === 'IMC_REVIEW' && to === 'ENCPC_REVIEW') return { status: 'approved', event: 'approved' };
  if (from === 'IMC_REVIEW' && to === 'REJECTED') return { status: 'rejected', event: 'rejected' };
  return null;
}

/**
 * يُستدعى داخل معاملة الانتقال نفسها (performAction). يرجع حدث الحساب لإيميل المصنع، أو null لمصنع مقبول أو انتقال لا يخص الحساب.
 * المنصة الموحدة: حالة الحساب تقيّد شاشات المبادرة فقط (middleware/factoryAccess) ولا تُنهي جلسة المنصة —
 * صاحب المصنع يبقى قادرًا على الدخول لمبادراته الأخرى.
 */
export async function syncFactoryAccount(app: AppRow, from: ApplicationState, to: ApplicationState, action: ActionName, actor: UserInternal, ip: string): Promise<AccountEvent | null> {
  const factory = await getFactory(app.factoryId);
  if (!factory || factory.accountStatus === 'approved') return null;
  const next = nextStatus(from, to, action);
  if (!next || next.status === factory.accountStatus) return null;
  await setFactoryAccountStatus(factory.id, next.status);
  await addAuditLog({
    actorType: 'user', actorUserId: actor.id, actorName: actor.nameAr, actorRole: actor.role, actorOrgId: actor.organizationId, ip,
    action: 'factory.account_status', entityType: 'factory', entityId: factory.id, applicationId: app.id,
    summaryAr: `حساب المصنع: ${LABEL_AR[factory.accountStatus]} ← ${LABEL_AR[next.status]}`,
    details: { from: factory.accountStatus, to: next.status, applicationState: to },
  });
  return next.event;
}

/** رسائل منع الدخول على شاشات المبادرة (لا تمنع الدخول للمنصة). null = مسموح (كامل أو مقيّد). */
export function accountLoginBlock(status: FactoryAccountStatus | null): { code: string; ar: string; en: string } | null {
  if (status === 'under_review') {
    return { code: 'ACCOUNT_UNDER_REVIEW', ar: 'طلب تسجيل مصنعكم في مبادرة «شمس الصناعة» قيد مراجعة مركز تحديث الصناعة (IMC). ستصلكم رسالة على البريد بالقرار، وتُفتح لوحة المبادرة بعد قبول الحساب.',
      en: 'Your factory registration in Shams El-Senaa is under IMC review. You will be emailed the decision; the initiative dashboard opens once it is approved.' };
  }
  if (status === 'rejected') {
    return { code: 'ACCOUNT_REJECTED', ar: 'لم يُقبل طلب تسجيل هذا المصنع في مبادرة «شمس الصناعة». سبب القرار مرسل على بريدكم — للاستفسار تواصلوا مع الدعم. حسابكم على المنصة يبقى صالحًا لباقي المبادرات.',
      en: 'This factory registration in Shams El-Senaa was not approved. The reason was emailed to you. Your platform account stays valid for the other initiatives.' };
  }
  return null;
}

/** المصنع غير المقبول بعد (دخول مقيّد بتعديل طلبه وإرساله فقط). */
export function isRestrictedFactory(u: UserInternal): boolean {
  return u.role === 'factory_owner' && u.factoryAccountStatus !== null && u.factoryAccountStatus !== 'approved';
}
