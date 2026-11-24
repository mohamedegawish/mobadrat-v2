/** تعارضات رقم السجل الصناعي، وحظره على الرقم نفسه (H3)، واعتراضات المالك (القرار 4). */
import { getDb, nowIso } from '../db/database.js';
import { newId } from '../http/helpers.js';

export interface RegistryConflictRow {
  id: string; registryNumber: string; attemptedApplicationId: string; attemptedFactoryId: string; holdingApplicationId: string;
  attemptedBy: string | null; attempts: number; createdAt: string; lastAttemptAt: string;
}

/** يسجل محاولة إرسال برقم محجوز. يرجع true عند أول محاولة للزوج (طلب، طلب) — الإشعار يُرسل مرة واحدة. */
export async function recordConflict(c: { registryNumber: string; attemptedApplicationId: string; attemptedFactoryId: string; holdingApplicationId: string; attemptedBy: string }): Promise<{ id: string; first: boolean }> {
  const db = getDb();
  const now = nowIso();
  const existing = await db.prepare('SELECT id FROM shams_registry_conflicts WHERE attemptedApplicationId = ? AND holdingApplicationId = ?')
    .get(c.attemptedApplicationId, c.holdingApplicationId) as { id: string } | undefined;
  if (existing) {
    await db.prepare('UPDATE shams_registry_conflicts SET attempts = attempts + 1, lastAttemptAt = ? WHERE id = ?').run(now, existing.id);
    return { id: existing.id, first: false };
  }
  const id = newId('rcf');
  await db.prepare(`INSERT INTO shams_registry_conflicts (id, registryNumber, attemptedApplicationId, attemptedFactoryId, holdingApplicationId, attemptedBy, createdAt, lastAttemptAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, c.registryNumber, c.attemptedApplicationId, c.attemptedFactoryId, c.holdingApplicationId, c.attemptedBy, now, now);
  return { id, first: true };
}

/** التعارضات التي يكون الطلب طرفًا فيها (حاجزًا للرقم أو محاولًا). */
export async function conflictsForApplication(appId: string): Promise<RegistryConflictRow[]> {
  return await getDb().prepare('SELECT * FROM shams_registry_conflicts WHERE holdingApplicationId = ? OR attemptedApplicationId = ? ORDER BY createdAt')
    .all(appId, appId) as unknown as RegistryConflictRow[];
}

/** المصانع التي حاولت استخدام رقم يحجزه هذا الطلب (المرشحون لـ allowedFactoryId عند إغلاق النزاع). */
export async function conflictFactoriesForHolder(holdingAppId: string): Promise<string[]> {
  return (await getDb().prepare('SELECT DISTINCT attemptedFactoryId AS f FROM shams_registry_conflicts WHERE holdingApplicationId = ?').all(holdingAppId) as Array<{ f: string }>).map((r) => r.f);
}

// ── الحظر على الرقم (H3) ────────────────────────────────────────────────────

export type BlockSource = 'imc_reject' | 'pmu_dispute' | 'objection';

export interface RegistryBlockRow {
  id: string; registryNumber: string; factoryId: string | null; applicationId: string | null; transitionId: string | null; source: BlockSource;
  createdBy: string | null; createdAt: string; releasedAt: string | null; releasedBy: string | null; releaseReason: string; releaseReference: string;
  allowedFactoryId: string | null;
}

/**
 * يحظر الرقم على كل الحسابات (إن لم يكن محظورًا). released = يُسجَّل مرفوعًا مباشرة لمصنع محدد (قرار PMU عند إغلاق نزاع).
 */
export async function insertBlock(b: {
  registryNumber: string; factoryId: string | null; applicationId: string | null; transitionId: string | null; source: BlockSource; createdBy: string;
  release?: { allowedFactoryId: string; reason: string; reference: string };
}): Promise<string> {
  const id = newId('rbl');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO shams_registry_blocks (id, registryNumber, factoryId, applicationId, transitionId, source, createdBy, createdAt,
      releasedAt, releasedBy, releaseReason, releaseReference, allowedFactoryId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, b.registryNumber, b.factoryId, b.applicationId, b.transitionId, b.source, b.createdBy, now,
    b.release ? now : null, b.release ? b.createdBy : null, b.release?.reason ?? '', b.release?.reference ?? '', b.release?.allowedFactoryId ?? null,
  );
  return id;
}

export async function activeBlocks(registryNumber: string): Promise<RegistryBlockRow[]> {
  return await getDb().prepare('SELECT * FROM shams_registry_blocks WHERE registryNumber = ? AND releasedAt IS NULL ORDER BY createdAt').all(registryNumber) as unknown as RegistryBlockRow[];
}

/**
 * هل يُسمح لهذا المصنع باستخدام الرقم؟
 *  - أي حظر نشط على الرقم → ممنوع على الجميع (حتى قرار PMU).
 *  - وإلا: آخر رفع للحظر يحدد المصنع الوحيد المسموح له (allowedFactoryId) — غيره ممنوع.
 *  - لا حظر أبدًا → مسموح.
 */
export async function registryAccess(registryNumber: string, factoryId: string): Promise<{ allowed: true } | { allowed: false; reason: 'blocked' | 'reserved'; block: RegistryBlockRow }> {
  if (!registryNumber) return { allowed: true };
  const active = await activeBlocks(registryNumber);
  if (active.length) return { allowed: false, reason: 'blocked', block: active[0] };
  const last = await getDb().prepare('SELECT * FROM shams_registry_blocks WHERE registryNumber = ? AND releasedAt IS NOT NULL ORDER BY releasedAt DESC, rowid DESC LIMIT 1')
    .get(registryNumber) as unknown as RegistryBlockRow | undefined;
  if (last && last.allowedFactoryId !== factoryId) return { allowed: false, reason: 'reserved', block: last };
  return { allowed: true };
}

export async function getBlock(id: string): Promise<RegistryBlockRow | null> {
  return (await getDb().prepare('SELECT * FROM shams_registry_blocks WHERE id = ?').get(id) as unknown as RegistryBlockRow | undefined) ?? null;
}

export async function listBlocks(activeOnly: boolean): Promise<Array<RegistryBlockRow & { companyName: string | null; applicationNumber: string | null; allowedCompanyName: string | null }>> {
  return await getDb().prepare(`SELECT b.*, f.companyName AS companyName, a.number AS applicationNumber, af.companyName AS allowedCompanyName FROM shams_registry_blocks b
      LEFT JOIN shams_factories f ON f.id = b.factoryId LEFT JOIN shams_applications a ON a.id = b.applicationId LEFT JOIN shams_factories af ON af.id = b.allowedFactoryId
      ${activeOnly ? 'WHERE b.releasedAt IS NULL' : ''} ORDER BY b.createdAt DESC LIMIT 500`).all() as never;
}

/** يرفع كل الحظر النشط على الرقم لصالح مصنع واحد محدد. يرجع عدد الصفوف. */
export async function releaseNumber(registryNumber: string, userId: string, reason: string, reference: string, allowedFactoryId: string): Promise<number> {
  return Number((await getDb().prepare(`UPDATE shams_registry_blocks SET releasedAt = ?, releasedBy = ?, releaseReason = ?, releaseReference = ?, allowedFactoryId = ?
    WHERE registryNumber = ? AND releasedAt IS NULL`).run(nowIso(), userId, reason, reference, allowedFactoryId, registryNumber)).changes);
}

// ── اعتراضات المالك (القرار 4) ─────────────────────────────────────────────

export interface RegistryObjectionRow {
  id: string; registryNumber: string; factoryId: string; submittedBy: string; note: string; originalName: string; storedName: string;
  sizeBytes: number; sha256: string; status: 'pending' | 'accepted' | 'rejected'; decidedBy: string | null; decidedAt: string | null;
  decisionReason: string; decisionReference: string; createdAt: string;
}

export async function insertObjection(o: Pick<RegistryObjectionRow, 'registryNumber' | 'factoryId' | 'submittedBy' | 'note' | 'originalName' | 'storedName' | 'sizeBytes' | 'sha256'>): Promise<RegistryObjectionRow> {
  const id = newId('rob');
  await getDb().prepare(`INSERT INTO shams_registry_objections (id, registryNumber, factoryId, submittedBy, note, originalName, storedName, sizeBytes, sha256, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, o.registryNumber, o.factoryId, o.submittedBy, o.note, o.originalName, o.storedName, o.sizeBytes, o.sha256, nowIso());
  return (await getObjection(id))!;
}

export async function getObjection(id: string): Promise<RegistryObjectionRow | null> {
  return (await getDb().prepare('SELECT * FROM shams_registry_objections WHERE id = ?').get(id) as unknown as RegistryObjectionRow | undefined) ?? null;
}

export async function pendingObjection(factoryId: string, registryNumber: string): Promise<RegistryObjectionRow | null> {
  return (await getDb().prepare("SELECT * FROM shams_registry_objections WHERE factoryId = ? AND registryNumber = ? AND status = 'pending'").get(factoryId, registryNumber) as unknown as RegistryObjectionRow | undefined) ?? null;
}

export async function listObjections(f: { factoryId?: string } = {}): Promise<Array<RegistryObjectionRow & { companyName: string }>> {
  const where = f.factoryId ? 'WHERE o.factoryId = ?' : '';
  const params = f.factoryId ? [f.factoryId] : [];
  return await getDb().prepare(`SELECT o.*, fa.companyName AS companyName FROM shams_registry_objections o JOIN shams_factories fa ON fa.id = o.factoryId ${where}
    ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END, o.createdAt DESC LIMIT 500`).all(...params) as never;
}

export async function decideObjection(id: string, status: 'accepted' | 'rejected', userId: string, reason: string, reference: string): Promise<boolean> {
  return Number((await getDb().prepare(`UPDATE shams_registry_objections SET status = ?, decidedBy = ?, decidedAt = ?, decisionReason = ?, decisionReference = ?
    WHERE id = ? AND status = 'pending'`).run(status, userId, nowIso(), reason, reference, id)).changes) === 1;
}

/** D4: an objection by ANOTHER factory to this registry number is under PMU review (the holder's application is frozen). */
export async function pendingObjectionAgainst(registryNumber: string, holderFactoryId: string): Promise<boolean> {
  return Boolean(await getDb().prepare("SELECT 1 FROM shams_registry_objections WHERE registryNumber = ? AND status = 'pending' AND factoryId <> ? LIMIT 1")
    .get(registryNumber, holderFactoryId));
}
