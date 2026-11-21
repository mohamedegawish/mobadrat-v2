// Registration page = the whole registration form in one request: POST /auth/register (multipart) carries the account, the four
// form sections (`payload` JSON) and the documents. The account is accepted on the basis of those documents (IMC), so they are
// uploaded with the registration; nothing is created unless the form is complete, every file is a real PDF and the registry
// number checks out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  isolateTestEnv, startServer, Client, q, DEV, pdfVariant, registerFactory, registrationFiles, registrationPayload, type Started,
} from './helpers.js';

const env = isolateTestEnv('regpage');
let srv: Started;

before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await env.cleanup(); });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const storedCount = () => { try { return fs.readdirSync(path.join(env.dir, 'uploads', 'documents')).length; } catch { return 0; } };
const userCount = async (email: string) => (await q('SELECT 1 FROM users WHERE email = ?', email)).length;

test('RP-1 one request creates the pending account, the draft with all the form data, and every document', async () => {
  const email = 'regpage.full@test.local';
  const files = registrationFiles('rp1');
  const r = await registerFactory(new Client(srv.base), registrationPayload(email, 'IND-RP-1', { application: { ...registrationPayload(email, 'IND-RP-1').application, general: { ...registrationPayload(email, 'IND-RP-1').application.general, website: 'www.regpage.test' } } }), files);
  assert.equal(r.status, 201, JSON.stringify(r.json));

  const [f] = await q<{ id: string; accountStatus: string; approvedAt: string | null; organizationId: string }>(
    'SELECT f.id, f.accountStatus, f.approvedAt, f.organizationId FROM factories f JOIN users u ON u.organizationId = f.organizationId WHERE u.email = ?', email);
  assert.equal(f.accountStatus, 'pending');
  assert.equal(f.approvedAt, null);
  const [app] = await q<{ id: string; state: string }>('SELECT id, state FROM applications WHERE factoryId = ?', f.id);
  assert.equal(app.state, 'DRAFT', 'sent to IMC only after the email is verified');
  const data = Object.fromEntries((await q<{ section: string; data: string }>('SELECT section, data FROM application_data WHERE applicationId = ?', app.id)).map((d) => [d.section, JSON.parse(d.data)]));
  assert.equal(data.general.companyName, 'مصنع التسجيل الذاتي');
  assert.equal(data.general.website, 'https://www.regpage.test');
  assert.equal(data.contact.contactEmail, email);
  assert.equal(data.contact.contactTitle, 'مدير المصنع');
  assert.equal(data.company.industrialRegistryNumber, 'IND-RP-1');
  assert.equal(data.engineering.roofAreas.length, 2);

  const docs = await q<{ kind: string; originalName: string; sha256: string; storedName: string; attempt: number; status: string }>(
    'SELECT kind, originalName, sha256, storedName, attempt, status FROM documents WHERE applicationId = ? ORDER BY kind, originalName', app.id);
  assert.equal(docs.length, files.length);
  for (const sent of files) {
    const d = docs.find((x) => x.sha256 === sha(sent.body));
    assert.ok(d, `${sent.name} stored`);
    assert.equal(d!.kind, sent.field);
    assert.equal(d!.attempt, 1);
    assert.equal(d!.status, 'current');
    assert.match(d!.storedName, /^[0-9a-f-]{36}\.pdf$/);
    assert.ok(fs.existsSync(path.join(env.dir, 'uploads', 'documents', d!.storedName)));
  }
  // Not usable before activation.
  assert.equal((await new Client(srv.base).post('/auth/login', { email, password: 'Factory123' })).json.code, 'EMAIL_NOT_VERIFIED');
});

test('RP-2 an incomplete form, a missing document or a non-PDF file creates nothing and keeps no file', async () => {
  const before = storedCount();
  const c = new Client(srv.base);
  const email = 'regpage.bad@test.local';
  // Missing document.
  const noTax = await registerFactory(c, registrationPayload(email, 'IND-RP-2'), registrationFiles('rp2').filter((f) => f.field !== 'taxCardFile'));
  assert.equal(noTax.status, 422);
  assert.equal(noTax.json.code, 'INCOMPLETE_APPLICATION');
  assert.ok(noTax.json.details.some((d: any) => d.field === 'taxCardFile'), JSON.stringify(noTax.json.details));
  // Missing data.
  const p = registrationPayload(email, 'IND-RP-2');
  const { address: _a, ...general } = p.application.general; void _a;
  const noAddress = await registerFactory(c, { ...p, application: { ...p.application, general } });
  assert.equal(noAddress.status, 422);
  assert.ok(noAddress.json.details.some((d: any) => d.field === 'address'));
  // Not a PDF (image renamed .pdf).
  const fake = registrationFiles('rp2').map((f) => (f.field === 'ownershipProofFile' ? { ...f, body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) } : f));
  const notPdf = await registerFactory(c, registrationPayload(email, 'IND-RP-2'), fake);
  assert.equal(notPdf.status, 400);
  assert.equal(notPdf.json.code, 'INVALID_FILE_TYPE');
  assert.ok(notPdf.json.details.some((d: any) => d.field === 'ownershipProofFile'));
  // Unknown file field, too many bills, invalid data with account errors.
  assert.equal((await registerFactory(c, registrationPayload(email, 'IND-RP-2'), [...registrationFiles('rp2'), { field: 'passport', body: pdfVariant('x'), name: 'p.pdf' }])).status, 400);
  const bills = Array.from({ length: 13 }, (_, i) => ({ field: 'electricityBill', body: pdfVariant(`b${i}`), name: `b${i}.pdf` }));
  assert.equal((await registerFactory(c, registrationPayload(email, 'IND-RP-2'), [...registrationFiles('rp2').filter((f) => f.field !== 'electricityBill'), ...bills])).status, 400);
  const invalid = await registerFactory(c, { ...registrationPayload(email, 'IND-RP-2', { password: 'short' }), application: { general: { website: 'abc' }, contact: { contactEmail: 'bad' } } });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.json.details.map((d: any) => d.field).sort(), ['contactEmail', 'password', 'website']);
  assert.equal((await registerFactory(c, { ...registrationPayload(email, 'IND-RP-2'), application: undefined })).status, 400, 'form data is required');

  assert.equal(await userCount(email), 0, 'no account');
  for (let i = 0; i < 20 && storedCount() !== before; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(storedCount(), before, 'no refused file stays in storage');
});

test('RP-3 the industrial registry number is checked before anything is created', async () => {
  const c = new Client(srv.base);
  const before = storedCount();
  const invalid = await registerFactory(c, registrationPayload('regpage.inv@test.local', 'INVALID-77'));
  assert.equal(invalid.status, 422);
  assert.equal(invalid.json.code, 'REGISTRY_INVALID');
  assert.deepEqual(invalid.json.details, [{ field: 'industrialRegistryNumber', issue: 'invalid' }]);
  const down = await registerFactory(c, registrationPayload('regpage.down@test.local', 'DOWN-1'));
  assert.equal(down.status, 503);
  assert.equal(down.json.code, 'REGISTRY_UNAVAILABLE');
  // A number held by another factory's submitted application.
  const held = await q<{ n: string }>("SELECT industrialRegistryNumber AS n FROM applications WHERE state NOT IN ('DRAFT','REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN') AND industrialRegistryNumber IS NOT NULL LIMIT 1");
  if (held.length) {
    const dup = await registerFactory(c, registrationPayload('regpage.dup@test.local', held[0].n));
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, 'REGISTRY_IN_USE');
  }
  for (const e of ['regpage.inv@test.local', 'regpage.down@test.local', 'regpage.dup@test.local']) assert.equal(await userCount(e), 0);
  assert.equal(storedCount(), before);
});

test('RP-4 an existing email gets the same response, and its documents are discarded (nothing written to the existing account)', async () => {
  const c = new Client(srv.base);
  const before = storedCount();
  const docsBefore = (await q<{ n: number }>('SELECT COUNT(*) AS n FROM documents'))[0].n;
  const fresh = await registerFactory(c, registrationPayload('regpage.someone@test.local', 'IND-RP-4A'));
  const freshFiles = storedCount();
  const dup = await registerFactory(c, registrationPayload(DEV.factory, 'IND-RP-4B'));
  assert.equal(dup.status, 201);
  assert.equal(dup.json.message, fresh.json.message, 'no account enumeration');
  assert.equal((await q<{ n: number }>('SELECT COUNT(*) AS n FROM documents'))[0].n, docsBefore + registrationFiles().length, 'only the new account got documents');
  for (let i = 0; i < 20 && storedCount() !== freshFiles; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(storedCount(), freshFiles, 'the duplicate’s files were removed');
  assert.ok(freshFiles > before);
});
