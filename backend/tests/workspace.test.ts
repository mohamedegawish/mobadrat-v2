// One dashboard per user type across the initiatives (GET /me/workspace/:type): which dashboards a person has, the merged
// figures of the IMC dashboard, one initiative at a time, authorization, the super admin's operations dashboard, and one
// initiative failing without blanking the page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, isolateTestEnv, startServer } from './helpers.js';

const env = isolateTestEnv('workspace');
let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await env.cleanup(); });

const IMC_BOTH = 'imc@mobadrat.local';
const total = async (c: Client, p: string) => (await c.get(p)).json.data.total as number;

test('W-1 the shared IMC account holds IMC in both initiatives; /me tells each membership\'s dashboard', async () => {
  const c = await new Client(srv.base).login(IMC_BOTH);
  const me = (await c.get('/me')).json.data;
  const byId = Object.fromEntries(me.memberships.map((m: any) => [m.initiativeId, m]));
  assert.equal(byId.shams.role, 'imc_reviewer');
  assert.equal(byId.sona3.role, 'imc_officer');
  assert.equal(byId.shams.userType, 'imc');
  assert.equal(byId.sona3.userType, 'imc');
  const applicant = await new Client(srv.base).login('applicant@sona3.local');
  assert.equal((await applicant.get('/me')).json.data.memberships[0].userType, null, 'an applicant has «مبادراتي», not a dashboard');
});

test('W-2 the IMC dashboard sums both initiatives: «awaiting my decision» = the rows of each initiative\'s own queue', async () => {
  const c = await new Client(srv.base).login(IMC_BOTH);
  const r = await c.get('/me/workspace/imc');
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.merged, true);
  assert.equal(d.tab, 'mine');
  assert.deepEqual(d.initiatives.map((i: any) => i.initiativeId).sort(), ['shams', 'sona3']);
  assert.equal(d.parts.length, 2);
  assert.ok(d.parts.every((p: any) => p.ok), JSON.stringify(d.parts.map((p: any) => p.error)));
  const own = await total(c, '/i/shams/applications?mine=1') + await total(c, '/i/sona3/applications?mine=1');
  assert.equal(d.totals.awaitingMe, own);
  assert.equal(d.totals.awaitingMe, d.parts.reduce((s: number, p: any) => s + p.data.awaitingMe, 0));
  assert.ok(d.queue && Array.isArray(d.queue.items));
  for (const p of d.parts) {
    assert.ok(Array.isArray(p.data.cards) && p.data.cards.length > 0, `${p.initiativeId} has cards`);
    assert.equal(p.data.decides, true);
    assert.equal(p.data.queue, undefined, 'the queue is merged at the top, not repeated per initiative');
  }
});

test('W-3 one initiative at a time: its own pagination and filters, the same total as its own work queue', async () => {
  const c = await new Client(srv.base).login(IMC_BOTH);
  for (const id of ['shams', 'sona3']) {
    const d = (await c.get(`/me/workspace/imc?i=${id}&tab=all&pageSize=5`)).json.data;
    assert.equal(d.merged, false);
    assert.equal(d.initiative, id);
    assert.equal(d.parts.length, 1);
    assert.equal(d.queue.pageSize, 5);
    assert.equal(d.queue.total, await total(c, `/i/${id}/applications`));
    assert.ok(d.parts[0].data.filters.some((f: any) => f.key === 'governorate'));
    const monitoring = (await c.get(`/me/workspace/imc?i=${id}&tab=monitoring`)).json.data;
    assert.equal(monitoring.queue, null);
    assert.ok(monitoring.parts[0].data.monitoring.length > 0, `${id} monitoring blocks`);
  }
  assert.equal((await c.get('/me/workspace/imc?i=unknown')).status, 404);
});

test('W-4 authorization: only the person\'s own dashboards; unknown types; anonymous', async () => {
  const imc = await new Client(srv.base).login(IMC_BOTH);
  assert.equal((await imc.get('/me/workspace/pmu')).status, 403);
  assert.equal((await imc.get('/me/workspace/system_admin')).status, 403);
  assert.equal((await imc.get('/me/workspace/nothing')).status, 404);
  assert.equal((await imc.get('/me/workspace/applicant')).status, 404, 'applicants have no platform dashboard');
  const factory = await new Client(srv.base).login('factory@shams.local');
  assert.equal((await factory.get('/me/workspace/imc')).status, 403);
  const pmu = await new Client(srv.base).login('pmu@shams.local');
  const d = (await pmu.get('/me/workspace/pmu')).json.data;
  assert.deepEqual(d.initiatives.map((i: any) => i.initiativeId), ['shams']);
  assert.ok(d.parts[0].data.cards.some((x: any) => x.key === 'offer'));
  assert.equal((await new Client(srv.base).get('/me/workspace/imc')).status, 401);
  const evaluator = await new Client(srv.base).login('evaluator1@sona3.local');
  const ev = await evaluator.get('/me/workspace/evaluator');
  assert.equal(ev.status, 200);
  assert.ok(ev.json.data.parts[0].data.cards.some((x: any) => x.key === 'pending'));
});

test('W-5 the platform super admin: the operations dashboard of every initiative (readiness first), read-only', async () => {
  const admin = await new Client(srv.base).login('admin@mobadrat.local');
  const me = (await admin.get('/me')).json.data;
  assert.ok(me.adminEntries.every((e: any) => e.userType === 'system_admin'));
  const d = (await admin.get('/me/workspace/system_admin')).json.data;
  assert.equal(d.tab, 'readiness');
  assert.deepEqual(d.parts.map((p: any) => p.initiativeId).sort(), ['shams', 'sona3']);
  for (const p of d.parts) {
    assert.ok(p.ok);
    assert.equal(p.viaPlatformAdmin, true);
    assert.equal(p.data.decides, false);
    assert.ok(p.data.readiness.checks.length > 0);
  }
  const mine = (await admin.get('/me/workspace/system_admin?tab=mine')).json.data;
  assert.equal(mine.queue.total, 0, 'the system admin decides nothing');
  assert.equal((await admin.get('/me/workspace/imc')).status, 403, 'no IMC membership');
});

test('W-6 one initiative failing does not blank the dashboard: its part says so, the other one is shown', async () => {
  const { MODULES } = await import('../src/initiatives/registry.js');
  const sona3 = MODULES.find((m) => m.id === 'sona3')!;
  const original = sona3.workspace;
  sona3.workspace = async () => { throw new Error('boom'); };
  try {
    const c = await new Client(srv.base).login(IMC_BOTH);
    const r = await c.get('/me/workspace/imc');
    assert.equal(r.status, 200);
    const byId = Object.fromEntries(r.json.data.parts.map((p: any) => [p.initiativeId, p]));
    assert.equal(byId.shams.ok, true);
    assert.equal(byId.sona3.ok, false);
    assert.equal(byId.sona3.error.code, 'UNAVAILABLE');
    assert.ok(!JSON.stringify(byId.sona3.error).includes('boom'), 'no internal detail leaks');
  } finally {
    sona3.workspace = original;
  }
});
