// الرحلة الكاملة 01–08 بالأدوار الخمسة عبر HTTP حقيقي، مع التحقق من أرقام الطلبات والسجل والصرف المرتبط بالتحقق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, buildWorld, newApplicant, createCompleteDraft, fillStudy, act, getApp, ok, q, pdfVariant, todayIso, addDays,
  GOOD_SCORES, type Started, type World,
} from './helpers.js';

const env = isolateTestEnv('journey');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv, { selectionTarget: 15 }); });
after(async () => { await srv.close(); await env.cleanup(); });

test('full journey 01-08: draft -> submit -> eligibility -> study -> evaluation -> selection -> approval -> funding -> milestones -> operating -> completed', async () => {
  const a = await newApplicant(srv);

  // 01 — المسودة وحفظ الاستمارة
  const id = await createCompleteDraft(a);
  let d = await getApp(a, id);
  assert.equal(d.state, 'DRAFT');
  assert.equal(d.number, null);
  assert.equal(d.cohort.id, w.cohortId);
  assert.ok(d.allowedActions.some((x: any) => x.action === 'submit'));
  assert.ok(d.allowedActions.some((x: any) => x.action === 'withdraw'));

  // إرسال: يصدر الرقم SONA3-<السنة>-<تسلسل>
  ok(await act(a, id, 'submit'), 'submit');
  d = await getApp(a, id);
  assert.equal(d.state, 'ELIGIBILITY_REVIEW');
  assert.match(d.number, new RegExp(`^SONA3-${new Date().getFullYear()}-\\d+$`));
  assert.equal(d.step, 2);
  assert.equal(d.attempt, 1);

  // 02 — IMC يرى فحوص الأهلية ويقبل
  const imcView = await getApp(w.imc, id);
  const checks = Object.fromEntries(imcView.eligibility.checks.map((c: any) => [c.key, c.ok]));
  assert.equal(checks.age, true);
  assert.equal(checks.nationality, true);
  assert.equal(checks.nationalId, true);
  ok(await act(w.imc, id, 'accept'), 'eligibility accept');
  assert.equal((await getApp(a, id)).state, 'STUDY_PREPARATION');

  // 03 — دراسة الجدوى + الحسابات التلقائية في السيرفر
  await fillStudy(a, id);
  d = await getApp(a, id);
  assert.equal(d.studyTotals.totalAssets, 250000);
  assert.equal(d.studyTotals.totalInvestment, 450000, 'assets + establishment + working capital');
  assert.equal(d.studyTotals.firstYearNetProfit, 400000);
  assert.equal(d.studyTotals.planTotal, 300000);
  ok(await act(a, id, 'submit_study'), 'submit study');
  assert.equal((await getApp(a, id)).state, 'STUDY_REVIEW');

  // 04 — إسناد مقيّمين (واحد منهم يعلن تضاربًا) وتقييم
  const asg1 = ok(await w.imc.post(`/applications/${id}/evaluators`, { evaluatorUserId: w.eval1.user.id }), 'assign e1');
  assert.equal(asg1.status, 201);
  ok(await w.imc.post(`/applications/${id}/evaluators`, { evaluatorUserId: w.eval2.user.id }), 'assign e2');
  ok(await act(w.imc, id, 'accept'), 'study accept -> committee');
  assert.equal((await getApp(w.imc, id)).state, 'COMMITTEE_EVALUATION');

  assert.equal((await w.eval1.post(`/applications/${id}/evaluation/coi`, { hasConflict: false })).status, 200);
  assert.equal((await w.eval2.post(`/applications/${id}/evaluation/coi`, { hasConflict: true, note: 'قرابة مع المتقدم' })).status, 200);
  const e1 = await w.eval1.put(`/applications/${id}/evaluation`, { scores: { financial: 70 } });
  assert.equal(e1.status, 200, 'draft save');
  const sub = await w.eval1.post(`/applications/${id}/evaluation/submit`, { scores: GOOD_SCORES, notes: { financial: 'ممتاز' }, recommendation: 'strongly_recommend' });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));

  // IMC يغلق التقييم: المقيّم المتعارض مستبعد من الشرط
  ok(await act(w.imc, id, 'complete_evaluation'), 'complete evaluation');
  d = await getApp(w.imc, id);
  assert.equal(d.state, 'EVALUATED');
  assert.equal(d.score, 80);
  assert.equal(d.passedMinimums, true);

  // 05 — الاختيار (شاشة الترتيب)
  const rank = await w.imc.get(`/cohorts/${w.cohortId}/ranking`);
  assert.equal(rank.status, 200);
  assert.equal(rank.json.data.cohort.selectionTarget, 15);
  assert.equal(rank.json.data.items[0].id, id);
  assert.equal(rank.json.data.items[0].rank, 1);
  ok(await act(w.imc, id, 'select'), 'select');
  assert.equal((await getApp(a, id)).state, 'SELECTED');
  assert.equal((await getApp(a, id)).score, 80, 'applicant sees overall score after selection');

  // 06 — الاعتماد يحتاج مستند القرار ثم إحالة لجهة تمويل
  const noDoc = await act(w.imc, id, 'record_approval', { approvalDate: todayIso(), approvalReference: 'ع-1' });
  assert.equal(noDoc.status, 422);
  assert.equal(noDoc.json.code, 'DOCUMENT_REQUIRED');
  ok(await w.imc.upload(`/applications/${id}/documents`, { kind: 'approvalFile' }, pdfVariant('approval')), 'approval doc');
  ok(await act(w.imc, id, 'record_approval', { approvalDate: todayIso(), approvalReference: 'ع-1' }), 'approval');
  assert.equal((await getApp(a, id)).state, 'FUNDING_SEARCH');
  ok(await act(w.imc, id, 'refer_funder', { funderOrgId: w.funderAOrg, note: 'ملف قوي' }), 'refer');
  assert.equal((await getApp(w.funderA, id)).state, 'FUNDER_REVIEW');

  // جهة التمويل توافق؛ مراحل الصرف تُبنى من خطة الدراسة
  ok(await act(w.funderA, id, 'approve_funding', { amount: 300000, model: 'soft_loan', terms: 'سداد على 5 سنوات' }), 'approve funding');
  d = await getApp(a, id);
  assert.equal(d.state, 'IMPLEMENTATION');
  assert.equal(d.milestones.length, 2);
  assert.deepEqual(d.milestones.map((m: any) => m.amount), [100000, 200000]);
  assert.ok(d.milestones.every((m: any) => m.status === 'planned'));
  assert.equal(d.referrals[0].status, 'approved');

  // 07 — صرف مرتبط بالتحقق: لا صرف قبل الإبلاغ والتحقق
  const [m1, m2] = d.milestones;
  const early = await w.funderA.post(`/applications/${id}/milestones/${m1.id}/disburse`, { reference: 'TRX-1' });
  assert.equal(early.status, 409, 'cannot disburse a planned milestone');
  const noEvidence = await a.upload(`/applications/${id}/milestones/${m1.id}/report`, { note: 'تم' }, null);
  assert.equal(noEvidence.status, 400, 'evidence PDF required');
  ok(await a.upload(`/applications/${id}/milestones/${m1.id}/report`, { note: 'تم تركيب الماكينة' }, pdfVariant('ev1')), 'report m1');
  const stillEarly = await w.funderA.post(`/applications/${id}/milestones/${m1.id}/disburse`, { reference: 'TRX-1' });
  assert.equal(stillEarly.status, 409, 'reported but not verified');
  ok(await w.imc.post(`/applications/${id}/milestones/${m1.id}/review`, { verified: true }), 'verify m1');
  ok(await w.funderA.post(`/applications/${id}/milestones/${m1.id}/disburse`, { reference: 'TRX-1' }), 'disburse m1');
  d = await getApp(a, id);
  assert.equal(d.milestones.find((m: any) => m.id === m1.id).status, 'disbursed');
  assert.equal(d.milestones.find((m: any) => m.id === m2.id).status, 'planned');

  // 07 -> 08 — بدء التشغيل وتقارير الأثر ثم الإنهاء
  ok(await act(w.imc, id, 'start_operation'), 'start operation');
  assert.equal((await getApp(a, id)).state, 'OPERATING');
  const rep = await a.post(`/applications/${id}/impact-reports`, {
    periodStart: addDays(todayIso(), -90), periodEnd: todayIso(), revenue: 250000, costs: 150000, production: '800 وحدة', directJobs: 6, indirectJobs: 9, issues: '',
  });
  assert.equal(rep.status, 201, JSON.stringify(rep.json));
  assert.equal((await getApp(a, id)).impactReports.length, 1);
  ok(await act(w.imc, id, 'complete'), 'complete');
  d = await getApp(w.imc, id);
  assert.equal(d.state, 'COMPLETED');
  assert.ok(d.closedAt);
  assert.deepEqual(d.allowedActions, []);

  // السجل التاريخي: كل انتقال موثق بترتيبه، والتدقيق يحتوي الأحداث
  const actions = d.transitions.map((t: any) => t.action);
  assert.deepEqual(actions, ['submit', 'accept', 'submit_study', 'accept', 'complete_evaluation', 'select', 'record_approval', 'refer_funder', 'approve_funding', 'start_operation', 'complete']);
  const audits = await q<{ action: string }>('SELECT action FROM audit_logs WHERE applicationId = ?', id);
  for (const a2 of ['application.submit', 'application.select', 'application.approve_funding', 'milestone.verify', 'milestone.disburse', 'impact.report']) {
    assert.ok(audits.some((r) => r.action === a2), `audit has ${a2}`);
  }
});

test('transitions are append-only history with webhook outbox rows per transition', async () => {
  const rows = await q<{ n: number }>("SELECT COUNT(*) AS n FROM sona3_application_transitions");
  const hooks = await q<{ n: number }>("SELECT COUNT(*) AS n FROM sona3_webhook_outbox WHERE eventType = 'application.state_changed'");
  assert.ok(rows[0].n >= 11);
  assert.equal(hooks[0].n, rows[0].n, 'one webhook event per transition');
});
