// Sona3 in the platform dashboards (GET /me/workspace/:type): «awaiting my decision» and every stage card equal the rows of
// the module's own work queue; funders see only their stages; the system admin's readiness; the evaluator's assignments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, buildWorld, newApplicant, createCompleteDraft, act, ok, type Started, type World, type Client } from './helpers.js';

const env = isolateTestEnv('workspace');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv); });
after(async () => { await srv.close(); await env.cleanup(); });

const ws = async (cl: Client, type: string, query = '') => {
  const r = await cl.get(`/me/workspace/${type}?i=sona3${query}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};
const total = async (cl: Client, query: string) => (await cl.get(`/applications?${query}&pageSize=100`)).json.data.total as number;

test('IMC: «awaiting my decision» and the stage cards equal the module\'s own queue', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  ok(await act(a, id, 'submit'), 'submit');
  const d = await ws(w.imc, 'imc');
  const part = d.parts[0].data;
  assert.equal(part.awaitingMe, await total(w.imc, 'mine=1'));
  assert.ok(part.awaitingMe >= 1);
  assert.equal(d.queue.total, part.awaitingMe);
  const row = d.queue.items.find((r: any) => r.id === id);
  assert.ok(row && row.isMine && row.view === `application/${id}` && row.stateKey === 'ELIGIBILITY_REVIEW');
  const review = part.cards.find((x: any) => x.key === 'review');
  assert.equal(review.link.tab, 'all');
  const filtered = await ws(w.imc, 'imc', `&tab=all&state=${review.link.state}`);
  assert.equal(filtered.queue.total, review.value, 'card = queue');
  assert.equal(filtered.queue.total, await total(w.imc, `state=${review.link.state}`));
  assert.ok(part.tools.some((t: any) => t.view === 'ranking'));
  const mon = await ws(w.imc, 'imc', '&tab=monitoring');
  assert.ok(mon.parts[0].data.monitoring.some((b: any) => b.key === 'funnel'));
});

test('funder: only its referrals and its stages; evaluator: its assignments; admin: readiness', async () => {
  const f = (await ws(w.funderA, 'funder')).parts[0].data;
  assert.deepEqual(f.cards.map((x: any) => x.key), ['fund', 'run', 'completed', 'closed']);
  assert.equal(f.total, 0, 'nothing referred to this funder yet');
  assert.ok(!f.filters.some((x: any) => x.key === 'funderOrgId'));
  const e = await ws(w.eval1, 'evaluator', '&tab=all');
  assert.equal(e.queue.total, 0);
  assert.equal(e.parts[0].data.awaitingMe, 0);
  const admin = await ws(w.admin, 'system_admin');
  assert.ok(admin.parts[0].data.readiness.checks.some((x: any) => x.key === 'open_cohort'));
  assert.equal((await w.funderA.get('/me/workspace/imc')).status, 403);
});
