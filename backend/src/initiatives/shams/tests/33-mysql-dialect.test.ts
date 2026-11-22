// SQLite → MySQL statement translation (src/db/mysqlDialect.ts). Pure unit tests (no database) — they run in both modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateSql, stripInternalColumns, UntranslatedSqlError } from '../../../core/db/mysqlDialect.js';
import { splitSqlStatements, adaptForServer, assertSupportedServer } from '../../../core/db/migrate.js';

test('D-1 insert-or-ignore and ON CONFLICT DO NOTHING become a plain INSERT whose duplicate-key error means "nothing inserted"', () => {
  const a = translateSql('INSERT OR IGNORE INTO notification_outbox (id, dedupeKey) VALUES (?, ?)');
  assert.equal(a.sql, 'INSERT INTO notification_outbox (id, dedupeKey) VALUES (?, ?)');
  assert.equal(a.ignoreDuplicate, true);
  const b = translateSql('INSERT INTO shams_application_counters (year, lastSeq) VALUES (?, 0) ON CONFLICT(year) DO NOTHING');
  assert.equal(b.sql, 'INSERT INTO shams_application_counters (year, lastSeq) VALUES (?, 0)');
  assert.equal(b.ignoreDuplicate, true);
  assert.doesNotMatch(a.sql + b.sql, /IGNORE/, 'never MySQL INSERT IGNORE (it would also swallow CHECK / FK violations)');
});

test('D-2 ON CONFLICT DO UPDATE becomes ON DUPLICATE KEY UPDATE, excluded.x → VALUES(x), and other expressions are kept', () => {
  const t = translateSql(`INSERT INTO shams_application_data (id, data, updatedAt) VALUES (?, ?, ?)
    ON CONFLICT(applicationId, section, attempt) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt`);
  assert.match(t.sql, /ON DUPLICATE KEY UPDATE data = VALUES\(data\), updatedAt = VALUES\(updatedAt\)$/);
  assert.equal(t.ignoreDuplicate, false);
  const c = translateSql('INSERT INTO shams_integration_auth_failures (ip, windowStart, count) VALUES (?, ?, 1) ON CONFLICT(ip, windowStart) DO UPDATE SET count = count + 1');
  assert.match(c.sql, /ON DUPLICATE KEY UPDATE count = count \+ 1$/);
  const k = translateSql('INSERT INTO login_throttle (`key`, failures) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET failures = excluded.failures');
  assert.match(k.sql, /\(`key`, failures\) VALUES \(\?, \?\) ON DUPLICATE KEY UPDATE failures = VALUES\(failures\)$/);
});

test('D-3 rowid → _seq, COLLATE NOCASE dropped (case-insensitive column), the +col planner hint removed', () => {
  assert.equal(translateSql('SELECT * FROM t WHERE a = ? ORDER BY createdAt, rowid').sql, 'SELECT * FROM t WHERE a = ? ORDER BY createdAt, _seq');
  assert.equal(translateSql('SELECT 1 FROM t tr ORDER BY tr.createdAt DESC, tr.rowid DESC').sql, 'SELECT 1 FROM t tr ORDER BY tr.createdAt DESC, tr._seq DESC');
  assert.equal(translateSql('SELECT * FROM users u WHERE u.email = ? COLLATE NOCASE').sql, 'SELECT * FROM users u WHERE u.email = ?');
  // MySQL would read `+toState` as a numeric cast: 'IMC_REVIEW' → 0 = 0 for every row
  assert.equal(translateSql('SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND +toState = ? AND fromState <> toState LIMIT 1').sql,
    'SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND toState = ? AND fromState <> toState LIMIT 1');
  assert.equal(translateSql('SELECT attempts + 1 AS n FROM t').sql, 'SELECT attempts + 1 AS n FROM t', 'arithmetic is untouched');
});

test("D-4 LIKE stays case-insensitive and the ESCAPE '\\' literal is doubled for MySQL", () => {
  const t = translateSql("SELECT * FROM shams_applications a WHERE (a.number LIKE ? ESCAPE '\\' OR a.companyName LIKE ? ESCAPE '\\')");
  assert.equal(t.sql, "SELECT * FROM shams_applications a WHERE (LOWER(a.number) LIKE LOWER(?) ESCAPE '\\\\' OR LOWER(a.companyName) LIKE LOWER(?) ESCAPE '\\\\')");
});

test('D-5 SQLite-only constructs that have no translation are refused, never sent to MySQL', () => {
  for (const sql of [
    "SELECT julianday(a) - julianday(b) FROM t", "SELECT strftime('%Y', at) FROM t", 'SELECT lower(hex(randomblob(16)))',
    'PRAGMA foreign_keys = ON', "SELECT name FROM sqlite_master", 'INSERT OR REPLACE INTO t (a) VALUES (1)',
    'SELECT * FROM t WHERE a = "x"', "SELECT iif(a, 1, 0) FROM t", 'SELECT * FROM t WHERE a GLOB ?',
  ]) {
    assert.throws(() => translateSql(sql), UntranslatedSqlError, sql);
  }
});

test('D-6 MySQL-only columns (_seq and the generated unique-flag columns) never leave the driver', () => {
  assert.deepEqual(stripInternalColumns({ id: 'a', _seq: 3, _openFactory: 1, state: 'DRAFT' }), { id: 'a', state: 'DRAFT' });
});

test('D-7 migration files: DELIMITER blocks, MariaDB collation mapping (tests only), server version gate, DB_CLIENT values', () => {
  const parts = splitSqlStatements(`-- c1
CREATE TABLE a (x INT);
DELIMITER //
CREATE TRIGGER t BEFORE DELETE ON a FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'no';
END//
DELIMITER ;
INSERT INTO a VALUES (1);
-- trailing comment;
`);
  assert.equal(parts.length, 3);
  assert.match(parts[1], /^CREATE TRIGGER t[\s\S]*SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'no';\nEND$/);
  assert.equal(adaptForServer('COLLATE utf8mb4_0900_bin x utf8mb4_0900_as_ci', { version: '10.4.32-MariaDB', isMariaDb: true }), 'COLLATE utf8mb4_nopad_bin x utf8mb4_unicode_nopad_ci');
  assert.equal(adaptForServer('COLLATE utf8mb4_0900_bin', { version: '8.4.3', isMariaDb: false }), 'COLLATE utf8mb4_0900_bin');
  assert.doesNotThrow(() => assertSupportedServer({ version: '8.4.3', isMariaDb: false }));
  assert.doesNotThrow(() => assertSupportedServer({ version: '8.0.16', isMariaDb: false }));
  assert.throws(() => assertSupportedServer({ version: '8.0.15', isMariaDb: false }), /CHECK constraints/);
  assert.throws(() => assertSupportedServer({ version: '5.7.44-log', isMariaDb: false }), /too old/);
  const allow = process.env.MYSQL_ALLOW_MARIADB;
  delete process.env.MYSQL_ALLOW_MARIADB;
  try { assert.throws(() => assertSupportedServer({ version: '10.4.32-MariaDB', isMariaDb: true }), /not a supported production server/); }
  finally { if (allow !== undefined) process.env.MYSQL_ALLOW_MARIADB = allow; }
});
