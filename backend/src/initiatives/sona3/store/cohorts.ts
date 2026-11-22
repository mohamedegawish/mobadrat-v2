import { getDb, nowIso, parseJson } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import { CRITERION_KEYS, policy, type CriterionKey } from '../config/initiativePolicy.js';

/** دورة تقديم: المواعيد والمستهدفات وأوزان التقييم والحدود الدنيا (docs/SONA3_DESIGN.md §3). */
export interface Cohort {
  id: string; nameAr: string; nameEn: string; opensAt: string; closesAt: string;
  evaluationTarget: number; selectionTarget: number; maxAge: number; ageReference: 'cohort_close' | 'submission';
  weights: Record<CriterionKey, number>; minTotalScore: number; minFinancialScore: number; minTechnicalScore: number; minEvaluators: number;
  createdBy: string | null; createdAt: string; updatedAt: string;
}

export type CohortStatus = 'upcoming' | 'open' | 'closed';

function map(r: Record<string, unknown>): Cohort {
  const w = parseJson<Record<string, number>>(r.weights, {});
  const weights = Object.fromEntries(CRITERION_KEYS.map((k) => [k, Number(w[k] ?? 0)])) as Record<CriterionKey, number>;
  return {
    id: String(r.id), nameAr: String(r.nameAr), nameEn: String(r.nameEn ?? ''), opensAt: String(r.opensAt), closesAt: String(r.closesAt),
    evaluationTarget: Number(r.evaluationTarget), selectionTarget: Number(r.selectionTarget), maxAge: Number(r.maxAge),
    ageReference: r.ageReference as Cohort['ageReference'], weights,
    minTotalScore: Number(r.minTotalScore), minFinancialScore: Number(r.minFinancialScore), minTechnicalScore: Number(r.minTechnicalScore),
    minEvaluators: Number(r.minEvaluators), createdBy: (r.createdBy as string | null) ?? null, createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  };
}

export function today(): string { return new Date().toISOString().slice(0, 10); }

export function cohortStatus(c: Pick<Cohort, 'opensAt' | 'closesAt'>, on = today()): CohortStatus {
  if (on < c.opensAt) return 'upcoming';
  if (on > c.closesAt) return 'closed';
  return 'open';
}

export async function getCohort(id: string): Promise<Cohort | null> {
  const r = await getDb().prepare('SELECT * FROM sona3_cohorts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export async function listCohorts(): Promise<Cohort[]> {
  return (await getDb().prepare('SELECT * FROM sona3_cohorts ORDER BY opensAt DESC, createdAt DESC').all() as Array<Record<string, unknown>>).map(map);
}

/** الدورة المفتوحة للتقديم الآن (الأحدث إن تداخلت دورتان). */
export async function openCohort(on = today()): Promise<Cohort | null> {
  const r = await getDb().prepare('SELECT * FROM sona3_cohorts WHERE opensAt <= ? AND closesAt >= ? ORDER BY opensAt DESC LIMIT 1').get(on, on) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

/** الأوزان تُقفل بمجرد تسليم أول تقييم في الدورة. */
export async function weightsLocked(cohortId: string): Promise<boolean> {
  return Boolean(await getDb().prepare(`SELECT 1 FROM sona3_evaluator_assignments e JOIN sona3_applications a ON a.id = e.applicationId
    WHERE a.cohortId = ? AND e.status = 'submitted' LIMIT 1`).get(cohortId));
}

export interface CohortInput {
  nameAr: string; nameEn?: string; opensAt: string; closesAt: string; evaluationTarget?: number; selectionTarget?: number; maxAge?: number;
  ageReference?: Cohort['ageReference']; weights?: Record<CriterionKey, number>; minTotalScore?: number; minFinancialScore?: number;
  minTechnicalScore?: number; minEvaluators?: number;
}

export async function createCohort(input: CohortInput, createdBy: string | null): Promise<Cohort> {
  const id = newId('coh');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO sona3_cohorts (id, nameAr, nameEn, opensAt, closesAt, evaluationTarget, selectionTarget, maxAge, ageReference, weights,
      minTotalScore, minFinancialScore, minTechnicalScore, minEvaluators, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, input.nameAr, input.nameEn ?? '', input.opensAt, input.closesAt, input.evaluationTarget ?? 60, input.selectionTarget ?? 15,
    input.maxAge ?? 35, input.ageReference ?? 'cohort_close', JSON.stringify(input.weights ?? policy.defaultWeights),
    input.minTotalScore ?? 50, input.minFinancialScore ?? 50, input.minTechnicalScore ?? 50, input.minEvaluators ?? 1, createdBy, now, now,
  );
  return (await getCohort(id))!;
}

export async function updateCohort(id: string, patch: Partial<CohortInput>): Promise<Cohort | null> {
  const cur = await getCohort(id);
  if (!cur) return null;
  const n = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Cohort;
  await getDb().prepare(`UPDATE sona3_cohorts SET nameAr = ?, nameEn = ?, opensAt = ?, closesAt = ?, evaluationTarget = ?, selectionTarget = ?, maxAge = ?,
      ageReference = ?, weights = ?, minTotalScore = ?, minFinancialScore = ?, minTechnicalScore = ?, minEvaluators = ?, updatedAt = ? WHERE id = ?`).run(
    n.nameAr, n.nameEn, n.opensAt, n.closesAt, n.evaluationTarget, n.selectionTarget, n.maxAge, n.ageReference, JSON.stringify(n.weights),
    n.minTotalScore, n.minFinancialScore, n.minTechnicalScore, n.minEvaluators, nowIso(), id,
  );
  return getCohort(id);
}
