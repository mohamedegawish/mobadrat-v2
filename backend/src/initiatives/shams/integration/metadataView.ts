/**
 * F-02 (قرار المشروع 3): عرض API الربط للطلبات = بيانات وصفية فقط، ببناء صريح حقلًا حقلًا.
 * لا يمر من buildDetail/buildListItem ولا يحذف حقولًا من عرض كامل: أي عمود أو قسم جديد في الطلب لا يظهر هنا إلا بإضافته يدويًا
 * بقرار موثق (والاختبار يقارن مجموعة المفاتيح بالضبط).
 *
 * مستبعد عمدًا: اسم الشركة ورقم السجل الصناعي ومساحة الأسطح والرقم الضريبي وبيانات الفورم كلها والاتصال، وبيانات المنشأة من السجل،
 * وأسباب القرارات وملاحظات النواقص، وقيم التعاقد وملاحظات البنك، وبيانات مقدم الخدمة، والمستندات (أسماء وبصمات وروابط)،
 * وأسماء المستخدمين ومعرفات جهاتهم، ومعرف المصنع، ورقم الإصدار والمحاولة.
 */
import type { AppRow, TransitionRow } from '../store/applications.js';
import { listTransitions } from '../store/applications.js';
import { getOrganization } from '../store/organizations.js';
import { responsibleInfo, slaInfo } from '../workflow/applicationView.js';
import { STATE_LABELS, STATE_STEP } from '../workflow/shamsWorkflow.js';

async function bankOf(app: AppRow): Promise<{ id: string; nameAr: string; nameEn: string } | null> {
  if (!app.bankOrgId) return null;
  const o = await getOrganization(app.bankOrgId);
  return o ? { id: o.id, nameAr: o.nameAr, nameEn: o.nameEn } : null;
}

export async function metadataItem(app: AppRow) {
  const sla = slaInfo(app);
  const resp = await responsibleInfo(app);
  return {
    id: app.id,
    number: app.number,
    state: app.state,
    stateLabelAr: STATE_LABELS[app.state].ar,
    stateLabelEn: STATE_LABELS[app.state].en,
    step: STATE_STEP[app.state],
    // نوع الجهة المسؤولة فقط — بدون اسمها ومعرفها (اسم جهة المصنع هو اسم الشركة).
    responsible: { type: resp.type, labelAr: resp.labelAr, labelEn: resp.labelEn },
    submittedAt: app.submittedAt,
    stateEnteredAt: app.stateEnteredAt,
    closedAt: app.closedAt,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    overdue: sla.overdue,
    dueAt: sla.dueAt,
    daysInState: sla.daysInState,
    governorate: app.governorate,
    industrialZone: app.industrialZone,
    bank: await bankOf(app),
    // مسار التعاقد (بنك / شركة توزيع الكهرباء) — بيانات وصفية بلا تفاصيل (أُضيف مع مسار شركة التوزيع، migration 011).
    contractPath: app.contractPath,
  };
}

function metadataHistory(rows: TransitionRow[]) {
  return rows.map((t) => ({ fromState: t.fromState, toState: t.toState, action: t.action as string, actorRole: t.actorRole, createdAt: t.createdAt }));
}

export async function metadataDetail(app: AppRow) {
  return { ...await metadataItem(app), history: metadataHistory(await listTransitions(app.id)) };
}
