import { randomBytes } from 'node:crypto';
import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import { sha256 } from '../auth/jwt.js';

export const INTEGRATION_SCOPES = ['read', 'read_documents', 'manage_users', 'manage_experts', 'read_audit'] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export interface IntegrationKey {
  id: string; name: string; keyPrefix: string; scopes: IntegrationScope[]; rateLimitPerMinute: number; createdBy: string | null;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null; revokedBy: string | null; rotatedFromId: string | null;
}

function scopesOf(id: string): IntegrationScope[] {
  return (getDb().prepare('SELECT scope FROM integration_key_scopes WHERE keyId = ? ORDER BY scope').all(id) as Array<{ scope: IntegrationScope }>).map((r) => r.scope);
}

function map(r: Record<string, unknown>): IntegrationKey {
  return {
    id: String(r.id), name: String(r.name), keyPrefix: String(r.keyPrefix), scopes: scopesOf(String(r.id)), rateLimitPerMinute: Number(r.rateLimitPerMinute),
    createdBy: (r.createdBy as string | null) ?? null, createdAt: String(r.createdAt), lastUsedAt: (r.lastUsedAt as string | null) ?? null,
    revokedAt: (r.revokedAt as string | null) ?? null, revokedBy: (r.revokedBy as string | null) ?? null, rotatedFromId: (r.rotatedFromId as string | null) ?? null,
  };
}

export function getIntegrationKey(id: string): IntegrationKey | null {
  const r = getDb().prepare('SELECT * FROM integration_keys WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function listIntegrationKeys(): IntegrationKey[] {
  return (getDb().prepare('SELECT * FROM integration_keys ORDER BY createdAt DESC').all() as Array<Record<string, unknown>>).map(map);
}

/** ينشئ مفتاحًا ويرجعه نصًا مرة واحدة فقط؛ القاعدة تحفظ sha256 والبادئة. */
export function createIntegrationKey(input: { name: string; scopes: IntegrationScope[]; rateLimitPerMinute: number; createdBy: string | null; rotatedFromId?: string | null }): { key: IntegrationKey; plaintext: string } {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const plaintext = `shk_${prefix}_${secret}`;
  const id = newId('ik');
  const db = getDb();
  db.prepare('INSERT INTO integration_keys (id, name, keyPrefix, keyHash, rateLimitPerMinute, createdBy, createdAt, rotatedFromId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.name, prefix, sha256(plaintext), input.rateLimitPerMinute, input.createdBy, nowIso(), input.rotatedFromId ?? null);
  const ins = db.prepare('INSERT INTO integration_key_scopes (keyId, scope) VALUES (?, ?)');
  for (const s of new Set(input.scopes)) ins.run(id, s);
  return { key: getIntegrationKey(id)!, plaintext };
}

export function revokeIntegrationKey(id: string, userId: string | null): void {
  getDb().prepare('UPDATE integration_keys SET revokedAt = ?, revokedBy = ? WHERE id = ? AND revokedAt IS NULL').run(nowIso(), userId, id);
}

/** يبحث بالمفتاح النصي (hash) — يرجع null للمفتاح غير الموجود أو الملغى. */
export function findActiveKey(plaintext: string): IntegrationKey | null {
  if (!/^shk_[a-f0-9]{8}_[A-Za-z0-9_-]{20,64}$/.test(plaintext)) return null;
  const r = getDb().prepare('SELECT * FROM integration_keys WHERE keyHash = ? AND revokedAt IS NULL').get(sha256(plaintext)) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function touchKey(id: string): void {
  getDb().prepare('UPDATE integration_keys SET lastUsedAt = ? WHERE id = ?').run(nowIso(), id);
}
