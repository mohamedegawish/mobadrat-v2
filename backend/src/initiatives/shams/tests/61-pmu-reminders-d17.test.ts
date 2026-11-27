// D17: PMU reminds the party an overdue application is waiting for — only PMU, only when overdue, once a day per stage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, getApp, q, type Started } from './helpers.js';

const env = isolateTestEnv('reminders');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-RMD-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
async function makeLate(id: string) {
  const { getDb } = await import('../db/database.js');
  await getDb().prepare("UPDATE shams_applications SET stateEnteredAt = '2020-01-01T00:00:00.000Z', slaStartedAt = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
}
const reminded = (id: string) => q<{ recipientAddress: string }>(
  "SELECT recipientAddress FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.sla_reminder' AND channel = 'email'", id);

test('only PMU, only an overdue application, once a day: the late party gets the reminder', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  const early = await c.pmu.post(`/applications/${id}/remind`);
  assert.equal(early.status, 409);
  assert.equal(early.json.code, 'NOT_OVERDUE');
  await makeLate(id);
  assert.equal((await getApp(c.pmu, id)).overdue, true);
  for (const cl of [c.imc, c.encpc, c.factory, c.admin, c.electricity]) assert.equal((await cl.post(`/applications/${id}/remind`)).status, 403);
  assert.equal((await c.pmu.post(`/applications/${id}/remind`)).status, 200);
  const to = (await reminded(id)).map((r) => r.recipientAddress).sort();
  assert.deepEqual(to, ['imc1@shams.local', 'imc2@shams.local', 'imc@mobadrat.local'].filter((a) => to.includes(a)).sort());
  assert.ok(to.includes('imc1@shams.local') && !to.includes('pmu@shams.local'), 'the responsible party only');
  const again = await c.pmu.post(`/applications/${id}/remind`);
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ALREADY_REMINDED');
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE applicationId = ? AND action = 'application.sla_reminder'", id)).length, 1);
  assert.equal((await getApp(c.pmu, id)).state, 'IMC_REVIEW', 'a reminder changes nothing');
});

test('a late factory step reminds the factory; «remind all» covers every overdue application and skips the ones reminded today', async () => {
  await closeOpen();
  const offer = await advanceTo('OFFER_UPLOAD', c, reg());
  const other = await advanceTo('ENCPC_REVIEW', { ...c, factory: c.factory2 }, reg());
  await makeLate(offer);
  await makeLate(other);
  const first = await c.pmu.post('/applications/remind-overdue');
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.data.overdue, 2);
  assert.equal(first.json.data.sent, 2);
  assert.ok((await reminded(offer)).some((r) => r.recipientAddress === 'factory@shams.local'));
  assert.ok((await reminded(other)).some((r) => r.recipientAddress === 'encpc@shams.local'));
  const second = (await c.pmu.post('/applications/remind-overdue')).json.data;
  assert.deepEqual([second.sent, second.alreadyReminded], [0, 2]);
  assert.equal((await c.imc.post('/applications/remind-overdue')).status, 403);
});
