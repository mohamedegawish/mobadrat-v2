/**
 * Core identity: one row per person (unique e-mail), shared by every initiative.
 * Initiative roles and organizations live in initiative_memberships (core/store/memberships.ts); each module builds its
 * own "actor" (the role/org-shaped user its code expects) from a user + its membership.
 */
import { getDb, nowIso } from '../db/index.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';

export type PlatformRole = 'super_admin' | 'ministry_viewer' | 'auditor' | 'catalog_manager';
export const PLATFORM_ROLES: PlatformRole[] = ['super_admin', 'ministry_viewer', 'auditor', 'catalog_manager'];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, { ar: string; en: string }> = {
  super_admin: { ar: 'مدير المنصة', en: 'Platform administrator' },
  ministry_viewer: { ar: 'متابع الوزارة (قراءة فقط)', en: 'Ministry viewer (read only)' },
  auditor: { ar: 'مدقق', en: 'Auditor' },
  catalog_manager: { ar: 'مدير محتوى المبادرات', en: 'Initiatives content manager' },
};

export interface CoreUser {
  id: string; email: string; nameAr: string; nameEn: string; phone: string;
  passwordHash: string; isActive: boolean; mustChangePassword: boolean; platformRole: PlatformRole | null;
  emailVerifiedAt: string | null; failedLoginCount: number; lastLoginAt: string | null; notificationsSeenAt: string | null;
  tokenVersion: number; createdAt: string; updatedAt: string;
}

export interface PublicCoreUser {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; platformRole: PlatformRole | null;
  isActive: boolean; mustChangePassword: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
  passwordSet: boolean;
}

export function mapCoreUser(r: Record<string, unknown>): CoreUser {
  return {
    id: String(r.id), email: String(r.email), nameAr: String(r.nameAr), nameEn: String(r.nameEn ?? ''), phone: String(r.phone ?? ''),
    passwordHash: String(r.passwordHash ?? ''), isActive: Number(r.isActive) === 1, mustChangePassword: Number(r.mustChangePassword) === 1,
    platformRole: (r.platformRole as PlatformRole | null) ?? null,
    emailVerifiedAt: (r.emailVerifiedAt as string | null) ?? null, failedLoginCount: Number(r.failedLoginCount ?? 0),
    lastLoginAt: (r.lastLoginAt as string | null) ?? null, notificationsSeenAt: (r.notificationsSeenAt as string | null) ?? null,
    tokenVersion: Number(r.tokenVersion ?? 0), createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  };
}

export function toPublicCoreUser(u: CoreUser): PublicCoreUser {
  return {
    id: u.id, email: u.email, nameAr: u.nameAr, nameEn: u.nameEn, phone: u.phone, platformRole: u.platformRole,
    isActive: u.isActive, mustChangePassword: u.mustChangePassword, emailVerified: Boolean(u.emailVerifiedAt),
    lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, passwordSet: Boolean(u.passwordHash),
  };
}

export async function getUserById(id: string): Promise<CoreUser | null> {
  const r = await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return r ? mapCoreUser(r) : null;
}

export async function getUserByEmail(email: string): Promise<CoreUser | null> {
  const r = await getDb().prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());
  return r ? mapCoreUser(r) : null;
}

export async function getUserByTokenHash(column: 'emailVerifyTokenHash' | 'passwordResetTokenHash', hash: string): Promise<(CoreUser & { tokenExpiresAt: string | null }) | null> {
  const exp = column === 'emailVerifyTokenHash' ? 'emailVerifyExpiresAt' : 'passwordResetExpiresAt';
  const r = await getDb().prepare(`SELECT * FROM users WHERE ${column} = ?`).get(hash);
  return r ? { ...mapCoreUser(r), tokenExpiresAt: (r[exp] as string | null) ?? null } : null;
}

export interface CreateCoreUserInput {
  email: string; nameAr: string; nameEn?: string; phone?: string; passwordHash: string;
  mustChangePassword?: boolean; emailVerified?: boolean; platformRole?: PlatformRole | null; createdBy?: string | null; id?: string;
}

export async function createCoreUser(input: CreateCoreUserInput): Promise<CoreUser> {
  const id = input.id ?? newId('usr');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO users (id, email, nameAr, nameEn, phone, passwordHash, isActive, mustChangePassword,
      platformRole, emailVerifiedAt, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`).run(
    id, input.email.trim(), input.nameAr, input.nameEn ?? '', input.phone ?? '', input.passwordHash,
    input.mustChangePassword ? 1 : 0, input.platformRole ?? null, input.emailVerified ? now : null, input.createdBy ?? null, now, now,
  );
  return (await getUserById(id))!;
}

export async function updateCoreUser(id: string, patch: { nameAr?: string; nameEn?: string; phone?: string; isActive?: boolean }): Promise<CoreUser | null> {
  const cur = await getUserById(id);
  if (!cur) return null;
  await getDb().prepare('UPDATE users SET nameAr = ?, nameEn = ?, phone = ?, isActive = ?, updatedAt = ? WHERE id = ?').run(
    patch.nameAr ?? cur.nameAr, patch.nameEn ?? cur.nameEn, patch.phone ?? cur.phone, (patch.isActive ?? cur.isActive) ? 1 : 0, nowIso(), id,
  );
  return await getUserById(id);
}

export async function setPlatformRole(id: string, role: PlatformRole | null): Promise<void> {
  await getDb().prepare('UPDATE users SET platformRole = ?, updatedAt = ? WHERE id = ?').run(role, nowIso(), id);
}

export async function setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void> {
  await getDb().prepare(`UPDATE users SET passwordHash = ?, mustChangePassword = ?, passwordResetTokenHash = NULL,
    passwordResetExpiresAt = NULL, failedLoginCount = 0, lockedUntil = NULL, updatedAt = ? WHERE id = ?`).run(passwordHash, mustChange ? 1 : 0, nowIso(), id);
}

/** Invalidates every access token issued to the user so far (rejected by the auth middleware from the next request). */
export async function bumpTokenVersion(id: string): Promise<void> {
  await getDb().prepare('UPDATE users SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?').run(nowIso(), id);
}

/** An unusable password until the owner of the e-mail sets one through the link (no temporary password anyone knows). */
export async function clearPassword(id: string): Promise<void> {
  await getDb().prepare(`UPDATE users SET passwordHash = '', mustChangePassword = 0, failedLoginCount = 0, updatedAt = ? WHERE id = ?`).run(nowIso(), id);
}

/** E-mail change (administrative recovery) — unverified until the new address's link is opened; reset links cleared. */
export async function changeEmail(id: string, email: string): Promise<void> {
  await getDb().prepare(`UPDATE users SET email = ?, emailVerifiedAt = NULL, passwordResetTokenHash = NULL, passwordResetExpiresAt = NULL, updatedAt = ? WHERE id = ?`)
    .run(email, nowIso(), id);
}

export async function setVerifyToken(id: string, hash: string, expiresAt: string): Promise<void> {
  await getDb().prepare('UPDATE users SET emailVerifyTokenHash = ?, emailVerifyExpiresAt = ?, updatedAt = ? WHERE id = ?').run(hash, expiresAt, nowIso(), id);
}

export async function markEmailVerified(id: string): Promise<void> {
  const now = nowIso();
  await getDb().prepare('UPDATE users SET emailVerifiedAt = ?, emailVerifyTokenHash = NULL, emailVerifyExpiresAt = NULL, updatedAt = ? WHERE id = ?').run(now, now, id);
}

export async function setResetToken(id: string, hash: string, expiresAt: string): Promise<void> {
  await getDb().prepare('UPDATE users SET passwordResetTokenHash = ?, passwordResetExpiresAt = ?, updatedAt = ? WHERE id = ?').run(hash, expiresAt, nowIso(), id);
}

/** Consecutive failed attempts on the account from all addresses — used to warn the owner only (no lockout). */
export async function recordFailedLogin(id: string): Promise<number> {
  await getDb().prepare('UPDATE users SET failedLoginCount = failedLoginCount + 1, updatedAt = ? WHERE id = ?').run(nowIso(), id);
  return (await getDb().prepare('SELECT failedLoginCount AS n FROM users WHERE id = ?').get(id) as { n: number } | undefined)?.n ?? 0;
}

export async function recordSuccessfulLogin(id: string): Promise<void> {
  const now = nowIso();
  await getDb().prepare('UPDATE users SET failedLoginCount = 0, lockedUntil = NULL, lastLoginAt = ?, updatedAt = ? WHERE id = ?').run(now, now, id);
}

export async function setNotificationsSeen(id: string): Promise<void> {
  const now = nowIso();
  await getDb().prepare('UPDATE users SET notificationsSeenAt = ?, updatedAt = ? WHERE id = ?').run(now, now, id);
}

export async function listCoreUsers(f: { q?: string; platformRole?: PlatformRole | 'any'; initiativeId?: string }, page: number, pageSize: number) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.platformRole === 'any') where.push('u.platformRole IS NOT NULL');
  else if (f.platformRole) { where.push('u.platformRole = ?'); params.push(f.platformRole); }
  if (f.initiativeId) { where.push('EXISTS (SELECT 1 FROM initiative_memberships m WHERE m.userId = u.id AND m.initiativeId = ?)'); params.push(f.initiativeId); }
  if (f.q) {
    where.push("(u.nameAr LIKE ? ESCAPE '\\' OR u.nameEn LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = Number((await db.prepare(`SELECT COUNT(*) AS n FROM users u ${w}`).get(...params) as { n: number }).n);
  const rows = (await db.prepare(`SELECT u.* FROM users u ${w} ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize)).map(mapCoreUser);
  return { total, rows };
}

/** Display names (nameAr) for several ids in one query. */
export async function getUserNamesByIds(ids: Set<string>): Promise<Map<string, string>> {
  const list = [...ids].filter(Boolean);
  const out = new Map<string, string>();
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const rows = await getDb().prepare(`SELECT id, nameAr FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<{ id: string; nameAr: string }>;
    for (const r of rows) out.set(r.id, r.nameAr);
  }
  return out;
}
