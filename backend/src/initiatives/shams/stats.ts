/**
 * Shams statistics for the unified platform admin: the module's own states mapped to the platform's normalized phases,
 * plus the initiative's KPIs (roof area, contracted amount…).
 */
import { getDb } from './db/database.js';
import type { ActivityItem, InitiativeStatsProvider, NormalizedPhase, StatsSummary } from '../contract.js';
import { NORMALIZED_PHASES } from '../contract.js';
import { APPLICATION_STATES, NON_TERMINAL_STATES, STATE_LABELS, type ApplicationState } from './workflow/shamsWorkflow.js';
import { slaInfo } from './workflow/applicationView.js';
import { listApplications } from './store/applications.js';

export const PHASE_OF: Record<ApplicationState, NormalizedPhase> = {
  DRAFT: 'draft',
  IMC_REVIEW: 'screening', ENCPC_REVIEW: 'screening',
  IMC_CORRECTION: 'correction', ENCPC_CORRECTION: 'correction', OFFER_CORRECTION: 'correction',
  PROVIDER_SELECTION: 'evaluation', OFFER_UPLOAD: 'evaluation', OFFER_REVIEW: 'evaluation', ELECTRICITY_UPLOAD: 'evaluation', ELECTRICITY_REVIEW: 'evaluation',
  BANK_STUDY: 'decision', CONTRACT_OUTCOME: 'decision', DISTRIBUTION_UPLOAD: 'decision', DISTRIBUTION_REVIEW: 'decision',
  CONTRACTED: 'success',
  REJECTED: 'closed_unsuccessful', CLOSED_NOT_CONTRACTED: 'closed_unsuccessful',
  WITHDRAWN: 'withdrawn',
};

const FUNNEL: Array<{ key: string; labelAr: string; labelEn: string; reached: ApplicationState[] }> = [
  { key: 'submitted', labelAr: 'طلبات مُرسلة', labelEn: 'Submitted', reached: ['IMC_REVIEW'] },
  { key: 'imc_accepted', labelAr: 'قبول IMC', labelEn: 'Accepted by IMC', reached: ['ENCPC_REVIEW'] },
  { key: 'compliant', labelAr: 'مطابقة ENCPC', labelEn: 'ENCPC compliant', reached: ['OFFER_UPLOAD', 'PROVIDER_SELECTION'] },
  { key: 'offer', labelAr: 'عرض فني مقبول', labelEn: 'Technical offer accepted', reached: ['ELECTRICITY_REVIEW', 'ELECTRICITY_UPLOAD'] },
  { key: 'electricity', labelAr: 'موافقة الكهرباء', labelEn: 'Electricity approval', reached: ['CONTRACT_OUTCOME'] },
  { key: 'contracted', labelAr: 'تم التعاقد', labelEn: 'Contracted', reached: ['CONTRACTED'] },
];

function inRange(col: string, f: { from?: string; to?: string }, params: Array<string>): string {
  const parts: string[] = [];
  if (f.from) { parts.push(`${col} >= ?`); params.push(f.from); }
  if (f.to) { parts.push(`${col} <= ?`); params.push(`${f.to}T23:59:59.999Z`); }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

async function summary(f: { from?: string; to?: string }): Promise<StatsSummary> {
  const db = getDb();
  const p: string[] = [];
  const range = inRange('a.createdAt', f, p);
  const byStateRows = await db.prepare(`SELECT a.state AS state, COUNT(*) AS n FROM shams_applications a WHERE 1 = 1${range} GROUP BY a.state`).all(...p) as Array<{ state: ApplicationState; n: number }>;
  const count = (s: ApplicationState) => Number(byStateRows.find((r) => r.state === s)?.n ?? 0);
  const byPhase = Object.fromEntries(NORMALIZED_PHASES.map((ph) => [ph, 0])) as Record<NormalizedPhase, number>;
  for (const r of byStateRows) byPhase[PHASE_OF[r.state]] += Number(r.n);
  const total = byStateRows.reduce((n, r) => n + Number(r.n), 0);

  const p2: string[] = [];
  const range2 = inRange('a.createdAt', f, p2);
  const reachedRows = await db.prepare(`SELECT tr.toState AS state, COUNT(DISTINCT tr.applicationId) AS n FROM shams_application_transitions tr
    JOIN shams_applications a ON a.id = tr.applicationId WHERE 1 = 1${range2} GROUP BY tr.toState`).all(...p2) as Array<{ state: ApplicationState; n: number }>;
  const reached = (states: ApplicationState[]) => reachedRows.filter((r) => states.includes(r.state)).reduce((n, r) => n + Number(r.n), 0);

  const p3: string[] = [];
  const range3 = inRange('a.createdAt', f, p3);
  const gov = await db.prepare(`SELECT a.governorate AS governorate, COUNT(*) AS n FROM shams_applications a WHERE a.state <> 'DRAFT'${range3} GROUP BY a.governorate`).all(...p3) as Array<{ governorate: string; n: number }>;

  const p4: string[] = [];
  const range4 = inRange('a.createdAt', f, p4);
  const kpi = await db.prepare(`SELECT COALESCE(SUM(a.totalRoofArea), 0) AS roof,
      COALESCE(SUM(CASE WHEN a.state = 'CONTRACTED' THEN a.totalRoofArea ELSE 0 END), 0) AS contractedRoof
    FROM shams_applications a WHERE a.state <> 'DRAFT'${range4}`).get(...p4) as { roof: number; contractedRoof: number };
  const p5: string[] = [];
  const range5 = inRange('a.createdAt', f, p5);
  const money = await db.prepare(`SELECT COALESCE(SUM(r.contractAmount), 0) AS amount, COUNT(*) AS n FROM shams_bank_referrals r
    JOIN shams_applications a ON a.id = r.applicationId WHERE r.contractStatus = 'contracted'${range5}`).get(...p5) as { amount: number; n: number };
  const applicants = Number((await db.prepare("SELECT COUNT(*) AS n FROM initiative_memberships WHERE initiativeId = 'shams' AND role = 'factory_owner'").get() as { n: number }).n);

  const open = (await listApplications({ scopeSql: '1 = 1', scopeParams: [], includeDrafts: false, states: [...NON_TERMINAL_STATES] }, 1, 1, true)).rows;
  const overdue = open.filter((a) => slaInfo(a).overdue).length;

  const p6: string[] = [];
  const range6 = inRange('a.createdAt', f, p6);
  const months = await db.prepare(`SELECT SUBSTR(a.submittedAt, 1, 7) AS m, COUNT(*) AS n FROM shams_applications a WHERE a.submittedAt IS NOT NULL${range6} GROUP BY SUBSTR(a.submittedAt, 1, 7)`).all(...p6) as Array<{ m: string; n: number }>;
  const p7: string[] = [];
  const range7 = inRange('a.createdAt', f, p7);
  const closedMonths = await db.prepare(`SELECT SUBSTR(a.closedAt, 1, 7) AS m, COUNT(*) AS n FROM shams_applications a WHERE a.closedAt IS NOT NULL${range7} GROUP BY SUBSTR(a.closedAt, 1, 7)`).all(...p7) as Array<{ m: string; n: number }>;
  const monthKeys = [...new Set([...months.map((r) => r.m), ...closedMonths.map((r) => r.m)])].sort();

  return {
    totals: {
      applicants, applications: total, drafts: count('DRAFT'),
      open: byStateRows.filter((r) => (NON_TERMINAL_STATES as readonly string[]).includes(r.state) && r.state !== 'DRAFT').reduce((n, r) => n + Number(r.n), 0),
      positiveOutcome: count('CONTRACTED'), negativeOutcome: count('REJECTED') + count('CLOSED_NOT_CONTRACTED'), withdrawn: count('WITHDRAWN'), overdue,
    },
    byPhase,
    byState: APPLICATION_STATES.map((s) => ({ key: s, labelAr: STATE_LABELS[s].ar, labelEn: STATE_LABELS[s].en, count: count(s), phase: PHASE_OF[s] })),
    funnel: FUNNEL.map((x) => ({ key: x.key, labelAr: x.labelAr, labelEn: x.labelEn, count: reached(x.reached) })),
    byGovernorate: gov.map((g) => ({ governorate: g.governorate || 'unknown', count: Number(g.n) })),
    money: { approvedEGP: Number(money.amount ?? 0) },
    kpis: [
      { key: 'roof_area', labelAr: 'إجمالي مساحات الأسطح المقدمة', labelEn: 'Total roof area submitted', value: Math.round(Number(kpi.roof ?? 0)), unit: 'm²' },
      { key: 'contracted_roof_area', labelAr: 'مساحات أسطح متعاقد عليها', labelEn: 'Contracted roof area', value: Math.round(Number(kpi.contractedRoof ?? 0)), unit: 'm²' },
      { key: 'contracts', labelAr: 'عقود مسجلة', labelEn: 'Recorded contracts', value: Number(money.n ?? 0) },
      { key: 'contract_amount', labelAr: 'قيمة العقود', labelEn: 'Contract amount', value: Math.round(Number(money.amount ?? 0)), unit: 'EGP' },
    ],
    timeline: monthKeys.map((m) => ({ month: m, submitted: Number(months.find((r) => r.m === m)?.n ?? 0), closed: Number(closedMonths.find((r) => r.m === m)?.n ?? 0) })),
  };
}

async function recentActivity(limit: number): Promise<ActivityItem[]> {
  const rows = await getDb().prepare(`SELECT tr.createdAt AS at, tr.applicationId, tr.toState, tr.actorName, a.number FROM shams_application_transitions tr
    JOIN shams_applications a ON a.id = tr.applicationId ORDER BY tr.createdAt DESC LIMIT ?`).all(limit) as Array<{ at: string; applicationId: string; toState: ApplicationState; actorName: string; number: string | null }>;
  return rows.map((r) => ({
    at: r.at, applicationId: r.applicationId, number: r.number,
    labelAr: `${r.number ?? 'مسودة'} ← ${STATE_LABELS[r.toState]?.ar ?? r.toState}${r.actorName ? ` (${r.actorName})` : ''}`,
    labelEn: `${r.number ?? 'Draft'} → ${STATE_LABELS[r.toState]?.en ?? r.toState}`,
    view: `application/${r.applicationId}`,
  }));
}

export const stats: InitiativeStatsProvider = { summary, recentActivity };
