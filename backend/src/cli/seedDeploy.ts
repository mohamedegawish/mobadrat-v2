/**
 * npm run db:seed:deploy (dev) · node dist/cli/seedDeploy.js (production container) — the deploy seeder once, on demand:
 * one account for every role of the platform and of every initiative + the demo data they need, creating only what is
 * missing (core/seedDeploy.ts). The same thing SEED_ON_DEPLOY=1 does at every boot.
 * In production it uses SEED_PASSWORD, or the one the server generated in SECRETS_DIR. It never prints a password.
 */
import { assertConfigValid, config, seedPasswordProblem } from '../config.js';
import { bootPlatform } from '../core/boot.js';
import { closeDb } from '../core/db/index.js';
import { describeSeedReport, seedOnDeploy } from '../core/seedDeploy.js';
import { ensureGeneratedSecrets } from '../core/secrets.js';

try {
  ensureGeneratedSecrets(process.env, { seeding: true }); // the server's SEED_PASSWORD (SECRETS_DIR) when the environment has none
  assertConfigValid();
  if (config.isProd && seedPasswordProblem()) throw new Error(seedPasswordProblem()!);
  await bootPlatform();
  for (const line of describeSeedReport(await seedOnDeploy())) console.log(line);
  await closeDb();
} catch (e) {
  console.error(`[seed:deploy] FAILED — nothing was created: ${(e as Error).message}`);
  process.exit(1);
}
