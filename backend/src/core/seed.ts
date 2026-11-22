/**
 * Demo data (development / demo deployments only): platform accounts + each module's own demo data.
 * Runs only on an EMPTY users table. Production requires its own SEED_PASSWORD (config.seedPasswordProblem).
 */
import { getDb, tx } from './db/index.js';
import { hashPassword } from './auth/jwt.js';
import { createAccount } from './identity.js';
import { savePersonProfile } from './profile/store.js';
import { MODULES } from '../initiatives/registry.js';
import { seedDemoBodies } from './bodies/seed.js';
import { seedPassword } from '../config.js';

export const DEMO_PLATFORM_ACCOUNTS = [
  { email: 'admin@mobadrat.local', nameAr: 'مدير المنصة', nameEn: 'Platform admin', platformRole: 'super_admin' as const },
  { email: 'ministry@mobadrat.local', nameAr: 'متابع الوزارة', nameEn: 'Ministry viewer', platformRole: 'ministry_viewer' as const },
  { email: 'auditor@mobadrat.local', nameAr: 'المدقق', nameEn: 'Auditor', platformRole: 'auditor' as const },
  { email: 'content@mobadrat.local', nameAr: 'مدير المحتوى', nameEn: 'Content manager', platformRole: 'catalog_manager' as const },
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
  await seedDemoBodies();
}

/** Seeds only an empty database. Returns true when it seeded. */
export async function seedIfEmpty(): Promise<boolean> {
  if (!(await isEmptyDatabase())) return false;
  await seedDemo();
  return true;
}
