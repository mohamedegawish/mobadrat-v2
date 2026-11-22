import { mapSeq } from '../http/helpers.js';
/** التقارير ومؤشرات لوحة المتابعة (docs/SONA3_DESIGN.md §13) — دالة واحدة لـ /reports/summary و Integration GET /summary. */
import { getDb, sqlDaysBetween } from '../db/sqlite.js';
import type { SqlParam } from '../http/helpers.js';
import { listApplications, type AppRow } from '../store/applications.js';
import { getCohort, openCohort, listCohorts } from '../store/cohorts.js';
import { getOrganization } from '../store/organizations.js';
import { APPLICATION_STATES, STATE_LABELS, isTerminal, type ApplicationState } from '../workflow/workflow.js';
import { slaInfo, slaConfigured, responsibleInfo } from '../workflow/applicationView.js';
import { findGovernorate } from '../config/locations.js';
import { policy } from '../config/initiativePolicy.js';

export interface Scope { sql: string; params: SqlParam[]; includeDrafts: boolean }
export const ALL_SCOPE: Scope = { sql: '1 = 1', params: [], includeDrafts: true };

export interface SummaryOptions {
  /** الدورة المطلوبة؛ بدونها تُجمع كل الدورات. */
  cohortId?: string;
  /** هل يُعرض متوسط الدرجات (حسب قواعد الرؤية: IMC وجهة التمويل والأدمن). */
  includeScores?: boolean;
}

const n = (v: unknown) => Number(v ?? 0);

/** عدد الطلبات التي دخلت حالة معينة مرة على الأقل (قمع الرحلة). */
async function entered(base: string, params: SqlParam[], state: ApplicationState): Promise<number> {
  return n((await getDb().prepare(`SELECT COUNT(DISTINCT a.id) AS n ${base} AND EXISTS (
    SELECT 1 FROM sona3_application_transitions t WHERE t.applicationId = a.id AND t.toState = ? AND t.fromState <> t.toState)`)
    .get(...params, state) as { n: number }).n);
}

export async function buildSummary(scope: Scope, opts: SummaryOptions = {}) {
  const db = getDb();
  const draftFilter = scope.includeDrafts ? '' : " AND a.state <> 'DRAFT'";
  const cohortFilter = opts.cohortId ? ' AND a.cohortId = ?' : '';
  const params: SqlParam[] = [...scope.params, ...(opts.cohortId ? [opts.cohortId] : [])];
  const base = `FROM sona3_applications a JOIN sona3_applicants p ON p.id = a.applicantId WHERE ${scope.sql}${draftFilter}${cohortFilter}`;
  const submittedBase = `${base} AND a.state <> 'DRAFT'`;

  const byStateRows = await db.prepare(`SELECT a.state AS state, COUNT(*) AS n ${base} GROUP BY a.state`).all(...params) as Array<{ state: ApplicationState; n: number }>;
  const byState: Record<string, number> = {};
  for (const s of APPLICATION_STATES) byState[s] = 0;
  for (const r of byStateRows) byState[r.state] = n(r.n);

  const apps = (await listApplications({ scopeSql: `${scope.sql}${cohortFilter}`, scopeParams: params, includeDrafts: scope.includeDrafts }, 1, 1, true)).rows;
  const overdue = apps.filter((a) => slaInfo(a).overdue).length;

  // ── المؤشرات الرئيسية (§13): قمع الرحلة ──
  const selectionTarget = opts.cohortId ? (await getCohort(opts.cohortId))?.selectionTarget ?? null : ((await openCohort())?.selectionTarget ?? null);
  const kpis = {
    applicants: n((await db.prepare(`SELECT COUNT(DISTINCT a.applicantId) AS n ${submittedBase}`).get(...params) as { n: number }).n),
    applications: n((await db.prepare(`SELECT COUNT(*) AS n ${submittedBase}`).get(...params) as { n: number }).n),
    eligible: await entered(submittedBase, params, 'STUDY_PREPARATION'),
    studyCompleted: await entered(submittedBase, params, 'STUDY_REVIEW'),
    evaluated: await entered(submittedBase, params, 'EVALUATED'),
    selected: await entered(submittedBase, params, 'SELECTED'),
    selectionTarget,
    approved: await entered(submittedBase, params, 'FUNDING_SEARCH'),
    funded: await entered(submittedBase, params, 'IMPLEMENTATION'),
    inImplementation: byState.IMPLEMENTATION ?? 0,
    operating: byState.OPERATING ?? 0,
  };

  // ── التمويل ──
  const requested = n((await db.prepare(`SELECT COALESCE(SUM(a.requestedFunding), 0) AS v ${submittedBase}`).get(...params) as { v: number }).v);
  const approvedAmount = n((await db.prepare(`SELECT COALESCE(SUM(r.amount), 0) AS v FROM sona3_funding_referrals r WHERE r.status = 'approved'
    AND r.applicationId IN (SELECT a.id ${base})`).get(...params) as { v: number }).v);
  const disbursed = n((await db.prepare(`SELECT COALESCE(SUM(m.amount), 0) AS v FROM sona3_milestones m WHERE m.status = 'disbursed'
    AND m.applicationId IN (SELECT a.id ${base})`).get(...params) as { v: number }).v);

  // ── فرص العمل: المتوقع (من الدراسة) والفعلي (آخر تقرير أثر لكل مشروع) ──
  const expectedJobs = n((await db.prepare(`SELECT COALESCE(SUM(a.expectedJobs), 0) AS v ${submittedBase}`).get(...params) as { v: number }).v);
  const actualJobs = n((await db.prepare(`SELECT COALESCE(SUM(i.directJobs + i.indirectJobs), 0) AS v FROM sona3_impact_reports i
    WHERE i.applicationId IN (SELECT a.id ${base}) AND i.periodEnd = (SELECT MAX(i2.periodEnd) FROM sona3_impact_reports i2 WHERE i2.applicationId = i.applicationId)`)
    .get(...params) as { v: number }).v);

  const bySector = await db.prepare(`SELECT a.sector AS sector, COUNT(*) AS n ${submittedBase} AND a.sector <> '' GROUP BY a.sector ORDER BY n DESC`)
    .all(...params) as Array<{ sector: string; n: number }>;
  const byGovernorate = await db.prepare(`SELECT a.governorate AS governorate, COUNT(*) AS n ${submittedBase} AND a.governorate <> '' GROUP BY a.governorate ORDER BY n DESC`)
    .all(...params) as Array<{ governorate: string; n: number }>;
  const avg = opts.includeScores
    ? (await db.prepare(`SELECT AVG(a.score) AS v, COUNT(a.score) AS c ${submittedBase} AND a.score IS NOT NULL`).get(...params) as { v: number | null; c: number })
    : null;

  // متوسط زمن البقاء في كل حالة (أيام) من السجل التاريخي.
  const avgRows = await db.prepare(`WITH t AS (
      SELECT tr.applicationId, tr.toState AS state, tr.createdAt AS enteredAt,
        LEAD(tr.createdAt) OVER (PARTITION BY tr.applicationId ORDER BY tr.createdAt, tr.rowid) AS leftAt
      FROM sona3_application_transitions tr
      WHERE tr.fromState <> tr.toState AND tr.applicationId IN (SELECT a.id ${base})
    )
    SELECT state, AVG(${sqlDaysBetween('enteredAt', 'leftAt')}) AS avgDays, COUNT(*) AS n FROM t WHERE leftAt IS NOT NULL GROUP BY state`)
    .all(...params) as Array<{ state: ApplicationState; avgDays: number; n: number }>;
  const avgDaysPerState: Record<string, { avgDays: number; samples: number }> = {};
  for (const r of avgRows) avgDaysPerState[r.state] = { avgDays: Math.round(r.avgDays * 100) / 100, samples: r.n };

  const total = byStateRows.reduce((s, r) => s + n(r.n), 0);
  return {
    cohortId: opts.cohortId ?? null,
    total,
    drafts: byState.DRAFT ?? 0,
    open: apps.filter((a) => !isTerminal(a.state) && a.state !== 'DRAFT').length,
    overdue,
    slaConfigured: slaConfigured(),
    kpis,
    funding: { requested, approved: approvedAmount, disbursed },
    jobs: { expected: expectedJobs, actual: actualJobs },
    averageScore: avg ? { value: avg.v === null ? null : Math.round(avg.v * 100) / 100, scored: n(avg.c) } : undefined,
    byState,
    avgDaysPerState,
    bySector: bySector.map((s) => ({ sector: s.sector, label: policy.sectors.find((o) => o.value === s.sector) ?? null, count: n(s.n) })),
    byGovernorate: byGovernorate.map((g) => ({ governorate: g.governorate, label: findGovernorate(g.governorate)?.labelAr ?? g.governorate, count: n(g.n) })),
    cohorts: (await listCohorts()).map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn })),
    stateLabels: Object.fromEntries(APPLICATION_STATES.map((s) => [s, STATE_LABELS[s]])),
    generatedAt: new Date().toISOString(),
  };
}

/** صفوف تقرير Excel. `full` = IMC (الدرجة والتمويل). */
export async function reportRows(apps: AppRow[], full: boolean) {
  return mapSeq(apps, async (a) => {
    const sla = slaInfo(a);
    const resp = await responsibleInfo(a);
    const base = {
      number: a.number ?? '', applicantName: a.applicantName, projectName: a.projectName, sector: a.sector, governorate: a.governorate,
      state: a.state, stateLabelAr: STATE_LABELS[a.state].ar, stateLabelEn: STATE_LABELS[a.state].en,
      responsibleAr: resp.orgNameAr ?? resp.labelAr, responsibleEn: resp.orgNameEn ?? resp.labelEn,
      submittedAt: a.submittedAt ?? '', stateEnteredAt: a.stateEnteredAt, daysInState: sla.daysInState, overdue: sla.overdue,
      teamSize: a.teamSize, attempt: a.attempt,
    };
    if (!full) return base;
    return {
      ...base,
      requestedFunding: a.requestedFunding, totalInvestment: a.totalInvestment, expectedJobs: a.expectedJobs,
      score: a.score, passedMinimums: a.passedMinimums,
      funderAr: a.funderOrgId ? (await getOrganization(a.funderOrgId))?.nameAr ?? '' : '',
      stalled: a.isStalled, closedAt: a.closedAt ?? '',
    };
  });
}

// ── ورقة Excel مقروءة (رؤوس عربية، أسماء لا أكواد، توقيت القاهرة، نعم/لا) ─────────────────────

type Cell = string | number | null;

const CAIRO = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** تاريخ ISO (UTC) → «يوم/شهر/سنة ساعة:دقيقة» بتوقيت القاهرة. التواريخ بلا وقت (YYYY-MM-DD) تبقى أيامًا. */
export function cairoDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : CAIRO.format(new Date(t)).replace(',', '');
}

const yesNo = (v: unknown): string => (v ? 'نعم' : 'لا');
const sectorAr = (v: string) => policy.sectors.find((o) => o.value === v)?.labelAr ?? v;

export function reportSheet(rows: Awaited<ReturnType<typeof reportRows>>, full: boolean): { headers: string[]; rows: Cell[][] } {
  const cols: Array<[string, (r: Record<string, unknown>) => Cell]> = [
    ['رقم الطلب', (r) => String(r.number || 'مسودة')],
    ['اسم المتقدم', (r) => String(r.applicantName ?? '')],
    ['اسم المشروع', (r) => String(r.projectName ?? '')],
    ['القطاع', (r) => sectorAr(String(r.sector ?? ''))],
    ['المحافظة', (r) => findGovernorate(String(r.governorate ?? ''))?.labelAr ?? String(r.governorate ?? '')],
    ['الحالة', (r) => String(r.stateLabelAr ?? '')],
    ['الجهة المسؤولة', (r) => String(r.responsibleAr ?? '')],
    ['تاريخ الإرسال (القاهرة)', (r) => cairoDateTime(r.submittedAt as string)],
    ['دخل المرحلة في (القاهرة)', (r) => cairoDateTime(r.stateEnteredAt as string)],
    ['أيام في المرحلة', (r) => Number(r.daysInState ?? 0)],
    [slaConfigured() ? 'متأخر عن المهلة' : 'متأخر عن المهلة (لم تُحدد مهل)', (r) => (slaConfigured() ? yesNo(r.overdue) : '—')],
    ['عدد الفريق', (r) => Number(r.teamSize ?? 1)],
    ['رقم المحاولة', (r) => Number(r.attempt ?? 0)],
  ];
  if (full) {
    cols.push(
      ['التمويل المطلوب (جنيه)', (r) => Number(r.requestedFunding ?? 0)],
      ['إجمالي التكلفة الاستثمارية (جنيه)', (r) => Number(r.totalInvestment ?? 0)],
      ['فرص العمل المتوقعة', (r) => Number(r.expectedJobs ?? 0)],
      ['الدرجة الإجمالية', (r) => (r.score === null || r.score === undefined ? null : Number(r.score))],
      ['اجتاز الحدود الدنيا', (r) => (r.passedMinimums === null || r.passedMinimums === undefined ? '' : yesNo(r.passedMinimums))],
      ['جهة التمويل', (r) => String(r.funderAr ?? '')],
      ['متعثر', (r) => yesNo(r.stalled)],
      ['تاريخ الإغلاق (القاهرة)', (r) => cairoDateTime(r.closedAt as string)],
    );
  }
  return { headers: cols.map(([h]) => h), rows: rows.map((r) => cols.map(([, f]) => f(r as Record<string, unknown>))) };
}
