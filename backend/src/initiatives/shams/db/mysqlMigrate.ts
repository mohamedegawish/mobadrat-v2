import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolConnection } from 'mysql2/promise';

/**
 * MySQL migrations: src/db/migrations-mysql/NNN_name.sql, numbered like the SQLite ones (a parity test keeps the two
 * directories on the same version set). 001 creates the complete schema equivalent to SQLite v7; 002–007 are recorded
 * no-ops on MySQL because 001 already contains them. Every later migration must be written for both engines.
 *
 * Differences from the SQLite runner, by necessity:
 *  - MySQL DDL commits implicitly and cannot be rolled back. A failed file is NOT recorded, the process refuses to start,
 *    and the database must be restored from the backup taken before the deploy (docs/deployment/COOLIFY_DEPLOYMENT.md).
 *  - GET_LOCK serialises concurrent starts (several replicas): one migrates, the others wait and then find nothing to do.
 *  - Files use the mysql client's syntax (`DELIMITER` for trigger bodies), so an operator can also apply them with the
 *    `mysql` command-line client.
 */

export function mysqlMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'migrations-mysql'),
    path.join(process.cwd(), 'dist', 'db', 'migrations-mysql'),
    path.join(process.cwd(), 'src', 'db', 'migrations-mysql'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`MySQL migrations directory not found (tried ${candidates.join(' | ')})`);
  return found;
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

/**
 * MySQL 8.0.16+ is required: earlier versions parse CHECK constraints but do not enforce them, which would silently drop
 * a large part of the schema's integrity rules. MariaDB is refused unless MYSQL_ALLOW_MARIADB=1 (development tests only).
 */
export function assertSupportedServer(info: ServerInfo): void {
  if (info.isMariaDb) {
    if (process.env.MYSQL_ALLOW_MARIADB === '1') return;
    throw new Error(`[mysql] MariaDB (${info.version}) is not a supported production server; use MySQL 8.4. `
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

export async function runMysqlMigrations(conn: PoolConnection, database: string): Promise<string[]> {
  const info = await serverInfo(conn);
  assertSupportedServer(info);
  const lockName = `shams_migrate:${database}`.slice(0, 64);
  const [lockRows] = await conn.query('SELECT GET_LOCK(?, 300) AS got', [lockName]);
  if (Number((lockRows as Array<{ got: number | null }>)[0]?.got) !== 1) {
    throw new Error('[migrate] could not obtain the migration lock within 300s (another instance is migrating?)');
  }
  try {
    await conn.query(adaptForServer(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      appliedAt VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`, info));
    const [appliedRows] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set((appliedRows as Array<{ version: number }>).map((r) => Number(r.version)));
    const dir = mysqlMigrationsDir();
    const files = fs.readdirSync(dir).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
    const ran: string[] = [];
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      if (applied.has(version)) continue;
      const statements = splitSqlStatements(adaptForServer(fs.readFileSync(path.join(dir, file), 'utf8'), info));
      for (let i = 0; i < statements.length; i++) {
        try {
          await conn.query(statements[i]);
        } catch (e) {
          throw new Error(`[migrate] ${file} failed at statement ${i + 1}/${statements.length}: ${(e as Error).message}. `
            + 'MySQL DDL cannot be rolled back: the migration was not recorded; restore the pre-deploy backup before retrying.');
        }
      }
      await conn.query('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)', [version, file, new Date().toISOString()]);
      ran.push(file);
    }
    return ran;
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
  }
}
