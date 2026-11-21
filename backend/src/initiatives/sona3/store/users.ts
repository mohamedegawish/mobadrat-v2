import { getDb, nowIso } from '../db/sqlite.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';
import type { OrgType, Role } from '../domain.js';

export interface UserInternal {
  id: string; organizationId: string; role: Role; email: string; nameAr: string; nameEn: string; phone: string;
  passwordHash: string; isActive: boolean; mustChangePassword: boolean; emailVerifiedAt: string | null;
  failedLoginCount: number; lockedUntil: string | null; lastLoginAt: string | null; createdAt: string; updatedAt: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; organizationActive: boolean;
}

export interface PublicUser {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; role: Role; organizationId: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; isActive: boolean;
  mustChangePassword: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
}

const SELECT = `SELECT u.*, o.type AS organizationType, o.nameAr AS organizationNameAr, o.nameEn AS organizationNameEn,
  o.isActive AS organizationActive FROM users u JOIN organizations o ON o.id = u.organizationId`;

function map(r: Record<string, unknown>): UserInternal {
  return {
    id: String(r.id), organizationId: String(r.organizationId), role: r.role as Role, email: String(r.email),
    nameAr: String(r.nameAr), nameEn: String(r.nameEn ?? ''), phone: String(r.phone ?? ''), passwordHash: String(r.passwordHash),
    isActive: r.isActive === 1, mustChangePassword: r.mustChangePassword === 1,
    emailVerifiedAt: (r.emailVerifiedAt as string | null) ?? null, failedLoginCount: Number(r.failedLoginCount ?? 0),
    lockedUntil: (r.lockedUntil as string | null) ?? null, lastLoginAt: (r.lastLoginAt as string | null) ?? null,
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
    organizationType: r.organizationType as OrgType, organizationNameAr: String(r.organizationNameAr),
    organizationNameEn: String(r.organizationNameEn), organizationActive: r.organizationActive === 1,
  };
}

export function toPublicUser(u: UserInternal): PublicUser {
  return {
    id: u.id, email: u.email, nameAr: u.nameAr, nameEn: u.nameEn, phone: u.phone, role: u.role,
    organizationId: u.organizationId, organizationType: u.organizationType, organizationNameAr: u.organizationNameAr,
    organizationNameEn: u.organizationNameEn, isActive: u.isActive, mustChangePassword: u.mustChangePassword,
    emailVerified: Boolean(u.emailVerifiedAt), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
  };
}

export function getUserById(id: string): UserInternal | null {
  const r = getDb().prepare(`${SELECT} WHERE u.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function getUserByEmail(email: string): UserInternal | null {
  const r = getDb().prepare(`${SELECT} WHERE u.email = ? COLLATE NOCASE`).get(email.trim()) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export function getUserByTokenHash(column: 'emailVerifyTokenHash' | 'passwordResetTokenHash', hash: string): (UserInternal & { tokenExpiresAt: string | null }) | null {
  const exp = column === 'emailVerifyTokenHash' ? 'emailVerifyExpiresAt' : 'passwordResetExpiresAt';
  const r = getDb().prepare(`${SELECT} WHERE u.${column} = ?`).get(hash) as Record<string, unknown> | undefined;
  return r ? { ...map(r), tokenExpiresAt: (r[exp] as string | null) ?? null } : null;
}

export interface CreateUserInput {
  organizationId: string; role: Role; email: string; nameAr: string; nameEn?: string; phone?: string; passwordHash: string;
  mustChangePassword?: boolean; emailVerified?: boolean; createdBy?: string | null; id?: string;
}

export function createUser(input: CreateUserInput): UserInternal {
  const id = input.id ?? newId('usr');
  const now = nowIso();
  getDb().prepare(`INSERT INTO users (id, organizationId, role, email, nameAr, nameEn, phone, passwordHash, isActive,
      mustChangePassword, emailVerifiedAt, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).run(
    id, input.organizationId, input.role, input.email.trim(), input.nameAr, input.nameEn ?? '', input.phone ?? '', input.passwordHash,
    input.mustChangePassword ? 1 : 0, input.emailVerified ? now : null, input.createdBy ?? null, now, now,
  );
  return getUserById(id)!;
}

export function updateUserProfile(id: string, patch: { nameAr?: string; nameEn?: string; phone?: string; isActive?: boolean }): UserInternal | null {
  const cur = getUserById(id);
  if (!cur) return null;
  getDb().prepare('UPDATE users SET nameAr = ?, nameEn = ?, phone = ?, isActive = ?, updatedAt = ? WHERE id = ?').run(
    patch.nameAr ?? cur.nameAr, patch.nameEn ?? cur.nameEn, patch.phone ?? cur.phone, (patch.isActive ?? cur.isActive) ? 1 : 0, nowIso(), id,
  );
  return getUserById(id);
}

export function setPassword(id: string, passwordHash: string, mustChange: boolean): void {
  getDb().prepare(`UPDATE users SET passwordHash = ?, mustChangePassword = ?, passwordResetTokenHash = NULL,
    passwordResetExpiresAt = NULL, failedLoginCount = 0, lockedUntil = NULL, updatedAt = ? WHERE id = ?`).run(passwordHash, mustChange ? 1 : 0, nowIso(), id);
}

/** تغيير بريد الحساب (استرداد إداري) — يُلغى التفعيل حتى يُفتح رابط البريد الجديد، وتُمسح روابط الاستعادة. */
export function changeEmail(id: string, email: string): void {
  getDb().prepare(`UPDATE users SET email = ?, emailVerifiedAt = NULL, passwordResetTokenHash = NULL, passwordResetExpiresAt = NULL, updatedAt = ? WHERE id = ?`)
    .run(email, nowIso(), id);
}

export function setVerifyToken(id: string, hash: string, expiresAt: string): void {
  getDb().prepare('UPDATE users SET emailVerifyTokenHash = ?, emailVerifyExpiresAt = ?, updatedAt = ? WHERE id = ?').run(hash, expiresAt, nowIso(), id);
}

export function markEmailVerified(id: string): void {
  const now = nowIso();
  getDb().prepare('UPDATE users SET emailVerifiedAt = ?, emailVerifyTokenHash = NULL, emailVerifyExpiresAt = NULL, updatedAt = ? WHERE id = ?').run(now, now, id);
}

export function setResetToken(id: string, hash: string, expiresAt: string): void {
  getDb().prepare('UPDATE users SET passwordResetTokenHash = ?, passwordResetExpiresAt = ?, updatedAt = ? WHERE id = ?').run(hash, expiresAt, nowIso(), id);
}

/** قفل الحساب: 5 محاولات فاشلة → 15 دقيقة. العداد يبدأ من جديد بعد انتهاء القفل. */
export const LOCK_THRESHOLD = 5;
export const LOCK_MS = 15 * 60_000;

export function isLocked(u: UserInternal): boolean {
  return u.lockedUntil !== null && Date.parse(u.lockedUntil) > Date.now();
}

export function recordFailedLogin(u: UserInternal): { locked: boolean } {
  const lockExpired = u.lockedUntil !== null && Date.parse(u.lockedUntil) <= Date.now();
  const count = (lockExpired ? 0 : u.failedLoginCount) + 1;
  const locked = count >= LOCK_THRESHOLD;
  const lockedUntil = locked ? new Date(Date.now() + LOCK_MS).toISOString() : (lockExpired ? null : u.lockedUntil);
  getDb().prepare('UPDATE users SET failedLoginCount = ?, lockedUntil = ?, updatedAt = ? WHERE id = ?').run(locked ? 0 : count, lockedUntil, nowIso(), u.id);
  return { locked };
}

export function recordSuccessfulLogin(id: string): void {
  const now = nowIso();
  getDb().prepare('UPDATE users SET failedLoginCount = 0, lockedUntil = NULL, lastLoginAt = ?, updatedAt = ? WHERE id = ?').run(now, now, id);
}

export function listUsers(f: { q?: string; role?: Role; organizationId?: string; excludeApplicants?: boolean }, page: number, pageSize: number) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.role) { where.push('u.role = ?'); params.push(f.role); }
  if (f.organizationId) { where.push('u.organizationId = ?'); params.push(f.organizationId); }
  if (f.excludeApplicants) where.push("u.role <> 'applicant'");
  if (f.q) {
    where.push("(u.nameAr LIKE ? ESCAPE '\\' OR u.nameEn LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM users u ${w}`).get(...params) as { n: number }).n;
  const rows = (db.prepare(`${SELECT} ${w} ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>).map(map);
  return { total, rows };
}

/** المستخدمون النشطون لجهة (اختياريًا بدور معين) — مستلمو الإشعارات. */
export function activeUsersOf(organizationId: string, role?: Role): UserInternal[] {
  const params: SqlParam[] = [organizationId];
  let sql = `${SELECT} WHERE u.organizationId = ? AND u.isActive = 1`;
  if (role) { sql += ' AND u.role = ?'; params.push(role); }
  return (getDb().prepare(sql).all(...params) as Array<Record<string, unknown>>).map(map);
}
