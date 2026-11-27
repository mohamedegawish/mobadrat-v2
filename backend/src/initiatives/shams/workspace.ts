/**
 * Shams El-Senaa's part of the platform dashboard of each user type (core/routes/workspace.ts): the same numbers the
 * module's own screens computed (buildDashboard, the work queue, buildSummary, readinessReport), in the platform's
 * normalized shape. Nothing is counted twice: every card links to the queue filter its number was computed with.
 */
import type {
  ModuleWorkspace, WorkspaceQuery, WorkspaceLink, WorkspaceRow, WorkspaceBlock, WorkspaceFilter,
} from '../contract.js';
import { Errors } from './http/errors.js';
import { listGovernorates, findGovernorate } from './config/locations.js';
import { listActiveBanks } from './store/organizations.js';
import { listScope } from './access/visibility.js';
import { buildDashboard } from './services/dashboard.js';
import { buildSummary, STAGE_LIMIT } from './services/reports.js';
import { readinessReport } from './services/readiness.js';
import { listForUser, parseStates } from './services/applicationList.js';
import { APPLICATION_STATES, STATE_LABELS } from './workflow/shamsWorkflow.js';
import type { UserInternal } from './store/users.js';
import { isRetiredRole } from './domain.js';

type Role = UserInternal['role'];

/** The role's tool screens of the module (the dashboard itself is the platform's). */
const TOOLS: Partial<Record<Role, Array<{ view: string; labelAr: string; labelEn: string }>>> = {
  imc_reviewer: [{ view: 'approvals', labelAr: 'الموافقات', labelEn: 'Approvals' }],
  pmu_reviewer: [{ view: 'approvals', labelAr: 'الموافقات', labelEn: 'Approvals' }],
  system_admin: [
    { view: 'admin-accounts', labelAr: 'الحسابات', labelEn: 'Accounts' },
    { view: 'admin-organizations', labelAr: 'الجهات', labelEn: 'Organizations' },
    { view: 'admin-audit', labelAr: 'سجل التدقيق', labelEn: 'Audit log' },
    { view: 'admin-integration', labelAr: 'مفاتيح الربط', labelEn: 'Integration keys' },
    { view: 'admin-outbox', labelAr: 'سجل الإشعارات', labelEn: 'Notifications log' },
  ],
};

const DECIDES: Role[] = ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'electricity_reviewer'];

/** «#work-queue/<param>» of the module's dashboard → a tab of the platform dashboard. */
function toLink(l: { view: string; param: string | null } | null): WorkspaceLink | null {
  if (!l) return null;
  if (l.view !== 'work-queue') return { view: l.view };
  if (l.param === 'mine' || l.param === 'overdue' || l.param === 'all') return { tab: l.param };
  return { tab: 'all', state: (l.param ?? '').split('-').join(',') };
}

function rowOf(a: Awaited<ReturnType<typeof listForUser>>['items'][number]): WorkspaceRow {
  const gov = findGovernorate(a.governorate);
  const r = a.responsible;
  return {
    id: a.id, number: a.number, title: a.companyName,
    stateKey: a.state, stateLabelAr: a.stateLabelAr, stateLabelEn: a.stateLabelEn,
    governorateAr: gov?.labelAr ?? a.governorate ?? '', governorateEn: gov?.labelEn ?? a.governorate ?? '',
    responsibleAr: r.orgNameAr ?? r.labelAr, responsibleEn: r.orgNameEn ?? r.labelEn,
    enteredAt: a.stateEnteredAt, daysInState: a.daysInState, overdue: a.overdue, isMine: a.isMine,
    view: `application/${a.id}`,
  };
}

async function monitoring(user: UserInternal): Promise<WorkspaceBlock[]> {
  const scope = listScope(user);
  const limit = STAGE_LIMIT[user.role] ?? null;
  const s = await buildSummary({ sql: scope.sql, params: scope.params, includeDrafts: scope.includeDrafts }, limit);
  const label = (k: string) => STATE_LABELS[k as keyof typeof STATE_LABELS] ?? { ar: k, en: k };
  const blocks: WorkspaceBlock[] = [{
    key: 'by-state', titleAr: 'الطلبات حسب الحالة', titleEn: 'Applications by state', kind: 'bars',
    rows: APPLICATION_STATES.filter((k) => k !== 'DRAFT' && (s.byState[k] ?? 0) > 0)
      .map((k) => ({ key: k, labelAr: label(k).ar, labelEn: label(k).en, value: s.byState[k], link: { tab: 'all' as const, state: k } })),
    ...(limit ? { noteAr: `انتقلت إلى مراحل لاحقة: ${s.passedOnToLaterStages ?? 0}`, noteEn: `Moved on to later stages: ${s.passedOnToLaterStages ?? 0}` } : {}),
  }];
  const avg = Object.entries(s.avgDaysPerState);
  if (avg.length) {
    blocks.push({ key: 'avg-days', titleAr: 'متوسط البقاء في كل حالة', titleEn: 'Average time in each state', kind: 'table',
      rows: avg.map(([k, v]) => ({ key: k, labelAr: label(k).ar, labelEn: label(k).en, value: v.avgDays, unit: 'days' as const })) });
  }
  const returns = Object.entries(s.returnsByStage);
  if (returns.length) {
    blocks.push({ key: 'returns', titleAr: 'مرات الإرجاع للاستيفاء حسب المرحلة', titleEn: 'Returns for completion by stage', kind: 'table',
      rows: returns.map(([k, v]) => ({ key: k, labelAr: label(k).ar, labelEn: label(k).en, value: v })) });
  }
  if (s.contracted) {
    blocks.push({ key: 'contracts', titleAr: 'التعاقد', titleEn: 'Contracting', kind: 'tiles',
      rows: [
        { key: 'contracted', labelAr: 'تم التعاقد', labelEn: 'Contracted', value: s.contracted.count },
        { key: 'bank', labelAr: 'عن طريق البنك', labelEn: 'Through a bank', value: s.contracted.byPath.bank },
        { key: 'distribution', labelAr: 'عن طريق شركة التوزيع', labelEn: 'Through the distribution company', value: s.contracted.byPath.distribution },
        { key: 'amount', labelAr: 'قيمة التعاقد (يسجلها المصنع)', labelEn: 'Contract value (recorded by the factory)', value: s.contracted.totalAmount, unit: 'EGP' as const },
        { key: 'above-alert', labelAr: 'تعاقدات فوق حد التنبيه', labelEn: 'Contracts above the alert threshold', value: s.contracted.aboveAlertCount },
      ] });
  }
  if (s.byGovernorate?.length) {
    blocks.push({ key: 'by-governorate', titleAr: 'التوزيع الجغرافي', titleEn: 'By governorate', kind: 'bars',
      rows: s.byGovernorate.slice(0, 12).map((g) => {
        const gov = findGovernorate(g.governorate);
        return { key: g.governorate, labelAr: gov?.labelAr ?? g.governorate, labelEn: gov?.labelEn ?? g.governorate, value: g.count };
      }) });
  }
  return blocks;
}

export async function shamsWorkspace(actor: unknown, q: WorkspaceQuery): Promise<ModuleWorkspace> {
  const user = actor as UserInternal;
  // The module router's own guard (shamsActorGuard): a disabled account or organization, or a retired role, sees nothing.
  if (!user.isActive || !user.organizationActive || isRetiredRole(user.role)) throw Errors.forbidden('صلاحيتك في هذه المبادرة موقوفة — تواصل مع إدارة المبادرة.', 'Your access to this initiative is disabled.');
  if (user.role === 'factory_owner') throw Errors.forbidden();
  const decides = DECIDES.includes(user.role);
  const d = await buildDashboard(user);

  const sees = user.role === 'pmu_reviewer' || user.role === 'system_admin';
  const filters: WorkspaceFilter[] = [
    { key: 'governorate', labelAr: 'المحافظة', labelEn: 'Governorate', options: listGovernorates().map((g) => ({ value: g.value, labelAr: g.labelAr, labelEn: g.labelEn })) },
    ...(sees ? [{ key: 'bankOrgId', labelAr: 'البنك', labelEn: 'Bank', options: (await listActiveBanks()).map((b) => ({ value: b.id, labelAr: b.nameAr, labelEn: b.nameEn })) }] : []),
  ];

  const cards = d.cards.map((c) => ({ key: c.key, labelAr: c.labelAr, labelEn: c.labelEn, value: c.count, tone: c.tone, link: toLink(c.link), hintAr: c.hintAr, hintEn: c.hintEn }));
  const extra = d as typeof d & { drafts?: number };
  const ws: ModuleWorkspace = {
    role: user.role, decides,
    awaitingMe: decides ? d.awaitingMe.count : 0, overdue: d.overdue, open: d.open, total: d.total, slaConfigured: d.slaConfigured,
    cards,
    attention: d.attention.map((a) => ({ key: a.key, labelAr: a.labelAr, labelEn: a.labelEn, count: a.count, link: toLink(a.link) })),
    recent: d.recent.map((r) => ({ at: r.at, applicationId: r.applicationId, number: r.number, title: r.companyName, labelAr: r.labelAr, labelEn: r.labelEn, toLabelAr: r.toLabelAr, toLabelEn: r.toLabelEn })),
    states: APPLICATION_STATES.filter((s) => s !== 'DRAFT').map((s) => ({ key: s, labelAr: STATE_LABELS[s].ar, labelEn: STATE_LABELS[s].en })),
    filters, panels: [],
    tools: TOOLS[user.role] ?? [],
  };

  if (q.tab === 'mine' && !decides) {
    ws.queue = { items: [], total: 0, page: q.page, pageSize: q.pageSize, totalPages: 1 };
  } else if (q.tab === 'mine' || q.tab === 'all' || q.tab === 'overdue') {
    const allowed = new Set(filters.map((f) => f.key));
    const opt = (k: string) => (allowed.has(k) && q.filters[k]) || undefined;
    const list = await listForUser(user, {
      page: q.page, pageSize: q.pageSize, q: q.q, states: parseStates(q.state),
      mine: q.tab === 'mine', overdue: q.tab === 'overdue', sort: q.sort,
      governorate: opt('governorate'), bankOrgId: opt('bankOrgId'), from: q.from, to: q.to,
    });
    ws.draftsCount = list.draftsCount;
    ws.queue = { items: list.items.map(rowOf), total: list.total, page: list.page, pageSize: list.pageSize, totalPages: list.totalPages };
  } else if (q.tab === 'monitoring') {
    ws.monitoring = await monitoring(user);
  } else if (q.tab === 'readiness' && user.role === 'system_admin') {
    const r = await readinessReport();
    ws.readiness = { ok: r.ok, checks: r.checks, notifications: r.notifications };
  }
  if (ws.draftsCount === undefined && typeof extra.drafts === 'number') ws.draftsCount = extra.drafts;
  return ws;
}
