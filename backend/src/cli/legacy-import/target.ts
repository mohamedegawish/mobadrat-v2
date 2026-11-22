/**
 * The target platform database: one dedicated connection, one transaction for the whole import (rolled back on any
 * error or in --dry-run). Foreign keys are checked by the import itself after loading (every FK of the schema), so the
 * load order does not matter.
 */
import mysql from 'mysql2/promise';
import { config } from '../../config.js';
import type { Row } from './sources.js';

export interface TargetColumn { name: string; nullable: boolean; hasDefault: boolean }

export class Target {
  private columnsCache = new Map<string, TargetColumn[]>();
  private constructor(readonly conn: mysql.Connection, readonly database: string) {}

  static async open(): Promise<Target> {
    const m = config.mysql;
    const conn = await mysql.createConnection({
      host: m.host, port: m.port, user: m.user, password: m.password, database: m.database,
      dateStrings: true, supportBigNumbers: true, decimalNumbers: true, charset: 'utf8mb4', multipleStatements: false,
    });
    await conn.query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_ALL_TABLES')");
    return new Target(conn, m.database);
  }

  async all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.conn.query(sql, params))[0] as T[];
  }

  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.all<T>(sql, params))[0];
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const [r] = await this.conn.query(sql, params);
    return Number((r as mysql.ResultSetHeader).affectedRows ?? 0);
  }

  async tableExists(table: string): Promise<boolean> {
    return (await this.columns(table)).length > 0;
  }

  /** Insertable columns (generated columns and the `_seq` ordering column are filled by MySQL). */
  async columns(table: string): Promise<TargetColumn[]> {
    const hit = this.columnsCache.get(table);
    if (hit) return hit;
    const rows = await this.all<{ COLUMN_NAME: string; IS_NULLABLE: string; COLUMN_DEFAULT: string | null; EXTRA: string }>(
      'SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [this.database, table]);
    const cols = rows
      .filter((c) => !/VIRTUAL GENERATED|STORED GENERATED/i.test(c.EXTRA) && c.COLUMN_NAME !== '_seq')
      .map((c) => ({ name: c.COLUMN_NAME, nullable: c.IS_NULLABLE === 'YES', hasDefault: c.COLUMN_DEFAULT !== null || /DEFAULT_GENERATED|auto_increment/i.test(c.EXTRA) }));
    this.columnsCache.set(table, cols);
    return cols;
  }

  async count(table: string): Promise<number> {
    return Number((await this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${table}\``))?.n ?? 0);
  }

  /** Multi-row INSERT in batches; `upsert` replaces the given columns of an existing row with the same key. */
  async insert(table: string, cols: string[], rows: Row[], opts: { upsert?: boolean } = {}): Promise<number> {
    if (!rows.length) return 0;
    const colSql = cols.map((c) => `\`${c}\``).join(', ');
    const update = opts.upsert ? ` ON DUPLICATE KEY UPDATE ${cols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}` : '';
    let affected = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const ph = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
      const params = chunk.flatMap((r) => cols.map((c) => toParam(r[c])));
      affected += await this.exec(`INSERT INTO \`${table}\` (${colSql}) VALUES ${ph}${update}`, params);
    }
    return affected;
  }

  /** Every foreign key of the schema whose child value has no parent row. */
  async foreignKeyViolations(): Promise<Array<{ constraint: string; table: string; columns: string[]; parent: string; orphans: number }>> {
    const fks = await this.all<{ CONSTRAINT_NAME: string; TABLE_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string }>(
      `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`, [this.database]);
    const groups = new Map<string, typeof fks>();
    for (const f of fks) groups.set(`${f.TABLE_NAME}|${f.CONSTRAINT_NAME}`, [...(groups.get(`${f.TABLE_NAME}|${f.CONSTRAINT_NAME}`) ?? []), f]);
    const out = [];
    for (const g of groups.values()) {
      const child = g[0].TABLE_NAME;
      const parent = g[0].REFERENCED_TABLE_NAME;
      const join = g.map((f) => `p.\`${f.REFERENCED_COLUMN_NAME}\` = c.\`${f.COLUMN_NAME}\``).join(' AND ');
      const notNull = g.map((f) => `c.\`${f.COLUMN_NAME}\` IS NOT NULL`).join(' AND ');
      const n = Number((await this.one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM \`${child}\` c LEFT JOIN \`${parent}\` p ON ${join} WHERE ${notNull} AND p.\`${g[0].REFERENCED_COLUMN_NAME}\` IS NULL`))?.n ?? 0);
      if (n) out.push({ constraint: g[0].CONSTRAINT_NAME, table: child, columns: g.map((f) => f.COLUMN_NAME), parent, orphans: n });
    }
    return out;
  }

  async close(): Promise<void> { await this.conn.end(); }
}

export function toParam(v: unknown): string | number | null | Buffer {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return v as string | number;
}

/** Comparable text form of a stored value (SQLite and MySQL return numbers/strings differently). */
export function norm(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) && s.length < 16 ? String(Number(s)) : s;
}
