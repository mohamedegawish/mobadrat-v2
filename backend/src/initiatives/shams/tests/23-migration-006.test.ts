// Production-readiness: migration 006_history_guards on synthetic copies only (never a real database).
// A realistic database is produced by the real workflows (transitions, open and resolved deficiencies, a bank reassignment),
// then turned into a pre-006 copy (006 triggers dropped, schema row removed) and migrated with the real runner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isolateTestEnv, startServer, clients, act, advanceTo, pdfVariant, BANK_B, PROVIDER_OK, type Started } from './helpers.js';

const env = isolateTestEnv('mig006');
let srv: Started;
let pre006 = '';
const TRIGGERS = ['transitions_no_update', 'transitions_no_delete', 'referral_history_no_update', 'referral_history_no_delete', 'deficiencies_no_delete', 'deficiencies_immutable'];
const ROLLBACK_SQL = `${TRIGGERS.map((t) => `DROP TRIGGER IF EXISTS ${t};`).join('\n')}\nDELETE FROM schema_migrations WHERE version = 6;`;

before(async () => {
  srv = await startServer();
  const c = await clients(srv.base);
  const ok = (r: { status: number; json: unknown }, s: string) => assert.equal(r.status, 200, `${s}: ${JSON.stringify(r.json)}`);
  // factory 1: IMC correction resolved by resubmission, then the main path to the bank and a reassignment (referral history)
  const id = await advanceTo('IMC_REVIEW', c, 'IND-MIG-1');
  ok(await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان ناقص' }] }), 'correction');
  ok(await c.factory.put(`/applications/${id}/data/general`, { address: 'عنوان مصحح' }), 'fix');
  ok(await act(c.factory, id, 'resubmit'), 'resubmit');
  ok(await act(c.imc, id, 'accept'), 'imc');
  ok(await act(c.encpc, id, 'compliant'), 'encpc');
  ok(await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK }), 'provider');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('mig-offer'), 'o.pdf')).status, 201);
  ok(await act(c.factory, id, 'submit_offer'), 'offer');
  ok(await act(c.pmu, id, 'accept'), 'pmu offer');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('mig-el'), 'e.pdf')).status, 201);
  ok(await act(c.factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع' }), 'electricity');
  ok(await act(c.pmu, id, 'accept'), 'pmu electricity');
  ok(await act(c.factory, id, 'select_bank', { bankOrgId: BANK_B }), 'bank');
  // G-02: reassignment no longer exists, but historical bank_referral_history rows do — one is written the way the old code wrote it.
  {
    const { getDb } = await import('../src/db/sqlite.js');
    const tr = await getDb().prepare("SELECT id FROM application_transitions WHERE applicationId = ? AND action = 'select_bank'").get(id) as { id: string };
    await getDb().prepare(`INSERT INTO bank_referral_history (id, applicationId, bankOrgId, referredAt, referredBy, endedAt, endedBy, endReason, transitionId)
      VALUES ('rfh-legacy-mig', ?, 'org-bank-demo-a', '2026-01-01T00:00:00.000Z', NULL, '2026-01-02T00:00:00.000Z', NULL, 'إعادة إحالة تاريخية', ?)`).run(id, tr.id);
  }
  // factory 2: an open deficiency
  const c2 = { ...c, factory: c.factory2 };
  const id2 = await advanceTo('IMC_REVIEW', c2, 'IND-MIG-2');
  ok(await act(c.imc, id2, 'request_correction', { deficiencies: [{ field: 'taxNumber', note: 'رقم ضريبي غير واضح' }] }), 'open deficiency');
  await srv.close();
  const { closeDb, getDb } = await import('../src/db/sqlite.js');
  await getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await closeDb();
  // pre-006 copy: same data, without the 006 guards
  pre006 = path.join(env.dir, 'pre006.db');
  fs.copyFileSync(process.env.DB_PATH!, pre006);
  const d = new DatabaseSync(pre006);
  d.exec(ROLLBACK_SQL);
  d.close();
});
after(async () => { await env.cleanup(); });

function copyOf(tag: string): string {
  const p = path.join(env.dir, `${tag}.db`);
  fs.copyFileSync(pre006, p);
  return p;
}
function open(p: string): DatabaseSync {
  const d = new DatabaseSync(p);
  d.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return d;
}
/** Content hash of every row of every table except schema_migrations (stable order by rowid). */
function contentHash(d: DatabaseSync): Record<string, string> {
  const out: Record<string, string> = {};
  const tables = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name").all() as Array<{ name: string }>).map((t) => t.name);
  for (const t of tables) out[t] = createHash('sha256').update(JSON.stringify(d.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())).digest('hex');
  return out;
}
const triggersOf = (d: DatabaseSync) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
const check = (d: DatabaseSync) => ({
  integrity: (d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
  fk: d.prepare('PRAGMA foreign_key_check').all().length,
});

test('clean database: every migration applies, 006 triggers exist, integrity ok, re-running is a no-op', async () => {
  const { runMigrations } = await import('../src/db/sqlite.js');
  const p = path.join(env.dir, 'clean.db');
  const d = open(p);
  const ran = runMigrations(d);
  assert.deepEqual(ran.map((f) => f.slice(0, 3)), ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011']);
  for (const t of TRIGGERS) assert.ok(triggersOf(d).includes(t), t);
  assert.deepEqual(check(d), { integrity: 'ok', fk: 0 });
  assert.deepEqual(runMigrations(d), [], 'idempotent: nothing re-applied');
  d.close();
});

test('database with representative existing records and history: 006 applies without changing a single row', async () => {
  const { runMigrations } = await import('../src/db/sqlite.js');
  const d = open(copyOf('representative'));
  const counts = {
    transitions: (d.prepare('SELECT COUNT(*) AS n FROM application_transitions').get() as any).n,
    resolved: (d.prepare('SELECT COUNT(*) AS n FROM deficiencies WHERE resolvedAtTransitionId IS NOT NULL').get() as any).n,
    open: (d.prepare('SELECT COUNT(*) AS n FROM deficiencies WHERE resolvedAtTransitionId IS NULL').get() as any).n,
    history: (d.prepare('SELECT COUNT(*) AS n FROM bank_referral_history').get() as any).n,
  };
  assert.ok(counts.transitions >= 12 && counts.resolved >= 1 && counts.open >= 1 && counts.history >= 1, JSON.stringify(counts));
  assert.equal(TRIGGERS.filter((t) => triggersOf(d).includes(t)).length, 0, 'copy really is pre-006');
  const before_ = contentHash(d);
  const fkBefore = check(d);
  assert.deepEqual(runMigrations(d).map((f) => f.slice(0, 3)), ['006']);
  assert.deepEqual(contentHash(d), before_, 'no row of any table changed');
  assert.deepEqual(check(d), fkBefore);
  assert.deepEqual(check(d), { integrity: 'ok', fk: 0 });
  // the guards are active on the pre-existing rows
  assert.throws(() => d.exec("UPDATE application_transitions SET reason = 'x'"), /append-only/);
  assert.throws(() => d.exec('DELETE FROM application_transitions'), /append-only/);
  assert.throws(() => d.exec("UPDATE bank_referral_history SET endReason = 'xxx'"), /append-only/);
  assert.throws(() => d.exec('DELETE FROM bank_referral_history'), /append-only/);
  assert.throws(() => d.exec('DELETE FROM deficiencies'), /cannot be deleted/);
  assert.throws(() => d.exec("UPDATE deficiencies SET note = 'x' WHERE resolvedAtTransitionId IS NOT NULL"), /immutable/);
  assert.throws(() => d.exec("UPDATE deficiencies SET resolvedAtTransitionId = NULL WHERE resolvedAtTransitionId IS NOT NULL"), /immutable/, 'a closed item cannot be re-opened');
  assert.throws(() => d.exec("UPDATE deficiencies SET note = 'x' WHERE resolvedAtTransitionId IS NULL"), /immutable/, 'an open item cannot be rewritten');
  assert.throws(() => d.exec('DELETE FROM applications'), /append-only|cannot be deleted/, 'cascade delete of an application is blocked');
  // the one legitimate change (closing an open item) still works
  const openDef = d.prepare('SELECT id, applicationId FROM deficiencies WHERE resolvedAtTransitionId IS NULL LIMIT 1').get() as any;
  const anyT = d.prepare('SELECT id FROM application_transitions WHERE applicationId = ? ORDER BY createdAt DESC LIMIT 1').get(openDef.applicationId) as any;
  d.prepare('UPDATE deficiencies SET resolvedAtTransitionId = ? WHERE id = ?').run(anyT.id, openDef.id);
  assert.equal((d.prepare('SELECT resolvedAtTransitionId AS r FROM deficiencies WHERE id = ?').get(openDef.id) as any).r, anyT.id);
  d.close();
});

test('database with invalid or inconsistent historical rows: 006 still applies, leaves them exactly as they were, and freezes them', async () => {
  const { runMigrations } = await import('../src/db/sqlite.js');
  const d = open(copyOf('inconsistent'));
  const app = d.prepare('SELECT id FROM applications LIMIT 1').get() as any;
  const other = d.prepare('SELECT id FROM applications WHERE id <> ? LIMIT 1').get(app.id) as any;
  const tOther = d.prepare('SELECT id FROM application_transitions WHERE applicationId = ? LIMIT 1').get(other.id) as any;
  // inconsistent history that the application would never write (allowed before 006)
  d.prepare(`INSERT INTO application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, payload, createdAt)
    VALUES ('trn-bad-1', ?, 'BANK_STUDY', 'DRAFT', 'reject', 'system_admin', 0, 'not json', '1990-01-01T00:00:00.000Z')`).run(app.id);
  d.prepare(`INSERT INTO deficiencies (id, applicationId, transitionId, stage, field, note, resolvedAtTransitionId, createdAt)
    VALUES ('def-bad-1', ?, 'trn-bad-1', 'BANK_STUDY', 'no_such_field', '', ?, '2999-01-01T00:00:00.000Z')`).run(app.id, tOther.id); // resolved by another application's transition
  d.prepare(`INSERT INTO bank_referral_history (id, applicationId, bankOrgId, referredAt, referredBy, endedAt, endedBy, endReason, transitionId)
    VALUES ('rfh-bad-1', ?, 'org-bank-demo-a', '2026-12-31T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', NULL, 'ended before it started', 'trn-bad-1')`).run(app.id);
  const before_ = contentHash(d);
  assert.deepEqual(runMigrations(d).map((f) => f.slice(0, 3)), ['006']);
  assert.deepEqual(contentHash(d), before_, 'the inconsistent rows were not rewritten');
  assert.deepEqual(check(d), { integrity: 'ok', fk: 0 });
  assert.equal((d.prepare("SELECT payload FROM application_transitions WHERE id = 'trn-bad-1'").get() as any).payload, 'not json');
  // they are now frozen as well: correcting them requires the documented manual procedure (drop guard, fix, re-apply)
  assert.throws(() => d.exec("UPDATE application_transitions SET payload = '{}' WHERE id = 'trn-bad-1'"), /append-only/);
  assert.throws(() => d.exec("DELETE FROM bank_referral_history WHERE id = 'rfh-bad-1'"), /append-only/);
  assert.throws(() => d.exec("UPDATE deficiencies SET field = 'address' WHERE id = 'def-bad-1'"), /immutable/);
  d.close();
});

test('a failing 006 rolls back atomically: no partial triggers and no schema_migrations row (boot refuses)', async () => {
  const { runMigrations } = await import('../src/db/sqlite.js');
  const d = open(copyOf('conflict'));
  // e.g. a manual hot-fix that created one guard by hand under the same name
  d.exec("CREATE TRIGGER deficiencies_no_delete BEFORE DELETE ON deficiencies BEGIN SELECT RAISE(ABORT, 'manual'); END;");
  assert.throws(() => runMigrations(d), /006_history_guards\.sql failed: .*already exists/);
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 6').get() as any).n, 0);
  assert.deepEqual(triggersOf(d).filter((t) => TRIGGERS.includes(t)), ['deficiencies_no_delete'], 'only the pre-existing manual trigger remains');
  assert.doesNotThrow(() => d.exec("UPDATE application_transitions SET reason = reason WHERE 0"), 'transitions not guarded: nothing of 006 was kept');
  // recovery: drop the manual object, run again
  d.exec('DROP TRIGGER deficiencies_no_delete');
  assert.deepEqual(runMigrations(d).map((f) => f.slice(0, 3)), ['006']);
  assert.deepEqual(check(d), { integrity: 'ok', fk: 0 });
  d.close();
});

test('documented rollback of 006 restores the pre-006 schema exactly, and the migration can be re-applied', async () => {
  const { runMigrations } = await import('../src/db/sqlite.js');
  const d = open(copyOf('rollback'));
  const schemaBefore = d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
  const dataBefore = contentHash(d);
  runMigrations(d);
  d.exec(ROLLBACK_SQL);
  assert.deepEqual(d.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all(), schemaBefore);
  assert.deepEqual(contentHash(d), dataBefore);
  assert.deepEqual(runMigrations(d).map((f) => f.slice(0, 3)), ['006']);
  d.close();
});

test('006 on a large history table: creating the triggers does not scan or rewrite rows', async () => {
  const { runMigrations } = await import('../src/db/sqlite.js');
  const p = copyOf('large');
  const d = open(p);
  const app = d.prepare('SELECT id FROM applications LIMIT 1').get() as any;
  const ins = d.prepare(`INSERT INTO application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, payload, createdAt)
    VALUES (?, ?, 'IMC_REVIEW', 'IMC_REVIEW', 'submit', 'factory_owner', 1, ?, '2026-01-01T00:00:00.000Z')`);
  d.exec('BEGIN');
  for (let i = 0; i < 200_000; i++) ins.run(`trn-big-${i}`, app.id, JSON.stringify({ i, pad: 'x'.repeat(120) }));
  d.exec('COMMIT');
  const sizeMb = fs.statSync(p).size / 1024 / 1024;
  const t0 = performance.now();
  runMigrations(d);
  const ms = performance.now() - t0;
  console.log(`[006-large] ${(d.prepare('SELECT COUNT(*) AS n FROM application_transitions').get() as any).n} transitions, db ${sizeMb.toFixed(1)} MB, migration ${ms.toFixed(1)} ms`);
  assert.ok(ms < 2000, `migration took ${ms} ms`);
  assert.deepEqual(check(d), { integrity: 'ok', fk: 0 });
  d.close();
});
