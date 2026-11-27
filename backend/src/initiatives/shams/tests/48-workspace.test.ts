// Shams in the platform dashboards (GET /me/workspace/:type): the same numbers as the module's own dashboard and work queue,
// every card leading to the queue filter its number was computed with, and the shared IMC account seeing Shams' work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, Client, type Started } from './helpers.js';

const env = isolateTestEnv('workspace');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-WSP-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

const ws = async (cl: Client, type: string, query = '') => {
  const r = await cl.get(`/me/workspace/${type}?i=shams${query}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const total = async (cl: Client, query: string) => (await cl.get(`/applications?${query}&pageSize=100`)).json.data.total as number;

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}

test('IMC: the dashboard part equals the module dashboard, and each card equals the rows of the queue it opens', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  const dash = (await c.imc.get('/dashboard')).json.data;
  const d = await ws(c.imc, 'imc');
  const part = d.parts[0].data;
  assert.equal(part.awaitingMe, dash.awaitingMe.count);
  assert.equal(d.totals.awaitingMe, await total(c.imc, 'mine=1'));
  assert.equal(d.queue.total, part.awaitingMe, 'the «awaiting my decision» tab lists exactly the headline');
  assert.ok(d.queue.items.some((r: any) => r.id === id && r.isMine && r.view === `application/${id}`));
  assert.deepEqual(part.cards.map((x: any) => [x.key, x.value]), dash.cards.map((x: any) => [x.key, x.count]));
  await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'أكمل' }] });
  const after1 = (await ws(c.imc, 'imc')).parts[0].data;
  const card = after1.cards.find((x: any) => x.key === 'correction');
  assert.deepEqual(card.link, { tab: 'all', state: 'IMC_CORRECTION' });
  const filtered = await ws(c.imc, 'imc', `&tab=all&state=${card.link.state}`);
  assert.equal(filtered.queue.total, card.value, 'card = queue');
  assert.equal(filtered.queue.total, await total(c.imc, 'state=IMC_CORRECTION'));
});

test('the shared IMC account (IMC in every initiative) sees Shams\' work in its one IMC dashboard', async () => {
  await closeOpen();
  await advanceTo('IMC_REVIEW', c, reg());
  const both = await new Client(srv.base).login('imc@mobadrat.local');
  const merged = (await both.get('/me/workspace/imc')).json.data;
  assert.equal(merged.merged, true);
  const shams = merged.parts.find((p: any) => p.initiativeId === 'shams');
  assert.equal(shams.data.awaitingMe, await total(both, 'mine=1'));
  assert.ok(shams.data.awaitingMe >= 1);
  assert.ok(merged.queue.items.some((r: any) => r.initiativeId === 'shams' && r.isMine));
});

test('PMU: its stage cards and attention; monitoring blocks; filters for banks; ENCPC sees no banks', async () => {
  const d = await ws(c.pmu, 'pmu', '&tab=monitoring');
  const part = d.parts[0].data;
  const dash = (await c.pmu.get('/dashboard')).json.data;
  assert.equal(part.awaitingMe, dash.awaitingMe.count);
  assert.ok(part.cards.find((x: any) => x.key === 'offer'));
  assert.ok(part.filters.some((f: any) => f.key === 'bankOrgId'));
  assert.ok(part.monitoring.some((b: any) => b.key === 'by-state'));
  assert.equal(typeof part.draftsCount, 'number');
  const encpc = (await ws(c.encpc, 'encpc')).parts[0].data;
  assert.deepEqual(encpc.panels, [], 'D14: no provider directory');
  assert.deepEqual(encpc.tools, [], 'D15: no approvals page');
  assert.ok(!encpc.filters.some((f: any) => f.key === 'bankOrgId'), 'ENCPC does not see banks');
});

test('system admin of the initiative: readiness, a read-only queue, its administration tools', async () => {
  const d = await ws(c.admin, 'system_admin');
  const part = d.parts[0].data;
  assert.equal(d.tab, 'readiness');
  assert.equal(part.decides, false);
  assert.ok(part.readiness.checks.some((x: any) => x.key === 'orgs_without_users'));
  assert.ok(part.tools.some((t: any) => t.view === 'admin-accounts'));
  const all = await ws(c.admin, 'system_admin', '&tab=all');
  assert.equal(all.queue.total, await total(c.admin, 'x=1'));
  assert.equal((await c.factory.get('/me/workspace/imc')).status, 403);
});
