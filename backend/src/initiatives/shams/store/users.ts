/**
 * Shams users = platform accounts (core `users`) + their Shams membership (role + Shams organization).
 * The exported functions keep the original application's signatures, so the workflow, visibility rules and services work
 * unchanged on the "actor" (UserInternal) built here.
 *
 *  - One account per person: an e-mail that already has a platform account gets a Shams membership instead of a new account.
 *  - isActive = account active AND membership active (suspending a Shams membership does not touch other initiatives).
 *  - A platform super_admin without a membership acts as the Shams system administrator.
 */
import { getDb, nowIso } from '../db/sqlite.js';
import { likePattern, type SqlParam } from '../http/helpers.js';
import { AppError } from '../http/errors.js';
import { ORG_IDS, type OrgType, type Role } from '../domain.js';
import type { FactoryAccountStatus } from './factories.js';
import * as coreUsers from '../../../core/store/users.js';
import { createMembership, getMembership, listMembershipsOfUser, setMembershipStatus } from '../../../core/store/memberships.js';
import { MODULE_ID } from '../config.js';

export interface UserInternal {
  id: string; organizationId: string; role: Role; email: string; nameAr: string; nameEn: string; phone: string;
  passwordHash: string; isActive: boolean; mustChangePassword: boolean; emailVerifiedAt: string | null;
  failedLoginCount: number; lastLoginAt: string | null; createdAt: string; updatedAt: string;
  tokenVersion: number;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; organizationActive: boolean;
  factoryAccountStatus: FactoryAccountStatus | null;
  /** Platform role of the account (null for ordinary users). */
  platformRole?: string | null;
  /** True when the actor is a platform super admin acting as the Shams administrator (no membership). */
  viaPlatformAdmin?: boolean;
}

export interface PublicUser {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; role: Role; organizationId: string;
  organizationType: OrgType; organizationNameAr: string; organizationNameEn: string; isActive: boolean;
  mustChangePassword: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
  passwordSet: boolean;
  accountStatus: FactoryAccountStatus | null;
}

const SELECT = `SELECT u.id, u.email, u.nameAr, u.nameEn, u.phone, u.passwordHash, u.isActive AS userActive, u.mustChangePassword,
  u.emailVerifiedAt, u.failedLoginCount, u.lastLoginAt, u.tokenVersion, u.platformRole, u.createdAt, u.updatedAt,
  m.role AS role, m.organizationId AS organizationId, m.status AS membershipStatus,
  o.type AS organizationType, o.nameAr AS organizationNameAr, o.nameEn AS organizationNameEn, o.isActive AS organizationActive,
  (SELECT f.accountStatus FROM shams_factories f WHERE f.organizationId = m.organizationId) AS factoryAccountStatus
  FROM users u JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'shams'
  JOIN shams_organizations o ON o.id = m.organizationId`;

function map(r: Record<string, unknown>): UserInternal {
  return {
    id: String(r.id), organizationId: String(r.organizationId), role: r.role as Role, email: String(r.email),
    nameAr: String(r.nameAr), nameEn: String(r.nameEn ?? ''), phone: String(r.phone ?? ''), passwordHash: String(r.passwordHash ?? ''),
    isActive: Number(r.userActive) === 1 && r.membershipStatus === 'active', mustChangePassword: Number(r.mustChangePassword) === 1,
    emailVerifiedAt: (r.emailVerifiedAt as string | null) ?? null, failedLoginCount: Number(r.failedLoginCount ?? 0),
    lastLoginAt: (r.lastLoginAt as string | null) ?? null, tokenVersion: Number(r.tokenVersion ?? 0),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
    organizationType: r.organizationType as OrgType, organizationNameAr: String(r.organizationNameAr),
    organizationNameEn: String(r.organizationNameEn), organizationActive: Number(r.organizationActive) === 1,
    factoryAccountStatus: (r.factoryAccountStatus as FactoryAccountStatus | null) ?? null,
    platformRole: (r.platformRole as string | null) ?? null,
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

/** The platform super admin as the Shams system administrator (organization org-admin). */
export async function platformAdminActor(core: coreUsers.CoreUser): Promise<UserInternal> {
  const o = await getDb().prepare('SELECT * FROM shams_organizations WHERE id = ?').get(ORG_IDS.admin);
  return {
    id: core.id, organizationId: ORG_IDS.admin, role: 'system_admin', email: core.email, nameAr: core.nameAr, nameEn: core.nameEn, phone: core.phone,
    passwordHash: core.passwordHash, isActive: core.isActive, mustChangePassword: core.mustChangePassword, emailVerifiedAt: core.emailVerifiedAt,
    failedLoginCount: core.failedLoginCount, lastLoginAt: core.lastLoginAt, createdAt: core.createdAt, updatedAt: core.updatedAt, tokenVersion: core.tokenVersion,
    organizationType: 'admin', organizationNameAr: String(o?.nameAr ?? 'إدارة النظام'), organizationNameEn: String(o?.nameEn ?? 'System Administration'),
    organizationActive: true, factoryAccountStatus: null, platformRole: core.platformRole, viaPlatformAdmin: true,
  };
}

export async function getUserById(id: string): Promise<UserInternal | null> {
  const r = await getDb().prepare(`${SELECT} WHERE u.id = ?`).get(id);
  if (r) return map(r);
  const core = await coreUsers.getUserById(id);
  return core && core.platformRole === 'super_admin' ? platformAdminActor(core) : null;
}

/** The Shams user with this e-mail (an account WITHOUT a Shams membership is not a Shams user). */
export async function getUserByEmail(email: string): Promise<UserInternal | null> {
  const r = await getDb().prepare(`${SELECT} WHERE u.email = ? COLLATE NOCASE`).get(email.trim());
  return r ? map(r) : null;
}

export interface CreateUserInput {
  organizationId: string; role: Role; email: string; nameAr: string; nameEn?: string; phone?: string; passwordHash: string;
  mustChangePassword?: boolean; emailVerified?: boolean; createdBy?: string | null; id?: string;
}

/**
 * Gives a person a Shams role: reuses the platform account of the e-mail when it exists (adds the membership), otherwise
 * creates the account. Fails when the account already has a Shams membership.
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

/** Name/phone are the person's platform account data; isActive is the Shams membership only. */
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

/**
 * Identity operations change the person's platform account (all initiatives). They are allowed from Shams only for accounts
 * that exist for Shams alone; others are handled by the platform administration.
 */
async function assertShamsOnlyAccount(id: string): Promise<void> {
  const core = await coreUsers.getUserById(id);
  const others = (await listMembershipsOfUser(id)).filter((m) => m.initiativeId !== MODULE_ID);
  if (core?.platformRole || others.length) {
    throw new AppError(409, 'MANAGED_BY_PLATFORM', 'هذا الحساب مستخدم في مبادرات أخرى على المنصة — تتولى إدارة المنصة تغيير بياناته الأساسية.',
      'This account is used by other initiatives on the platform — its identity data is managed by the platform administration.');
  }
}

export async function setPassword(id: string, passwordHash: string, mustChange: boolean): Promise<void> {
  await coreUsers.setPassword(id, passwordHash, mustChange);
}

export async function bumpTokenVersion(id: string): Promise<void> {
  await coreUsers.bumpTokenVersion(id);
}

export async function clearPassword(id: string): Promise<void> {
  await assertShamsOnlyAccount(id);
  await coreUsers.clearPassword(id);
}

export async function changeEmail(id: string, email: string): Promise<void> {
  await assertShamsOnlyAccount(id);
  await coreUsers.changeEmail(id, email);
}

export const setVerifyToken = coreUsers.setVerifyToken;
export const markEmailVerified = coreUsers.markEmailVerified;
export const setResetToken = coreUsers.setResetToken;
export const recordFailedLogin = coreUsers.recordFailedLogin;
export const recordSuccessfulLogin = coreUsers.recordSuccessfulLogin;
export const getUserNamesByIds = coreUsers.getUserNamesByIds;

export async function listUsers(f: { q?: string; role?: Role; organizationId?: string; excludeFactories?: boolean }, page: number, pageSize: number) {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (f.role) { where.push('m.role = ?'); params.push(f.role); }
  if (f.organizationId) { where.push('m.organizationId = ?'); params.push(f.organizationId); }
  if (f.excludeFactories) where.push("m.role <> 'factory_owner'");
  if (f.q) {
    where.push("(u.nameAr LIKE ? ESCAPE '\\' OR u.nameEn LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q); params.push(p, p, p);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = Number((await db.prepare(`SELECT COUNT(*) AS n FROM users u JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'shams' ${w}`).get(...params) as { n: number }).n);
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

/** Touches the account's updatedAt (kept for parity with the original store API). */
export async function touchUser(id: string): Promise<void> {
  await getDb().prepare('UPDATE users SET updatedAt = ? WHERE id = ?').run(nowIso(), id);
}
