/**
 * npm run check:readiness — يفشل (exit 1) إذا لم تكتمل شروط التشغيل (B2 + قناة الاستفسار I9).
 * يقرأ قاعدة البيانات في DB_PATH ولا ينشئ قاعدة جديدة: غيابها فشل.
 */
import fs from 'node:fs';
import { config } from '../config.js';

if (config.dbClient === 'sqlite' && !fs.existsSync(config.dbPath)) {
  console.error(`check:readiness FAILED\n  ✖ قاعدة البيانات غير موجودة: ${config.dbPath} (اضبط DB_PATH)`);
  process.exit(1);
}
const { readinessReport } = await import('../services/readiness.js');
const { closeDb } = await import('../db/sqlite.js');
const r = await readinessReport();
await closeDb();
for (const c of r.checks) {
  console.log(`  ${c.ok ? '✔' : '✖'} ${c.labelAr} — ${c.detailAr}`);
  for (const i of c.items ?? []) console.log(`      · ${i.labelAr}${i.extraAr ? ` (${i.extraAr})` : ''}`);
}
if (!r.ok) {
  console.error('check:readiness FAILED');
  process.exit(1);
}
console.log('check:readiness OK');
