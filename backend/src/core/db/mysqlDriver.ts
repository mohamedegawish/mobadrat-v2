import mysql, { type Pool, type PoolConnection, type PoolOptions, type ResultSetHeader } from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, Row, RunResult, SqlParam, Statement } from './types.js';
import { stripInternalColumns, translateSql, type TranslatedSql } from './mysqlDialect.js';
import { runMigrations, splitSqlStatements, type MigrationSet } from './migrate.js';

export interface MysqlConfig {
  host: string; port: number; user: string; password: string; database: string;
  poolSize: number; connectTimeoutMs: number; ssl: boolean; txLockTimeoutSec: number;
}

/**
 * Session settings applied to every pooled connection before its first query:
 *  - strict mode (invalid/oversized values are errors, never silent truncation), ONLY_FULL_GROUP_BY;
 *  - PIPES_AS_CONCAT: `||` concatenates, as in SQLite;
 *  - UTC: timestamps are stored as ISO-8601 UTC strings by the application; the session zone only affects NOW() and the like;
 *  - READ COMMITTED: each statement sees the latest committed data. Integrity rests on unique keys, CHECK constraints,
 *    triggers and optimistic `version` checks (UPDATE … WHERE version = ?), not on snapshot reads.
 */
const SESSION_SQL = [
  "SET SESSION sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,"
    + "ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,PIPES_AS_CONCAT', time_zone = '+00:00'",
  'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED',
];

const ER_DUP_ENTRY = 1062;
const ER_LOCK_WAIT_TIMEOUT = 1205;
const ER_LOCK_DEADLOCK = 1213;
const TX_ATTEMPTS = 3;
const TRANSIENT_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ENOTFOUND', 'EAI_AGAIN']);

function errnoOf(e: unknown): number | undefined {
  return e && typeof e === 'object' && typeof (e as { errno?: unknown }).errno === 'number' ? (e as { errno: number }).errno : undefined;
}

/** Lock contention (retry the whole transaction) — a deadlock or a lock-wait timeout. */
export function isMysqlLockConflict(e: unknown): boolean {
  const n = errnoOf(e);
  return n === ER_LOCK_DEADLOCK || n === ER_LOCK_WAIT_TIMEOUT;
}

/** Temporary unavailability: lock contention, or the server unreachable / connection lost. Answered 503 + Retry-After. */
export function isMysqlBusy(e: unknown): boolean {
  if (isMysqlLockConflict(e)) return true;
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

function toValues(params: SqlParam[]): unknown[] {
  return params.map((p) => {
    if (typeof p === 'bigint') return p.toString();
    if (p !== null && typeof p === 'object' && !Buffer.isBuffer(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
    return p;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TxToken { conn: PoolConnection; active: boolean }

export class MysqlDatabase implements Database {
  readonly dialect = 'mysql' as const;
  private pool: Pool | null = null;
  private ready: Promise<void> | null = null;
  private readonly als = new AsyncLocalStorage<TxToken>();

  constructor(private readonly cfg: MysqlConfig, private readonly migrationSets: () => MigrationSet[]) {}

  init(): Promise<void> {
    if (!this.ready) {
      this.ready = this.connectAndMigrate().catch(async (e) => {
        this.ready = null;
        await this.closePool();
        throw e;
      });
    }
    return this.ready;
  }

  private createPool(): Pool {
    const opts: PoolOptions = {
      host: this.cfg.host, port: this.cfg.port, user: this.cfg.user, password: this.cfg.password, database: this.cfg.database,
      connectionLimit: this.cfg.poolSize, waitForConnections: true, queueLimit: 0, maxIdle: this.cfg.poolSize, idleTimeout: 60_000,
      enableKeepAlive: true, keepAliveInitialDelay: 10_000, connectTimeout: 10_000,
      charset: 'utf8mb4', timezone: 'Z', dateStrings: true, decimalNumbers: true, supportBigNumbers: true, bigNumberStrings: false,
      multipleStatements: false,
      // LOCAL_FILES off: a hostile server could otherwise read client files (LOAD DATA LOCAL). IGNORE_SPACE off: it would
      // make built-in function names (e.g. `count`, a column name here) reserved words. FOUND_ROWS stays on (default):
      // UPDATE reports matched rows, like SQLite's `changes`, which the optimistic version checks rely on.
      flags: ['-LOCAL_FILES', '-IGNORE_SPACE'],
      ssl: this.cfg.ssl ? {} : undefined,
    };
    const pool = mysql.createPool(opts);
    pool.on('connection', (conn) => {
      const c = conn as unknown as { query: (sql: string, cb: (err: Error | null) => void) => void };
      for (const sql of SESSION_SQL) c.query(sql, (err) => { if (err) console.error(`[mysql] session setup failed: ${err.message}`); });
    });
    return pool;
  }

  /** Waits for the server (it may still be starting next to us), then applies pending migrations under GET_LOCK. */
  private async connectAndMigrate(): Promise<void> {
    const deadline = Date.now() + this.cfg.connectTimeoutMs;
    let delay = 500;
    this.pool = this.createPool();
    for (;;) {
      try {
        const conn = await this.pool.getConnection();
        try {
          const ran = await runMigrations(conn, this.cfg.database, this.migrationSets());
          if (ran.length) console.log(`[migrate] applied ${ran.join(', ')}`);
        } finally {
          conn.release();
        }
        return;
      } catch (e) {
        if (!isMysqlBusy(e) || Date.now() + delay > deadline) throw e;
        console.warn(`[mysql] database not reachable yet (${(e as { code?: string }).code ?? (e as Error).message}); retrying in ${delay} ms`);
        await sleep(delay);
        delay = Math.min(delay * 2, 5000);
      }
    }
  }

  private async query(t: TranslatedSql, params: SqlParam[]): Promise<unknown> {
    await this.init();
    const token = this.als.getStore();
    const target = token?.active ? token.conn : this.pool!;
    try {
      const [res] = await target.query({ sql: t.sql, values: toValues(params) });
      return res;
    } catch (e) {
      if (t.ignoreDuplicate && errnoOf(e) === ER_DUP_ENTRY) return { affectedRows: 0 } as ResultSetHeader;
      throw e;
    }
  }

  prepare(sql: string): Statement {
    return {
      get: async (...params: SqlParam[]) => {
        const rows = await this.query(translateSql(sql), params) as Row[];
        return Array.isArray(rows) && rows.length ? stripInternalColumns({ ...rows[0] }) : undefined;
      },
      all: async (...params: SqlParam[]) => {
        const rows = await this.query(translateSql(sql), params) as Row[];
        return Array.isArray(rows) ? rows.map((r) => stripInternalColumns({ ...r })) : [];
      },
      run: async (...params: SqlParam[]): Promise<RunResult> => {
        const res = await this.query(translateSql(sql), params) as ResultSetHeader;
        return { changes: Number(res?.affectedRows ?? 0) };
      },
    };
  }

  /** Statements without parameters, one at a time (the pool never enables multipleStatements). */
  async exec(sql: string): Promise<void> {
    for (const stmt of splitSqlStatements(sql)) await this.query(translateSql(stmt), []);
  }

  /**
   * One transaction on one pooled connection, with the same guarantee SQLite's BEGIN IMMEDIATE gives the application:
   * write transactions run one at a time. The workflow, the upload limits and the uniqueness checks were designed (and
   * tested) as "check, then write" inside a transaction; serialising transactions with a named lock (GET_LOCK, shared by
   * every instance on the same database) keeps every one of those checks exact under concurrent requests and across
   * replicas. Reads outside transactions run in parallel. For this workload (minutes between decisions on an application)
   * the lock is held for milliseconds.
   * If the lock is not obtained within DB_TX_LOCK_TIMEOUT_SEC (default 10) the request fails with a retryable 503
   * (DB_BUSY), like SQLite's busy timeout. A deadlock or InnoDB lock-wait timeout rolls everything back and re-runs the
   * function (up to 3 attempts) — safe because transaction bodies only do database work.
   */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    const current = this.als.getStore();
    if (current?.active) return fn();
    await this.init();
    // PERF-4: queue this process's writers BEFORE they take a pool connection. Without it, every writer waiting for
    // GET_LOCK held a connection: with DB_POOL_SIZE=10, nine waiting writers left plain reads (even /health's SELECT 1)
    // queueing for the pool — /health went from ~3 ms to ~570 ms in a write burst (docs/performance). The same total
    // timeout applies (DB_TX_LOCK_TIMEOUT_SEC, retryable 503 DB_BUSY), and GET_LOCK is still taken, so the guarantee
    // across replicas is unchanged: write transactions still run one at a time.
    const started = Date.now();
    const releaseLocal = await this.acquireLocalWriteSlot(this.cfg.txLockTimeoutSec * 1000);
    try {
      const remainingSec = Math.max(1, Math.ceil(this.cfg.txLockTimeoutSec - (Date.now() - started) / 1000));
      return await this.runTx(fn, remainingSec);
    } finally {
      releaseLocal();
    }
  }

  private localWriterBusy = false;
  private readonly localWriters: Array<{ grant: () => void; timer: NodeJS.Timeout }> = [];

  /** FIFO in-process write slot; rejects like a GET_LOCK timeout (errno 1205 → 503 DB_BUSY) after `timeoutMs`. */
  private acquireLocalWriteSlot(timeoutMs: number): Promise<() => void> {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = this.localWriters.shift();
      if (next) { clearTimeout(next.timer); next.grant(); } else this.localWriterBusy = false;
    };
    if (!this.localWriterBusy) { this.localWriterBusy = true; return Promise.resolve(release); }
    return new Promise((resolve, reject) => {
      const waiter = {
        grant: () => resolve(release),
        timer: setTimeout(() => {
          const i = this.localWriters.indexOf(waiter);
          if (i >= 0) this.localWriters.splice(i, 1);
          reject(Object.assign(new Error(`[mysql] write lock not obtained within ${this.cfg.txLockTimeoutSec}s (queued in this process)`), { errno: ER_LOCK_WAIT_TIMEOUT, code: 'ER_LOCK_WAIT_TIMEOUT' }));
        }, timeoutMs),
      };
      this.localWriters.push(waiter);
    });
  }

  private async runTx<T>(fn: () => Promise<T>, lockTimeoutSec: number): Promise<T> {
    const lockName = `mobadrat_tx:${this.cfg.database}`.slice(0, 64);
    for (let attempt = 1; ; attempt++) {
      const conn = await this.pool!.getConnection();
      const token: TxToken = { conn, active: true };
      let locked = false;
      try {
        const [rows] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [lockName, lockTimeoutSec]);
        if (Number((rows as Array<{ got: number | null }>)[0]?.got) !== 1) {
          throw Object.assign(new Error(`[mysql] write lock not obtained within ${this.cfg.txLockTimeoutSec}s`), { errno: ER_LOCK_WAIT_TIMEOUT, code: 'ER_LOCK_WAIT_TIMEOUT' });
        }
        locked = true;
        await conn.query('START TRANSACTION');
        const result = await this.als.run(token, fn);
        await conn.query('COMMIT');
        return result;
      } catch (e) {
        if (locked) { try { await conn.query('ROLLBACK'); } catch { /* connection gone: the server rolls back */ } }
        if (locked && isMysqlLockConflict(e) && attempt < TX_ATTEMPTS) {
          await sleep(20 * attempt + Math.floor(Math.random() * 30));
          continue;
        }
        throw e;
      } finally {
        token.active = false;
        if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
        conn.release();
      }
    }
  }

  outsideTx<T>(fn: () => T): T { return this.als.exit(fn); }

  async schemaVersion(): Promise<number> {
    const r = await this.prepare("SELECT MAX(version) AS v FROM schema_migrations WHERE module = 'core'").get();
    return Number(r?.v ?? 0);
  }

  /** Named advisory lock held for the duration of `fn` (MySQL only) — keeps periodic jobs single-runner across replicas. */
  async withLock<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    await this.init();
    const conn = await this.pool!.getConnection();
    const lockName = `mobadrat_job:${this.cfg.database}:${name}`.slice(0, 64);
    try {
      const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [lockName]);
      if (Number((rows as Array<{ got: number | null }>)[0]?.got) !== 1) return undefined; // another instance runs it
      try { return await fn(); } finally { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined); }
    } finally {
      conn.release();
    }
  }

  private async closePool(): Promise<void> {
    const p = this.pool;
    this.pool = null;
    if (p) await p.end().catch(() => undefined);
  }

  async close(): Promise<void> {
    this.ready = null;
    await this.closePool();
  }
}
