// اختبارا القبول 2 و3: سجل خطأ يبقى DRAFT ويُصحح دون إعادة إدخال، وتعطل API السجل بلا إحالة ولا فقد بيانات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isolateTestEnv, startServer, clients, createCompleteDraft, act, getApp, q, type Started } from './helpers.js';

const env = isolateTestEnv('registry');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

test('2) invalid registry number stays DRAFT, factory corrects only the number and completes', async () => {
  const id = await createCompleteDraft(c.factory, 'INVALID-123');
  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'REGISTRY_INVALID');
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'DRAFT');
  assert.equal(app.number, null);
  assert.equal(app.registry.result, 'invalid');
  assert.equal(app.data.general.companyName, 'مصنع تجريبي للصناعات المعدنية', 'data preserved');
  assert.equal(app.documents.length, 7, 'documents preserved');
  // سطر تاريخي + إشعار للمصنع + تحقق محفوظ
  const t = (await q<{ fromState: string; toState: string }>('SELECT fromState, toState FROM application_transitions WHERE applicationId = ?', id)).map((x) => ({ ...x }));
  assert.deepEqual(t, [{ fromState: 'DRAFT', toState: 'DRAFT' }]);
  assert.ok((await q("SELECT 1 FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.registry_failed'", id)).length >= 1);
  assert.equal((await q("SELECT result FROM registry_verifications WHERE applicationId = ?", id))[0]?.result, 'invalid');
  // IMC لا يرى المسودة
  assert.equal((await c.imc.get(`/applications/${id}`)).status, 404);

  // تصحيح الرقم فقط
  const fix = await c.factory.put(`/applications/${id}/data/company`, { industrialRegistryNumber: 'IND-FIXED-777' });
  assert.equal(fix.status, 200);
  const ok = await act(c.factory, id, 'submit');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'IMC_REVIEW');
  assert.equal(app.industrialRegistryNumber, 'IND-FIXED-777');
  assert.equal(app.data.engineering.roofAreas.length, 2, 'no re-entry needed');
});

test('3) registry API outage: no referral, no data loss, retry succeeds (real HTTP adapter)', async () => {
  let mode: 'down' | 'up' = 'down';
  const fake = http.createServer((req, res) => {
    if (mode === 'down') { res.writeHead(503); res.end('unavailable'); return; }
    const num = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ found: true, registration: { number: num, name: 'منشأة من السجل', status: 'active' } }));
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const { port } = fake.address() as AddressInfo;
  process.env.REGISTRY_ADAPTER = 'http';
  process.env.REGISTRY_API_URL = `http://127.0.0.1:${port}`;
  process.env.REGISTRY_API_KEY = 'test-key';
  try {
    const id = await createCompleteDraft(c.factory2, 'IND-OUTAGE-55');
    const r = await act(c.factory2, id, 'submit');
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'REGISTRY_UNAVAILABLE', 'unavailable is never treated as valid');
    let app = await getApp(c.factory2, id);
    assert.equal(app.state, 'DRAFT');
    assert.equal(app.registry.result, 'unavailable');
    assert.equal((await q("SELECT 1 FROM application_transitions WHERE applicationId = ? AND toState = 'IMC_REVIEW'", id)).length, 0, 'no referral');
    assert.equal(app.documents.length, 7);

    mode = 'up';
    const retry = await act(c.factory2, id, 'submit');
    assert.equal(retry.status, 200, JSON.stringify(retry.json));
    app = await getApp(c.factory2, id);
    assert.equal(app.state, 'IMC_REVIEW');
    assert.equal(app.registry.result, 'valid');
    assert.equal(app.registry.facility.facilityName, 'منشأة من السجل');
  } finally {
    process.env.REGISTRY_ADAPTER = 'mock';
    await new Promise((r) => fake.close(() => r(null)));
  }
});

test('3b) registry timeout/network errors map to unavailable', async () => {
  const { mapResponse } = await import('../src/integrations/registry/mapResponse.js');
  assert.equal(mapResponse('X', 500, null).result, 'unavailable');
  assert.equal(mapResponse('X', 200, { weird: true }).result, 'unavailable');
  assert.equal(mapResponse('X', 404, null).result, 'invalid');
  assert.equal(mapResponse('X', 200, { found: false }).result, 'invalid');
  assert.equal(mapResponse('X', 200, { found: true, registration: { number: 'X', status: 'cancelled' } }).result, 'invalid');
  process.env.REGISTRY_ADAPTER = 'http';
  process.env.REGISTRY_API_URL = 'http://127.0.0.1:1';
  try {
    const { getRegistryClient } = await import('../src/integrations/registry/index.js');
    const r = await getRegistryClient().verify('IND-1');
    assert.equal(r.result, 'unavailable');
  } finally { process.env.REGISTRY_ADAPTER = 'mock'; }
});
