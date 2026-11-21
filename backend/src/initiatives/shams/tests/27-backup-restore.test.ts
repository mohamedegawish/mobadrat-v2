// Production-readiness: backup and restore drill with the real scripts (scripts/backup.mjs, scripts/restore.mjs) on synthetic
// data. The backup runs in its own process while another process keeps writing to the same database; the restore goes to a
// fresh location and is verified (integrity, row counts, files). A corrupted backup must be refused, never restored.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { isolateTestEnv, startServer, clients, advanceTo, type Started } from './helpers.js';

const env = isolateTestEnv('backup');
let srv: Started;
const script = (name: string) => path.join(process.cwd(), 'scripts', name);

before(async () => {
  srv = await startServer();
  const c = await clients(srv.base);
  await advanceTo('CONTRACT_OUTCOME', c, 'IND-BAK-1');
  await advanceTo('IMC_REVIEW', { ...c, factory: c.factory2 }, 'IND-BAK-2');
});
after(async () => { await srv.close(); await env.cleanup(); });

function counts(dbPath: string) {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const n = (t: string) => (d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    return { integrity: (d.prepare('PRAGMA integrity_check').get() as any).integrity_check, applications: n('applications'), transitions: n('application_transitions'), documents: n('documents'), triggers: n("sqlite_master WHERE type = 'trigger'") };
  } finally { d.close(); }
}

test('BK-1 backup taken while another process writes, restored to a fresh location: consistent database and every document file', async () => {
  const out = path.join(env.dir, 'backup-1');
  // a second process appends audit rows continuously during the backup (append-only table, realistic write load)
  const writer = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(process.env.DB_PATH); d.exec('PRAGMA busy_timeout = 5000');
    const ins = d.prepare("INSERT INTO audit_logs (id, at, actorType, action, entityType, summaryAr) VALUES (?, ?, 'system', 'bk.writer', 'test', 'x')");
    let i = 0; const until = Date.now() + 3000; process.send('started');
    (function loop() { if (Date.now() > until) { process.send(i); process.exit(0); } for (let k = 0; k < 50; k++) ins.run('bk-' + (i++), new Date().toISOString()); setImmediate(loop); })();`],
  { env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  await new Promise((r) => writer.once('message', r));
  const b = spawnSync(process.execPath, [script('backup.mjs'), out], { env: process.env, encoding: 'utf8' });
  const written = await new Promise<number>((r) => writer.once('message', (m) => r(Number(m))));
  assert.equal(b.status, 0, b.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.method, 'vacuum_into', 'atomic snapshot, not a file copy');
  assert.ok(written > 0, 'the writer really wrote during the backup');
  const snap = counts(path.join(out, manifest.outDb));
  assert.equal(snap.integrity, 'ok');
  assert.ok(snap.triggers >= 7, 'history guards (006) and audit guards are in the backup');

  const target = path.join(env.dir, 'restored');
  fs.mkdirSync(target);
  const r = spawnSync(process.execPath, [script('restore.mjs'), out], { env: { ...process.env, DB_PATH: path.join(target, 'app.db'), UPLOAD_DIR: path.join(target, 'uploads') }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const restored = counts(path.join(target, 'app.db'));
  assert.deepEqual(restored, snap);
  const d = new DatabaseSync(path.join(target, 'app.db'), { readOnly: true });
  const stored = (d.prepare('SELECT storedName FROM documents').all() as Array<{ storedName: string }>).map((x) => x.storedName);
  d.close();
  for (const s of stored) assert.ok(fs.existsSync(path.join(target, 'uploads', 'documents', s)), `document file ${s} restored`);
});

test('BK-2 a corrupted backup is refused and the live database is left untouched', async () => {
  const out = path.join(env.dir, 'backup-2');
  assert.equal(spawnSync(process.execPath, [script('backup.mjs'), out], { env: process.env }).status, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const file = path.join(out, manifest.outDb);
  // subtle, deterministic damage: the schema of one index is redefined without rebuilding its b-tree. The file opens and
  // ordinary queries (even on sqlite_master) still work, but `PRAGMA integrity_check` reports missing index entries —
  // the case a restore must catch.
  const w = new DatabaseSync(file, { defensive: false } as never); // node:sqlite is defensive by default (blocks writable_schema)
  try {
    w.exec('PRAGMA writable_schema = ON');
    w.exec("UPDATE sqlite_master SET sql = replace(sql, 'audit_logs(at DESC)', 'audit_logs(actorType)') WHERE name = 'idx_audit_at'");
  } finally { w.close(); }
  const chk = new DatabaseSync(file, { readOnly: true });
  let tables = 0; let report: string[] = [];
  try {
    tables = (chk.prepare('SELECT COUNT(*) AS c FROM sqlite_master').get() as { c: number }).c;
    report = (chk.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>).map((r) => r.integrity_check);
  } finally { chk.close(); }
  assert.ok(tables >= 5, 'the damaged backup still opens and reads its schema');
  assert.notDeepEqual(report, ['ok'], 'and integrity_check reports the damage');
  const target = path.join(env.dir, 'live-2');
  fs.mkdirSync(target);
  const live = path.join(target, 'app.db');
  fs.copyFileSync(path.join(env.dir, 'backup-1', manifest.outDb), live);
  const before_ = fs.readFileSync(live);
  const r = spawnSync(process.execPath, [script('restore.mjs'), out], { env: { ...process.env, DB_PATH: live, UPLOAD_DIR: path.join(target, 'uploads') }, encoding: 'utf8' });
  assert.notEqual(r.status, 0, `restore accepted a corrupted backup: ${r.stdout}`);
  assert.match(r.stderr, /integrity/i);
  assert.ok(fs.readFileSync(live).equals(before_), 'live database unchanged');
});
