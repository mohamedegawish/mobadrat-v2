/**
 * Account helpers of the deploy seeder (core/seedDeploy.ts), shared by the platform and every module's seedDeploy.
 * No dependency on the module registry (the modules import this file).
 */
import { config } from '../config.js';
import { createAccount } from './identity.js';
import { getUserByEmail, getUserById, type PlatformRole } from './store/users.js';
import { savePersonProfile } from './profile/store.js';
import type { DeploySeedAccount } from '../initiatives/contract.js';

/** The address of a seeded account: as listed, or moved to SEED_EMAIL_DOMAIN (local.<first label of the old domain>@domain). */
export function seedEmail(original: string, domain = config.seedEmailDomain): string {
  if (!domain) return original.toLowerCase();
  const [local, host] = original.toLowerCase().split('@');
  return `${local}.${host.split('.')[0]}@${domain.toLowerCase()}`;
}

export interface SeedAccountInput { id?: string; email: string; nameAr: string; nameEn: string; phone?: string; platformRole?: PlatformRole }
export interface EnsuredAccount { id: string; email: string; created: boolean; isActive: boolean }

/**
 * The seeded account of an e-mail: an existing account is returned as it is (never changed); otherwise a verified account
 * with the seed password, usable as it is (the documented demo password — no forced change, so every tester can sign in
 * with it). The listed id is used only when it is free (a legacy import may hold it).
 */
export async function ensureSeedAccount(a: SeedAccountInput, passwordHash: string, source: string): Promise<EnsuredAccount> {
  const email = seedEmail(a.email);
  const existing = await getUserByEmail(email);
  if (existing) return { id: existing.id, email, created: false, isActive: existing.isActive };
  const idFree = Boolean(a.id) && !(await getUserById(a.id!));
  const u = await createAccount({
    id: idFree ? a.id : undefined, email, nameAr: a.nameAr, nameEn: a.nameEn, phone: a.phone ?? '', passwordHash, source,
    emailVerified: true, mustChangePassword: false, platformRole: a.platformRole ?? null,
  });
  await savePersonProfile(u.id, { 'person.fullNameAr': a.nameAr, 'person.fullNameEn': a.nameEn, ...(a.phone ? { 'person.phone': a.phone } : {}) });
  return { id: u.id, email, created: true, isActive: true };
}

export const accountStatus = (u: EnsuredAccount): DeploySeedAccount['status'] => (u.created ? 'created' : u.isActive ? 'exists' : 'exists_disabled');
