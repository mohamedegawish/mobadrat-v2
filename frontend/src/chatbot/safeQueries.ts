// الاستعلامات الآمنة — البوابة الوحيدة للبوت إلى البيانات الحية.
// القاعدة الصارمة: لا fetch مباشر، لا أسرار، لا SQL — فقط عميل api المنصة
// (نفس جلسة المستخدم وصلاحياته).
import { api } from '../platform/api';
import { store as platform } from '../platform/store';
import type { SafeQueryName, SafeContext } from './contract';

// نمط معرف المبادرة المسموح — يمنع حقن المسارات (path traversal / injection).
const INITIATIVE_ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

// سقف طول أي مدخل نصي — يمنع إغراق الذاكرة أو تجاوز الحدود.
const MAX_INPUT_LEN = 200;

/** يتحقق من طول النص ضمن السقف المسموح. */
function assertLen(v: string, what: string): void {
  if (v.length > MAX_INPUT_LEN) throw new Error(`${what}-too-long`);
}

/**
 * ينفذ استعلاماً مقيداً مسبقاً فقط — أي اسم خارج القائمة يرمي Error.
 * التقليم (projection) مقصود: لا تتسرب للبوت إلا الحقول المصرح بها أدناه.
 */
export async function runSafeQuery(
  name: SafeQueryName,
  args: { initiativeId?: string },
  ctx: SafeContext,
): Promise<unknown> {
  switch (name) {
    case 'listInitiatives': {
      // قائمة عامة مقيدة: أول 20 مبادرة فقط.
      const rows = (await api.initiatives()).slice(0, 20);
      // تقليم: {id, titleAr, status} فقط — لا موازنات ولا صور ولا حقول داخلية.
      return rows.map((it) => ({ id: String(it.id ?? ''), titleAr: String(it.titleAr ?? ''), status: String(it.status ?? '') }));
    }
    case 'getInitiative': {
      // معرف واحد فقط — تحقق صارم من النمط والطول قبل أي نداء شبكة.
      const raw = args.initiativeId ?? '';
      assertLen(raw, 'initiativeId');
      if (!INITIATIVE_ID_RE.test(raw)) throw new Error('invalid-initiativeId');
      const it = await api.initiative(raw);
      // تقليم: {id, titleAr, taglineAr, status} فقط.
      return { id: String(it.id ?? ''), titleAr: String(it.titleAr ?? ''), taglineAr: String(it.taglineAr ?? ''), status: String(it.status ?? '') };
    }
    case 'myApps': {
      // طلبات المستخدم الخاصة — تتطلب تسجيل دخول (نفس جلسة المستخدم): حالة طلبه في كل مبادرة مسجل فيها.
      if (!ctx.isLoggedIn) throw new Error('login-required');
      const me = (await platform.reloadMe()) ?? platform.get().me;
      // تقليم: {applicationNumber, status, initiativeTitleAr} فقط — لا أسماء مصانع ولا مبالغ.
      return (me?.memberships ?? []).filter((m) => m.card).slice(0, 5).map((m) => ({
        applicationNumber: String(m.card?.applicationNumber ?? ''),
        status: String(m.card?.statusAr ?? ''),
        initiativeTitleAr: String(m.titleAr ?? ''),
      }));
    }
    default:
      // switch صارم: أي اسم غير معروف — حتى لو تسرب نوعاً — مرفوض هنا.
      throw new Error(`unknown-query:${String(name).slice(0, 50)}`);
  }
}
