import { config, assertConfigValid, assertProductionSafe, seedPasswordProblem } from './config.js';
import { createApp } from './app.js';
import { closeDb, dbDialect } from './core/db/index.js';
import { bootPlatform } from './core/boot.js';
import { seedIfEmpty } from './core/seed.js';
import { describeSeedReport, seedOnDeploy } from './core/seedDeploy.js';
import { sweepStaleTmp } from './core/http/upload.js';
import { startNotificationWorker, stopNotificationWorker } from './core/jobs/notificationWorker.js';
import { startOutboxRetention, stopOutboxRetention } from './core/jobs/outboxRetention.js';
import { drainJobs, runningJobs } from './core/jobs/inflight.js';
import { MODULES } from './initiatives/registry.js';

assertConfigValid();
assertProductionSafe();
// Applies the core and module migrations before serving any request (MySQL: waits for the server, migrates under a lock).
await bootPlatform();
if (config.seedOnBoot) {
  if (config.isProd && seedPasswordProblem()) throw new Error(`[seed] ${seedPasswordProblem()}`);
  const seeded = await seedIfEmpty();
  if (seeded) console.log('[seed] demo accounts and data loaded (empty database)');
}
if (config.seedOnDeploy) {
  // one account per role + demo data, creating only what is missing (core/seedDeploy.ts); never fatal for the server
  try {
    for (const line of describeSeedReport(await seedOnDeploy())) console.log(line);
  } catch (e) {
    console.error(`[seed:deploy] FAILED — nothing was created: ${(e as Error).message}`);
  }
}

const swept = sweepStaleTmp();
if (swept) console.log(`[uploads] removed ${swept} stale temporary upload file(s)`);
setInterval(() => { sweepStaleTmp(); }, 60 * 60_000).unref();

const app = createApp();
const onListening = () => {
  console.log(`[mobadrat] listening on ${config.host ?? '*'}:${config.port} (${config.env}, db=${dbDialect()}, modules=${MODULES.map((m) => m.id).join(',') || 'none'})`);
};
const server = config.host ? app.listen(config.port, config.host, onListening) : app.listen(config.port, onListening);

if (config.jobsEnabled) {
  startNotificationWorker();
  startOutboxRetention();
  for (const m of MODULES) await m.startJobs?.();
}

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[mobadrat] ${signal} — shutting down`);
  stopNotificationWorker();
  stopOutboxRetention();
  for (const m of MODULES) m.stopJobs?.();
  setTimeout(() => { console.error('[mobadrat] forced exit after 10s'); process.exit(1); }, 10_000).unref();
  server.close(() => {
    drainJobs(8_000)
      .then((drained) => { if (!drained) console.warn(`[mobadrat] ${runningJobs()} background job(s) still running at shutdown`); return closeDb(); })
      .then(() => process.exit(0), (e: unknown) => { console.error('[mobadrat] database close failed:', (e as Error).message); process.exit(1); });
  });
  server.closeIdleConnections?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
