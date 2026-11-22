/**
 * npm run db:seed — demo accounts and data of the platform and of every module, on an EMPTY database only (never on real
 * data). In production it needs its own SEED_PASSWORD.
 */
import { config, seedPasswordProblem } from '../config.js';
import { bootPlatform } from '../core/boot.js';
import { closeDb } from '../core/db/index.js';
import { seedIfEmpty } from '../core/seed.js';

try {
  if (config.isProd && seedPasswordProblem()) throw new Error(seedPasswordProblem()!);
  await bootPlatform();
  const seeded = await seedIfEmpty();
  console.log(seeded ? '[db:seed] demo accounts and data loaded' : '[db:seed] the database already has accounts — nothing seeded');
  await closeDb();
} catch (e) {
  console.error(`[db:seed] FAILED: ${(e as Error).message}`);
  process.exit(1);
}
