// F6 / D7 (QA 2026-11-23, BUG-08, T27): the chosen provider is suspended after PMU accepted the offer (after T13) → the state
// does not change; the factory and PMU get a warning in-app and by e-mail, and the application history records it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, q, advanceTo, PROVIDER_OK, type Started } from './helpers.js';

const env = isolateTestEnv('d7');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

test('suspension after the offer was accepted: unchanged state, warning to the factory and PMU (in-app + e-mail), history entry', async () => {
  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  const id = await advanceTo('ELECTRICITY_UPLOAD', c, `IND-D7-${process.pid}`);
  const before = await getApp(c.pmu, id);
  assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 200);
  try {
    const v = await getApp(c.factory, id);
    assert.equal(v.state, 'ELECTRICITY_UPLOAD', 'state unchanged');
    assert.equal(v.version, before.version, 'no state change');
    const t = (await getApp(c.pmu, id)).transitions.at(-1);
    assert.equal(t.action, 'provider_suspended_warning');
    assert.equal(t.fromState, t.toState);
    const inboxOf = async (cl: typeof c.factory) => (await cl.get('/notifications?pageSize=20')).json.data.items.filter((n: any) => n.applicationId === id && n.templateKey === 'app.provider_suspended');
    assert.ok((await inboxOf(c.factory)).length >= 1, 'factory warned in-app');
    assert.ok((await inboxOf(c.pmu)).length >= 1, 'PMU warned in-app');
    const mails = await q<{ recipientAddress: string }>("SELECT recipientAddress FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.provider_suspended' AND channel = 'email'", id);
    assert.ok(mails.some((m) => m.recipientAddress === c.factory.user.email), 'factory warned by e-mail');
    assert.ok(mails.some((m) => m.recipientAddress === 'pmu@shams.local'), 'PMU warned by e-mail');
    assert.ok(v.allowedActions.some((a: any) => a.action === 'submit_electricity'), 'the factory carries on');
  } finally {
    await c.pmu.post(`/service-providers/${PROVIDER_OK}/approve`, {});
  }
});
