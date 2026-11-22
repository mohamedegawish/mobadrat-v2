// النواقص وإعادة التقديم (الاستمارة والدراسة)، الرفض، الانسحاب، منع التعارض بـ expectedVersion، والمستندات بالنسخ.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, buildWorld, newApplicant, createCompleteDraft, fillStudy, act, getApp, ok, q, pdfVariant, advanceTo,
  type Started, type World,
} from './helpers.js';

const env = isolateTestEnv('corrections');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv); });
after(async () => { await srv.close(); await env.cleanup(); });

test('eligibility correction: deficiencies restrict editable fields, resubmit returns to review and resolves them', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  ok(await act(a, id, 'submit'), 'submit');

  // قائمة نواقص إجبارية ومن حقول الاستمارة فقط
  assert.equal((await act(w.imc, id, 'request_correction', {})).status, 400);
  assert.equal((await act(w.imc, id, 'request_correction', { deficiencies: [{ field: 'nope', note: 'x' }] })).status, 400);
  assert.equal((await act(w.imc, id, 'request_correction', { deficiencies: [{ field: 'productName', note: 'حقل دراسة' }] })).status, 400, 'study field not allowed here');
  ok(await act(w.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان غير واضح' }, { field: 'nationalIdFile', note: 'صورة غير مقروءة' }] }), 'request correction');

  let d = await getApp(a, id);
  assert.equal(d.state, 'ELIGIBILITY_CORRECTION');
  assert.deepEqual(d.editableFields.sort(), ['address', 'nationalIdFile']);
  assert.equal(d.currentTask.deficiencies.length, 2);

  // تعديل حقل خارج النواقص مرفوض، وداخلها مسموح
  const outside = await a.put(`/applications/${id}/data/personal`, { phone: '01099999999' });
  assert.equal(outside.status, 409);
  assert.equal(outside.json.code, 'FIELD_NOT_IN_DEFICIENCIES');
  ok(await a.put(`/applications/${id}/data/personal`, { address: '5 شارع الجمهورية، الجيزة' }), 'fix address');
  const wrongDoc = await a.upload(`/applications/${id}/documents`, { kind: 'qualificationFile' }, pdfVariant('q'));
  assert.equal(wrongDoc.status, 409);
  assert.equal(wrongDoc.json.code, 'FIELD_NOT_IN_DEFICIENCIES');
  ok(await a.upload(`/applications/${id}/documents`, { kind: 'nationalIdFile' }, pdfVariant('nid-v2')), 'new id file');

  // نسخة المحاولة السابقة محفوظة (نسخ لكل محاولة) والمقيّم/IMC يريان المُرسل فقط
  const docs = await q<{ version: number; attempt: number }>("SELECT version, attempt FROM sona3_documents WHERE applicationId = ? AND kind = 'nationalIdFile' ORDER BY version", id);
  assert.deepEqual(docs.map((x) => x.version), [1, 2]);
  assert.deepEqual(docs.map((x) => x.attempt), [1, 2]);
  const imcBefore = await getApp(w.imc, id);
  assert.equal(imcBefore.data.personal.address, '12 شارع التحرير، القاهرة', 'IMC still sees the submitted attempt until resubmit');

  ok(await act(a, id, 'resubmit'), 'resubmit');
  d = await getApp(w.imc, id);
  assert.equal(d.state, 'ELIGIBILITY_REVIEW');
  assert.equal(d.attempt, 2);
  assert.equal(d.data.personal.address, '5 شارع الجمهورية، الجيزة');
  assert.ok(d.deficiencies.every((x: any) => x.resolved), 'deficiencies resolved by resubmission');
  assert.equal(d.returnCounts.ELIGIBILITY_REVIEW, 1);
  ok(await act(w.imc, id, 'accept'), 'accept');
});

test('study correction loop: request_correction on study fields -> edit -> resubmit', async () => {
  const j = await advanceTo(srv, w, 'STUDY_REVIEW');
  assert.equal((await act(w.imc, j.id, 'request_correction', { deficiencies: [{ field: 'address', note: 'ليس من الدراسة' }] })).status, 400);
  ok(await act(w.imc, j.id, 'request_correction', { deficiencies: [{ field: 'pricing', note: 'التسعير غير واقعي' }] }), 'request study correction');
  let d = await getApp(j.applicant, j.id);
  assert.equal(d.state, 'STUDY_CORRECTION');
  assert.deepEqual(d.editableFields, ['pricing']);
  const bad = await j.applicant.put(`/applications/${j.id}/data/study_market`, { competitors: 'x' });
  assert.equal(bad.status, 409);
  ok(await j.applicant.put(`/applications/${j.id}/data/study_market`, { pricing: 'أقل 10% من المستورد' }), 'fix pricing');
  ok(await act(j.applicant, j.id, 'resubmit'), 'resubmit study');
  d = await getApp(w.imc, j.id);
  assert.equal(d.state, 'STUDY_REVIEW');
  assert.equal(d.data.study_market.pricing, 'أقل 10% من المستورد');
});

test('study submission needs every mandatory study section; accept needs at least one assigned evaluator', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  ok(await act(a, id, 'submit'), 'submit');
  ok(await act(w.imc, id, 'accept'), 'accept');
  const empty = await act(a, id, 'submit_study');
  assert.equal(empty.status, 422);
  assert.equal(empty.json.code, 'INCOMPLETE_STUDY');
  await fillStudy(a, id);
  // اتساق مالي: التمويل المطلوب لا يتجاوز إجمالي التكلفة الاستثمارية
  assert.equal((await a.put(`/applications/${id}/data/study_financial`, { requestedFinancing: 9_000_000 })).status, 200);
  const over = await act(a, id, 'submit_study');
  assert.equal(over.status, 422);
  ok(await a.put(`/applications/${id}/data/study_financial`, { requestedFinancing: 300000 }), 'restore');
  ok(await act(a, id, 'submit_study'), 'submit study');
  const noEval = await act(w.imc, id, 'accept');
  assert.equal(noEval.status, 422);
  assert.equal(noEval.json.code, 'NO_EVALUATORS');
});

test('applicant cannot act outside their step: wrong role / wrong state / unknown action', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  assert.equal((await act(a, id, 'accept')).status, 403, 'applicant cannot accept');
  assert.equal((await act(a, id, 'select')).status, 403);
  assert.equal((await act(a, id, 'resubmit')).status, 409, 'wrong state');
  assert.equal((await act(a, id, 'fly_to_moon')).status, 404);
  ok(await act(a, id, 'submit'), 'submit');
  assert.equal((await act(a, id, 'submit')).status, 409, 'already submitted');
  // الطلب بعد الإرسال لا يقبل تعديل البيانات
  const edit = await a.put(`/applications/${id}/data/personal`, { address: 'x' });
  assert.equal(edit.status, 409);
});

test('reject at eligibility and study review needs a reason; rejected is final', async () => {
  const j = await advanceTo(srv, w, 'STUDY_REVIEW');
  assert.equal((await act(w.imc, j.id, 'reject', { reason: 'ab' })).status, 400, 'reason min length');
  ok(await act(w.imc, j.id, 'reject', { reason: 'الأرقام غير واقعية' }), 'reject study');
  const d = await getApp(j.applicant, j.id);
  assert.equal(d.state, 'REJECTED');
  assert.ok(d.closedAt);
  assert.equal((await act(w.imc, j.id, 'accept')).status, 409, 'final state accepts no actions');
  assert.deepEqual(d.allowedActions, []);
});

test('withdraw: allowed before funding with a reason, not during implementation', async () => {
  const j = await advanceTo(srv, w, 'STUDY_REVIEW');
  assert.equal((await act(j.applicant, j.id, 'withdraw', {})).status, 400, 'reason required');
  ok(await act(j.applicant, j.id, 'withdraw', { reason: 'تغير الخطة' }), 'withdraw');
  assert.equal((await getApp(j.applicant, j.id)).state, 'WITHDRAWN');

  const k = await advanceTo(srv, w, 'IMPLEMENTATION');
  const r = await act(k.applicant, k.id, 'withdraw', { reason: 'لا أرغب' });
  assert.ok([403, 409].includes(r.status), `withdraw during implementation refused (${r.status})`);
  assert.equal((await getApp(k.applicant, k.id)).state, 'IMPLEMENTATION');

  // الانسحاب أثناء دراسة جهة التمويل يغلق الإحالة المعلقة
  const f = await advanceTo(srv, w, 'FUNDER_REVIEW');
  ok(await act(f.applicant, f.id, 'withdraw', { reason: 'وجدت تمويلًا آخر' }), 'withdraw in funder review');
  const refs = await q<{ status: string }>('SELECT status FROM sona3_funding_referrals WHERE applicationId = ?', f.id);
  assert.deepEqual(refs.map((x) => x.status), ['declined']);
});

test('optimistic locking: a stale expectedVersion is refused with VERSION_CONFLICT and a missing one is a validation error', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  const v = (await getApp(a, id)).version;
  const stale = await a.post(`/applications/${id}/actions/submit`, { expectedVersion: v + 5 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'VERSION_CONFLICT');
  const missing = await a.post(`/applications/${id}/actions/submit`, {});
  assert.equal(missing.status, 400);
  // سباق: إرسالان متزامنان بنفس النسخة => واحد فقط ينجح
  const [r1, r2] = await Promise.all([
    a.post(`/applications/${id}/actions/submit`, { expectedVersion: v }),
    a.post(`/applications/${id}/actions/submit`, { expectedVersion: v }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal((await q("SELECT 1 FROM sona3_application_transitions WHERE applicationId = ? AND action = 'submit'", id)).length, 1);
});

test('documents: PDF only, versioned per upload, hash stored, download audited and scoped', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  const notPdf = await a.upload(`/applications/${id}/documents`, { kind: 'qualificationFile' }, Buffer.from('MZ not a pdf'), 'x.pdf');
  assert.equal(notPdf.status, 400);
  const unknown = await a.upload(`/applications/${id}/documents`, { kind: 'whatever' }, pdfVariant('z'));
  assert.equal(unknown.status, 400);
  const up2 = ok(await a.upload(`/applications/${id}/documents`, { kind: 'nationalIdFile' }, pdfVariant('nid-b')), 'second version');
  assert.equal(up2.json.data.version, 2);
  assert.equal(up2.json.data.sha256.length, 64);
  // مرفقات داعمة متعددة بحد أقصى 5
  for (let i = 0; i < 5; i++) ok(await a.upload(`/applications/${id}/documents`, { kind: 'supportingFile' }, pdfVariant(`s${i}`)), `support ${i}`);
  const sixth = await a.upload(`/applications/${id}/documents`, { kind: 'supportingFile' }, pdfVariant('s6'));
  assert.equal(sixth.status, 422);
  assert.equal(sixth.json.code, 'TOO_MANY_FILES');

  ok(await act(a, id, 'submit'), 'submit');
  const dl = await w.imc.get(`/applications/${id}/documents/${up2.json.data.id}/download`);
  assert.equal(dl.status, 200);
  assert.ok(dl.raw && dl.raw.subarray(0, 5).toString() === '%PDF-');
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE action = 'document.download' AND applicationId = ?", id)).length >= 1);
  const other = await newApplicant(srv);
  assert.equal((await other.get(`/applications/${id}/documents/${up2.json.data.id}/download`)).status, 404, 'another applicant cannot download');
});
