// F9 (D9; QA 2026-11-23 report question 2): the distribution-company contracting route, approved as built. Its transitions,
// derived from the state machine (workflow/shamsWorkflow.ts), join the reference as T28–T31; each is checked the way the
// E2E run checks a transition: the new state, whose queue it is in, the previous actor locked out, the notification
// (D10: the reason in every channel) and the history.
//   T28  Record contract result, no bank chosen · factory · «التعاقد من خلال شركة توزيع الكهرباء» → Distribution approval upload
//   T29  Distribution approval upload · factory · uploads the company's approval and sends it → Distribution approval review (PMU)
//   T30  Distribution approval review · PMU · accepts (final) → Completed
//   T31  Distribution approval review · PMU · rejects with a reason (final) → Closed
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, uploadDistributionApproval, q, BANK_A, type Started, type Client } from './helpers.js';

const env = isolateTestEnv('distribution-d9');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-D9-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const actions = async (who: Client, id: string) => ((await getApp(who, id)).allowedActions as Array<{ action: string }>).map((a) => a.action);
const inQueue = async (who: Client, id: string) => ((await who.get('/applications?mine=1&pageSize=100')).json.data.items as Array<{ id: string }>).some((a) => a.id === id);
/** An action sent directly by `who` (who may not even be able to read the application), with the current version. */
const direct = async (who: Client, id: string, action: string, body: Record<string, unknown> = {}) =>
  who.post(`/applications/${id}/actions/${action}`, { expectedVersion: (await getApp(c.pmu, id)).version, ...body });
const lastEntry = async (id: string) => { const t = (await getApp(c.pmu, id)).transitions; return t[t.length - 1]; };

test('T28: after مستوفاة the factory picks the distribution company; the path is fixed — no bank after it, no path after a bank', async () => {
  await closeOpen();
  const id = await advanceTo('BANK_SELECTION', c, reg());
  assert.ok((await actions(c.factory, id)).includes('select_distribution_path'));
  assert.equal((await act(c.factory, id, 'select_distribution_path')).status, 200);
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'DISTRIBUTION_UPLOAD');
  assert.equal(app.stateLabelAr, 'رفع موافقة شركة توزيع الكهرباء');
  assert.ok(!(await actions(c.factory, id)).includes('select_bank'), 'no bank control on this path');
  assert.notEqual((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 200, 'a direct bank choice is refused');
  assert.ok(!(await inQueue(c.pmu, id)), 'not in PMU\'s queue yet');
  const e = await lastEntry(id);
  assert.equal(e.action, 'select_distribution_path');
  assert.equal(e.toState, 'DISTRIBUTION_UPLOAD');
  assert.ok(e.actorName && e.createdAt, 'history: who and when');
  assert.equal((await act(c.factory, id, 'withdraw', { reason: 'انسحاب من مسار التوزيع (D9)' })).status, 200, 'T23 applies on the route');

  const c2 = { ...c, factory: c.factory2 };
  const banked = await advanceTo('CONTRACT_OUTCOME', c2, reg());
  const locked = await act(c.factory2, banked, 'select_distribution_path');
  assert.notEqual(locked.status, 200, 'a bank chosen first locks the distribution path');
  assert.equal((await getApp(c.factory2, banked)).state, 'CONTRACT_OUTCOME');
});

test('T29: the approval document is required; sent, it is PMU\'s turn only and the factory can only withdraw', async () => {
  await closeOpen();
  const id = await advanceTo('DISTRIBUTION_UPLOAD', c, reg());
  assert.notEqual((await act(c.factory, id, 'submit_distribution_approval')).status, 200, 'the approval document is required');
  await uploadDistributionApproval(c.factory, id, 'd9-approval');
  assert.equal((await act(c.factory, id, 'submit_distribution_approval')).status, 200);
  assert.equal((await getApp(c.factory, id)).state, 'DISTRIBUTION_REVIEW');
  assert.ok(await inQueue(c.pmu, id), 'in PMU\'s queue');
  for (const who of [c.imc, c.encpc, c.factory]) assert.equal(await inQueue(who, id), false, 'in no other queue');
  const own = await actions(c.factory, id);
  assert.ok(own.includes('withdraw') && !own.some((a) => a.startsWith('submit')), `the factory can only withdraw — got ${own}`);
  const pmu = await actions(c.pmu, id);
  assert.ok(pmu.includes('accept') && pmu.includes('reject_distribution'), `PMU decides — got ${pmu}`);
  for (const [who, action] of [[c.imc, 'accept'], [c.encpc, 'compliant'], [c.factory, 'accept'], [c.factory, 'submit_distribution_approval']] as const) {
    assert.notEqual((await direct(who, id, action)).status, 200, `${action} by another entity is refused`);
  }
  assert.equal((await getApp(c.pmu, id)).state, 'DISTRIBUTION_REVIEW', 'the refusals changed nothing');
  assert.equal((await lastEntry(id)).toState, 'DISTRIBUTION_REVIEW');
});

test('T30: PMU accepts → Completed, final; the factory is notified; nobody can act any more', async () => {
  await closeOpen();
  const id = await advanceTo('DISTRIBUTION_REVIEW', c, reg());
  assert.equal((await act(c.pmu, id, 'accept')).status, 200);
  assert.equal((await getApp(c.factory, id)).state, 'CONTRACTED');
  for (const who of [c.factory, c.pmu]) assert.deepEqual(await actions(who, id), [], 'final: no action left');
  assert.notEqual((await direct(c.factory, id, 'withdraw', { reason: 'بعد الإغلاق' })).status, 200, 'a final state refuses withdrawal');
  assert.ok(!(await inQueue(c.pmu, id)), 'out of PMU\'s queue');
  const inbox = ((await c.factory.get('/notifications?pageSize=50')).json.data.items as Array<{ applicationId: string }>).filter((n) => n.applicationId === id);
  assert.ok(inbox.length > 0, 'the factory is notified in-app');
  const e = await lastEntry(id);
  assert.equal(e.action, 'accept');
  assert.equal(e.toState, 'CONTRACTED');
  assert.ok(e.actorName && e.createdAt);
});

test('T31: PMU rejects — a reason is required; Closed, final; the reason reaches the factory in-app, by e-mail and in the stored SMS (D10)', async () => {
  await closeOpen();
  const id = await advanceTo('DISTRIBUTION_REVIEW', c, reg());
  const noReason = await act(c.pmu, id, 'reject_distribution', {});
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.messageAr, 'السبب: هذا الحقل مطلوب.', 'F7: the field is named in Arabic');
  const reason = 'QA-D9 موافقة شركة التوزيع غير موقعة من المفوض بالتوقيع';
  assert.equal((await act(c.pmu, id, 'reject_distribution', { reason })).status, 200);
  assert.equal((await getApp(c.factory, id)).state, 'CLOSED_NOT_CONTRACTED');
  assert.deepEqual(await actions(c.factory, id), [], 'final');
  const inbox = ((await c.factory.get('/notifications?pageSize=50')).json.data.items as Array<{ applicationId: string; body: string }>).filter((n) => n.applicationId === id);
  assert.ok(inbox.some((n) => String(n.body).includes(reason)), `in-app carries the full reason — got ${JSON.stringify(inbox.map((n) => n.body))}`);
  const sms = await q<{ body: string }>("SELECT body FROM notification_outbox WHERE applicationId = ? AND channel = 'sms'", id);
  assert.ok(sms.some((s) => s.body.includes(reason.slice(0, 8))), 'the stored SMS carries the reason');
  const mail = await q<{ body: string }>("SELECT body FROM notification_outbox WHERE applicationId = ? AND channel = 'email'", id);
  assert.ok(mail.some((m) => m.body.includes(reason.slice(0, 20))), 'the e-mail carries the reason');
  const e = await lastEntry(id);
  assert.equal(e.action, 'reject_distribution');
  assert.equal(e.reason, reason, 'history keeps the reason');
});
