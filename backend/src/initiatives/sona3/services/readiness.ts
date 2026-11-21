/**
 * جاهزية التشغيل — مصدر واحد للوحة الأدمن و`npm run check:readiness`.
 * كل شرط غير مستوفى = طريق مغلق محتمل: طلب يصل لجهة لا يعمل فيها أحد، أو دورة غير مفتوحة، أو رسالة لم تصل.
 */
import { getDb } from '../db/sqlite.js';
import { config } from '../config.js';
import { ORG_IDS } from '../domain.js';
import { listOrganizations, activeStaffCount, getOrganization } from '../store/organizations.js';
import { listExperts } from '../store/experts.js';
import { openCohort, listCohorts } from '../store/cohorts.js';
import { listApplications, type AppRow } from '../store/applications.js';
import { STATE_LABELS, STATE_RESPONSIBLE, isTerminal, responsibleOrgId } from '../workflow/workflow.js';

export interface ReadinessCheck {
  key: string; ok: boolean; labelAr: string; labelEn: string; detailAr: string; detailEn: string;
  items?: Array<{ id: string; labelAr: string; labelEn: string; extraAr?: string; extraEn?: string }>;
}

export interface StuckApplication { id: string; number: string | null; projectName: string; state: AppRow['state']; stateLabelAr: string; stateLabelEn: string; reasonAr: string; reasonEn: string }

/** طلب مفتوح ينتظر جهة لا يوجد فيها مستخدم نشط. */
export function stuckApplications(): StuckApplication[] {
  const apps = listApplications({ scopeSql: '1 = 1', scopeParams: [] }, 1, 1, true).rows.filter((a) => !isTerminal(a.state));
  const out: StuckApplication[] = [];
  for (const a of apps) {
    const resp = STATE_RESPONSIBLE[a.state];
    if (resp === 'applicant' || resp === 'none') continue;
    const orgId = responsibleOrgId(a);
    const org = orgId ? getOrganization(orgId) : null;
    if (!orgId || !org || !org.isActive || activeStaffCount(orgId) === 0) {
      out.push({
        id: a.id, number: a.number, projectName: a.projectName, state: a.state, stateLabelAr: STATE_LABELS[a.state].ar, stateLabelEn: STATE_LABELS[a.state].en,
        reasonAr: `الجهة المسؤولة (${org?.nameAr ?? 'غير محددة'}) بلا مستخدم نشط`, reasonEn: `Responsible organization (${org?.nameEn ?? 'unknown'}) has no active user`,
      });
    }
  }
  return out;
}

export function readinessReport() {
  const db = getDb();
  const checks: ReadinessCheck[] = [];
  const structural = [ORG_IDS.imc, ORG_IDS.committee];
  const orgs = listOrganizations({});
  const staffless = orgs.filter((o) => (structural.includes(o.id as never) || (o.type === 'funder' && o.isActive)) && activeStaffCount(o.id) === 0);
  checks.push({
    key: 'orgs_without_users', ok: staffless.length === 0,
    labelAr: 'كل جهة لها مستخدم نشط', labelEn: 'Every organization has an active user',
    detailAr: staffless.length ? `${staffless.length} جهة بلا مستخدم نشط — أي طلب يصلها لن يراه أحد.` : 'IMC ولجنة التقييم وكل جهة تمويل نشطة لها مستخدم نشط.',
    detailEn: staffless.length ? `${staffless.length} organization(s) without an active user.` : 'All structural organizations and active funders have an active user.',
    items: staffless.map((o) => ({ id: o.id, labelAr: o.nameAr, labelEn: o.nameEn })),
  });
  const cohort = openCohort();
  checks.push({
    key: 'open_cohort', ok: Boolean(cohort),
    labelAr: 'دورة تقديم مفتوحة', labelEn: 'An open application cohort',
    detailAr: cohort ? `الدورة المفتوحة: ${cohort.nameAr} (حتى ${cohort.closesAt}).` : `لا توجد دورة مفتوحة (${listCohorts().length} دورة معرّفة) — لا يستطيع أي متقدم إنشاء طلب.`,
    detailEn: cohort ? `Open cohort: ${cohort.nameEn || cohort.nameAr} (until ${cohort.closesAt}).` : 'No open cohort — applicants cannot start applications.',
  });
  const evaluators = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'evaluator' AND isActive = 1").get() as { n: number }).n;
  checks.push({
    key: 'evaluators_available', ok: evaluators > 0,
    labelAr: 'مقيّم نشط واحد على الأقل', labelEn: 'At least one active evaluator',
    detailAr: evaluators ? `${evaluators} مقيّم نشط.` : 'لا يوجد مقيّم نشط — لن تتمكن IMC من إحالة أي دراسة للجنة التقييم.',
    detailEn: evaluators ? `${evaluators} active evaluator(s).` : 'No active evaluator — studies cannot be referred to the committee.',
  });
  const funders = orgs.filter((o) => o.type === 'funder' && o.isActive && activeStaffCount(o.id) > 0);
  checks.push({
    key: 'funders_available', ok: funders.length > 0,
    labelAr: 'جهة تمويل متاحة واحدة على الأقل', labelEn: 'At least one available funder',
    detailAr: funders.length ? `${funders.length} جهة تمويل نشطة بمستخدمين.` : 'لا توجد جهة تمويل نشطة بمستخدم نشط — لن تتمكن IMC من إحالة المشروعات المعتمدة.',
    detailEn: funders.length ? `${funders.length} active funder(s) with users.` : 'No active funder with an active user — approved projects cannot be referred.',
  });
  const experts = listExperts({ status: 'approved' });
  checks.push({
    key: 'experts_approved', ok: experts.length > 0,
    labelAr: 'خبير معتمد واحد على الأقل (اختياري للمتقدم)', labelEn: 'At least one approved expert (optional for applicants)',
    detailAr: experts.length ? `${experts.length} خبير معتمد في الدليل.` : 'دليل الخبراء فارغ — لا يجد المتقدم من يدعمه في إعداد الدراسة.',
    detailEn: experts.length ? `${experts.length} approved expert(s).` : 'The expert directory is empty.',
  });
  const stuck = stuckApplications();
  checks.push({
    key: 'stuck_applications', ok: stuck.length === 0,
    labelAr: 'لا توجد طلبات عالقة', labelEn: 'No stuck applications',
    detailAr: stuck.length ? `${stuck.length} طلب ينتظر جهة غير متاحة.` : 'كل الطلبات المفتوحة لها من يعمل عليها.',
    detailEn: stuck.length ? `${stuck.length} application(s) waiting on an unavailable party.` : 'Every open application has someone to act on it.',
    items: stuck.map((s) => ({ id: s.id, labelAr: `${s.number ?? 'مسودة'} — ${s.projectName}`, labelEn: `${s.number ?? 'Draft'} — ${s.projectName}`, extraAr: s.reasonAr, extraEn: s.reasonEn })),
  });
  const failed = (db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'failed'").get() as { n: number }).n;
  checks.push({
    key: 'failed_notifications', ok: failed === 0,
    labelAr: 'لا توجد رسائل فاشلة', labelEn: 'No failed messages',
    detailAr: failed ? `${failed} رسالة فشل إرسالها بعد كل المحاولات — راجع «سجل الإشعارات».` : 'لا توجد رسائل فاشلة.',
    detailEn: failed ? `${failed} message(s) failed after all retries.` : 'No failed messages.',
  });
  const support = Boolean(config.supportEmail && config.supportPhone);
  checks.push({
    key: 'support_contact', ok: support,
    labelAr: 'قناة استفسار رسمية مضبوطة', labelEn: 'Official support channel configured',
    detailAr: support ? 'SUPPORT_EMAIL وSUPPORT_PHONE مضبوطان.' : 'SUPPORT_EMAIL أو SUPPORT_PHONE غير مضبوط — المتقدم لا يعرف كيف يستفسر أو يتظلم.',
    detailEn: support ? 'SUPPORT_EMAIL and SUPPORT_PHONE are set.' : 'SUPPORT_EMAIL or SUPPORT_PHONE is missing.',
  });
  const skipped = (db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'skipped'").get() as { n: number }).n;
  const pending = (db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE status IN ('pending','sending')").get() as { n: number }).n;
  return {
    ok: checks.every((c) => c.ok),
    checks,
    stuck,
    notifications: { failed, skipped, pending },
    generatedAt: new Date().toISOString(),
  };
}
