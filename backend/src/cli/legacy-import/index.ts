/**
 * Legacy data import: Shams El-Senaa + Sona'a El-Mostaqbal + the old generic platform → this platform.
 *
 *   npm run legacy:import -- \
 *     --shams-sqlite ../shams/backend/data/app.db | --shams-mysql mysql://user:pass@host:3306/shams \
 *     --shams-uploads ../shams/backend/data/uploads \
 *     --sona3-sqlite ../sona3/backend/data/app.db --sona3-uploads ../sona3/backend/data/uploads \
 *     --platform-sqlite ../old-platform/data/app.db [--platform-uploads ../old-platform/data] \
 *     [--dry-run] [--disable-demo-accounts] [--platform-shams-initiative init-solar-2026] [--report ./legacy-import-report]
 *
 * The target is the platform database of the environment (DATABASE_URL / DB_*): it is migrated first and must have no
 * accounts yet (fresh database). Stop the legacy apps (or copy their .db with -wal and -shm while stopped) and do not start
 * the platform before the import ends. Everything is written in one transaction: any error, or --dry-run, rolls it all back.
 * Files are copied (never moved). A JSON + Markdown report is written to --report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { bootPlatform } from '../../core/boot.js';
import { closeDb } from '../../core/db/index.js';
import { Importer, newReport, renderMarkdown, type ImportOptions } from './importer.js';
import { openMysqlSource, openSqliteSource, type SourceDb, type SourceName } from './sources.js';
import { Target } from './target.js';

const EXPECTED_SCHEMA: Partial<Record<SourceName, number>> = { shams: 11, sona3: 3 };

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

const KNOWN = new Set(['shams-sqlite', 'shams-mysql', 'shams-uploads', 'sona3-sqlite', 'sona3-uploads', 'platform-sqlite', 'platform-uploads',
  'dry-run', 'disable-demo-accounts', 'platform-shams-initiative', 'report', 'help']);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0]); return 0; }
  for (const k of Object.keys(args)) if (!KNOWN.has(k)) throw new Error(`unknown option --${k} (see --help)`);
  const str = (k: string) => (typeof args[k] === 'string' ? path.resolve(args[k] as string) : undefined);
  if (args['shams-sqlite'] && args['shams-mysql']) throw new Error('give either --shams-sqlite or --shams-mysql, not both');
  const dryRun = args['dry-run'] === true;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = str('report') ?? path.resolve(`legacy-import-${stamp}`);
  fs.mkdirSync(reportDir, { recursive: true });
  const report = newReport(dryRun);

  const sources: Partial<Record<SourceName, SourceDb>> = {};
  if (str('shams-sqlite')) sources.shams = openSqliteSource('shams', str('shams-sqlite')!, path.join(reportDir, 'snapshots', 'shams'));
  if (typeof args['shams-mysql'] === 'string') sources.shams = await openMysqlSource('shams', args['shams-mysql']);
  if (str('sona3-sqlite')) sources.sona3 = openSqliteSource('sona3', str('sona3-sqlite')!, path.join(reportDir, 'snapshots', 'sona3'));
  if (str('platform-sqlite')) sources.platform = openSqliteSource('platform', str('platform-sqlite')!, path.join(reportDir, 'snapshots', 'platform'));
  if (!Object.keys(sources).length) throw new Error('no source given (see --help)');

  // Preflight: readable, consistent, at the schema version this import was written for.
  for (const src of Object.values(sources)) {
    const tables: Record<string, number> = {};
    for (const t of await src.tables()) tables[t] = (await src.rows(t)).length;
    report.sources.push({ name: src.name, kind: src.kind, location: src.location, fingerprint: src.fingerprint, schemaVersion: src.schemaVersion, tables });
    for (const p of src.problems) report.errors.push(`${src.name}: ${p}`);
    const want = EXPECTED_SCHEMA[src.name];
    if (want !== undefined && src.schemaVersion !== want) report.errors.push(`${src.name}: schema version ${src.schemaVersion ?? 'unknown'}, this import expects ${want}`);
    if (!tables.users) report.warnings.push(`${src.name}: no accounts`);
  }
  const options: ImportOptions = {
    sources, dryRun, disableDemoAccounts: args['disable-demo-accounts'] === true,
    uploads: { shams: str('shams-uploads'), sona3: str('sona3-uploads'), platform: str('platform-uploads') },
    platformShamsInitiative: typeof args['platform-shams-initiative'] === 'string' ? args['platform-shams-initiative'] : 'init-solar-2026',
  };

  let target: Target | null = null;
  let committed = false;
  try {
    if (report.errors.length) throw new Error('preflight failed');
    await bootPlatform(); // migrations, reference data, catalog pages of the modules
    await closeDb();
    target = await Target.open();
    const lock = await target.one<{ l: number }>("SELECT GET_LOCK('mobadrat_job:legacy-import', 0) AS l");
    if (Number(lock?.l) !== 1) throw new Error('another import is running on this database');
    const accounts = await target.count('users');
    const done = await target.one<{ n: number }>('SELECT COUNT(*) AS n FROM legacy_import_runs WHERE finishedAt IS NOT NULL');
    if (accounts > 0 || Number(done?.n) > 0) {
      throw new Error(`the target database already has ${accounts} account(s)${Number(done?.n) ? ' and a finished import' : ''}: import into a fresh database (re-create it and run again)`);
    }
    const fingerprint = createHash('sha256').update(report.sources.map((x) => `${x.name}:${x.fingerprint}`).join('|')).digest('hex');
    await target.exec('SET FOREIGN_KEY_CHECKS = 0');
    await target.exec('START TRANSACTION');
    await new Importer(target, options, report).run();
    await target.exec('SET FOREIGN_KEY_CHECKS = 1');
    if (report.errors.length) throw new Error('verification failed');
    report.finishedAt = new Date().toISOString();
    const summary = {
      mode: report.mode, accounts: report.users.accounts, memberships: report.memberships, tables: report.tables.length,
      profiles: report.profiles, files: report.fileChecks.ok, sources: report.sources.map(({ name, kind, fingerprint: fp }) => ({ name, kind, fingerprint: fp })),
    };
    await target.exec('INSERT INTO legacy_import_runs (id, sourceFingerprint, startedAt, finishedAt, report) VALUES (?, ?, ?, ?, ?)',
      [`imp-${randomUUID()}`, fingerprint, report.startedAt, report.finishedAt, JSON.stringify(summary)]);
    if (dryRun) await target.exec('ROLLBACK');
    else { await target.exec('COMMIT'); committed = true; }
  } catch (e) {
    if (target) { try { await target.exec('ROLLBACK'); } catch { /* connection lost: nothing was committed */ } }
    const msg = (e as Error).message;
    if (!['preflight failed', 'verification failed'].includes(msg)) report.errors.push(msg);
    report.finishedAt = new Date().toISOString();
  } finally {
    if (target) await target.close();
    for (const s of Object.values(sources)) await s.close();
  }

  fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(reportDir, 'report.md'), renderMarkdown(report));
  const ok = !report.errors.length;
  console.log(`[legacy-import] ${ok ? (committed ? 'imported and verified' : 'dry run OK (rolled back)') : 'FAILED — nothing was written'}`);
  console.log(`[legacy-import] ${report.users.accounts} accounts, ${report.memberships} memberships, ${report.tables.length} table loads, ${report.profiles.person + report.profiles.factory} profiles, ${report.fileChecks.ok} files checked`);
  for (const e of report.errors.slice(0, 15)) console.log(`  ✖ ${e}`);
  console.log(`[legacy-import] report: ${path.join(reportDir, 'report.md')}`);
  return ok ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.error(`[legacy-import] ${(e as Error).message}`); process.exit(1); });
