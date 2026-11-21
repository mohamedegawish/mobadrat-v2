import { config, assertProductionSafe } from './config.js';
import { createApp } from './app.js';
import { closeDb, getDb } from './db/sqlite.js';
import { seedIfEmpty } from './db/seed.js';
import { startNotificationWorker, stopNotificationWorker } from './jobs/notificationWorker.js';
import { startWebhookWorker, stopWebhookWorker } from './jobs/webhookWorker.js';
import { startSlaMonitor, stopSlaMonitor } from './jobs/slaMonitor.js';

assertProductionSafe();
getDb(); // يطبق migrations المرقمة قبل استقبال أي طلب
if (config.seedOnBoot) {
  const seeded = seedIfEmpty();
  if (seeded) console.log('[seed] demo data loaded (first boot, empty database)');
  else console.log('[seed] skipped — database already has users');
  if (config.isProd) console.warn('[seed] WARNING: demo accounts use SEED_PASSWORD — change them before real use.');
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[sona3] listening on :${config.port} (${config.env})`);
});

if (config.jobsEnabled) {
  startNotificationWorker();
  startWebhookWorker();
  startSlaMonitor();
}

function shutdown(signal: string) {
  console.log(`[sona3] ${signal} — shutting down`);
  stopNotificationWorker();
  stopWebhookWorker();
  stopSlaMonitor();
  server.close(() => { closeDb(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
