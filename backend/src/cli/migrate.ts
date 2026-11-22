/**
 * npm run db:migrate — applies the core and every module migration (under a database lock), loads the reference data and
 * creates the catalog page of each registered initiative module. Idempotent; the server does the same at boot.
 */
import { bootPlatform } from '../core/boot.js';
import { closeDb, getDb } from '../core/db/index.js';

try {
  await bootPlatform();
  const rows = await getDb().prepare('SELECT module, MAX(version) AS v, COUNT(*) AS n FROM schema_migrations GROUP BY module ORDER BY module').all() as Array<{ module: string; v: number; n: number }>;
  for (const r of rows) console.log(`[db:migrate] ${r.module}: ${r.n} migration(s), latest ${r.v}`);
  console.log('[db:migrate] OK');
  await closeDb();
} catch (e) {
  console.error(`[db:migrate] FAILED: ${(e as Error).message}`);
  process.exit(1);
}
