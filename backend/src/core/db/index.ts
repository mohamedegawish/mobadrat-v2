/**
 * Database facade (MySQL 8.4 everywhere). One pool per process.
 * The stores use getDb().prepare(sql).get/all/run and tx(); see types.ts. The SQL in the stores is written in the
 * historical SQLite syntax of the original applications and translated by mysqlDialect.ts (closed, tested set).
 *
 * Migrations: the core set runs first, then every initiative module's set (registered at boot through
 * setMigrationSets — the core never imports the modules).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.js';
import type { Database, Dialect } from './types.js';
import { MysqlDatabase, isMysqlBusy } from './mysqlDriver.js';
import type { MigrationSet } from './migrate.js';

export type { Database, Dialect, Row, RunResult, SqlParam, Statement } from './types.js';
export type { MigrationSet } from './migrate.js';

/** ISO-8601 UTC with milliseconds — the format every timestamp column stores. */
export function nowIso(): string { return new Date().toISOString(); }

let instance: Database | null = null;
let moduleSets: MigrationSet[] = [];

/** Resolves a migrations directory in src/ (tsx) or dist/ (built), relative to the given module file URL. */
export function migrationsDirFor(metaUrl: string, rel = 'migrations'): string {
  const here = path.dirname(fileURLToPath(metaUrl));
  const p = path.join(here, rel);
  if (fs.existsSync(p)) return p;
  // dist build without copied SQL: fall back to the source tree.
  const src = p.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`);
  return fs.existsSync(src) ? src : p;
}

export function coreMigrationSet(): MigrationSet {
  return { module: 'core', dir: migrationsDirFor(import.meta.url) };
}

/** Called once at boot (before initDb) with the registered initiative modules' migration sets, in registry order. */
export function setMigrationSets(sets: MigrationSet[]): void {
  moduleSets = sets;
}

export function getDb(): Database {
  if (instance) return instance;
  instance = new MysqlDatabase(config.mysql, () => [coreMigrationSet(), ...moduleSets]);
  return instance;
}

/** Connects and applies pending migrations. Call once at start-up, before serving requests. */
export async function initDb(): Promise<void> {
  await getDb().init();
}

export function dbDialect(): Dialect {
  return getDb().dialect;
}

/** One transaction; nested calls join the outer one. */
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

/** Advisory lock for periodic jobs: only one instance runs `fn` at a time (others skip this round). */
export async function withJobLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const d = getDb();
  return d instanceof MysqlDatabase ? d.withLock(name, fn) : fn();
}

/** Temporary database unavailability (lock contention, connection loss) → 503. */
export function isDbBusy(e: unknown): boolean {
  return isMysqlBusy(e);
}

/**
 * SQL expression: days between two ISO-8601 UTC timestamp columns (fractional), `toExpr - fromExpr`.
 * The application stores timestamps as ISO text, so they are parsed first.
 */
export function sqlDaysBetween(fromExpr: string, toExpr: string): string {
  const ts = (e: string) => `STR_TO_DATE(${e}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
  return `TIMESTAMPDIFF(MICROSECOND, ${ts(fromExpr)}, ${ts(toExpr)}) / 86400000000.0`;
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
