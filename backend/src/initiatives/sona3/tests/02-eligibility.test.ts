// شروط المقترح عند التقديم: السن <= 35 (حسب مرجع الدورة)، الجنسية، الرقم القومي ومطابقة الميلاد، طلب مفتوح واحد، الدورة المفتوحة، اكتمال الاستمارة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, buildWorld, makeCohort, newApplicant, createCompleteDraft, applicationSections, act, getApp, ok, q, pdfVariant,
  nationalIdFor, addYears, addDays, todayIso, type Started, type World,
} from './helpers.js';

const env = isolateTestEnv('eligibility');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv, { maxAge: 35, ageReference: 'cohort_close' }); });
after(async () => { await srv.close(); await env.cleanup(); });

function details(r: any): any[] { return r.json.error?.details ?? r.json.details ?? []; }

test('age limit is measured at cohort close: exactly 35 passes, 36 is rejected', async () => {
  // يبلغ 36 في يوم إغلاق باب التقديم تمامًا
  const turns36 = addYears(w.closesAt, -36);
  const a1 = await newApplicant(srv);
  const id1 = await createCompleteDraft(a1, { birthDate: turns36 });
  const r1 = await act(a1, id1, 'submit');
  assert.equal(r1.status, 422);
  assert.equal(r1.json.code, 'AGE_LIMIT_EXCEEDED');
  assert.equal((await getApp(a1, id1)).state, 'DRAFT', 'stays a draft, data saved');

  // يبلغ 36 في اليوم التالي للإغلاق => عمره 35 عند الإغلاق
  const turns36Tomorrow = addDays(addYears(w.closesAt, -36), 1);
  const a2 = await newApplicant(srv);
  const id2 = await createCompleteDraft(a2, { birthDate: turns36Tomorrow });
  ok(await act(a2, id2, 'submit'), 'submit age 35');
  assert.equal((await getApp(a2, id2)).state, 'ELIGIBILITY_REVIEW');
});

test('age reference "submission" uses the date of submission instead of cohort close', async () => {
  const { updateCohort } = await import('../src/store/cohorts.js');
  updateCohort(w.cohortId, { ageReference: 'submission' });
  try {
    // عمره اليوم 35 ويبلغ 36 قبل الإغلاق بأيام: يمر لأن المرجع هو التقديم
    const birth = addDays(addYears(todayIso(), -36), 10);
    const a = await newApplicant(srv);
    const id = await createCompleteDraft(a, { birthDate: birth });
    ok(await act(a, id, 'submit'), 'submit by submission-date age');
    // وعمره اليوم 36 يُرفض
    const a2 = await newApplicant(srv);
    const id2 = await createCompleteDraft(a2, { birthDate: addYears(todayIso(), -36) });
    const r = await act(a2, id2, 'submit');
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'AGE_LIMIT_EXCEEDED');
  } finally {
    updateCohort(w.cohortId, { ageReference: 'cohort_close' });
  }
});

test('national ID: bad format / century / date / governorate rejected on save; birth date must match the ID on submit', async () => {
  const a = await newApplicant(srv);
  const created = ok(await a.post('/applications', {}), 'create');
  const id = created.json.data.id as string;
  const bad: Array<[string, string]> = [
    ['123', 'short'], ['2950231010123451', 'long'], ['4950515010123451'.slice(0, 14), 'century 4'],
    ['29502300101234', 'invalid day 30 of Feb'], ['29505159901234', 'unknown governorate code 99'], ['2abcdefghijklmn', 'non-digits'],
  ];
  for (const [nid, why] of bad) {
    const r = await a.put(`/applications/${id}/data/personal`, { nationalId: nid });
    assert.equal(r.status, 400, `rejected: ${why}`);
  }
  // رقم صالح البنية لكن ميلاده لا يطابق تاريخ الميلاد المُدخل
  const sections = applicationSections({ birthDate: '1995-05-15', nationalId: nationalIdFor('1996-01-02') });
  for (const [s, d] of Object.entries(sections)) ok(await a.put(`/applications/${id}/data/${s}`, d), s);
  ok(await a.upload(`/applications/${id}/documents`, { kind: 'nationalIdFile' }, pdfVariant('nid')), 'doc');
  const r = await act(a, id, 'submit');
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'INCOMPLETE_APPLICATION');
  assert.ok(details(r).some((x) => x.field === 'birthDate'), 'birthDate mismatch reported');

  // تصحيح الميلاد ليطابق الرقم
  ok(await a.put(`/applications/${id}/data/personal`, { birthDate: '1996-01-02' }), 'fix birth');
  ok(await act(a, id, 'submit'), 'submit after fix');
});

test('nationality other than Egyptian is flagged in the eligibility checks for IMC (decision stays with IMC)', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a, { nationality: 'other' });
  ok(await act(a, id, 'submit'), 'submit');
  const d = await getApp(w.imc, id);
  const nat = d.eligibility.checks.find((c: any) => c.key === 'nationality');
  assert.equal(nat.ok, false);
  // IMC يرفض مع السبب
  const noReason = await act(w.imc, id, 'reject', {});
  assert.equal(noReason.status, 400, 'reason required');
  ok(await act(w.imc, id, 'reject', { reason: 'الجنسية غير مصرية' }), 'reject');
  assert.equal((await getApp(a, id)).state, 'REJECTED');
});

test('only one open application per applicant, and per national ID', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  const second = await a.post('/applications', {});
  assert.equal(second.status, 409);
  assert.equal(second.json.code, 'OPEN_APPLICATION_EXISTS');

  // رقم قومي مستخدم في طلب مُرسل مفتوح
  const nid = nationalIdFor('1994-03-03');
  const b = await newApplicant(srv);
  const idB = await createCompleteDraft(b, { birthDate: '1994-03-03', nationalId: nid });
  ok(await act(b, idB, 'submit'), 'b submit');
  const c = await newApplicant(srv);
  const idC = await createCompleteDraft(c, { birthDate: '1994-03-03', nationalId: nid });
  const dup = await act(c, idC, 'submit');
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'DUPLICATE_NATIONAL_ID');
  assert.equal((await getApp(c, idC)).state, 'DRAFT', 'data preserved');
  // بعد وصول الأول لحالة نهائية يُسمح بالتقديم بنفس الرقم
  ok(await act(w.imc, idB, 'reject', { reason: 'غير جاد' }), 'reject b');
  ok(await act(c, idC, 'submit'), 'c submit after b closed');
  void id;
});

test('a new application can be started after a final state (reapply)', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  ok(await act(a, id, 'withdraw', { reason: 'ظروف شخصية' }), 'withdraw');
  assert.equal((await getApp(a, id)).state, 'WITHDRAWN');
  const again = await a.post('/applications', {});
  assert.equal(again.status, 201);
  assert.notEqual(again.json.data.id, id);
});

test('submission requires every mandatory field and the national ID file', async () => {
  const a = await newApplicant(srv);
  const created = ok(await a.post('/applications', {}), 'create');
  const id = created.json.data.id as string;
  const r = await act(a, id, 'submit');
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'INCOMPLETE_APPLICATION');
  const fields = details(r).map((x) => x.field);
  for (const f of ['nationalId', 'birthDate', 'projectName', 'declTermsRead', 'nationalIdFile']) assert.ok(fields.includes(f), `missing ${f} reported`);
  assert.equal((await getApp(a, id)).state, 'DRAFT');
});

test('team application needs partners (max 10) with valid national IDs; individual cannot carry partners', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  ok(await a.put(`/applications/${id}/data/team`, { applicationType: 'team' }), 'team');
  const noPartners = await act(a, id, 'submit');
  assert.equal(noPartners.status, 422);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `شريك ${i}`, nationalId: nationalIdFor('1997-01-01'), age: 29, qualification: 'بكالوريوس', role: 'مبيعات' }));
  assert.equal((await a.put(`/applications/${id}/data/team`, { partners: eleven })).status, 400, 'max 10 partners');
  const partner = { name: 'شريك', nationalId: nationalIdFor('1997-01-01'), age: 29, qualification: 'بكالوريوس', role: 'مبيعات' };
  assert.equal((await a.put(`/applications/${id}/data/team`, { partners: [{ ...partner, nationalId: '123' }] })).status, 400);
  ok(await a.put(`/applications/${id}/data/team`, { partners: [partner] }), 'one partner');
  ok(await act(a, id, 'submit'), 'submit team');
  const d = await getApp(w.imc, id);
  assert.equal(d.teamSize, 2);
  assert.equal(d.eligibility.checks.find((c: any) => c.key === 'partnersAge').ok, true);
});

test('applications only start inside an open cohort', async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  getDb().prepare('UPDATE cohorts SET opensAt = ?, closesAt = ?').run(addDays(todayIso(), -60), addDays(todayIso(), -1));
  try {
    const a = await newApplicant(srv);
    const r = await a.post('/applications', {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'NO_OPEN_COHORT');
  } finally {
    getDb().prepare('UPDATE cohorts SET opensAt = ?, closesAt = ?').run(addDays(todayIso(), -30), w.closesAt);
  }
  void makeCohort; void q;
});

test('submit is closed if the cohort closes between draft and submit', async () => {
  const a = await newApplicant(srv);
  const id = await createCompleteDraft(a);
  const { getDb } = await import('../src/db/sqlite.js');
  getDb().prepare('UPDATE cohorts SET closesAt = ? WHERE id = ?').run(addDays(todayIso(), -1), w.cohortId);
  try {
    const r = await act(a, id, 'submit');
    assert.ok([409, 422].includes(r.status));
    assert.ok(['COHORT_CLOSED', 'AGE_LIMIT_EXCEEDED'].includes(r.json.code), r.json.code);
  } finally {
    getDb().prepare('UPDATE cohorts SET closesAt = ? WHERE id = ?').run(w.closesAt, w.cohortId);
  }
});
