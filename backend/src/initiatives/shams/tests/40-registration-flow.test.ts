// Factory registration form (details/Registration Form V01.xlsx) end to end, through the real HTTP API, database and file store:
// all fields, optional fields left empty, every document, unsupported and oversized files, saving a draft and resuming it,
// isolation between factories, refusal of invalid data, removal / replacement of documents, and the hand-off to IMC review.
// 29-registration-form checks the mapping of each workbook line; this file checks the behaviour of filling the form.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isolateTestEnv, startServer, clients, act, getApp, q, completeSections, pdfVariant, FORM_DOCS, Client, DEV, type Started } from './helpers.js';

const env = isolateTestEnv('regflow');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { delete process.env.MAX_FILE_SIZE_MB; await srv.close(); await env.cleanup(); });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let regSeq = 0;
const regNo = () => `IND-RF-${process.pid % 1000}-${++regSeq}`;

/** Withdraws the factory's open application (one open application per factory) so each test starts a fresh draft. */
async function freshDraft(factory: Client = c.factory): Promise<string> {
  const open = (await factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) assert.equal((await act(factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' })).status, 200);
  const r = await factory.post('/applications', {});
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data.id as string;
}

async function saveAll(id: string, sections: Record<string, Record<string, unknown>>, factory: Client = c.factory) {
  for (const [section, data] of Object.entries(sections)) {
    const r = await factory.put(`/applications/${id}/data/${section}`, data);
    assert.equal(r.status, 200, `${section}: ${JSON.stringify(r.json)}`);
  }
}

/** Uploads every document of the form; returns the bytes sent per document id. */
async function uploadAll(id: string, bills = 2, factory: Client = c.factory): Promise<Map<string, Buffer>> {
  const sent = new Map<string, Buffer>();
  for (const kind of FORM_DOCS) {
    const body = pdfVariant(`${id}-${kind}`);
    const r = await factory.upload(`/applications/${id}/documents`, { kind }, body, `${kind}.pdf`);
    assert.equal(r.status, 201, `${kind}: ${JSON.stringify(r.json)}`);
    sent.set(r.json.data.id, body);
  }
  for (let i = 1; i <= bills; i++) {
    const body = pdfVariant(`${id}-bill-${i}`);
    const r = await factory.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, body, `فاتورة-${i}.pdf`);
    assert.equal(r.status, 201, JSON.stringify(r.json));
    sent.set(r.json.data.id, body);
  }
  return sent;
}

const ALL_FIELDS = () => {
  const s = completeSections(regNo());
  return {
    general: { ...s.general, phone2: '0229876543', fax: '0221112222', website: 'www.factory-example.com' },
    contact: { ...s.contact, contactPhone: '0223334444', contactFax: '0225556666' },
    company: s.company,
    engineering: s.engineering,
  };
};

test('RF-1 registration with every field of the form: data and files are stored as entered, and submission moves to IMC review', async () => {
  const id = await freshDraft();
  const data = ALL_FIELDS();
  await saveAll(id, data);
  const sent = await uploadAll(id, 12);

  const draft = await getApp(c.factory, id);
  assert.equal(draft.state, 'DRAFT');
  assert.equal(draft.data.general.website, 'https://www.factory-example.com', 'website stored with its scheme');
  for (const [section, fields] of Object.entries(data)) {
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'website') continue;
      assert.deepEqual(draft.data[section][k], v, `${section}.${k}`);
    }
  }
  assert.equal(draft.documents.filter((d: any) => d.kind === 'electricityBill' && d.isCurrent).length, 12, 'twelve monthly bills');

  // Files: each download returns the exact bytes uploaded, and the stored copy is a UUID name outside any public folder.
  for (const [docId, body] of sent) {
    const dl = await c.factory.get(`/applications/${id}/documents/${docId}/download`);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'application/pdf');
    assert.equal(dl.headers.get('cache-control'), 'private, no-store');
    assert.equal(sha(dl.raw!), sha(body), `bytes of ${docId}`);
    const [row] = await q<{ storedName: string; sha256: string; uploadedBy: string }>('SELECT storedName, sha256, uploadedBy FROM documents WHERE id = ?', docId);
    assert.match(row.storedName, /^[0-9a-f-]{36}\.pdf$/);
    assert.equal(row.sha256, sha(body));
    assert.equal(row.uploadedBy, c.factory.user.id);
    assert.ok(fs.existsSync(path.join(env.dir, 'uploads', 'documents', row.storedName)));
    const direct = await fetch(`${srv.origin}/uploads/documents/${row.storedName}`);
    assert.notEqual(direct.headers.get('content-type'), 'application/pdf', 'stored files are never served directly');
  }

  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const app = r.json.data;
  assert.equal(app.state, 'IMC_REVIEW', 'submission goes to the existing IMC review stage');
  assert.ok(app.number, 'an application number is assigned');
  const [tr] = await q<{ fromState: string; toState: string; action: string; attempt: number }>(
    "SELECT fromState, toState, action, attempt FROM application_transitions WHERE applicationId = ? AND action = 'submit'", id);
  assert.deepEqual({ ...tr }, { fromState: 'DRAFT', toState: 'IMC_REVIEW', action: 'submit', attempt: 1 });
  const audit = (await q<{ action: string }>('SELECT action FROM audit_logs WHERE applicationId = ? ORDER BY at', id)).map((x) => x.action);
  assert.ok(audit.includes('application.create') && audit.includes('document.upload'), audit.join(','));
  // The submitted data is frozen as attempt 1: further edits are refused (only the IMC workflow can reopen it).
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { address: 'تعديل بعد الإرسال' })).status, 409);
  // IMC sees exactly what the factory submitted.
  const imcView = await getApp(c.imc, id);
  assert.equal(imcView.data.general.phone2, '0229876543');
  assert.equal(imcView.documents.length, sent.size);
});

test('RF-2 optional fields of the form (phone 2, fax, website, contact phone / fax) can stay empty', async () => {
  const id = await freshDraft();
  const s = completeSections(regNo());
  await saveAll(id, s);
  await uploadAll(id, 1);
  const before = await getApp(c.factory, id);
  for (const k of ['phone2', 'fax', 'website']) assert.equal(before.data.general[k], undefined, k);
  for (const k of ['contactPhone', 'contactFax']) assert.equal(before.data.contact[k], undefined, k);
  // Clearing an optional field that had a value is a save, not an error.
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { phone2: '0229876543' })).status, 200);
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { phone2: '' })).status, 200);
  assert.equal((await getApp(c.factory, id)).data.general.phone2, undefined);
  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.state, 'IMC_REVIEW');
});

test('RF-3 unsupported and oversized files are refused with an Arabic message, leave no file behind and add no document', async () => {
  const id = await freshDraft();
  const count = async () => (await q<{ n: number }>('SELECT COUNT(*) AS n FROM documents WHERE applicationId = ?', id))[0].n;
  const tmp = () => { try { return fs.readdirSync(path.join(env.dir, 'uploads', 'tmp')).length; } catch { return 0; } };
  const stored = () => fs.readdirSync(path.join(env.dir, 'uploads', 'documents')).length;
  const storedBefore = stored();
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const cases: Array<[string, Buffer, string, string]> = [
    ['image', PNG, 'photo.png', 'image/png'],
    ['image renamed .pdf', PNG, 'photo.pdf', 'application/pdf'],
    ['word document', Buffer.from('PK\u0003\u0004 docx'), 'register.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['executable', Buffer.from('MZ\u0090\u0000'), 'setup.exe', 'application/octet-stream'],
    ['pdf with wrong extension', pdfVariant('x'), 'register.txt', 'text/plain'],
  ];
  for (const [what, body, name, mime] of cases) {
    const r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'commercialRegisterFile' }, body, name, mime);
    assert.equal(r.status, 400, `${what}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, 'INVALID_FILE_TYPE', what);
    assert.match(r.json.messageAr, /PDF/, what);
  }
  const empty = await c.factory.upload(`/applications/${id}/documents`, { kind: 'commercialRegisterFile' }, null);
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, 'FILE_REQUIRED');
  const unknownKind = await c.factory.upload(`/applications/${id}/documents`, { kind: 'passportFile' }, pdfVariant('k'));
  assert.equal(unknownKind.status, 400);
  assert.equal(unknownKind.json.code, 'VALIDATION_ERROR');

  process.env.MAX_FILE_SIZE_MB = '0.01';
  try {
    const big = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, Buffer.concat([pdfVariant('big'), Buffer.alloc(20 * 1024, 0x20)]), 'big.pdf');
    assert.equal(big.status, 413, JSON.stringify(big.json));
    assert.equal(big.json.code, 'FILE_TOO_LARGE');
    assert.match(big.json.messageAr, /ميجابايت/);
  } finally { delete process.env.MAX_FILE_SIZE_MB; }

  assert.equal(await count(), 0, 'no document row for a refused file');
  assert.equal(stored(), storedBefore, 'no refused file reached the document store');
  for (let i = 0; i < 20 && tmp() > 0; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(tmp(), 0, 'temporary upload parts are removed');
});

test('RF-4 draft: a partial form is kept, a later session resumes it, and saving one field never erases the others', async () => {
  const id = await freshDraft();
  // The draft starts pre-filled from the factory profile and the owner account (editable).
  const fresh = await getApp(c.factory, id);
  assert.equal(fresh.state, 'DRAFT');
  assert.ok(fresh.data.general.companyName);
  assert.equal(fresh.data.contact.contactEmail, DEV.factory);

  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { address: 'العنوان الجزئي', governorate: 'sharqia' })).status, 200);
  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { phone1: '0221234567' })).status, 200);
  const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('draft-tax'), 'tax.pdf');
  assert.equal(up.status, 201);

  // Incomplete: submission is refused, names what is missing, and the draft stays a draft with everything saved.
  const sub = await act(c.factory, id, 'submit');
  assert.equal(sub.status, 422);
  assert.equal(sub.json.code, 'INCOMPLETE_APPLICATION');
  const missing = sub.json.details.map((d: any) => d.field);
  for (const f of ['industrialZone', 'contactTitle', 'industrialRegistryNumber', 'commercialRegisterFile', 'electricityBills', 'roofAreas']) assert.ok(missing.includes(f), `missing ${f}: ${missing}`);
  assert.ok(!missing.includes('taxCardFile') && !missing.includes('address'));

  // A new login (another device / another day) finds the same draft with the same data and files.
  const later = await new Client(srv.base).login(DEV.factory);
  const profile = (await later.get('/factory/profile')).json.data;
  assert.equal(profile.openApplicationId, id);
  const resumed = await getApp(later, id);
  assert.equal(resumed.state, 'DRAFT');
  assert.equal(resumed.data.general.address, 'العنوان الجزئي');
  assert.equal(resumed.data.general.phone1, '0221234567');
  assert.equal(resumed.data.general.governorate, 'sharqia');
  assert.deepEqual(resumed.documents.filter((d: any) => d.isCurrent).map((d: any) => d.originalName), ['tax.pdf']);

  // Finish from the new session and submit.
  const s = completeSections(regNo());
  await saveAll(id, s, later);
  for (const kind of FORM_DOCS) if (kind !== 'taxCardFile') assert.equal((await later.upload(`/applications/${id}/documents`, { kind }, pdfVariant(`r-${kind}`))).status, 201);
  assert.equal((await later.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, pdfVariant('r-bill'))).status, 201);
  const ok = await act(later, id, 'submit');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.state, 'IMC_REVIEW');
});

test('RF-5 another factory cannot read, edit, upload to, download from or delete documents of this factory', async () => {
  const id = await freshDraft();
  await saveAll(id, completeSections(regNo()));
  const sent = await uploadAll(id, 1);
  const docId = [...sent.keys()][0];
  const other = c.factory2;
  assert.equal((await other.get(`/applications/${id}`)).status, 404);
  assert.equal((await other.put(`/applications/${id}/data/general`, { address: 'اختراق' })).status, 404);
  assert.equal((await other.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('intruder'))).status, 404);
  const dl = await other.get(`/applications/${id}/documents/${docId}/download`);
  assert.equal(dl.status, 404);
  assert.equal(dl.raw, undefined, 'no file bytes');
  assert.equal((await other.del(`/applications/${id}/documents/${docId}`)).status, 404);
  assert.equal((await other.post(`/applications/${id}/actions/submit`, { expectedVersion: 1 })).status, 404);
  const list = (await other.get('/applications')).json.data.items.map((a: any) => a.id);
  assert.ok(!list.includes(id), 'not in the other factory’s list');
  // Nothing changed for the owner.
  const mine = await getApp(c.factory, id);
  assert.notEqual(mine.data.general.address, 'اختراق');
  assert.equal(mine.documents.filter((d: any) => d.isCurrent).length, sent.size);
  // Reviewers cannot write to the factory's form either.
  assert.ok((await c.imc.put(`/applications/${id}/data/general`, { address: 'x' })).status >= 403);
  // A guessed document id of another application is not reachable through this application.
  const otherId = await freshDraft(other);
  const otherDoc = (await other.upload(`/applications/${otherId}/documents`, { kind: 'taxCardFile' }, pdfVariant('o'))).json.data.id;
  assert.equal((await c.factory.get(`/applications/${id}/documents/${otherDoc}/download`)).status, 404);
  assert.equal((await c.factory.del(`/applications/${id}/documents/${otherDoc}`)).status, 404);
});

test('RF-6 invalid data is refused field by field (400 VALIDATION_ERROR, Arabic-mappable issue codes) and never overwrites saved values', async () => {
  const id = await freshDraft();
  await saveAll(id, completeSections(regNo()));
  const bad: Array<[string, Record<string, unknown>, string, RegExp]> = [
    ['contact', { contactEmail: 'not-an-email' }, 'contactEmail', /invalid email/],
    ['contact', { contactEmail: 'a@b' }, 'contactEmail', /invalid email/],
    ['contact', { contactMobile: 'abc' }, 'contactMobile', /invalid phone/],
    ['contact', { contactMobile: '12' }, 'contactMobile', /invalid phone/],
    ['general', { phone1: '02-12x' }, 'phone1', /invalid phone/],
    ['general', { website: 'javascript:alert(1)' }, 'website', /invalid URL/],
    ['general', { website: 'abc' }, 'website', /invalid URL/],
    ['general', { governorate: 'atlantis' }, 'governorate', /unknown governorate/],
    ['general', { industrialZone: 'not-a-zone' }, 'industrialZone', /zone/],
    ['general', { companyName: 'x'.repeat(201) }, 'companyName', /max length/],
    ['engineering', { contractedCapacity: -5 }, 'contractedCapacity', /positive/],
    ['engineering', { peakLoad: 'كثير' }, 'peakLoad', /positive/],
    ['engineering', { capacityUnit: 'HP' }, 'capacityUnit', /unknown unit/],
    ['engineering', { ownershipExpiresAt: '2040-02-30' }, 'ownershipExpiresAt', /date/],
    ['engineering', { roofAreas: [{ name: '', area: 0 }] }, 'roofAreas[0].name', /required/],
    ['company', { industrialRegistryNumber: '<script>' }, 'industrialRegistryNumber', /invalid format/],
    ['company', { isApproved: true }, 'isApproved', /unknown field/],
  ];
  const saved = await getApp(c.factory, id);
  for (const [section, patch, field, issue] of bad) {
    const r = await c.factory.put(`/applications/${id}/data/${section}`, patch);
    assert.equal(r.status, 400, `${JSON.stringify(patch)} → ${r.status}`);
    assert.equal(r.json.code, 'VALIDATION_ERROR');
    const d = r.json.details.find((x: any) => x.field === field);
    assert.ok(d, `${JSON.stringify(patch)}: ${JSON.stringify(r.json.details)}`);
    assert.match(d.issue, issue);
    assert.ok(r.json.messageAr, 'Arabic message');
  }
  const after = await getApp(c.factory, id);
  assert.deepEqual(after.data, saved.data, 'refused patches change nothing');
  // Arabic-Indic digits are normalised; a website without scheme gets https://.
  assert.equal((await c.factory.put(`/applications/${id}/data/contact`, { contactMobile: '٠١٠١٢٣٤٥٦٧٨' })).status, 200);
  assert.equal((await getApp(c.factory, id)).data.contact.contactMobile, '01012345678');
  // A past tenure expiry date is refused at submission (the right of use must cover financing and operation).
  await uploadAll(id, 1);
  assert.equal((await c.factory.put(`/applications/${id}/data/engineering`, { ownershipExpiresAt: '2020-01-01' })).status, 200);
  const sub = await act(c.factory, id, 'submit');
  assert.equal(sub.status, 422);
  assert.ok(sub.json.details.some((d: any) => d.field === 'ownershipExpiresAt' && /future/.test(d.issue)), JSON.stringify(sub.json.details));
  assert.equal((await getApp(c.factory, id)).state, 'DRAFT');
});

test('RF-7 draft documents can be replaced and removed; a removed file blocks submission until uploaded again and is never shown to IMC', async () => {
  const id = await freshDraft();
  await saveAll(id, completeSections(regNo()));
  await uploadAll(id, 2);
  const docs = async () => (await getApp(c.factory, id)).documents as any[];
  const current = async (kind: string) => (await docs()).filter((d) => d.kind === kind && d.isCurrent);

  // Replace: a new version supersedes the old one (kept in history).
  const v1 = (await current('commercialRegisterFile'))[0];
  const v2 = (await c.factory.upload(`/applications/${id}/documents`, { kind: 'commercialRegisterFile' }, pdfVariant('cr-v2'), 'cr-v2.pdf')).json.data;
  assert.equal(v2.version, 2);
  assert.deepEqual((await current('commercialRegisterFile')).map((d) => d.id), [v2.id]);
  assert.ok((await docs()).some((d) => d.id === v1.id && !d.isCurrent));

  // Remove a single document (not only electricity bills).
  const tax = (await current('taxCardFile'))[0];
  const rm = await c.factory.del(`/applications/${id}/documents/${tax.id}`);
  assert.equal(rm.status, 200, JSON.stringify(rm.json));
  assert.equal((await current('taxCardFile')).length, 0);
  assert.equal((await c.factory.del(`/applications/${id}/documents/${tax.id}`)).status, 404, 'already removed');
  const [row] = await q<{ status: string; storedName: string }>('SELECT status, storedName FROM documents WHERE id = ?', tax.id);
  assert.equal(row.status, 'removed', 'kept as a removed version, not deleted');
  assert.ok(fs.existsSync(path.join(env.dir, 'uploads', 'documents', row.storedName)));
  const [audit] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'document.remove' AND entityId = ?", tax.id);
  assert.equal(audit.n, 1);
  // Remove one of two bills.
  const bill = (await current('electricityBill'))[0];
  assert.equal((await c.factory.del(`/applications/${id}/documents/${bill.id}`)).status, 200);
  assert.equal((await current('electricityBill')).length, 1);

  const blocked = await act(c.factory, id, 'submit');
  assert.equal(blocked.status, 422);
  assert.ok(blocked.json.details.some((d: any) => d.field === 'taxCardFile'), JSON.stringify(blocked.json.details));
  const tax2 = (await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('tax-again'), 'tax-again.pdf')).json.data;
  const ok = await act(c.factory, id, 'submit');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  // IMC sees only what was submitted: the replaced and removed draft versions never reached a reviewer.
  const seen = (await getApp(c.imc, id)).documents.map((d: any) => d.id);
  assert.ok(seen.includes(v2.id) && seen.includes(tax2.id));
  for (const hidden of [v1.id, tax.id, bill.id]) assert.ok(!seen.includes(hidden), `IMC must not see ${hidden}`);
  assert.equal((await c.imc.get(`/applications/${id}/documents/${tax.id}/download`)).status, 404);

  // After submission nothing can be removed (the application is under review).
  const del = await c.factory.del(`/applications/${id}/documents/${tax2.id}`);
  assert.equal(del.status, 409);
  assert.equal(del.json.code, 'INVALID_STATE');
});

test('RF-8 IMC correction loop keeps working: only requested documents can be removed or replaced, and history is preserved', async () => {
  const id = await freshDraft();
  await saveAll(id, completeSections(regNo()));
  await uploadAll(id, 1);
  assert.equal((await act(c.factory, id, 'submit')).status, 200);
  const r = await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'taxCardFile', note: 'البطاقة منتهية' }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'IMC_CORRECTION');
  const submittedTax = app.documents.find((d: any) => d.kind === 'taxCardFile' && d.isCurrent);
  const cr = app.documents.find((d: any) => d.kind === 'commercialRegisterFile' && d.isCurrent);

  // Not in the deficiencies: refused.
  assert.equal((await c.factory.del(`/applications/${id}/documents/${cr.id}`)).status, 409);
  // In the deficiencies: allowed; the submitted version stays visible to IMC as history.
  assert.equal((await c.factory.del(`/applications/${id}/documents/${submittedTax.id}`)).status, 200);
  const afterRemove = await getApp(c.factory, id);
  assert.ok(!(afterRemove.unchangedDeficiencies ?? []).includes('taxCardFile'), 'removing the submitted file counts as a change');
  assert.equal((await act(c.factory, id, 'resubmit')).status, 422, 'the tax card is required again');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('tax-new'), 'tax-new.pdf')).status, 201);
  const re = await act(c.factory, id, 'resubmit');
  assert.equal(re.status, 200, JSON.stringify(re.json));
  assert.equal(re.json.data.state, 'IMC_REVIEW', 'back to the same reviewer');
  const imc = await getApp(c.imc, id);
  const taxVersions = imc.documents.filter((d: any) => d.kind === 'taxCardFile');
  assert.equal(taxVersions.length, 2, 'IMC sees the old submitted version and the new one');
  assert.equal(taxVersions.filter((d: any) => d.isCurrent).length, 1);
  const states = (await q<{ toState: string }>('SELECT toState FROM application_transitions WHERE applicationId = ? ORDER BY createdAt', id)).map((x) => x.toState);
  assert.deepEqual(states, ['IMC_REVIEW', 'IMC_CORRECTION', 'IMC_REVIEW']);
});

test('RF-9 the form definition served to the wizard uses the wording of the official form', async () => {
  const fields = new Map<string, any>((await c.factory.get('/meta')).json.data.form.fields.map((f: any) => [f.key, f]));
  const expected: Record<string, string> = {
    companyName: 'اسم الشركة', address: 'العنوان', phone1: 'تليفون (1)', phone2: 'تليفون (2)', fax: 'فاكس (1)', website: 'الموقع الإلكتروني',
    contactTitle: 'الوظيفة', roofAreas: 'بيان المساحات المتاحة من أسطح المنشأة الصناعية', electricityBills: 'فواتير الكهرباء لآخر 12 شهرًا',
    contractedCapacity: 'القدرة التعاقدية', peakLoad: 'أقصى حمل', ownershipProofFile: 'إثبات حق الملكية أو الاستخدام طوال مدة التمويل والتشغيل',
  };
  for (const [k, label] of Object.entries(expected)) assert.equal(fields.get(k)?.labelAr, label, k);
  for (const k of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile']) assert.equal(fields.get(k)?.type, 'file', k);
});
