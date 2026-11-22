/** التقارير والملخصات — دالة واحدة لـ /reports/summary و Integration GET /summary. */
import { getDb, sqlDaysBetween } from '../db/sqlite.js';
import { mapSeq } from '../http/helpers.js';
import type { SqlParam } from '../http/helpers.js';
import { listApplications, listTransitionsFor, getBankReferralsFor, getDistributionContractsFor, type AppRow } from '../store/applications.js';
import { getProvidersByIds } from '../store/providers.js';
import {
  APPLICATION_STATES, NON_TERMINAL_STATES, STATE_LABELS, RETURN_ACTIONS, isTerminal, type ApplicationState,
} from '../workflow/shamsWorkflow.js';
import { slaInfo, slaConfigured, responsibleInfo, returnCounts, preloadListOrgs } from '../workflow/applicationView.js';
import { findGovernorate, zoneLabel } from '../config/locations.js';
import { shamsPolicy } from '../config/shamsPolicy.js';

export interface Scope { sql: string; params: SqlParam[]; includeDrafts: boolean }
export const ALL_SCOPE: Scope = { sql: '1 = 1', params: [], includeDrafts: true };

/** للجهات ذات المرحلة الواحدة: تُجمع الحالات خارج مرحلتها في بند واحد. */
export type StageLimit = ApplicationState[] | null;

export async function buildSummary(scope: Scope, stageLimit: StageLimit = null) {
  const db = getDb();
  const draftFilter = scope.includeDrafts ? '' : " AND a.state <> 'DRAFT'";
  const base = `FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId WHERE ${scope.sql}${draftFilter}`;
  const byStateRows = await db.prepare(`SELECT a.state AS state, COUNT(*) AS n ${base} GROUP BY a.state`).all(...scope.params) as Array<{ state: ApplicationState; n: number }>;
  const byState: Record<string, number> = {};
  let passedOn = 0;
  for (const s of APPLICATION_STATES) byState[s] = 0;
  for (const r of byStateRows) {
    if (stageLimit && !stageLimit.includes(r.state)) passedOn += r.n;
    else byState[r.state] = r.n;
  }
  if (stageLimit) for (const s of APPLICATION_STATES) if (!stageLimit.includes(s)) delete byState[s];

  // PA-04: only non-terminal rows can be overdue or open — the terminal history (most of the table) is not loaded.
  const apps = (await listApplications({ scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: scope.includeDrafts, states: [...NON_TERMINAL_STATES] }, 1, 1, true)).rows;
  const overdue = apps.filter((a) => slaInfo(a).overdue && (!stageLimit || stageLimit.includes(a.state))).length;

  // متوسط زمن البقاء في كل حالة (أيام) من السجل التاريخي.
  const avgRows = await db.prepare(`WITH t AS (
      SELECT tr.applicationId, tr.toState AS state, tr.createdAt AS enteredAt,
        LEAD(tr.createdAt) OVER (PARTITION BY tr.applicationId ORDER BY tr.createdAt, tr.rowid) AS leftAt
      FROM shams_application_transitions tr
      WHERE tr.fromState <> tr.toState AND tr.applicationId IN (SELECT a.id ${base})
    )
    SELECT state, AVG(${sqlDaysBetween('enteredAt', 'leftAt')}) AS avgDays, COUNT(*) AS n FROM t WHERE leftAt IS NOT NULL GROUP BY state`)
    .all(...scope.params) as Array<{ state: ApplicationState; avgDays: number; n: number }>;
  const avgDaysPerState: Record<string, { avgDays: number; samples: number }> = {};
  for (const r of avgRows) {
    if (stageLimit && !stageLimit.includes(r.state)) continue;
    avgDaysPerState[r.state] = { avgDays: Math.round(r.avgDays * 100) / 100, samples: r.n };
  }

  const returnsRows = await db.prepare(`SELECT tr.fromState AS state, COUNT(*) AS n FROM shams_application_transitions tr
      WHERE tr.applicationId IN (SELECT a.id ${base}) AND (${RETURN_ACTIONS.map(() => '(tr.fromState = ? AND tr.action = ?)').join(' OR ')})
      GROUP BY tr.fromState`)
    .all(...scope.params, ...RETURN_ACTIONS.flatMap((r) => [r.from, r.action])) as Array<{ state: ApplicationState; n: number }>;
  const returnsByStage: Record<string, number> = {};
  for (const r of returnsRows) if (!stageLimit || stageLimit.includes(r.state)) returnsByStage[r.state] = r.n;

  const contracts = stageLimit ? null : await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(r.contractAmount), 0) AS amount FROM shams_bank_referrals r
      WHERE r.contractStatus = 'contracted' AND r.applicationId IN (SELECT a.id ${base})`).get(...scope.params) as { n: number; amount: number } | null;
  // التعاقد عن طريق شركة توزيع الكهرباء (قبول PMU لموافقتها) — يُحتسب تعاقدًا، بلا قيمة مالية مسجلة.
  const distributionContracts = stageLimit ? null : await db.prepare(`SELECT COUNT(*) AS n FROM shams_distribution_contracts d
      WHERE d.reviewStatus = 'approved' AND d.applicationId IN (SELECT a.id ${base})`).get(...scope.params) as { n: number } | null;

  const byGovernorate = await db.prepare(`SELECT a.governorate AS governorate, COUNT(*) AS n ${base} AND a.governorate <> '' GROUP BY a.governorate ORDER BY n DESC`)
    .all(...scope.params) as Array<{ governorate: string; n: number }>;

  const total = byStateRows.reduce((s, r) => s + r.n, 0);
  return {
    total,
    drafts: byState.DRAFT ?? 0,
    open: apps.filter((a) => !isTerminal(a.state) && a.state !== 'DRAFT').length,
    overdue,
    /** I5: بدون مهل محددة لا يُعرض «متأخرة: 0». */
    slaConfigured: slaConfigured(),
    byState,
    ...(stageLimit ? { passedOnToLaterStages: passedOn } : {}),
    avgDaysPerState,
    returnsByStage,
    // I8: القيمة يسجلها المصنع — تُعرض كذلك، مع عدد ما يتجاوز حد التنبيه (shamsPolicy.contractAmountAlertEGP).
    contracted: contracts ? { count: Number(contracts.n) + Number(distributionContracts?.n ?? 0), byPath: { bank: Number(contracts.n), distribution: Number(distributionContracts?.n ?? 0) }, totalAmount: contracts.amount, amountRecordedBy: 'factory' as const, aboveAlertCount: await contractsAboveAlert(base, scope.params), alertThresholdEGP: shamsPolicy.contractAmountAlertEGP } : undefined,
    byGovernorate: stageLimit ? undefined : byGovernorate.map((g) => ({ governorate: g.governorate, count: g.n })),
    stateLabels: Object.fromEntries(APPLICATION_STATES.map((s) => [s, STATE_LABELS[s]])),
    generatedAt: new Date().toISOString(),
  };
}

async function contractsAboveAlert(base: string, params: SqlParam[]): Promise<number> {
  return (await getDb().prepare(`SELECT COUNT(*) AS n FROM shams_bank_referrals r WHERE r.contractStatus = 'contracted' AND r.contractAmount > ? AND r.applicationId IN (SELECT a.id ${base})`)
    .get(shamsPolicy.contractAmountAlertEGP, ...params) as { n: number }).n;
}

/** صفوف تقرير Excel. `full` = PMU/الأدمن (مقدم الخدمة والبنك والتعاقد والإرجاعات). */
export async function reportRows(apps: AppRow[], full: boolean) {
  // PERF-3: the export used ~2.7 sequential queries per application (13,478 for 5,005 rows: 5.8 s, 28 s with 10 concurrent exports).
  // The same data is now loaded in a handful of batched queries; every value below is computed exactly as before.
  const ids = apps.map((a) => a.id);
  const orgs = await preloadListOrgs(apps);
  const referrals = full ? await getBankReferralsFor(ids) : new Map();
  const distributions = full ? await getDistributionContractsFor(ids) : new Map();
  const transitions = full ? await listTransitionsFor(ids) : new Map();
  const providers = full ? await getProvidersByIds(apps.map((a) => a.providerId).filter((x): x is string => Boolean(x))) : new Map();
  return mapSeq(apps, async (a) => {
    const sla = slaInfo(a);
    const resp = await responsibleInfo(a, orgs);
    const base = {
      number: a.number ?? '', companyName: a.companyName, governorate: a.governorate, industrialZone: a.industrialZone,
      industrialRegistryNumber: a.industrialRegistryNumber ?? '', state: a.state, stateLabelAr: STATE_LABELS[a.state].ar, stateLabelEn: STATE_LABELS[a.state].en,
      responsibleAr: resp.orgNameAr ?? resp.labelAr, responsibleEn: resp.orgNameEn ?? resp.labelEn,
      submittedAt: a.submittedAt ?? '', stateEnteredAt: a.stateEnteredAt, daysInState: sla.daysInState, overdue: sla.overdue,
      totalRoofArea: a.totalRoofArea, attempt: a.attempt,
    };
    if (!full) return base;
    const ref = referrals.get(a.id) ?? null;
    const dist = distributions.get(a.id) ?? null;
    const distStatus = dist?.reviewStatus === 'approved' ? 'contracted' : dist?.reviewStatus === 'rejected' ? 'not_contracted' : '';
    const returns = returnCounts(transitions.get(a.id) ?? []);
    return {
      ...base,
      returnsTotal: Object.values(returns).reduce((s, n) => s + (n ?? 0), 0),
      providerAr: a.providerId ? providers.get(a.providerId)?.nameAr ?? '' : '',
      bankAr: a.bankOrgId ? orgs.get(a.bankOrgId)?.nameAr ?? '' : '',
      contractPath: a.contractPath ?? '',
      contractStatus: a.contractPath === 'distribution' ? distStatus : ref?.contractStatus ?? '', contractAmount: ref?.contractAmount ?? null,
      contractDate: a.contractPath === 'distribution' ? (dist?.reviewStatus === 'approved' ? dist.decidedAt ?? '' : '') : ref?.contractDate ?? '', closedAt: a.closedAt ?? '',
    };
  });
}

// ── I7: ورقة Excel مقروءة (رؤوس عربية، أسماء لا أكواد، توقيت القاهرة، نعم/لا) ─────────────────────

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
const CONTRACT_AR: Record<string, string> = { contracted: 'تم التعاقد', not_contracted: 'لم يتم التعاقد' };
const CONTRACT_PATH_AR: Record<string, string> = { bank: 'بنك', distribution: 'شركة توزيع الكهرباء' };

function govNames(gov: string, zone: string): { gov: string; zone: string } {
  const g = findGovernorate(gov);
  return { gov: g?.labelAr ?? gov, zone: zoneLabel(gov, zone)?.ar ?? zone };
}

/** يحول صفوف reportRows إلى ورقة جاهزة للعرض الإداري — نفس النطاق والأعمدة حسب الدور. */
export function reportSheet(rows: Awaited<ReturnType<typeof reportRows>>, full: boolean): { headers: string[]; rows: Cell[][] } {
  const cols: Array<[string, (r: Record<string, unknown>) => Cell]> = [
    ['رقم الطلب', (r) => String(r.number || 'مسودة')],
    ['اسم الشركة', (r) => String(r.companyName ?? '')],
    ['المحافظة', (r) => govNames(String(r.governorate ?? ''), String(r.industrialZone ?? '')).gov],
    ['المنطقة الصناعية', (r) => govNames(String(r.governorate ?? ''), String(r.industrialZone ?? '')).zone],
    ['رقم السجل الصناعي', (r) => String(r.industrialRegistryNumber ?? '')],
    ['الحالة', (r) => String(r.stateLabelAr ?? '')],
    ['الجهة المسؤولة', (r) => String(r.responsibleAr ?? '')],
    ['تاريخ الإرسال (القاهرة)', (r) => cairoDateTime(r.submittedAt as string)],
    ['دخل المرحلة في (القاهرة)', (r) => cairoDateTime(r.stateEnteredAt as string)],
    ['أيام في المرحلة', (r) => Number(r.daysInState ?? 0)],
    [slaConfigured() ? 'متأخر عن المهلة' : 'متأخر عن المهلة (لم تُحدد مهل)', (r) => (slaConfigured() ? yesNo(r.overdue) : '—')],
    ['إجمالي مساحة الأسطح (م²)', (r) => Number(r.totalRoofArea ?? 0)],
    ['رقم المحاولة', (r) => Number(r.attempt ?? 0)],
  ];
  if (full) {
    cols.push(
      ['عدد مرات الإرجاع', (r) => Number(r.returnsTotal ?? 0)],
      ['مقدم الخدمة', (r) => String(r.providerAr ?? '')],
      ['البنك', (r) => String(r.bankAr ?? '')],
      ['مسار التعاقد', (r) => CONTRACT_PATH_AR[String(r.contractPath)] ?? ''],
      ['نتيجة التعاقد', (r) => CONTRACT_AR[String(r.contractStatus)] ?? ''],
      ['قيمة التعاقد — مسجلة من المصنع (جنيه)', (r) => (r.contractAmount === null || r.contractAmount === undefined ? null : Number(r.contractAmount))],
      [`أعلى من ${shamsPolicy.contractAmountAlertEGP.toLocaleString('en-US')} جنيه`, (r) => (r.contractAmount ? yesNo(Number(r.contractAmount) > shamsPolicy.contractAmountAlertEGP) : '')],
      ['تاريخ التعاقد', (r) => cairoDateTime(r.contractDate as string)],
      ['تاريخ الإغلاق (القاهرة)', (r) => cairoDateTime(r.closedAt as string)],
    );
  }
  return { headers: cols.map(([h]) => h), rows: rows.map((r) => cols.map(([, f]) => f(r as Record<string, unknown>))) };
}
