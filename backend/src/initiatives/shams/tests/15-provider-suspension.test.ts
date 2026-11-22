// القاعدة F + القرار 6: أثر إيقاف مقدم الخدمة المختار حسب مرحلة الطلب.
//  قبل إرسال العرض → إعادة اختيار | أثناء مراجعة العرض أو تصحيحه → عودة آلية إلى OFFER_UPLOAD | بعد قبول العرض → تنبيه فقط.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, pdfVariant, q, PROVIDER_OK, type Started } from './helpers.js';

const env = isolateTestEnv('suspension');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-SUS-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const suspend = (id = PROVIDER_OK) => c.pmu.post(`/service-providers/${id}/suspend`, {});
const approve = (id = PROVIDER_OK) => c.pmu.post(`/service-providers/${id}/approve`, {});
const outbox = (appId: string, key: string) => q<{ recipientAddress: string; channel: string }>(
  'SELECT recipientAddress, channel FROM notification_outbox WHERE applicationId = ? AND templateKey = ?', appId, key);

test('during offer review: suspension returns the application to OFFER_UPLOAD with a system transition, audit row, webhook and notices', async () => {
  await closeOpen();
  const id = await advanceTo('OFFER_REVIEW', c, reg());
  const before = await getApp(c.pmu, id);
  assert.equal(before.state, 'OFFER_REVIEW');
  assert.equal((await suspend()).status, 200);
  try {
    const view = await getApp(c.factory, id);
    assert.equal(view.state, 'OFFER_UPLOAD');
    assert.equal(view.version, before.version + 1, 'version bumped (optimistic locking stays valid)');
    const t = view.transitions.find((x: any) => x.action === 'provider_suspended_return');
    assert.ok(t, 'transition recorded');
    assert.equal(t.fromState, 'OFFER_REVIEW');
    assert.equal(t.toState, 'OFFER_UPLOAD');
    assert.equal(t.actorRole, 'pmu_reviewer', 'accountable actor = who suspended the provider');
    assert.match(t.reason, /أُعيد الطلب آليًا/);
    assert.equal(view.provider.status, 'suspended');
    // المصنع: يعيد الاختيار ولا يرسل العرض الحالي
    assert.deepEqual(view.allowedActions.map((a: any) => a.action).sort(), ['select_provider', 'withdraw']);
    const blocked = await act(c.factory, id, 'submit_offer');
    assert.ok([409, 422].includes(blocked.status));
    // PMU لم يعد يملك قبول عرض مقدم موقوف
    assert.ok(!(await getApp(c.pmu, id)).allowedActions.some((a: any) => a.action === 'accept'));
    const stale = await c.pmu.post(`/applications/${id}/actions/accept`, { expectedVersion: before.version });
    assert.equal(stale.status, 409, 'a decision based on the old version is refused');
    // أثر جانبي: تدقيق + webhook + إشعارات
    assert.equal((await q("SELECT 1 FROM audit_logs WHERE action = 'application.provider_suspended_return' AND applicationId = ?", id)).length, 1);
    assert.ok((await q("SELECT 1 FROM shams_webhook_outbox WHERE payload LIKE '%provider_suspended_return%'")).length >= 1);
    const mails = (await outbox(id, 'app.provider_suspended')).map((r) => r.recipientAddress);
    assert.ok(mails.includes('factory@shams.local') && mails.includes('pmu@shams.local'), `recipients: ${mails}`);
    // مسار الاستكمال: بديل معتمد + عرض جديد → يعود إلى OFFER_REVIEW
    assert.equal((await act(c.factory, id, 'select_provider', { providerId: 'sp-demo-2' })).status, 200);
    assert.equal((await act(c.factory, id, 'submit_offer')).status, 422, 'a new offer document is mandatory');
    assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('replacement'), 'offer.pdf')).status, 201);
    assert.equal((await act(c.factory, id, 'submit_offer')).status, 200);
    const after = await getApp(c.pmu, id);
    assert.equal(after.state, 'OFFER_REVIEW');
    assert.equal(after.provider.id, 'sp-demo-2');
    assert.ok(after.documents.filter((d: any) => d.kind === 'technicalOfferFile').length >= 2, 'previous offer versions are preserved');
  } finally { await approve(); }
});

test('during offer correction: same return to OFFER_UPLOAD', async () => {
  await closeOpen();
  const id = await advanceTo('OFFER_REVIEW', c, reg());
  assert.equal((await act(c.pmu, id, 'request_correction', { reason: 'العرض غير مكتمل' })).status, 200);
  assert.equal((await getApp(c.factory, id)).state, 'OFFER_CORRECTION');
  assert.equal((await suspend()).status, 200);
  try {
    const view = await getApp(c.factory, id);
    assert.equal(view.state, 'OFFER_UPLOAD');
    assert.ok(view.transitions.some((x: any) => x.action === 'provider_suspended_return' && x.fromState === 'OFFER_CORRECTION'));
    assert.ok(view.allowedActions.some((a: any) => a.action === 'select_provider'));
  } finally { await approve(); }
});

test('before the offer is sent (OFFER_UPLOAD): no automatic transition, factory and PMU are told', async () => {
  await closeOpen();
  const id = await advanceTo('PROVIDER_SELECTION', c, reg());
  assert.equal((await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK })).status, 200);
  const v = (await getApp(c.factory, id)).version;
  assert.equal((await suspend()).status, 200);
  try {
    const view = await getApp(c.factory, id);
    assert.equal(view.state, 'OFFER_UPLOAD');
    assert.equal(view.version, v, 'no system transition');
    assert.ok(!view.transitions.some((x: any) => x.action === 'provider_suspended_return'));
    assert.ok((await outbox(id, 'app.provider_suspended')).some((r) => r.recipientAddress === 'factory@shams.local'));
  } finally { await approve(); }
});

test('after the offer was accepted: alert only — the application is not reset and the factory is not asked to act', async () => {
  await closeOpen();
  const id = await advanceTo('ELECTRICITY_UPLOAD', c, reg());
  const before = await getApp(c.pmu, id);
  assert.equal((await suspend()).status, 200);
  try {
    const view = await getApp(c.pmu, id);
    assert.equal(view.state, 'ELECTRICITY_UPLOAD', 'state unchanged');
    assert.equal(view.version, before.version, 'version unchanged');
    assert.equal(view.provider.status, 'suspended', 'status still shown on the application');
    assert.ok(!view.transitions.some((x: any) => x.action === 'provider_suspended_return'));
    const mails = (await outbox(id, 'app.provider_suspended')).map((r) => r.recipientAddress);
    assert.ok(mails.includes('pmu@shams.local'), 'PMU alerted');
    assert.ok(!mails.includes('factory@shams.local'), 'factory is not asked to do anything');
    // الاستمرار الطبيعي ممكن: رفع موافقة الكهرباء
    assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('e1'), 'a.pdf')).status, 201);
    const go = await act(c.factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع' });
    assert.equal(go.status, 200, JSON.stringify(go.json));
  } finally { await approve(); }
});

test('only the PMU-approved→suspended change triggers the effect, and a second suspend does not repeat it', async () => {
  await closeOpen();
  const id = await advanceTo('OFFER_REVIEW', c, reg());
  assert.equal((await suspend()).status, 200);
  try {
    const n1 = (await getApp(c.pmu, id)).transitions.filter((x: any) => x.action === 'provider_suspended_return').length;
    assert.equal(n1, 1);
    assert.equal((await suspend()).status, 200, 'idempotent endpoint');
    const n2 = (await getApp(c.pmu, id)).transitions.filter((x: any) => x.action === 'provider_suspended_return').length;
    assert.equal(n2, 1, 'no duplicate system transition');
    // لا أحد غير الجهة المعتمدة يوقف مقدم الخدمة
    for (const client of [c.imc, c.factory, c.admin]) assert.equal((await client.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 403);
  } finally { await approve(); }
});
