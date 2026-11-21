// Migration 007 (G-01 / G-02 / G-03) on a synthetic pre-007 database — never a real one.
// The pre-007 state is produced the only way it can exist today: real workflows to the electricity stage, then the legacy rows the old code
// wrote (an application in BANK_STUDY, a bank chosen before PMU acceptance, an active bank account with a live session, a pending bank
// account request), then 007 is re-applied with the real migration runner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, getApp, q, pdfVariant, Client, BANK_A, BANK_B, type Started } from './helpers.js';

const env = isolateTestEnv('mig007');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let studyApp = '';
let preChoiceApp = '';
let docsBefore: Array<{ id: string; kind: string; sha256: string }> = [];
let transitionsBefore = 0;
let bankUserToken = '';

async function db() { return (await import('../src/db/sqlite.js')).getDb(); }

before(async () => {
  srv = await startServer();
  c = await clients(srv.base);
  const d = await db();
  // 1) an application the old code had referred to bank A and left in BANK_STUDY
  studyApp = await advanceTo('ELECTRICITY_REVIEW', c, 'IND-M7-STUDY');
  await d.prepare("UPDATE applications SET state = 'BANK_STUDY', bankOrgId = ? WHERE id = ?").run(BANK_A, studyApp);
  await d.prepare("INSERT INTO bank_referrals (id, applicationId, bankOrgId, referredAt, referredBy) VALUES ('ref-m7', ?, ?, '2026-10-01T00:00:00.000Z', 'usr-pmu-1')").run(studyApp, BANK_A);
  // 2) an application whose bank was chosen together with the electricity approval (before PMU accepted it)
  preChoiceApp = await advanceTo('ELECTRICITY_REVIEW', { ...c, factory: c.factory2 }, 'IND-M7-PRE');
  await d.prepare('UPDATE applications SET bankOrgId = ? WHERE id = ?').run(BANK_B, preChoiceApp);
  // 3) an active bank account with a live session, and a pending bank account request
  const hash = (await d.prepare("SELECT passwordHash FROM users WHERE email = 'factory@shams.local'").get() as { passwordHash: string }).passwordHash;
  const now = new Date().toISOString();
  await d.prepare(`INSERT INTO users (id, organizationId, role, email, nameAr, passwordHash, isActive, emailVerifiedAt, createdAt, updatedAt)
    VALUES ('usr-legacy-bank', ?, 'bank_reviewer', 'legacy.bank@shams.local', 'مراجع بنك قديم', ?, 1, ?, ?, ?)`).run(BANK_A, hash, now, now, now);
  // a session issued by the pre-007 code (the current code would refuse the login itself)
  const { signAccess } = await import('../src/auth/jwt.js');
  bankUserToken = signAccess('usr-legacy-bank', 'bank_reviewer', BANK_A, 0);
  await d.prepare(`INSERT INTO refresh_tokens (id, userId, familyId, tokenHash, expiresAt, createdAt) VALUES ('rt-m7', 'usr-legacy-bank', 'fam-m7', ?, '2999-01-01T00:00:00.000Z', ?)`)
    .run('f'.repeat(64), now);
  await d.prepare(`INSERT INTO account_requests (id, kind, organizationId, role, email, nameAr, nameEn, phone, reason, status, requestedByType, requestedByUserId, createdAt, updatedAt)
    VALUES ('acr-m7', 'create_user', ?, 'bank_reviewer', 'new.bank@shams.local', 'طلب حساب بنك', '', '', 'قديم', 'pending', 'user', 'usr-admin', ?, ?)`).run(BANK_A, now, now);
  docsBefore = await d.prepare('SELECT id, kind, sha256 FROM documents ORDER BY id').all() as typeof docsBefore;
  transitionsBefore = (await d.prepare('SELECT COUNT(*) AS n FROM application_transitions').get() as { n: number }).n;
  // back to pre-007 and migrate with the real runner
  await d.prepare('DELETE FROM schema_migrations WHERE version = 7').run();
  const { runMigrations, rawSqlite } = await import('../src/db/sqlite.js');
  assert.deepEqual(runMigrations(rawSqlite()).map((f) => f.slice(0, 3)), ['007']);
});
after(async () => { await srv.close(); await env.cleanup(); });

test('M7-1 integrity: every document row survives the documents rebuild unchanged; FKs and integrity hold; history is only appended to', async () => {
  const d = await db();
  assert.deepEqual(await d.prepare('SELECT id, kind, sha256 FROM documents ORDER BY id').all(), docsBefore);
  assert.equal((await d.prepare('PRAGMA integrity_check').get() as any).integrity_check, 'ok');
  assert.equal((await d.prepare('PRAGMA foreign_key_check').all()).length, 0);
  assert.ok(await d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_docs_app'").get(), 'index recreated');
  const after_ = (await d.prepare('SELECT COUNT(*) AS n FROM application_transitions').get() as { n: number }).n;
  assert.equal(after_, transitionsBefore + 1, 'one system transition appended (the BANK_STUDY move), nothing removed');
  // the new document kind is accepted by the schema
  await assert.doesNotReject(async () => await d.prepare("SELECT 1 FROM documents WHERE kind = 'contractFile'").all());
});

test('M7-2 G-02: a live BANK_STUDY application moves to the bank & contracting stage with its bank, and the factory records the outcome directly', async () => {
  const app = await getApp(c.factory, studyApp);
  assert.equal(app.state, 'CONTRACT_OUTCOME');
  assert.equal(app.bank.id, BANK_A, 'bank kept');
  assert.deepEqual(app.allowedActions.map((a: any) => a.action).sort(), ['record_contract', 'record_no_contract', 'withdraw'], 'no bank approval awaited');
  const tr = await q<any>("SELECT actorRole, action, payload FROM application_transitions WHERE applicationId = ? AND fromState = 'BANK_STUDY'", studyApp);
  assert.equal(tr.length, 1); assert.equal(tr[0].actorRole, 'system'); assert.equal(tr[0].action, 'bank_study_retired');
  assert.equal(JSON.parse(tr[0].payload).bankOrgId, BANK_A);
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE applicationId = ? AND action = 'application.bank_study_retired'", studyApp)).length, 1);
  assert.equal((await c.factory.upload(`/applications/${studyApp}/documents`, { kind: 'contractFile' }, pdfVariant('m7'), 'contract.pdf')).status, 201);
  assert.equal((await act(c.factory, studyApp, 'record_contract', { contractDate: '2026-10-20', contractAmount: 500000 })).status, 200);
  assert.equal((await getApp(c.factory, studyApp)).state, 'CONTRACTED');
});

test('M7-3 G-01: a bank chosen before PMU acceptance is cleared; after acceptance the factory chooses again', async () => {
  let app = await getApp(c.factory2, preChoiceApp);
  assert.equal(app.state, 'ELECTRICITY_REVIEW');
  assert.equal(app.bank, null, 'pre-acceptance choice cleared');
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE applicationId = ? AND action = 'application.bank_choice_cleared'", preChoiceApp)).length, 1);
  assert.equal((await act(c.pmu, preChoiceApp, 'accept')).status, 200);
  app = await getApp(c.factory2, preChoiceApp);
  assert.deepEqual(app.allowedActions.map((a: any) => a.action).sort(), ['select_bank', 'select_distribution_path', 'withdraw']);
  assert.equal((await act(c.factory2, preChoiceApp, 'select_bank', { bankOrgId: BANK_B })).status, 200);
});

test('M7-4 G-02: bank accounts are retired — session revoked, login refused, cannot be re-enabled, pending requests closed', async () => {
  const u = (await q<any>("SELECT isActive, tokenVersion FROM users WHERE id = 'usr-legacy-bank'"))[0];
  assert.equal(u.isActive, 0); assert.ok(u.tokenVersion >= 1);
  assert.equal((await q("SELECT 1 FROM refresh_tokens WHERE userId = 'usr-legacy-bank' AND revokedAt IS NULL")).length, 0, 'refresh sessions revoked');
  const old = new Client(srv.base); old.token = bankUserToken;
  assert.equal((await old.get('/applications')).status, 401, 'existing access token refused');
  assert.equal((await new Client(srv.base).post('/auth/login', { email: 'legacy.bank@shams.local', password: 'Shams@2026' })).status, 403);
  // even if the row were re-activated by hand, the role itself gets no session
  await (await db()).prepare("UPDATE users SET isActive = 1 WHERE id = 'usr-legacy-bank'").run();
  try {
    assert.equal((await new Client(srv.base).post('/auth/login', { email: 'legacy.bank@shams.local', password: 'Shams@2026' })).status, 403, 'retired role refused at login');
  } finally { await (await db()).prepare("UPDATE users SET isActive = 0 WHERE id = 'usr-legacy-bank'").run(); }
  const reenable = await c.admin.put('/admin/users/usr-legacy-bank', { isActive: true });
  assert.equal(reenable.status, 400, 'the admin cannot re-enable a bank account');
  const create = await c.admin.post('/admin/users', { email: 'another.bank@shams.local', nameAr: 'بنك', role: 'bank_reviewer', organizationId: BANK_A });
  assert.equal(create.status, 400, 'no new bank account');
  const req = (await q<any>("SELECT status FROM account_requests WHERE id = 'acr-m7'"))[0];
  assert.equal(req.status, 'rejected');
});
