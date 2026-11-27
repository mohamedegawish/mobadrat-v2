// F2 / D3 (QA 2026-11-23, BUG-04 and BUG-03): before IMC accepts it, a factory may read its submitted application, withdraw it
// with a reason (IMC review and data completion) and file a registry objection — and nothing else. A brand-new factory whose
// number another factory already uses gets an account and a held draft (public sign-up or enrolment) and can object at once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, clients, act, getApp, q, pdfVariant, Client, registerFactory, registrationPayload, activationTokenFor,
  advanceTo, type Started,
} from './helpers.js';

const env = isolateTestEnv('d3');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const PASSWORD = 'Factory123';

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

/** Public sign-up + activation; returns the signed-in factory and its application id. */
async function selfRegistered(regNumber: string): Promise<{ f: Client; appId: string; email: string; signup: any; verify: any }> {
  const email = `d3-${process.pid}-${++seq}@factory.test`;
  const signup = await registerFactory(new Client(srv.base), registrationPayload(email, regNumber));
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  const verify = await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(email) });
  assert.equal(verify.status, 200, JSON.stringify(verify.json));
  const f = await new Client(srv.base).login(email, PASSWORD);
  const appId = (await q<{ id: string }>("SELECT a.id FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId JOIN shams_organizations o ON o.id = f.organizationId WHERE o.contactEmail = ?", email))[0].id;
  return { f, appId, email, signup: signup.json, verify: verify.json };
}
const objection = (f: Client, registryNumber: string) =>
  f.multipart('/registry-objections', { registryNumber, note: 'الرقم لمنشأتنا' }, [{ field: 'file', body: pdfVariant(`obj-${registryNumber}`), name: 'objection.pdf' }]);

test('under IMC review: read-only view of its own application, withdraw with a reason; everything else still refused', async () => {
  const { f, appId } = await selfRegistered(`IND-D3-A-${process.pid}`);
  const v = await f.get(`/applications/${appId}`);
  assert.equal(v.status, 200, 'reads its submitted application');
  assert.equal(v.json.data.state, 'IMC_REVIEW');
  assert.deepEqual(v.json.data.allowedActions.map((a: any) => a.action), ['withdraw'], 'withdraw is its only action');
  assert.equal((await f.get('/factory/profile')).status, 403, 'D3 names the application only, not the factory profile');
  // still locked
  assert.equal((await f.get('/applications')).status, 403, 'no list / dashboard');
  assert.equal((await f.put(`/applications/${appId}/data/general`, { address: 'تعديل' })).status, 403, 'no edits');
  assert.equal((await f.upload(`/applications/${appId}/documents`, { kind: 'commercialRegisterFile' }, pdfVariant('x'), 'x.pdf')).status, 403, 'no uploads');
  assert.equal((await f.post(`/applications/${appId}/actions/submit`, { expectedVersion: v.json.data.version })).status, 403, 'no submit');
  assert.equal((await f.get('/notifications')).status, 403, 'no initiative inbox screen');
  // withdraw: a reason is required, then it closes
  assert.equal((await act(f, appId, 'withdraw', {})).status, 400, 'reason required');
  const w = await act(f, appId, 'withdraw', { reason: 'قررنا تأجيل المشروع' });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal((await getApp(c.imc, appId)).state, 'WITHDRAWN');
  assert.equal((await f.get(`/applications/${appId}`)).status, 200, 'the withdrawn application stays readable');
});

test('during data completion: withdraw with a reason', async () => {
  const { f, appId } = await selfRegistered(`IND-D3-B-${process.pid}`);
  assert.equal((await act(c.imc, appId, 'request_correction', { deficiencies: [{ field: 'address', note: 'أكمل العنوان' }] })).status, 200);
  const w = await act(f, appId, 'withdraw', { reason: 'نسحب الطلب لحين استكمال المستندات' });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.equal((await getApp(c.imc, appId)).state, 'WITHDRAWN');
});

test('public sign-up with a number in use: account + held draft, objection right away, no submit until PMU decides', async () => {
  // c.factory2 holds the number in IMC review
  const own = (await c.factory2.get('/factory/profile')).json.data.openApplicationId;
  if (own) await act(c.factory2, own, 'withdraw', { reason: 'تنظيف قبل الاختبار' });
  const N = `IND-D3-HELD-${process.pid}`;
  const holder = await advanceTo('IMC_REVIEW', { factory: c.factory2, imc: c.imc, encpc: c.encpc, pmu: c.pmu, electricity: c.electricity }, N);
  const { f, appId, signup, verify } = await selfRegistered(N);
  assert.equal(signup.data.registryHeld, true, 'the sign-up says the number is held');
  assert.equal(verify.data.modules.shams.registryHeld, true, 'activation says so too (not submitted)');
  const v = await getApp(f, appId);
  assert.equal(v.state, 'DRAFT', 'the draft is kept');
  assert.equal(v.registryHold?.reason, 'in_use');
  assert.equal(v.registryHold?.registryNumber, N);
  assert.equal((await q('SELECT 1 FROM shams_registry_conflicts WHERE registryNumber = ? AND holdingApplicationId = ?', N, holder)).length, 1, 'conflict recorded for IMC and PMU');
  assert.equal((await act(f, appId, 'submit')).status, 409, 'cannot be submitted until PMU decides');
  const o = await objection(f, N);
  assert.equal(o.status, 201, JSON.stringify(o.json));
  assert.equal((await getApp(f, appId)).registryHold?.objection?.status, 'pending');
  assert.equal((await f.get('/applications')).status, 403, 'everything else stays locked');
});

test('enrolment from a platform account with a number in use opens a held draft (no 409) and the objection is accepted', async () => {
  const holderNumber = `IND-D3-ENR-${process.pid}`;
  const own = (await c.factory2.get('/factory/profile')).json.data.openApplicationId;
  if (own) await act(c.factory2, own, 'withdraw', { reason: 'تنظيف قبل الاختبار' });
  await advanceTo('IMC_REVIEW', { factory: c.factory2, imc: c.imc, encpc: c.encpc, pmu: c.pmu, electricity: c.electricity }, holderNumber);
  const email = `d3-enr-${process.pid}-${++seq}@platform.test`;
  const anon = new Client(srv.base);
  const reg = await fetch(`${srv.base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: 'م. منصة', email, mobile: '01055556666', password: PASSWORD }) });
  assert.equal(reg.status, 201);
  assert.equal((await anon.post('/auth/verify-email', { token: await activationTokenFor(email) })).status, 200);
  const p = await new Client(srv.base).login(email, PASSWORD);
  const values = {
    'factory.companyName': 'مصنع المنصة المعترض', 'factory.governorate': 'sharqia', 'factory.industrialZone': '10th-ramadan', 'factory.address': 'المنطقة الأولى',
    'factory.phone1': '0551234567', 'factory.contactName': 'م. منصة', 'factory.contactTitle': 'مدير', 'factory.contactMobile': '01055556666', 'factory.contactEmail': email,
    'factory.commercialRegisterNumber': 'CR-77', 'factory.industrialRegistryNumber': holderNumber, 'factory.taxNumber': '111-222-333',
    'factory.roofAreas': [{ name: 'السطح', area: 900 }], 'factory.contractedCapacity': 500, 'factory.capacityUnit': 'kW', 'factory.peakLoad': 400, 'factory.loadUnit': 'kW',
    'factory.ownershipType': 'owned', 'factory.ownershipExpiresAt': '2045-01-01',
  };
  const fac = await p.post('/me/factories', { values });
  assert.equal(fac.status, 201, JSON.stringify(fac.json));
  for (const kind of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'ownershipProofFile']) {
    const up = await p.upload('/me/profile-documents', { kind, ownerId: fac.json.data.id }, pdfVariant(`enr-${kind}`), `${kind}.pdf`);
    assert.equal(up.status, 201, JSON.stringify(up.json));
  }
  const en = await p.post('/me/initiatives/shams/enroll', { factoryId: fac.json.data.id });
  assert.equal(en.status, 201, `enrolment opens the file: ${JSON.stringify(en.json)}`);
  await p.login(email, PASSWORD);
  const appId = en.json.data.applicationId as string;
  assert.equal((await getApp(p, appId)).registryHold?.reason, 'in_use');
  assert.equal((await objection(p, holderNumber)).status, 201, 'objection right away, from the draft');
});
