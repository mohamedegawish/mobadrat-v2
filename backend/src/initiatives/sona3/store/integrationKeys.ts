import { randomBytes } from 'node:crypto';
import { getDb, nowIso } from '../db/database.js';
import { newId, mapSeq } from '../http/helpers.js';
import { sha256 } from '../auth/jwt.js';

export const INTEGRATION_SCOPES = ['read', 'read_documents', 'manage_users', 'manage_experts', 'read_audit'] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export interface IntegrationKey {
  id: string; name: string; keyPrefix: string; scopes: IntegrationScope[]; rateLimitPerMinute: number; createdBy: string | null;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null; revokedBy: string | null; rotatedFromId: string | null;
}

async function scopesOf(id: string): Promise<IntegrationScope[]> {
  return (await getDb().prepare('SELECT scope FROM sona3_integration_key_scopes WHERE keyId = ? ORDER BY scope').all(id) as Array<{ scope: IntegrationScope }>).map((r) => r.scope);
}

async function map(r: Record<string, unknown>): Promise<IntegrationKey> {
  return {
    id: String(r.id), name: String(r.name), keyPrefix: String(r.keyPrefix), scopes: await scopesOf(String(r.id)), rateLimitPerMinute: Number(r.rateLimitPerMinute),
    createdBy: (r.createdBy as string | null) ?? null, createdAt: String(r.createdAt), lastUsedAt: (r.lastUsedAt as string | null) ?? null,
    revokedAt: (r.revokedAt as string | null) ?? null, revokedBy: (r.revokedBy as string | null) ?? null, rotatedFromId: (r.rotatedFromId as string | null) ?? null,
  };
}

export async function getIntegrationKey(id: string): Promise<IntegrationKey | null> {
  const r = await getDb().prepare('SELECT * FROM sona3_integration_keys WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? await map(r) : null;
}

export async function listIntegrationKeys(): Promise<IntegrationKey[]> {
  return mapSeq(await getDb().prepare('SELECT * FROM sona3_integration_keys ORDER BY createdAt DESC').all() as Array<Record<string, unknown>>, async (r) => await map(r));
}

/** ينشئ مفتاحًا ويرجعه نصًا مرة واحدة فقط؛ القاعدة تحفظ sha256 والبادئة. */
export async function createIntegrationKey(input: { name: string; scopes: IntegrationScope[]; rateLimitPerMinute: number; createdBy: string | null; rotatedFromId?: string | null }): Promise<{ key: IntegrationKey; plaintext: string }> {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const plaintext = `shk_${prefix}_${secret}`;
  const id = newId('ik');
  const db = getDb();
  await db.prepare('INSERT INTO sona3_integration_keys (id, name, keyPrefix, keyHash, rateLimitPerMinute, createdBy, createdAt, rotatedFromId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.name, prefix, sha256(plaintext), input.rateLimitPerMinute, input.createdBy, nowIso(), input.rotatedFromId ?? null);
  const ins = db.prepare('INSERT INTO sona3_integration_key_scopes (keyId, scope) VALUES (?, ?)');
  for (const s of new Set(input.scopes)) await ins.run(id, s);
  return { key: (await getIntegrationKey(id))!, plaintext };
}

export async function revokeIntegrationKey(id: string, userId: string | null): Promise<void> {
  await getDb().prepare('UPDATE sona3_integration_keys SET revokedAt = ?, revokedBy = ? WHERE id = ? AND revokedAt IS NULL').run(nowIso(), userId, id);
}

/** يبحث بالمفتاح النصي (hash) — يرجع null للمفتاح غير الموجود أو الملغى. */
export async function findActiveKey(plaintext: string): Promise<IntegrationKey | null> {
  if (!/^shk_[a-f0-9]{8}_[A-Za-z0-9_-]{20,64}$/.test(plaintext)) return null;
  const r = await getDb().prepare('SELECT * FROM sona3_integration_keys WHERE keyHash = ? AND revokedAt IS NULL').get(sha256(plaintext)) as Record<string, unknown> | undefined;
  return r ? await map(r) : null;
}

export async function touchKey(id: string): Promise<void> {
  await getDb().prepare('UPDATE sona3_integration_keys SET lastUsedAt = ? WHERE id = ?').run(nowIso(), id);
}
