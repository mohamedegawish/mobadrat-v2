/**
 * Identity services shared by the core and the initiative modules: creating the single platform account of a person,
 * e-mail verification, invitations (accounts created by an administrator), and administrative e-mail changes.
 */
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { sha256 } from './auth/jwt.js';
import { AppError } from './http/errors.js';
import { platformPolicy } from './policy.js';
import { addAuditLog } from './store/audit.js';
import { revokeAllSessions } from './store/refreshTokens.js';
import {
  changeEmail as changeEmailRow, clearPassword, createCoreUser, getUserByEmail, getUserById, setResetToken, setVerifyToken,
  type CoreUser, type PlatformRole,
} from './store/users.js';
import { dispatchCore } from './notify/dispatch.js';
import { kickNotificationWorker } from './jobs/notificationWorker.js';

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

export async function sendVerification(user: CoreUser): Promise<void> {
  const { token, hash } = newToken();
  await setVerifyToken(user.id, hash, new Date(Date.now() + platformPolicy.verifyTokenHours * 3600_000).toISOString());
  await dispatchCore('auth.verify_email', { name: user.nameAr, link: `${config.appUrl}/#verify-email/${token}` },
    [{ userId: user.id, email: user.email }], { dedupePrefix: `verify:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
}

export interface CreateAccountInput {
  email: string; nameAr: string; nameEn?: string; phone?: string; passwordHash: string; ip?: string;
  /** Where the account was created: 'platform' or a module id. */
  source: string;
  emailVerified?: boolean; mustChangePassword?: boolean; platformRole?: PlatformRole | null; createdBy?: string | null; id?: string;
}

/**
 * Another registration of the same e-mail committed first (a double click, two tabs, a retry): the registration routes answer
 * exactly as for an existing account — never a server error, never a hint.
 */
export function isAccountExistsRace(e: unknown): boolean {
  return e instanceof AppError && e.code === 'ACCOUNT_EXISTS';
}

/** Creates the person's single platform account (call inside a transaction). The e-mail must not exist yet. */
export async function createAccount(input: CreateAccountInput): Promise<CoreUser> {
  let u: CoreUser;
  try {
    u = await createCoreUser({
      id: input.id, email: input.email.toLowerCase(), nameAr: input.nameAr, nameEn: input.nameEn, phone: input.phone, passwordHash: input.passwordHash,
      emailVerified: input.emailVerified, mustChangePassword: input.mustChangePassword, platformRole: input.platformRole ?? null, createdBy: input.createdBy ?? null,
    });
  } catch (e) {
    const err = e as { errno?: number; message?: string };
    if (err?.errno === 1062 && String(err.message ?? '').includes('ux_users_email')) {
      throw new AppError(409, 'ACCOUNT_EXISTS', 'يوجد حساب بهذا البريد بالفعل.', 'An account with this e-mail already exists.');
    }
    throw e;
  }
  await addAuditLog({
    initiativeId: input.source === 'platform' ? null : input.source, actorType: input.createdBy ? 'user' : 'anonymous', actorUserId: input.createdBy ?? u.id,
    actorName: input.createdBy ? '' : u.nameAr, ip: input.ip ?? '', action: 'auth.account_created', entityType: 'user', entityId: u.id,
    summaryAr: `إنشاء حساب على المنصة (${input.source === 'platform' ? 'تسجيل عام' : `عبر مبادرة ${input.source}`})`,
  });
  return u;
}

/**
 * Registration with an e-mail that already has an account: same answer as a new registration (no enumeration). The owner
 * is told to sign in with the existing account and apply from the initiative page.
 */
export async function notifyExistingAccountOnRegister(existing: CoreUser, initiative: { id: string; titleAr: string } | null, ip: string): Promise<void> {
  if (existing.isActive) {
    await dispatchCore('auth.registration_attempt', { name: existing.nameAr, initiativeAr: initiative?.titleAr }, [{ userId: existing.id, email: existing.email }],
      { dedupePrefix: `reg-attempt:${existing.id}:${initiative?.id ?? 'platform'}:${new Date().toISOString().slice(0, 13)}`, channels: ['email'] });
    kickNotificationWorker();
  }
  await addAuditLog({
    initiativeId: initiative?.id ?? null, actorType: 'anonymous', ip, action: 'auth.register_existing_email', entityType: 'user', entityId: existing.id,
    summaryAr: 'محاولة تسجيل ببريد مسجل',
  });
}

/**
 * Staff/administrator-created accounts: returns the existing account for the e-mail, or creates one with no usable
 * password and e-mails a set-password link (no temporary password anyone knows). Call inside a transaction.
 */
export async function ensureInvitedUser(input: {
  email: string; nameAr: string; nameEn?: string; phone?: string; createdBy: string | null; source: string; initiativeAr?: string;
}): Promise<{ user: CoreUser; created: boolean }> {
  const existing = await getUserByEmail(input.email);
  if (existing) return { user: existing, created: false };
  const u = await createAccount({
    email: input.email, nameAr: input.nameAr, nameEn: input.nameEn, phone: input.phone, passwordHash: '', emailVerified: true,
    createdBy: input.createdBy, source: input.source,
  });
  await sendSetupLink(u, 'setup', input.initiativeAr);
  return { user: u, created: true };
}

/** One-time set-password link (72 h) — new accounts and administrative resets. */
export async function sendSetupLink(user: CoreUser, purpose: 'setup' | 'reset', initiativeAr?: string): Promise<void> {
  const { token, hash } = newToken();
  const hours = platformPolicy.setupTokenHours;
  if (purpose === 'reset') { await clearPassword(user.id); await revokeAllSessions(user.id); }
  await setResetToken(user.id, hash, new Date(Date.now() + hours * 3600_000).toISOString());
  await dispatchCore('auth.account_setup', { name: user.nameAr, purpose, hours, initiativeAr, link: `${config.appUrl}/#reset-password/${token}` },
    [{ userId: user.id, email: user.email }], { dedupePrefix: `setup:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
}

/** Administrative e-mail change (formal request): old address warned, new one must be verified, sessions ended. */
export async function changeAccountEmail(userId: string, newEmail: string, actor: { id: string | null; name: string; initiativeId?: string | null; ip?: string }): Promise<CoreUser> {
  const u = await getUserById(userId);
  if (!u) throw new Error('user not found');
  const oldEmail = u.email;
  await changeEmailRow(userId, newEmail.toLowerCase());
  await revokeAllSessions(userId);
  const fresh = (await getUserById(userId))!;
  await dispatchCore('auth.email_changed_old', { name: u.nameAr }, [{ userId: null, email: oldEmail }], { dedupePrefix: `email-old:${userId}:${Date.now()}`, channels: ['email'] });
  const { token, hash } = newToken();
  await setVerifyToken(userId, hash, new Date(Date.now() + platformPolicy.verifyTokenHours * 3600_000).toISOString());
  await dispatchCore('auth.email_changed_new', { name: u.nameAr, link: `${config.appUrl}/#verify-email/${token}` }, [{ userId, email: fresh.email }],
    { dedupePrefix: `email-new:${hash.slice(0, 16)}`, sensitive: true, channels: ['email'] });
  await addAuditLog({
    initiativeId: actor.initiativeId ?? null, actorType: actor.id ? 'user' : 'system', actorUserId: actor.id, actorName: actor.name, ip: actor.ip ?? '',
    action: 'user.email_changed', entityType: 'user', entityId: userId, summaryAr: 'تغيير بريد الحساب', details: { from: oldEmail, to: fresh.email },
  });
  return fresh;
}
