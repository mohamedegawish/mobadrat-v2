/**
 * سيرفر اختبارات Playwright فقط: قاعدة مؤقتة جديدة + بذرة التطوير + يخدم frontend/dist على نفس الأصل.
 * البريد يُكتب في ملف (MAIL_DEV_DIR) حتى تقرأ الاختبارات رابط التفعيل دون إرجاعه في أي رد.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sona3-e2e-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = process.env.E2E_DB_PATH ?? path.join(dir, 'e2e.db');
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.SERVE_FRONTEND = '1';
process.env.FRONTEND_DIST = process.env.FRONTEND_DIST ?? path.resolve(process.cwd(), '..', 'frontend', 'dist');
process.env.RATE_LIMIT_SCALE = '1000';
process.env.NOTIFICATION_SWEEP_MS = '500';
const port = Number(process.env.E2E_PORT ?? 5199);
process.env.APP_URL = `http://127.0.0.1:${port}`;
process.env.CORS_ORIGIN = process.env.APP_URL;
const mailDir = process.env.E2E_MAIL_DIR ?? path.join(dir, 'mail');
fs.mkdirSync(mailDir, { recursive: true });

const { config } = await import('./config.js');
const { getDb } = await import('./db/sqlite.js');
const { seedDevData } = await import('./db/seed.js');
const { createApp } = await import('./app.js');
const { setMailSenderForTests } = await import('./mail/mailer.js');
const { startNotificationWorker } = await import('./jobs/notificationWorker.js');

getDb();
seedDevData();
let n = 0;
setMailSenderForTests(async (m) => {
  const file = path.join(mailDir, `${Date.now()}-${++n}-${m.to.join('_').replace(/[^\w.@-]/g, '_')}.html`);
  fs.writeFileSync(file, m.html, 'utf8');
  return 'sent';
});
startNotificationWorker();
createApp().listen(port, '127.0.0.1', () => {
  console.log(`[e2e] http://127.0.0.1:${port} (db=${config.dbPath}, mail=${mailDir})`);
});
