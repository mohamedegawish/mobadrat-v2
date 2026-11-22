import { getDb, nowIso, parseJson } from '../db/sqlite.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';
import type { ApplicationState, ActionName, ContractPath } from '../workflow/shamsWorkflow.js';
import type { DataSection } from '../workflow/applicationForm.js';

export interface AppRow {
  id: string; number: string | null; factoryId: string; factoryOrgId: string; state: ApplicationState; version: number; attempt: number;
  providerId: string | null; bankOrgId: string | null; companyName: string; governorate: string; industrialZone: string;
  industrialRegistryNumber: string | null; totalRoofArea: number; registryVerificationId: string | null; verifiedRegistryNumber: string | null;
  createdBy: string | null; submittedAt: string | null; stateEnteredAt: string; closedAt: string | null; createdAt: string; updatedAt: string;
  /** مسار التعاقد بعد قبول موافقة الكهرباء: null = لم يُختر بعد. */
  contractPath: ContractPath | null;
}

const SELECT = 'SELECT a.*, f.organizationId AS factoryOrgId FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId';

function mapApp(r: Record<string, unknown>): AppRow {
  return {
    id: String(r.id), number: (r.number as string | null) ?? null, factoryId: String(r.factoryId), factoryOrgId: String(r.factoryOrgId),
    state: r.state as ApplicationState, version: Number(r.version), attempt: Number(r.attempt),
    providerId: (r.providerId as string | null) ?? null, bankOrgId: (r.bankOrgId as string | null) ?? null,
    companyName: String(r.companyName ?? ''), governorate: String(r.governorate ?? ''), industrialZone: String(r.industrialZone ?? ''),
    industrialRegistryNumber: (r.industrialRegistryNumber as string | null) ?? null, totalRoofArea: Number(r.totalRoofArea ?? 0),
    registryVerificationId: (r.registryVerificationId as string | null) ?? null, verifiedRegistryNumber: (r.verifiedRegistryNumber as string | null) ?? null,
    createdBy: (r.createdBy as string | null) ?? null, submittedAt: (r.submittedAt as string | null) ?? null,
    stateEnteredAt: String(r.stateEnteredAt), closedAt: (r.closedAt as string | null) ?? null,
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
    contractPath: (r.contractPath as ContractPath | null) ?? null,
  };
}

export async function getApplication(id: string): Promise<AppRow | null> {
  const r = await getDb().prepare(`${SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? mapApp(r) : null;
}

export async function findOpenApplicationForFactory(factoryId: string): Promise<AppRow | null> {
  const r = await getDb().prepare(`${SELECT} WHERE a.factoryId = ? AND a.state NOT IN ('REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')`).get(factoryId) as Record<string, unknown> | undefined;
  return r ? mapApp(r) : null;
}

/** طلب آخر مُرسل وغير نهائي بنفس رقم السجل (المسودات لا تحجز الرقم). */
export async function findOpenSubmittedByRegistry(registryNumber: string, exceptId: string): Promise<AppRow | null> {
  const r = await getDb().prepare(`${SELECT} WHERE a.industrialRegistryNumber = ? AND a.id <> ?
    AND a.state NOT IN ('DRAFT','REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')`).get(registryNumber, exceptId) as Record<string, unknown> | undefined;
  return r ? mapApp(r) : null;
}

export async function createDraftApplication(factoryId: string, userId: string, companyName: string): Promise<AppRow> {
  const id = newId('app');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO shams_applications (id, factoryId, state, version, attempt, companyName, createdBy, stateEnteredAt, createdAt, updatedAt)
    VALUES (?, ?, 'DRAFT', 1, 0, ?, ?, ?, ?, ?)`).run(id, factoryId, companyName, userId, now, now, now);
  return (await getApplication(id))!;
}

export async function listFactoryApplications(factoryId: string): Promise<AppRow[]> {
  return (await getDb().prepare(`${SELECT} WHERE a.factoryId = ? ORDER BY a.createdAt DESC`).all(factoryId) as Array<Record<string, unknown>>).map(mapApp);
}

export interface ListFilter {
  scopeSql: string; scopeParams: SqlParam[];
  q?: string; states?: ApplicationState[]; governorate?: string; bankOrgId?: string; from?: string; to?: string; includeDrafts?: boolean;
  /** «بانتظار قراري»: الأقدم انتظارًا أولًا (I6). */
  oldestFirst?: boolean;
  /** F-02: البحث `q` برقم الطلب فقط (API الربط الوصفي لا يبحث في اسم الشركة ولا رقم السجل). */
  qNumberOnly?: boolean;
}

export async function listApplications(f: ListFilter, page: number, pageSize: number, all = false): Promise<{ rows: AppRow[]; total: number }> {
  const where: string[] = [f.scopeSql];
  const params: SqlParam[] = [...f.scopeParams];
  if (!f.includeDrafts) where.push("a.state <> 'DRAFT'");
  if (f.states?.length) { where.push(`a.state IN (${f.states.map(() => '?').join(',')})`); params.push(...f.states); }
  if (f.governorate) { where.push('a.governorate = ?'); params.push(f.governorate); }
  if (f.bankOrgId) { where.push('a.bankOrgId = ?'); params.push(f.bankOrgId); }
  if (f.from) { where.push('COALESCE(a.submittedAt, a.createdAt) >= ?'); params.push(f.from); }
  if (f.to) { where.push('COALESCE(a.submittedAt, a.createdAt) <= ?'); params.push(f.to); }
  if (f.q && f.qNumberOnly) {
    where.push("a.number LIKE ? ESCAPE '\\'");
    params.push(likePattern(f.q));
  } else if (f.q) {
    where.push("(a.number LIKE ? ESCAPE '\\' OR a.companyName LIKE ? ESCAPE '\\' OR a.industrialRegistryNumber LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const db = getDb();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId ${w}`).get(...params) as { n: number }).n;
  const limit = all ? '' : ` LIMIT ${Number(pageSize)} OFFSET ${Number((page - 1) * pageSize)}`;
  const rows = (await db.prepare(`${SELECT} ${w} ORDER BY a.stateEnteredAt ${f.oldestFirst ? 'ASC' : 'DESC'}, a.id${limit}`).all(...params) as Array<Record<string, unknown>>).map(mapApp);
  return { rows, total };
}

// ── application_data (نسخ لكل محاولة) ──────────────────────────────────────

/** آخر نسخة لقسم بحد أقصى للمحاولة (المراجع يرى ≤ attempt، والمصنع يرى الأحدث بما فيها غير المُرسل). */
export async function getSection(appId: string, section: DataSection, maxAttempt?: number): Promise<Record<string, unknown> | undefined> {
  const r = (maxAttempt === undefined
    ? await getDb().prepare('SELECT data FROM shams_application_data WHERE applicationId = ? AND section = ? ORDER BY attempt DESC LIMIT 1').get(appId, section)
    : await getDb().prepare('SELECT data FROM shams_application_data WHERE applicationId = ? AND section = ? AND attempt <= ? ORDER BY attempt DESC LIMIT 1').get(appId, section, maxAttempt)
  ) as { data: string } | undefined;
  return r ? parseJson<Record<string, unknown>>(r.data, {}) : undefined;
}

/** يكتب نسخة المحاولة القادمة (copy-on-write) — لا يمس النسخ المُرسلة السابقة. */
export async function writeSection(appId: string, section: DataSection, attempt: number, data: Record<string, unknown>, userId: string): Promise<void> {
  const now = nowIso();
  await getDb().prepare(`INSERT INTO shams_application_data (id, applicationId, section, attempt, data, updatedBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(applicationId, section, attempt) DO UPDATE SET data = excluded.data, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`)
    .run(newId('dat'), appId, section, attempt, JSON.stringify(data), userId, now, now);
}

export async function sectionHistory(appId: string, section: DataSection): Promise<Array<{ attempt: number; data: Record<string, unknown>; updatedAt: string }>> {
  return (await getDb().prepare('SELECT attempt, data, updatedAt FROM shams_application_data WHERE applicationId = ? AND section = ? ORDER BY attempt').all(appId, section) as Array<{ attempt: number; data: string; updatedAt: string }>)
    .map((r) => ({ attempt: r.attempt, data: parseJson(r.data, {}), updatedAt: r.updatedAt }));
}

// ── الانتقالات والنواقص ─────────────────────────────────────────────────────

export interface TransitionRow {
  id: string; applicationId: string; fromState: ApplicationState; toState: ApplicationState; action: ActionName | 'provider_suspended_return';
  actorUserId: string | null; actorRole: string; actorOrgId: string | null; actorName: string; reason: string; attempt: number;
  payload: Record<string, unknown>; createdAt: string;
}

export async function insertTransition(t: Omit<TransitionRow, 'id' | 'createdAt'>): Promise<TransitionRow> {
  const id = newId('trn');
  const createdAt = nowIso();
  await getDb().prepare(`INSERT INTO shams_application_transitions (id, applicationId, fromState, toState, action, actorUserId, actorRole, actorOrgId,
      actorName, reason, attempt, payload, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, t.applicationId, t.fromState, t.toState, t.action, t.actorUserId, t.actorRole, t.actorOrgId, t.actorName, t.reason, t.attempt,
    JSON.stringify(t.payload ?? {}), createdAt,
  );
  return { ...t, id, createdAt };
}

export async function listTransitions(appId: string): Promise<TransitionRow[]> {
  return (await getDb().prepare('SELECT * FROM shams_application_transitions WHERE applicationId = ? ORDER BY createdAt, rowid').all(appId) as Array<Record<string, unknown>>)
    .map((r) => ({ ...(r as unknown as TransitionRow), payload: parseJson(r.payload, {}) }));
}

export async function hasEnteredState(appId: string, state: ApplicationState): Promise<boolean> {
  // PR-P2: `+toState` keeps SQLite on idx_transitions_app (this application's few rows) instead of idx_transitions_to
  // (every application's rows in that state), which it chooses without ANALYZE statistics. Same result.
  return Boolean(await getDb().prepare('SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND +toState = ? AND fromState <> toState LIMIT 1').get(appId, state));
}

export interface DeficiencyRow {
  id: string; applicationId: string; transitionId: string; stage: ApplicationState; field: string; note: string;
  resolvedAtTransitionId: string | null; createdAt: string;
}

export async function insertDeficiency(appId: string, transitionId: string, stage: ApplicationState, field: string, note: string): Promise<void> {
  await getDb().prepare('INSERT INTO shams_deficiencies (id, applicationId, transitionId, stage, field, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('def'), appId, transitionId, stage, field, note, nowIso());
}

export async function openDeficiencies(appId: string): Promise<DeficiencyRow[]> {
  return await getDb().prepare('SELECT * FROM shams_deficiencies WHERE applicationId = ? AND resolvedAtTransitionId IS NULL ORDER BY createdAt').all(appId) as unknown as DeficiencyRow[];
}

export async function listDeficiencies(appId: string): Promise<DeficiencyRow[]> {
  return await getDb().prepare('SELECT * FROM shams_deficiencies WHERE applicationId = ? ORDER BY createdAt').all(appId) as unknown as DeficiencyRow[];
}

export async function resolveDeficiencies(appId: string, transitionId: string): Promise<void> {
  await getDb().prepare('UPDATE shams_deficiencies SET resolvedAtTransitionId = ? WHERE applicationId = ? AND resolvedAtTransitionId IS NULL').run(transitionId, appId);
}

/** رقم الطلب SHAMS-<السنة>-<تسلسل> — داخل معاملة الإرسال. */
export async function nextApplicationNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const db = getDb();
  await db.prepare('INSERT INTO shams_application_counters (year, lastSeq) VALUES (?, 0) ON CONFLICT(year) DO NOTHING').run(year);
  await db.prepare('UPDATE shams_application_counters SET lastSeq = lastSeq + 1 WHERE year = ?').run(year);
  const { lastSeq } = await db.prepare('SELECT lastSeq FROM shams_application_counters WHERE year = ?').get(year) as { lastSeq: number };
  return `SHAMS-${year}-${String(lastSeq).padStart(5, '0')}`;
}

// ── التحقق من السجل ─────────────────────────────────────────────────────────

export interface RegistryVerificationRow {
  id: string; applicationId: string; registryNumber: string; result: 'valid' | 'invalid' | 'unavailable';
  facilityData: Record<string, unknown> | null; adapter: string; errorCode: string | null; checkedAt: string;
  /** H3 (القرار 5): نتيجة مطابقة المالك/المفوض — not_available حتى يوفرها API السجل. لا منع آلي. */
  ownershipCheck?: OwnershipCheck | null;
}

export interface OwnershipCheck { status: 'not_available' | 'match' | 'mismatch' | 'inconclusive'; checkedFields?: string[]; note?: string }

export async function insertRegistryVerification(v: Omit<RegistryVerificationRow, 'id' | 'checkedAt'>, checkedBy: string): Promise<RegistryVerificationRow> {
  const id = newId('reg');
  const checkedAt = nowIso();
  await getDb().prepare(`INSERT INTO shams_registry_verifications (id, applicationId, registryNumber, result, facilityData, adapter, errorCode, checkedBy, checkedAt, ownershipCheck)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, v.applicationId, v.registryNumber, v.result, v.facilityData ? JSON.stringify(v.facilityData) : null,
    v.adapter, v.errorCode, checkedBy, checkedAt, v.ownershipCheck ? JSON.stringify(v.ownershipCheck) : null);
  return { ...v, id, checkedAt };
}

export async function getRegistryVerification(id: string | null): Promise<RegistryVerificationRow | null> {
  if (!id) return null;
  const r = await getDb().prepare('SELECT * FROM shams_registry_verifications WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? { ...(r as unknown as RegistryVerificationRow), facilityData: parseJson(r.facilityData, null), ownershipCheck: parseJson(r.ownershipCheck, null) } : null;
}

export async function latestRegistryVerification(appId: string): Promise<RegistryVerificationRow | null> {
  const r = await getDb().prepare('SELECT * FROM shams_registry_verifications WHERE applicationId = ? ORDER BY checkedAt DESC, rowid DESC LIMIT 1').get(appId) as Record<string, unknown> | undefined;
  return r ? { ...(r as unknown as RegistryVerificationRow), facilityData: parseJson(r.facilityData, null), ownershipCheck: parseJson(r.ownershipCheck, null) } : null;
}

// ── الإحالة للبنك ───────────────────────────────────────────────────────────

export interface BankReferralRow {
  id: string; applicationId: string; bankOrgId: string; referredAt: string; referredBy: string | null;
  studyResult: 'approved' | 'declined' | null; studyDate: string | null; bankNotes: string; resultRecordedAt: string | null;
  contractStatus: 'contracted' | 'not_contracted' | null; contractDate: string | null; contractAmount: number | null; contractNotes: string;
  notContractedReason: string; outcomeRecordedAt: string | null;
}

export async function getBankReferral(appId: string): Promise<BankReferralRow | null> {
  return (await getDb().prepare('SELECT * FROM shams_bank_referrals WHERE applicationId = ?').get(appId) as unknown as BankReferralRow | undefined) ?? null;
}

/** PERF-3: getBankReferral for many applications in one round trip per 500 ids (one referral per application: ux_referrals_app). */
export async function getBankReferralsFor(appIds: string[]): Promise<Map<string, BankReferralRow>> {
  const out = new Map<string, BankReferralRow>();
  for (let i = 0; i < appIds.length; i += 500) {
    const chunk = appIds.slice(i, i + 500);
    const rows = await getDb().prepare(`SELECT * FROM shams_bank_referrals WHERE applicationId IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as unknown as BankReferralRow[];
    for (const r of rows) out.set(r.applicationId, r);
  }
  return out;
}

/** PERF-3: listTransitions for many applications (same rows, same order per application), grouped by application id. */
export async function listTransitionsFor(appIds: string[]): Promise<Map<string, TransitionRow[]>> {
  const out = new Map<string, TransitionRow[]>();
  for (const id of appIds) out.set(id, []);
  for (let i = 0; i < appIds.length; i += 500) {
    const chunk = appIds.slice(i, i + 500);
    const rows = await getDb().prepare(`SELECT * FROM shams_application_transitions WHERE applicationId IN (${chunk.map(() => '?').join(',')}) ORDER BY applicationId, createdAt, rowid`)
      .all(...chunk) as Array<Record<string, unknown>>;
    for (const r of rows) out.get(String(r.applicationId))!.push({ ...(r as unknown as TransitionRow), payload: parseJson(r.payload, {}) });
  }
  return out;
}

// ── التعاقد عن طريق شركة توزيع الكهرباء ─────────────────────────────────────

export interface DistributionContractRow {
  id: string; applicationId: string; selectedAt: string; selectedBy: string | null;
  submittedAt: string | null; submittedBy: string | null; submissionCount: number; approvalDocumentId: string | null;
  reviewStatus: 'pending' | 'approved' | 'rejected' | null; decidedBy: string | null; decidedAt: string | null; decisionNotes: string;
}

function mapDistribution(r: Record<string, unknown>): DistributionContractRow {
  return { ...(r as unknown as DistributionContractRow), submissionCount: Number(r.submissionCount ?? 0), decisionNotes: String(r.decisionNotes ?? '') };
}

export async function getDistributionContract(appId: string): Promise<DistributionContractRow | null> {
  const r = await getDb().prepare('SELECT * FROM shams_distribution_contracts WHERE applicationId = ?').get(appId) as Record<string, unknown> | undefined;
  return r ? mapDistribution(r) : null;
}

/** getDistributionContract لعدة طلبات (تقارير Excel) — استعلام لكل 500 معرّف. */
export async function getDistributionContractsFor(appIds: string[]): Promise<Map<string, DistributionContractRow>> {
  const out = new Map<string, DistributionContractRow>();
  for (let i = 0; i < appIds.length; i += 500) {
    const chunk = appIds.slice(i, i + 500);
    const rows = await getDb().prepare(`SELECT * FROM shams_distribution_contracts WHERE applicationId IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<Record<string, unknown>>;
    for (const r of rows) out.set(String(r.applicationId), mapDistribution(r));
  }
  return out;
}

export interface ReferralHistoryRow {
  id: string; applicationId: string; bankOrgId: string; referredAt: string; referredBy: string | null; endedAt: string; endedBy: string | null;
  endReason: string; transitionId: string;
}

/** الإحالات السابقة (قبل إعادة الإحالة لبنك آخر). */
export async function referralHistory(appId: string): Promise<ReferralHistoryRow[]> {
  return await getDb().prepare('SELECT * FROM shams_bank_referral_history WHERE applicationId = ? ORDER BY endedAt').all(appId) as unknown as ReferralHistoryRow[];
}

/** عدد الطلبات المفتوحة التي اختارت هذا البنك ولم تسجل نتيجة التعاقد بعد (G-01/G-02: الاختيار بعد قبول الكهرباء فقط). */
export async function openBankLoad(bankOrgId: string): Promise<{ referrals: number; pendingSelections: number }> {
  const referrals = (await getDb().prepare("SELECT COUNT(*) AS n FROM shams_applications WHERE bankOrgId = ? AND state = 'CONTRACT_OUTCOME'").get(bankOrgId) as { n: number }).n;
  return { referrals, pendingSelections: 0 };
}

/** H3: طلبات مُرسلة غير نهائية لجهة مصنع تحجز رقم سجل (للتنبيه عند إيقاف الجهة — لا تحرير تلقائي). */
export async function openRegistryHoldsOfFactoryOrg(organizationId: string): Promise<AppRow[]> {
  return (await getDb().prepare(`${SELECT} WHERE f.organizationId = ? AND a.industrialRegistryNumber IS NOT NULL
    AND a.state NOT IN ('DRAFT','REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')`).all(organizationId) as Array<Record<string, unknown>>).map(mapApp);
}
