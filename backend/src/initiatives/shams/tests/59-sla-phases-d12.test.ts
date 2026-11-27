// D12: IMC 2 days, ENCPC 3 days, and one 9-day offer deadline from ENCPC's acceptance until PMU accepts the offer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, advanceTo, act, getApp, q, pdfVariant, type Started } from './helpers.js';

const env = isolateTestEnv('sla-phases');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
const DAY = 86_400_000;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

const slaStart = async (id: string) => (await q<{ slaStartedAt: string }>('SELECT slaStartedAt FROM shams_applications WHERE id = ?', id))[0].slaStartedAt;

test('per-stage deadlines: ENCPC 3 days', async () => {
  const id = await advanceTo('ENCPC_REVIEW', c, 'IND-D12-1');
  const v = await getApp(c.encpc, id);
  assert.equal(v.currentTask.slaDays, 3);
  assert.equal(Date.parse(v.currentTask.dueAt) - Date.parse(v.stateEnteredAt), 3 * DAY);
  assert.equal((await act(c.factory, id, 'withdraw', { reason: 'إنهاء' })).status, 200);
});

test('offer phase: one 9-day deadline that moving between the offer states does not restart', async () => {
  const id = await advanceTo('OFFER_UPLOAD', c, 'IND-D12-2');
  const start = await slaStart(id);
  let v = await getApp(c.pmu, id);
  assert.equal(v.currentTask.slaDays, 9);
  assert.equal(Date.parse(v.currentTask.dueAt) - Date.parse(start), 9 * DAY);

  const { getDb } = await import('../db/database.js');
  const old = new Date(Date.now() - 10 * DAY).toISOString();
  await getDb().prepare('UPDATE shams_applications SET slaStartedAt = ? WHERE id = ?').run(old, id);
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-d12'), 'offer.pdf')).status, 201);
  assert.equal((await act(c.factory, id, 'submit_offer')).status, 200);
  assert.equal(await slaStart(id), old, 'the upload does not restart the phase');
  v = await getApp(c.pmu, id);
  assert.equal(v.overdue, true, 'late since the phase began, although PMU has only just received it');

  assert.equal((await act(c.pmu, id, 'accept')).status, 200);
  v = await getApp(c.pmu, id);
  assert.equal(v.overdue, false);
  assert.equal(v.currentTask.dueAt, null);
  assert.equal(await slaStart(id), v.stateEnteredAt);
});
