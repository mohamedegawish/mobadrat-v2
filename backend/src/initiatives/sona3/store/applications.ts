import { getDb, nowIso, parseJson } from '../db/sqlite.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';
import type { ApplicationState, ActionName } from '../workflow/workflow.js';
import type { DataSection } from '../workflow/applicationForm.js';

export interface AppRow {
  id: string; number: string | null; applicantId: string; applicantOrgId: string; cohortId: string; state: ApplicationState;
  version: number; attempt: number; expertId: string | null; funderOrgId: string | null;
  applicantName: string; projectName: string; sector: string; governorate: string; nationalId: string | null; birthDate: string | null;
  teamSize: number; estimatedCost: number; requestedFunding: number; totalInvestment: number; expectedJobs: number;
  score: number | null; passedMinimums: boolean | null; isStalled: boolean; stalledNote: string;
  createdBy: string | null; submittedAt: string | null; stateEnteredAt: string; closedAt: string | null; createdAt: string; updatedAt: string;
}

const SELECT = 'SELECT a.*, p.organizationId AS applicantOrgId FROM applications a JOIN applicants p ON p.id = a.applicantId';
const OPEN_STATES_SQL = "('REJECTED','NOT_SELECTED','NOT_APPROVED','CLOSED_NOT_FUNDED','COMPLETED','WITHDRAWN')";

function mapApp(r: Record<string, unknown>): AppRow {
  const s = (k: string) => String(r[k] ?? '');
  const sn = (k: string) => (r[k] as string | null) ?? null;
  return {
    id: s('id'), number: sn('number'), applicantId: s('applicantId'), applicantOrgId: s('applicantOrgId'), cohortId: s('cohortId'),
    state: r.state as ApplicationState, version: Number(r.version), attempt: Number(r.attempt),
    expertId: sn('expertId'), funderOrgId: sn('funderOrgId'),
    applicantName: s('applicantName'), projectName: s('projectName'), sector: s('sector'), governorate: s('governorate'),
    nationalId: sn('nationalId'), birthDate: sn('birthDate'), teamSize: Number(r.teamSize ?? 1),
    estimatedCost: Number(r.estimatedCost ?? 0), requestedFunding: Number(r.requestedFunding ?? 0), totalInvestment: Number(r.totalInvestment ?? 0),
    expectedJobs: Number(r.expectedJobs ?? 0), score: r.score === null || r.score === undefined ? null : Number(r.score),
    passedMinimums: r.passedMinimums === null || r.passedMinimums === undefined ? null : r.passedMinimums === 1,
    isStalled: r.isStalled === 1, stalledNote: s('stalledNote'),
    createdBy: sn('createdBy'), submittedAt: sn('submittedAt'), stateEnteredAt: s('stateEnteredAt'), closedAt: sn('closedAt'),
    createdAt: s('createdAt'), updatedAt: s('updatedAt'),
  };
}

export function getApplication(id: string): AppRow | null {
  const r = getDb().prepare(`${SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? mapApp(r) : null;
}

export function findOpenApplicationForApplicant(applicantId: string): AppRow | null {
  const r = getDb().prepare(`${SELECT} WHERE a.applicantId = ? AND a.state NOT IN ${OPEN_STATES_SQL}`).get(applicantId) as Record<string, unknown> | undefined;
  return r ? mapApp(r) : null;
}

/** طلب آخر مُرسل وغير نهائي بنفس الرقم القومي (المسودات لا تحجز الرقم). */
export function findOpenSubmittedByNationalId(nationalId: string, exceptId: string): AppRow | null {
  const r = getDb().prepare(`${SELECT} WHERE a.nationalId = ? AND a.id <> ? AND a.state <> 'DRAFT' AND a.state NOT IN ${OPEN_STATES_SQL}`)
    .get(nationalId, exceptId) as Record<string, unknown> | undefined;
  return r ? mapApp(r) : null;
}

export function createDraftApplication(applicantId: string, cohortId: string, userId: string, applicantName: string): AppRow {
  const id = newId('app');
  const now = nowIso();
  getDb().prepare(`INSERT INTO applications (id, applicantId, cohortId, state, version, attempt, applicantName, createdBy, stateEnteredAt, createdAt, updatedAt)
    VALUES (?, ?, ?, 'DRAFT', 1, 0, ?, ?, ?, ?, ?)`).run(id, applicantId, cohortId, applicantName, userId, now, now, now);
  return getApplication(id)!;
}

export function listApplicantApplications(applicantId: string): AppRow[] {
  return (getDb().prepare(`${SELECT} WHERE a.applicantId = ? ORDER BY a.createdAt DESC`).all(applicantId) as Array<Record<string, unknown>>).map(mapApp);
}

export interface ListFilter {
  scopeSql: string; scopeParams: SqlParam[];
  q?: string; states?: ApplicationState[]; cohortId?: string; sector?: string; governorate?: string; funderOrgId?: string;
  from?: string; to?: string; includeDrafts?: boolean;
  /** «بانتظار قراري»: الأقدم انتظارًا أولًا. */
  oldestFirst?: boolean;
  /** ترتيب الدورة: الأعلى درجة أولًا. */
  byScore?: boolean;
}

export function listApplications(f: ListFilter, page: number, pageSize: number, all = false): { rows: AppRow[]; total: number } {
  const where: string[] = [f.scopeSql];
  const params: SqlParam[] = [...f.scopeParams];
  if (!f.includeDrafts) where.push("a.state <> 'DRAFT'");
  if (f.states?.length) { where.push(`a.state IN (${f.states.map(() => '?').join(',')})`); params.push(...f.states); }
  if (f.cohortId) { where.push('a.cohortId = ?'); params.push(f.cohortId); }
  if (f.sector) { where.push('a.sector = ?'); params.push(f.sector); }
  if (f.governorate) { where.push('a.governorate = ?'); params.push(f.governorate); }
  if (f.funderOrgId) { where.push('a.funderOrgId = ?'); params.push(f.funderOrgId); }
  if (f.from) { where.push('COALESCE(a.submittedAt, a.createdAt) >= ?'); params.push(f.from); }
  if (f.to) { where.push('COALESCE(a.submittedAt, a.createdAt) <= ?'); params.push(f.to); }
  if (f.q) {
    where.push("(a.number LIKE ? ESCAPE '\\' OR a.projectName LIKE ? ESCAPE '\\' OR a.applicantName LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM applications a JOIN applicants p ON p.id = a.applicantId ${w}`).get(...params) as { n: number }).n;
  const limit = all ? '' : ` LIMIT ${Number(pageSize)} OFFSET ${Number((page - 1) * pageSize)}`;
  const order = f.byScore ? 'a.score IS NULL, a.score DESC, a.submittedAt ASC' : `a.stateEnteredAt ${f.oldestFirst ? 'ASC' : 'DESC'}`;
  const rows = (db.prepare(`${SELECT} ${w} ORDER BY ${order}, a.id${limit}`).all(...params) as Array<Record<string, unknown>>).map(mapApp);
  return { rows, total };
}

/** طلبات الدورة في حالة معينة مرتبة بالدرجة (للاختيار). */
export function cohortRanking(cohortId: string, states: ApplicationState[]): AppRow[] {
  return (getDb().prepare(`${SELECT} WHERE a.cohortId = ? AND a.state IN (${states.map(() => '?').join(',')})
    ORDER BY a.score IS NULL, a.score DESC, a.submittedAt ASC, a.id`).all(cohortId, ...states) as Array<Record<string, unknown>>).map(mapApp);
}

/** عدد طلبات الدورة التي دخلت حالة معينة (مرة واحدة على الأقل). */
export function countCohortEntered(cohortId: string, state: ApplicationState): number {
  return (getDb().prepare(`SELECT COUNT(DISTINCT a.id) AS n FROM applications a JOIN application_transitions t ON t.applicationId = a.id
    WHERE a.cohortId = ? AND t.toState = ? AND t.fromState <> t.toState`).get(cohortId, state) as { n: number }).n;
}

export function setApplicationColumns(appId: string, cols: Partial<Record<'applicantName' | 'projectName' | 'sector' | 'governorate' | 'nationalId' | 'birthDate'
  | 'teamSize' | 'estimatedCost' | 'requestedFunding' | 'totalInvestment' | 'expectedJobs' | 'expertId', string | number | null>>): void {
  const keys = Object.keys(cols);
  if (!keys.length) return;
  getDb().prepare(`UPDATE applications SET ${keys.map((k) => `${k} = ?`).join(', ')}, updatedAt = ? WHERE id = ?`)
    .run(...keys.map((k) => (cols as Record<string, string | number | null>)[k]), nowIso(), appId);
}

export function setStalled(appId: string, stalled: boolean, note: string): void {
  getDb().prepare('UPDATE applications SET isStalled = ?, stalledNote = ?, version = version + 1, updatedAt = ? WHERE id = ?').run(stalled ? 1 : 0, note, nowIso(), appId);
}

// ── application_data (نسخ لكل محاولة) ──────────────────────────────────────

/** آخر نسخة لقسم بحد أقصى للمحاولة (المراجع يرى ≤ attempt، والمتقدم يرى الأحدث بما فيها غير المُرسل). */
export function getSection(appId: string, section: DataSection, maxAttempt?: number): Record<string, unknown> | undefined {
  const r = (maxAttempt === undefined
    ? getDb().prepare('SELECT data FROM application_data WHERE applicationId = ? AND section = ? ORDER BY attempt DESC LIMIT 1').get(appId, section)
    : getDb().prepare('SELECT data FROM application_data WHERE applicationId = ? AND section = ? AND attempt <= ? ORDER BY attempt DESC LIMIT 1').get(appId, section, maxAttempt)
  ) as { data: string } | undefined;
  return r ? parseJson<Record<string, unknown>>(r.data, {}) : undefined;
}

/** يكتب نسخة المحاولة القادمة (copy-on-write) — لا يمس النسخ المُرسلة السابقة. */
export function writeSection(appId: string, section: DataSection, attempt: number, data: Record<string, unknown>, userId: string): void {
  const now = nowIso();
  getDb().prepare(`INSERT INTO application_data (id, applicationId, section, attempt, data, updatedBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(applicationId, section, attempt) DO UPDATE SET data = excluded.data, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`)
    .run(newId('dat'), appId, section, attempt, JSON.stringify(data), userId, now, now);
}

// ── الانتقالات والنواقص ─────────────────────────────────────────────────────

export interface TransitionRow {
  id: string; applicationId: string; fromState: ApplicationState; toState: ApplicationState; action: ActionName;
  actorUserId: string | null; actorRole: string; actorOrgId: string | null; actorName: string; reason: string; attempt: number;
  payload: Record<string, unknown>; createdAt: string;
}

export function insertTransition(t: Omit<TransitionRow, 'id' | 'createdAt'>): TransitionRow {
  const id = newId('trn');
  const createdAt = nowIso();
  getDb().prepare(`INSERT INTO application_transitions (id, applicationId, fromState, toState, action, actorUserId, actorRole, actorOrgId,
      actorName, reason, attempt, payload, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, t.applicationId, t.fromState, t.toState, t.action, t.actorUserId, t.actorRole, t.actorOrgId, t.actorName, t.reason, t.attempt,
    JSON.stringify(t.payload ?? {}), createdAt,
  );
  return { ...t, id, createdAt };
}

export function listTransitions(appId: string): TransitionRow[] {
  return (getDb().prepare('SELECT * FROM application_transitions WHERE applicationId = ? ORDER BY createdAt, rowid').all(appId) as Array<Record<string, unknown>>)
    .map((r) => ({ ...(r as unknown as TransitionRow), payload: parseJson(r.payload, {}) }));
}

export function getTransition(id: string): TransitionRow | null {
  const r = getDb().prepare('SELECT * FROM application_transitions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? { ...(r as unknown as TransitionRow), payload: parseJson(r.payload, {}) } : null;
}

export function hasEnteredState(appId: string, state: ApplicationState): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM application_transitions WHERE applicationId = ? AND toState = ? AND fromState <> toState LIMIT 1').get(appId, state));
}

export interface DeficiencyRow {
  id: string; applicationId: string; transitionId: string; stage: ApplicationState; field: string; note: string;
  resolvedAtTransitionId: string | null; createdAt: string;
}

export function insertDeficiency(appId: string, transitionId: string, stage: ApplicationState, field: string, note: string): void {
  getDb().prepare('INSERT INTO deficiencies (id, applicationId, transitionId, stage, field, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('def'), appId, transitionId, stage, field, note, nowIso());
}

export function openDeficiencies(appId: string): DeficiencyRow[] {
  return getDb().prepare('SELECT * FROM deficiencies WHERE applicationId = ? AND resolvedAtTransitionId IS NULL ORDER BY createdAt').all(appId) as unknown as DeficiencyRow[];
}

export function listDeficiencies(appId: string): DeficiencyRow[] {
  return getDb().prepare('SELECT * FROM deficiencies WHERE applicationId = ? ORDER BY createdAt').all(appId) as unknown as DeficiencyRow[];
}

export function resolveDeficiencies(appId: string, transitionId: string): void {
  getDb().prepare('UPDATE deficiencies SET resolvedAtTransitionId = ? WHERE applicationId = ? AND resolvedAtTransitionId IS NULL').run(transitionId, appId);
}

/** رقم الطلب SONA3-<السنة>-<تسلسل> — داخل معاملة الإرسال. */
export function nextApplicationNumber(): string {
  const year = new Date().getUTCFullYear();
  const db = getDb();
  db.prepare('INSERT INTO application_counters (year, lastSeq) VALUES (?, 0) ON CONFLICT(year) DO NOTHING').run(year);
  db.prepare('UPDATE application_counters SET lastSeq = lastSeq + 1 WHERE year = ?').run(year);
  const { lastSeq } = db.prepare('SELECT lastSeq FROM application_counters WHERE year = ?').get(year) as { lastSeq: number };
  return `SONA3-${year}-${String(lastSeq).padStart(5, '0')}`;
}
