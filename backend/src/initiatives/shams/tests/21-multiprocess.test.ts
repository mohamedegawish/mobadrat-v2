// Production-readiness: cross-process SQLite concurrency. Two independent server processes (own Node process, own SQLite
// connection) share ONE temporary database file and upload directory. Races are forced with explicit coordination
// (registry hold + write-lock barrier, see tests/mp/harness.ts), and every scenario asserts the final database state,
// the transition/audit history and integrity, not only the HTTP responses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isolateTestEnv, clients, act, getApp, advanceTo, createCompleteDraft, pdfVariant, q, BANK_A, BANK_B, type Res,
} from './helpers.js';
import { FakeRegistry, LockBarrier, spawnServer, spawnCrashChild, on, integrity, type Child } from './mp/harness.js';

const env = isolateTestEnv('multiproc');
const reg = new FakeRegistry();
let A: Child;
let B: Child;
let lock: LockBarrier;
let c: Awaited<ReturnType<typeof clients>>;
const dbPath = () => process.env.DB_PATH!;
const docsDir = () => path.join(process.env.UPLOAD_DIR!, 'documents');

before(async () => {
  await reg.start();
  process.env.REGISTRY_ADAPTER = 'http';
  process.env.REGISTRY_API_URL = reg.url;
  process.env.REGISTRY_TIMEOUT_MS = '20000';
  const { getDb } = await import('../src/db/sqlite.js');
  const { seedDevData } = await import('../src/db/seed.js');
  getDb();
  await seedDevData();
  [A, B] = await Promise.all([spawnServer({}), spawnServer({})]);
  assert.notEqual(A.pid, B.pid);
  assert.notEqual(A.pid, process.pid);
  lock = new LockBarrier(dbPath());
  c = await clients(A.base);
});

after(async () => {
  lock?.close();
  await Promise.all([await A?.stop(), await B?.stop()]);
  await reg.close();
  await env.cleanup();
});

async function closeOpen(factory = c.factory) {
  const open = (await factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) {
    const r = await act(factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
}

/** Sends both requests while the test holds the write lock, proves both children are blocked on it, then releases. */
async function race(children: Child[], send: () => Array<Promise<Res>>): Promise<{ results: Res[]; heldMs: number }> {
  lock.acquire();
  let pending: Array<Promise<Res>> = [];
  let heldMs = 0;
  try {
    pending = send();
    await lock.waitBlocked(children);
  } finally {
    heldMs = lock.release();
  }
  return { results: await Promise.all(pending), heldMs };
}

function assertIntact() {
  const r = integrity(dbPath());
  assert.equal(r.integrity, 'ok');
  assert.equal(r.fkViolations, 0);
}

const appRow = async (id: string) => (await q<any>('SELECT * FROM applications WHERE id = ?', id))[0];

test('MP-1 two processes submit the same industrial registry number: exactly one is submitted, the conflict is recorded once', async () => {
  await closeOpen(c.factory); await closeOpen(c.factory2);
  const idA = await createCompleteDraft(c.factory, 'IND-MP-1');
  const idB = await createCompleteDraft(c.factory2, 'IND-MP-1');
  const [vA, vB] = [(await appRow(idA)).version, (await appRow(idB)).version];
  reg.hold = true;
  const pA = c.factory.post(`/applications/${idA}/actions/submit`, { expectedVersion: vA });
  const pB = on(c.factory2, B).post(`/applications/${idB}/actions/submit`, { expectedVersion: vB });
  await reg.waitPending(2); // both passed every pre-transaction check (no holder of the number yet)
  lock.acquire();
  reg.release();
  try { await lock.waitBlocked([A, B]); } finally { lock.release(); }
  const [a, b] = await Promise.all([pA, pB]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.json, b.json]));
  const loser = a.status === 409 ? a : b;
  const loserId = a.status === 409 ? idA : idB;
  const winnerId = loserId === idA ? idB : idA;
  assert.equal(loser.json.code, 'DUPLICATE_REGISTRY');

  const holders = await q("SELECT id FROM applications WHERE industrialRegistryNumber = 'IND-MP-1' AND state <> 'DRAFT' AND closedAt IS NULL");
  assert.deepEqual(holders.map((h: any) => h.id), [winnerId]);
  const lr = await appRow(loserId);
  assert.equal(lr.state, 'DRAFT');
  assert.equal(lr.number, null, 'loser got no application number');
  assert.equal(lr.version, loserId === idA ? vA : vB, 'loser version unchanged');
  assert.equal((await q('SELECT 1 FROM registry_verifications WHERE applicationId = ?', loserId)).length, 0, 'loser verification rolled back');
  assert.equal((await q('SELECT 1 FROM registry_verifications WHERE applicationId = ?', winnerId)).length, 1);
  assert.equal((await q('SELECT 1 FROM application_transitions WHERE applicationId = ? AND fromState <> toState', loserId)).length, 0);
  assert.equal((await q("SELECT 1 FROM application_transitions WHERE applicationId = ? AND action = 'submit'", winnerId)).length, 1);
  assert.equal((await q('SELECT 1 FROM registry_conflicts WHERE attemptedApplicationId = ? AND holdingApplicationId = ?', loserId, winnerId)).length, 1);
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE action = 'application.submit' AND applicationId IN (?, ?)", idA, idB)).length, 1);
  assertIntact();
});

test('MP-2 data changed from another process while the registry verification is delayed: nothing is submitted', async () => {
  await closeOpen(c.factory);
  const id = await createCompleteDraft(c.factory, 'IND-MP-2');
  const v0 = (await appRow(id)).version;
  // (a) the registry number edited in process B during the wait
  reg.hold = true;
  const p = c.factory.post(`/applications/${id}/actions/submit`, { expectedVersion: v0 });
  await reg.waitPending(1);
  const edit = await on(c.factory, B).put(`/applications/${id}/data/company`, { industrialRegistryNumber: 'IND-MP-2-CHANGED' });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  reg.release();
  const r = await p;
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBMISSION_DATA_CHANGED');
  let row = await appRow(id);
  assert.equal(row.state, 'DRAFT'); assert.equal(row.number, null); assert.equal(row.version, v0);
  assert.equal(row.verifiedRegistryNumber, null);
  assert.equal((await q('SELECT 1 FROM registry_verifications WHERE applicationId = ?', id)).length, 0);
  // (b) a document replaced in process B during the wait
  reg.hold = true;
  const p2 = c.factory.post(`/applications/${id}/actions/submit`, { expectedVersion: v0 });
  await reg.waitPending(1);
  const up = await on(c.factory, B).upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('mp2-tax-v2'), 'tax.pdf');
  assert.equal(up.status, 201, JSON.stringify(up.json));
  reg.release();
  const r2 = await p2;
  assert.equal(r2.status, 409); assert.equal(r2.json.code, 'SUBMISSION_DATA_CHANGED');
  row = await appRow(id);
  assert.equal(row.state, 'DRAFT'); assert.equal(row.version, v0);
  assert.equal((await q('SELECT 1 FROM application_transitions WHERE applicationId = ?', id)).length, 0);
  // and the unchanged data then submits normally
  assert.equal((await act(c.factory, id, 'submit')).status, 200);
  assert.equal((await appRow(id)).verifiedRegistryNumber, 'IND-MP-2-CHANGED');
  assertIntact();
});

test('MP-3 two processes upload documents for the same application at the same time', async () => {
  await closeOpen(c.factory);
  const id = await createCompleteDraft(c.factory, 'IND-MP-3'); // 3 bills
  for (let i = 3; i < 11; i++) {
    const r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, pdfVariant(`mp3-bill-${i}`), `bill-${i}.pdf`);
    assert.equal(r.status, 201);
  }
  // (a) the 12th and 13th bill race: the 12-file cap holds across processes
  const fb = on(c.factory, B);
  const { results: [x, y] } = await race([A, B], () => [
    c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, pdfVariant('mp3-race-a'), 'a.pdf'),
    fb.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, pdfVariant('mp3-race-b'), 'b.pdf'),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [201, 422], JSON.stringify([x.json, y.json]));
  assert.equal((x.status === 422 ? x : y).json.code, 'TOO_MANY_FILES');
  assert.equal((await q("SELECT 1 FROM documents WHERE applicationId = ? AND kind = 'electricityBill' AND supersededAtAttempt IS NULL", id)).length, 12);
  // (b) two new versions of the same single document race: distinct versions, exactly one current
  const { results: [m, n] } = await race([A, B], () => [
    c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('mp3-tax-a'), 'tax-a.pdf'),
    fb.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('mp3-tax-b'), 'tax-b.pdf'),
  ]);
  assert.deepEqual([m.status, n.status], [201, 201]);
  const tax = await q<any>("SELECT version, supersededAtAttempt FROM documents WHERE applicationId = ? AND kind = 'taxCardFile' ORDER BY version", id);
  assert.deepEqual(tax.map((t) => t.version), [1, 2, 3], 'versions are unique and consecutive');
  assert.equal(tax.filter((t) => t.supersededAtAttempt === null).length, 1, 'exactly one current version');
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE action = 'document.upload' AND applicationId = ?", id)).length, 4 + 11 + 1 + 2);
  // no orphan or missing files: every stored file has a row and every row has its file
  const onDisk = new Set(fs.readdirSync(docsDir()));
  const rows = (await q<any>('SELECT storedName FROM documents')).map((r) => r.storedName);
  assert.equal(rows.filter((s) => !onDisk.has(s)).length, 0, 'every document row has its file');
  assert.equal([...onDisk].filter((f) => !rows.includes(f)).length, 0, 'no orphan file from the rejected upload');
  assertIntact();
});

test('MP-4 two conflicting reviewer decisions from two processes on the same version: exactly one wins', async () => {
  await closeOpen(c.factory);
  const id = await advanceTo('IMC_REVIEW', c, 'IND-MP-4');
  const v = (await appRow(id)).version;
  const { results: [a, b] } = await race([A, B], () => [
    c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: v }),
    on(c.imc2, B).post(`/applications/${id}/actions/request_correction`, { expectedVersion: v, deficiencies: [{ field: 'address', note: 'mp' }] }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.json, b.json]));
  assert.equal((a.status === 409 ? a : b).json.code, 'VERSION_CONFLICT');
  const row = await appRow(id);
  assert.equal(row.version, v + 1);
  assert.equal(row.state, a.status === 200 ? 'ENCPC_REVIEW' : 'IMC_CORRECTION');
  assert.equal((await q("SELECT 1 FROM application_transitions WHERE applicationId = ? AND fromState = 'IMC_REVIEW'", id)).length, 1);
  assert.equal((await q('SELECT 1 FROM deficiencies WHERE applicationId = ?', id)).length, a.status === 200 ? 0 : 1);
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE applicationId = ? AND action IN ('application.accept','application.request_correction')", id)).length, 1);
  assertIntact();
});

test('MP-5 the factory chooses two different banks from two processes at once: one choice wins and every record agrees (G-01)', async () => {
  await closeOpen(c.factory);
  const id = await advanceTo('BANK_SELECTION', c, 'IND-MP-5');
  const v = (await appRow(id)).version;
  const { results: [ra, rb] } = await race([A, B], () => [
    c.factory.post(`/applications/${id}/actions/select_bank`, { expectedVersion: v, bankOrgId: BANK_A }),
    on(c.factory, B).post(`/applications/${id}/actions/select_bank`, { expectedVersion: v, bankOrgId: BANK_B }),
  ]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409], JSON.stringify([ra.json, rb.json]));
  const winner = ra.status === 200 ? BANK_A : BANK_B;
  const row = await appRow(id);
  const ref = (await q<any>('SELECT * FROM bank_referrals WHERE applicationId = ?', id));
  assert.equal(row.state, 'CONTRACT_OUTCOME'); assert.equal(row.version, v + 1);
  assert.equal(ref.length, 1); assert.equal(ref[0].bankOrgId, winner);
  const tr = await q<any>("SELECT payload FROM application_transitions WHERE applicationId = ? AND action = 'select_bank'", id);
  assert.equal(tr.length, 1); assert.equal(JSON.parse(tr[0].payload).bankOrgId, winner);
  assertIntact();
});

test('MP-6 concurrent electricity approvals from two processes: one transition to the bank choice, no referral', async () => {
  await closeOpen(c.factory);
  const id = await advanceTo('ELECTRICITY_REVIEW', c, 'IND-MP-6');
  const v = (await appRow(id)).version;
  const { results: [a, b] } = await race([A, B], () => [
    c.pmu.post(`/applications/${id}/actions/accept`, { expectedVersion: v }),
    on(c.pmu, B).post(`/applications/${id}/actions/accept`, { expectedVersion: v }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const row = await appRow(id);
  assert.equal(row.state, 'CONTRACT_OUTCOME'); assert.equal(row.version, v + 1);
  assert.equal((await q('SELECT 1 FROM bank_referrals WHERE applicationId = ?', id)).length, 0, 'G-01: the factory chooses the bank next');
  assert.equal((await q("SELECT 1 FROM application_transitions WHERE applicationId = ? AND fromState = 'ELECTRICITY_REVIEW' AND toState = 'CONTRACT_OUTCOME'", id)).length, 1);
  const keys = await q<any>('SELECT dedupeKey FROM notification_outbox WHERE applicationId = ?', id);
  assert.equal(new Set(keys.map((k) => k.dedupeKey)).size, keys.length, 'no duplicate notification rows');
  assertIntact();
});

test('MP-7a two processes save different fields of the same draft section at the same time: no lost update', async () => {
  await closeOpen(c.factory);
  const id = await createCompleteDraft(c.factory, 'IND-MP-7A');
  const { results: [a, b] } = await race([A, B], () => [
    c.factory.put(`/applications/${id}/data/general`, { address: 'عنوان من العملية أ' }),
    on(c.factory, B).put(`/applications/${id}/data/general`, { phone1: '0229999999' }),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  const data = JSON.parse((await q<any>("SELECT data FROM application_data WHERE applicationId = ? AND section = 'general' AND attempt = 1", id))[0].data);
  assert.equal(data.address, 'عنوان من العملية أ');
  assert.equal(data.phone1, '0229999999');
  assertIntact();
});

/**
 * Invariant: nothing is written into an attempt that reviewers already received. After a submission of attempt N
 * (transition at time T), no form data or document of attempt <= N may have been created or updated after T.
 */
async function writesAfterSubmission(id: string): Promise<{ data: number; docs: number }> {
  const row = await appRow(id);
  const t = (await q<any>("SELECT createdAt FROM application_transitions WHERE applicationId = ? AND fromState = 'DRAFT' AND toState <> 'DRAFT' ORDER BY createdAt DESC LIMIT 1", id))[0];
  if (!t) return { data: 0, docs: 0 };
  const data = (await q('SELECT 1 FROM application_data WHERE applicationId = ? AND attempt <= ? AND updatedAt > ?', id, row.attempt, t.createdAt)).length;
  const docs = (await q('SELECT 1 FROM documents WHERE applicationId = ? AND attempt <= ? AND createdAt > ?', id, row.attempt, t.createdAt)).length;
  return { data, docs };
}

test('MP-7b a draft save or upload that read DRAFT before a submission committed must not write into the submitted attempt (deterministic)', async () => {
  // The write lock is held by the test. Process B reads the application (DRAFT) and blocks in BEGIN IMMEDIATE. While B waits,
  // the lock holder commits the same state change a submission commits (DRAFT -> IMC_REVIEW, attempt 0 -> 1, version + 1, transition row).
  // When B then gets the lock it must re-check the state inside its own transaction.
  const failures: string[] = [];
  for (const kind of ['save', 'upload'] as const) {
    await closeOpen(c.factory);
    const id = await createCompleteDraft(c.factory, `IND-MP-7B-${kind}`);
    const fb = on(c.factory, B);
    lock.acquire();
    const p = kind === 'save'
      ? fb.put(`/applications/${id}/data/general`, { address: 'كُتب بعد الإرسال' })
      : fb.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('mp7b-late'), 'late.pdf');
    await lock.waitBlocked([B]);
    const ts = new Date().toISOString();
    lock.commitWith([
      `UPDATE applications SET state = 'IMC_REVIEW', attempt = 1, version = version + 1, number = 'MP7B-${kind}', submittedAt = '${ts}', stateEnteredAt = '${ts}', updatedAt = '${ts}' WHERE id = '${id}'`,
      `INSERT INTO application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, payload, createdAt) VALUES ('trn-mp7b-${kind}', '${id}', 'DRAFT', 'IMC_REVIEW', 'submit', 'factory_owner', 1, '{}', '${ts}')`,
    ]);
    const r = await p;
    const leaked = await writesAfterSubmission(id);
    if (leaked.data || leaked.docs) failures.push(`${kind}: wrote into the submitted attempt ${JSON.stringify(leaked)} (HTTP ${r.status} ${JSON.stringify(r.json)})`);
    else if (r.status !== 409) failures.push(`${kind}: expected 409, got ${r.status} ${JSON.stringify(r.json)}`);
    else console.log(`[MP-7b] ${kind}: refused ${r.status}/${r.json.code}`);
    // the simulated submission is not a real one: close it so the next iteration can open a draft
    lock.acquire();
    lock.commitWith([`UPDATE applications SET state = 'WITHDRAWN', closedAt = '${new Date().toISOString()}' WHERE id = '${id}'`]);
  }
  assert.deepEqual(failures, []);
  const onDisk = new Set(fs.readdirSync(docsDir()));
  const rows = new Set((await q<any>('SELECT storedName FROM documents')).map((x) => x.storedName));
  assert.equal([...onDisk].filter((f) => !rows.has(f)).length, 0, 'the refused upload left no orphan file');
  assertIntact();
});

test('MP-7c real submit in one process vs draft save in another (6 trials, both arrival orders): never writes into the submitted attempt', async () => {
  // No simulated commit here: both sides run the real code. Which waiter gets the lock first after release is up to SQLite's
  // busy handler, so the trials alternate which request starts waiting first; the outcome of each trial is logged.
  const outcomes: string[] = [];
  const failures: string[] = [];
  for (let i = 0; i < 6; i++) {
    await closeOpen(c.factory);
    const id = await createCompleteDraft(c.factory, `IND-MP-7C-${i}`);
    const v = (await appRow(id)).version;
    const submitFirst = i % 2 === 0;
    lock.acquire();
    let pSubmit: Promise<Res> | undefined; let pSave: Promise<Res> | undefined;
    const fireSubmit = () => c.factory.post(`/applications/${id}/actions/submit`, { expectedVersion: v }); // process A
    const fireSave = () => on(c.factory, B).put(`/applications/${id}/data/general`, { address: `سباق ${i}` }); // process B
    try {
      if (submitFirst) { pSubmit = fireSubmit(); await lock.waitBlocked([A]); pSave = fireSave(); await lock.waitBlocked([B]); }
      else { pSave = fireSave(); await lock.waitBlocked([B]); pSubmit = fireSubmit(); await lock.waitBlocked([A]); }
    } finally { lock.release(); }
    const [s, w] = await Promise.all([pSubmit!, pSave!]);
    const o = `${submitFirst ? 'submit-first' : 'save-first'}: submit=${s.status}${s.json?.code ? `/${s.json.code}` : ''} save=${w.status}${w.json?.code ? `/${w.json.code}` : ''}`;
    outcomes.push(o);
    const leaked = await writesAfterSubmission(id);
    if (leaked.data || leaked.docs) failures.push(`trial ${i} wrote into the submitted attempt: ${o}`);
    // exactly one of the two may succeed: either the save landed first (submit refused as changed) or the submit did (save refused)
    else if ((s.status === 200) === (w.status === 200)) failures.push(`trial ${i} both or neither succeeded: ${o}`);
  }
  console.log(`[MP-7c] outcomes: ${outcomes.join(' | ')}`);
  assert.deepEqual(failures, []);
  assertIntact();
});

test('MP-7d provider deactivated by another process while a selection waits for the lock: the selection is refused', async () => {
  await closeOpen(c.factory);
  const id = await advanceTo('PROVIDER_SELECTION', c, 'IND-MP-7D');
  const v = (await appRow(id)).version;
  const { PROVIDER_OK } = await import('./helpers.js');
  lock.acquire();
  const p = c.factory.post(`/applications/${id}/actions/select_provider`, { expectedVersion: v, providerId: PROVIDER_OK });
  await lock.waitBlocked([A]); // process A already checked the provider (selectable) and waits for the lock
  lock.commitWith([`UPDATE service_providers SET isActive = 0 WHERE id = '${PROVIDER_OK}'`]);
  const r = await p;
  lock.acquire();
  lock.commitWith([`UPDATE service_providers SET isActive = 1 WHERE id = '${PROVIDER_OK}'`]);
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(r.json.code, 'PROVIDER_NOT_APPROVED');
  const row = await appRow(id);
  assert.equal(row.state, 'PROVIDER_SELECTION'); assert.equal(row.providerId, null); assert.equal(row.version, v);
  assertIntact();
});

test('MP-8 a process killed in the middle of a write transaction leaves no partial state and no stale lock', async () => {
  await closeOpen(c.factory);
  const id = await createCompleteDraft(c.factory, 'IND-MP-8');
  const before_ = await appRow(id);
  const auditBefore = (await q('SELECT COUNT(*) AS n FROM audit_logs'))[0] as any;
  const child = spawnCrashChild({ MP_APP_ID: id });
  await child.inTx; // the child holds the write lock with uncommitted writes
  const exited = new Promise((r) => child.proc.once('exit', r));
  child.proc.kill('SIGKILL');
  await exited;
  const row = await appRow(id);
  assert.equal(row.state, 'DRAFT'); assert.equal(row.version, before_.version); assert.equal(row.attempt, before_.attempt); assert.equal(row.number, null);
  assert.equal((await q("SELECT 1 FROM application_transitions WHERE id = 'trn-crash-child'")).length, 0);
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE action = 'mp.crash_filler'")).length, 0);
  assert.equal(((await q('SELECT COUNT(*) AS n FROM audit_logs'))[0] as any).n, auditBefore.n);
  // the lock died with the process: another process writes immediately
  const t0 = Date.now();
  const r = await on(c.factory, B).post(`/applications/${id}/actions/submit`, { expectedVersion: before_.version });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Date.now() - t0 < 4000, 'no wait for a stale lock');
  assertIntact();
});

test('MP-9 write lock held longer than busy_timeout: the request fails cleanly as retryable, without partial state or leaked internals', async () => {
  await closeOpen(c.factory);
  const id = await advanceTo('IMC_REVIEW', c, 'IND-MP-9');
  const v = (await appRow(id)).version;
  lock.acquire();
  let r: Res;
  try { r = await c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: v }); } finally { lock.release(); }
  assert.equal(r!.status, 503, JSON.stringify(r!.json));
  assert.equal(r!.json.code, 'DB_BUSY');
  assert.ok(r!.headers.get('retry-after'), 'Retry-After header');
  assert.doesNotMatch(JSON.stringify(r!.json), /sqlite|database is locked|SQLITE_BUSY/i, 'no internal error text');
  const row = await appRow(id);
  assert.equal(row.state, 'IMC_REVIEW'); assert.equal(row.version, v);
  // the same request succeeds once the lock is free
  assert.equal((await c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: v })).status, 200);
  assertIntact();
});
