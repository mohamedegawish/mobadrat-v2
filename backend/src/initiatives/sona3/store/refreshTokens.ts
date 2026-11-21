import { getDb, nowIso } from '../db/sqlite.js';
import { newId } from '../http/helpers.js';
import { sha256 } from '../auth/jwt.js';
import { config } from '../config.js';

export function storeRefreshToken(userId: string, token: string, familyId: string): string {
  const id = newId('rt');
  getDb().prepare('INSERT INTO refresh_tokens (id, userId, familyId, tokenHash, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, userId, familyId, sha256(token), new Date(Date.now() + config.jwtRefreshTtlSec * 1000).toISOString(), nowIso(),
  );
  return id;
}

export type RefreshCheck =
  | { ok: true; id: string; userId: string; familyId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

/** إعادة استخدام توكن ملغى = سرقة محتملة → تُلغى العائلة كلها. */
export function checkRefreshToken(token: string): RefreshCheck {
  const r = getDb().prepare('SELECT id, userId, familyId, expiresAt, revokedAt FROM refresh_tokens WHERE tokenHash = ?').get(sha256(token)) as
    { id: string; userId: string; familyId: string; expiresAt: string; revokedAt: string | null } | undefined;
  if (!r) return { ok: false, reason: 'unknown' };
  if (r.revokedAt) {
    revokeFamily(r.familyId);
    return { ok: false, reason: 'reused' };
  }
  if (Date.parse(r.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, id: r.id, userId: r.userId, familyId: r.familyId };
}

export function markRotated(oldId: string, replacedById: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revokedAt = ?, replacedById = ? WHERE id = ? AND revokedAt IS NULL').run(nowIso(), replacedById, oldId);
}

export function revokeRefreshToken(token: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revokedAt = ? WHERE tokenHash = ? AND revokedAt IS NULL').run(nowIso(), sha256(token));
}

export function revokeFamily(familyId: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revokedAt = ? WHERE familyId = ? AND revokedAt IS NULL').run(nowIso(), familyId);
}

export function revokeAllForUser(userId: string): void {
  getDb().prepare('UPDATE refresh_tokens SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL').run(nowIso(), userId);
}
