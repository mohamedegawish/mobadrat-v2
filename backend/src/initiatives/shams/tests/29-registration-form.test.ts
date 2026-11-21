// The official registration form (details/Registration Form V01.xlsx) ⇔ what the factory must enter before submitting.
// The workbook itself is read (not a copy), so a changed form makes this test fail. For every item of the form:
//  1. the platform's form (GET /meta → the same definition the wizard renders) has the field(s), with the right kind
//     ("إدخال بيانات" = data entry, "تحميل ملف" = file upload);
//  2. if the item is required, the server refuses to submit an application that lacks it (422 INCOMPLETE_APPLICATION
//     naming the field), and accepts it once the item is present.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isolateTestEnv, startServer, clients, act, completeSections, pdfVariant, FORM_DOCS, Client, type Started } from './helpers.js';

const env = isolateTestEnv('regform');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
const XLSX = createRequire(path.join(process.cwd(), '..', 'frontend', 'package.json'))('xlsx');
const WORKBOOK = path.join(process.cwd(), '..', 'details', 'Registration Form V01.xlsx');

/** Each line of the official form → the platform field(s) that capture it. `optional` = not required by shamsPolicy (★, D9). */
const MAPPING: Array<{ item: string; kind: 'data' | 'file'; fields: string[]; optional?: true }> = [
  { item: 'اسم الشركة', kind: 'data', fields: ['companyName'] },
  { item: 'المحافظة / المنطقة الصناعية', kind: 'data', fields: ['governorate', 'industrialZone'] },
  { item: 'العنوان', kind: 'data', fields: ['address'] },
  { item: 'تليفون (1)', kind: 'data', fields: ['phone1'] },
  { item: 'تليفون (2)', kind: 'data', fields: ['phone2'], optional: true },
  { item: 'فاكس (1)', kind: 'data', fields: ['fax'], optional: true },
  { item: 'موقع الكتروني', kind: 'data', fields: ['website'], optional: true },
  { item: 'الإسم', kind: 'data', fields: ['contactName'] },
  { item: 'الوظيفة', kind: 'data', fields: ['contactTitle'] },
  { item: 'تليفون- فاكس - موبايل', kind: 'data', fields: ['contactMobile'] }, // + optional contactPhone, contactFax
  { item: 'البريد الالكتروني', kind: 'data', fields: ['contactEmail'] },
  { item: 'السجل التجاري', kind: 'file', fields: ['commercialRegisterFile'] },
  { item: 'سجل صناعي', kind: 'file', fields: ['industrialRegisterFile'] },
  { item: 'بطاقة ضريبية', kind: 'file', fields: ['taxCardFile'] },
  { item: 'بيان المساحات المتاحة من اسطح المنشاة الصناعية', kind: 'data', fields: ['roofAreas'] },
  { item: 'فواتير الكهرباء لآخر 12 شهرًا.', kind: 'file', fields: ['electricityBills'] },
  { item: 'القدرة التعاقدية وأقصى حمل.', kind: 'data', fields: ['contractedCapacity', 'peakLoad'] },
  { item: 'إثبات حق الملكية أو الاستخدام طوال مدة التمويل والتشغيل.', kind: 'file', fields: ['ownershipProofFile'] },
];
/** Fields the platform asks for in addition to the form (needed by the workflow; listed in the report). */
const EXTRA = ['commercialRegisterNumber', 'industrialRegistryNumber', 'taxNumber', 'capacityUnit', 'loadUnit', 'ownershipType', 'ownershipExpiresAt', 'contactPhone', 'contactFax'];
const SECTION_HEADERS = ['Registration Form', 'بيانات عامة', 'مسئول الاتصال', 'أوراق الشركة', 'بيانات هندسية'];
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function formItems(): Array<{ item: string; kind: 'data' | 'file' }> {
  const wb = XLSX.readFile(WORKBOOK);
  const rows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const out: Array<{ item: string; kind: 'data' | 'file' }> = [];
  for (const r of rows) {
    const label = norm(String(r[0] ?? ''));
    const how = norm(String(r[2] ?? ''));
    if (!label || SECTION_HEADERS.includes(label)) continue;
    assert.ok(how === 'إدخال بيانات' || how === 'تحميل ملف', `unexpected instruction "${how}" for "${label}"`);
    out.push({ item: label, kind: how === 'تحميل ملف' ? 'file' : 'data' });
  }
  return out;
}

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen(factory: Client) {
  const open = (await factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}

/** A draft with every data section filled, and every form document uploaded except `skipDoc`. */
async function draft(skipDoc?: string): Promise<string> {
  await closeOpen(c.factory);
  const id = (await c.factory.post('/applications', {})).json.data.id as string;
  for (const [section, data] of Object.entries(completeSections('IND-FORM-1'))) assert.equal((await c.factory.put(`/applications/${id}/data/${section}`, data)).status, 200);
  for (const kind of FORM_DOCS) if (kind !== skipDoc) assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind }, pdfVariant(kind))).status, 201);
  if (skipDoc !== 'electricityBill') assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, pdfVariant('bill'), 'bill.pdf')).status, 201);
  return id;
}

async function submitMissing(id: string): Promise<string[]> {
  const r = await act(c.factory, id, 'submit');
  if (r.status === 200) return [];
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(r.json.code, 'INCOMPLETE_APPLICATION');
  return (r.json.details as Array<{ field: string }>).map((d) => d.field);
}

test('REG-1 every item of the official registration form is mapped, and nothing in the workbook is left unmapped', () => {
  const items = formItems();
  assert.equal(items.length, 18, `form items: ${items.map((i) => i.item).join(' | ')}`);
  for (const it of items) {
    const m = MAPPING.find((x) => norm(x.item) === it.item);
    assert.ok(m, `form item "${it.item}" has no platform field`);
    assert.equal(m.kind, it.kind, `"${it.item}" is "${it.kind === 'file' ? 'تحميل ملف' : 'إدخال بيانات'}" in the form`);
  }
  assert.equal(MAPPING.length, items.length, 'no stale mapping entries');
});

test('REG-2 the form the factory fills (GET /meta, rendered by the wizard) contains each item with the right kind and required flag', async () => {
  const meta = (await c.factory.get('/meta')).json.data;
  const fields = new Map<string, { type: string; required: boolean; section: string }>(meta.form.fields.map((f: any) => [f.key, f]));
  for (const m of MAPPING) {
    for (const key of m.fields) {
      const f = fields.get(key);
      assert.ok(f, `${m.item}: field ${key} missing from the form`);
      const isFile = f.type === 'file' || f.type === 'files';
      assert.equal(isFile, m.kind === 'file', `${m.item}: ${key} has type ${f.type}`);
      assert.equal(f.required, !m.optional, `${m.item}: ${key} required = ${f.required}`);
    }
  }
  for (const key of EXTRA) assert.ok(fields.has(key), `extra field ${key}`);
  // the same four sections as the official form, in the same order
  assert.deepEqual([...new Set(meta.form.fields.map((f: any) => f.section))], ['general', 'contact', 'company', 'engineering']);
});

test('REG-3 a complete application submits; removing any required data item from the form blocks the submission and names it', async () => {
  const id = await draft();
  const complete = completeSections('IND-FORM-1') as Record<string, Record<string, unknown>>;
  const sectionOf = (key: string) => Object.keys(complete).find((s) => key in complete[s])!;
  const blocked: string[] = [];
  for (const m of MAPPING.filter((x) => x.kind === 'data' && !x.optional)) {
    for (const key of m.fields) {
      const section = sectionOf(key);
      assert.equal((await c.factory.put(`/applications/${id}/data/${section}`, { [key]: null })).status, 200, key);
      const missing = await submitMissing(id);
      assert.ok(missing.includes(key), `${m.item}: submit without ${key} was not refused (missing: ${missing.join(',')})`);
      blocked.push(key);
      assert.equal((await c.factory.put(`/applications/${id}/data/${section}`, complete[section])).status, 200);
    }
  }
  console.log(`[REG-3] required data items enforced on submit: ${blocked.join(', ')}`);
  // optional items of the form (phone 2, fax, website) may be left empty: the complete draft has none of them and is accepted
  const optional = MAPPING.filter((x) => x.optional).flatMap((x) => x.fields);
  for (const key of optional) assert.ok(!(key in complete[sectionOf('companyName')]), `${key} is not in the test data`);
  assert.equal((await act(c.factory, id, 'submit')).status, 200, 'the complete application (without the optional items) is accepted');
});

test('REG-4 each required document of the form: submitting without it is refused and names it', async () => {
  for (const m of MAPPING.filter((x) => x.kind === 'file')) {
    const key = m.fields[0];
    const kind = key === 'electricityBills' ? 'electricityBill' : key;
    const id = await draft(kind);
    const missing = await submitMissing(id);
    assert.ok(missing.includes(key), `${m.item}: submit without ${key} was not refused (missing: ${missing.join(',')})`);
    assert.equal((await c.factory.get(`/applications/${id}`)).json.data.state, 'DRAFT');
  }
});
