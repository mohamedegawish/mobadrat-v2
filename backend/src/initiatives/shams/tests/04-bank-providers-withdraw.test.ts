// اختبارات القبول 9–12: مقدم خدمة غير معتمد، اختيار البنك بعد قبول الكهرباء (G-01)، النتيجة يسجلها المصنع مباشرة (G-02)، الانسحاب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, q, pdfVariant, Client, BANK_A, BANK_B, PROVIDER_PENDING, PROVIDER_SUSPENDED, PROVIDER_OK, type Started } from './helpers.js';

async function dbRun(sql: string, ...params: string[]) {
  const { getDb } = await import('../src/db/sqlite.js');
  await getDb().prepare(sql).run(...params);
}

const env = isolateTestEnv('bank');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-BANK-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}

test('9) unapproved (pending or suspended) provider is rejected; factory sees approved list only', async () => {
  await closeOpen();
  const id = await advanceTo('PROVIDER_SELECTION', c, reg());
  const list = await c.factory.get('/service-providers');
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.every((p: any) => p.status === 'approved'));
  assert.ok(!list.json.data.items.some((p: any) => p.id === PROVIDER_PENDING));
  for (const providerId of [PROVIDER_PENDING, PROVIDER_SUSPENDED, 'sp-does-not-exist']) {
    const r = await act(c.factory, id, 'select_provider', { providerId });
    assert.equal(r.status, 422, providerId);
    assert.equal(r.json.code, 'PROVIDER_NOT_APPROVED');
  }
  assert.equal((await getApp(c.factory, id)).state, 'PROVIDER_SELECTION');
  // PMU يعتمد مقدم الخدمة المعلق → يصبح متاحًا
  assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_PENDING}/approve`, {})).status, 200);
  assert.equal((await c.factory.post('/service-providers', { nameAr: 'محاولة مصنع' })).status, 403, 'factory cannot manage providers');
  assert.equal((await c.imc.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 403, 'IMC cannot manage providers');
  const ok = await act(c.factory, id, 'select_provider', { providerId: PROVIDER_PENDING });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // إعادة الإيقاف للحالة الأصلية
  await c.pmu.post(`/service-providers/${PROVIDER_PENDING}/suspend`, {});
});

test('10) G-02: the factory records the outcome directly — no bank approval, no bank login; 11) no-contract requires a reason, notes optional, no document', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), 'org-bank-demo-a');
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'CONTRACT_OUTCOME');
  assert.equal(app.responsible.type, 'factory', 'nobody but the factory acts at this stage');
  assert.deepEqual(app.allowedActions.map((a: any) => a.action).sort(), ['record_contract', 'record_no_contract', 'withdraw']);
  assert.equal((await q("SELECT COUNT(*) AS n FROM users WHERE role = 'bank_reviewer' AND isActive = 1"))[0].n, 0, 'no active bank account exists');
  const bankLogin = await new Client(srv.base).post('/auth/login', { email: 'bank.a@shams.local', password: 'Shams@2026' });
  assert.equal(bankLogin.status, 401, 'there is no bank account to log in with');

  const noReason = await act(c.factory, id, 'record_no_contract', {});
  assert.equal(noReason.status, 400);
  assert.ok(noReason.json.details.some((d: any) => d.field === 'reason'));
  assert.equal((await act(c.factory, id, 'record_no_contract', { reason: 'لا' })).status, 400, 'reason too short');
  const done = await act(c.factory, id, 'record_no_contract', { reason: 'لم تكتمل ضمانات البنك', contractNotes: 'تواصلنا مع فرعين' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const after = await getApp(c.factory, id);
  assert.equal(after.state, 'CLOSED_NOT_CONTRACTED');
  assert.equal(after.bankReferral.notContractedReason, 'لم تكتمل ضمانات البنك');
  assert.equal(after.bankReferral.contractNotes, 'تواصلنا مع فرعين', 'optional notes kept');
  assert.ok(!after.documents.some((d: any) => d.kind === 'contractFile'), 'no contract document needed for a failure');
});

test('10b) G-01: the bank is chosen only after PMU accepts the electricity approval — once, by the owning factory, from active banks', async () => {
  await closeOpen();
  const id = await advanceTo('ELECTRICITY_UPLOAD', c, reg());
  // no bank with the electricity submission
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 409, 'not before the approval is even submitted');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('e'), 'e.pdf')).status, 201);
  const withBank = await act(c.factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع', bankOrgId: BANK_A });
  assert.equal(withBank.status, 400, 'bankOrgId is not a field of the electricity submission');
  assert.ok(withBank.json.details.some((d: any) => d.field === 'bankOrgId'));
  assert.equal((await act(c.factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع' })).status, 200);
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 409, 'not while PMU reviews');
  assert.equal((await getApp(c.factory, id)).bank, null);
  assert.equal((await act(c.pmu, id, 'accept')).status, 200);

  // accepted: the bank choice is the only open step
  assert.equal((await act(c.factory, id, 'record_contract', { contractDate: '2026-10-01', contractAmount: 10 })).json.code, 'BANK_NOT_SELECTED');
  assert.equal((await act(c.factory, id, 'record_no_contract', { reason: 'قبل البنك' })).json.code, 'BANK_NOT_SELECTED');
  assert.equal((await act(c.factory, id, 'select_bank', {})).status, 400, 'bank required');
  for (const bankOrgId of ['org-nope', 'org-pmu']) assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId })).status, 422, bankOrgId);
  await dbRun('UPDATE organizations SET isActive = 0 WHERE id = ?', BANK_B);
  try { assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_B })).status, 422, 'inactive bank'); }
  finally { await dbRun('UPDATE organizations SET isActive = 1 WHERE id = ?', BANK_B); }
  assert.ok([403, 404].includes((await act(c.pmu, id, 'select_bank', { bankOrgId: BANK_A })).status), 'only the factory chooses');
  assert.equal((await c.factory2.post(`/applications/${id}/actions/select_bank`, { expectedVersion: 1, bankOrgId: BANK_A })).status, 404, 'another factory');
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 200);
  const again = await act(c.factory, id, 'select_bank', { bankOrgId: BANK_B });
  assert.equal(again.status, 409); assert.equal(again.json.code, 'BANK_ALREADY_SELECTED');
  const app = await getApp(c.factory, id);
  assert.equal(app.bank.id, BANK_A, 'one bank per application');
  const tr = (await q<any>("SELECT payload FROM application_transitions WHERE applicationId = ? AND action = 'select_bank'", id));
  assert.equal(tr.length, 1); assert.equal(JSON.parse(tr[0].payload).bankOrgId, BANK_A, 'selection in history');
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE applicationId = ? AND action = 'application.select_bank'", id)).length, 1, 'selection audited');
});

test('12) withdraw succeeds from a non-terminal state and returns 409 from a terminal state', async () => {
  await closeOpen();
  const id = await advanceTo('OFFER_REVIEW', c, reg());
  const noReason = await act(c.factory, id, 'withdraw', {});
  assert.equal(noReason.status, 400, 'reason mandatory');
  const ok = await act(c.factory, id, 'withdraw', { reason: 'تغيير خطة المصنع' });
  assert.equal(ok.status, 200);
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'WITHDRAWN');
  const again = await c.factory.post(`/applications/${id}/actions/withdraw`, { expectedVersion: app.version, reason: 'مرة أخرى' });
  assert.equal(again.status, 409);
  // إعادة التقديم بعد الحالة النهائية مسموحة بطلب جديد
  const fresh = await c.factory.post('/applications', {});
  assert.equal(fresh.status, 201);
  // الانسحاب من المسودة أيضًا
  const fromDraft = await act(c.factory, fresh.json.data.id, 'withdraw', { reason: 'مسودة غير مطلوبة' });
  assert.equal(fromDraft.status, 200);
});
