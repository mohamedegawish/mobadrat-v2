/**
 * npm run check:readiness — exits 1 when the platform or any initiative is not ready to operate (support channel, staff in
 * every reviewing organization, open cohort, providers…). Reads the configured database; a missing database is a failure.
 */
import { bootPlatform } from '../core/boot.js';
import { closeDb, getDb } from '../core/db/index.js';
import { isMailConfigured } from '../core/mail/mailer.js';
import { config } from '../config.js';
import { MODULES } from '../initiatives/registry.js';

let failed = false;
try {
  await bootPlatform();
} catch (e) {
  console.error(`check:readiness FAILED\n  ✖ قاعدة البيانات غير متاحة: ${(e as Error).message}`);
  process.exit(1);
}
const admins = Number((await getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE platformRole = 'super_admin' AND isActive = 1").get() as { n: number }).n);
const core = [
  { ok: Boolean(config.supportEmail && config.supportPhone), labelAr: 'قناة استفسار رسمية للمنصة (SUPPORT_EMAIL / SUPPORT_PHONE)' },
  { ok: isMailConfigured(), labelAr: 'إعداد البريد (SMTP / Gmail)' },
  { ok: admins > 0, labelAr: `مدير منصة نشط (${admins})` },
];
console.log('المنصة:');
for (const c of core) { console.log(`  ${c.ok ? '✔' : '✖'} ${c.labelAr}`); if (!c.ok) failed = true; }
for (const m of MODULES) {
  console.log(`${m.titleAr}:`);
  for (const c of (await m.readiness?.()) ?? []) {
    console.log(`  ${c.ok ? '✔' : '✖'} ${c.labelAr}${c.detail ? ` — ${c.detail}` : ''}`);
    if (!c.ok) failed = true;
  }
}
await closeDb();
if (failed) { console.error('check:readiness FAILED'); process.exit(1); }
console.log('check:readiness OK');
