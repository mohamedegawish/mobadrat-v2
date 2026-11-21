// Factory account acceptance before sign-in (factories.accountStatus, migration 009). A self-registered factory signs in only
// after its email is verified AND IMC accepts its registration (the existing first review decides the account; IMC logic is
// unchanged). A correction request allows a restricted sign-in (edit the requested items and resubmit only); after resubmitting
// the session ends until the next decision. Each decision emails the factory with the branded account templates (logo + colours).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, clients, Client, q, act, getApp, DEV, sentMails, pdfVariant,
  registerFactory, registrationPayload, activationTokenFor, type Started,
} from './helpers.js';

const env = isolateTestEnv('accounts');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { const { setRegistryClientForTests } = await import('../src/integrations/registry/index.js'); setRegistryClientForTests(null); await srv.close(); await env.cleanup(); });

const PASSWORD = 'Factory123';
async function flush() { const { processNotifications } = await import('../src/jobs/notificationWorker.js'); await processNotifications(200); }
async function status(email: string): Promise<string> {
  return (await q<{ s: string }>('SELECT f.accountStatus AS s FROM factories f JOIN users u ON u.organizationId = f.organizationId WHERE u.email = ?', email))[0].s;
}
async function appOf(email: string): Promise<string> {
  return (await q<{ id: string }>('SELECT a.id FROM applications a JOIN factories f ON f.id = a.factoryId JOIN users u ON u.organizationId = f.organizationId WHERE u.email = ? ORDER BY a.createdAt DESC', email))[0].id;
}
async function templatesFor(email: string): Promise<string[]> {
  await flush();
  return (await q<{ k: string }>("SELECT templateKey AS k FROM notification_outbox WHERE recipientAddress = ? AND channel = 'email' ORDER BY createdAt", email)).map((r) => r.k);
}
const login = (email: string) => new Client(srv.base).post('/auth/login', { email, password: PASSWORD });

/** تسجيل كامل + تفعيل البريد → الطلب لدى IMC. */
async function registeredAndVerified(tag: string): Promise<{ email: string; appId: string }> {
  const email = `acc.${tag}.${++seq}@test.local`;
  const r = await registerFactory(new Client(srv.base), registrationPayload(email, `IND-ACC-${tag}-${seq}`));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(await status(email), 'pending');
  const v = await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(email) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.data.submitted, true);
  return { email, appId: await appOf(email) };
}

test('ACC-1 after activation the registration goes to IMC and the account cannot sign in while under review', async () => {
  const { email, appId } = await registeredAndVerified('review');
  assert.equal((await getApp(c.imc, appId)).state, 'IMC_REVIEW');
  assert.equal(await status(email), 'under_review');
  const r = await login(email);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'ACCOUNT_UNDER_REVIEW');
  assert.match(r.json.messageAr, /قيد مراجعة/);
  const keys = await templatesFor(email);
  assert.ok(keys.includes('account.under_review'), keys.join(','));
  assert.ok(!keys.includes('app.submitted'), 'one receipt, not two');
  // IMC sees the documents that were uploaded with the registration.
  const imcView = await getApp(c.imc, appId);
  assert.equal(imcView.documents.filter((d: any) => d.isCurrent).length, 6);
});

test('ACC-2 correction request: branded email, restricted sign-in (edit requested items + resubmit only), then locked again until the decision', async () => {
  const { email, appId } = await registeredAndVerified('corr');
  const r = await act(c.imc, appId, 'request_correction', { deficiencies: [{ field: 'taxCardFile', note: 'البطاقة منتهية' }, { field: 'address', note: 'العنوان غير مكتمل' }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(await status(email), 'correction');
  const keys = await templatesFor(email);
  assert.ok(keys.includes('account.correction_requested') && !keys.includes('app.correction_requested'), keys.join(','));
  const mail = [...sentMails].reverse().find((m) => m.to.includes(email) && /تعديل بيانات تسجيل/.test(m.subject));
  assert.ok(mail, 'correction email sent');
  assert.match(mail!.html, /البطاقة الضريبية/);
  assert.match(mail!.html, /cid:platform-logo/);
  assert.ok(mail!.attachments.some((a) => a.cid === 'platform-logo'), 'logo embedded');
  assert.match(mail!.html, /#login/);

  // Restricted sign-in.
  const f = await new Client(srv.base).login(email, PASSWORD);
  assert.equal(f.user.accountStatus, 'correction');
  assert.equal((await f.get('/factory/profile')).status, 200);
  assert.equal((await f.get(`/applications/${appId}`)).status, 200);
  for (const [what, res] of [
    ['list', await f.get('/applications')],
    ['inbox', await f.get('/notifications')],
    ['providers', await f.get('/service-providers')],
    ['new application', await f.post('/applications', {})],
  ] as const) {
    assert.equal(res.status, 403, what);
    assert.equal(res.json.code, 'ACCOUNT_RESTRICTED', what);
  }
  const withdraw = await f.post(`/applications/${appId}/actions/withdraw`, { expectedVersion: 1, reason: 'x' });
  assert.equal(withdraw.status, 403);
  // Only the requested items can change.
  assert.equal((await f.put(`/applications/${appId}/data/general`, { phone2: '0229998888' })).status, 409, 'not in the deficiencies');
  assert.equal((await f.put(`/applications/${appId}/data/general`, { address: 'العنوان الكامل الجديد' })).status, 200);
  assert.equal((await f.upload(`/applications/${appId}/documents`, { kind: 'taxCardFile' }, pdfVariant('tax-new'), 'tax-new.pdf')).status, 201);
  const re = await act(f, appId, 'resubmit');
  assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.equal(await status(email), 'under_review');
  // The session ended, and signing in is refused until IMC decides.
  const after = await f.get(`/applications/${appId}`);
  assert.equal(after.status, 401);
  assert.equal((await login(email)).json.code, 'ACCOUNT_UNDER_REVIEW');
  assert.equal((await f.post('/auth/refresh', {})).status, 401, 'refresh token revoked too');
});

test('ACC-3 IMC acceptance approves the account: branded email with a sign-in button, full access, workflow continues', async () => {
  const { email, appId } = await registeredAndVerified('ok');
  assert.equal((await act(c.imc, appId, 'accept')).status, 200);
  assert.equal(await status(email), 'approved');
  assert.ok((await q<{ a: string | null }>('SELECT f.approvedAt AS a FROM factories f JOIN users u ON u.organizationId = f.organizationId WHERE u.email = ?', email))[0].a);
  const keys = await templatesFor(email);
  assert.ok(keys.includes('account.approved') && !keys.includes('app.imc_accepted'), keys.join(','));
  const mail = [...sentMails].reverse().find((m) => m.to.includes(email) && /تم قبول حساب مصنعكم/.test(m.subject));
  assert.ok(mail);
  assert.match(mail!.html, /تسجيل الدخول/);
  assert.ok(mail!.attachments.some((a) => a.cid === 'platform-logo'));

  const f = await new Client(srv.base).login(email, PASSWORD);
  assert.equal(f.user.accountStatus, 'approved');
  assert.equal((await f.get('/applications')).status, 200);
  assert.equal((await f.get('/notifications')).status, 200);
  assert.equal((await getApp(f, appId)).state, 'ENCPC_REVIEW');
  // Later decisions on an approved account use the usual application emails.
  assert.equal((await act(c.encpc, appId, 'non_compliant', { deficiencies: [{ field: 'roofAreas', note: 'مساحة غير واضحة' }] })).status, 200);
  assert.ok((await templatesFor(email)).includes('app.correction_requested'));
  assert.equal(await status(email), 'approved', 'an approved account stays approved');
  assert.equal((await f.get('/applications')).status, 200);
});

test('ACC-4 IMC rejection rejects the account: branded email with the reason, and sign-in is refused', async () => {
  const { email, appId } = await registeredAndVerified('rej');
  const r = await act(c.imc, appId, 'reject', { reason: 'المستندات لا تخص المنشأة', reasonCode: 'other' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(await status(email), 'rejected');
  const keys = await templatesFor(email);
  assert.ok(keys.includes('account.rejected') && !keys.includes('app.rejected'), keys.join(','));
  const mail = [...sentMails].reverse().find((m) => m.to.includes(email) && /قرار بشأن طلب تسجيل/.test(m.subject));
  assert.match(mail!.html, /المستندات لا تخص المنشأة/);
  const l = await login(email);
  assert.equal(l.status, 403);
  assert.equal(l.json.code, 'ACCOUNT_REJECTED');
});

test('ACC-5 if submitting at activation fails (registry down), the factory signs in restricted and submits again', async () => {
  const { setRegistryClientForTests } = await import('../src/integrations/registry/index.js');
  const email = `acc.down.${++seq}@test.local`;
  assert.equal((await registerFactory(new Client(srv.base), registrationPayload(email, `IND-ACC-DOWN-${seq}`))).status, 201);
  setRegistryClientForTests({ name: 'mock', verify: async () => ({ result: 'unavailable', errorCode: 'TEST_DOWN' }) });
  let v;
  try { v = await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(email) }); } finally { setRegistryClientForTests(null); }
  assert.equal(v.status, 200);
  assert.equal(v.json.data.submitted, false);
  assert.equal(await status(email), 'pending');
  const f = await new Client(srv.base).login(email, PASSWORD);
  assert.equal(f.user.accountStatus, 'pending');
  assert.equal((await f.get('/applications')).status, 403);
  const appId = await appOf(email);
  const s = await act(f, appId, 'submit');
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(await status(email), 'under_review');
  assert.equal((await login(email)).json.code, 'ACCOUNT_UNDER_REVIEW');
});

test('ACC-6 existing and seeded factories are approved and unaffected', async () => {
  assert.deepEqual((await q<{ s: string }>("SELECT DISTINCT f.accountStatus AS s FROM factories f JOIN users u ON u.organizationId = f.organizationId WHERE u.email IN (?, ?)", DEV.factory, DEV.factory2)).map((r) => r.s), ['approved']);
  assert.equal(c.factory.user.accountStatus, 'approved');
  assert.equal((await c.factory.get('/applications')).status, 200);
  const imcUser = (await c.imc.get('/auth/me')).json.data.user;
  assert.equal(imcUser.accountStatus, null, 'not a factory');
});
