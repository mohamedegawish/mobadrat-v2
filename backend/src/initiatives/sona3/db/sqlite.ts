import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

let db: DatabaseSync | null = null;
let txDepth = 0;

/** يفتح قاعدة البيانات (singleton) ويطبق migrations المرقمة الناقصة. */
export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    try { db.close(); } catch { /* already closed */ }
    db = null;
  }
}

/**
 * معاملة واحدة بـ BEGIN IMMEDIATE (قفل كتابة من البداية). node:sqlite متزامن،
 * فلا يتداخل طلبان داخل نفس المعاملة؛ التعارض بين المراجعين يُكشف بـ version.
 * المعاملات المتداخلة تنضم للمعاملة الخارجية.
 */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  if (txDepth > 0) return fn();
  d.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* no active tx */ }
    throw e;
  } finally {
    txDepth--;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

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
    d.exec('BEGIN IMMEDIATE');
    try {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)').run(version, file, nowIso());
      d.exec('COMMIT');
      ran.push(file);
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(`[migrate] ${file} failed: ${(e as Error).message}`);
    }
  }
  return ran;
}
