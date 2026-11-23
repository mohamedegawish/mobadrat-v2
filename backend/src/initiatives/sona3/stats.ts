/**
 * Sona3 statistics for the unified platform admin: the initiative's 19 states mapped to the platform's normalized phases,
 * plus its funding, jobs and evaluation KPIs.
 */
import { getDb } from './db/database.js';
import type { ActivityItem, InitiativeStatsProvider, NormalizedPhase, StatsSummary } from '../contract.js';
import { NORMALIZED_PHASES } from '../contract.js';
import { APPLICATION_STATES, STATE_LABELS, TERMINAL_STATES, type ApplicationState } from './workflow/workflow.js';

export const PHASE_OF: Record<ApplicationState, NormalizedPhase> = {
  DRAFT: 'draft',
  ELIGIBILITY_REVIEW: 'screening', STUDY_PREPARATION: 'screening', STUDY_REVIEW: 'screening',
  ELIGIBILITY_CORRECTION: 'correction', STUDY_CORRECTION: 'correction',
  COMMITTEE_EVALUATION: 'evaluation', EVALUATED: 'evaluation',
  SELECTED: 'decision', FUNDING_SEARCH: 'decision', FUNDER_REVIEW: 'decision',
  IMPLEMENTATION: 'execution', OPERATING: 'execution',
  COMPLETED: 'success',
  REJECTED: 'closed_unsuccessful', NOT_SELECTED: 'closed_unsuccessful', NOT_APPROVED: 'closed_unsuccessful', CLOSED_NOT_FUNDED: 'closed_unsuccessful',
  WITHDRAWN: 'withdrawn',
};

const FUNNEL: Array<{ key: string; labelAr: string; labelEn: string; reached: ApplicationState[] }> = [
  { key: 'submitted', labelAr: 'طلبات مُرسلة', labelEn: 'Submitted', reached: ['ELIGIBILITY_REVIEW'] },
  { key: 'eligible', labelAr: 'مؤهلون', labelEn: 'Eligible', reached: ['STUDY_PREPARATION'] },
  { key: 'study', labelAr: 'دراسات مقدمة', labelEn: 'Studies submitted', reached: ['STUDY_REVIEW'] },
  { key: 'evaluated', labelAr: 'تم تقييمهم', labelEn: 'Evaluated', reached: ['EVALUATED'] },
  { key: 'selected', labelAr: 'مختارون', labelEn: 'Selected', reached: ['SELECTED'] },
  { key: 'approved', labelAr: 'موافقة وزارية', labelEn: 'Approved', reached: ['FUNDING_SEARCH'] },
  { key: 'funded', labelAr: 'ممولون', labelEn: 'Funded', reached: ['IMPLEMENTATION'] },
  { key: 'operating', labelAr: 'في التشغيل', labelEn: 'Operating', reached: ['OPERATING'] },
];

function range(col: string, f: { from?: string; to?: string }, params: string[]): string {
  const parts: string[] = [];
  if (f.from) { parts.push(`${col} >= ?`); params.push(f.from); }
  if (f.to) { parts.push(`${col} <= ?`); params.push(`${f.to}T23:59:59.999Z`); }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

async function summary(f: { from?: string; to?: string }): Promise<StatsSummary> {
  const db = getDb();
  const p1: string[] = [];
  const byStateRows = await db.prepare(`SELECT a.state AS state, COUNT(*) AS n FROM sona3_applications a WHERE 1 = 1${range('a.createdAt', f, p1)} GROUP BY a.state`).all(...p1) as Array<{ state: ApplicationState; n: number }>;
  const count = (s: ApplicationState) => Number(byStateRows.find((r) => r.state === s)?.n ?? 0);
  const byPhase = Object.fromEntries(NORMALIZED_PHASES.map((ph) => [ph, 0])) as Record<NormalizedPhase, number>;
  for (const r of byStateRows) byPhase[PHASE_OF[r.state]] += Number(r.n);
  const total = byStateRows.reduce((n, r) => n + Number(r.n), 0);

  const p2: string[] = [];
  const reachedRows = await db.prepare(`SELECT tr.toState AS state, COUNT(DISTINCT tr.applicationId) AS n FROM sona3_application_transitions tr
    JOIN sona3_applications a ON a.id = tr.applicationId WHERE 1 = 1${range('a.createdAt', f, p2)} GROUP BY tr.toState`).all(...p2) as Array<{ state: ApplicationState; n: number }>;
  const reached = (states: ApplicationState[]) => reachedRows.filter((r) => states.includes(r.state)).reduce((n, r) => n + Number(r.n), 0);

  const p3: string[] = [];
  const gov = await db.prepare(`SELECT a.governorate AS governorate, COUNT(*) AS n FROM sona3_applications a WHERE a.state <> 'DRAFT'${range('a.createdAt', f, p3)} GROUP BY a.governorate`).all(...p3) as Array<{ governorate: string; n: number }>;

  const p4: string[] = [];
  const money = await db.prepare(`SELECT COALESCE(SUM(a.requestedFunding), 0) AS requested, COALESCE(SUM(a.totalInvestment), 0) AS investment,
      COALESCE(SUM(a.expectedJobs), 0) AS jobs FROM sona3_applications a WHERE a.state <> 'DRAFT'${range('a.createdAt', f, p4)}`).get(...p4) as { requested: number; investment: number; jobs: number };
  const p5: string[] = [];
  const approved = await db.prepare(`SELECT COALESCE(SUM(r.amount), 0) AS amount FROM sona3_funding_referrals r JOIN sona3_applications a ON a.id = r.applicationId
    WHERE r.status = 'approved'${range('a.createdAt', f, p5)}`).get(...p5) as { amount: number };
  const p6: string[] = [];
  const disbursed = await db.prepare(`SELECT COALESCE(SUM(m.amount), 0) AS amount FROM sona3_milestones m JOIN sona3_applications a ON a.id = m.applicationId
    WHERE m.status = 'disbursed'${range('a.createdAt', f, p6)}`).get(...p6) as { amount: number };
  const p7: string[] = [];
  const actualJobs = await db.prepare(`SELECT COALESCE(SUM(x.jobs), 0) AS n FROM (SELECT i.applicationId, MAX(i.directJobs + i.indirectJobs) AS jobs FROM sona3_impact_reports i
    JOIN sona3_applications a ON a.id = i.applicationId WHERE 1 = 1${range('a.createdAt', f, p7)} GROUP BY i.applicationId) x`).get(...p7) as { n: number };
  const avgScore = await db.prepare('SELECT AVG(score) AS s, COUNT(score) AS n FROM sona3_applications WHERE score IS NOT NULL').get() as { s: number | null; n: number };
  const applicants = Number((await db.prepare("SELECT COUNT(*) AS n FROM initiative_memberships WHERE initiativeId = 'sona3' AND role = 'applicant'").get() as { n: number }).n);

  const p8: string[] = [];
  const months = await db.prepare(`SELECT SUBSTR(a.submittedAt, 1, 7) AS m, COUNT(*) AS n FROM sona3_applications a WHERE a.submittedAt IS NOT NULL${range('a.createdAt', f, p8)} GROUP BY SUBSTR(a.submittedAt, 1, 7)`).all(...p8) as Array<{ m: string; n: number }>;
  const p9: string[] = [];
  const closedMonths = await db.prepare(`SELECT SUBSTR(a.closedAt, 1, 7) AS m, COUNT(*) AS n FROM sona3_applications a WHERE a.closedAt IS NOT NULL${range('a.createdAt', f, p9)} GROUP BY SUBSTR(a.closedAt, 1, 7)`).all(...p9) as Array<{ m: string; n: number }>;
  const monthKeys = [...new Set([...months.map((r) => r.m), ...closedMonths.map((r) => r.m)])].sort();

  return {
    totals: {
      applicants, applications: total, drafts: count('DRAFT'),
      open: byStateRows.filter((r) => !TERMINAL_STATES.includes(r.state) && r.state !== 'DRAFT').reduce((n, r) => n + Number(r.n), 0),
      positiveOutcome: count('COMPLETED') + count('OPERATING') + count('IMPLEMENTATION'),
      negativeOutcome: count('REJECTED') + count('NOT_SELECTED') + count('NOT_APPROVED') + count('CLOSED_NOT_FUNDED'),
      withdrawn: count('WITHDRAWN'), overdue: 0,
    },
    byPhase,
    byState: APPLICATION_STATES.map((s) => ({ key: s, labelAr: STATE_LABELS[s].ar, labelEn: STATE_LABELS[s].en, count: count(s), phase: PHASE_OF[s] })),
    funnel: FUNNEL.map((x) => ({ key: x.key, labelAr: x.labelAr, labelEn: x.labelEn, count: reached(x.reached) })),
    byGovernorate: gov.map((g) => ({ governorate: g.governorate || 'unknown', count: Number(g.n) })),
    money: { requestedEGP: Number(money.requested ?? 0), investmentEGP: Number(money.investment ?? 0), approvedEGP: Number(approved.amount ?? 0), disbursedEGP: Number(disbursed.amount ?? 0) },
    jobs: { expected: Number(money.jobs ?? 0), actual: Number(actualJobs.n ?? 0) },
    kpis: [
      { key: 'funding_approved', labelAr: 'تمويل معتمد', labelEn: 'Approved funding', value: Math.round(Number(approved.amount ?? 0)), unit: 'EGP' },
      { key: 'funding_disbursed', labelAr: 'تمويل مصروف', labelEn: 'Disbursed funding', value: Math.round(Number(disbursed.amount ?? 0)), unit: 'EGP' },
      { key: 'jobs_expected', labelAr: 'فرص عمل متوقعة', labelEn: 'Expected jobs', value: Number(money.jobs ?? 0) },
      { key: 'avg_score', labelAr: 'متوسط درجة التقييم', labelEn: 'Average evaluation score', value: Math.round(Number(avgScore.s ?? 0) * 10) / 10 },
    ],
    timeline: monthKeys.map((m) => ({ month: m, submitted: Number(months.find((r) => r.m === m)?.n ?? 0), closed: Number(closedMonths.find((r) => r.m === m)?.n ?? 0) })),
  };
}

async function recentActivity(limit: number): Promise<ActivityItem[]> {
  const rows = await getDb().prepare(`SELECT tr.createdAt AS at, tr.applicationId, tr.toState, tr.actorName, a.number FROM sona3_application_transitions tr
    JOIN sona3_applications a ON a.id = tr.applicationId ORDER BY tr.createdAt DESC LIMIT ?`).all(limit) as Array<{ at: string; applicationId: string; toState: ApplicationState; actorName: string; number: string | null }>;
  return rows.map((r) => ({
    at: r.at, applicationId: r.applicationId, number: r.number,
    labelAr: `${r.number ?? 'مسودة'} ← ${STATE_LABELS[r.toState]?.ar ?? r.toState}${r.actorName ? ` (${r.actorName})` : ''}`,
    labelEn: `${r.number ?? 'Draft'} → ${STATE_LABELS[r.toState]?.en ?? r.toState}`,
    view: `application/${r.applicationId}`,
  }));
}

export const stats: InitiativeStatsProvider = { summary, recentActivity };
