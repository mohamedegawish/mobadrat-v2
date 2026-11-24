// F5 / D6 (QA 2026-11-23, BUG-07, T25): the chosen provider is suspended while the application is in «رفع العرض الفني» →
// it returns to «اختيار مقدم الخدمة» with a history entry, a webhook and a factory notification (in-app and e-mail).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, q, advanceTo, pdfVariant, PROVIDER_OK, type Started } from './helpers.js';

const env = isolateTestEnv('d6');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

test('suspension in Upload offer → back to Choose provider, recorded and notified; the unsent offer is discarded on re-pick', async () => {
  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  const id = await advanceTo('PROVIDER_SELECTION', c, `IND-D6-${process.pid}`);
  assert.equal((await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK })).status, 200);
  const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-x'), 'offer-x.pdf');
  assert.equal(up.status, 201);
  assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 200);
  try {
    const v = await getApp(c.factory, id);
    assert.equal(v.state, 'PROVIDER_SELECTION', 'returned to provider selection');
    assert.equal(v.stateLabelAr, 'اختيار مقدم الخدمة');
    assert.match(v.currentTask.labelAr, /اختر مقدم الخدمة/, 'the task text follows the state');
    const t = v.transitions.at(-1);
    assert.equal(t.action, 'provider_suspended_reselect');
    assert.equal(t.fromState, 'OFFER_UPLOAD');
    assert.equal(t.toState, 'PROVIDER_SELECTION');
    const inbox = (await c.factory.get('/notifications?pageSize=20')).json.data.items.filter((n: any) => n.applicationId === id && n.templateKey === 'app.provider_suspended');
    assert.ok(inbox.length >= 1, 'in-app notification to the factory');
    assert.equal((await q("SELECT 1 FROM shams_webhook_outbox WHERE payload LIKE ?", `%${id}%PROVIDER_SELECTION%`)).length >= 1, true, 'webhook queued');
    assert.deepEqual(v.allowedActions.map((a: any) => a.action).sort(), ['select_provider', 'withdraw']);
    assert.equal((await act(c.factory, id, 'select_provider', { providerId: 'sp-demo-2' })).status, 200, 'an alternative provider');
    const after = await getApp(c.factory, id);
    assert.equal(after.state, 'OFFER_UPLOAD');
    assert.ok(!after.documents.some((d: any) => d.kind === 'technicalOfferFile' && d.isCurrent), 'the unsent offer for the suspended provider is not carried over');
  } finally {
    await c.pmu.post(`/service-providers/${PROVIDER_OK}/approve`, {});
  }
});
