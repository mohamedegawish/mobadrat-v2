/**
 * npm run db:seed — demo accounts and data of the platform and of every module, on an EMPTY database only (never on real
 * data). The accounts use the fixed seed password (config.ts DEFAULT_SEED_PASSWORD).
 */
import { bootPlatform } from '../core/boot.js';
import { closeDb } from '../core/db/index.js';
import { seedIfEmpty } from '../core/seed.js';

try {
  await bootPlatform();
  const seeded = await seedIfEmpty();
  console.log(seeded ? '[db:seed] demo accounts and data loaded' : '[db:seed] the database already has accounts — nothing seeded');
  await closeDb();
} catch (e) {
  console.error(`[db:seed] FAILED: ${(e as Error).message}`);
  process.exit(1);
}
