import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';

/**
 * Per-module MySQL migrations.
 *
 *  - The core owns   src/core/db/migrations/NNN_name.sql
 *  - Each initiative src/initiatives/<id>/db/migrations/NNN_name.sql   (tables prefixed `<id>_`)
 *
 * `schema_migrations(module, version)` records what ran, with the file's SHA-256: an applied file that was edited
 * afterwards stops the start-up (a migration is immutable once shipped — write a new one).
 * The core runs first, then every module in registry order. MySQL DDL commits implicitly and cannot be rolled back: a failed
 * file is NOT recorded, the process refuses to start, and the database must be restored from the pre-deploy backup.
 * GET_LOCK serialises concurrent starts (several replicas). Files use the mysql client's syntax (`DELIMITER` for trigger
 * bodies), so an operator can also apply them with the `mysql` command-line client.
 */

export interface MigrationSet {
  /** 'core' or an initiative module id. */
  module: string;
  dir: string;
}

/** Splits a migration file into statements, honouring `DELIMITER xx` lines like the mysql client. */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let delimiter = ';';
  let buf: string[] = [];
  const flush = () => {
    const stmt = buf.join('\n').trim();
    buf = [];
    if (stmt && !/^(\s*--[^\n]*\n?)*\s*$/.test(stmt)) out.push(stmt);
  };
  for (const line of sql.split(/\r?\n/)) {
    const d = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (d) { flush(); delimiter = d[1]; continue; }
    const trimmed = line.trimEnd();
    if (trimmed.endsWith(delimiter) && !/^\s*--/.test(trimmed)) {
      buf.push(trimmed.slice(0, trimmed.length - delimiter.length));
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** MySQL 8 collations used by the schema → the closest MariaDB equivalents (MariaDB is accepted for development tests only). */
const MARIADB_COLLATIONS: Record<string, string> = {
  utf8mb4_0900_bin: 'utf8mb4_nopad_bin',
  utf8mb4_0900_as_ci: 'utf8mb4_unicode_nopad_ci',
};

export interface ServerInfo { version: string; isMariaDb: boolean }

export async function serverInfo(conn: PoolConnection): Promise<ServerInfo> {
  const [rows] = await conn.query('SELECT VERSION() AS v');
  const version = String((rows as Array<{ v: string }>)[0]?.v ?? '');
  return { version, isMariaDb: /mariadb/i.test(version) };
}

/** MySQL 8.0.16+ (enforced CHECK constraints). MariaDB is refused unless MYSQL_ALLOW_MARIADB=1 (development tests only). */
export function assertSupportedServer(info: ServerInfo): void {
  if (info.isMariaDb) {
    if (process.env.MYSQL_ALLOW_MARIADB === '1') return;
    throw new Error(`[mysql] MariaDB (${info.version}) is not a supported server; use MySQL 8.4. `
      + 'Set MYSQL_ALLOW_MARIADB=1 only for local development tests.');
  }
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(info.version);
  const [maj, min, pat] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const ok = maj > 8 || (maj === 8 && (min > 0 || pat >= 16));
  if (!ok) throw new Error(`[mysql] MySQL ${info.version} is too old: 8.0.16 or newer is required (CHECK constraints). Use MySQL 8.4.`);
}

export function adaptForServer(sql: string, info: ServerInfo): string {
  if (!info.isMariaDb) return sql;
  return sql.replace(/\butf8mb4_0900_(bin|as_ci)\b/g, (m) => MARIADB_COLLATIONS[m] ?? m);
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
}

function checksum(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

export async function runMigrations(conn: PoolConnection, database: string, sets: MigrationSet[]): Promise<string[]> {
  const info = await serverInfo(conn);
  assertSupportedServer(info);
  const lockName = `mobadrat_migrate:${database}`.slice(0, 64);
  const [lockRows] = await conn.query('SELECT GET_LOCK(?, 300) AS got', [lockName]);
  if (Number((lockRows as Array<{ got: number | null }>)[0]?.got) !== 1) {
    throw new Error('[migrate] could not obtain the migration lock within 300s (another instance is migrating?)');
  }
  try {
    await conn.query(adaptForServer(`CREATE TABLE IF NOT EXISTS schema_migrations (
      module VARCHAR(32) NOT NULL,
      version INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      appliedAt VARCHAR(32) NOT NULL,
      PRIMARY KEY (module, version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`, info));
    const [appliedRows] = await conn.query('SELECT module, version, name, checksum FROM schema_migrations');
    const applied = new Map<string, { name: string; checksum: string }>();
    for (const r of appliedRows as Array<{ module: string; version: number; name: string; checksum: string }>) {
      applied.set(`${r.module}:${Number(r.version)}`, { name: r.name, checksum: r.checksum });
    }
    const ran: string[] = [];
    for (const set of sets) {
      for (const file of listFiles(set.dir)) {
        const version = Number(file.slice(0, 3));
        const text = fs.readFileSync(path.join(set.dir, file), 'utf8');
        const sum = checksum(text);
        const prev = applied.get(`${set.module}:${version}`);
        if (prev) {
          if (prev.checksum !== sum && process.env.MIGRATIONS_ALLOW_CHECKSUM_DRIFT !== '1') {
            throw new Error(`[migrate] ${set.module}/${file} was changed after it was applied (checksum mismatch). `
              + 'Shipped migrations are immutable: revert the edit and add a new migration.');
          }
          continue;
        }
        const statements = splitSqlStatements(adaptForServer(text, info));
        for (let i = 0; i < statements.length; i++) {
          try {
            await conn.query(statements[i]);
          } catch (e) {
            throw new Error(`[migrate] ${set.module}/${file} failed at statement ${i + 1}/${statements.length}: ${(e as Error).message}. `
              + 'MySQL DDL cannot be rolled back: the migration was not recorded; restore the pre-deploy backup before retrying.');
          }
        }
        await conn.query('INSERT INTO schema_migrations (module, version, name, checksum, appliedAt) VALUES (?, ?, ?, ?, ?)',
          [set.module, version, file, sum, new Date().toISOString()]);
        ran.push(`${set.module}/${file}`);
      }
    }
    return ran;
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
  }
}
