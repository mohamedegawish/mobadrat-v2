import { getDb, nowIso } from '../db/sqlite.js';
import { newId, likePattern, type SqlParam } from '../http/helpers.js';
import type { OrgType, Role } from '../domain.js';
import type { FactoryAccountStatus } from './factories.js';

export interface UserInternal {
  id: string; organizationId: string; role: Role; email: string; nameAr: string; nameEn: string; phone: string;
  passwordHash: string; isActive: boolean; mustChangePassword: boolean; emailVerifiedAt: string | null;
  failedLoginCount: number; lastLoginAt: string | null; createdAt: string; updatedAt: string;
  /** M1: يزيد عند الاستعادة/التغيير/إعادة التعيين/الاسترداد — كل access token أقدم يُرفض. */
  tokenVersion: number;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; organizationActive: boolean;
  /** حالة قبول حساب المصنع (factories.accountStatus) — null لغير المصانع. */
  factoryAccountStatus: FactoryAccountStatus | null;
}

export interface PublicUser {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; role: Role; organizationId: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; isActive: boolean;
  mustChangePassword: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
  /** H2: false = لم يُعيِّن صاحب الحساب كلمة مروره بعد (رابط التعيين على بريده). */
  passwordSet: boolean;
  /** حساب المصنع: approved = دخول كامل؛ pending/correction = دخول مقيّد بتعديل الطلب؛ null لغير المصانع. */
  accountStatus: FactoryAccountStatus | null;
}

const SELECT = `SELECT u.*, o.type AS organizationType, o.nameAr AS organizationNameAr, o.nameEn AS organizationNameEn,
  o.isActive AS organizationActive,
  (SELECT f.accountStatus FROM factories f WHERE f.organizationId = u.organizationId) AS factoryAccountStatus
  FROM users u JOIN organizations o ON o.id = u.organizationId`;

function map(r: Record<string, unknown>): UserInternal {
  return {
    id: String(r.id), organizationId: String(r.organizationId), role: r.role as Role, email: String(r.email),
    nameAr: String(r.nameAr), nameEn: String(r.nameEn ?? ''), phone: String(r.phone ?? ''), passwordHash: String(r.passwordHash),
    isActive: r.isActive === 1, mustChangePassword: r.mustChangePassword === 1,
    emailVerifiedAt: (r.emailVerifiedAt as string | null) ?? null, failedLoginCount: Number(r.failedLoginCount ?? 0),
    lastLoginAt: (r.lastLoginAt as string | null) ?? null, tokenVersion: Number(r.tokenVersion ?? 0),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
    organizationType: r.organizationType as OrgType, organizationNameAr: String(r.organizationNameAr),
    organizationNameEn: String(r.organizationNameEn), organizationActive: r.organizationActive === 1,
    factoryAccountStatus: (r.factoryAccountStatus as FactoryAccountStatus | null) ?? null,
  };
}

export function toPublicUser(u: UserInternal): PublicUser {
  return {
    id: u.id, email: u.email, nameAr: u.nameAr, nameEn: u.nameEn, phone: u.phone, role: u.role,
    organizationId: u.organizationId, organizationType: u.organizationType, organizationNameAr: u.organizationNameAr,
    organizationNameEn: u.organizationNameEn, isActive: u.isActive, mustChangePassword: u.mustChangePassword,
    emailVerified: Boolean(u.emailVerifiedAt), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, passwordSet: Boolean(u.passwordHash),
    accountStatus: u.role === 'factory_owner' ? u.factoryAccountStatus ?? 'approved' : null,
  };
}

export async function getUserById(id: string): Promise<UserInternal | null> {
  const r = await getDb().prepare(`${SELECT} WHERE u.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export async function getUserByEmail(email: string): Promise<UserInternal | null> {
  const r = await getDb().prepare(`${SELECT} WHERE u.email = ? COLLATE NOCASE`).get(email.trim()) as Record<string, unknown> | undefined;
  return r ? map(r) : null;
}

export async function getUserByTokenHash(column: 'emailVerifyTokenHash' | 'passwordResetTokenHash', hash: string): Promise<(UserInternal & { tokenExpiresAt: string | null }) | null> {
  const exp = column === 'emailVerifyTokenHash' ? 'emailVerifyExpiresAt' : 'passwordResetExpiresAt';
  const r = await getDb().prepare(`${SELECT} WHERE u.${column} = ?`).get(hash) as Record<string, unknown> | undefined;
  return r ? { ...map(r), tokenExpiresAt: (r[exp] as string | null) ?? null } : null;
}

export interface CreateUserInput {
  organizationId: string; role: Role; email: string; nameAr: string; nameEn?: string; phone?: string; passwordHash: string;
  mustChangePassword?: boolean; emailVerified?: boolean; createdBy?: string | null; id?: string;
}

export async function createUser(input: CreateUserInput): Promise<UserInternal> {
  const id = input.id ?? newId('usr');
  const now = nowIso();
  await getDb().prepare(`INSERT INTO users (id, organizationId, role, email, nameAr, nameEn, phone, passwordHash, isActive,
      mustChangePassword, emailVerifiedAt, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).run(
    id, input.organizationId, input.role, input.email.trim(), input.nameAr, input.nameEn ?? '', input.phone ?? '', input.passwordHash,
    input.mustChangePassword ? 1 : 0, input.emailVerified ? now : null, input.createdBy ?? null, now, now,
  );
  return (await getUserById(id))!;
}

export async function updateUserProfile(id: string, patch: { nameAr?: string; nameEn?: string; phone?: string; isActive?: boolean }): Promise<UserInternal | null> {
  const cur = await getUserById(id);
  if (!cur) return null;
  await getDb().prepare('UPDATE users SET nameAr = ?, nameEn = ?, phone = ?, isActive = ?, updatedAt = ? WHERE id = ?').run(
    patch.nameAr ?? cur.nameAr, patch.nameEn ?? cur.nameEn, patch.phone ?? cur.phone, (patch.isActive ?? cur.isActive) ? 1 : 0, nowIso(), id,
  );
  return await getUserById(id);
}

export async function setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void> {
  await getDb().prepare(`UPDATE users SET passwordHash = ?, mustChangePassword = ?, passwordResetTokenHash = NULL,
    passwordResetExpiresAt = NULL, failedLoginCount = 0, lockedUntil = NULL, updatedAt = ? WHERE id = ?`).run(passwordHash, mustChange ? 1 : 0, nowIso(), id);
}

/** M1: يُبطل كل access token صادر للمستخدم حتى الآن (يُرفض في middleware/auth من الطلب التالي). */
export async function bumpTokenVersion(id: string): Promise<void> {
  await getDb().prepare('UPDATE users SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?').run(nowIso(), id);
}

/** H2: كلمة مرور غير قابلة للاستخدام حتى يعيّنها صاحب البريد بالرابط (لا كلمة مؤقتة يعرفها أحد). */
export async function clearPassword(id: string): Promise<void> {
  await getDb().prepare(`UPDATE users SET passwordHash = '', mustChangePassword = 0, failedLoginCount = 0, updatedAt = ? WHERE id = ?`).run(nowIso(), id);
}

/** تغيير بريد الحساب (استرداد إداري) — يُلغى التفعيل حتى يُفتح رابط البريد الجديد، وتُمسح روابط الاستعادة. */
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

/**
 * M3: لا قفل للحساب. failedLoginCount = محاولات فاشلة متتالية على الحساب من كل العناوين — يُستخدم لإبلاغ صاحبه فقط.
 * التأخير نفسه لكل (بريد، IP) في store/loginThrottle.ts.
 */
export async function recordFailedLogin(id: string): Promise<number> {
  await getDb().prepare('UPDATE users SET failedLoginCount = failedLoginCount + 1, updatedAt = ? WHERE id = ?').run(nowIso(), id);
  return (await getDb().prepare('SELECT failedLoginCount AS n FROM users WHERE id = ?').get(id) as { n: number } | undefined)?.n ?? 0;
}

export async function recordSuccessfulLogin(id: string): Promise<void> {
  const now = nowIso();
  await getDb().prepare('UPDATE users SET failedLoginCount = 0, lockedUntil = NULL, lastLoginAt = ?, updatedAt = ? WHERE id = ?').run(now, now, id);
}

export async function listUsers(f: { q?: string; role?: Role; organizationId?: string; excludeFactories?: boolean }, page: number, pageSize: number) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.role) { where.push('u.role = ?'); params.push(f.role); }
  if (f.organizationId) { where.push('u.organizationId = ?'); params.push(f.organizationId); }
  if (f.excludeFactories) where.push("u.role <> 'factory_owner'");
  if (f.q) {
    where.push("(u.nameAr LIKE ? ESCAPE '\\' OR u.nameEn LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM users u ${w}`).get(...params) as { n: number }).n;
  const rows = (await db.prepare(`${SELECT} ${w} ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>).map(map);
  return { total, rows };
}

/** المستخدمون النشطون لجهة (اختياريًا بدور معين) — مستلمو الإشعارات. */
export async function activeUsersOf(organizationId: string, role?: Role): Promise<UserInternal[]> {
  const params: SqlParam[] = [organizationId];
  let sql = `${SELECT} WHERE u.organizationId = ? AND u.isActive = 1`;
  if (role) { sql += ' AND u.role = ?'; params.push(role); }
  return (await getDb().prepare(sql).all(...params) as Array<Record<string, unknown>>).map(map);
}

/** أسماء المستخدمين (nameAr) لعدة معرّفات في استعلام واحد — لعرض «رفعه/قرره» في تفاصيل الطلب وسجلّه. */
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
