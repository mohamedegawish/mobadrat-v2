// المرحلتان 05 و06: الاختيار على مستوى الدورة (مستهدف الاختيار والاختيار خارج الترتيب)، الاعتماد، الإحالة لجهات التمويل، القبول والاعتذار.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, buildWorld, advanceTo, act, getApp, ok, q, pdfVariant, todayIso, scoresAll, type Started, type World,
} from './helpers.js';

const env = isolateTestEnv('selection');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv, { selectionTarget: 3 }); });
after(async () => { await srv.close(); await env.cleanup(); });

test('default policy targets: 500 evaluated / 300 selected / age 40 / minimums 50 on a freshly created cohort', async () => {
  const { makeCohort } = await import('./helpers.js');
  const c = await makeCohort({ opensAt: '2001-01-01', closesAt: '2001-02-01' });
  assert.equal(c.evaluationTarget, 500);
  assert.equal(c.selectionTarget, 300);
  assert.equal(c.maxAge, 40);
  assert.equal(c.ageReference, 'cohort_close');
  assert.deepEqual([c.minTotalScore, c.minFinancialScore, c.minTechnicalScore, c.minEvaluators], [50, 50, 50, 1]);
  assert.equal(Object.values(c.weights).reduce((s, x) => s + x, 0), 100);
});

test('ranking is ordered by score and out-of-rank selection requires a written reason', async () => {
  const low = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(60) });
  const mid = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(75) });
  const high = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(90) });

  const rank = (await w.imc.get(`/cohorts/${w.cohortId}/ranking`)).json.data;
  const ids = rank.items.map((x: any) => x.id);
  assert.deepEqual(ids.slice(0, 3), [high.id, mid.id, low.id]);
  assert.deepEqual(rank.items.slice(0, 3).map((x: any) => x.rank), [1, 2, 3]);
  assert.ok(rank.items.every((x: any) => x.passedMinimums === true));
  assert.equal(rank.selected, 0);

  const hint = (await getApp(w.imc, low.id)).selectHint;
  assert.equal(hint.outOfRank, true);
  assert.equal(hint.target, 3);
  assert.equal((await getApp(w.imc, high.id)).selectHint.outOfRank, false);

  // اختيار الأقل درجة أولًا بلا سبب => مرفوض؛ بسبب => ينجح ويُسجل أنه خارج الترتيب
  const noReason = await act(w.imc, low.id, 'select');
  assert.equal(noReason.status, 400);
  ok(await act(w.imc, low.id, 'select', { reason: 'تنوع قطاعي: المشروع الوحيد في الصناعات الغذائية' }), 'out-of-rank select');
  const t = (await getApp(w.imc, low.id)).transitions.find((x: any) => x.action === 'select');
  assert.match(t.reason, /تنوع قطاعي/);
  const stored = await q<{ payload: string }>("SELECT payload FROM sona3_application_transitions WHERE applicationId = ? AND action = 'select'", low.id);
  assert.equal(JSON.parse(stored[0].payload).outOfRank, true);

  // الأعلى درجة (ضمن الترتيب) لا يحتاج سببًا
  ok(await act(w.imc, high.id, 'select'), 'in-rank select');
  assert.equal((await getApp(high.applicant, high.id)).state, 'SELECTED');
  assert.equal((await w.imc.get(`/cohorts/${w.cohortId}/ranking`)).json.data.selected, 2);
  void mid;
});

test('selection target is a hard cap: the 4th selection in a cohort of 3 is refused, not_select still works', async () => {
  const third = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(99) });
  ok(await act(w.imc, third.id, 'select'), 'third selection');
  const fourth = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(98) });
  const r = await act(w.imc, fourth.id, 'select');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SELECTION_TARGET_REACHED');
  ok(await act(w.imc, fourth.id, 'not_select', { reason: 'اكتمل المستهدف' }), 'not select');
  assert.equal((await getApp(fourth.applicant, fourth.id)).state, 'NOT_SELECTED');
});

test('selection is IMC-only and only from EVALUATED; "selected" does not guarantee funding', async () => {
  const j = await advanceTo(srv, w, 'EVALUATED', { scores: scoresAll(70) });
  for (const c of [j.applicant, w.eval1, w.funderA, w.admin]) {
    const r = await act(c, j.id, 'select').catch(() => ({ status: 404 }));
    assert.ok([403, 404].includes(r.status), `non-IMC cannot select (${r.status})`);
  }
  const early = await advanceTo(srv, w, 'COMMITTEE_EVALUATION');
  assert.equal((await act(w.imc, early.id, 'select')).status, 409, 'not evaluated yet');
});

test('approval: needs date + reference + approval document; not-approved ends the file', async () => {
  const j = await advanceTo(srv, w, 'SELECTED', { scores: scoresAll(70) }).catch(async () => {
    // قد يكون مستهدف الاختيار اكتمل في هذه الدورة؛ ارفع المستهدف لهذا الاختبار
    const { updateCohort } = await import('../store/cohorts.js');
    await updateCohort(w.cohortId, { selectionTarget: 50 });
    return advanceTo(srv, w, 'SELECTED', { scores: scoresAll(70) });
  });
  const base = { approvalDate: todayIso(), approvalReference: 'قرار 2026/15' };
  assert.equal((await act(w.imc, j.id, 'record_approval', { approvalReference: 'x1' })).status, 400, 'date required');
  assert.equal((await act(w.imc, j.id, 'record_approval', { approvalDate: todayIso() })).status, 400, 'reference required');
  assert.equal((await act(w.imc, j.id, 'record_approval', base)).json.code, 'DOCUMENT_REQUIRED');
  // مستند الاعتماد: IMC فقط وفي SELECTED فقط
  assert.equal((await j.applicant.upload(`/applications/${j.id}/documents`, { kind: 'approvalFile' }, pdfVariant('a'))).status, 409);
  ok(await w.imc.upload(`/applications/${j.id}/documents`, { kind: 'approvalFile' }, pdfVariant('approval')), 'approval doc');
  ok(await act(w.imc, j.id, 'record_approval', { ...base, note: 'اعتماد وزير الصناعة' }), 'approve');
  const d = await getApp(j.applicant, j.id);
  assert.equal(d.state, 'FUNDING_SEARCH');
  assert.equal(d.data.approval.approvalReference, 'قرار 2026/15');

  const k = await advanceTo(srv, w, 'SELECTED', { scores: scoresAll(71) });
  assert.equal((await act(w.imc, k.id, 'record_not_approved', {})).status, 400, 'reason required');
  ok(await act(w.imc, k.id, 'record_not_approved', { reason: 'لم يحظَ بموافقة الوزير' }), 'not approved');
  assert.equal((await getApp(k.applicant, k.id)).state, 'NOT_APPROVED');
});

test('funding search: refer to an active funder with staff; decline returns to search; same funder cannot be re-referred; close unfunded', async () => {
  const j = await advanceTo(srv, w, 'FUNDING_SEARCH', { scores: scoresAll(72) });
  assert.equal((await act(w.imc, j.id, 'refer_funder', {})).status, 400, 'funder required');
  const bogus = await act(w.imc, j.id, 'refer_funder', { funderOrgId: 'org-nope' });
  assert.equal(bogus.status, 422);
  assert.equal(bogus.json.code, 'FUNDER_INVALID');
  // جهة بلا مستخدمين نشطين أو غير نشطة
  const { createOrganization, updateOrganization } = await import('../store/organizations.js');
  const empty = await createOrganization({ type: 'funder', nameAr: 'جهة بلا مستخدمين', nameEn: 'Empty funder' });
  assert.equal((await act(w.imc, j.id, 'refer_funder', { funderOrgId: empty.id })).json.code, 'FUNDER_INVALID');
  await updateOrganization(w.funderBOrg, { isActive: false });
  assert.equal((await act(w.imc, j.id, 'refer_funder', { funderOrgId: w.funderBOrg })).json.code, 'FUNDER_INVALID', 'inactive funder');
  await updateOrganization(w.funderBOrg, { isActive: true });

  ok(await act(w.imc, j.id, 'refer_funder', { funderOrgId: w.funderAOrg }), 'refer A');
  // جهة أخرى لا ترى الملف، والمحال إليها ترى الملف مع قناع الرقم القومي
  assert.equal((await w.funderB.get(`/applications/${j.id}`)).status, 404);
  const seen = await getApp(w.funderA, j.id);
  assert.match(seen.data.personal.nationalId, /^\d{2}•+\d{2}$/);
  assert.equal(seen.state, 'FUNDER_REVIEW');
  assert.equal(seen.funder.id, w.funderAOrg);

  // القرار: الاعتذار بسبب فقط، ثم يعود للبحث عن تمويل
  assert.equal((await act(w.funderA, j.id, 'decline_funding', {})).status, 400);
  ok(await act(w.funderA, j.id, 'decline_funding', { reason: 'خارج نطاق استثمارنا' }), 'decline');
  const after = await getApp(w.imc, j.id);
  assert.equal(after.state, 'FUNDING_SEARCH');
  assert.equal(after.funder, null);
  assert.equal(after.referrals.length, 1);
  assert.equal(after.referrals[0].status, 'declined');
  assert.equal((await w.funderA.get(`/applications/${j.id}`)).status, 200, 'history preserved: declining funder still sees its referral');
  const again = await act(w.imc, j.id, 'refer_funder', { funderOrgId: w.funderAOrg });
  assert.equal(again.status, 422);
  assert.equal(again.json.code, 'FUNDER_ALREADY_DECLINED');

  ok(await act(w.imc, j.id, 'refer_funder', { funderOrgId: w.funderBOrg }), 'refer B');
  assert.equal((await act(w.funderA, j.id, 'approve_funding', { amount: 300000, model: 'grant', terms: 'x' })).status, 403, 'A no longer owns the file');
  assert.equal((await getApp(w.imc, j.id)).referrals.length, 2, 'both referrals kept');

  // الجهة B تعتذر ويغلق IMC الملف لتعذر التمويل
  ok(await act(w.funderB, j.id, 'decline_funding', { reason: 'لا ميزانية' }), 'B declines');
  assert.equal((await act(w.imc, j.id, 'close_unfunded', {})).status, 400);
  ok(await act(w.imc, j.id, 'close_unfunded', { reason: 'لم تتوفر جهة تمويل' }), 'close');
  assert.equal((await getApp(j.applicant, j.id)).state, 'CLOSED_NOT_FUNDED');
});

test('approve funding: amount/model/terms required, milestones must add up to the amount, defaults come from the study plan', async () => {
  const j = await advanceTo(srv, w, 'FUNDER_REVIEW', { scores: scoresAll(73), planAmounts: [50000, 100000, 150000] });
  const f = w.funderA;
  assert.equal((await act(f, j.id, 'approve_funding', {})).status, 400);
  assert.equal((await act(f, j.id, 'approve_funding', { amount: -5, model: 'grant', terms: 'ok-terms' })).status, 400);
  assert.equal((await act(f, j.id, 'approve_funding', { amount: 300000, model: 'gift', terms: 'ok-terms' })).status, 400, 'unknown model');
  const mismatch = await act(f, j.id, 'approve_funding', { amount: 250000, model: 'blended', terms: 'ok-terms' });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.json.code, 'MILESTONES_MISMATCH');
  const customBad = await act(f, j.id, 'approve_funding', { amount: 300000, model: 'blended', terms: 'ok-terms', milestones: [{ title: 'واحدة', amount: 100 }] });
  assert.equal(customBad.json.code, 'MILESTONES_MISMATCH');
  const custom = ok(await act(f, j.id, 'approve_funding', {
    amount: 300000, model: 'blended', terms: 'شروط مخصصة',
    milestones: [{ title: 'التأسيس', dueDate: '2027-01-01', amount: 120000 }, { title: 'التشغيل', amount: 180000 }],
  }), 'approve with custom milestones');
  const d = custom.json.data;
  assert.equal(d.state, 'IMPLEMENTATION');
  assert.deepEqual(d.milestones.map((m: any) => [m.title, m.amount]), [['التأسيس', 120000], ['التشغيل', 180000]]);
  assert.equal(d.referrals[0].model, 'blended');
  assert.equal(d.referrals[0].amount, 300000);

  const k = await advanceTo(srv, w, 'IMPLEMENTATION', { scores: scoresAll(74), planAmounts: [50000, 100000, 150000] });
  const dk = await getApp(k.applicant, k.id);
  assert.deepEqual(dk.milestones.map((m: any) => m.amount), [50000, 100000, 150000], 'defaults from study plan');
  assert.deepEqual(dk.milestones.map((m: any) => m.seq), [1, 2, 3]);
});
