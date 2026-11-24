// تدقيق منطق الأعمال — اختبارات الانحدار للمراحل (docs/BUSINESS_LOGIC_AUDIT.md).
// المرحلة 1 (F-01): لقطة التقديم يجب أن تكون هي نفسها ما تحقق منه السجل الصناعي، حتى لو عدّل المصنع بياناته أثناء انتظار الرد.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { isolateTestEnv, startServer, clients, createCompleteDraft, act, advanceTo, getApp, q, pdfVariant, FORM_DOCS, PDF, PROVIDER_OK, BANK_A, BANK_B, uploadContractFile, type Started, type Client } from './helpers.js';

const env = isolateTestEnv('business-audit');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

// ── سجل صناعي وهمي بسلوك قابل للتحكم: INVALID* → 404، DOWN* → 503، SLOW* → بطيء، وإلا صحيح (ويُحجز عند reg.holding) ──
const reg = { hits: 0, holding: false, waiters: [] as Array<() => void>, delayMs: 1500 };
let fake: http.Server;

function releaseAll() { reg.holding = false; for (const w of reg.waiters.splice(0)) w(); }

before(async () => {
  srv = await startServer();
  c = await clients(srv.base);
  fake = http.createServer(async (req, res) => {
    reg.hits++;
    const num = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    if (num.startsWith('SLOW')) await new Promise((r) => setTimeout(r, reg.delayMs));
    else if (reg.holding) await new Promise<void>((r) => reg.waiters.push(r));
    if (num.startsWith('INVALID')) { res.writeHead(404); res.end(); return; }
    if (num.startsWith('DOWN')) { res.writeHead(503); res.end('down'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ found: true, registration: { number: num, name: 'منشأة من السجل', status: 'active' } }));
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  process.env.REGISTRY_ADAPTER = 'http';
  process.env.REGISTRY_API_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.REGISTRY_API_KEY = 'test-key';
});
after(async () => {
  releaseAll();
  process.env.REGISTRY_ADAPTER = 'mock';
  delete process.env.REGISTRY_TIMEOUT_MS;
  await new Promise((r) => fake.close(() => r(null)));
  await srv.close();
  await env.cleanup();
});

async function waitFor(cond: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** يبدأ الإرسال دون انتظار الرد (يبقى معلقًا عند السجل الوهمي إن كان reg.holding). */
async function startSubmit(cl: Client, id: string) {
  const app = await getApp(cl, id);
  return cl.post(`/applications/${id}/actions/submit`, { expectedVersion: app.version });
}

/**
 * كل مسودة تُنشأ عبر draft() تُغلق بعد الاختبار (نجح أو فشل) حتى لا يُسمم فشل اختبار ما بعده:
 * المصنع له طلب مفتوح واحد، والانسحاب مسموح من أي حالة غير نهائية.
 */
const opened: Array<{ cl: Client; id: string }> = [];
async function draft(cl: Client, regNumber: string) {
  const id = await createCompleteDraft(cl, regNumber);
  opened.push({ cl, id });
  return id;
}
afterEach(async () => {
  releaseAll();
  for (const { cl, id } of opened.splice(0)) {
    const s = (await appRow(id)).state;
    if (!['REJECTED', 'CONTRACTED', 'CLOSED_NOT_CONTRACTED', 'WITHDRAWN'].includes(s)) {
      const r = await act(cl, id, 'withdraw', { reason: 'تنظيف اختبار' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
  }
});

async function appRow(id: string) {
  return (await q<any>('SELECT state, number, attempt, submittedAt, industrialRegistryNumber, verifiedRegistryNumber, registryVerificationId, bankOrgId FROM shams_applications WHERE id = ?', id))[0];
}
const count = async (sql: string, ...p: Array<string | number>) => Number((await q<{ n: number }>(sql, ...p))[0].n);

/** لم يحدث أي تقديم: لا رقم، لا تحقق صحيح، لا انتقال، والطلب ما زال مسودة. */
async function assertNothingSubmitted(id: string) {
  const a = await appRow(id);
  assert.equal(a.state, 'DRAFT');
  assert.equal(a.number, null, 'no application number issued');
  assert.equal(a.submittedAt, null);
  assert.equal(a.attempt, 0);
  assert.equal(a.verifiedRegistryNumber, null);
  assert.equal(a.registryVerificationId, null);
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_registry_verifications WHERE applicationId = ? AND result = 'valid'", id), 0, 'no stale valid verification');
  assert.equal(await count('SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ?', id), 0, 'no transition');
}

/** تقديم ناجح متسق: الأعمدة = بيانات المحاولة المُرسلة = الرقم الذي تحقق منه السجل، وانتقال واحد فقط، والمستندات الفعالة موجودة. */
async function assertConsistentSubmission(id: string, expectedNumber: string) {
  const a = await appRow(id);
  assert.equal(a.state, 'IMC_REVIEW');
  assert.match(a.number, /^SHAMS-\d{4}-\d{5}$/);
  const data = JSON.parse((await q<{ data: string }>("SELECT data FROM shams_application_data WHERE applicationId = ? AND section = 'company' AND attempt = ?", id, a.attempt))[0].data);
  assert.equal(data.industrialRegistryNumber, expectedNumber, 'submitted data holds the verified number');
  assert.equal(a.industrialRegistryNumber, expectedNumber, 'column matches submitted data');
  assert.equal(a.verifiedRegistryNumber, expectedNumber);
  const v = (await q<any>('SELECT registryNumber, result FROM shams_registry_verifications WHERE id = ?', a.registryVerificationId))[0];
  assert.deepEqual({ ...v }, { registryNumber: expectedNumber, result: 'valid' });
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ? AND toState = 'IMC_REVIEW'", id), 1, 'exactly one transition');
  for (const kind of FORM_DOCS) {
    assert.ok(await count('SELECT COUNT(*) AS n FROM shams_documents WHERE applicationId = ? AND kind = ? AND supersededAtAttempt IS NULL', id, kind) >= 1, `active ${kind}`);
  }
  assert.ok(await count("SELECT COUNT(*) AS n FROM shams_documents WHERE applicationId = ? AND kind = 'electricityBill' AND supersededAtAttempt IS NULL", id) >= 1, 'active electricity bill');
}

// ── 1–4: الحالات الأساسية ────────────────────────────────────────────────────
test('F-01/1) valid registry submission: number issued, data and columns consistent', async () => {
  const id = await draft(c.factory, 'IND-AUD-1');
  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await assertConsistentSubmission(id, 'IND-AUD-1');
});

test('F-01/2) invalid registry number: stays DRAFT, no number, no valid verification', async () => {
  const id = await draft(c.factory, 'INVALID-AUD-2');
  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'REGISTRY_INVALID');
  const a = await appRow(id);
  assert.equal(a.state, 'DRAFT'); assert.equal(a.number, null);
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_registry_verifications WHERE applicationId = ? AND result = 'valid'", id), 0);
});

test('F-01/3) registry timeout: unavailable (TIMEOUT), nothing submitted', async () => {
  process.env.REGISTRY_TIMEOUT_MS = '300';
  try {
    const id = await draft(c.factory, 'SLOW-AUD-3');
    const r = await act(c.factory, id, 'submit');
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'REGISTRY_UNAVAILABLE');
    assert.equal((await q<any>("SELECT errorCode, result FROM shams_registry_verifications WHERE applicationId = ?", id))[0].errorCode, 'TIMEOUT');
    const a = await appRow(id);
    assert.equal(a.state, 'DRAFT'); assert.equal(a.number, null);
  } finally { delete process.env.REGISTRY_TIMEOUT_MS; }
});

test('F-01/4) registry unavailable (503): nothing submitted, retry later succeeds after the number is fixed', async () => {
  const id = await draft(c.factory, 'DOWN-AUD-4');
  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'REGISTRY_UNAVAILABLE');
  assert.equal((await appRow(id)).number, null);
  assert.equal((await c.factory.put(`/applications/${id}/data/company`, { industrialRegistryNumber: 'IND-AUD-4B' })).status, 200);
  const ok = await act(c.factory, id, 'submit');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  await assertConsistentSubmission(id, 'IND-AUD-4B');
});

// ── 5–8: تعديل أثناء انتظار رد السجل ─────────────────────────────────────────
/** يشغّل submit معلقًا عند السجل، ينفذ mutate أثناء الانتظار، ثم يحرر الرد ويرجع رد الإرسال. */
async function submitWhileMutating(cl: Client, id: string, mutate: () => Promise<void>) {
  reg.holding = true;
  const before = reg.hits;
  try {
    const pending = startSubmit(cl, id);
    await waitFor(() => reg.hits > before, 'registry request');
    await mutate();
    releaseAll();
    return await pending;
  } finally { releaseAll(); }
}

test('F-01/5) company data edited during the registry delay → 409, nothing submitted', async () => {
  const id = await draft(c.factory, 'IND-AUD-5');
  const r = await submitWhileMutating(c.factory, id, async () => {
    const e = await c.factory.put(`/applications/${id}/data/company`, { taxNumber: '999-888-777' });
    assert.equal(e.status, 200);
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBMISSION_DATA_CHANGED');
  await assertNothingSubmitted(id);
});

test('F-01/6) registry number changed during the registry delay → 409, the unverified number is never submitted', async () => {
  const id = await draft(c.factory, 'IND-AUD-6A');
  const r = await submitWhileMutating(c.factory, id, async () => {
    const e = await c.factory.put(`/applications/${id}/data/company`, { industrialRegistryNumber: 'IND-AUD-6B' });
    assert.equal(e.status, 200);
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBMISSION_DATA_CHANGED');
  await assertNothingSubmitted(id);
  assert.equal((await appRow(id)).industrialRegistryNumber, null, 'column untouched');
});

test('F-01/7) every electricity bill removed during the registry delay → 409, nothing submitted', async () => {
  const id = await draft(c.factory, 'IND-AUD-7');
  const r = await submitWhileMutating(c.factory, id, async () => {
    const bills = (await getApp(c.factory, id)).documents.filter((d: any) => d.kind === 'electricityBill');
    assert.equal(bills.length, 3);
    for (const b of bills) assert.equal((await c.factory.del(`/applications/${id}/documents/${b.id}`)).status, 200);
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBMISSION_DATA_CHANGED');
  await assertNothingSubmitted(id);
});

test('F-01/8) a document replaced during the registry delay → 409, nothing submitted, both versions kept', async () => {
  const id = await draft(c.factory, 'IND-AUD-8');
  const r = await submitWhileMutating(c.factory, id, async () => {
    const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('replacement'), 'tax2.pdf');
    assert.equal(up.status, 201);
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBMISSION_DATA_CHANGED');
  await assertNothingSubmitted(id);
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_documents WHERE applicationId = ? AND kind = 'taxCardFile'", id), 2, 'history kept');
});

// ── 9: تقديم متزامن من نفس المصنع ────────────────────────────────────────────
test('F-01/9) two concurrent submissions of the same draft: exactly one wins, one transition, one valid verification', async () => {
  const id = await draft(c.factory, 'IND-AUD-9');
  reg.holding = true;
  const before = reg.hits;
  try {
    const app = await getApp(c.factory, id);
    const body = { expectedVersion: app.version };
    const p1 = c.factory.post(`/applications/${id}/actions/submit`, body);
    const p2 = c.factory.post(`/applications/${id}/actions/submit`, body);
    await waitFor(() => reg.hits >= before + 2, 'both registry requests');
    releaseAll();
    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify([r1.json, r2.json]));
    assert.equal([r1, r2].find((r) => r.status === 409)!.json.code, 'VERSION_CONFLICT');
  } finally { releaseAll(); }
  await assertConsistentSubmission(id, 'IND-AUD-9');
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_registry_verifications WHERE applicationId = ? AND result = 'valid'", id), 1);
});

// ── 10: مصنعان بنفس رقم السجل ────────────────────────────────────────────────
test('F-01/10) two factories submit the same registry number concurrently: one wins, the other gets DUPLICATE_REGISTRY and a recorded conflict', async () => {
  const idA = await draft(c.factory, 'IND-AUD-10');
  const idB = await draft(c.factory2, 'IND-AUD-10');
  reg.holding = true;
  const before = reg.hits;
  let rA: any, rB: any;
  try {
    const appA = await getApp(c.factory, idA); const appB = await getApp(c.factory2, idB);
    const pA = c.factory.post(`/applications/${idA}/actions/submit`, { expectedVersion: appA.version });
    const pB = c.factory2.post(`/applications/${idB}/actions/submit`, { expectedVersion: appB.version });
    await waitFor(() => reg.hits >= before + 2, 'both registry requests');
    releaseAll();
    [rA, rB] = await Promise.all([pA, pB]);
  } finally { releaseAll(); }
  assert.deepEqual([rA.status, rB.status].sort(), [200, 409], JSON.stringify([rA.json, rB.json]));
  const [winner, loser] = rA.status === 200 ? [idA, idB] : [idB, idA];
  assert.equal((rA.status === 409 ? rA : rB).json.code, 'DUPLICATE_REGISTRY');
  await assertConsistentSubmission(winner, 'IND-AUD-10');
  assert.equal((await appRow(loser)).state, 'DRAFT');
  assert.equal((await appRow(loser)).number, null);
  const conflicts = await q<any>('SELECT attemptedApplicationId, holdingApplicationId FROM shams_registry_conflicts WHERE registryNumber = ?', 'IND-AUD-10');
  assert.equal(conflicts.length, 1, 'the losing submission is recorded as a conflict (rule I3)');
  assert.deepEqual({ ...conflicts[0] }, { attemptedApplicationId: loser, holdingApplicationId: winner });
  assert.ok(await count("SELECT COUNT(*) AS n FROM notification_outbox WHERE applicationId = ? AND templateKey = 'ops.registry_conflict'", winner) >= 1, 'IMC/PMU notified');
});

// ── 11: إعادة المحاولة بعد تقديم فاشل ────────────────────────────────────────
test('F-01/11) retry after a submission that failed because data changed: succeeds and is fully consistent', async () => {
  const id = await draft(c.factory, 'IND-AUD-11A');
  const r = await submitWhileMutating(c.factory, id, async () => {
    assert.equal((await c.factory.put(`/applications/${id}/data/company`, { industrialRegistryNumber: 'IND-AUD-11B' })).status, 200);
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBMISSION_DATA_CHANGED');
  await assertNothingSubmitted(id);
  const retry = await act(c.factory, id, 'submit');
  assert.equal(retry.status, 200, JSON.stringify(retry.json));
  await assertConsistentSubmission(id, 'IND-AUD-11B');
});

// ── 12–14: إعادة فحص الحالة داخل معاملة الالتزام ──────────────────────────────
test('F-01/12) an "invalid registry" answer is not recorded against data that changed meanwhile', async () => {
  const id = await draft(c.factory, 'INVALID-AUD-12');
  const r = await submitWhileMutating(c.factory, id, async () => {
    assert.equal((await c.factory.put(`/applications/${id}/data/company`, { taxNumber: '111-222-333' })).status, 200);
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'SUBMISSION_DATA_CHANGED');
  assert.equal(await count('SELECT COUNT(*) AS n FROM shams_registry_verifications WHERE applicationId = ?', id), 0, 'no verification row of any kind');
  assert.equal(await count('SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ?', id), 0);
});

test('F-01/13) a registry block created during the registry delay is enforced against the submitted snapshot', async () => {
  const id = await draft(c.factory, 'IND-AUD-13');
  const { insertBlock } = await import('../store/registry.js');
  const r = await submitWhileMutating(c.factory, id, async () => {
    await insertBlock({ registryNumber: 'IND-AUD-13', factoryId: null, applicationId: null, transitionId: null, source: 'pmu_dispute', createdBy: c.pmu.user.id });
  });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'REGISTRY_BLOCKED');
  await assertNothingSubmitted(id);
});

test('F-01/14) another factory takes the number during the registry delay: the slower one is refused, conflict recorded, IMC and PMU notified', async () => {
  const slow = await draft(c.factory, 'IND-AUD-14');
  const fast = await draft(c.factory2, 'IND-AUD-14');
  reg.holding = true;
  const before = reg.hits;
  let rSlow: any;
  try {
    const pSlow = startSubmit(c.factory, slow);
    await waitFor(() => reg.hits > before, 'registry request of the slow submission');
    reg.holding = false; // الطلب المعلّق يبقى عند السجل؛ الطلب التالي يمر فورًا
    const rFast = await startSubmit(c.factory2, fast);
    assert.equal(rFast.status, 200, JSON.stringify(rFast.json));
    releaseAll();
    rSlow = await pSlow;
  } finally { releaseAll(); }
  assert.equal(rSlow.status, 409, JSON.stringify(rSlow.json));
  assert.equal(rSlow.json.code, 'DUPLICATE_REGISTRY');
  await assertNothingSubmitted(slow);
  await assertConsistentSubmission(fast, 'IND-AUD-14');
  const conflicts = await q<any>('SELECT attemptedApplicationId, holdingApplicationId FROM shams_registry_conflicts WHERE registryNumber = ?', 'IND-AUD-14');
  assert.deepEqual(conflicts.map((x) => ({ ...x })), [{ attemptedApplicationId: slow, holdingApplicationId: fast }]);
  assert.ok(await count("SELECT COUNT(*) AS n FROM notification_outbox WHERE applicationId = ? AND templateKey = 'ops.registry_conflict'", fast) >= 1);
});

// ══ المرحلة 3 (F-05): حدود تخزين المستندات — shamsPolicy.documentLimits ══════════════════════════════════════════
// الحد يشمل كل النسخ المحفوظة (المستبدَلة والمُزالة أيضًا) لأن الملفات كلها تبقى على القرص (قرار الإدارة)، ولا تُحذف نسخة تاريخية.

type Limits = Partial<{ maxVersionsPerKindPerAttempt: number; maxApplicationStorageMB: number }>;
async function withLimits(patch: Limits, fn: () => Promise<void>) {
  const { shamsPolicy } = await import('../config/shamsPolicy.js');
  const saved = { ...shamsPolicy.documentLimits };
  Object.assign(shamsPolicy.documentLimits, patch);
  try { await fn(); } finally { Object.assign(shamsPolicy.documentLimits, saved); }
}

const up = (cl: Client, id: string, kind: string, tag: string, bytes?: Buffer) =>
  cl.upload(`/applications/${id}/documents`, { kind }, bytes ?? pdfVariant(tag), `${tag}.pdf`);

/** كل ملف مخزن له صف، وكل صف له ملف، ولا بقايا في المجلد المؤقت (الحذف المؤقت غير متزامن فننتظر قليلًا). */
async function assertNoOrphans() {
  await new Promise((r) => setTimeout(r, 200));
  const docsDir = path.join(process.env.UPLOAD_DIR!, 'shams', 'documents');
  const tmpDir = path.join(process.env.UPLOAD_DIR!, 'tmp');
  const files = (fs.existsSync(docsDir) ? fs.readdirSync(docsDir) : []).sort();
  const rows = (await q<{ storedName: string }>('SELECT storedName FROM shams_documents')).map((r) => r.storedName).sort();
  assert.deepEqual(files, rows, 'stored files and document rows match one to one');
  assert.deepEqual(fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [], [], 'no temporary leftovers');
}

const versionsOf = async (id: string, kind: string) =>
  (await q<any>('SELECT version, status, supersededAtAttempt FROM shams_documents WHERE applicationId = ? AND kind = ? ORDER BY version', id, kind)).map((r) => ({ ...r }));

test('F-05/1) version limit per kind per attempt: 422 TOO_MANY_VERSIONS, the current version and the history are untouched', async () => {
  await withLimits({ maxVersionsPerKindPerAttempt: 3 }, async () => {
    const id = await draft(c.factory, 'IND-F05-1'); // كل نوع له النسخة 1
    assert.equal((await up(c.factory, id, 'taxCardFile', 'tax-v2')).status, 201);
    assert.equal((await up(c.factory, id, 'taxCardFile', 'tax-v3')).status, 201);
    const r = await up(c.factory, id, 'taxCardFile', 'tax-v4');
    assert.equal(r.status, 422, JSON.stringify(r.json));
    assert.equal(r.json.code, 'TOO_MANY_VERSIONS');
    assert.deepEqual(await versionsOf(id, 'taxCardFile'), [
      { version: 1, status: 'superseded', supersededAtAttempt: 1 }, { version: 2, status: 'superseded', supersededAtAttempt: 1 }, { version: 3, status: 'current', supersededAtAttempt: null },
    ], 'the rejected upload did not supersede the current version');
    assert.equal((await up(c.factory, id, 'commercialRegisterFile', 'cr-v2')).status, 201, 'the limit is per kind');
    await assertNoOrphans();
  });
});

test('F-05/2) the version limit restarts with each attempt: a correction round can upload again', async () => {
  await withLimits({ maxVersionsPerKindPerAttempt: 2 }, async () => {
    const id = await draft(c.factory, 'IND-F05-2');
    assert.equal((await up(c.factory, id, 'taxCardFile', 'a2')).status, 201);
    assert.equal((await up(c.factory, id, 'taxCardFile', 'a3')).status, 422);
    assert.equal((await act(c.factory, id, 'submit')).status, 200);
    assert.equal((await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'taxCardFile', note: 'x' }] })).status, 200);
    assert.equal((await up(c.factory, id, 'taxCardFile', 'b1')).status, 201);
    assert.equal((await up(c.factory, id, 'taxCardFile', 'b2')).status, 201);
    const r = await up(c.factory, id, 'taxCardFile', 'b3');
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'TOO_MANY_VERSIONS');
    assert.equal((await versionsOf(id, 'taxCardFile')).length, 4, 'versions 1-2 of attempt 1 and 3-4 of attempt 2 are all kept');
    await assertNoOrphans();
  });
});

test('F-05/3) storage limit counts every retained version: 413 STORAGE_LIMIT even when the active documents would fit', async () => {
  const id = await draft(c.factory, 'IND-F05-3');
  const used = Number((await q<{ n: number }>('SELECT SUM(sizeBytes) AS n FROM shams_documents WHERE applicationId = ?', id))[0].n);
  const size = pdfVariant('s1').length;
  await withLimits({ maxApplicationStorageMB: (used + size * 1.5) / 1048576 }, async () => {
    assert.equal((await up(c.factory, id, 'taxCardFile', 's1')).status, 201, 'fits');
    const before = (await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length;
    const r = await up(c.factory, id, 'taxCardFile', 's2');
    assert.equal(r.status, 413, JSON.stringify(r.json));
    assert.equal(r.json.code, 'STORAGE_LIMIT');
    assert.equal((await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length, before, 'nothing was stored');
    assert.deepEqual((await versionsOf(id, 'taxCardFile')).map((v) => v.status), ['superseded', 'current'], 'history kept, current untouched');
    await assertNoOrphans();
  });
});

test('F-05/4) an individual file over the size limit is refused (413 FILE_TOO_LARGE) and leaves nothing behind', async () => {
  const id = await draft(c.factory, 'IND-F05-4');
  const before = (await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length;
  process.env.MAX_FILE_SIZE_MB = '1'; // الإعداد الحقيقي أعداد صحيحة؛ القيم الكسرية يتجاهلها محلل multipart وليست حالة إنتاج
  try {
    const r = await up(c.factory, id, 'taxCardFile', 'big', Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024, 0x41)]));
    assert.equal(r.status, 413, JSON.stringify(r.json));
    assert.equal(r.json.code, 'FILE_TOO_LARGE');
  } finally { delete process.env.MAX_FILE_SIZE_MB; }
  assert.equal((await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length, before);
  await assertNoOrphans();
});

test('F-05/5) two simultaneous uploads with one slot left: exactly one succeeds, nothing is lost or duplicated', async () => {
  await withLimits({ maxVersionsPerKindPerAttempt: 3 }, async () => {
    const id = await draft(c.factory, 'IND-F05-5');
    assert.equal((await up(c.factory, id, 'taxCardFile', 'pre')).status, 201); // 2 of 3 used
    const [r1, r2] = await Promise.all([up(c.factory, id, 'taxCardFile', 'race-a'), up(c.factory, id, 'taxCardFile', 'race-b')]);
    assert.deepEqual([r1.status, r2.status].sort(), [201, 422], JSON.stringify([r1.json, r2.json]));
    assert.equal([r1, r2].find((r) => r.status === 422)!.json.code, 'TOO_MANY_VERSIONS');
    const v = await versionsOf(id, 'taxCardFile');
    assert.equal(v.length, 3);
    assert.equal(v.filter((x) => x.status === 'current').length, 1, 'exactly one current version');
    assert.equal(v[2].version, 3);
    await assertNoOrphans();
  });
});

test('F-05/6) electricity bills: the 12-file cap holds under two simultaneous uploads', async () => {
  const id = await draft(c.factory, 'IND-F05-6'); // 3 فواتير
  for (let i = 0; i < 8; i++) assert.equal((await up(c.factory, id, 'electricityBill', `bill-extra-${i}`)).status, 201); // 11
  const [r1, r2] = await Promise.all([up(c.factory, id, 'electricityBill', 'bill-race-a'), up(c.factory, id, 'electricityBill', 'bill-race-b')]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 422], JSON.stringify([r1.json, r2.json]));
  assert.equal([r1, r2].find((r) => r.status === 422)!.json.code, 'TOO_MANY_FILES');
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_documents WHERE applicationId = ? AND kind = 'electricityBill' AND supersededAtAttempt IS NULL", id), 12);
  await assertNoOrphans();
});

test('F-05/7) rejected uploads change nothing: invalid PDF, another factory, and an application in a final state', async () => {
  const id = await draft(c.factory, 'IND-F05-7');
  const before = (await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length;
  const fake = await up(c.factory, id, 'taxCardFile', 'fake', Buffer.from('MZ\x90\x00 an exe renamed to pdf'));
  assert.equal(fake.status, 400);
  assert.equal(fake.json.code, 'INVALID_FILE_TYPE');
  const foreign = await up(c.factory2, id, 'taxCardFile', 'foreign');
  assert.equal(foreign.status, 404, 'another factory cannot even see the application');
  assert.equal((await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length, before);
  assert.equal((await act(c.factory, id, 'withdraw', { reason: 'إنهاء' })).status, 200);
  const late = await up(c.factory, id, 'taxCardFile', 'late');
  assert.equal(late.status, 409, JSON.stringify(late.json));
  assert.equal(late.json.code, 'INVALID_STATE');
  assert.equal((await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length, before);
  await assertNoOrphans();
});

// ══ المرحلة 4 (F-04): تغيير بيانات مقدم خدمة معتمد — فرق منظم في التدقيق + إشعار PMU، بلا تغيير في الاعتماد أو الظهور ═══════════════════
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PNG_OTHER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');

let provSeq = 0;
async function approvedProvider(extra: Record<string, unknown> = {}) {
  const r = await c.encpc.post('/service-providers', { nameAr: `مقدم تدقيق ${++provSeq}`, description: 'وصف أصلي للخدمة', website: 'orig-provider.example', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.data.id as string;
  assert.equal((await c.encpc.post(`/service-providers/${id}/activate`, {})).status, 200);
  assert.equal((await c.pmu.post(`/service-providers/${id}/approve`, {})).status, 200);
  return id;
}
const providerRow = async (id: string) => (await q<any>('SELECT status, isActive, approvedBy, approvedAt, suspendedAt FROM shams_service_providers WHERE id = ?', id))[0];
const lastAudit = async (action: string, id: string) => {
  const r = (await q<any>('SELECT actorType, actorUserId, actorRole, actorOrgId, integrationKeyId, actorName, details FROM audit_logs WHERE action = ? AND entityId = ? ORDER BY at DESC, rowid DESC LIMIT 1', action, id))[0];
  return r ? { ...r, details: JSON.parse(r.details) } : null;
};
const changedNotices = async () => count("SELECT COUNT(*) AS n FROM notification_outbox WHERE templateKey = 'ops.provider_changed' AND channel = 'email'");
const changedInbox = async () => count("SELECT COUNT(*) AS n FROM user_notifications WHERE templateKey = 'ops.provider_changed'");
const pmuEmails = async () => count("SELECT COUNT(DISTINCT lower(email)) AS n FROM users u JOIN initiative_memberships m ON m.userId = u.id AND m.initiativeId = 'shams' WHERE m.organizationId = 'org-pmu' AND m.role = 'pmu_reviewer' AND u.isActive = 1 AND m.status = 'active'");
const visibleToFactory = async (id: string) => ((await c.factory.get('/service-providers')).json.data.items as any[]).some((p) => p.id === id);

test('F-04/1) ENCPC edits an approved provider: structured diff, actor and source in the audit; PMU notified once; approval and visibility unchanged', async () => {
  const id = await approvedProvider();
  const before = await providerRow(id);
  const [n0, i0] = [await changedNotices(), await changedInbox()];
  const r = await c.encpc.put(`/service-providers/${id}`, { nameAr: 'اسم جديد لمقدم الخدمة', description: 'نطاق خدمة مختلف تمامًا' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = await lastAudit('provider.update', id);
  assert.deepEqual(a.details.changes, { nameAr: [`مقدم تدقيق ${provSeq}`, 'اسم جديد لمقدم الخدمة'], description: ['وصف أصلي للخدمة', 'نطاق خدمة مختلف تمامًا'] });
  assert.equal(a.details.classification, 'material');
  assert.equal(a.details.source, 'encpc');
  assert.equal(a.details.previousStatus, 'approved');
  assert.equal(a.details.providerId, id);
  assert.deepEqual({ type: a.actorType, user: a.actorUserId, role: a.actorRole, org: a.actorOrgId }, { type: 'user', user: c.encpc.user.id, role: 'encpc_reviewer', org: 'org-encpc' });
  assert.equal((await changedNotices()) - n0, await pmuEmails(), 'PMU is notified by email, once per PMU user');
  assert.equal((await changedInbox()) - i0, await pmuEmails(), 'and in the platform inbox');
  assert.deepEqual(await providerRow(id), before, 'approval, activation and timestamps of the approval are unchanged');
  assert.ok(await visibleToFactory(id), 'still visible to factories');
});

test('F-04/2) a no-op update, and an identical repeat, produce no diff and no notification', async () => {
  const id = await approvedProvider();
  assert.equal((await c.encpc.put(`/service-providers/${id}`, { description: 'وصف أول جديد' })).status, 200);
  const n1 = await changedNotices();
  for (let i = 0; i < 2; i++) {
    const r = await c.encpc.put(`/service-providers/${id}`, { description: 'وصف أول جديد' });
    assert.equal(r.status, 200);
    const a = await lastAudit('provider.update', id);
    assert.deepEqual(a.details.changes, {}, 'nothing changed');
    assert.equal(a.details.classification, 'none');
  }
  assert.equal(await changedNotices(), n1, 'no duplicate notification');
  assert.equal((await c.encpc.put(`/service-providers/${id}`, {})).status, 200);
  assert.equal(await changedNotices(), n1, 'an empty body changes nothing either');
});

test('F-04/3) cosmetic changes (formatting-only description, logo) are classified as cosmetic, audited, and still notify PMU', async () => {
  const id = await approvedProvider({ description: 'خدمات   الطاقة الشمسية' });
  const n0 = await changedNotices();
  assert.equal((await c.encpc.put(`/service-providers/${id}`, { description: 'خدمات الطاقة الشمسية ' })).status, 200);
  let a = await lastAudit('provider.update', id);
  assert.equal(a.details.classification, 'cosmetic', 'whitespace-only is formatting');
  assert.deepEqual(Object.keys(a.details.changes), ['description']);
  assert.equal((await changedNotices()) - n0, await pmuEmails());

  const n1 = await changedNotices();
  assert.equal((await c.encpc.upload(`/service-providers/${id}/logo`, {}, PNG_1x1, 'logo.png', 'image/png')).status, 200);
  a = await lastAudit('provider.logo', id);
  assert.equal(a.details.classification, 'cosmetic');
  assert.equal(a.details.changes.logo[0], null, 'no previous logo');
  assert.match(a.details.changes.logo[1], /^[a-f0-9]{12}$/);
  assert.equal((await changedNotices()) - n1, await pmuEmails());
  const firstSha = a.details.changes.logo[1];

  assert.equal((await c.encpc.upload(`/service-providers/${id}/logo`, {}, PNG_OTHER, 'logo2.png', 'image/png')).status, 200);
  a = await lastAudit('provider.logo', id);
  assert.equal(a.details.changes.logo[0], firstSha, 'previous logo fingerprint recorded');
  assert.notEqual(a.details.changes.logo[1], firstSha);
  assert.equal((await providerRow(id)).status, 'approved');
  assert.ok(await visibleToFactory(id));
});

test('F-04/4) contact details and internal notes are recorded as "changed" without their values', async () => {
  const id = await approvedProvider();
  const r = await c.encpc.put(`/service-providers/${id}`, { contactEmail: 'private.person@provider.example', contactPhone: '01099887766', contactName: 'اسم شخص خاص', notes: 'ملاحظة داخلية سرية' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const a = await lastAudit('provider.update', id);
  assert.deepEqual(a.details.changes, { contactName: 'changed', contactPhone: 'changed', contactEmail: 'changed', notes: 'changed' });
  assert.equal(a.details.classification, 'cosmetic');
  const raw = JSON.stringify(a.details);
  for (const secret of ['private.person@provider.example', '01099887766', 'اسم شخص خاص', 'ملاحظة داخلية سرية']) assert.ok(!raw.includes(secret), `value must not be logged: ${secret}`);
  const mailBody = (await q<{ body: string; textBody: string }>("SELECT body, textBody FROM notification_outbox WHERE templateKey = 'ops.provider_changed' ORDER BY createdAt DESC LIMIT 1"))[0];
  for (const secret of ['private.person@provider.example', '01099887766', 'ملاحظة داخلية سرية']) assert.ok(!mailBody.body.includes(secret) && !mailBody.textBody.includes(secret), 'nor in the email');
});

test('F-04/5) a provider that is not approved yet is audited but PMU is not notified', async () => {
  const created = await c.encpc.post('/service-providers', { nameAr: `مقدم غير معتمد ${++provSeq}`, description: 'وصف' });
  const id = created.json.data.id as string;
  const n0 = await changedNotices();
  assert.equal((await c.encpc.put(`/service-providers/${id}`, { description: 'وصف معدل' })).status, 200);
  const a = await lastAudit('provider.update', id);
  assert.deepEqual(a.details.changes, { description: ['وصف', 'وصف معدل'] });
  assert.equal(a.details.previousStatus, 'pending');
  assert.equal(await changedNotices(), n0);
  assert.equal((await providerRow(id)).status, 'pending');
});

test('F-04/6) the integration route is audited the same way (source "integration", the key is the actor) and cannot change approval or visibility', async () => {
  const id = await approvedProvider();
  const k = await c.admin.post('/admin/integration-keys', { name: 'f04-providers-key', scopes: ['manage_providers'], rateLimitPerMinute: 1000 });
  assert.equal(k.status, 201, JSON.stringify(k.json));
  const put = (body: unknown) => fetch(`${srv.integration}/service-providers/${id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${k.json.data.plaintextKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const before = await providerRow(id);
  const n0 = await changedNotices();
  assert.equal((await put({ nameAr: 'اسم عبر الربط' })).status, 200);
  const a = await lastAudit('provider.update', id);
  assert.equal(a.details.changes.nameAr[1], 'اسم عبر الربط');
  assert.equal(a.details.classification, 'material');
  assert.equal(a.details.source, 'integration');
  assert.deepEqual({ type: a.actorType, key: a.integrationKeyId, name: a.actorName }, { type: 'integration_key', key: k.json.data.key.id, name: 'f04-providers-key' });
  assert.equal((await changedNotices()) - n0, await pmuEmails());
  // لا تغيير في الاعتماد/التفعيل عبر الربط، وتكرار نفس التعديل بلا أثر
  assert.equal((await put({ status: 'suspended' })).status, 400);
  assert.equal((await put({ isActive: false })).status, 400);
  assert.equal((await put({ nameAr: 'اسم عبر الربط' })).status, 200);
  assert.equal((await changedNotices()) - n0, await pmuEmails(), 'repeat is a no-op');
  assert.deepEqual(await providerRow(id), before);
  assert.ok(await visibleToFactory(id));
});

test('F-04/7) the notification waits in the outbox for retry when mail cannot be sent, and is never duplicated by a retry run', async () => {
  const id = await approvedProvider();
  assert.equal((await c.encpc.put(`/service-providers/${id}`, { website: 'changed-site.example' })).status, 200);
  const rows = await q<any>("SELECT status, attempts, dedupeKey FROM notification_outbox WHERE templateKey = 'ops.provider_changed' AND dedupeKey LIKE ? ", `spc:${id}:%`);
  assert.equal(rows.length, await pmuEmails());
  assert.ok(rows.every((r) => ['pending', 'skipped'].includes(r.status)), 'queued, not lost');
  const { processNotifications } = await import('../jobs/notificationWorker.js');
  await processNotifications(200);
  await processNotifications(200);
  assert.equal((await q("SELECT 1 FROM notification_outbox WHERE templateKey = 'ops.provider_changed' AND dedupeKey LIKE ?", `spc:${id}:%`)).length, rows.length, 'no duplicates from the worker');
});

// ══ المرحلة 5 (F-06): مصدر حدث «مقدم الخدمة لم يعد متاحًا» — توثيق فقط، دون تغيير الأثر على الطلبات (القرار D16 مفتوح) ═══════════════════
// الأثر الحالي الموثق: PMU تُوقف **أو** ENCPC تُلغي التفعيل → OFFER_REVIEW/OFFER_CORRECTION تعود إلى OFFER_UPLOAD؛ قبل إرسال العرض تنبيه؛ بعد القبول تنبيه PMU فقط.

const SNAP_APPROVED_ACTIVE = { status: 'approved', isActive: true };
async function inFlight(target: Parameters<typeof advanceTo>[0], regNumber: string) {
  const id = await advanceTo(target, c, regNumber);
  opened.push({ cl: c.factory, id });
  return id;
}
const returnPayload = async (id: string) =>
  JSON.parse((await q<{ payload: string }>("SELECT payload FROM shams_application_transitions WHERE applicationId = ? AND action = 'provider_suspended_return'", id))[0].payload);
const appAudit = async (action: string, id: string) => {
  const r = (await q<any>('SELECT actorType, actorUserId, actorRole, actorOrgId, details FROM audit_logs WHERE action = ? AND applicationId = ? ORDER BY at DESC, rowid DESC LIMIT 1', action, id))[0];
  return r ? { ...r, details: JSON.parse(r.details) } : null;
};

test('F-06/1) PMU suspension during offer review: the automatic return records its source, both provider snapshots and both application states', async () => {
  const id = await inFlight('OFFER_REVIEW', 'IND-F06-1');
  assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 200);
  try {
    assert.equal((await appRow(id)).state, 'OFFER_UPLOAD', 'current documented behavior is unchanged');
    const p = await returnPayload(id);
    assert.deepEqual(p.providerEvent, { source: 'pmu_suspend', providerId: PROVIDER_OK, before: SNAP_APPROVED_ACTIVE, after: { status: 'suspended', isActive: true } });
    assert.deepEqual({ before: p.stateBefore, after: p.stateAfter }, { before: 'OFFER_REVIEW', after: 'OFFER_UPLOAD' });
    const a = await appAudit('application.provider_suspended_return', id);
    assert.deepEqual({ role: a.actorRole, org: a.actorOrgId, user: a.actorUserId }, { role: 'pmu_reviewer', org: 'org-pmu', user: c.pmu.user.id });
    assert.equal(a.details.source, 'pmu_suspend');
    assert.deepEqual(a.details.providerEvent.after, { status: 'suspended', isActive: true });
    assert.deepEqual({ before: a.details.stateBefore, after: a.details.stateAfter }, { before: 'OFFER_REVIEW', after: 'OFFER_UPLOAD' });
    // سجل التدقيق على مستوى المقدم يربط الحدث بالطلبات المتأثرة
    const pa = await lastAudit('provider.suspend', PROVIDER_OK);
    assert.equal(pa.details.source, 'pmu_suspend');
    assert.deepEqual(pa.details.providerBefore, SNAP_APPROVED_ACTIVE);
    assert.deepEqual(pa.details.providerAfter, { status: 'suspended', isActive: true });
    assert.ok(pa.details.effect.returned.includes(id));
  } finally { assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/approve`, {})).status, 200); }
});

test('F-06/2) ENCPC deactivation during offer review: same effect today, but the audit tells the two triggers apart (decision D16 stays open)', async () => {
  const id = await inFlight('OFFER_REVIEW', 'IND-F06-2');
  assert.equal((await c.encpc.post(`/service-providers/${PROVIDER_OK}/deactivate`, {})).status, 200);
  try {
    assert.equal((await appRow(id)).state, 'OFFER_UPLOAD', 'current documented behavior is unchanged');
    const p = await returnPayload(id);
    assert.deepEqual(p.providerEvent, { source: 'encpc_deactivate', providerId: PROVIDER_OK, before: SNAP_APPROVED_ACTIVE, after: { status: 'approved', isActive: false } });
    const a = await appAudit('application.provider_suspended_return', id);
    assert.deepEqual({ role: a.actorRole, org: a.actorOrgId, user: a.actorUserId }, { role: 'encpc_reviewer', org: 'org-encpc', user: c.encpc.user.id });
    assert.equal(a.details.source, 'encpc_deactivate');
    const pa = await lastAudit('provider.deactivate', PROVIDER_OK);
    assert.equal(pa.details.source, 'encpc_deactivate');
    assert.deepEqual(pa.details.providerAfter, { status: 'approved', isActive: false });
    assert.ok(pa.details.effect.returned.includes(id));
  } finally { assert.equal((await c.encpc.post(`/service-providers/${PROVIDER_OK}/activate`, {})).status, 200); }
});

test('F-06/3) D6: before the offer is sent the application returns to provider selection; D7: after acceptance it is not moved — both audited with their source', async () => {
  const early = await inFlight('PROVIDER_SELECTION', 'IND-F06-3A');
  assert.equal((await act(c.factory, early, 'select_provider', { providerId: PROVIDER_OK })).status, 200);
  assert.equal((await c.encpc.post(`/service-providers/${PROVIDER_OK}/deactivate`, {})).status, 200);
  let pa: any;
  try {
    assert.equal((await appRow(early)).state, 'PROVIDER_SELECTION', 'D6: back to provider selection before the offer is sent');
    const a = await appAudit('application.provider_suspended_reselect', early);
    assert.deepEqual({ source: a.details.source, from: a.details.fromState, to: a.details.toState },
      { source: 'encpc_deactivate', from: 'OFFER_UPLOAD', to: 'PROVIDER_SELECTION' });
    assert.equal(a.actorRole, 'encpc_reviewer');
    pa = await lastAudit('provider.deactivate', PROVIDER_OK);
    assert.ok(pa.details.effect.notifiedBeforeOffer.includes(early));
  } finally { assert.equal((await c.encpc.post(`/service-providers/${PROVIDER_OK}/activate`, {})).status, 200); }
  assert.equal((await act(c.factory, early, 'withdraw', { reason: 'إنهاء' })).status, 200);

  const accepted = await inFlight('ELECTRICITY_UPLOAD', 'IND-F06-3B');
  assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 200);
  try {
    assert.equal((await appRow(accepted)).state, 'ELECTRICITY_UPLOAD', 'after acceptance: alert only');
    const a = await appAudit('application.provider_unavailable', accepted);
    assert.deepEqual({ source: a.details.source, effect: a.details.effect, before: a.details.stateBefore, after: a.details.stateAfter },
      { source: 'pmu_suspend', effect: 'alert_only', before: 'ELECTRICITY_UPLOAD', after: 'ELECTRICITY_UPLOAD' });
    assert.equal(a.actorRole, 'pmu_reviewer');
    const pm = await lastAudit('provider.suspend', PROVIDER_OK);
    assert.ok(pm.details.effect.alertedAfterAcceptance.includes(accepted));
  } finally { assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/approve`, {})).status, 200); }
});

// ══ المرحلة 6 (F-03): نزاع رقم السجل بعد أن تجاوز الطلب الحاجز مراجعة IMC — يثبّت السلوك الحالي المعتمد فقط ═══════════════════
// القرار D11 مفتوح: من يملك إيقاف طلب حاجز لرقم سجل بعد IMC؟ لا حل مقترح مُنفَّذ هنا ولا يُرمَّز في الاختبار.
test('F-03/1) D4 (QA 2026-11-23): after PMU names factory B, factory A\'s application (already past IMC) closes as Rejected and B submits', async () => {
  const idA = await draft(c.factory, 'IND-F03-1');
  assert.equal((await act(c.factory, idA, 'submit')).status, 200);
  assert.equal((await act(c.imc, idA, 'accept')).status, 200); // الطلب الحاجز تجاوز IMC
  const idB = await draft(c.factory2, 'IND-F03-1');
  const first = await act(c.factory2, idB, 'submit');
  assert.equal(first.status, 409);
  assert.equal(first.json.code, 'DUPLICATE_REGISTRY');

  const obj = await c.factory2.upload('/registry-objections', { registryNumber: 'IND-F03-1', note: 'الرقم يخص منشأتنا' }, PDF, 'ownership-proof.pdf');
  assert.equal(obj.status, 201, JSON.stringify(obj.json));
  // D4: while the objection is under review the holder application does not move forward
  assert.equal((await act(c.encpc, idA, 'compliant')).json.code, 'REGISTRY_DISPUTE_OPEN');
  const decision = await c.pmu.post(`/registry-objections/${obj.json.data.id}/accept`, { reason: 'مستندات الملكية سليمة وتثبت ملكية المنشأة المعترضة', reference: 'REF-F03' });
  assert.equal(decision.status, 200, JSON.stringify(decision.json));
  assert.deepEqual({ id: decision.json.data.heldByOtherApplication.id, state: decision.json.data.heldByOtherApplication.state }, { id: idA, state: 'ENCPC_REVIEW' },
    'PMU is told which open application held the number (it is now closed)');

  // D4: the holder application closes as Rejected (REGISTRY_OWNERSHIP) at its stage; no role can move it any more
  const after = await getApp(c.pmu, idA);
  assert.equal(after.state, 'REJECTED');
  assert.equal(after.transitions.at(-1).action, 'registry_dispute_reject');
  for (const cl of [c.imc, c.pmu, c.encpc, c.admin]) {
    const r = await act(cl, idA, 'compliant');
    assert.ok([403, 409].includes(r.status), `${cl.user.role}: ${r.status}`);
  }

  // the authorised factory submits at once
  const ok = await act(c.factory2, idB, 'submit');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  await assertConsistentSubmission(idB, 'IND-F03-1');
});

// ══ المرحلة 7 (F-07, F-09) ═══════════════════════════════════════════════════════════════════════════════════════════
test('F-07) an offer uploaded for a provider that became unavailable, and never sent, never reaches PMU after the factory re-selects', async () => {
  const id = await inFlight('PROVIDER_SELECTION', 'IND-F07-1');
  assert.equal((await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK })).status, 200);
  const up1 = await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-old-provider'), 'offer-old-provider.pdf');
  assert.equal(up1.status, 201);
  const oldDocId = up1.json.data.id as string;
  assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 200);
  try {
    assert.equal((await act(c.factory, id, 'select_provider', { providerId: 'sp-demo-2' })).status, 200);
    // PMU لا ترى عرضًا لم يُرسل أبدًا (ولا تنزّله)، والمصنع يحتفظ به في تاريخه، والصف لم يُحذف
    const pmuOffers = (await getApp(c.pmu, id)).documents.filter((d: any) => d.kind === 'technicalOfferFile');
    assert.deepEqual(pmuOffers, [], 'PMU must not see an offer that was never submitted for review');
    assert.equal((await c.pmu.get(`/applications/${id}/documents/${oldDocId}/download`)).status, 404);
    assert.ok((await getApp(c.factory, id)).documents.some((d: any) => d.id === oldDocId), 'the factory keeps it in its history');
    assert.equal(await count('SELECT COUNT(*) AS n FROM shams_documents WHERE id = ?', oldDocId), 1, 'never deleted');
    // بعد رفع عرض جديد وإرساله: PMU ترى العرض الجديد وحده
    assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-new-provider'), 'offer-new-provider.pdf')).status, 201);
    assert.equal((await act(c.factory, id, 'submit_offer')).status, 200);
    const seen = (await getApp(c.pmu, id)).documents.filter((d: any) => d.kind === 'technicalOfferFile');
    assert.deepEqual(seen.map((d: any) => d.originalName), ['offer-new-provider.pdf']);
    assert.equal((await getApp(c.factory, id)).documents.filter((d: any) => d.kind === 'technicalOfferFile').length, 2, 'both versions kept for the factory');
  } finally { assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/approve`, {})).status, 200); }
});

test('F-09) a stale expectedVersion from someone who could never perform the action gets 403, not a version conflict; same-organization reviewers still get VERSION_CONFLICT', async () => {
  const id = await inFlight('IMC_REVIEW', 'IND-F09-1');
  const v = (await getApp(c.imc, id)).version;
  assert.equal((await c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: v })).status, 200);
  // PMU لا تملك قرار IMC أصلًا: الرد هو رفض الصلاحية لا «تغيّر الطلب»
  const pmu = await c.pmu.post(`/applications/${id}/actions/reject`, { expectedVersion: v, reason: 'محاولة خارج الصلاحية' });
  assert.equal(pmu.status, 403, JSON.stringify(pmu.json));
  assert.equal(pmu.json.code, 'ACTION_NOT_ALLOWED');
  const enc = await c.encpc.post(`/applications/${id}/actions/accept`, { expectedVersion: v });
  assert.equal(enc.status, 403, JSON.stringify(enc.json));
  // مراجع IMC آخر (نفس الجهة) تأخر: يبقى VERSION_CONFLICT (القرار المتزامن)
  const late = await c.imc2.post(`/applications/${id}/actions/request_correction`, { expectedVersion: v, deficiencies: [{ field: 'address', note: 'x' }] });
  assert.equal(late.status, 409);
  assert.equal(late.json.code, 'VERSION_CONFLICT');
  assert.equal((await appRow(id)).state, 'ENCPC_REVIEW');
});

// ══ المرحلة 8 (F-10, F-11) ═══════════════════════════════════════════════════════════════════════════════════════════
const sqlDb = async () => (await import('../db/database.js')).getDb();

test('F-10/1) official history cannot be edited or deleted even with direct SQL: transitions, referral history, decided deficiencies', async () => {
  const db = await sqlDb();
  const hist = /append-only|immutable|cannot be deleted/;
  // السجل التاريخي للانتقالات + النواقص (تعديل مسموح لإغلاق النقص فقط)
  const id = await inFlight('IMC_REVIEW', 'IND-F10-1');
  assert.equal((await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان ناقص' }] })).status, 200);
  await assert.rejects(async () => await db.prepare("UPDATE shams_application_transitions SET reason = 'tampered' WHERE applicationId = ?").run(id), hist);
  await assert.rejects(async () => await db.prepare('DELETE FROM shams_application_transitions WHERE applicationId = ?').run(id), hist);
  await assert.rejects(async () => await db.prepare("UPDATE shams_deficiencies SET note = 'tampered' WHERE applicationId = ?").run(id), hist, 'an open deficiency\'s content is immutable');
  await assert.rejects(async () => await db.prepare('DELETE FROM shams_deficiencies WHERE applicationId = ?').run(id), hist);
  // الإغلاق الشرعي عبر إعادة تقديم المصنع ما زال يعمل
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { address: 'عنوان مكتمل' })).status, 200);
  assert.equal((await act(c.factory, id, 'resubmit')).status, 200);
  const resolved = (await q<any>('SELECT id, resolvedAtTransitionId FROM shams_deficiencies WHERE applicationId = ?', id))[0];
  assert.ok(resolved.resolvedAtTransitionId, 'resolution by the factory resubmission still works');
  // بعد الإغلاق: لا إعادة فتح ولا تعديل
  await assert.rejects(async () => await db.prepare('UPDATE shams_deficiencies SET resolvedAtTransitionId = NULL WHERE id = ?').run(resolved.id), hist);
  await assert.rejects(async () => await db.prepare("UPDATE shams_deficiencies SET note = 'x' WHERE id = ?").run(resolved.id), hist);
  // حذف الطلب نفسه (CASCADE) لا يمحو تاريخه
  await assert.rejects(async () => await db.prepare('DELETE FROM shams_applications WHERE id = ?').run(id));
  assert.ok(await count('SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ?', id) >= 3);

  // تاريخ الإحالات السابقة (المصنع له طلب مفتوح واحد: نُنهي الأول — الانسحاب يُلحق سطرًا ولا يعدّل شيئًا)
  assert.equal((await act(c.factory, id, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' })).status, 200);
  // G-02: لا إعادة إحالة جديدة، لكن صفوف bank_referral_history التاريخية (من قبل الإلغاء) تبقى محمية. نُنشئ صفًا بالطريقة القديمة نفسها (إدراج).
  const bank = await inFlight('CONTRACT_OUTCOME', 'IND-F10-2');
  const trId = (await q<any>("SELECT id FROM shams_application_transitions WHERE applicationId = ? AND action = 'select_bank'", bank))[0].id;
  await db.prepare(`INSERT INTO shams_bank_referral_history (id, applicationId, bankOrgId, referredAt, referredBy, endedAt, endedBy, endReason, transitionId)
    VALUES ('rfh-legacy-f10', ?, 'org-bank-demo-a', '2026-01-01T00:00:00.000Z', NULL, '2026-01-02T00:00:00.000Z', NULL, 'سجل تاريخي', ?)`).run(bank, trId);
  assert.equal(await count('SELECT COUNT(*) AS n FROM shams_bank_referral_history WHERE applicationId = ?', bank), 1);
  await assert.rejects(async () => await db.prepare("UPDATE shams_bank_referral_history SET endReason = 'tampered' WHERE applicationId = ?").run(bank), hist);
  await assert.rejects(async () => await db.prepare('DELETE FROM shams_bank_referral_history WHERE applicationId = ?').run(bank), hist);
});

test('F-11) allowReapplyAfterTerminal = false is enforced by the server, not only by the UI', async () => {
  const { shamsPolicy } = await import('../config/shamsPolicy.js');
  // المصنع يملك طلبًا منتهيًا (منسحبًا) ولا طلب مفتوح له الآن — لا اعتماد على اختبارات سابقة
  const prior = await draft(c.factory2, 'IND-F11-1');
  assert.equal((await act(c.factory2, prior, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' })).status, 200);
  assert.equal((await c.factory2.get('/factory/profile')).json.data.openApplicationId ?? null, null);
  const saved = shamsPolicy.allowReapplyAfterTerminal;
  (shamsPolicy as { allowReapplyAfterTerminal: boolean }).allowReapplyAfterTerminal = false;
  try {
    assert.equal((await c.factory2.get('/factory/profile')).json.data.canStartNew, false, 'the profile already says so');
    const r = await c.factory2.post('/applications', {});
    if (r.status === 201) opened.push({ cl: c.factory2, id: r.json.data.id }); // لا يُترك مفتوحًا إن فشل الاختبار
    assert.equal(r.status, 409, JSON.stringify(r.json).slice(0, 300));
    assert.equal(r.json.code, 'REAPPLY_NOT_ALLOWED');
  } finally { (shamsPolicy as { allowReapplyAfterTerminal: boolean }).allowReapplyAfterTerminal = saved; }
  // السياسة الافتراضية (★ مسموح): يعمل كما كان
  const ok = await c.factory2.post('/applications', {});
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  opened.push({ cl: c.factory2, id: ok.json.data.id });
});

// ══ المرحلة 9: التزامن وعدم التكرار — لا تغيير في الكود متوقع؛ أي فشل هنا يصبح بندًا جديدًا ═══════════════════════════════════════════
const dupRecipients = async (appId: string, tpl: string) =>
  q<any>('SELECT recipientAddress, channel, COUNT(*) AS n FROM notification_outbox WHERE applicationId = ? AND templateKey = ? GROUP BY recipientAddress, channel HAVING COUNT(*) > 1', appId, tpl);
const transitionsOf = (appId: string, from: string, to: string) =>
  count('SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ? AND fromState = ? AND toState = ?', appId, from, to);
/** يرسل الإجراءات من العملاء بنفس expectedVersion في آن واحد. */
async function race(pairs: Array<{ cl: Client; action: string; body?: Record<string, unknown> }>, appId: string, viewer: Client) {
  const version = (await getApp(viewer, appId)).version;
  return Promise.all(pairs.map((p) => p.cl.post(`/applications/${appId}/actions/${p.action}`, { expectedVersion: version, ...(p.body ?? {}) })));
}
const oneWinner = (rs: Array<{ status: number; json: any }>, loserStatuses: number[] = [409]) => {
  const ok = rs.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, `exactly one request wins: ${JSON.stringify(rs.map((r) => [r.status, r.json?.code]))}`);
  for (const r of rs.filter((x) => x.status !== 200)) assert.ok(loserStatuses.includes(r.status), `loser status ${r.status} ${JSON.stringify(r.json)}`);
};

test('C1) the same offer submitted twice at once: one review transition, one notification set', async () => {
  const id = await inFlight('PROVIDER_SELECTION', 'IND-C1');
  assert.equal((await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK })).status, 200);
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('c1-offer'), 'offer.pdf')).status, 201);
  const rs = await race([{ cl: c.factory, action: 'submit_offer' }, { cl: c.factory, action: 'submit_offer' }], id, c.factory);
  oneWinner(rs);
  assert.equal(await transitionsOf(id, 'OFFER_UPLOAD', 'OFFER_REVIEW'), 1);
  assert.equal((await appRow(id)).state, 'OFFER_REVIEW');
  assert.deepEqual(await dupRecipients(id, 'app.review_assigned'), []);
});

test('C2) PMU accepts the electricity approval twice at once: one transition to the bank-choice stage, no referral, no duplicate notices', async () => {
  const id = await inFlight('ELECTRICITY_REVIEW', 'IND-C2');
  const rs = await race([{ cl: c.pmu, action: 'accept' }, { cl: c.pmu, action: 'accept' }], id, c.pmu);
  oneWinner(rs);
  assert.equal(await transitionsOf(id, 'ELECTRICITY_REVIEW', 'CONTRACT_OUTCOME'), 1);
  assert.equal(await count('SELECT COUNT(*) AS n FROM shams_bank_referrals WHERE applicationId = ?', id), 0, 'G-01: no bank yet — the factory chooses after acceptance');
  assert.equal((await appRow(id)).bankOrgId, null);
  assert.ok(await count("SELECT COUNT(*) AS n FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.electricity_accepted'", id) >= 1);
  assert.deepEqual(await dupRecipients(id, 'app.electricity_accepted'), []);
});

test('C3) the factory chooses the bank twice at once, and with two different banks: one choice, consistent everywhere', async () => {
  const same = await inFlight('BANK_SELECTION', 'IND-C3A');
  oneWinner(await race([{ cl: c.factory, action: 'select_bank', body: { bankOrgId: BANK_A } }, { cl: c.factory, action: 'select_bank', body: { bankOrgId: BANK_A } }], same, c.factory));
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ? AND action = 'select_bank'", same), 1);
  assert.deepEqual(await dupRecipients(same, 'app.bank_selected'), []);
  assert.equal((await act(c.factory, same, 'withdraw', { reason: 'إنهاء' })).status, 200);

  const diff = await inFlight('BANK_SELECTION', 'IND-C3B');
  const rs = await race([
    { cl: c.factory, action: 'select_bank', body: { bankOrgId: BANK_A } },
    { cl: c.factory, action: 'select_bank', body: { bankOrgId: BANK_B } },
  ], diff, c.factory);
  oneWinner(rs);
  const winner = rs[0].status === 200 ? BANK_A : BANK_B;
  assert.equal((await appRow(diff)).bankOrgId, winner, 'application holds the winner\'s bank');
  assert.equal((await q<any>('SELECT bankOrgId FROM shams_bank_referrals WHERE applicationId = ?', diff))[0].bankOrgId, winner, 'selection record agrees');
  const payload = JSON.parse((await q<any>("SELECT payload FROM shams_application_transitions WHERE applicationId = ? AND action = 'select_bank'", diff))[0].payload);
  assert.equal(payload.bankOrgId, winner, 'history holds the same bank');
});

test('C4) the bank choice racing a withdrawal: exactly one wins and the state, bank and history agree', async () => {
  const id = await inFlight('BANK_SELECTION', 'IND-C4');
  const version = (await getApp(c.factory, id)).version;
  const [sel, wd] = await Promise.all([
    c.factory.post(`/applications/${id}/actions/select_bank`, { expectedVersion: version, bankOrgId: BANK_B }),
    c.factory.post(`/applications/${id}/actions/withdraw`, { expectedVersion: version, reason: 'انسحاب متزامن' }),
  ]);
  assert.equal([sel, wd].filter((r) => r.status === 200).length, 1, JSON.stringify([sel.status, sel.json?.code, wd.status, wd.json?.code]));
  const a = await appRow(id);
  if (sel.status === 200) assert.deepEqual({ state: a.state, bank: a.bankOrgId }, { state: 'CONTRACT_OUTCOME', bank: BANK_B });
  else assert.deepEqual({ state: a.state, bank: a.bankOrgId }, { state: 'WITHDRAWN', bank: null });
  if (a.state !== 'WITHDRAWN') assert.equal((await act(c.factory, id, 'withdraw', { reason: 'إنهاء' })).status, 200);
});

test('C5) the contract outcome, and a withdrawal, each recorded twice at once: one final state, one outcome', async () => {
  const id = await inFlight('CONTRACT_OUTCOME', 'IND-C5');
  await uploadContractFile(c.factory, id, 'c5');
  const body = { contractDate: '2026-10-20', contractAmount: 1500000, contractNotes: 'عقد' };
  oneWinner(await race([{ cl: c.factory, action: 'record_contract', body }, { cl: c.factory, action: 'record_contract', body }], id, c.factory));
  assert.equal((await appRow(id)).state, 'CONTRACTED');
  assert.equal(await transitionsOf(id, 'CONTRACT_OUTCOME', 'CONTRACTED'), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_bank_referrals WHERE applicationId = ? AND contractStatus = 'contracted'", id), 1);
  // بعد الحالة النهائية: أي محاولة جديدة مرفوضة والنتيجة لا تتغير
  const again = await act(c.factory, id, 'record_no_contract', { reason: 'محاولة بعد الإغلاق' });
  assert.equal(again.status, 409);

  const w = await inFlight('IMC_REVIEW', 'IND-C5W');
  oneWinner(await race([{ cl: c.factory, action: 'withdraw', body: { reason: 'انسحاب' } }, { cl: c.factory, action: 'withdraw', body: { reason: 'انسحاب' } }], w, c.factory));
  assert.equal(await count("SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ? AND toState = 'WITHDRAWN'", w), 1);
});

test('C6) a correction resubmitted twice at once: one return to IMC, the attempt advances by exactly one', async () => {
  const id = await inFlight('IMC_REVIEW', 'IND-C6');
  assert.equal((await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'ناقص' }] })).status, 200);
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { address: 'عنوان مصحح' })).status, 200);
  const before = (await appRow(id)).attempt;
  oneWinner(await race([{ cl: c.factory, action: 'resubmit' }, { cl: c.factory, action: 'resubmit' }], id, c.factory));
  assert.equal(await transitionsOf(id, 'IMC_CORRECTION', 'IMC_REVIEW'), 1);
  assert.equal((await appRow(id)).attempt, before + 1);
  assert.equal(await count('SELECT COUNT(*) AS n FROM shams_deficiencies WHERE applicationId = ? AND resolvedAtTransitionId IS NULL', id), 0);
});
