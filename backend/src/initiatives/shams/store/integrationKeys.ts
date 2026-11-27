import { randomBytes } from 'node:crypto';
import { getDb, nowIso } from '../db/database.js';
import { newId, mapSeq } from '../http/helpers.js';
import { sha256 } from '../auth/jwt.js';

export const INTEGRATION_SCOPES = ['read', 'read_full', 'read_documents', 'manage_users', 'read_audit'] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];
/**
 * H1: نطاقات البيانات — تتجاوز «البيانات الوصفية فقط». معطلة ما دام config.integrationDataScopesEnabled = false
 * (يُرفض إنشاء المفتاح بها، ويُرفض كل طلب بها)، وعند تفعيلها يحتاج المفتاح موافقة PMU قبل أن يعمل.
 */
export const DATA_SCOPES: readonly IntegrationScope[] = ['read_full', 'read_documents', 'read_audit'];
export function isDataScope(s: IntegrationScope): boolean { return DATA_SCOPES.includes(s); }

export type KeyApprovalStatus = 'active' | 'pending_approval' | 'rejected';

export interface IntegrationKey {
  id: string; name: string; keyPrefix: string; scopes: IntegrationScope[]; rateLimitPerMinute: number; createdBy: string | null;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null; revokedBy: string | null; rotatedFromId: string | null;
  approvalStatus: KeyApprovalStatus; approvedBy: string | null; approvedAt: string | null;
}

async function scopesOf(id: string): Promise<IntegrationScope[]> {
  return (await getDb().prepare('SELECT scope FROM shams_integration_key_scopes WHERE keyId = ? ORDER BY scope').all(id) as Array<{ scope: IntegrationScope }>).map((r) => r.scope);
}

async function map(r: Record<string, unknown>): Promise<IntegrationKey> {
  return {
    id: String(r.id), name: String(r.name), keyPrefix: String(r.keyPrefix), scopes: await scopesOf(String(r.id)), rateLimitPerMinute: Number(r.rateLimitPerMinute),
    createdBy: (r.createdBy as string | null) ?? null, createdAt: String(r.createdAt), lastUsedAt: (r.lastUsedAt as string | null) ?? null,
    revokedAt: (r.revokedAt as string | null) ?? null, revokedBy: (r.revokedBy as string | null) ?? null, rotatedFromId: (r.rotatedFromId as string | null) ?? null,
    approvalStatus: (r.approvalStatus as KeyApprovalStatus) ?? 'active', approvedBy: (r.approvedBy as string | null) ?? null, approvedAt: (r.approvedAt as string | null) ?? null,
  };
}

export async function getIntegrationKey(id: string): Promise<IntegrationKey | null> {
  const r = await getDb().prepare('SELECT * FROM shams_integration_keys WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? await map(r) : null;
}

export async function listIntegrationKeys(f: { approvalStatus?: KeyApprovalStatus } = {}): Promise<IntegrationKey[]> {
  const rows = f.approvalStatus
    ? await getDb().prepare('SELECT * FROM shams_integration_keys WHERE approvalStatus = ? AND revokedAt IS NULL ORDER BY createdAt DESC').all(f.approvalStatus)
    : await getDb().prepare('SELECT * FROM shams_integration_keys ORDER BY createdAt DESC').all();
  return mapSeq(rows as Array<Record<string, unknown>>, (r) => map(r));
}

/** ينشئ مفتاحًا ويرجعه نصًا مرة واحدة فقط؛ القاعدة تحفظ sha256 والبادئة. */
export async function createIntegrationKey(input: {
  name: string; scopes: IntegrationScope[]; rateLimitPerMinute: number; createdBy: string | null; rotatedFromId?: string | null;
  approvalStatus?: KeyApprovalStatus; approvedBy?: string | null; approvedAt?: string | null;
}): Promise<{ key: IntegrationKey; plaintext: string }> {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const plaintext = `shk_${prefix}_${secret}`;
  const id = newId('ik');
  const db = getDb();
  await db.prepare(`INSERT INTO shams_integration_keys (id, name, keyPrefix, keyHash, rateLimitPerMinute, createdBy, createdAt, rotatedFromId, approvalStatus, approvedBy, approvedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name, prefix, sha256(plaintext), input.rateLimitPerMinute, input.createdBy, nowIso(), input.rotatedFromId ?? null,
      input.approvalStatus ?? 'active', input.approvedBy ?? null, input.approvedAt ?? null);
  const ins = db.prepare('INSERT INTO shams_integration_key_scopes (keyId, scope) VALUES (?, ?)');
  for (const s of new Set(input.scopes)) await ins.run(id, s);
  return { key: (await getIntegrationKey(id))!, plaintext };
}

export async function setKeyApproval(id: string, status: 'active' | 'rejected', userId: string): Promise<boolean> {
  return Number((await getDb().prepare("UPDATE shams_integration_keys SET approvalStatus = ?, approvedBy = ?, approvedAt = ? WHERE id = ? AND approvalStatus = 'pending_approval' AND revokedAt IS NULL")
    .run(status, userId, nowIso(), id)).changes) === 1;
}

export async function revokeIntegrationKey(id: string, userId: string | null): Promise<void> {
  await getDb().prepare('UPDATE shams_integration_keys SET revokedAt = ?, revokedBy = ? WHERE id = ? AND revokedAt IS NULL').run(nowIso(), userId, id);
}

/** يبحث بالمفتاح النصي (hash) — يرجع null للمفتاح غير الموجود أو الملغى أو غير المعتمد. */
export async function findActiveKey(plaintext: string): Promise<IntegrationKey | null> {
  if (!/^shk_[a-f0-9]{8}_[A-Za-z0-9_-]{20,64}$/.test(plaintext)) return null;
  const r = await getDb().prepare("SELECT * FROM shams_integration_keys WHERE keyHash = ? AND revokedAt IS NULL AND approvalStatus = 'active'").get(sha256(plaintext)) as Record<string, unknown> | undefined;
  return r ? await map(r) : null;
}

export async function touchKey(id: string): Promise<void> {
  await getDb().prepare('UPDATE shams_integration_keys SET lastUsedAt = ? WHERE id = ?').run(nowIso(), id);
}

/**
 * M4: فشل المصادقة يُعدّ في جدول عادي لكل (IP، نافذة 10 دقائق)؛ يرجع true لأول فشل في النافذة فقط
 * (فيُكتب سطر تدقيق واحد لكل IP ونافذة بدل سطر لكل طلب — سجل التدقيق append-only).
 */
export const AUTH_FAILURE_WINDOW_MS = 10 * 60_000;
export async function countAuthFailure(ip: string, now = Date.now()): Promise<{ first: boolean; count: number; windowStart: string }> {
  const windowStart = new Date(Math.floor(now / AUTH_FAILURE_WINDOW_MS) * AUTH_FAILURE_WINDOW_MS).toISOString();
  const db = getDb();
  await db.prepare(`INSERT INTO shams_integration_auth_failures (ip, windowStart, count) VALUES (?, ?, 1)
    ON CONFLICT(ip, windowStart) DO UPDATE SET count = count + 1`).run(ip, windowStart);
  const { count } = await db.prepare('SELECT count FROM shams_integration_auth_failures WHERE ip = ? AND windowStart = ?').get(ip, windowStart) as { count: number };
  if (count === 1) await db.prepare('DELETE FROM shams_integration_auth_failures WHERE windowStart < ?').run(new Date(now - 24 * 3600_000).toISOString());
  return { first: count === 1, count, windowStart };
}

export async function listAuthFailures(limit = 100): Promise<Array<{ ip: string; windowStart: string; count: number }>> {
  return await getDb().prepare('SELECT ip, windowStart, count FROM shams_integration_auth_failures ORDER BY windowStart DESC LIMIT ?').all(limit) as never;
}
