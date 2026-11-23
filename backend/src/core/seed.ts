/**
 * Demo data (development / demo deployments only): platform accounts + each module's own demo data.
 * Runs only on an EMPTY users table. The accounts use the fixed seed password (config.ts DEFAULT_SEED_PASSWORD).
 */
import { getDb, tx } from './db/index.js';
import { hashPassword } from './auth/jwt.js';
import { createAccount } from './identity.js';
import { savePersonProfile } from './profile/store.js';
import { MODULES } from '../initiatives/registry.js';
import { seedDemoBodies } from './bodies/seed.js';
import { seedPassword } from '../config.js';
import type { UserType } from '../initiatives/contract.js';

export const DEMO_PLATFORM_ACCOUNTS = [
  { email: 'admin@mobadrat.local', nameAr: 'مدير المنصة', nameEn: 'Platform admin', platformRole: 'super_admin' as const },
  { email: 'ministry@mobadrat.local', nameAr: 'متابع الوزارة', nameEn: 'Ministry viewer', platformRole: 'ministry_viewer' as const },
  { email: 'auditor@mobadrat.local', nameAr: 'المدقق', nameEn: 'Auditor', platformRole: 'auditor' as const },
  { email: 'content@mobadrat.local', nameAr: 'مدير المحتوى', nameEn: 'Content manager', platformRole: 'catalog_manager' as const },
];

/**
 * Staff accounts that hold the same kind of role in every initiative (one platform dashboard for all of them, e.g. the
 * «IMC» dashboard). Each module gives the account its role of that type (InitiativeModule.seedSharedStaff).
 */
export const SHARED_DEMO_ACCOUNTS: Array<{ id: string; email: string; nameAr: string; nameEn: string; type: UserType }> = [
  { id: 'usr-imc-all', email: 'imc@mobadrat.local', nameAr: 'مسؤول IMC — كل المبادرات (تجريبي)', nameEn: 'IMC officer — every initiative (demo)', type: 'imc' },
];

export async function isEmptyDatabase(): Promise<boolean> {
  return Number((await getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n) === 0;
}

export async function seedDemo(password = seedPassword()): Promise<void> {
  const passwordHash = hashPassword(password);
  await tx(async () => {
    for (const a of DEMO_PLATFORM_ACCOUNTS) {
      const u = await createAccount({ ...a, passwordHash, emailVerified: true, source: 'platform' });
      await savePersonProfile(u.id, { 'person.fullNameAr': a.nameAr });
    }
  });
  for (const m of MODULES) await m.seedDemo?.(password);
  await tx(async () => {
    for (const a of SHARED_DEMO_ACCOUNTS) {
      const u = await createAccount({ id: a.id, email: a.email, nameAr: a.nameAr, nameEn: a.nameEn, passwordHash, emailVerified: true, source: 'platform' });
      await savePersonProfile(u.id, { 'person.fullNameAr': a.nameAr, 'person.fullNameEn': a.nameEn });
      for (const m of MODULES) await m.seedSharedStaff?.(u.id, a.type);
    }
  });
  await seedDemoBodies();
}

/** Seeds only an empty database. Returns true when it seeded. */
export async function seedIfEmpty(): Promise<boolean> {
  if (!(await isEmptyDatabase())) return false;
  await seedDemo();
  return true;
}
