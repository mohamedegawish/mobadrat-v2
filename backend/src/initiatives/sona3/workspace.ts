/**
 * Sona'a El-Mostaqbal's part of the platform dashboard of each user type (core/routes/workspace.ts): the numbers of the
 * module's own work queue, monitoring and readiness screens (listForUser, buildSummary, evaluatorQueue, readinessReport),
 * in the platform's normalized shape. Every card links to the queue filter its number was computed with.
 */
import type {
  ModuleWorkspace, WorkspaceQuery, WorkspaceRow, WorkspaceBlock, WorkspaceFilter, WorkspaceCard, WorkspaceAttention, WorkspaceRecent,
} from '../contract.js';
import { getDb } from './db/database.js';
import { Errors } from './http/errors.js';
import { mapSeq } from './http/helpers.js';
import { listApplications, getApplication } from './store/applications.js';
import { listCohorts, openCohort } from './store/cohorts.js';
import { listOrganizations } from './store/organizations.js';
import { listScope } from './access/visibility.js';
import { isMineFor, slaInfo, slaConfigured } from './workflow/applicationView.js';
import { evaluatorQueue } from './workflow/evaluationService.js';
import { buildSummary } from './services/reports.js';
import { readinessReport } from './services/readiness.js';
import { listForUser, parseStates } from './services/applicationList.js';
import { APPLICATION_STATES, STATE_LABELS, TRANSITIONS, isTerminal, type ApplicationState } from './workflow/workflow.js';
import { GOVERNORATES, findGovernorate } from './config/locations.js';
import { policy } from './config/initiativePolicy.js';
import type { UserInternal } from './store/users.js';

type Role = UserInternal['role'];

const TOOLS: Partial<Record<Role, Array<{ view: string; labelAr: string; labelEn: string }>>> = {
  imc_officer: [
    { view: 'ranking', labelAr: 'ترتيب الدورة', labelEn: 'Cohort ranking' },
    { view: 'experts', labelAr: 'الخبراء', labelEn: 'Experts' },
    { view: 'appeals', labelAr: 'التظلمات', labelEn: 'Appeals' },
  ],
  system_admin: [
    { view: 'admin-accounts', labelAr: 'الحسابات', labelEn: 'Accounts' },
    { view: 'admin-organizations', labelAr: 'الجهات', labelEn: 'Organizations' },
    { view: 'admin-cohorts', labelAr: 'الدورات', labelEn: 'Cohorts' },
    { view: 'admin-content', labelAr: 'محتوى المبادرة', labelEn: 'Initiative content' },
    { view: 'admin-audit', labelAr: 'سجل التدقيق', labelEn: 'Audit log' },
    { view: 'admin-integration', labelAr: 'مفاتيح الربط', labelEn: 'Integration keys' },
    { view: 'admin-outbox', labelAr: 'سجل الإشعارات', labelEn: 'Notifications log' },
  ],
};

/** The stage groups of the module's work queue (the same groups its own screen counted). */
const GROUPS: Array<{ key: string; ar: string; en: string; states: ApplicationState[]; tone: WorkspaceCard['tone'] }> = [
  { key: 'review', ar: 'مراجعة الأهلية والدراسة', en: 'Eligibility and study review', states: ['ELIGIBILITY_REVIEW', 'STUDY_REVIEW'], tone: 'pending' },
  { key: 'wait', ar: 'بانتظار المتقدم', en: 'With the applicant', states: ['ELIGIBILITY_CORRECTION', 'STUDY_PREPARATION', 'STUDY_CORRECTION'], tone: 'correction' },
  { key: 'eval', ar: 'التقييم والاختيار', en: 'Evaluation and selection', states: ['COMMITTEE_EVALUATION', 'EVALUATED', 'SELECTED'], tone: 'info' },
  { key: 'fund', ar: 'التمويل', en: 'Funding', states: ['FUNDING_SEARCH', 'FUNDER_REVIEW'], tone: 'pending' },
  { key: 'run', ar: 'التنفيذ والتشغيل', en: 'Implementation and operation', states: ['IMPLEMENTATION', 'OPERATING'], tone: 'approved' },
  { key: 'completed', ar: 'مكتملة', en: 'Completed', states: ['COMPLETED'], tone: 'completed' },
  { key: 'closed', ar: 'مغلقة أو مرفوضة', en: 'Closed or rejected', states: ['REJECTED', 'NOT_SELECTED', 'NOT_APPROVED', 'CLOSED_NOT_FUNDED', 'WITHDRAWN'], tone: 'closed' },
];

const DECIDES: Role[] = ['imc_officer', 'funder_reviewer'];

function actionLabel(action: string, from: ApplicationState): { ar: string; en: string } {
  const t = TRANSITIONS.find((x) => x.action === action && (x.from === from || (x.from as string) === 'ANY_NON_TERMINAL')) ?? TRANSITIONS.find((x) => x.action === action);
  return t ? { ar: t.labelAr, en: t.labelEn } : { ar: action, en: action };
}

async function recentActivity(scope: { sql: string; params: unknown[] }): Promise<WorkspaceRecent[]> {
  const rows = await getDb().prepare(`SELECT tr.applicationId, tr.fromState, tr.toState, tr.action, tr.createdAt, a.number AS number, a.projectName AS projectName
    FROM sona3_application_transitions tr JOIN sona3_applications a ON a.id = tr.applicationId
    WHERE tr.fromState <> 'DRAFT' AND tr.applicationId IN (SELECT a.id FROM sona3_applications a JOIN sona3_applicants p ON p.id = a.applicantId WHERE ${scope.sql})
    ORDER BY tr.createdAt DESC, tr.rowid DESC LIMIT 10`).all(...(scope.params as never[])) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const from = r.fromState as ApplicationState;
    const to = r.toState as ApplicationState;
    const l = actionLabel(String(r.action), from);
    return { at: String(r.createdAt), applicationId: String(r.applicationId), number: (r.number as string | null) ?? null, title: String(r.projectName ?? ''),
      labelAr: l.ar, labelEn: l.en, toLabelAr: STATE_LABELS[to]?.ar ?? to, toLabelEn: STATE_LABELS[to]?.en ?? to };
  });
}

function rowOf(a: Awaited<ReturnType<typeof listForUser>>['items'][number]): WorkspaceRow {
  const r = a.responsible;
  return {
    id: a.id, number: a.number, title: a.projectName || a.applicantName, subtitle: a.projectName ? a.applicantName : undefined,
    stateKey: a.state, stateLabelAr: a.stateLabelAr, stateLabelEn: a.stateLabelEn,
    governorateAr: a.governorateLabelAr, governorateEn: a.governorateLabelEn,
    responsibleAr: r.orgNameAr ?? r.labelAr, responsibleEn: r.orgNameEn ?? r.labelEn,
    enteredAt: a.stateEnteredAt, daysInState: a.daysInState, overdue: a.overdue, isMine: a.isMine, score: a.score,
    view: `application/${a.id}`,
  };
}

async function monitoring(user: UserInternal, cohortId?: string): Promise<WorkspaceBlock[]> {
  const includeScores = user.role === 'imc_officer' || user.role === 'funder_reviewer' || user.role === 'system_admin';
  const s = await buildSummary(listScope(user), { cohortId, includeScores });
  const k = s.kpis;
  const blocks: WorkspaceBlock[] = [
    { key: 'funnel', titleAr: 'قمع الرحلة', titleEn: 'Journey funnel', kind: 'bars', rows: [
      { key: 'applications', labelAr: 'طلبات مُرسلة', labelEn: 'Submitted', value: k.applications },
      { key: 'eligible', labelAr: 'مستوفية للأهلية', labelEn: 'Eligible', value: k.eligible },
      { key: 'studyCompleted', labelAr: 'أكملت دراسة الجدوى', labelEn: 'Study completed', value: k.studyCompleted },
      { key: 'evaluated', labelAr: 'تم تقييمها', labelEn: 'Evaluated', value: k.evaluated },
      { key: 'selected', labelAr: 'مختارة', labelEn: 'Selected', value: k.selected },
      { key: 'approved', labelAr: 'معتمدة', labelEn: 'Approved', value: k.approved },
      { key: 'funded', labelAr: 'ممولة', labelEn: 'Funded', value: k.funded },
      { key: 'operating', labelAr: 'في التشغيل', labelEn: 'Operating', value: k.operating },
    ] },
    { key: 'impact', titleAr: 'التمويل وفرص العمل', titleEn: 'Funding and jobs', kind: 'tiles', rows: [
      { key: 'applicants', labelAr: 'متقدمون', labelEn: 'Applicants', value: k.applicants },
      ...(k.selectionTarget !== null ? [{ key: 'target', labelAr: 'المستهدف اختياره', labelEn: 'Selection target', value: k.selectionTarget }] : []),
      { key: 'requested', labelAr: 'التمويل المطلوب', labelEn: 'Funding requested', value: s.funding.requested, unit: 'EGP' as const },
      { key: 'approved-funding', labelAr: 'المعتمد من جهات التمويل', labelEn: 'Approved by funders', value: s.funding.approved, unit: 'EGP' as const },
      { key: 'disbursed', labelAr: 'المصروف فعليًا', labelEn: 'Disbursed', value: s.funding.disbursed, unit: 'EGP' as const },
      { key: 'jobs-expected', labelAr: 'فرص عمل متوقعة', labelEn: 'Expected jobs', value: s.jobs.expected },
      { key: 'jobs-actual', labelAr: 'فرص عمل فعلية', labelEn: 'Actual jobs', value: s.jobs.actual },
      ...(s.averageScore && s.averageScore.value !== null ? [{ key: 'avg-score', labelAr: 'متوسط الدرجات', labelEn: 'Average score', value: s.averageScore.value }] : []),
    ] },
    { key: 'by-state', titleAr: 'الطلبات حسب الحالة', titleEn: 'Applications by state', kind: 'bars',
      rows: APPLICATION_STATES.filter((st) => st !== 'DRAFT' && (s.byState[st] ?? 0) > 0)
        .map((st) => ({ key: st, labelAr: STATE_LABELS[st].ar, labelEn: STATE_LABELS[st].en, value: s.byState[st], link: { tab: 'all' as const, state: st } })) },
  ];
  if (s.bySector.length) {
    blocks.push({ key: 'by-sector', titleAr: 'حسب القطاع', titleEn: 'By sector', kind: 'bars',
      rows: s.bySector.map((x) => ({ key: x.sector, labelAr: x.label?.labelAr ?? x.sector, labelEn: x.label?.labelEn ?? x.sector, value: x.count })) });
  }
  if (s.byGovernorate.length) {
    blocks.push({ key: 'by-governorate', titleAr: 'التوزيع الجغرافي', titleEn: 'By governorate', kind: 'bars',
      rows: s.byGovernorate.slice(0, 12).map((g) => ({ key: g.governorate, labelAr: g.label, labelEn: findGovernorate(g.governorate)?.labelEn ?? g.governorate, value: g.count })) });
  }
  const avg = Object.entries(s.avgDaysPerState).filter(([st]) => STATE_LABELS[st as ApplicationState]);
  if (avg.length) {
    blocks.push({ key: 'avg-days', titleAr: 'متوسط البقاء في كل حالة', titleEn: 'Average time in each state', kind: 'table',
      rows: avg.map(([st, v]) => ({ key: st, labelAr: STATE_LABELS[st as ApplicationState].ar, labelEn: STATE_LABELS[st as ApplicationState].en, value: v.avgDays, unit: 'days' as const })) });
  }
  return blocks;
}

/** The evaluator's part: the committee assignments (scored in the application page), not the workflow queue. */
async function evaluatorWorkspace(user: UserInternal, q: WorkspaceQuery): Promise<ModuleWorkspace> {
  const list = await evaluatorQueue(user);
  const apps = new Map((await mapSeq(list, async (x) => await getApplication(x.applicationId))).filter((a) => a).map((a) => [a!.id, a!]));
  const pending = list.filter((x) => (x.status === 'assigned' || x.status === 'draft') && x.appState === 'COMMITTEE_EVALUATION');
  const cards: WorkspaceCard[] = [
    { key: 'pending', labelAr: 'تقييمات بانتظارك', labelEn: 'Evaluations awaiting you', value: pending.length, tone: 'pending', link: { tab: 'mine' } },
    { key: 'submitted', labelAr: 'تقييمات سلّمتها', labelEn: 'Evaluations submitted', value: list.filter((x) => x.status === 'submitted').length, tone: 'approved', link: null },
    { key: 'conflict', labelAr: 'استبعاد لتضارب المصالح', labelEn: 'Excluded for a conflict of interest', value: list.filter((x) => x.status === 'conflict').length, tone: 'closed', link: null },
  ];
  const source = q.tab === 'mine' ? pending : q.tab === 'all' ? list : [];
  const needle = (q.q ?? '').trim().toLowerCase();
  const filtered = source.filter((x) => !needle || `${x.number ?? ''} ${x.projectName}`.toLowerCase().includes(needle));
  const pageRows = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
  const items: WorkspaceRow[] = pageRows.map((x) => {
    const a = apps.get(x.applicationId);
    const gov = a ? findGovernorate(a.governorate) : undefined;
    const st = (x.appState ?? 'COMMITTEE_EVALUATION') as ApplicationState;
    return {
      id: x.applicationId, number: x.number, title: x.projectName, subtitle: `${x.statusLabelAr}`,
      stateKey: st, stateLabelAr: `${STATE_LABELS[st].ar} — ${x.statusLabelAr}`, stateLabelEn: `${STATE_LABELS[st].en} — ${x.statusLabelEn}`,
      governorateAr: gov?.labelAr ?? a?.governorate ?? '', governorateEn: gov?.labelEn ?? a?.governorate ?? '',
      responsibleAr: 'لجنة التقييم', responsibleEn: 'Evaluation committee',
      enteredAt: x.assignedAt, daysInState: Math.max(0, Math.floor((Date.now() - Date.parse(x.assignedAt)) / 86_400_000)),
      overdue: false, isMine: pending.includes(x), view: `application/${x.applicationId}`,
    };
  });
  return {
    role: user.role, decides: true, awaitingMe: pending.length, overdue: 0, open: pending.length, total: list.length, slaConfigured: false,
    cards, attention: [], recent: [], states: [], filters: [], panels: [], tools: [],
    ...(q.tab === 'mine' || q.tab === 'all' || q.tab === 'overdue'
      ? { queue: { items, total: filtered.length, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(filtered.length / q.pageSize)) } }
      : {}),
  };
}

export async function sona3Workspace(actor: unknown, q: WorkspaceQuery): Promise<ModuleWorkspace> {
  const user = actor as UserInternal;
  // The module router's own guard (sona3ActorGuard): a disabled account or organization sees nothing.
  if (!user.isActive || !user.organizationActive) throw Errors.forbidden('صلاحيتك في هذه المبادرة موقوفة — تواصل مع إدارة المبادرة.', 'Your access to this initiative is disabled.');
  if (user.role === 'applicant') throw Errors.forbidden();
  if (user.role === 'evaluator') return await evaluatorWorkspace(user, q);
  const decides = DECIDES.includes(user.role);
  const scope = listScope(user);

  const stateRows = await getDb().prepare(`SELECT a.state AS state, COUNT(*) AS n FROM sona3_applications a JOIN sona3_applicants p ON p.id = a.applicantId
    WHERE ${scope.sql} AND a.state <> 'DRAFT' GROUP BY a.state`).all(...scope.params) as Array<{ state: ApplicationState; n: number }>;
  const byState = Object.fromEntries(APPLICATION_STATES.map((s) => [s, 0])) as Record<ApplicationState, number>;
  for (const r of stateRows) byState[r.state] = Number(r.n);
  const total = stateRows.reduce((sum, r) => sum + Number(r.n), 0);
  // Open rows only (a closed application has no action and no deadline): the same flags the queue filters with.
  const openRows = (await listApplications({ scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: false }, 1, 1, true)).rows.filter((a) => !isTerminal(a.state));
  const awaitingMe = decides ? openRows.filter((a) => isMineFor(user, a)).length : 0;
  const overdue = openRows.filter((a) => slaInfo(a).overdue).length;
  const sla = slaConfigured();

  const n = (states: ApplicationState[]) => states.reduce((sum, s) => sum + byState[s], 0);
  const groups = user.role === 'funder_reviewer' ? GROUPS.filter((g) => ['fund', 'run', 'completed', 'closed'].includes(g.key)) : GROUPS;
  const cards: WorkspaceCard[] = groups.map((g) => ({ key: g.key, labelAr: g.ar, labelEn: g.en, value: n(g.states), tone: g.tone, link: { tab: 'all', state: g.states.join(',') } }));
  if (user.role === 'imc_officer') {
    const cohort = await openCohort();
    const selected = n(['SELECTED', 'FUNDING_SEARCH', 'FUNDER_REVIEW', 'IMPLEMENTATION', 'OPERATING', 'COMPLETED']);
    cards.push({ key: 'selected', labelAr: 'مختارة', labelEn: 'Selected', value: selected, tone: 'approved', link: { view: 'ranking' },
      ...(cohort?.selectionTarget ? { hintAr: `المستهدف في الدورة المفتوحة: ${cohort.selectionTarget}`, hintEn: `Open cohort target: ${cohort.selectionTarget}` } : {}) });
  }
  const attention: WorkspaceAttention[] = [];
  if (sla && overdue) attention.push({ key: 'overdue', labelAr: 'طلبات متأخرة عن المهلة', labelEn: 'Overdue applications', count: overdue, link: { tab: 'overdue' } });
  const stalled = openRows.filter((a) => a.isStalled).length;
  if (stalled) attention.push({ key: 'stalled', labelAr: 'مشروعات متعثرة', labelEn: 'Stalled projects', count: stalled, link: null });

  const cohorts = await listCohorts();
  const filters: WorkspaceFilter[] = [
    ...(cohorts.length > 1 ? [{ key: 'cohortId', labelAr: 'الدورة', labelEn: 'Cohort', options: cohorts.map((c) => ({ value: c.id, labelAr: c.nameAr, labelEn: c.nameEn || c.nameAr })) }] : []),
    { key: 'sector', labelAr: 'القطاع', labelEn: 'Sector', options: policy.sectors.map((s) => ({ value: s.value, labelAr: s.labelAr, labelEn: s.labelEn })) },
    { key: 'governorate', labelAr: 'المحافظة', labelEn: 'Governorate', options: GOVERNORATES.map((g) => ({ value: g.value, labelAr: g.labelAr, labelEn: g.labelEn })) },
    ...(user.role !== 'funder_reviewer' ? [{ key: 'funderOrgId', labelAr: 'جهة التمويل', labelEn: 'Funder', options: (await listOrganizations({ type: 'funder' })).map((o) => ({ value: o.id, labelAr: o.nameAr, labelEn: o.nameEn })) }] : []),
  ];

  const ws: ModuleWorkspace = {
    role: user.role, decides, awaitingMe, overdue, open: openRows.length, total, slaConfigured: sla,
    cards, attention, recent: await recentActivity(scope),
    states: APPLICATION_STATES.filter((s) => s !== 'DRAFT').map((s) => ({ key: s, labelAr: STATE_LABELS[s].ar, labelEn: STATE_LABELS[s].en })),
    filters, panels: [], tools: TOOLS[user.role] ?? [],
  };

  const allowed = new Set(filters.map((f) => f.key));
  const opt = (k: string) => (allowed.has(k) && q.filters[k]) || undefined;
  if (q.tab === 'mine' && !decides) {
    ws.queue = { items: [], total: 0, page: q.page, pageSize: q.pageSize, totalPages: 1 };
  } else if (q.tab === 'mine' || q.tab === 'all' || q.tab === 'overdue') {
    const list = await listForUser(user, {
      page: q.page, pageSize: q.pageSize, q: q.q, states: parseStates(q.state),
      mine: q.tab === 'mine', overdue: q.tab === 'overdue', sort: q.sort,
      cohortId: opt('cohortId'), sector: opt('sector'), governorate: opt('governorate'), funderOrgId: opt('funderOrgId'), from: q.from, to: q.to,
    });
    ws.draftsCount = list.draftsCount;
    ws.queue = { items: list.items.map(rowOf), total: list.total, page: list.page, pageSize: list.pageSize, totalPages: list.totalPages };
  } else if (q.tab === 'monitoring') {
    ws.monitoring = await monitoring(user, opt('cohortId'));
  } else if (q.tab === 'readiness' && user.role === 'system_admin') {
    const r = await readinessReport();
    ws.readiness = { ok: r.ok, checks: r.checks, notifications: r.notifications };
  }
  return ws;
}
