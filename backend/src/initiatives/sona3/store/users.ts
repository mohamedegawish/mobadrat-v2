/**
 * Sona3 users = platform accounts (core `users`) + their Sona3 membership (role + Sona3 organization). The exported functions
 * keep the original application's names so the workflow, evaluation and visibility code works on the actor built here.
 *
 *  - One account per person: an e-mail that already has a platform account gets a Sona3 membership instead of a new account.
 *  - isActive = account active AND membership active.
 *  - A platform super_admin without a membership acts as the Sona3 system administrator.
 *  - Sign-in is the platform's: there is no Sona3-specific lockout any more (the platform uses a progressive delay).
 */
import { getDb } from '../db/sqlite.js';
import { likePattern, type SqlParam } from '../http/helpers.js';
import { AppError } from '../http/errors.js';
import { ORG_IDS, type OrgType, type Role } from '../domain.js';
import * as coreUsers from '../../../core/store/users.js';
import { createMembership, getMembership, listMembershipsOfUser, setMembershipStatus } from '../../../core/store/memberships.js';
import { MODULE_ID } from '../config.js';

export interface UserInternal {
  id: string; organizationId: string; role: Role; email: string; nameAr: string; nameEn: string; phone: string;
  passwordHash: string; isActive: boolean; mustChangePassword: boolean; emailVerifiedAt: string | null;
  failedLoginCount: number; lockedUntil: string | null; lastLoginAt: string | null; createdAt: string; updatedAt: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; organizationActive: boolean;
  platformRole?: string | null;
  viaPlatformAdmin?: boolean;
}

export interface PublicUser {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; role: Role; organizationId: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; isActive: boolean;
  mustChangePassword: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
}

const SELECT = `SELECT u.id, u.email, u.nameAr, u.nameEn, u.phone, u.passwordHash, u.isActive AS userActive, u.mustChangePassword,
  u.emailVerifiedAt, u.failedLoginCount, u.lockedUntil, u.lastLoginAt, u.platformRole, u.createdAt, u.updatedAt,
  m.role AS role, m.organizationId AS organizationId, m.status AS membershipStatus,
  o.type AS organizationType, o.nameAr AS organizationNameAr, o.nameEn AS organizationNameEn, o.isActive AS organizationActive
  FROM users u JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'sona3'
  JOIN sona3_organizations o ON o.id = m.organizationId`;

function map(r: Record<string, unknown>): UserInternal {
  return {
    id: String(r.id), organizationId: String(r.organizationId), role: r.role as Role, email: String(r.email),
    nameAr: String(r.nameAr), nameEn: String(r.nameEn ?? ''), phone: String(r.phone ?? ''), passwordHash: String(r.passwordHash ?? ''),
    isActive: Number(r.userActive) === 1 && r.membershipStatus === 'active', mustChangePassword: Number(r.mustChangePassword) === 1,
    emailVerifiedAt: (r.emailVerifiedAt as string | null) ?? null, failedLoginCount: Number(r.failedLoginCount ?? 0),
    lockedUntil: (r.lockedUntil as string | null) ?? null, lastLoginAt: (r.lastLoginAt as string | null) ?? null,
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
    organizationType: r.organizationType as OrgType, organizationNameAr: String(r.organizationNameAr),
    organizationNameEn: String(r.organizationNameEn), organizationActive: Number(r.organizationActive) === 1,
    platformRole: (r.platformRole as string | null) ?? null,
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

/** The platform super admin as the Sona3 system administrator (organization org-admin). */
export async function platformAdminActor(core: coreUsers.CoreUser): Promise<UserInternal> {
  const o = await getDb().prepare('SELECT * FROM sona3_organizations WHERE id = ?').get(ORG_IDS.admin);
  return {
    id: core.id, organizationId: ORG_IDS.admin, role: 'system_admin', email: core.email, nameAr: core.nameAr, nameEn: core.nameEn, phone: core.phone,
    passwordHash: core.passwordHash, isActive: core.isActive, mustChangePassword: core.mustChangePassword, emailVerifiedAt: core.emailVerifiedAt,
    failedLoginCount: core.failedLoginCount, lockedUntil: null, lastLoginAt: core.lastLoginAt, createdAt: core.createdAt, updatedAt: core.updatedAt,
    organizationType: 'admin', organizationNameAr: String(o?.nameAr ?? 'إدارة النظام'), organizationNameEn: String(o?.nameEn ?? 'System Administration'),
    organizationActive: true, platformRole: core.platformRole, viaPlatformAdmin: true,
  };
}

export async function getUserById(id: string): Promise<UserInternal | null> {
  const r = await getDb().prepare(`${SELECT} WHERE u.id = ?`).get(id);
  if (r) return map(r);
  const core = await coreUsers.getUserById(id);
  return core && core.platformRole === 'super_admin' ? await platformAdminActor(core) : null;
}

/** The Sona3 user with this e-mail (an account without a Sona3 membership is not a Sona3 user). */
export async function getUserByEmail(email: string): Promise<UserInternal | null> {
  const r = await getDb().prepare(`${SELECT} WHERE u.email = ? COLLATE NOCASE`).get(email.trim());
  return r ? map(r) : null;
}

export interface CreateUserInput {
  organizationId: string; role: Role; email: string; nameAr: string; nameEn?: string; phone?: string; passwordHash: string;
  mustChangePassword?: boolean; emailVerified?: boolean; createdBy?: string | null; id?: string;
}

/**
 * Gives a person a Sona3 role: reuses the platform account of the e-mail when it exists (adds the membership; the password
 * is NOT changed), otherwise creates the account. `existingAccount` tells the caller which happened.
 */
export async function createUser(input: CreateUserInput): Promise<UserInternal & { existingAccount: boolean }> {
  let core = await coreUsers.getUserByEmail(input.email);
  const existingAccount = Boolean(core);
  if (core && await getMembership(core.id, MODULE_ID)) {
    throw new AppError(409, 'EMAIL_TAKEN', 'لهذا البريد صلاحية في المبادرة بالفعل.', 'This email already has a role in this initiative.');
  }
  if (!core) {
    core = await coreUsers.createCoreUser({
      id: input.id, email: input.email.trim().toLowerCase(), nameAr: input.nameAr, nameEn: input.nameEn, phone: input.phone,
      passwordHash: input.passwordHash, mustChangePassword: input.mustChangePassword, emailVerified: input.emailVerified, createdBy: input.createdBy ?? null,
    });
  }
  await createMembership({ userId: core.id, initiativeId: MODULE_ID, role: input.role, organizationId: input.organizationId, createdBy: input.createdBy ?? null });
  return { ...(await getUserById(core.id))!, existingAccount };
}

export async function updateUserProfile(id: string, patch: { nameAr?: string; nameEn?: string; phone?: string; isActive?: boolean }): Promise<UserInternal | null> {
  const cur = await getUserById(id);
  if (!cur || cur.viaPlatformAdmin) return cur;
  await coreUsers.updateCoreUser(id, { nameAr: patch.nameAr, nameEn: patch.nameEn, phone: patch.phone });
  if (patch.isActive !== undefined) {
    const m = await getMembership(id, MODULE_ID);
    if (m) await setMembershipStatus(m.id, patch.isActive ? 'active' : 'suspended');
  }
  return await getUserById(id);
}

/** Identity operations change the person's platform account (every initiative): allowed only for Sona3-only accounts. */
export async function assertModuleOnlyAccount(id: string): Promise<void> {
  const core = await coreUsers.getUserById(id);
  const others = (await listMembershipsOfUser(id)).filter((m) => m.initiativeId !== MODULE_ID);
  if (core?.platformRole || others.length) {
    throw new AppError(409, 'MANAGED_BY_PLATFORM', 'هذا الحساب مستخدم في مبادرات أخرى على المنصة — تتولى إدارة المنصة تغيير بياناته الأساسية.',
      'This account is used by other initiatives on the platform — its identity data is managed by the platform administration.');
  }
}

export async function setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void> {
  await assertModuleOnlyAccount(id);
  await coreUsers.setPassword(id, passwordHash, mustChange);
}

export async function changeEmail(id: string, email: string): Promise<void> {
  await assertModuleOnlyAccount(id);
  await coreUsers.changeEmail(id, email);
}

export const setVerifyToken = coreUsers.setVerifyToken;
export const markEmailVerified = coreUsers.markEmailVerified;
export const setResetToken = coreUsers.setResetToken;
export const recordSuccessfulLogin = coreUsers.recordSuccessfulLogin;

export async function listUsers(f: { q?: string; role?: Role; organizationId?: string; excludeApplicants?: boolean }, page: number, pageSize: number) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.role) { where.push('m.role = ?'); params.push(f.role); }
  if (f.organizationId) { where.push('m.organizationId = ?'); params.push(f.organizationId); }
  if (f.excludeApplicants) where.push("m.role <> 'applicant'");
  if (f.q) {
    where.push("(u.nameAr LIKE ? ESCAPE '\\' OR u.nameEn LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = Number((await db.prepare(`SELECT COUNT(*) AS n FROM users u JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'sona3' ${w}`).get(...params) as { n: number }).n);
  const rows = (await db.prepare(`${SELECT} ${w} ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize)).map(map);
  return { total, rows };
}

/** Active users of an organization (optionally with a role) — notification recipients. */
export async function activeUsersOf(organizationId: string, role?: Role): Promise<UserInternal[]> {
  const params: SqlParam[] = [organizationId];
  let sql = `${SELECT} WHERE m.organizationId = ? AND u.isActive = 1 AND m.status = 'active'`;
  if (role) { sql += ' AND m.role = ?'; params.push(role); }
  return (await getDb().prepare(sql).all(...params)).map(map);
}

/** Active users with a role anywhere in Sona3 (e.g. evaluators). */
export async function activeUsersWithRole(role: Role): Promise<UserInternal[]> {
  return (await getDb().prepare(`${SELECT} WHERE m.role = ? AND u.isActive = 1 AND m.status = 'active'`).all(role)).map(map);
}
