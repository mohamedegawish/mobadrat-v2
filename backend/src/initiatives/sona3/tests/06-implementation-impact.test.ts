// المرحلتان 07 و08: مراحل الصرف المرتبطة بالتحقق، الإرجاع والاستكمال، تقارير الأثر، علامة التعثر، إنهاء المتابعة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, buildWorld, advanceTo, act, getApp, ok, q, pdfVariant, todayIso, addDays, type Started, type World,
} from './helpers.js';

const env = isolateTestEnv('implementation');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv, { selectionTarget: 50 }); });
after(async () => { await srv.close(); await env.cleanup(); });

const report = (j: { applicant: any; id: string }, mid: string, note = 'تم الإنجاز', tag = 'ev') =>
  j.applicant.upload(`/applications/${j.id}/milestones/${mid}/report`, { note }, pdfVariant(tag));

test('milestone lifecycle: planned -> reported (evidence) -> returned -> reported -> verified -> disbursed; money moves only after verification', async () => {
  const j = await advanceTo(srv, w, 'IMPLEMENTATION');
  const [m1, m2] = (await getApp(j.applicant, j.id)).milestones;

  // الأدوار: المتقدم يبلغ، IMC يتحقق، جهة التمويل تصرف
  assert.equal((await w.imc.post(`/applications/${j.id}/milestones/${m1.id}/review`, { verified: true })).status, 409, 'nothing reported yet');
  assert.equal((await w.funderA.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, { reference: 'TRX-9' })).status, 409);
  assert.equal((await report({ applicant: w.imc, id: j.id }, m1.id)).status, 403, 'IMC cannot report');

  // الإبلاغ: دليل PDF إجباري وملاحظة
  assert.equal((await j.applicant.upload(`/applications/${j.id}/milestones/${m1.id}/report`, { note: 'x' }, pdfVariant('e'))).status, 400, 'note too short');
  ok(await report(j, m1.id, 'تم تركيب المعدات', 'ev1'), 'report m1');
  assert.equal((await report(j, m1.id)).status, 409, 'already reported');
  let d = await getApp(w.funderA, j.id);
  assert.equal(d.milestones.find((m: any) => m.id === m1.id).status, 'reported');

  // الإرجاع يتطلب سببًا؛ بعده يعيد المتقدم الإبلاغ بدليل جديد
  assert.equal((await w.imc.post(`/applications/${j.id}/milestones/${m1.id}/review`, { verified: false })).status, 400);
  ok(await w.imc.post(`/applications/${j.id}/milestones/${m1.id}/review`, { verified: false, note: 'الدليل غير مقروء' }), 'return');
  d = await getApp(j.applicant, j.id);
  assert.equal(d.milestones.find((m: any) => m.id === m1.id).status, 'returned');
  assert.equal((await w.funderA.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, { reference: 'TRX-9' })).status, 409, 'returned is not payable');
  ok(await report(j, m1.id, 'دليل أوضح', 'ev1-b'), 're-report');

  // الصرف: جهة المشروع فقط، بعد التحقق، بمرجع
  ok(await w.imc.post(`/applications/${j.id}/milestones/${m1.id}/review`, { verified: true }), 'verify');
  assert.equal((await w.funderB.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, { reference: 'TRX-9' })).status, 404, 'other funder cannot even see it');
  assert.equal((await w.imc.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, { reference: 'TRX-9' })).status, 403, 'IMC does not disburse');
  assert.equal((await j.applicant.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, { reference: 'TRX-9' })).status, 403);
  assert.equal((await w.funderA.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, {})).status, 400, 'reference required');
  ok(await w.funderA.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, { reference: 'TRX-9' }), 'disburse');
  assert.equal((await w.funderA.post(`/applications/${j.id}/milestones/${m1.id}/disburse`, { reference: 'TRX-10' })).status, 409, 'not twice');

  d = await getApp(w.imc, j.id);
  const states = Object.fromEntries(d.milestones.map((x: any) => [x.id, x.status]));
  assert.equal(states[m1.id], 'disbursed');
  assert.equal(states[m2.id], 'planned', 'other milestone untouched');
  const audits = (await q<{ action: string }>('SELECT action FROM audit_logs WHERE applicationId = ?', j.id)).map((x) => x.action);
  for (const a of ['milestone.report', 'milestone.return', 'milestone.verify', 'milestone.disburse']) assert.ok(audits.includes(a), a);
  // الإشعارات: التحقق ينبّه جهة التمويل، والصرف ينبّه المتقدم
  const tpl = (await q<{ templateKey: string }>('SELECT templateKey FROM notification_outbox WHERE applicationId = ?', j.id)).map((x) => x.templateKey);
  for (const t of ['app.milestone_reported', 'app.milestone_reviewed', 'app.milestone_verified', 'app.milestone_disbursed']) assert.ok(tpl.includes(t), t);
});

test('milestones are only reportable during implementation and only by the owning applicant', async () => {
  const j = await advanceTo(srv, w, 'IMPLEMENTATION');
  const other = await advanceTo(srv, w, 'IMPLEMENTATION');
  const m = (await getApp(j.applicant, j.id)).milestones[0];
  assert.equal((await report({ applicant: other.applicant, id: j.id }, m.id)).status, 404, 'another applicant cannot see it');
  assert.equal((await w.eval1.post(`/applications/${j.id}/milestones/${m.id}/review`, { verified: true })).status, 403);
  const pre = await advanceTo(srv, w, 'FUNDER_REVIEW');
  assert.equal((await w.imc.post(`/applications/${pre.id}/milestones/ghost/review`, { verified: true })).status, 404);
});

test('impact reports: OPERATING only, validated, owner only; stalled flag needs a remediation plan', async () => {
  const j = await advanceTo(srv, w, 'IMPLEMENTATION');
  const body = { periodStart: addDays(todayIso(), -30), periodEnd: todayIso(), revenue: 100000, costs: 60000, production: '300 وحدة', directJobs: 5, indirectJobs: 8, issues: '' };
  assert.equal((await j.applicant.post(`/applications/${j.id}/impact-reports`, body)).status, 409, 'not operating yet');

  // علامة التعثر: أثناء التنفيذ أو التشغيل فقط، وبخطة معالجة
  assert.equal((await w.imc.post(`/applications/${j.id}/stalled`, { stalled: true })).status, 400, 'plan required');
  assert.equal((await j.applicant.post(`/applications/${j.id}/stalled`, { stalled: true, note: 'خطة' })).status, 403);
  ok(await w.imc.post(`/applications/${j.id}/stalled`, { stalled: true, note: 'تأخر التوريد — خطة: بديل محلي خلال شهر' }), 'stalled');
  let d = await getApp(w.imc, j.id);
  assert.equal(d.isStalled, true);
  assert.match(d.stalledNote, /بديل محلي/);
  ok(await w.imc.post(`/applications/${j.id}/stalled`, { stalled: false }), 'recovered');
  assert.equal((await getApp(w.imc, j.id)).isStalled, false);
  const early = await advanceTo(srv, w, 'FUNDING_SEARCH');
  assert.equal((await w.imc.post(`/applications/${early.id}/stalled`, { stalled: true, note: 'خطة معالجة' })).status, 409);

  ok(await act(w.imc, j.id, 'start_operation'), 'start operation');
  const bad: Array<Record<string, unknown>> = [
    { ...body, revenue: -1 }, { ...body, directJobs: 2.5 }, { ...body, periodEnd: addDays(todayIso(), -60) },
    { ...body, periodStart: 'yesterday' }, { ...body, extra: 1 },
  ];
  for (const b of bad) assert.equal((await j.applicant.post(`/applications/${j.id}/impact-reports`, b)).status, 400, JSON.stringify(b));
  assert.equal((await w.imc.post(`/applications/${j.id}/impact-reports`, body)).status, 403, 'only applicant reports');
  ok(await j.applicant.post(`/applications/${j.id}/impact-reports`, body), 'report 1');
  ok(await j.applicant.post(`/applications/${j.id}/impact-reports`, { ...body, periodStart: addDays(todayIso(), 1), periodEnd: addDays(todayIso(), 30), revenue: 120000 }), 'report 2');

  d = await getApp(w.funderA, j.id);
  assert.equal(d.impactReports.length, 2, 'referred funder sees impact reports');
  const stalledOp = await w.imc.post(`/applications/${j.id}/stalled`, { stalled: true, note: 'انخفاض الطلب — خطة تسويق' });
  assert.equal(stalledOp.status, 200, 'stalled flag also allowed while operating');

  // الإنهاء: IMC فقط، ثم حالة نهائية
  assert.equal((await act(j.applicant, j.id, 'complete')).status, 403);
  ok(await act(w.imc, j.id, 'complete'), 'complete');
  assert.equal((await getApp(j.applicant, j.id)).state, 'COMPLETED');
  assert.equal((await j.applicant.post(`/applications/${j.id}/impact-reports`, body)).status, 409, 'no reports after completion');
});

test('start_operation is IMC-only and only from IMPLEMENTATION', async () => {
  const j = await advanceTo(srv, w, 'IMPLEMENTATION');
  for (const c of [j.applicant, w.funderA]) {
    const r = await act(c, j.id, 'start_operation');
    assert.equal(r.status, 403);
  }
  const early = await advanceTo(srv, w, 'FUNDER_REVIEW');
  assert.equal((await act(w.imc, early.id, 'start_operation')).status, 409);
});
