/**
 * SQLite → MySQL translation of the statements the stores issue.
 *
 * The application SQL is written once, in SQLite syntax (it is the development/test engine and its SQL stays byte-identical).
 * Only a small, closed set of constructs differs; each one is rewritten here and covered by tests/33-mysql-dialect.test.ts.
 * Anything else that is SQLite-only is refused loudly (UntranslatedSqlError) instead of being sent to MySQL and silently
 * meaning something different — e.g. the planner hint `+toState`, which MySQL would read as a numeric cast that matches
 * every row.
 *
 *  SQLite                                   MySQL
 *  INSERT OR IGNORE INTO …                  INSERT INTO …            (+ duplicate-key error → 0 changes)
 *  … ON CONFLICT(cols) DO NOTHING           (removed)                (+ duplicate-key error → 0 changes)
 *  … ON CONFLICT(cols) DO UPDATE SET        … ON DUPLICATE KEY UPDATE, and excluded.col → VALUES(col)
 *  rowid / t.rowid                          _seq / t._seq            (AUTO_INCREMENT insertion order, filled from rowid on import)
 *  x = ? COLLATE NOCASE                     x = ?                    (the column itself has a case-insensitive collation)
 *  AND +col = ?   (planner hint)            AND col = ?
 *  sensitive, key (column names)            `sensitive`, `key`       (reserved words in MySQL)
 *  col LIKE ?                               LOWER(col) LIKE LOWER(?) (SQLite LIKE is case-insensitive; the MySQL columns
 *                                                                    use a binary collation, like SQLite's comparisons)
 *  ESCAPE '\'                               ESCAPE '\\'              (a backslash literal must be doubled in MySQL's default
 *                                                                    sql_mode; NO_BACKSLASH_ESCAPES is not an option: the
 *                                                                    client escapes parameter values with backslashes)
 *
 * Duplicate-key handling deliberately avoids MySQL's `INSERT IGNORE`, which would also turn CHECK, NOT NULL and foreign-key
 * violations into warnings and drop the row silently.
 */

export interface TranslatedSql {
  sql: string;
  /** The statement was an insert-or-ignore: a duplicate-key error (ER_DUP_ENTRY) means "nothing inserted". */
  ignoreDuplicate: boolean;
}

export class UntranslatedSqlError extends Error {
  constructor(token: string, sql: string) {
    super(`[mysql] SQLite-only construct "${token}" has no MySQL translation: ${sql.replace(/\s+/g, ' ').slice(0, 300)}`);
    this.name = 'UntranslatedSqlError';
  }
}

/** SQLite constructs that must never reach MySQL untranslated. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bjulianday\s*\(/i, 'julianday()'],
  [/\bstrftime\s*\(/i, 'strftime()'],
  [/\bdatetime\s*\(/i, 'datetime()'],
  [/\brandomblob\s*\(/i, 'randomblob()'],
  [/\bjson_group_array\s*\(/i, 'json_group_array()'],
  [/\biif\s*\(/i, 'iif()'],
  [/\bGLOB\b/i, 'GLOB'],
  [/\bPRAGMA\b/i, 'PRAGMA'],
  [/\bsqlite_master\b/i, 'sqlite_master'],
  [/\bON\s+CONFLICT\b/i, 'ON CONFLICT'],
  [/\bOR\s+(IGNORE|REPLACE|ABORT|FAIL|ROLLBACK)\b/i, 'INSERT OR …'],
  [/\bexcluded\./i, 'excluded.'],
  [/\bCOLLATE\s+NOCASE\b/i, 'COLLATE NOCASE'],
  [/\browid\b/i, 'rowid'],
  [/\b(AND|OR|WHERE|ON|NOT)\s+\+[A-Za-z_]/i, 'unary + planner hint'],
  [/"/, 'double-quoted identifier/string'],
];

const cache = new Map<string, TranslatedSql>();

export function translateSql(input: string): TranslatedSql {
  const hit = cache.get(input);
  if (hit) return hit;
  let sql = input;
  let ignoreDuplicate = false;

  if (/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) {
    sql = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
    ignoreDuplicate = true;
  }
  if (/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+NOTHING\b/i.test(sql)) {
    sql = sql.replace(/\s*\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+NOTHING\b/i, '');
    ignoreDuplicate = true;
  }
  if (/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/i.test(sql)) {
    sql = sql.replace(/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/i, 'ON DUPLICATE KEY UPDATE');
    sql = sql.replace(/\bexcluded\.(\w+)/gi, 'VALUES($1)');
  }
  sql = sql.replace(/\b(\w+\.)?rowid\b/gi, (_m, alias: string | undefined) => `${alias ?? ''}_seq`);
  sql = sql.replace(/\s+COLLATE\s+NOCASE\b/gi, '');
  // Column names that are reserved words in MySQL (lower-case exact, so the KEY of ON DUPLICATE KEY is untouched;
  // already-quoted names are left alone).
  sql = sql.replace(/(?<![`\w.])(sensitive|key)(?![`\w(])/g, '`$1`');
  sql = sql.replace(/\b(AND|OR|WHERE|ON|NOT)(\s+)\+(?=[A-Za-z_])/gi, '$1$2');
  sql = sql.replace(/([A-Za-z_][\w.]*)\s+LIKE\s+\?/g, 'LOWER($1) LIKE LOWER(?)');
  sql = sql.replace(/\bESCAPE\s+'\\'/g, "ESCAPE '\\\\'");

  for (const [re, token] of FORBIDDEN) {
    if (re.test(sql)) throw new UntranslatedSqlError(token, input);
  }
  const out = { sql, ignoreDuplicate };
  if (cache.size < 2000) cache.set(input, out);
  return out;
}

/**
 * Columns that exist only in the MySQL schema (prefixed `_`): the `_seq` insertion order and the STORED generated columns
 * that emulate SQLite's partial unique indexes. They are stripped from every result row so `SELECT *` returns exactly the
 * columns the SQLite schema has (API responses and contracts stay identical).
 */
export function stripInternalColumns<T extends Record<string, unknown>>(row: T): T {
  for (const k of Object.keys(row)) if (k.startsWith('_')) delete row[k];
  return row;
}
