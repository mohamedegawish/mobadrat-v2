/**
 * Database facade: one driver per process, chosen by DB_CLIENT (config.dbClient).
 *  - mysql: production (Docker/Coolify) — mysql2 pool, migrations in src/db/migrations-mysql.
 *  - sqlite: development and tests — node:sqlite, migrations in src/db/migrations (the historical schema, unchanged).
 * The stores use getDb().prepare(sql).get/all/run and tx(); see types.ts.
 */
import { config } from '../config.js';
import type { Database, Dialect } from './types.js';
import { SqliteDatabase, isSqliteBusy, nowIso } from './sqliteDriver.js';
import { MysqlDatabase, isMysqlBusy } from './mysqlDriver.js';

export type { Database, Dialect, Row, RunResult, SqlParam, Statement } from './types.js';
export { nowIso };

let instance: Database | null = null;

export function getDb(): Database {
  if (instance) return instance;
  instance = config.dbClient === 'mysql' ? new MysqlDatabase(config.mysql) : new SqliteDatabase(config.dbPath);
  return instance;
}

/** Connects and applies pending migrations. Call once at start-up, before serving requests. */
export async function initDb(): Promise<void> {
  await getDb().init();
  // البيانات المرجعية (المناطق الصناعية) في كل البيئات بما فيها الإنتاج — idempotent، تحت قفل على MySQL.
  const { seedReferenceData } = await import('./referenceSeed.js');
  const r = await seedReferenceData();
  if (r && (r.inserted || r.updated || r.deactivated)) console.log(`[reference-seed] industrial zones: +${r.inserted} inserted, ${r.updated} updated, ${r.deactivated} deactivated`);
}

export function dbDialect(): Dialect {
  return getDb().dialect;
}

/** معاملة واحدة؛ المعاملات المتداخلة تنضم للمعاملة الخارجية. */
export function tx<T>(fn: () => Promise<T>): Promise<T> {
  return getDb().tx(fn);
}

/** Schedules/runs `fn` outside any open transaction (see Database.outsideTx). */
export function outsideTx<T>(fn: () => T): T {
  return getDb().outsideTx(fn);
}

export function closeDb(): Promise<void> {
  const d = instance;
  instance = null;
  return d ? d.close() : Promise.resolve();
}

/** The raw node:sqlite connection — SQLite-only tools and tests (PRAGMA, VACUUM, query plans). */
export function rawSqlite(): import('node:sqlite').DatabaseSync {
  const d = getDb();
  if (!(d instanceof SqliteDatabase)) throw new Error('rawSqlite() is only available with DB_CLIENT=sqlite');
  return d.raw();
}

/**
 * Advisory lock for periodic jobs: on MySQL only one instance runs `fn` at a time (others skip this round);
 * SQLite runs it directly (one process per database file).
 */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const d = getDb();
  return d instanceof MysqlDatabase ? d.withLock(name, fn) : fn();
}

/** Temporary database unavailability (SQLite write lock held elsewhere, MySQL lock contention or connection loss) → 503. */
export function isDbBusy(e: unknown): boolean {
  return isSqliteBusy(e) || isMysqlBusy(e);
}

/**
 * SQL expression: days between two ISO-8601 UTC timestamp columns (fractional), `toExpr - fromExpr`.
 * SQLite: julianday(); MySQL: TIMESTAMPDIFF on the parsed strings (the application stores timestamps as ISO text).
 */
export function sqlDaysBetween(fromExpr: string, toExpr: string): string {
  if (dbDialect() === 'sqlite') return `julianday(${toExpr}) - julianday(${fromExpr})`;
  const ts = (e: string) => `STR_TO_DATE(${e}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
  return `TIMESTAMPDIFF(MICROSECOND, ${ts(fromExpr)}, ${ts(toExpr)}) / 86400000000.0`;
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
