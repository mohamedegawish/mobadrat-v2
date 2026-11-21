/**
 * The database contract shared by both drivers (SQLite for development/tests, MySQL for production).
 * It mirrors the node:sqlite statement API (`prepare(sql).get/all/run`) with Promises, so the SQL in the stores is written
 * once (in SQLite syntax) and the MySQL driver translates the few constructs that differ (see mysqlDialect.ts).
 */
export type SqlParam = string | number | bigint | null | NodeJS.ArrayBufferView;

export type Row = Record<string, unknown>;

export interface RunResult {
  /** Rows matched by UPDATE/DELETE, or inserted by INSERT (SQLite `changes`; MySQL affectedRows with CLIENT_FOUND_ROWS). */
  changes: number;
}

export interface Statement {
  get(...params: SqlParam[]): Promise<Row | undefined>;
  all(...params: SqlParam[]): Promise<Row[]>;
  run(...params: SqlParam[]): Promise<RunResult>;
}

export type Dialect = 'sqlite' | 'mysql';

export interface Database {
  readonly dialect: Dialect;
  /** Connects (waiting for the server when needed) and applies pending migrations. Idempotent. */
  init(): Promise<void>;
  prepare(sql: string): Statement;
  /** One or more statements without parameters (DDL, PRAGMA). */
  exec(sql: string): Promise<void>;
  /**
   * One transaction. Statements issued anywhere inside `fn` (through getDb()) run in it; nested calls join the outer one.
   * `fn` must only await database work: no network calls, no timers.
   */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Runs `fn` outside the current transaction's context. Background work scheduled from inside a transaction (a timer, a
   * worker kick) must not join that transaction: with the synchronous driver it could only ever run after the commit.
   */
  outsideTx<T>(fn: () => T): T;
  /** Highest applied migration version (0 = none). */
  schemaVersion(): Promise<number>;
  close(): Promise<void>;
}
