import { getDb, nowIso, parseJson } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import { CRITERION_KEYS, type CriterionKey } from '../config/initiativePolicy.js';

/** إسناد مقيّم لطلب ودرجاته (docs/SONA3_DESIGN.md §8). */
export type AssignmentStatus = 'assigned' | 'draft' | 'submitted' | 'conflict' | 'removed';

export interface Assignment {
  id: string; applicationId: string; evaluatorUserId: string; assignedBy: string | null; assignedAt: string; status: AssignmentStatus;
  coiDeclaredAt: string | null; coiNote: string; scores: Partial<Record<CriterionKey, number>>; notes: Partial<Record<CriterionKey, string>>;
  recommendation: string; weightedScore: number | null; submittedAt: string | null; removedAt: string | null; removeReason: string; updatedAt: string;
}

function map(r: Record<string, unknown>): Assignment {
  return {
    id: String(r.id), applicationId: String(r.applicationId), evaluatorUserId: String(r.evaluatorUserId), assignedBy: (r.assignedBy as string | null) ?? null,
    assignedAt: String(r.assignedAt), status: r.status as AssignmentStatus, coiDeclaredAt: (r.coiDeclaredAt as string | null) ?? null,
    coiNote: String(r.coiNote ?? ''), scores: parseJson(r.scores, {}), notes: parseJson(r.notes, {}), recommendation: String(r.recommendation ?? ''),
    weightedScore: r.weightedScore === null || r.weightedScore === undefined ? null : Number(r.weightedScore),
    submittedAt: (r.submittedAt as string | null) ?? null, removedAt: (r.removedAt as string | null) ?? null,
    removeReason: String(r.removeReason ?? ''), updatedAt: String(r.updatedAt),
  };
}

export function getAssignment(id: string): Assignment | null {
  const r = getDb().prepare('SELECT * FROM evaluator_assignments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

/** الإسنادات غير المحذوفة للطلب. */
export function activeAssignments(appId: string): Assignment[] {
  return (getDb().prepare("SELECT * FROM evaluator_assignments WHERE applicationId = ? AND status <> 'removed' ORDER BY assignedAt").all(appId) as Array<Record<string, unknown>>).map(map);
}

export function allAssignments(appId: string): Assignment[] {
  return (getDb().prepare('SELECT * FROM evaluator_assignments WHERE applicationId = ? ORDER BY assignedAt').all(appId) as Array<Record<string, unknown>>).map(map);
}

export function assignmentFor(appId: string, userId: string): Assignment | null {
  const r = getDb().prepare("SELECT * FROM evaluator_assignments WHERE applicationId = ? AND evaluatorUserId = ? AND status <> 'removed'").get(appId, userId) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

/** إسنادات المقيّم (قائمة عمله). */
export function assignmentsOfEvaluator(userId: string): Assignment[] {
  return (getDb().prepare("SELECT * FROM evaluator_assignments WHERE evaluatorUserId = ? AND status <> 'removed' ORDER BY assignedAt DESC").all(userId) as Array<Record<string, unknown>>).map(map);
}

export function insertAssignment(appId: string, evaluatorUserId: string, assignedBy: string): Assignment {
  const id = newId('asg');
  const now = nowIso();
  getDb().prepare(`INSERT INTO evaluator_assignments (id, applicationId, evaluatorUserId, assignedBy, assignedAt, status, updatedAt)
    VALUES (?, ?, ?, ?, ?, 'assigned', ?)`).run(id, appId, evaluatorUserId, assignedBy, now, now);
  return getAssignment(id)!;
}

export function removeAssignment(id: string, by: string, reason: string): void {
  const now = nowIso();
  getDb().prepare("UPDATE evaluator_assignments SET status = 'removed', removedAt = ?, removedBy = ?, removeReason = ?, updatedAt = ? WHERE id = ?").run(now, by, reason, now, id);
}

export function declareCoi(id: string, conflict: boolean, note: string): void {
  const now = nowIso();
  getDb().prepare('UPDATE evaluator_assignments SET status = ?, coiDeclaredAt = ?, coiNote = ?, updatedAt = ? WHERE id = ?')
    .run(conflict ? 'conflict' : 'draft', now, note, now, id);
}

export function saveScores(id: string, scores: Partial<Record<CriterionKey, number>>, notes: Partial<Record<CriterionKey, string>>, recommendation: string): void {
  getDb().prepare('UPDATE evaluator_assignments SET scores = ?, notes = ?, recommendation = ?, updatedAt = ? WHERE id = ?')
    .run(JSON.stringify(scores), JSON.stringify(notes), recommendation, nowIso(), id);
}

export function submitScores(id: string, weightedScore: number): void {
  const now = nowIso();
  getDb().prepare("UPDATE evaluator_assignments SET status = 'submitted', weightedScore = ?, submittedAt = ?, updatedAt = ? WHERE id = ?").run(weightedScore, now, now, id);
}

/** الدرجة الموزونة = Σ(درجة × وزن) / Σ(الأوزان). */
export function weighted(scores: Partial<Record<CriterionKey, number>>, weights: Record<CriterionKey, number>): number {
  const total = CRITERION_KEYS.reduce((s, k) => s + (weights[k] ?? 0), 0) || 1;
  const sum = CRITERION_KEYS.reduce((s, k) => s + (scores[k] ?? 0) * (weights[k] ?? 0), 0);
  return Math.round((sum / total) * 100) / 100;
}

export interface Aggregate {
  evaluators: number;
  score: number | null;
  perCriterion: Record<CriterionKey, number | null>;
}

/** متوسط درجات المقيّمين الذين سلّموا (لكل معيار وللإجمالي الموزون). */
export function aggregate(list: Assignment[]): Aggregate {
  const done = list.filter((a) => a.status === 'submitted');
  const avg = (vals: number[]) => (vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null);
  const perCriterion = Object.fromEntries(CRITERION_KEYS.map((k) => [k, avg(done.map((a) => a.scores[k]).filter((v): v is number => typeof v === 'number'))])) as Record<CriterionKey, number | null>;
  return { evaluators: done.length, score: avg(done.map((a) => a.weightedScore ?? 0)), perCriterion };
}

export function setApplicationScore(appId: string, score: number | null, passed: boolean | null): void {
  getDb().prepare('UPDATE applications SET score = ?, passedMinimums = ?, updatedAt = ? WHERE id = ?')
    .run(score, passed === null ? null : passed ? 1 : 0, nowIso(), appId);
}
