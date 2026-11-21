/**
 * One-time import of an existing SQLite database (the previous deployment's /data/app.db) into the MySQL database.
 *
 *   DB_CLIENT=mysql (+ DATABASE_URL or DB_*) node dist/cli/migrateSqliteToMysql.js --source /data/app.db [--dry-run]
 *   (development: npm run db:import-sqlite -- --source ./data/app.db)
 *
 * Safety rules — the tool refuses and changes nothing unless all hold:
 *  - the source opens read-only and passes PRAGMA integrity_check and foreign_key_check;
 *  - the source schema version equals the MySQL schema version (upgrade an older file first: see the deployment guide);
 *  - the target is migrated and empty (only the four structural organisations created by the MySQL baseline);
 *  - every source table and column exists in the target, and every target column is filled from the source.
 * The copy runs in ONE transaction: any error rolls everything back and leaves the target empty. Afterwards each table is
 * verified (row count + an order-independent SHA-256 of all rows, including rowid → _seq) and every foreign key is checked.
 * The SQLite file is never modified (it stays as the rollback source). Uploaded files are not touched: they stay on the
 * same volume (UPLOAD_DIR) and are referenced by name.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import mysql, { type Connection } from 'mysql2/promise';
import { config } from '../config.js';
import { closeDb, initDb } from '../db/sqlite.js';

type Value = string | number | bigint | null | Uint8Array;
type SqliteRow = Record<string, Value>;

export interface ImportReport {
  dryRun: boolean;
  schemaVersion: number;
  tables: Array<{ table: string; rows: number; checksum: string }>;
}

class ImportError extends Error {}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const STRUCTURAL_ORGS = ['org-admin', 'org-encpc', 'org-imc', 'org-pmu'];
/**
 * Reference tables the target fills itself on every start (db/referenceSeed.ts, migration 010) — like the structural organisations,
 * their rows do not make the target "not empty", and the source copy replaces them inside the import transaction.
 */
const SELF_SEEDED_TABLES = ['industrial_zones'];
const q = (id: string) => `\`${id.replace(/`/g, '``')}\``;

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isInteger(v) ? v.toString() : v.toString();
  if (v instanceof Uint8Array) return `hex:${Buffer.from(v).toString('hex')}`;
  return String(v);
}

/** Order-independent digest: hash of the sorted per-row hashes (no reliance on the two engines sorting identically). */
function digest(rows: Array<Record<string, unknown>>, cols: string[]): string {
  const hashes = rows.map((r) => createHash('sha256').update(JSON.stringify(cols.map((c) => normalize(r[c])))).digest('hex')).sort();
  return createHash('sha256').update(hashes.join('\n')).digest('hex');
}

/** Tables ordered so that referenced tables come first (self references ignored). */
function dependencyOrder(src: DatabaseSync, tables: string[]): string[] {
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    const fks = src.prepare(`PRAGMA foreign_key_list(${q(t)})`).all() as Array<{ table: string }>;
    deps.set(t, new Set(fks.map((f) => f.table).filter((p) => p !== t && tables.includes(p))));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t)) return;
    if (stack.has(t)) throw new ImportError(`foreign-key cycle through ${t}`);
    stack.add(t);
    for (const d of deps.get(t) ?? []) visit(d, stack);
    stack.delete(t);
    seen.add(t);
    out.push(t);
  };
  for (const t of [...tables].sort()) visit(t, new Set());
  return out;
}

export async function importSqliteIntoMysql(sourcePath: string, opts: { dryRun: boolean; log?: (m: string) => void }): Promise<ImportReport> {
  const log = opts.log ?? ((m: string) => console.log(m));
  if (config.dbClient !== 'mysql') throw new ImportError('the target must be MySQL: set DB_CLIENT=mysql and DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD)');
  if (!fs.existsSync(sourcePath)) throw new ImportError(`source SQLite file not found: ${sourcePath}`);

  // ── source checks ──
  const src = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const integrity = (src.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    if (integrity !== 'ok') throw new ImportError(`source integrity_check failed: ${integrity}`);
    const fkProblems = src.prepare('PRAGMA foreign_key_check').all();
    if (fkProblems.length) throw new ImportError(`source has ${fkProblems.length} foreign-key violation(s): ${JSON.stringify(fkProblems.slice(0, 5))}`);
    const srcVersion = Number((src.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0);

    // ── target: migrate, then check it is the same version and empty ──
    await initDb();
    const m = config.mysql;
    const conn: Connection = await mysql.createConnection({
      host: m.host, port: m.port, user: m.user, password: m.password, database: m.database, charset: 'utf8mb4',
      timezone: 'Z', dateStrings: true, decimalNumbers: true, supportBigNumbers: true, flags: ['-LOCAL_FILES', '-IGNORE_SPACE'],
      ssl: m.ssl ? {} : undefined,
    });
    try {
      await conn.query("SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,PIPES_AS_CONCAT', time_zone = '+00:00'");
      const [vr] = await conn.query('SELECT MAX(version) AS v FROM schema_migrations');
      const targetVersion = Number((vr as Array<{ v: number | null }>)[0]?.v ?? 0);
      if (srcVersion !== targetVersion) {
        throw new ImportError(`schema versions differ: SQLite file v${srcVersion}, MySQL v${targetVersion}. `
          + (srcVersion < targetVersion ? 'Upgrade a COPY of the SQLite file first (DB_CLIENT=sqlite DB_PATH=<copy> node dist/db/migrate-cli.js), then import the copy.'
            : 'The SQLite file is newer than this release; deploy the matching release.'));
      }

      const srcTables = (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
      const [tt] = await conn.query("SELECT TABLE_NAME AS t FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> 'schema_migrations'");
      const tgtTables = (tt as Array<{ t: string }>).map((r) => r.t).sort();
      const missing = srcTables.filter((t) => !tgtTables.includes(t));
      const extra = tgtTables.filter((t) => !srcTables.includes(t));
      if (missing.length || extra.length) throw new ImportError(`table sets differ — only in SQLite: [${missing.join(', ')}], only in MySQL: [${extra.join(', ')}]`);

      for (const t of tgtTables) {
        if (SELF_SEEDED_TABLES.includes(t)) continue;
        const [cnt] = await conn.query(`SELECT COUNT(*) AS n FROM ${q(t)}${t === 'organizations' ? ` WHERE id NOT IN (${STRUCTURAL_ORGS.map(() => '?').join(',')})` : ''}`, t === 'organizations' ? STRUCTURAL_ORGS : []);
        if (Number((cnt as Array<{ n: number }>)[0].n) > 0) throw new ImportError(`the MySQL database is not empty (table ${t} has rows). Import only into a freshly migrated database.`);
      }

      // ── column mapping ──
      const plan: Array<{ table: string; srcCols: string[]; seq: boolean }> = [];
      for (const t of dependencyOrder(src, srcTables)) {
        const srcCols = (src.prepare(`PRAGMA table_info(${q(t)})`).all() as Array<{ name: string }>).map((c) => c.name);
        const [cc] = await conn.query("SELECT COLUMN_NAME AS c, EXTRA AS e FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", [t]);
        const tgt = cc as Array<{ c: string; e: string }>;
        // Generated columns only: MySQL 8 reports "VIRTUAL GENERATED" / "STORED GENERATED" (MariaDB: VIRTUAL/PERSISTENT).
        // NOT "DEFAULT_GENERATED", which MySQL 8 sets on every ordinary column with an expression default such as DEFAULT ('').
        const generated = new Set(tgt.filter((c) => /\b(VIRTUAL|STORED|PERSISTENT)\b/i.test(c.e)).map((c) => c.c));
        const writable = tgt.map((c) => c.c).filter((c) => !generated.has(c));
        const seq = writable.includes('_seq');
        const notInTarget = srcCols.filter((c) => !writable.includes(c));
        const notInSource = writable.filter((c) => c !== '_seq' && !srcCols.includes(c));
        if (notInTarget.length || notInSource.length) {
          throw new ImportError(`columns of ${t} differ — only in SQLite: [${notInTarget.join(', ')}], only in MySQL: [${notInSource.join(', ')}]`);
        }
        plan.push({ table: t, srcCols, seq });
      }

      // ── copy (one transaction) ──
      const report: ImportReport = { dryRun: opts.dryRun, schemaVersion: srcVersion, tables: [] };
      await conn.query('SET SESSION FOREIGN_KEY_CHECKS = 0');
      await conn.beginTransaction();
      try {
        await conn.query(`DELETE FROM organizations WHERE id IN (${STRUCTURAL_ORGS.map(() => '?').join(',')})`, STRUCTURAL_ORGS);
        for (const t of SELF_SEEDED_TABLES) await conn.query(`DELETE FROM ${q(t)}`);
        for (const p of plan) {
          const rows = src.prepare(`SELECT ${p.seq ? 'rowid AS _seq, ' : ''}${p.srcCols.map(q).join(', ')} FROM ${q(p.table)} ORDER BY rowid`).all() as SqliteRow[];
          const cols = p.seq ? ['_seq', ...p.srcCols] : p.srcCols;
          for (let i = 0; i < rows.length; i += 200) {
            const batch = rows.slice(i, i + 200);
            const placeholders = batch.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
            const values = batch.flatMap((r) => cols.map((c) => {
              const v = r[c];
              return typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v) : v;
            }));
            try {
              await conn.query(`INSERT INTO ${q(p.table)} (${cols.map(q).join(', ')}) VALUES ${placeholders}`, values);
            } catch (e) {
              throw new ImportError(`insert into ${p.table} failed (rows ${i + 1}–${i + batch.length}): ${(e as Error).message}`);
            }
          }
          // verification of this table, inside the same transaction
          const [back] = await conn.query(`SELECT ${cols.map(q).join(', ')} FROM ${q(p.table)}`);
          const tgtRows = back as Array<Record<string, unknown>>;
          if (tgtRows.length !== rows.length) throw new ImportError(`${p.table}: ${rows.length} rows in SQLite but ${tgtRows.length} in MySQL`);
          const a = digest(rows, cols);
          const b = digest(tgtRows, cols);
          if (a !== b) throw new ImportError(`${p.table}: content checksum differs after the copy (SQLite ${a.slice(0, 12)}…, MySQL ${b.slice(0, 12)}…)`);
          report.tables.push({ table: p.table, rows: rows.length, checksum: a });
          log(`  ✔ ${p.table.padEnd(28)} ${String(rows.length).padStart(7)} rows  sha256 ${a.slice(0, 16)}…`);
        }
        // every foreign key of the SQLite schema holds in MySQL
        for (const p of plan) {
          const fks = src.prepare(`PRAGMA foreign_key_list(${q(p.table)})`).all() as Array<{ table: string; from: string; to: string }>;
          for (const fk of fks) {
            const [o] = await conn.query(`SELECT COUNT(*) AS n FROM ${q(p.table)} c LEFT JOIN ${q(fk.table)} r ON r.${q(fk.to)} = c.${q(fk.from)} WHERE c.${q(fk.from)} IS NOT NULL AND r.${q(fk.to)} IS NULL`);
            const n = Number((o as Array<{ n: number }>)[0].n);
            if (n) throw new ImportError(`${p.table}.${fk.from} → ${fk.table}.${fk.to}: ${n} orphan row(s) after the copy`);
          }
        }
        if (opts.dryRun) {
          await conn.rollback();
          log('[import] dry run: everything verified, then rolled back — the MySQL database is unchanged.');
        } else {
          await conn.commit();
          log(`[import] committed ${report.tables.reduce((s, t) => s + t.rows, 0)} rows from ${report.tables.length} tables (schema v${srcVersion}).`);
        }
      } catch (e) {
        await conn.rollback().catch(() => undefined);
        throw e;
      } finally {
        await conn.query('SET SESSION FOREIGN_KEY_CHECKS = 1').catch(() => undefined);
      }
      return report;
    } finally {
      await conn.end().catch(() => undefined);
    }
  } finally {
    src.close();
    await closeDb();
  }
}

if (process.argv[1] && /migrateSqliteToMysql\.(ts|js)$/.test(process.argv[1])) {
  const source = arg('source');
  if (!source) {
    console.error('usage: migrateSqliteToMysql --source /data/app.db [--dry-run]   (target: DB_CLIENT=mysql + DATABASE_URL or DB_*)');
    process.exit(2);
  }
  try {
    await importSqliteIntoMysql(source, { dryRun: process.argv.includes('--dry-run') });
    process.exit(0);
  } catch (e) {
    console.error(`[import] FAILED — nothing was written: ${(e as Error).message}`);
    process.exit(1);
  }
}
