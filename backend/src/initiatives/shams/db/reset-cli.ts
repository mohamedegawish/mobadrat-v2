/** يحذف قاعدة التطوير وملفاتها ثم يعيد إنشاءها بالبذرة. ممنوع في الإنتاج. */
import fs from 'node:fs';
import { config } from '../config.js';
import { closeDb, initDb } from './sqlite.js';
import { seedDevData } from './seed.js';

if (config.isProd) {
  console.error('[reset] refused in production');
  process.exit(1);
}
if (config.dbClient !== 'sqlite') {
  // Never drop a MySQL database from a script: recreate it explicitly (DROP DATABASE / CREATE DATABASE) if that is intended.
  console.error('[reset] only resets the local SQLite development database (DB_CLIENT=sqlite)');
  process.exit(1);
}
await closeDb();
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${config.dbPath}${suffix}`, { force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });
await initDb();
await seedDevData();
await closeDb();
console.log('[reset] development database recreated and seeded');
