import { config, assertConfigValid, assertProductionSafe } from './config.js';
import { createApp } from './app.js';
import { closeDb, dbDialect, initDb } from './db/sqlite.js';
import { seedIfEmpty } from './db/seed.js';
import { sweepStaleTmp } from './http/upload.js';
import { startNotificationWorker, stopNotificationWorker } from './jobs/notificationWorker.js';
import { startWebhookWorker, stopWebhookWorker } from './jobs/webhookWorker.js';
import { startSlaMonitor, stopSlaMonitor } from './jobs/slaMonitor.js';
import { startOutboxRetention, stopOutboxRetention } from './jobs/outboxRetention.js';
import { startRecoveryWorker, stopRecoveryWorker } from './services/accountRecovery.js';
import { drainJobs, runningJobs } from './jobs/inflight.js';

assertConfigValid();
assertProductionSafe();
// يطبق migrations المرقمة قبل استقبال أي طلب. MySQL: waits for the server (DB_CONNECT_TIMEOUT_MS) and migrates under a lock.
await initDb();
if (config.seedOnBoot) {
  const seeded = await seedIfEmpty();
  if (seeded) console.log('[seed] demo accounts and data loaded (empty database)');
}

// PR-F2: temp parts left by a crash during an upload.
const swept = sweepStaleTmp();
if (swept) console.log(`[uploads] removed ${swept} stale temporary upload file(s)`);
setInterval(() => { sweepStaleTmp(); }, 60 * 60_000).unref();

const app = createApp();
const onListening = () => {
  console.log(`[shams] listening on ${config.host ?? '*'}:${config.port} (${config.env}, db=${dbDialect()}, registry=${config.registryAdapter})`);
};
const server = config.host ? app.listen(config.port, config.host, onListening) : app.listen(config.port, onListening);

if (config.jobsEnabled) {
  startNotificationWorker();
  startWebhookWorker();
  startSlaMonitor();
  startOutboxRetention();
  await startRecoveryWorker();
}

/**
 * Graceful stop (SIGTERM from Docker/Coolify): stop the periodic jobs, stop accepting connections and let in-flight
 * requests finish, then close the database (MySQL pool / SQLite file). Hard stop after 10 s (compose gives 30 s).
 */
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[shams] ${signal} — shutting down`);
  stopNotificationWorker();
  stopWebhookWorker();
  stopSlaMonitor();
  stopOutboxRetention();
  stopRecoveryWorker();
  setTimeout(() => { console.error('[shams] forced exit after 10s'); process.exit(1); }, 10_000).unref();
  server.close(() => {
    // Let a running outbox send / sweep finish (bounded) before the pool closes, so nothing sent is left marked `sending`.
    drainJobs(8_000)
      .then((drained) => { if (!drained) console.warn(`[shams] ${runningJobs()} background job(s) still running at shutdown`); return closeDb(); })
      .then(() => process.exit(0), (e: unknown) => { console.error('[shams] database close failed:', (e as Error).message); process.exit(1); });
  });
  server.closeIdleConnections?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
