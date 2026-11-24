// F7 (QA 2026-11-23, BUG-11): a refusal names each invalid field in Arabic — the message says which field and what is wrong,
// every detail carries its own message, and no English field code reaches the person (check 5). Other initiatives answer
// exactly as before (Sona3 registers no labels).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, registerFactory, registrationPayload, Client, type Started } from './helpers.js';

const env = isolateTestEnv('validation-text');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

/** One open application per factory: each case starts from none (a failed case must not block the next). */
async function closeOpen() {
  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}

const LATIN = /[A-Za-z]/;
/** The person-facing texts of a refusal: the message and every detail's message, all Arabic, no field code. */
function assertArabic(json: any, field: string) {
  assert.equal(json.code, 'VALIDATION_ERROR');
  assert.ok(!LATIN.test(json.messageAr), `messageAr has no English code — got «${json.messageAr}»`);
  assert.ok(json.details?.length, 'details are kept for programs');
  const d = json.details.find((x: any) => x.field === field);
  assert.ok(d, `a detail for ${field}`);
  assert.ok(typeof d.messageAr === 'string' && d.messageAr.length > 0 && !LATIN.test(d.messageAr), `the ${field} detail has its own Arabic message — got «${d.messageAr}»`);
  assert.ok(typeof d.messageEn === 'string' && d.messageEn.length > 0, `the ${field} detail has its English message`);
  return d;
}

test('a decision without its reason: «السبب: هذا الحقل مطلوب.» (IMC رفض, factory withdrawal)', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, 'IND-F7-1');
  const reject = await act(c.imc, id, 'reject', {});
  assert.equal(reject.status, 400);
  const d = assertArabic(reject.json, 'reason');
  assert.equal(d.messageAr, 'السبب: هذا الحقل مطلوب.');
  assert.equal(reject.json.messageAr, 'السبب: هذا الحقل مطلوب.', 'the message names the field instead of the generic text');
  assert.equal(reject.json.messageEn, 'Reason: This field is required.');

  const withdraw = await act(c.factory, id, 'withdraw', { reason: '   ' });
  assert.equal(withdraw.status, 400);
  assert.equal(assertArabic(withdraw.json, 'reason').messageAr, 'السبب: هذا الحقل مطلوب.');
  assert.equal((await act(c.factory, id, 'withdraw', { reason: 'إنهاء اختبار F7' })).status, 200);
});

test('several invalid fields: one message lists each field by its Arabic name', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, 'IND-F7-2');
  const r = await act(c.imc, id, 'request_correction', { reason: '', deficiencies: [] });
  assert.equal(r.status, 400);
  assertArabic(r.json, 'deficiencies');
  assert.ok(r.json.messageAr.includes('البنود المطلوب استيفاؤها'), `names the items — got «${r.json.messageAr}»`);
  await act(c.factory, id, 'withdraw', { reason: 'إنهاء اختبار F7' });
});

test('a field the step does not accept is named in Arabic, not by its code (BUG-02 bankOrgId)', async () => {
  await closeOpen();
  const id = await advanceTo('ELECTRICITY_UPLOAD', c, 'IND-F7-3');
  const r = await act(c.factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع (اختبار)', bankOrgId: 'org-bank-demo-a' });
  assert.equal(r.status, 400);
  const d = assertArabic(r.json, 'bankOrgId');
  assert.equal(d.messageAr, 'البنك: هذا البيان غير مقبول في هذه الخطوة.');
  await act(c.factory, id, 'withdraw', { reason: 'إنهاء اختبار F7' });
});

test('public sign-up with a badly formed registry number: the field is named in Arabic', async () => {
  const guest = new Client(srv.base);
  const r = await registerFactory(guest, registrationPayload('f7-format@factory.test', 'IND#BAD!'));
  assert.equal(r.status, 400, JSON.stringify(r.json));
  const d = assertArabic(r.json, r.json.details.find((x: any) => /industrialRegistryNumber/.test(x.field))?.field ?? 'industrialRegistryNumber');
  assert.ok(d.messageAr.startsWith('رقم السجل الصناعي: صيغة غير صالحة'), `got «${d.messageAr}»`);
});

test('other initiatives answer exactly as before: Sona3 keeps the generic message and plain details', async () => {
  const r = await new Client(srv.base).req('POST', '/i/sona3/public/register', {});
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'VALIDATION_ERROR');
  assert.equal(r.json.messageAr, 'البيانات المرسلة غير صحيحة.');
  assert.ok(r.json.details.length > 0);
  for (const d of r.json.details) assert.deepEqual(Object.keys(d).sort(), ['field', 'issue'], 'no per-field message added for Sona3');
});
