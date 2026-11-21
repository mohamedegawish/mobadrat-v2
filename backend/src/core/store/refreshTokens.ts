import { getDb, nowIso } from '../db/index.js';
import { newId } from '../http/helpers.js';
import { sha256 } from '../auth/jwt.js';
import { config } from '../../config.js';
import { bumpTokenVersion } from './users.js';

export async function storeRefreshToken(userId: string, token: string, familyId: string): Promise<string> {
  const id = newId('rt');
  await getDb().prepare('INSERT INTO refresh_tokens (id, userId, familyId, tokenHash, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, userId, familyId, sha256(token), new Date(Date.now() + config.jwtRefreshTtlSec * 1000).toISOString(), nowIso(),
  );
  return id;
}

export type RefreshCheck =
  | { ok: true; id: string; userId: string; familyId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

/** إعادة استخدام توكن ملغى = سرقة محتملة → تُلغى العائلة كلها. */
export async function checkRefreshToken(token: string): Promise<RefreshCheck> {
  const r = await getDb().prepare('SELECT id, userId, familyId, expiresAt, revokedAt FROM refresh_tokens WHERE tokenHash = ?').get(sha256(token)) as
    { id: string; userId: string; familyId: string; expiresAt: string; revokedAt: string | null } | undefined;
  if (!r) return { ok: false, reason: 'unknown' };
  if (r.revokedAt) {
    await revokeFamily(r.familyId);
    return { ok: false, reason: 'reused' };
  }
  if (Date.parse(r.expiresAt) <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, id: r.id, userId: r.userId, familyId: r.familyId };
}

export async function markRotated(oldId: string, replacedById: string): Promise<void> {
  await getDb().prepare('UPDATE refresh_tokens SET revokedAt = ?, replacedById = ? WHERE id = ? AND revokedAt IS NULL').run(nowIso(), replacedById, oldId);
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await getDb().prepare('UPDATE refresh_tokens SET revokedAt = ? WHERE tokenHash = ? AND revokedAt IS NULL').run(nowIso(), sha256(token));
}

export async function revokeFamily(familyId: string): Promise<void> {
  await getDb().prepare('UPDATE refresh_tokens SET revokedAt = ? WHERE familyId = ? AND revokedAt IS NULL').run(nowIso(), familyId);
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await getDb().prepare('UPDATE refresh_tokens SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL').run(nowIso(), userId);
}

/**
 * M1: إنهاء كل جلسات المستخدم فورًا — refresh tokens تُلغى، وكل access token صادر يُرفض من الطلب التالي (tokenVersion).
 * يُستدعى عند استعادة كلمة المرور وتغييرها، وإعادة التعيين الإدارية، وتنفيذ استرداد البريد، والإيقاف.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await revokeAllForUser(userId);
  await bumpTokenVersion(userId);
}
