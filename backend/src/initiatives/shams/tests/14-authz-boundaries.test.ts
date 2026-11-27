// حدود الصلاحيات الحرجة (مراجعة الأمان M7/M8 + IDOR/BOLA): نسخ الملفات التي لم تُرسل، حد بيانات الأدمن،
// عزل المصانع والبنوك في القراءة والتنزيل والإجراءات، تمرير حقول غير مسموحة، وتزامن اختيار مقدم الخدمة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_INFO, isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, pdfVariant, q, uploadContractFile, BANK_A, BANK_B, type Started } from './helpers.js';

const env = isolateTestEnv('boundaries');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-BND-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}

test('M7: a document version replaced before submission is never shown to reviewers (list or download), but the factory keeps it', async () => {
  await closeOpen();
  const id = await createCompleteDraft(c.factory, reg());
  const before = (await getApp(c.factory, id)).documents.filter((d: any) => d.kind === 'taxCardFile');
  assert.equal(before.length, 1);
  const v1 = before[0];
  const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('tax-v2'), 'tax-v2.pdf');
  assert.equal(up.status, 201);
  const own = (await getApp(c.factory, id)).documents.filter((d: any) => d.kind === 'taxCardFile');
  assert.equal(own.length, 2, 'the factory sees both versions');
  assert.equal(own.find((d: any) => d.id === v1.id).submitted, false, 'the replaced version is flagged as never submitted');
  assert.equal((await act(c.factory, id, 'submit')).status, 200);

  for (const [role, client] of [['imc', c.imc], ['pmu', c.pmu]] as const) {
    const view = await getApp(client, id);
    const tax = view.documents.filter((d: any) => d.kind === 'taxCardFile');
    assert.equal(tax.length, 1, `${role} sees only the submitted version`);
    assert.notEqual(tax[0].id, v1.id);
    assert.equal((await client.get(`/applications/${id}/documents/${v1.id}/download`)).status, 404, `${role} cannot download the replaced version`);
    assert.equal((await client.get(`/applications/${id}/documents/${tax[0].id}/download`)).status, 200);
  }
  assert.equal((await c.factory.get(`/applications/${id}/documents/${v1.id}/download`)).status, 200, 'the owner still can');
});

test('M8: the admin view carries no deficiency notes, no electricity data and no provider contact details', async () => {
  await closeOpen();
  // ملاحظات النواقص
  const a = await advanceTo('IMC_REVIEW', c, reg());
  assert.equal((await act(c.imc, a, 'request_correction', { deficiencies: [{ field: 'address', note: 'ملاحظة سرية للمراجع' }] })).status, 200);
  const adminA = await getApp(c.admin, a);
  assert.equal(adminA.metadataOnly, true);
  assert.ok(!JSON.stringify(adminA).includes('ملاحظة سرية للمراجع'), 'deficiency note is not exposed to the admin');
  assert.equal(adminA.deficiencies.every((d: any) => d.note === ''), true);
  assert.ok(JSON.stringify((await getApp(c.pmu, a))).includes('ملاحظة سرية للمراجع'), 'control: PMU does see it');
  await act(c.factory, a, 'withdraw', { reason: 'إنهاء' });

  // الكهرباء ومقدم الخدمة
  const b = await advanceTo('ELECTRICITY_REVIEW', c, reg());
  const pmuView = await getApp(c.pmu, b);
  assert.ok(pmuView.providerInfo.email && pmuView.providerInfo.phone, 'control: PMU sees provider contacts');
  const adminB = await getApp(c.admin, b);
  assert.equal(adminB.data.electricity, undefined, 'no electricity data for the admin');
  assert.equal(adminB.providerInfo.name, pmuView.providerInfo.name, 'provider name stays visible');
  assert.deepEqual([adminB.providerInfo.email, adminB.providerInfo.phone], ['', ''], 'no provider contacts for the admin');
  assert.ok(adminB.documents.every((d: any) => d.downloadable === false));
});

test('IDOR: another factory cannot read, download, edit, act on or upload to a factory application', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  const doc = (await getApp(c.factory, id)).documents[0];
  assert.equal((await c.factory2.get(`/applications/${id}`)).status, 404);
  assert.equal((await c.factory2.get(`/applications/${id}/documents/${doc.id}/download`)).status, 404);
  assert.equal((await c.factory2.put(`/applications/${id}/data/general`, { address: 'x' })).status, 404);
  assert.equal((await c.factory2.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('evil'))).status, 404);
  assert.equal((await c.factory2.del(`/applications/${id}/documents/${doc.id}`)).status, 404);
  const v = (await getApp(c.pmu, id)).version;
  for (const action of ['withdraw', 'submit', 'accept', 'submit_offer']) {
    const r = await c.factory2.post(`/applications/${id}/actions/${action}`, { expectedVersion: v, reason: 'x', ...PROVIDER_INFO });
    assert.ok([403, 404].includes(r.status), `${action} -> ${r.status}`);
  }
  assert.ok(!(await c.factory2.get('/applications')).json.data.items.some((a: any) => a.id === id), 'not in the other factory list');
  assert.equal((await getApp(c.pmu, id)).state, 'IMC_REVIEW', 'nothing changed');
});

test('BOLA (G-01/G-03): bank choice, contract evidence and outcome belong to the owning factory only; extra fields are rejected; concurrent requests produce one result', async () => {
  await closeOpen();
  const id = await advanceTo('BANK_SELECTION', c, reg());
  let v = (await getApp(c.factory, id)).version;
  // another factory: cannot choose the bank, upload evidence or record an outcome
  assert.equal((await c.factory2.post(`/applications/${id}/actions/select_bank`, { expectedVersion: v, bankOrgId: BANK_A })).status, 404);
  assert.equal((await c.factory2.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, pdfVariant('x'), 'x.pdf')).status, 404);
  // no evidence upload before the bank is chosen
  assert.ok((await c.factory.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, pdfVariant('early'), 'e.pdf')).status >= 400, 'evidence only after the bank choice');
  // mass assignment: the selection takes only bankOrgId
  assert.equal((await c.factory.post(`/applications/${id}/actions/select_bank`, { expectedVersion: v, bankOrgId: BANK_A, state: 'CONTRACTED' })).status, 400);
  // two concurrent selections with the same version → exactly one
  const sel = await Promise.all([BANK_A, BANK_B].map((bankOrgId) => c.factory.post(`/applications/${id}/actions/select_bank`, { expectedVersion: v, bankOrgId })));
  assert.deepEqual(sel.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await q("SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND action = 'select_bank'", id)).length, 1);
  const winner = (await getApp(c.factory, id)).bank.id;
  assert.equal((await q<any>('SELECT bankOrgId FROM shams_bank_referrals WHERE applicationId = ?', id))[0].bankOrgId, winner, 'stored choice = the visible one');

  await uploadContractFile(c.factory, id, 'ev');
  v = (await getApp(c.factory, id)).version;
  assert.equal((await c.factory2.post(`/applications/${id}/actions/record_contract`, { expectedVersion: v, contractDate: '2026-10-05', contractAmount: 10 })).status, 404);
  for (const client of [c.imc, c.encpc, c.pmu, c.admin]) {
    const r = await client.post(`/applications/${id}/actions/record_contract`, { expectedVersion: v, contractDate: '2026-10-05', contractAmount: 10 });
    assert.ok([403, 404].includes(r.status), `reviewer record_contract -> ${r.status}`);
  }
  for (const extra of [{ contractStatus: 'contracted' }, { bankOrgId: BANK_B }, { closedAt: '2026-01-01' }]) {
    const r = await c.factory.post(`/applications/${id}/actions/record_contract`, { expectedVersion: v, contractDate: '2026-10-05', contractAmount: 10, ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
  // double submission of the outcome → exactly one
  const body = { expectedVersion: v, contractDate: '2026-10-05', contractAmount: 10 };
  const rs = await Promise.all([c.factory.post(`/applications/${id}/actions/record_contract`, body), c.factory.post(`/applications/${id}/actions/record_no_contract`, { expectedVersion: v, reason: 'سباق' })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const after = await getApp(c.factory, id);
  assert.ok(['CONTRACTED', 'CLOSED_NOT_CONTRACTED'].includes(after.state));
  assert.equal((await q("SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND toState IN ('CONTRACTED','CLOSED_NOT_CONTRACTED')", id)).length, 1, 'one final result');
  // closed: the result and the evidence cannot be changed
  assert.equal((await act(c.factory, id, after.state === 'CONTRACTED' ? 'record_no_contract' : 'record_contract', { reason: 'تغيير', contractDate: '2026-10-06', contractAmount: 5 })).status, 409);
  assert.ok((await c.factory.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, pdfVariant('late'), 'late.pdf')).status >= 400, 'no new evidence after closure');
  const contractDoc = after.documents.find((d: any) => d.kind === 'contractFile');
  if (contractDoc) assert.ok((await c.factory.del(`/applications/${id}/documents/${contractDoc.id}`)).status >= 400, 'evidence cannot be deleted after closure');
});

test('role escalation / mass assignment: unknown or privileged fields are rejected and change nothing', async () => {
  await closeOpen();
  const id = await createCompleteDraft(c.factory, reg());
  for (const body of [{ state: 'IMC_REVIEW' }, { companyName: 'ok', version: 99 }, { companyName: 'ok', isAdmin: true }, { factoryId: 'fac-other' }]) {
    const r = await c.factory.put(`/applications/${id}/data/general`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await c.factory.put(`/applications/${id}/data/provider`, PROVIDER_INFO)).status === 200, false, 'the provider section cannot be written directly');
  assert.equal((await c.factory.put(`/applications/${id}/data/electricity`, { bankOrgId: BANK_A })).status === 200, false, 'nor the electricity section');
  assert.equal((await getApp(c.factory, id)).state, 'DRAFT');
  // الأدوار الأخرى لا تكتب بيانات الطلب
  for (const client of [c.imc, c.encpc, c.pmu, c.admin]) {
    const r = await client.put(`/applications/${id}/data/general`, { address: 'تعديل غير مصرح' });
    assert.ok([403, 404].includes(r.status), `-> ${r.status}`);
  }
  // لا أحد يغير حالة الطلب بإجراء غير موجود في الجدول
  const bogus = await c.factory.post(`/applications/${id}/actions/set_state`, { expectedVersion: 1, state: 'CONTRACTED' });
  assert.ok([400, 404].includes(bogus.status));
  assert.equal((await getApp(c.factory, id)).state, 'DRAFT');
});

test('offer submission: only the owner, with the provider named, and two concurrent submissions produce exactly one transition', async () => {
  await closeOpen();
  const id = await advanceTo('OFFER_UPLOAD', c, reg());
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('o-b'), 'o.pdf')).status, 201);
  const v = (await getApp(c.factory, id)).version;
  const other = await c.factory2.post(`/applications/${id}/actions/submit_offer`, { expectedVersion: v, ...PROVIDER_INFO });
  assert.ok([403, 404].includes(other.status), `other factory -> ${other.status}`);
  for (const client of [c.imc, c.pmu, c.admin, c.electricity]) {
    const r = await client.post(`/applications/${id}/actions/submit_offer`, { expectedVersion: v, ...PROVIDER_INFO });
    assert.ok([403, 404, 409].includes(r.status), `reviewer -> ${r.status}`);
  }
  const bad = await c.factory.post(`/applications/${id}/actions/submit_offer`, { expectedVersion: v, providerName: 'x', providerEmail: 'not-an-email' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.details.map((d: any) => d.field).sort(), ['providerEmail', 'providerName']);
  const body = { expectedVersion: v, ...PROVIDER_INFO };
  const results = await Promise.all([c.factory.post(`/applications/${id}/actions/submit_offer`, body), c.factory.post(`/applications/${id}/actions/submit_offer`, body)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.json?.code)));
  assert.equal((await q("SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND action = 'submit_offer'", id)).length, 1, 'one transition, one timestamp');
  assert.equal((await getApp(c.factory, id)).providerInfo.name, PROVIDER_INFO.providerName);
});

test('system admin: no decision on an application, no registry power, and cannot approve account or recovery requests', async () => {
  await closeOpen();
  const id = await advanceTo('OFFER_REVIEW', c, reg());
  const v = (await getApp(c.pmu, id)).version;
  for (const action of ['accept', 'request_correction', 'reject', 'compliant', 'select_bank', 'record_contract', 'record_result', 'reassign_bank', 'withdraw']) {
    const r = await c.admin.post(`/applications/${id}/actions/${action}`, { expectedVersion: v, reason: 'محاولة', deficiencies: [{ field: 'address', note: 'x' }] });
    assert.ok([403, 404].includes(r.status), `${action} -> ${r.status}`);
  }
  assert.equal((await getApp(c.pmu, id)).state, 'OFFER_REVIEW');
  assert.equal((await c.admin.get('/registry-blocks')).status, 403);
  assert.equal((await c.admin.post('/account-requests/acr-none/approve', {})).status, 403);
  assert.equal((await c.admin.post('/recovery-requests/rec-none/approve', {})).status, 403);
  assert.equal((await c.admin.get('/integration-keys/pending')).status, 403);
  assert.equal((await q("SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND actorRole = 'system_admin'", id)).length, 0);
});

test('unauthenticated and malformed tokens get 401 on every protected resource', async () => {
  const { Client } = await import('./helpers.js');
  const anon = new Client(srv.base);
  for (const p of ['/applications', '/reports/summary', '/admin/users', '/account-requests', '/recovery-requests', '/registry-blocks']) {
    assert.equal((await anon.get(p)).status, 401, p);
  }
  anon.token = 'not.a.jwt';
  assert.equal((await anon.get('/applications')).status, 401);
});
