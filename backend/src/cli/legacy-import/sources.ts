/**
 * Read-only access to the legacy databases. SQLite sources are never opened in place: the `.db` and its `-wal`/`-shm`
 * companions are copied into the report folder first (the WAL of a live app holds the newest rows), and the copy is read.
 * A MySQL source (Shams in production) is read inside one consistent-snapshot, read-only transaction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import mysql from 'mysql2/promise';

export type Row = Record<string, unknown>;
export type SourceName = 'shams' | 'sona3' | 'platform';

export interface SourceDb {
  name: SourceName;
  kind: 'sqlite' | 'mysql';
  location: string;
  fingerprint: string;
  schemaVersion: number | null;
  /** Integrity problems found while opening (fatal). */
  problems: string[];
  tables(): Promise<string[]>;
  /** Stored (non-generated) columns, without MySQL ordering helpers (`_seq`). */
  columns(table: string): Promise<string[]>;
  primaryKey(table: string): Promise<string[]>;
  /** Columns declared as a foreign key to users(id). */
  userFkColumns(table: string): Promise<string[]>;
  /** All rows of the table in insertion order (stored columns only). */
  rows(table: string): Promise<Row[]>;
  close(): Promise<void>;
}

const sha256File = (p: string) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Copies `<db>`, `<db>-wal`, `<db>-shm` into `snapDir` and opens the copy. */
export function openSqliteSource(name: SourceName, dbPath: string, snapDir: string): SourceDb {
  if (!fs.existsSync(dbPath)) throw new Error(`[${name}] database not found: ${dbPath}`);
  const problems: string[] = [];
  const wal = `${dbPath}-wal`;
  const shm = `${dbPath}-shm`;
  if (fs.existsSync(shm) && !fs.existsSync(wal)) {
    problems.push(`${dbPath}-shm exists without its -wal: the database may have been copied while the app was writing. Copy the .db together with its -wal and -shm, with the app stopped.`);
  }
  fs.mkdirSync(snapDir, { recursive: true });
  const target = path.join(snapDir, 'app.db');
  for (const f of [target, `${target}-wal`, `${target}-shm`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(dbPath, target);
  if (fs.existsSync(wal)) fs.copyFileSync(wal, `${target}-wal`);
  if (fs.existsSync(shm)) fs.copyFileSync(shm, `${target}-shm`);
  const fp = createHash('sha256').update(sha256File(dbPath)).update(fs.existsSync(wal) ? sha256File(wal) : '').digest('hex');

  const db = new DatabaseSync(target);
  const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') problems.push(`integrity_check: ${integrity.map((r) => r.integrity_check).join('; ')}`);
  const fk = db.prepare('PRAGMA foreign_key_check').all() as Array<{ table: string; rowid: number; parent: string }>;
  for (const v of fk.slice(0, 20)) problems.push(`foreign key violation: ${v.table} rowid ${v.rowid} → ${v.parent}`);
  if (fk.length > 20) problems.push(`… ${fk.length - 20} more foreign key violations`);
  let schemaVersion: number | null = null;
  try { schemaVersion = Number((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0); } catch { schemaVersion = null; }

  const hasRowid = new Map<string, boolean>();
  return {
    name, kind: 'sqlite', location: dbPath, fingerprint: fp, schemaVersion, problems,
    async tables() {
      return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    },
    async columns(t) {
      return (db.prepare(`PRAGMA table_xinfo(${q(t)})`).all() as Array<{ name: string; hidden: number }>).filter((c) => c.hidden === 0).map((c) => c.name);
    },
    async primaryKey(t) {
      return (db.prepare(`PRAGMA table_info(${q(t)})`).all() as Array<{ name: string; pk: number }>).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    },
    async userFkColumns(t) {
      return (db.prepare(`PRAGMA foreign_key_list(${q(t)})`).all() as Array<{ table: string; from: string }>).filter((f) => f.table === 'users').map((f) => f.from);
    },
    async rows(t) {
      const cols = await this.columns(t);
      const sel = cols.map(q).join(', ');
      if (!hasRowid.has(t)) {
        try { db.prepare(`SELECT rowid FROM ${q(t)} LIMIT 1`).all(); hasRowid.set(t, true); } catch { hasRowid.set(t, false); }
      }
      const order = hasRowid.get(t) ? 'rowid' : ((await this.primaryKey(t)).map(q).join(', ') || '1');
      return (db.prepare(`SELECT ${sel} FROM ${q(t)} ORDER BY ${order}`).all() as Row[]).map((r) => ({ ...r }));
    },
    async close() { db.close(); },
  };
}

/** Opens a MySQL source (e.g. Shams in production) inside one consistent read-only snapshot. */
export async function openMysqlSource(name: SourceName, url: string): Promise<SourceDb> {
  const u = new URL(url);
  if (u.protocol !== 'mysql:') throw new Error(`[${name}] expected a mysql:// URL`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const conn = await mysql.createConnection({
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database,
    dateStrings: true, supportBigNumbers: true, decimalNumbers: true, charset: 'utf8mb4',
  });
  await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const all = async <T>(sql: string, params: unknown[] = []) => (await conn.query(sql, params))[0] as T[];
  const colInfo = await all<{ TABLE_NAME: string; COLUMN_NAME: string; EXTRA: string; COLUMN_KEY: string; ORDINAL_POSITION: number }>(
    'SELECT TABLE_NAME, COLUMN_NAME, EXTRA, COLUMN_KEY, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [database]);
  const fks = await all<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = 'users'", [database]);
  const pks = await all<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION", [database]);
  const tableNames = (await all<{ TABLE_NAME: string }>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", [database])).map((r) => r.TABLE_NAME);
  const generated = (extra: string) => /VIRTUAL GENERATED|STORED GENERATED/i.test(extra);
  let schemaVersion: number | null = null;
  try { schemaVersion = Number((await all<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations'))[0]?.v ?? 0); } catch { schemaVersion = null; }

  // Fingerprint: every stored row of every table, in a stable order (the snapshot is consistent).
  const hash = createHash('sha256');
  const rowsCache = new Map<string, Row[]>();
  const src: SourceDb = {
    name, kind: 'mysql', location: `${u.hostname}:${u.port || 3306}/${database}`, fingerprint: '', schemaVersion, problems: [],
    async tables() { return tableNames; },
    async columns(t) { return colInfo.filter((c) => c.TABLE_NAME === t && !generated(c.EXTRA) && c.COLUMN_NAME !== '_seq').map((c) => c.COLUMN_NAME); },
    async primaryKey(t) { return pks.filter((p) => p.TABLE_NAME === t).map((p) => p.COLUMN_NAME); },
    async userFkColumns(t) { return fks.filter((f) => f.TABLE_NAME === t).map((f) => f.COLUMN_NAME); },
    async rows(t) {
      const cached = rowsCache.get(t);
      if (cached) return cached;
      const cols = await this.columns(t);
      const hasSeq = colInfo.some((c) => c.TABLE_NAME === t && c.COLUMN_NAME === '_seq');
      const pk = await this.primaryKey(t);
      const order = hasSeq ? '`_seq`' : (pk.map((c) => `\`${c}\``).join(', ') || '1');
      const rows = (await all<Row>(`SELECT ${cols.map((c) => `\`${c}\``).join(', ')} FROM \`${t}\` ORDER BY ${order}`)).map((r) => ({ ...r }));
      rowsCache.set(t, rows);
      return rows;
    },
    async close() { await conn.query('COMMIT'); await conn.end(); },
  };
  for (const t of tableNames) hash.update(t).update(JSON.stringify(await src.rows(t)));
  src.fingerprint = hash.digest('hex');
  return src;
}
