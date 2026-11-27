// D18: the Ministry of Electricity sees an application once PMU accepts its offer — the factory's data and everything before —
// and decides on it from its own platform dashboard. D15 / D18: the administrator creates its accounts (and ENCPC's) directly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, getApp, pdfVariant, q, PROVIDER_INFO, PROVIDERS_LINK, type Client, type Started } from './helpers.js';

const env = isolateTestEnv('electricity');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-ELC-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}
const portal = async (cl: Client, query = '') => {
  const r = await cl.get(`/me/workspace/electricity?i=shams${query}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.data;
};

test('nothing before PMU accepts the offer; afterwards the whole application, its documents and its dashboard row', async () => {
  await closeOpen();
  const id = await advanceTo('OFFER_REVIEW', c, reg());
  assert.equal((await c.electricity.get(`/applications/${id}`)).status, 404);
  assert.ok(!(await c.electricity.get('/applications?pageSize=100')).json.data.items.some((a: any) => a.id === id));
  assert.equal((await act(c.pmu, id, 'accept')).status, 200);

  const v = await getApp(c.electricity, id);
  for (const section of ['general', 'contact', 'company', 'engineering', 'provider']) assert.ok(v.data[section], `sees ${section}`);
  assert.equal(v.providerInfo.name, PROVIDER_INFO.providerName);
  assert.equal(v.encpcAcceptance.providersLink, PROVIDERS_LINK);
  for (const kind of ['commercialRegisterFile', 'taxCardFile', 'electricityBill', 'technicalOfferFile']) {
    const doc = v.documents.find((d: any) => d.kind === kind);
    assert.ok(doc, kind);
    assert.equal((await c.electricity.get(`/applications/${id}/documents/${doc.id}/download`)).status, 200, kind);
  }
  assert.deepEqual(v.allowedActions.map((a: any) => a.action).sort(), ['accept', 'request_correction']);
  assert.equal(v.currentTask.isMine, true);
  assert.equal(v.currentTask.responsible.type, 'electricity');

  const d = await portal(c.electricity, '&tab=mine');
  assert.ok(d.queue.items.some((r: any) => r.id === id && r.isMine));
  assert.equal(d.parts[0].data.cards.find((x: any) => x.key === 'electricity').value, 1);

  // the ministry has no other power over the application
  assert.equal((await c.electricity.put(`/applications/${id}/data/general`, { address: 'x' })).status, 403);
  assert.equal((await c.electricity.post(`/applications/${id}/remind`)).status, 403);
});

test('an application that was already under review before the change is approved with the file the factory had sent', async () => {
  await closeOpen();
  const id = await advanceTo('ELECTRICITY_REVIEW', c, reg());
  const { getDb } = await import('../db/database.js');
  await getDb().prepare(`INSERT INTO shams_documents (id, applicationId, kind, version, attempt, uploadedInState, originalName, storedName, sizeBytes, sha256, uploadedBy, createdAt)
    SELECT 'doc-legacy-elec', applicationId, 'electricityApprovalFile', 1, 1, 'ELECTRICITY_UPLOAD', 'approval.pdf', 'legacy-elec.pdf', sizeBytes, sha256, uploadedBy, createdAt
    FROM shams_documents WHERE applicationId = ? AND kind = 'technicalOfferFile' LIMIT 1`).run(id);
  const r = await act(c.electricity, id, 'accept', { distributionCompany: 'شركة توزيع' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await getApp(c.factory, id)).state, 'CONTRACT_OUTCOME');
});

test('D15 / D18: the administrator creates ENCPC and ministry accounts directly; a request filed through the API waits for PMU', async () => {
  const encpc = await c.admin.post('/admin/users', { email: 'new.encpc@shams.local', nameAr: 'مراجع جديد', role: 'encpc_reviewer', organizationId: 'org-encpc' });
  assert.equal(encpc.status, 201, JSON.stringify(encpc.json));
  assert.equal((await q("SELECT 1 FROM users WHERE email = 'new.encpc@shams.local'")).length, 1);

  const el = await c.admin.post('/admin/users', { email: 'new.elec@shams.local', nameAr: 'مراجع كهرباء', role: 'electricity_reviewer', organizationId: 'org-electricity' });
  assert.equal(el.status, 201, JSON.stringify(el.json));
  assert.equal((await q("SELECT 1 FROM users WHERE email = 'new.elec@shams.local'")).length, 1);
  assert.equal((await q("SELECT 1 FROM shams_account_requests WHERE email = 'new.elec@shams.local'")).length, 0, 'no request to approve');

  // an integration key never creates an account by itself
  const key = await c.admin.post('/admin/integration-keys', { name: 'accounts-key', scopes: ['manage_users'], rateLimitPerMinute: 100 });
  assert.equal(key.status, 201, JSON.stringify(key.json));
  const filed = await fetch(`${srv.integration}/users`, { method: 'POST', headers: { Authorization: `Bearer ${key.json.data.plaintextKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'api.elec@shams.local', nameAr: 'مراجع عبر الربط', role: 'electricity_reviewer', organizationId: 'org-electricity' }) });
  assert.equal(filed.status, 202);
  const requestId = ((await filed.json()) as any).data.request.id;
  assert.equal((await c.imc.post(`/account-requests/${requestId}/approve`, {})).status, 403);
  assert.equal((await c.pmu.post(`/account-requests/${requestId}/approve`, {})).status, 200);

  // a suspended organization takes no new account
  const { getDb } = await import('../db/database.js');
  await getDb().prepare("UPDATE shams_organizations SET isActive = 0 WHERE id = 'org-electricity'").run();
  try {
    const off = await c.admin.post('/admin/users', { email: 'off.elec@shams.local', nameAr: 'مراجع', role: 'electricity_reviewer', organizationId: 'org-electricity' });
    assert.ok(off.status >= 400, JSON.stringify(off.json));
    assert.equal((await q("SELECT 1 FROM users WHERE email = 'off.elec@shams.local'")).length, 0);
  } finally { await getDb().prepare("UPDATE shams_organizations SET isActive = 1 WHERE id = 'org-electricity'").run(); }
});

test('the approval file the ministry prepares is limited to its review: no upload before or after', async () => {
  await closeOpen();
  const id = await advanceTo('BANK_SELECTION', c, reg());
  const late = await c.electricity.upload(`/applications/${id}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('late'), 'late.pdf');
  assert.ok(late.status >= 400, JSON.stringify(late.json));
});
