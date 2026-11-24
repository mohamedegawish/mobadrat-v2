// F4 / D2 (QA 2026-11-23, BUG-05, T24): deactivating a bank releases every open application bound to it. The factory picks
// another active bank (BANK_ALREADY_SELECTED no longer blocks), PMU is notified, inactive banks leave the bank list, and no
// contract can be recorded with an inactive bank.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, q, advanceTo, uploadContractFile, BANK_A, type Started } from './helpers.js';

const env = isolateTestEnv('d2');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-D2-${process.pid}-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
async function newBank(tag: string): Promise<string> {
  const r = await c.admin.post('/admin/organizations', { type: 'bank', nameAr: `بنك ${tag}`, nameEn: `Bank ${tag}` });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data.id as string;
}
const banksSeenByFactory = async () => (await c.factory.get('/meta')).json.data.banks.map((b: any) => b.id) as string[];

test('S5: Bank B stops → the application is released, the factory picks Bank A and completes; PMU and the factory are told', async () => {
  await closeOpen();
  const bankB = await newBank(`B-${process.pid}`);
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), bankB);
  assert.equal((await getApp(c.factory, id)).bank?.id, bankB);
  // deactivation needs the explicit confirmation, then releases
  assert.equal((await c.admin.put(`/admin/organizations/${bankB}`, { isActive: false })).json.code, 'OPEN_REFERRALS');
  assert.equal((await c.admin.put(`/admin/organizations/${bankB}`, { isActive: false, confirmOpenReferrals: true })).status, 200);
  const v = await getApp(c.factory, id);
  assert.equal(v.state, 'CONTRACT_OUTCOME');
  assert.equal(v.bank, null, 'released from the stopped bank');
  assert.ok(v.transitions.some((t: any) => t.action === 'bank_released'), 'history records the release');
  assert.ok(v.allowedActions.some((a: any) => a.action === 'select_bank'), 'the factory can pick another bank');
  assert.ok(!v.allowedActions.some((a: any) => a.action === 'record_contract'), 'no contract until a new bank is chosen');
  assert.ok(!(await banksSeenByFactory()).includes(bankB), 'the stopped bank leaves the list');
  const notes = await q<{ recipientAddress: string }>("SELECT recipientAddress FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.bank_released' AND channel = 'email'", id);
  assert.ok(notes.some((n) => n.recipientAddress === c.factory.user.email), 'factory notified');
  assert.ok(notes.some((n) => n.recipientAddress === 'pmu@shams.local'), 'PMU notified');
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: bankB })).status, 422, 'the stopped bank cannot be picked again');
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 200, 'BANK_ALREADY_SELECTED no longer blocks');
  await uploadContractFile(c.factory, id, 'contract-d2');
  const done = await act(c.factory, id, 'record_contract', { contractDate: '2026-11-20', contractAmount: 1000000 });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const fin = await getApp(c.pmu, id);
  assert.equal(fin.state, 'CONTRACTED');
  assert.equal(fin.bank?.id, BANK_A, 'completed with Bank A');
  assert.ok(fin.referralHistory.some((h: any) => h.bankOrgId === bankB), 'Bank B stays in the referral history');
});

test('no contract is recorded with an inactive bank (direct request)', async () => {
  await closeOpen();
  const bankC = await newBank(`C-${process.pid}`);
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), bankC);
  // the bank row is switched off without the admin flow (e.g. by another process): the guard still refuses
  await q("UPDATE shams_organizations SET isActive = 0 WHERE id = ?", bankC);
  await uploadContractFile(c.factory, id, 'contract-inactive');
  const r = await act(c.factory, id, 'record_contract', { contractDate: '2026-11-20', contractAmount: 1000000 });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'BANK_INACTIVE');
});
