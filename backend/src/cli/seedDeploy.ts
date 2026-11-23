/**
 * npm run db:seed:deploy (dev) · node dist/cli/seedDeploy.js (production container) — the deploy seeder once, on demand:
 * one account for every role of the platform and of every initiative + the demo data they need, creating only what is
 * missing (core/seedDeploy.ts). The same thing SEED_ON_DEPLOY=1 does at every boot.
 * The accounts' password is the fixed seed password (config.ts DEFAULT_SEED_PASSWORD).
 */
import { assertConfigValid } from '../config.js';
import { bootPlatform } from '../core/boot.js';
import { closeDb } from '../core/db/index.js';
import { describeSeedReport, seedOnDeploy } from '../core/seedDeploy.js';

try {
  assertConfigValid();
  await bootPlatform();
  for (const line of describeSeedReport(await seedOnDeploy())) console.log(line);
  await closeDb();
} catch (e) {
  console.error(`[seed:deploy] FAILED — nothing was created: ${(e as Error).message}`);
  process.exit(1);
}
