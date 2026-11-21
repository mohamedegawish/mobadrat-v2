/** يحذف قاعدة التطوير وملفاتها ثم يعيد إنشاءها بالبذرة. ممنوع في الإنتاج. */
import fs from 'node:fs';
import { config } from '../config.js';
import { closeDb, getDb } from './sqlite.js';
import { seedDevData } from './seed.js';

if (config.isProd) {
  console.error('[reset] refused in production');
  process.exit(1);
}
closeDb();
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${config.dbPath}${suffix}`, { force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });
getDb();
seedDevData();
closeDb();
console.log('[reset] development database recreated and seeded');
