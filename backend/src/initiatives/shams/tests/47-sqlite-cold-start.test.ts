// Several server processes starting together on ONE fresh SQLite file (multi-process setup, or a deploy with a pending
// migration such as 011): every process must come up, and every migration must be applied exactly once.
// Found in the final verification of the contracting paths: before the fix, a starting process could fail with
// "database is locked" (journal_mode switched to WAL before busy_timeout was set) or re-run a migration another process had
// just applied ("table … already exists" / duplicate schema_migrations row), because the applied set was read before the lock.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { onMysql } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shams-coldstart-'));
after(() => fs.rmSync(work, { recursive: true, force: true }));
const migrationCount = fs.readdirSync(path.join(root, 'src', 'db', 'migrations')).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).length;

// The child opens the database exactly like the server does (SqliteDatabase.raw(): pragmas + runner).
const CHILD = `
import(${JSON.stringify(new URL('../src/db/sqliteDriver.ts', import.meta.url).href)}).then(({ SqliteDatabase }) => {
  try { new SqliteDatabase(process.env.COLD_DB).raw(); process.stdout.write('ok'); process.exit(0); }
  catch (e) { process.stdout.write('FAIL ' + String(e && e.message).split('\\n')[0]); process.exit(1); }
});`;

function start(db: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--import', 'tsx', '-e', CHILD], { cwd: root, env: { ...process.env, COLD_DB: db } });
    let out = ''; let err = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { err += b; });
    p.on('close', (code) => resolve({ code, out: out || `STDERR ${err.split('\n').find((l) => /Error|locked|busy/i.test(l)) ?? err.slice(0, 200)}` }));
  });
}

test('COLD-1 three processes starting together on a fresh SQLite file all come up; each migration is applied once', { skip: onMysql ? 'SQLite runner only' : false }, async () => {
  for (let round = 1; round <= 3; round++) {
    const db = path.join(work, `round-${round}.db`);
    const results = await Promise.all([start(db), start(db), start(db)]);
    assert.ok(results.every((r) => r.code === 0), `round ${round}: ${results.map((r) => r.out).join(' | ')}`);
    const d = new DatabaseSync(db, { readOnly: true });
    try {
      const m = d.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT version) AS u FROM schema_migrations').get() as { n: number; u: number };
      assert.equal(m.n, migrationCount, `round ${round}: every migration recorded once`);
      assert.equal(m.u, migrationCount);
      assert.equal((d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
      assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0);
      assert.equal((d.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    } finally { d.close(); }
  }
});
