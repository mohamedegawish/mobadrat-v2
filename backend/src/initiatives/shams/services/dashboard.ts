/**
 * لوحات الأدوار (IMC / ENCPC / PMU) — لا لوحة للبنك (G-02: البنك جهة خارجية بلا حساب): أرقام حقيقية من قاعدة البيانات بنفس نطاق رؤية الدور (listScope)،
 * و«بانتظار قراري» محسوب بـlistFlags(...).isMine (the same function buildListItem uses) نفسه الذي تعتمد عليه قائمة العمل، فيتطابق رقم البطاقة مع عدد الصفوف.
 * لا أرقام مختلقة: بطاقة بلا فلتر صادق في قائمة العمل تُرجَع بلا رابط (link = null) فلا يظهر زر ميت.
 * الأدمن له لوحة الجاهزية، والمصنع له «لوحتي» — لا يخدمهما هذا المسار.
 */
import { getDb } from '../db/database.js';
import { mapSeq } from '../http/helpers.js';
import type { SqlParam } from '../http/helpers.js';
import { listApplications, type AppRow } from '../store/applications.js';
import { listScope, visibleTransitions } from '../access/visibility.js';
import { listFlags, slaConfigured } from '../workflow/applicationView.js';
import { APPLICATION_STATES, NON_TERMINAL_STATES, STATE_LABELS, TRANSITIONS, RETIRED_ACTION_LABELS, type ApplicationState } from '../workflow/shamsWorkflow.js';
import { listProviders } from '../store/providers.js';
import { shamsPolicy } from '../config/shamsPolicy.js';
import { stuckApplications } from './readiness.js';
import { listDisputes } from './registryDisputes.js';
import { listAccountRequests } from './accounts.js';
import { listRecoveries } from './accountRecovery.js';
import { pendingKeys } from './integrationKeys.js';
import type { UserInternal } from '../store/users.js';

export type CardTone = 'pending' | 'correction' | 'approved' | 'rejected' | 'completed' | 'closed' | 'info';

/** link.param = معامل #work-queue/<param>: mine | overdue | all | حالات مفصولة بـ«-». null = بلا رابط. */
export interface DashboardCard { key: string; labelAr: string; labelEn: string; count: number; tone: CardTone; link: { view: 'work-queue'; param: string } | null; hintAr?: string; hintEn?: string }
export interface AttentionItem { key: string; labelAr: string; labelEn: string; count: number; link: { view: 'work-queue' | 'approvals' | 'providers'; param: string | null } | null }
export interface RecentItem { at: string; applicationId: string; number: string | null; companyName: string; labelAr: string; labelEn: string; toLabelAr: string; toLabelEn: string }

const ACTION_LABEL = new Map<string, { ar: string; en: string }>();
for (const t of TRANSITIONS) if (!ACTION_LABEL.has(t.action)) ACTION_LABEL.set(t.action, { ar: t.labelAr, en: t.labelEn });
ACTION_LABEL.set('provider_suspended_return', { ar: 'إرجاع آلي لرفع العرض (إيقاف مقدم الخدمة)', en: 'Automatic return to offer upload (provider suspended)' });
for (const [k, v] of Object.entries(RETIRED_ACTION_LABELS)) ACTION_LABEL.set(k, v);
// تسمية موحدة لإجراءات تتكرر بمعانٍ مختلفة بحسب المرحلة
function actionLabel(action: string, from: ApplicationState): { ar: string; en: string } {
  const exact = TRANSITIONS.find((t) => t.action === action && (t.from === from || t.from === 'ANY_NON_TERMINAL'));
  return exact ? { ar: exact.labelAr, en: exact.labelEn } : ACTION_LABEL.get(action) ?? { ar: action, en: action };
}

const scopeBase = (sql: string) => `SELECT a.id FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId WHERE ${sql}`;

/** عدد الطلبات (ضمن النطاق) التي سبق أن جرى عليها انتقال محدد — مثل «قبلتها IMC». */
async function countTransitioned(scopeSql: string, params: SqlParam[], fromState: ApplicationState, action: string): Promise<number> {
  return (await getDb().prepare(`SELECT COUNT(DISTINCT tr.applicationId) AS n FROM shams_application_transitions tr
    WHERE tr.fromState = ? AND tr.action = ? AND tr.applicationId IN (${scopeBase(scopeSql)})`).get(fromState, action, ...params) as { n: number }).n;
}

export async function buildDashboard(user: UserInternal) {
  const scope = listScope(user);
  // PA-04 (2026-11-06 audit): the per-state counts come from one GROUP BY, and the per-application flags (awaiting me,
  // overdue, bank choice/outcome) are computed only over the non-terminal rows — a terminal application has no action and
  // no SLA, so the numbers are identical. Before, every application in scope (about 80 % closed history) was loaded and
  // run through listFlags on every dashboard view.
  const stateRows = await getDb().prepare(`SELECT a.state AS state, COUNT(*) AS n FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId
    WHERE ${scope.sql} AND a.state <> 'DRAFT' GROUP BY a.state`).all(...scope.params) as Array<{ state: ApplicationState; n: number }>;
  const byState = Object.fromEntries(APPLICATION_STATES.map((s) => [s, 0])) as Record<ApplicationState, number>;
  for (const r of stateRows) byState[r.state] = Number(r.n);
  const totalInScope = stateRows.reduce((sum, r) => sum + Number(r.n), 0);
  const apps: AppRow[] = (await listApplications({ scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: false, states: [...NON_TERMINAL_STATES] }, 1, 1, true)).rows;
  const items = await mapSeq(apps, async (a) => ({ a, item: await listFlags(user, a) }));
  const n = (...states: ApplicationState[]) => states.reduce((sum, s) => sum + byState[s], 0);
  // المرحلة الأخيرة (G-01): قبل اختيار مسار التعاقد (بنك أو شركة توزيع) / بعد اختيار البنك وقبل تسجيل النتيجة.
  const awaitingBankChoice = items.filter(({ a }) => a.state === 'CONTRACT_OUTCOME' && !a.bankOrgId).length;
  const awaitingOutcome = items.filter(({ a }) => a.state === 'CONTRACT_OUTCOME' && a.bankOrgId).length;
  const awaitingMe = items.filter((x) => x.item.isMine).length;
  const overdue = items.filter((x) => x.item.overdue).length;
  const sla = slaConfigured();
  const link = (...states: ApplicationState[]) => ({ view: 'work-queue' as const, param: states.join('-') });
  const card = (key: string, labelAr: string, labelEn: string, count: number, tone: CardTone, l: DashboardCard['link'], hint?: { ar: string; en: string }): DashboardCard =>
    ({ key, labelAr, labelEn, count, tone, link: l, ...(hint ? { hintAr: hint.ar, hintEn: hint.en } : {}) });

  const cards: DashboardCard[] = [];
  const attention: AttentionItem[] = [];
  let extra: Record<string, unknown> = {};

  switch (user.role) {
    case 'imc_reviewer':
      cards.push(
        card('correction', 'بانتظار استيفاء المصنع', 'Awaiting factory completion', n('IMC_CORRECTION'), 'correction', link('IMC_CORRECTION'), { ar: 'طلبات تحتاج متابعة', en: 'Follow-up needed' }),
        card('accepted', 'قبلتها IMC', 'Accepted by IMC', await countTransitioned(scope.sql, scope.params, 'IMC_REVIEW', 'accept'), 'approved', null, { ar: 'أُحيلت إلى ENCPC', en: 'Sent on to ENCPC' }),
        card('rejected', 'مرفوضة', 'Rejected', n('REJECTED'), 'rejected', link('REJECTED')),
      );
      break;
    case 'encpc_reviewer': {
      cards.push(
        card('correction', 'بانتظار تصحيح المصنع', 'Awaiting factory correction', n('ENCPC_CORRECTION'), 'correction', link('ENCPC_CORRECTION'), { ar: 'طلبات تحتاج متابعة', en: 'Follow-up needed' }),
        card('compliant', 'مطابقة فنيًا', 'Technically compliant', await countTransitioned(scope.sql, scope.params, 'ENCPC_REVIEW', 'compliant'), 'approved', null, { ar: 'فُتح لها اختيار مقدم الخدمة', en: 'Provider selection unlocked' }),
      );
      const dir = await listProviders();
      extra = {
        providers: {
          total: dir.length, visible: dir.filter((p) => p.isActive === 1 && (shamsPolicy.providerApprovalRequired ? p.status === 'approved' : p.status !== 'suspended')).length,
          inactive: dir.filter((p) => p.isActive !== 1).length,
          awaitingApproval: shamsPolicy.providerApprovalRequired ? dir.filter((p) => p.isActive === 1 && p.status === 'pending').length : 0,
          approvalRequired: shamsPolicy.providerApprovalRequired,
        },
      };
      break;
    }
    case 'pmu_reviewer': {
      const stuck = await stuckApplications();
      const disputes = (await listDisputes()).filter((d) => d.status === 'open').length;
      const recoveries = (await listRecoveries()).filter((r) => r.status === 'pending_approval').length;
      const accountRequests = (await listAccountRequests(user)).length;
      const keys = (await pendingKeys(user)).length;
      const providersAwaiting = shamsPolicy.providerApprovalRequired ? (await listProviders()).filter((p) => p.isActive === 1 && p.status === 'pending').length : 0;
      cards.push(
        card('offer', 'عروض فنية بانتظار المراجعة', 'Technical offers to review', n('OFFER_REVIEW'), 'pending', link('OFFER_REVIEW')),
        card('electricity', 'موافقات كهرباء بانتظار المراجعة', 'Electricity approvals to review', n('ELECTRICITY_REVIEW'), 'pending', link('ELECTRICITY_REVIEW'),
          { ar: 'قبولها يفتح للمصنع اختيار مسار التعاقد', en: 'Accepting it lets the factory choose the contracting path' }),
        card('distribution', 'موافقات شركة التوزيع بانتظار المراجعة', 'Distribution company approvals to review', n('DISTRIBUTION_REVIEW'), 'pending', link('DISTRIBUTION_REVIEW'),
          { ar: 'قرار نهائي: القبول = تم التعاقد، والرفض يغلق الطلب', en: 'Final decision: accept = contracted, reject closes the application' }),
        card('bank-choice', 'بانتظار اختيار المصنع لمسار التعاقد', 'Awaiting the factory’s contracting path choice', awaitingBankChoice, 'info', null),
        card('distribution-upload', 'بانتظار رفع المصنع لموافقة شركة التوزيع', 'Awaiting the factory’s distribution approval upload', n('DISTRIBUTION_UPLOAD'), 'info', link('DISTRIBUTION_UPLOAD')),
        card('outcome', 'بانتظار تسجيل نتيجة التعاقد (تعامل مع البنك خارج المنصة)', 'Awaiting the contract outcome (bank handled outside the platform)', awaitingOutcome, 'pending', null),
        card('correction', 'بانتظار تصحيح المصنع', 'Awaiting factory corrections', n('IMC_CORRECTION', 'ENCPC_CORRECTION', 'OFFER_CORRECTION'), 'correction', link('IMC_CORRECTION', 'ENCPC_CORRECTION', 'OFFER_CORRECTION')),
        card('completed', 'مكتملة (تم التعاقد)', 'Completed (contracted)', n('CONTRACTED'), 'completed', link('CONTRACTED')),
        card('rejected', 'مرفوضة', 'Rejected', n('REJECTED'), 'rejected', link('REJECTED')),
        card('closed', 'مغلقة بلا تعاقد أو منسحبة', 'Closed without contract or withdrawn', n('CLOSED_NOT_CONTRACTED', 'WITHDRAWN'), 'closed', link('CLOSED_NOT_CONTRACTED', 'WITHDRAWN')),
      );
      if (sla && overdue) attention.push({ key: 'overdue', labelAr: 'طلبات متأخرة عن المهلة', labelEn: 'Overdue applications', count: overdue, link: { view: 'work-queue', param: 'overdue' } });
      if (stuck.length) attention.push({ key: 'stuck', labelAr: 'طلبات عالقة بلا جهة تعمل عليها', labelEn: 'Stuck applications (no one can act)', count: stuck.length, link: null });
      if (disputes) attention.push({ key: 'disputes', labelAr: 'نزاعات أرقام سجل مفتوحة', labelEn: 'Open registry-number disputes', count: disputes, link: { view: 'approvals', param: null } });
      if (providersAwaiting) attention.push({ key: 'providers', labelAr: 'مقدمو خدمة بانتظار اعتمادكم', labelEn: 'Providers awaiting your approval', count: providersAwaiting, link: { view: 'providers', param: null } });
      if (recoveries) attention.push({ key: 'recovery', labelAr: 'طلبات استرداد حسابات بانتظار موافقتكم', labelEn: 'Account recovery requests awaiting approval', count: recoveries, link: { view: 'approvals', param: null } });
      if (accountRequests) attention.push({ key: 'accounts', labelAr: 'طلبات حسابات بانتظار موافقتكم', labelEn: 'Account requests awaiting approval', count: accountRequests, link: { view: 'approvals', param: null } });
      if (keys) attention.push({ key: 'keys', labelAr: 'مفاتيح ربط بانتظار الاعتماد', labelEn: 'Integration keys awaiting approval', count: keys, link: { view: 'approvals', param: null } });
      extra = {
        byStage: APPLICATION_STATES.filter((s) => s !== 'DRAFT').map((s) => ({ state: s, labelAr: STATE_LABELS[s].ar, labelEn: STATE_LABELS[s].en, count: byState[s] })),
        drafts: (await getDb().prepare(`SELECT COUNT(*) AS n FROM shams_applications WHERE state = 'DRAFT'`).get() as { n: number }).n,
        stuck: stuck.slice(0, 5).map((s) => ({ id: s.id, number: s.number, companyName: s.companyName, reasonAr: s.reasonAr, reasonEn: s.reasonEn })),
      };
      break;
    }
    default: break;
  }
  if (sla && overdue && user.role !== 'pmu_reviewer') attention.push({ key: 'overdue', labelAr: 'طلبات متأخرة عن المهلة', labelEn: 'Overdue applications', count: overdue, link: { view: 'work-queue', param: 'overdue' } });

  return {
    role: user.role,
    awaitingMe: { count: awaitingMe, link: { view: 'work-queue' as const, param: 'mine' } },
    total: totalInScope,
    /** Open (submitted, not closed) applications in scope, and how many of them are past their stage deadline. */
    open: apps.length,
    overdue,
    slaConfigured: sla,
    cards,
    attention,
    recent: await recentActivity(user, scope),
    ...extra,
    generatedAt: new Date().toISOString(),
  };
}

/** آخر 10 أحداث ضمن ما يحق للدور رؤيته (نفس visibleTransitions). */
async function recentActivity(user: UserInternal, scope: { sql: string; params: SqlParam[] }): Promise<RecentItem[]> {
  const db = getDb();
  const rows = await db.prepare(`SELECT tr.*, a.number AS number, a.companyName AS companyName FROM shams_application_transitions tr JOIN shams_applications a ON a.id = tr.applicationId
    WHERE tr.applicationId IN (${scopeBase(scope.sql)}) AND tr.fromState <> 'DRAFT' ORDER BY tr.createdAt DESC, tr.rowid DESC LIMIT 60`).all(...scope.params) as Array<Record<string, unknown>>;
  const out: RecentItem[] = [];
  for (const r of rows) {
    const tr = { ...(r as object), payload: {} } as never as Parameters<typeof visibleTransitions>[1][number];
    if (!visibleTransitions(user, [tr]).length) continue;
    const from = r.fromState as ApplicationState;
    const to = r.toState as ApplicationState;
    const l = actionLabel(String(r.action), from);
    out.push({ at: String(r.createdAt), applicationId: String(r.applicationId), number: (r.number as string | null) ?? null, companyName: String(r.companyName),
      labelAr: l.ar, labelEn: l.en, toLabelAr: STATE_LABELS[to].ar, toLabelEn: STATE_LABELS[to].en });
    if (out.length >= 10) break;
  }
  return out;
}
