// اختبارات القبول 4–8: رفض IMC نهائي، إرجاعات تعود لنفس المراجع مع بقاء النسختين، قيود حقول النواقص، ولا رفض لـ ENCPC/PMU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, createCompleteDraft, uploadProof, act, getApp, advanceTo, pdfVariant, q, type Started } from './helpers.js';

const env = isolateTestEnv('decisions');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-DEC-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

/** يُنهي طلب المصنع المفتوح (طلب واحد مفتوح لكل مصنع). */
async function closeOpen(factory = c.factory) {
  const p = await factory.get('/factory/profile');
  const open = p.json.data.openApplicationId;
  if (open) await act(factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}

test('4) IMC reject: final state, reason delivered, later actions → 409', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  const noReason = await act(c.imc, id, 'reject', {});
  assert.equal(noReason.status, 400, 'reason is mandatory');
  const r = await act(c.imc, id, 'reject', { reason: 'المستندات غير مطابقة للاشتراطات' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'REJECTED');
  assert.ok(app.closedAt);
  assert.equal(app.transitions.at(-1).reason, 'المستندات غير مطابقة للاشتراطات');
  const n = await q<{ subject: string }>("SELECT subject FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.rejected' AND channel = 'email'", id);
  assert.ok(n.length >= 1);
  const body = await q<{ body: string }>("SELECT body FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.rejected' AND channel = 'email' LIMIT 1", id);
  assert.match(body[0].body, /المستندات غير مطابقة للاشتراطات/);
  for (const [client, action] of [[c.imc, 'accept'], [c.factory, 'withdraw'], [c.factory, 'resubmit'], [c.pmu, 'accept']] as const) {
    const later = await client.post(`/applications/${id}/actions/${action}`, { expectedVersion: app.version, reason: 'xxx' });
    assert.equal(later.status, 409, `${action} after terminal → 409`);
  }
});

test('5a) IMC correction returns to IMC and keeps both versions', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  const noDefs = await act(c.imc, id, 'request_correction', { deficiencies: [] });
  assert.equal(noDefs.status, 400, 'deficiency list is mandatory');
  const r = await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'taxCardFile', note: 'البطاقة منتهية' }, { field: 'address', note: 'العنوان غير مكتمل' }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'IMC_CORRECTION');
  assert.deepEqual(app.editableFields.sort(), ['address', 'taxCardFile']);
  assert.equal(app.currentTask.deficiencies.length, 2);

  assert.equal((await c.factory.put(`/applications/${id}/data/general`, { address: 'العنوان الجديد الكامل' })).status, 200);
  const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('tax-v2'));
  assert.equal(up.status, 201);
  // IMC يرى النسخة المُرسلة فقط حتى إعادة التقديم
  let imcView = await getApp(c.imc, id);
  assert.notEqual(imcView.data.general.address, 'العنوان الجديد الكامل');
  assert.equal(imcView.documents.filter((d: any) => d.kind === 'taxCardFile').length, 1);

  const re = await act(c.factory, id, 'resubmit');
  assert.equal(re.status, 200, JSON.stringify(re.json));
  imcView = await getApp(c.imc, id);
  assert.equal(imcView.state, 'IMC_REVIEW', 'back to the same reviewer directly');
  assert.equal(imcView.data.general.address, 'العنوان الجديد الكامل');
  const tax = imcView.documents.filter((d: any) => d.kind === 'taxCardFile');
  assert.equal(tax.length, 2, 'both versions kept');
  assert.deepEqual(tax.map((d: any) => d.version).sort(), [1, 2]);
  const versions = await q('SELECT attempt FROM shams_application_data WHERE applicationId = ? AND section = ? ORDER BY attempt', id, 'general');
  assert.equal(versions.length, 2, 'data version per attempt');
  assert.ok((await q("SELECT 1 FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.resubmitted'", id)).length >= 1);
  app = await getApp(c.factory, id);
  assert.equal((await q('SELECT 1 FROM shams_deficiencies WHERE applicationId = ? AND resolvedAtTransitionId IS NULL', id)).length, 0, 'deficiencies resolved');
});

test('7) editing a field outside the deficiencies is rejected', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'أكمل العنوان' }] });
  const bad = await c.factory.put(`/applications/${id}/data/general`, { companyName: 'اسم آخر' });
  assert.equal(bad.status, 409);
  assert.equal(bad.json.code, 'FIELD_NOT_IN_DEFICIENCIES');
  const badMixed = await c.factory.put(`/applications/${id}/data/general`, { address: 'عنوان', phone1: '0220000000' });
  assert.equal(badMixed.status, 409);
  const badDoc = await c.factory.upload(`/applications/${id}/documents`, { kind: 'commercialRegisterFile' }, pdfVariant('x'));
  assert.equal(badDoc.status, 409);
  assert.equal(badDoc.json.code, 'FIELD_NOT_IN_DEFICIENCIES');
  const good = await c.factory.put(`/applications/${id}/data/general`, { address: 'العنوان الصحيح' });
  assert.equal(good.status, 200);
  const unknown = await c.factory.put(`/applications/${id}/data/general`, { isAdmin: true });
  assert.equal(unknown.status, 400, 'mass assignment rejected');
});

test('5b) ENCPC non-compliance returns to ENCPC; 5c) offer correction returns to PMU with both offer versions', async () => {
  await closeOpen();
  const id = await advanceTo('ENCPC_REVIEW', c, reg());
  const r = await act(c.encpc, id, 'non_compliant', { reason: 'المساحات غير دقيقة' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await getApp(c.factory, id)).state, 'ENCPC_CORRECTION');
  await uploadProof(c.factory, id);
  assert.equal((await act(c.factory, id, 'resubmit')).status, 200);
  assert.equal((await getApp(c.encpc, id)).state, 'ENCPC_REVIEW');

  await act(c.encpc, id, 'compliant');
  await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-v1'));
  await act(c.factory, id, 'submit_offer');
  const noReason = await act(c.pmu, id, 'request_correction', {});
  assert.equal(noReason.status, 400);
  assert.equal((await act(c.pmu, id, 'request_correction', { reason: 'العرض لا يوضح فترة الاسترداد' })).status, 200);
  assert.equal((await getApp(c.factory, id)).state, 'OFFER_CORRECTION');
  const noNew = await act(c.factory, id, 'resubmit');
  assert.equal(noNew.status, 422, 'a new offer version is required');
  await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-v2'));
  assert.equal((await act(c.factory, id, 'resubmit')).status, 200);
  const pmuView = await getApp(c.pmu, id);
  assert.equal(pmuView.state, 'OFFER_REVIEW');
  assert.equal(pmuView.documents.filter((d: any) => d.kind === 'technicalOfferFile').length, 2);
  assert.equal(pmuView.returnCounts.ENCPC_REVIEW, 1);
  assert.equal(pmuView.returnCounts.OFFER_REVIEW, 1);
});

test('6) the ministry rejects with notes → the factory answers → the ministry reviews again', async () => {
  await closeOpen();
  const id = await advanceTo('ELECTRICITY_REVIEW', c, reg());
  assert.equal((await act(c.electricity, id, 'request_correction', {})).status, 400, 'notes mandatory');
  assert.equal((await act(c.electricity, id, 'request_correction', { reason: 'العقد غير موقع' })).status, 200);
  assert.equal((await getApp(c.factory, id)).state, 'ELECTRICITY_UPLOAD');
  assert.equal((await act(c.factory, id, 'resubmit')).status, 422, 'proof document required');
  await uploadProof(c.factory, id);
  assert.equal((await act(c.factory, id, 'resubmit')).status, 200);
  const v = await getApp(c.electricity, id);
  assert.equal(v.state, 'ELECTRICITY_REVIEW');
  assert.equal(v.documents.filter((d: any) => d.kind === 'correctionProofFile').length, 1);
});

test('8) ENCPC and PMU cannot issue a final rejection', async () => {
  await closeOpen();
  const id = await advanceTo('ENCPC_REVIEW', c, reg());
  const e = await act(c.encpc, id, 'reject', { reason: 'رفض' });
  assert.ok([403, 409].includes(e.status), `ENCPC reject → ${e.status}`);
  await act(c.encpc, id, 'compliant');
  await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer'));
  await act(c.factory, id, 'submit_offer');
  const p = await act(c.pmu, id, 'reject', { reason: 'رفض' });
  assert.ok([403, 409].includes(p.status), `PMU reject → ${p.status}`);
  assert.equal((await getApp(c.pmu, id)).state, 'OFFER_REVIEW');
  const pmuActions = (await getApp(c.pmu, id)).allowedActions.map((a: any) => a.action);
  assert.ok(!pmuActions.includes('reject'));
});

test('draft submit with missing data → 422 with field details', async () => {
  await closeOpen();
  const created = await c.factory.post('/applications', {});
  const id = created.json.data.id;
  const r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'INCOMPLETE_APPLICATION');
  const fields = r.json.details.map((d: any) => d.field);
  for (const f of ['governorate', 'industrialRegistryNumber', 'electricityBills', 'taxCardFile']) assert.ok(fields.includes(f), `${f} reported`);
  void createCompleteDraft;
});
