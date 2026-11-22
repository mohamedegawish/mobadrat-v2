// The platform core: one account per person, shared profiles, "what is missing" per initiative, enrolling into a coded
// initiative module with prefill and document reuse, the initiative chooser, and the unified administration.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, isolateTestEnv, newPerson, pdf, sentMails, flushMail, startServer, PASSWORD } from './helpers.js';

const env = isolateTestEnv('platform');
let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await env.cleanup(); });

const ADMIN = 'admin@mobadrat.local';

test('P-1 health lists the modules; the public catalog shows both coded initiatives with their registration page', async () => {
  const h = await (await fetch(`${srv.base}/health`)).json();
  assert.match(h.data.checks.modules, /shams/);
  assert.match(h.data.checks.modules, /sona3/);
  const cat = await (await fetch(`${srv.base}/initiatives`)).json();
  const byId = Object.fromEntries(cat.data.map((i: any) => [i.id, i]));
  assert.equal(byId.shams.hasModule, true);
  assert.equal(byId.shams.subject, 'factory');
  assert.equal(byId.shams.registerView, 'i/shams/register');
  assert.equal(byId.sona3.subject, 'person');
  assert.ok(!('kpis' in byId.shams), 'admin-only fields are not public');
});

test('P-2 one platform account: register → verify → sign in; no initiative yet; module screens refuse a non-member', async () => {
  const c = await newPerson(srv.base, 'person1@test.local');
  const me = await c.get('/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.data.memberships.length, 0);
  const denied = await c.get('/i/sona3/applicant/profile');
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'NOT_ENROLLED');
});

test('P-3 the same e-mail cannot get a second account through an initiative registration (same answer, owner notified)', async () => {
  const r = await new Client(srv.base).post('/i/sona3/public/register', { fullName: 'شخص آخر', email: 'person1@test.local', mobile: '01000000099', password: 'Another123' });
  assert.equal(r.status, 201, 'no enumeration');
  await flushMail();
  assert.ok(sentMails.some((m) => m.to.includes('person1@test.local') && /بريدك مسجل بالفعل|محاولة تسجيل/.test(m.subject + m.html)), 'owner told to sign in and apply');
  // still one account, still no membership
  const c = await new Client(srv.base).login('person1@test.local');
  assert.equal((await c.get('/me')).json.data.memberships.length, 0);
});

test('P-4 shared profile: validated per field; the national ID is locked once saved', async () => {
  const c = await new Client(srv.base).login('person1@test.local');
  const bad = await c.put('/me/profile', { values: { 'person.nationalId': '123', 'person.phone': 'x', 'person.unknown': 1 } });
  assert.equal(bad.status, 400);
  const fields = bad.json.details.map((d: any) => d.field).sort();
  assert.deepEqual(fields, ['person.nationalId', 'person.phone', 'person.unknown']);
  const ok = await c.put('/me/profile', { values: { 'person.nationalId': '30001010112345', 'person.birthDate': '2000-01-01' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const change = await c.put('/me/profile', { values: { 'person.nationalId': '29001010112345' } });
  assert.equal(change.status, 409);
  assert.equal(change.json.code, 'LOCKED_FIELD');
});

test('P-5 Sona3 requirements: only what is missing is listed; completing the profile makes the person ready; enroll prefills the draft', async () => {
  const c = await new Client(srv.base).login('person1@test.local');
  const before = await c.get('/me/initiatives/sona3/requirements');
  assert.equal(before.status, 200);
  const missingBefore = before.json.data.missing.map((m: any) => m.key);
  assert.ok(missingBefore.includes('person.address') && missingBefore.includes('person.qualification'));
  assert.ok(!missingBefore.includes('person.nationalId'), 'already in the profile');
  assert.ok(!missingBefore.includes('person.fullNameAr'), 'taken from the registration');
  assert.ok(before.json.data.missingDocuments.some((d: any) => d.kind === 'nationalIdFile'));
  assert.equal(before.json.data.complete, false);
  const refused = await c.post('/me/initiatives/sona3/enroll', {});
  assert.equal(refused.status, 422);
  assert.equal(refused.json.code, 'REQUIREMENTS_MISSING');

  assert.equal((await c.put('/me/profile', { values: {
    'person.nationality': 'egyptian', 'person.governorate': 'cairo', 'person.address': 'شارع التحرير', 'person.qualification': 'بكالوريوس هندسة', 'person.experience': 'خمس سنوات في التصنيع',
  } })).status, 200);
  const up = await c.upload('/me/profile-documents', { kind: 'nationalIdFile' }, pdf('nid'), 'nid.pdf');
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const ready = await c.get('/me/initiatives/sona3/requirements');
  assert.equal(ready.json.data.missing.length, 0);
  assert.equal(ready.json.data.missingDocuments.length, 0);
  assert.deepEqual(ready.json.data.blockers, []);
  assert.equal(ready.json.data.complete, true);

  const en = await c.post('/me/initiatives/sona3/enroll', {});
  assert.equal(en.status, 201, JSON.stringify(en.json));
  assert.match(en.json.data.view, /^apply\/app-/);
  const app = await c.get(`/i/sona3/applications/${en.json.data.applicationId}`);
  assert.equal(app.status, 200, JSON.stringify(app.json));
  const personal = app.json.data.data?.personal ?? app.json.data.sections?.personal ?? app.json.data.form?.personal;
  assert.ok(personal, 'personal section present');
  assert.equal(personal.nationalId, '30001010112345');
  assert.equal(personal.address, 'شارع التحرير');
  assert.ok((app.json.data.documents ?? []).some((d: any) => d.kind === 'nationalIdFile'), 'the profile document was copied into the application');
  const again = await c.post('/me/initiatives/sona3/enroll', {});
  assert.equal(again.status, 200);
  assert.equal(again.json.data.alreadyEnrolled, true);
});

test('P-6 Shams (factory subject): needs a factory profile; the factory data and company documents are reused; the file opens restricted', async () => {
  const c = await new Client(srv.base).login('person1@test.local');
  const r1 = await c.get('/me/initiatives/shams/requirements');
  assert.equal(r1.json.data.needsFactory, true);
  const f = await c.post('/me/factories', { values: {
    'factory.companyName': 'مصنع الاختبار الموحد', 'factory.governorate': 'sharqia', 'factory.industrialZone': 'other', 'factory.address': 'المنطقة الثالثة',
    'factory.phone1': '0221234567', 'factory.contactName': 'م. أحمد', 'factory.contactTitle': 'مدير', 'factory.contactMobile': '01012345678',
    'factory.contactEmail': 'contact@f.test', 'factory.commercialRegisterNumber': 'CR-9', 'factory.industrialRegistryNumber': 'IND-PLAT-1',
    'factory.taxNumber': 'TX-1', 'factory.roofAreas': [{ name: 'السطح', area: 900 }], 'factory.contractedCapacity': 500, 'factory.capacityUnit': 'kW',
    'factory.peakLoad': 400, 'factory.loadUnit': 'kW', 'factory.ownershipType': 'owned', 'factory.ownershipExpiresAt': '2045-01-01',
  } });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  const fid = f.json.data.id;
  for (const kind of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'ownershipProofFile']) {
    assert.equal((await c.upload('/me/profile-documents', { kind, ownerId: fid }, pdf(kind))).status, 201);
  }
  const r2 = await c.get(`/me/initiatives/shams/requirements?factoryId=${fid}`);
  assert.equal(r2.json.data.complete, true, JSON.stringify(r2.json.data.missing));
  const en = await c.post('/me/initiatives/shams/enroll', { factoryId: fid });
  assert.equal(en.status, 201, JSON.stringify(en.json));
  const appId = en.json.data.applicationId;
  const app = await c.get(`/i/shams/applications/${appId}`);
  assert.equal(app.status, 200, JSON.stringify(app.json));
  assert.equal(app.json.data.state, 'DRAFT');
  assert.equal(app.json.data.documents.filter((d: any) => d.isCurrent).length, 4, 'company documents copied');
  // restricted until submitted and accepted: only the registration application
  assert.equal((await c.get('/i/shams/applications')).json.code, 'ACCOUNT_RESTRICTED');
});

test('P-7 the chooser: a person in two initiatives gets both cards with their state and next step', async () => {
  const c = await new Client(srv.base).login('person1@test.local');
  const me = (await c.get('/me')).json.data;
  const ids = me.memberships.map((m: any) => m.initiativeId).sort();
  assert.deepEqual(ids, ['shams', 'sona3']);
  const shams = me.memberships.find((m: any) => m.initiativeId === 'shams');
  assert.equal(shams.access.status, 'restricted');
  assert.match(shams.card.view, /^apply\//);
  const sona3 = me.memberships.find((m: any) => m.initiativeId === 'sona3');
  assert.equal(sona3.role, 'applicant');
  assert.ok(sona3.card.statusAr);
});

test('P-8 unified administration: stats of every initiative, accounts with memberships, platform admin enters a module as its administrator', async () => {
  const a = await new Client(srv.base).login(ADMIN);
  const s = await a.get('/admin/stats');
  assert.equal(s.status, 200);
  assert.deepEqual(s.json.data.initiatives.map((i: any) => i.initiativeId), ['shams', 'sona3']);
  assert.ok(s.json.data.totals.applications >= 2);
  assert.ok(s.json.data.platform.multiInitiativeAccounts >= 1);
  const users = await a.get('/admin/users?q=person1');
  assert.equal(users.json.data.items[0].memberships.length, 2);
  const asAdmin = await a.get('/i/shams/auth/me');
  assert.equal(asAdmin.json.data.user.role, 'system_admin');
  assert.equal((await a.get('/i/sona3/auth/me')).json.data.user.role, 'system_admin');
  // a citizen has no access to the platform administration
  const c = await new Client(srv.base).login('person1@test.local');
  assert.equal((await c.get('/admin/stats')).status, 403);
  // the ministry viewer reads statistics but cannot manage accounts
  const v = await new Client(srv.base).login('ministry@mobadrat.local');
  assert.equal((await v.get('/admin/stats')).status, 200);
  assert.equal((await v.post('/admin/users', { email: 'x@y.z', nameAr: 'x', platformRole: 'auditor' })).status, 403);
});

test('P-9 audit log carries the initiative of each event; unified inbox prefixes module links', async () => {
  const a = await new Client(srv.base).login(ADMIN);
  const shamsAudit = await a.get('/admin/audit-logs?initiativeId=shams');
  assert.ok(shamsAudit.json.data.items.every((r: any) => r.initiativeId === 'shams'));
  assert.ok(shamsAudit.json.data.items.some((r: any) => r.action === 'platform.enroll'));
  const c = await new Client(srv.base).login('person1@test.local');
  const inbox = await c.get('/me/notifications');
  assert.equal(inbox.status, 200);
  for (const n of inbox.json.data.items) if (n.initiativeId) assert.match(n.link, new RegExp(`^i/${n.initiativeId}`));
});

test('P-10 password reset is the platform\'s, for every initiative', async () => {
  const c = new Client(srv.base);
  assert.equal((await c.post('/auth/forgot-password', { email: 'person1@test.local' })).status, 200);
  assert.equal((await c.post('/auth/login', { email: 'person1@test.local', password: PASSWORD })).status, 200);
});
