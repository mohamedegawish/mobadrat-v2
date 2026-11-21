// SQLite → MySQL import (src/cli/migrateSqliteToMysql.ts). MySQL only (npm run test:mysql): a child process builds a real SQLite
// database through the HTTP API; it is imported into this file's MySQL database; then the application serves it from MySQL:
// the same applications, history, documents and accounts, and the workflow continues on the imported data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isolateTestEnv, startServer, clients, act, getApp, q, onMysql, type Started } from './helpers.js';

const SKIP = onMysql ? false : 'MySQL only (npm run test:mysql): imports a SQLite file into MySQL';
const root = path.resolve(import.meta.dirname, '..');
/** The latest schema version — derived from the migration files, so the test does not go stale with each new migration. */
const LATEST = Math.max(...fs.readdirSync(path.join(root, 'src', 'db', 'migrations')).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).map((f) => Number(f.slice(0, 3))));
const env = isolateTestEnv('import');
let fixture: { dir: string; dbPath: string; uploadDir: string; contracted: string; inReview: string };
let srv: Started | undefined;

before(async () => {
  if (SKIP) return;
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DB_CLIENT: 'sqlite' };
  delete childEnv.DATABASE_URL;
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'tests/mp/sqliteFixture.ts'], { cwd: root, env: childEnv, encoding: 'utf8', timeout: 180_000 });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  fixture = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
});
after(async () => {
  if (srv) await srv.close();
  await env.cleanup();
  if (fixture?.dir) fs.rmSync(fixture.dir, { recursive: true, force: true });
});

const sqliteCount = (t: string) => {
  const d = new DatabaseSync(fixture.dbPath, { readOnly: true });
  try { return Number((d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n); } finally { d.close(); }
};

test('IMP-1 refuses a target that is not empty, a missing file, and an older SQLite schema — and writes nothing', { skip: SKIP }, async () => {
  const { importSqliteIntoMysql } = await import('../src/cli/migrateSqliteToMysql.js');
  await assert.rejects(importSqliteIntoMysql(path.join(fixture.dir, 'nope.db'), { dryRun: false, log: () => {} }), /not found/);
  // an older SQLite schema (one migration behind the latest) is refused before anything is copied
  const old = path.join(fixture.dir, 'old.db');
  fs.copyFileSync(fixture.dbPath, old);
  const d = new DatabaseSync(old);
  d.prepare('DELETE FROM schema_migrations WHERE version = ?').run(LATEST);
  d.close();
  await assert.rejects(importSqliteIntoMysql(old, { dryRun: false, log: () => {} }), new RegExp(`schema versions differ: SQLite file v${LATEST - 1}, MySQL v${LATEST}`));
  // a non-empty target: the seed of this process (startServer) is not run yet, so make it non-empty explicitly
  const { getDb, initDb } = await import('../src/db/sqlite.js');
  await initDb();
  await getDb().prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('org-bank-x', 'bank', 'بنك', 'Bank', 'a', 'a')").run();
  await assert.rejects(importSqliteIntoMysql(fixture.dbPath, { dryRun: false, log: () => {} }), /not empty/);
  await getDb().prepare("DELETE FROM organizations WHERE id = 'org-bank-x'").run();
  assert.equal((await q('SELECT 1 FROM applications')).length, 0, 'nothing imported');
});

test('IMP-2 dry run verifies everything and leaves MySQL unchanged; the real import copies every row exactly', { skip: SKIP }, async () => {
  const { importSqliteIntoMysql } = await import('../src/cli/migrateSqliteToMysql.js');
  const dry = await importSqliteIntoMysql(fixture.dbPath, { dryRun: true, log: () => {} });
  assert.equal(dry.dryRun, true);
  assert.equal((await q('SELECT 1 FROM applications')).length, 0, 'dry run rolled back');

  const rep = await importSqliteIntoMysql(fixture.dbPath, { dryRun: false, log: () => {} });
  assert.equal(rep.schemaVersion, LATEST);
  assert.deepEqual(rep.tables.map((t) => t.checksum), dry.tables.map((t) => t.checksum), 'same content verified twice');
  for (const t of ['applications', 'application_transitions', 'documents', 'audit_logs', 'users', 'deficiencies', 'notification_outbox', 'application_data', 'bank_referrals']) {
    const row = rep.tables.find((x) => x.table === t)!;
    assert.ok(row, t);
    assert.equal(row.rows, sqliteCount(t), `${t} row count`);
    assert.equal(Number((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))[0].n), sqliteCount(t), `${t} in MySQL`);
  }
  assert.ok(rep.tables.find((t) => t.table === 'application_transitions')!.rows > 10, 'a real history was imported');
  // a second import is refused: the target is no longer empty
  await assert.rejects(importSqliteIntoMysql(fixture.dbPath, { dryRun: false, log: () => {} }), /not empty/);
});

test('IMP-3 the application serves the imported data from MySQL and the workflow continues on it', { skip: SKIP }, async () => {
  process.env.UPLOAD_DIR = fixture.uploadDir; // the uploads stay where they are (same volume)
  const { closeDb } = await import('../src/db/sqlite.js');
  await closeDb();
  // the seed is idempotent (INSERT OR IGNORE): it must not change or duplicate imported rows
  srv = await startServer();
  const c = await clients(srv.base);
  const app = await getApp(c.factory, fixture.contracted);
  assert.equal(app.state, 'CONTRACTED');
  assert.ok(app.number?.startsWith('SHAMS-'));
  // a stored PDF is still served (file on the same volume, row imported)
  const contractDoc = (await getApp(c.pmu, fixture.contracted)).documents.find((d: { kind: string }) => d.kind === 'contractFile');
  assert.ok(contractDoc, 'contract evidence row imported');
  const file = await c.pmu.get(`/applications/${fixture.contracted}/documents/${contractDoc.id}/download`);
  assert.equal(file.status, 200);
  assert.ok(file.raw?.subarray(0, 5).toString() === '%PDF-', 'the original PDF bytes');
  // history order is preserved (rowid → _seq)
  const sqliteHist = (() => {
    const d = new DatabaseSync(fixture.dbPath, { readOnly: true });
    try { return (d.prepare('SELECT id FROM application_transitions WHERE applicationId = ? ORDER BY createdAt, rowid').all(fixture.contracted) as Array<{ id: string }>).map((r) => r.id); } finally { d.close(); }
  })();
  const mysqlHist = (await q<{ id: string }>('SELECT id FROM application_transitions WHERE applicationId = ? ORDER BY createdAt, rowid', fixture.contracted)).map((r) => r.id);
  assert.deepEqual(mysqlHist, sqliteHist);
  // the correction round continues: the factory of the second application sees its open deficiency and resubmits
  const second = await getApp(c.factory2, fixture.inReview);
  assert.equal(second.state, 'ENCPC_CORRECTION');
  assert.equal(second.currentTask.deficiencies.length, 1);
  // the imported unique rules hold: the factory still has an open application, so a second one is refused
  assert.equal((await c.factory2.post('/applications', {})).status, 409);
  // the first factory's application is closed, so it may start a new one — numbered after the imported ones
  const created = await c.factory.post('/applications', {});
  assert.equal(created.status, 201, JSON.stringify(created.json));
  void act;
});
