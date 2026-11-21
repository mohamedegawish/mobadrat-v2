// MySQL schema vs the SQLite schema. Parity of migration versions runs in both modes; the rest needs MySQL (npm run test:mysql).
// The append-only / immutability triggers are also exercised end-to-end by 18-business-audit on whichever engine runs it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isolateTestEnv, onMysql, q } from './helpers.js';

const SKIP = onMysql ? false : 'MySQL only (npm run test:mysql)';
const dbDir = path.resolve(import.meta.dirname, '..', 'src', 'db');
const env = isolateTestEnv('myschema');
const versions = (dir: string) => fs.readdirSync(path.join(dbDir, dir)).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).map((f) => f.slice(0, 3)).sort();

/** The final SQLite schema: every migration applied to an empty in-memory database. */
function sqliteSchema(): Map<string, string[]> {
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL)');
  for (const f of fs.readdirSync(path.join(dbDir, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) d.exec(fs.readFileSync(path.join(dbDir, 'migrations', f), 'utf8'));
  const out = new Map<string, string[]>();
  for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>) {
    out.set(name, (d.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).map((c) => c.name).sort());
  }
  d.close();
  return out;
}

before(async () => { if (!SKIP) await (await import('../src/db/sqlite.js')).initDb(); });
after(async () => { await env.cleanup(); });

test('S-1 both engines have the same migration versions (every new migration must be written for SQLite and MySQL)', () => {
  assert.deepEqual(versions('migrations-mysql'), versions('migrations'));
});

test('S-2 MySQL has every SQLite table with exactly the same columns (plus only `_`-prefixed internal columns)', { skip: SKIP }, async () => {
  const lite = sqliteSchema();
  const cols = await q<{ t: string; c: string }>("SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE()");
  const my = new Map<string, string[]>();
  for (const r of cols) my.set(r.t, [...(my.get(r.t) ?? []), r.c]);
  assert.deepEqual([...my.keys()].sort(), [...lite.keys()].sort(), 'same tables');
  for (const [t, c] of lite) {
    assert.deepEqual(my.get(t)!.filter((x) => !x.startsWith('_')).sort(), c, `columns of ${t}`);
  }
  assert.equal(Number((await q<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations'))[0].v), Number(versions('migrations-mysql').at(-1)), 'every MySQL migration applied');
  const orgs = (await q<{ id: string }>('SELECT id FROM organizations ORDER BY id')).map((r) => r.id);
  assert.deepEqual(orgs, ['org-admin', 'org-encpc', 'org-imc', 'org-pmu'], 'structural organisations, as SQLite 001 creates them');
});

test('S-3 every SQLite unique index and trigger exists in MySQL', { skip: SKIP }, async () => {
  const uniques = new Set((await q<{ n: string }>("SELECT DISTINCT INDEX_NAME AS n FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0")).map((r) => r.n));
  for (const n of ['ux_apps_open_factory', 'ux_apps_open_registry', 'ux_account_requests_pending_email', 'ux_account_requests_pending_target',
    'ux_objections_pending', 'ux_recovery_open', 'ux_users_verify_token', 'ux_users_reset_token']) assert.ok(uniques.has(n), n);
  const triggers = (await q<{ n: string }>('SELECT TRIGGER_NAME AS n FROM information_schema.triggers WHERE TRIGGER_SCHEMA = DATABASE() ORDER BY 1')).map((r) => r.n);
  assert.deepEqual(triggers, ['audit_no_delete', 'audit_no_update', 'deficiencies_immutable', 'deficiencies_no_delete', 'referral_history_no_delete',
    'referral_history_no_update', 'transitions_no_delete', 'transitions_no_update', 'users_identity_locked', 'users_role_org_insert']);
});

test('S-4 the partial unique rules hold on MySQL: one open application per factory and per submitted registry number', { skip: SKIP }, async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  const db = getDb();
  const now = new Date().toISOString();
  const ins = (id: string, fac: string, state: string, reg: string | null) => db.prepare(`INSERT INTO applications (id, factoryId, state, industrialRegistryNumber, stateEnteredAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, fac, state, reg, now, now, now);
  for (const n of [1, 2]) {
    await db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES (?, 'factory', ?, ?, ?, ?)").run(`org-f${n}`, `مصنع ${n}`, `F${n}`, now, now);
    await db.prepare('INSERT INTO factories (id, organizationId, companyName, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(`fac-${n}`, `org-f${n}`, `مصنع ${n}`, now, now);
  }
  await ins('a1', 'fac-1', 'IMC_REVIEW', 'R-1');
  await assert.rejects(ins('a2', 'fac-1', 'DRAFT', null), /Duplicate entry/, 'second open application of the same factory');
  await assert.rejects(ins('a3', 'fac-2', 'IMC_REVIEW', 'R-1'), /Duplicate entry/, 'same registry number, both submitted');
  await ins('a4', 'fac-2', 'DRAFT', 'R-1'); // a draft does not reserve the number
  await db.prepare("UPDATE applications SET state = 'WITHDRAWN' WHERE id = 'a1'").run();
  await ins('a5', 'fac-1', 'IMC_REVIEW', 'R-1'); // closed → a new open application and the number are free again
  await assert.rejects(db.prepare("UPDATE applications SET state = 'IMC_REVIEW' WHERE id = 'a4'").run(), /Duplicate entry/, 'submitting the draft collides');
});

test('S-5 CHECK constraints, character lengths, binary ids and case-insensitive e-mail behave as in SQLite', { skip: SKIP }, async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  const db = getDb();
  const now = new Date().toISOString();
  await assert.rejects(db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('o-x', 'bogus', 'x', 'x', ?, ?)").run(now, now),
    /check constraint|CONSTRAINT .* failed/i, 'MySQL: "Check constraint … is violated"; MariaDB: "CONSTRAINT … failed"');
  // 200 Arabic characters (400 bytes) fit the 200-character limit; 201 do not
  await db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('o-ar', 'bank', ?, 'x', ?, ?)").run('ب'.repeat(200), now, now);
  await assert.rejects(db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('o-ar2', 'bank', ?, 'x', ?, ?)").run('ب'.repeat(201), now, now));
  // ids are binary (case-sensitive), like SQLite
  await db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('O-AR', 'bank', 'y', 'y', ?, ?)").run(now, now);
  // e-mail unique regardless of case (COLLATE NOCASE)
  const user = (id: string, email: string) => db.prepare(`INSERT INTO users (id, organizationId, role, email, nameAr, passwordHash, createdAt, updatedAt)
    VALUES (?, 'org-imc', 'imc_reviewer', ?, 'n', '', ?, ?)`).run(id, email, now, now);
  await user('u-1', 'Reviewer@Example.gov.eg');
  await assert.rejects(user('u-2', 'reviewer@example.GOV.eg'), /Duplicate entry/);
  assert.equal((await q('SELECT id FROM users WHERE email = ? COLLATE NOCASE', 'REVIEWER@example.gov.eg')).length, 1);
  // the role must match the organisation type, and never changes
  await assert.rejects(db.prepare(`INSERT INTO users (id, organizationId, role, email, nameAr, passwordHash, createdAt, updatedAt)
    VALUES ('u-3', 'org-imc', 'pmu_reviewer', 'x@y.z', 'n', '', ?, ?)`).run(now, now), /role does not match organization type/);
  await assert.rejects(db.prepare("UPDATE users SET role = 'pmu_reviewer' WHERE id = 'u-1'").run(), /account role and organization cannot change/);
  // audit is append-only
  await db.prepare("INSERT INTO audit_logs (id, at, actorType, action, entityType) VALUES ('aud-x', ?, 'system', 'x', 'x')").run(now);
  await assert.rejects(db.prepare("UPDATE audit_logs SET action = 'y' WHERE id = 'aud-x'").run(), /append-only/);
  await assert.rejects(db.prepare("DELETE FROM audit_logs WHERE id = 'aud-x'").run(), /append-only/);
});

test('S-6 migration 011: new states, the distribution document kind and the two-path constraints are enforced on MySQL', { skip: SKIP }, async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('org-f11', 'factory', 'مصنع 11', 'F11', ?, ?)").run(now, now);
  await db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('org-b11', 'bank', 'بنك 11', 'B11', ?, ?)").run(now, now);
  await db.prepare("INSERT INTO factories (id, organizationId, companyName, createdAt, updatedAt) VALUES ('fac-11', 'org-f11', 'مصنع 11', ?, ?)").run(now, now);
  const ins = (id: string, state: string, path: string | null, bank: string | null) => db.prepare(`INSERT INTO applications (id, factoryId, state, contractPath, bankOrgId, stateEnteredAt, createdAt, updatedAt)
    VALUES (?, 'fac-11', ?, ?, ?, ?, ?, ?)`).run(id, state, path, bank, now, now, now);
  const violated = /check constraint|CONSTRAINT .* failed/i;
  await assert.rejects(ins('x1', 'DISTRIBUTION_UPLOAD', null, null), violated, 'distribution stage without the distribution path');
  await assert.rejects(ins('x2', 'CONTRACT_OUTCOME', 'distribution', 'org-b11'), violated, 'both paths at once');
  await assert.rejects(ins('x3', 'CONTRACT_OUTCOME', 'other', null), violated, 'unknown path');
  await ins('a11', 'DISTRIBUTION_REVIEW', 'distribution', null);
  await assert.rejects(db.prepare("UPDATE applications SET bankOrgId = 'org-b11' WHERE id = 'a11'").run(), violated, 'no bank on the distribution path');
  await db.prepare("UPDATE applications SET state = 'WITHDRAWN' WHERE id = 'a11'").run();
  await ins('a12', 'CONTRACT_OUTCOME', 'bank', 'org-b11');
  await db.prepare(`INSERT INTO users (id, organizationId, role, email, nameAr, passwordHash, createdAt, updatedAt) VALUES ('u-f11', 'org-f11', 'factory_owner', 'f11@x.y', 'n', '', ?, ?)`).run(now, now);
  await db.prepare(`INSERT INTO documents (id, applicationId, kind, version, attempt, uploadedInState, originalName, storedName, sizeBytes, sha256, uploadedBy, createdAt)
    VALUES ('d11', 'a11', 'distributionApprovalFile', 1, 1, 'DISTRIBUTION_UPLOAD', 'a.pdf', 's11', 10, ?, 'u-f11', ?)`).run('a'.repeat(64), now);
  await assert.rejects(db.prepare(`INSERT INTO documents (id, applicationId, kind, version, attempt, uploadedInState, originalName, storedName, sizeBytes, sha256, uploadedBy, createdAt)
    VALUES ('d12', 'a11', 'bogusKind', 1, 1, 'X', 'a.pdf', 's12', 10, ?, 'u-f11', ?)`).run('a'.repeat(64), now), violated);
  await db.prepare("INSERT INTO distribution_contracts (id, applicationId, selectedAt, approvalDocumentId, reviewStatus) VALUES ('dc11', 'a11', ?, 'd11', 'pending')").run(now);
  await assert.rejects(db.prepare("INSERT INTO distribution_contracts (id, applicationId, selectedAt) VALUES ('dc12', 'a11', ?)").run(now), /Duplicate entry/, 'one result row per application');
  await assert.rejects(db.prepare("UPDATE distribution_contracts SET reviewStatus = 'approved' WHERE id = 'dc11'").run(), violated, 'a decision needs its date');
});
