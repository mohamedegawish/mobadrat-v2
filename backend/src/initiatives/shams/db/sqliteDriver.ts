import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database, Row, RunResult, SqlParam, Statement } from './types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Serialises the single SQLite connection between concurrent requests now that the API is async.
 * node:sqlite is synchronous, so a single statement can never interleave with another one. A transaction, however, now
 * spans several awaits: while it is open, every statement issued outside it waits here, so no request ever reads another
 * request's uncommitted writes and two transactions never mix on the one connection (the guarantee the synchronous
 * `tx()` gave before).
 */
class Gate {
  private locked = false;
  private readonly waiters: Array<() => void> = [];
  get isLocked(): boolean { return this.locked; }
  acquire(): Promise<void> {
    if (!this.locked) { this.locked = true; return Promise.resolve(); }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next(); else this.locked = false;
  }
}

interface TxToken { active: boolean }

export function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'migrations'), // tsx: src/db/migrations — node: dist/db/migrations (copy-migrations)
    path.join(process.cwd(), 'dist', 'db', 'migrations'),
    path.join(process.cwd(), 'src', 'db', 'migrations'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`migrations directory not found (tried ${candidates.join(' | ')})`);
  return found;
}

/** Migrations مرقمة `NNN_name.sql`، كل ملف في معاملة، ويُسجل في schema_migrations. */
export function runMigrations(d: DatabaseSync): string[] {
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    appliedAt TEXT NOT NULL
  )`);
  const applied = new Set((d.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = Number(file.slice(0, 3));
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // إعادة بناء جدول له مراجع (إجراء SQLite الموثق للتعديل على CHECK): المفاتيح الأجنبية تُعطَّل قبل المعاملة — PRAGMA لا يعمل داخلها —
    // حتى لا يحذف DROP TABLE صفوف الجداول التابعة تتاليًا، ثم يُفحص التكامل كاملًا قبل الالتزام وتُعاد المفاتيح دائمًا.
    const fkOff = /^\s*--\s*migrate:foreign-keys-off\b/.test(sql);
    if (fkOff) d.exec('PRAGMA foreign_keys = OFF');
    d.exec('BEGIN IMMEDIATE');
    try {
      // Several processes starting together on one file: the set above was read before this write lock, so another process may
      // have applied this file meanwhile. Re-checked under the lock — otherwise the migration would run twice and fail the start.
      if (d.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)) { d.exec('ROLLBACK'); continue; }
      d.exec(sql);
      if (fkOff) {
        const broken = d.prepare('PRAGMA foreign_key_check').all() as Array<{ table: string; parent: string }>;
        if (broken.length) throw new Error(`foreign key check failed: ${broken.slice(0, 5).map((b) => `${b.table}→${b.parent}`).join(', ')}`);
      }
      d.prepare('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)').run(version, file, nowIso());
      d.exec('COMMIT');
      ran.push(file);
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(`[migrate] ${file} failed: ${(e as Error).message}`);
    } finally {
      if (fkOff) d.exec('PRAGMA foreign_keys = ON');
    }
  }
  return ran;
}

/**
 * PR-C3: SQLITE_BUSY / SQLITE_LOCKED (بعد انتهاء busy_timeout) — قفل الكتابة مشغول بعملية أخرى (نسخ احتياطي، أداة سطر أوامر، نسخة ثانية).
 * خطأ مؤقت يُعاد معه المحاولة، لا خطأ داخلي. المعاملة نفسها تراجعت كاملة (BEGIN لم ينجح أو ROLLBACK في tx).
 */
export function isSqliteBusy(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code, errcode } = e as { code?: unknown; errcode?: unknown };
  return code === 'ERR_SQLITE_ERROR' && typeof errcode === 'number' && ((errcode & 0xff) === 5 || (errcode & 0xff) === 6);
}

export class SqliteDatabase implements Database {
  readonly dialect = 'sqlite' as const;
  private db: DatabaseSync | null = null;
  private readonly gate = new Gate();
  private readonly als = new AsyncLocalStorage<TxToken>();

  constructor(private readonly dbPath: string) {}

  /** Opens the file (WAL, foreign keys, busy timeout) and applies the numbered migrations — synchronously, as before. */
  raw(): DatabaseSync {
    if (this.db) return this.db;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const d = new DatabaseSync(this.dbPath);
    // busy_timeout FIRST, so the runner's BEGIN IMMEDIATE waits for a process that is migrating. Converting a NEW file to WAL does
    // not go through the busy handler: processes starting together on a fresh file got "database is locked" at once. WAL is
    // persistent, so as soon as one process has switched the file the others' switch is a no-op — retry briefly on SQLITE_BUSY.
    d.exec('PRAGMA busy_timeout = 5000;');
    for (const deadline = Date.now() + 5000; ;) {
      try { d.exec('PRAGMA journal_mode = WAL;'); break; } catch (e) {
        if (!isSqliteBusy(e) || Date.now() > deadline) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // startup only (raw() is synchronous by design)
      }
    }
    d.exec('PRAGMA foreign_keys = ON;');
    runMigrations(d);
    this.db = d;
    return d;
  }

  async init(): Promise<void> { this.raw(); }

  private inTx(): boolean { return this.als.getStore()?.active === true; }

  /** Runs one synchronous call on the connection, waiting first if a transaction of another request holds it. */
  private async run<T>(fn: (d: DatabaseSync) => T): Promise<T> {
    if (this.inTx() || !this.gate.isLocked) return fn(this.raw());
    await this.gate.acquire();
    try { return fn(this.raw()); } finally { this.gate.release(); }
  }

  prepare(sql: string): Statement {
    return {
      get: (...params: SqlParam[]) => this.run((d) => d.prepare(sql).get(...params) as Row | undefined),
      all: (...params: SqlParam[]) => this.run((d) => d.prepare(sql).all(...params) as Row[]),
      run: (...params: SqlParam[]) => this.run((d): RunResult => ({ changes: Number(d.prepare(sql).run(...params).changes) })),
    };
  }

  exec(sql: string): Promise<void> {
    return this.run((d) => { d.exec(sql); });
  }

  /**
   * معاملة واحدة بـ BEGIN IMMEDIATE (قفل كتابة من البداية). المعاملات المتداخلة تنضم للمعاملة الخارجية.
   * التعارض بين المراجعين يُكشف بـ version.
   */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTx()) return fn();
    await this.gate.acquire();
    const token: TxToken = { active: true };
    let d: DatabaseSync;
    try {
      d = this.raw();
      d.exec('BEGIN IMMEDIATE');
    } catch (e) {
      token.active = false;
      this.gate.release();
      throw e;
    }
    try {
      const result = await this.als.run(token, fn);
      d.exec('COMMIT');
      return result;
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* no active tx */ }
      throw e;
    } finally {
      token.active = false;
      this.gate.release();
    }
  }

  outsideTx<T>(fn: () => T): T { return this.als.exit(fn); }

  async schemaVersion(): Promise<number> {
    const r = await this.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    return Number(r?.v ?? 0);
  }

  async close(): Promise<void> {
    if (this.db) {
      try { this.db.close(); } catch { /* already closed */ }
      this.db = null;
    }
  }
}
