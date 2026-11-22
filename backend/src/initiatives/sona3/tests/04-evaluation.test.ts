// المرحلة 04: إسناد المقيّمين، إقرار تضارب المصالح، الأوزان والدرجة الموزونة، المسودة والتسليم، الحدود الدنيا، رؤية المقيّمين.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, buildWorld, advanceTo, act, getApp, ok, q, scoresAll, GOOD_SCORES, type Started, type World,
} from './helpers.js';

const env = isolateTestEnv('evaluation');
let srv: Started;
let w: World;

// أوزان غير متساوية لإثبات أن الدرجة موزونة لا متوسطًا بسيطًا
const WEIGHTS = { financial: 30, technical: 20, market: 10, innovation: 10, jobs: 10, team: 20 };

before(async () => { srv = await startServer(); w = await buildWorld(srv, { weights: WEIGHTS, minTotalScore: 50, minFinancialScore: 50, minTechnicalScore: 50, minEvaluators: 1 }); });
after(async () => { await srv.close(); await env.cleanup(); });

test('assignment rules: IMC only, evaluators only, no duplicates, only during study review / evaluation', async () => {
  const j = await advanceTo(srv, w, 'STUDY_REVIEW');
  assert.equal((await j.applicant.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id })).status, 403);
  assert.equal((await w.eval1.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id })).status, 403);
  assert.equal((await w.admin.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id })).status, 403, 'admin takes no decisions');
  assert.equal((await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.imc2.user.id })).status, 400, 'IMC user is not an evaluator');
  assert.equal((await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: 'nope' })).status, 400);
  const first = ok(await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id }), 'assign');
  const dup = await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'ALREADY_ASSIGNED');
  // إلغاء إسناد ثم إعادة إسناد
  const assignmentId = first.json.data.evaluation.assignments[0].id;
  ok(await w.imc.req('DELETE', `/applications/${j.id}/evaluators/${assignmentId}`, { reason: 'تغيير' }), 'unassign');
  ok(await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id }), 're-assign');

  // لا إسناد على طلب لم يصل لمراجعة الدراسة
  const early = await advanceTo(srv, w, 'ELIGIBILITY_REVIEW');
  const r = await w.imc.post(`/applications/${early.id}/evaluators`, { evaluatorUserId: w.eval1.user.id });
  assert.equal(r.status, 409);
});

test('evaluator sees nothing before declaring no-conflict; scoring is blocked until the declaration', async () => {
  const j = await advanceTo(srv, w, 'COMMITTEE_EVALUATION');
  // eval2 غير مسند: لا يرى الطلب
  assert.equal((await w.eval2.get(`/applications/${j.id}`)).status, 404);
  assert.equal((await w.eval1.get(`/applications/${j.id}`)).status, 200);
  // لم يُقرّ بعد؟ في المسار الرئيسي أقرّ ضمن advanceTo، لذا نتحقق بمقيّم جديد
  ok(await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval2.user.id }), 'assign e2 during evaluation');
  let d = await getApp(w.eval2, j.id);
  assert.deepEqual(d.data, {}, 'no application data before COI declaration');
  assert.deepEqual(d.documents, []);
  const early = await w.eval2.put(`/applications/${j.id}/evaluation`, { scores: { financial: 50 } });
  assert.equal(early.status, 409);
  assert.equal(early.json.code, 'COI_REQUIRED');
  const noNote = await w.eval2.post(`/applications/${j.id}/evaluation/coi`, { hasConflict: true });
  assert.equal(noNote.status, 400, 'conflict needs a note');
  ok(await w.eval2.post(`/applications/${j.id}/evaluation/coi`, { hasConflict: false }), 'coi none');
  d = await getApp(w.eval2, j.id);
  assert.ok(d.data.personal && d.data.study_market, 'sees application + study after declaration');
  const again = await w.eval2.post(`/applications/${j.id}/evaluation/coi`, { hasConflict: false });
  assert.equal(again.status, 409, 'declaration is one-time');
});

test('conflict of interest: excluded evaluator loses access, IMC is notified, completion ignores the excluded one', async () => {
  const j = await advanceTo(srv, w, 'STUDY_REVIEW');
  ok(await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id }), 'a1');
  ok(await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval2.user.id }), 'a2');
  ok(await act(w.imc, j.id, 'accept'), 'to committee');
  ok(await w.eval2.post(`/applications/${j.id}/evaluation/coi`, { hasConflict: true, note: 'زميل دراسة للمتقدم' }), 'conflict');
  const ex = await getApp(w.eval2, j.id);
  assert.deepEqual(ex.data, {}, 'excluded evaluator sees no data');
  const score = await w.eval2.put(`/applications/${j.id}/evaluation`, { scores: { financial: 90 } });
  assert.equal(score.status, 403);
  const imcView = await getApp(w.imc, j.id);
  assert.equal(imcView.evaluation.assignments.find((a: any) => a.evaluatorUserId === w.eval2.user.id).status, 'conflict');
  assert.ok((await q("SELECT 1 FROM notification_outbox WHERE templateKey = 'ops.coi_declared' AND applicationId = ?", j.id)).length >= 1, 'IMC alerted');

  // e1 لم يسلّم بعد => لا يمكن الإغلاق
  const early = await act(w.imc, j.id, 'complete_evaluation');
  assert.equal(early.status, 422);
  assert.equal(early.json.code, 'EVALUATIONS_INCOMPLETE');
  ok(await w.eval1.post(`/applications/${j.id}/evaluation/coi`, { hasConflict: false }), 'coi');
  ok(await w.eval1.post(`/applications/${j.id}/evaluation/submit`, { scores: GOOD_SCORES, recommendation: 'recommend' }), 'submit');
  ok(await act(w.imc, j.id, 'complete_evaluation'), 'complete');
  assert.equal((await getApp(w.imc, j.id)).state, 'EVALUATED');
});

test('weighted score = sum(score x weight)/100 per evaluator, averaged across evaluators', async () => {
  const j = await advanceTo(srv, w, 'STUDY_REVIEW');
  for (const e of [w.eval1, w.eval2]) ok(await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: e.user.id }), 'assign');
  ok(await act(w.imc, j.id, 'accept'), 'to committee');
  // المقيّم 1: مالي 100، فني 60، السوق 40، ابتكار 20، وظائف 80، فريق 70
  const s1 = { financial: 100, technical: 60, market: 40, innovation: 20, jobs: 80, team: 70 };
  const w1 = (100 * 30 + 60 * 20 + 40 * 10 + 20 * 10 + 80 * 10 + 70 * 20) / 100; // 3000+1200+400+200+800+1400 = 7000 => 70
  const s2 = scoresAll(60);
  for (const [e, s] of [[w.eval1, s1], [w.eval2, s2]] as const) {
    ok(await e.post(`/applications/${j.id}/evaluation/coi`, { hasConflict: false }), 'coi');
    const r = ok(await e.post(`/applications/${j.id}/evaluation/submit`, { scores: s, recommendation: 'recommend' }), 'submit');
    void r;
  }
  const mine = await getApp(w.eval1, j.id);
  assert.equal(mine.evaluation.mine.weightedScore, w1);
  ok(await act(w.imc, j.id, 'complete_evaluation'), 'complete');
  const d = await getApp(w.imc, j.id);
  assert.equal(d.score, (w1 + 60) / 2);
  assert.equal(d.passedMinimums, true);
  assert.equal(d.evaluation.aggregate.evaluators, 2);
});

test('draft vs submit: draft is editable, submit needs all six scores in 0..100 integers + recommendation, then it is locked', async () => {
  const j = await advanceTo(srv, w, 'STUDY_REVIEW');
  ok(await w.imc.post(`/applications/${j.id}/evaluators`, { evaluatorUserId: w.eval1.user.id }), 'assign');
  ok(await act(w.imc, j.id, 'accept'), 'to committee');
  ok(await w.eval1.post(`/applications/${j.id}/evaluation/coi`, { hasConflict: false }), 'coi');
  ok(await w.eval1.put(`/applications/${j.id}/evaluation`, { scores: { financial: 55 }, notes: { financial: 'مبدئي' } }), 'draft 1');
  ok(await w.eval1.put(`/applications/${j.id}/evaluation`, { scores: { financial: 65, technical: 70 } }), 'draft 2');
  for (const bad of [{ financial: 101 }, { financial: -1 }, { financial: 50.5 }, { financial: '50' }, { bogus: 5 }]) {
    assert.equal((await w.eval1.put(`/applications/${j.id}/evaluation`, { scores: bad })).status, 400, JSON.stringify(bad));
  }
  const partial = await w.eval1.post(`/applications/${j.id}/evaluation/submit`, { scores: { financial: 65 }, recommendation: 'recommend' });
  assert.equal(partial.status, 400, 'all criteria required');
  const noRec = await w.eval1.post(`/applications/${j.id}/evaluation/submit`, { scores: GOOD_SCORES });
  assert.equal(noRec.status, 400, 'recommendation required');
  assert.equal((await w.eval1.post(`/applications/${j.id}/evaluation/submit`, { scores: GOOD_SCORES, recommendation: 'maybe' })).status, 400);
  ok(await w.eval1.post(`/applications/${j.id}/evaluation/submit`, { scores: GOOD_SCORES, recommendation: 'recommend' }), 'submit');
  const locked = await w.eval1.put(`/applications/${j.id}/evaluation`, { scores: { financial: 10 } });
  assert.equal(locked.status, 409);
  assert.equal(locked.json.code, 'ALREADY_SUBMITTED');
  assert.equal((await w.eval1.post(`/applications/${j.id}/evaluation/submit`, { scores: GOOD_SCORES, recommendation: 'recommend' })).status, 409);
  // لا يمكن إلغاء إسناد مقيّم سلّم
  const a = (await getApp(w.imc, j.id)).evaluation.assignments[0].id;
  assert.equal((await w.imc.req('DELETE', `/applications/${j.id}/evaluators/${a}`, {})).status, 409);
});

test('minimum thresholds: low financial/technical or total flags passedMinimums=false and blocks selection', async () => {
  // مالي 40 (< 50) رغم أن الإجمالي مرتفع
  const lowFin = await advanceTo(srv, w, 'EVALUATED', { scores: { ...scoresAll(90), financial: 40 } });
  let d = await getApp(w.imc, lowFin.id);
  assert.ok(d.score >= 50);
  assert.equal(d.passedMinimums, false);
  let r = await act(w.imc, lowFin.id, 'select');
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'BELOW_MINIMUM');

  const lowTech = await advanceTo(srv, w, 'EVALUATED', { scores: { ...scoresAll(90), technical: 49 } });
  assert.equal((await getApp(w.imc, lowTech.id)).passedMinimums, false);

  const lowTotal = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(45) });
  d = await getApp(w.imc, lowTotal.id);
  assert.equal(d.passedMinimums, false);
  assert.equal((await act(w.imc, lowTotal.id, 'select')).status, 422);

  // الحد بالضبط يجتاز (>=)
  const edge = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(50) });
  d = await getApp(w.imc, edge.id);
  assert.equal(d.score, 50);
  assert.equal(d.passedMinimums, true);

  // المتقدم لا يرى الدرجة قبل قرار الاختيار
  const own = await getApp(lowFin.applicant, lowFin.id);
  assert.equal(own.score, null);
  assert.equal(own.passedMinimums, null);
  // عدم الاختيار بسبب
  assert.equal((await act(w.imc, lowFin.id, 'not_select', {})).status, 400);
  ok(await act(w.imc, lowFin.id, 'not_select', { reason: 'أقل من الحد الأدنى للجدوى المالية' }), 'not_select');
  assert.equal((await getApp(lowFin.applicant, lowFin.id)).state, 'NOT_SELECTED');
});

test('evaluators never see each other scores; IMC sees all after submission; applicant and funder never see individual scores', async () => {
  const k = await advanceTo(srv, w, 'STUDY_REVIEW');
  for (const e of [w.eval1, w.eval2]) ok(await w.imc.post(`/applications/${k.id}/evaluators`, { evaluatorUserId: e.user.id }), 'assign');
  ok(await act(w.imc, k.id, 'accept'), 'to committee');
  for (const [e, v] of [[w.eval1, 71], [w.eval2, 93]] as const) {
    ok(await e.post(`/applications/${k.id}/evaluation/coi`, { hasConflict: false }), 'coi');
    ok(await e.post(`/applications/${k.id}/evaluation/submit`, { scores: scoresAll(v), notes: { financial: `ملاحظة ${v}` }, recommendation: 'recommend' }), 'submit');
  }
  const v1 = await getApp(w.eval1, k.id);
  assert.equal(v1.evaluation.mine.weightedScore, 71);
  assert.ok(!('assignments' in v1.evaluation), 'no list of other evaluators');
  assert.ok(!JSON.stringify(v1).includes('ملاحظة 93') && !JSON.stringify(v1).includes('"weightedScore":93'), 'peer scores absent');
  assert.equal(v1.score, null, 'evaluator sees no aggregate');

  const imc = await getApp(w.imc, k.id);
  const scores = imc.evaluation.assignments.map((a: any) => a.weightedScore).sort();
  assert.deepEqual(scores, [71, 93]);

  const own = JSON.stringify(await getApp(k.applicant, k.id));
  assert.ok(!own.includes('ملاحظة 71') && !own.includes('weightedScore'), 'applicant sees no individual evaluation');
  const mineList = await w.eval1.get('/evaluations/mine');
  assert.equal(mineList.status, 200);
  assert.ok(mineList.json.data.items.some((x: any) => x.applicationId === k.id));
  assert.equal((await w.imc.get('/evaluations/mine')).status, 403);
});

test('cohort weights lock once the first evaluation is submitted', async () => {
  const { weightsLocked } = await import('../store/cohorts.js');
  assert.equal(await weightsLocked(w.cohortId), true, 'earlier tests already submitted evaluations in this cohort');
  const { makeCohort } = await import('./helpers.js');
  const fresh = await makeCohort({ opensAt: '2000-01-01', closesAt: '2000-06-30' });
  assert.equal(await weightsLocked(fresh.id), false);
});
