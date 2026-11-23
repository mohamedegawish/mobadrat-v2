// «بانتظاري» / «متأخر» lists (?mine=1 / ?overdue=1): filtered by the two flags first, full items built for the requested page
// only (found by the load test: every application in scope was built in full — ~3 queries each — before filtering, 5.7 s
// per IMC request with 900 applications). This checks the answer is exactly what the per-row code returned: the same rows,
// order and totals, page by page, for IMC, the evaluator and the applicant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, buildWorld, advanceTo, act, ok, newApplicant, createCompleteDraft, type Started, type World } from './helpers.js';

const env = isolateTestEnv('list-perf');
let srv: Started;
let w: World;
const ids = (r: { json: { data: { items: Array<{ id: string }> } } }) => r.json.data.items.map((i) => i.id);

before(async () => {
  srv = await startServer();
  w = await buildWorld(srv);
  // open applications waiting on IMC, on the applicant and on the evaluator, plus terminal ones (rejected, withdrawn)
  await advanceTo(srv, w, 'ELIGIBILITY_REVIEW');
  await advanceTo(srv, w, 'ELIGIBILITY_REVIEW');
  await advanceTo(srv, w, 'STUDY_PREPARATION');
  await advanceTo(srv, w, 'STUDY_REVIEW');
  await advanceTo(srv, w, 'COMMITTEE_EVALUATION');
  const rej = await advanceTo(srv, w, 'ELIGIBILITY_REVIEW');
  ok(await act(w.imc, rej.id, 'reject', { reason: 'لا تنطبق الشروط' }), 'reject');
  const wd = await advanceTo(srv, w, 'STUDY_PREPARATION');
  ok(await act(wd.applicant, wd.id, 'withdraw', { reason: 'تغير الخطة' }), 'withdraw');
  const a = await newApplicant(srv);
  await createCompleteDraft(a);
});
after(async () => { await srv.close(); await env.cleanup(); });

/** What the former code returned: every item in scope (oldest first, like ?mine=1), filtered on its own flags. */
async function expected(c: World['imc'], flag: 'isMine' | 'overdue') {
  const all = ok(await c.get('/applications?pageSize=100&sort=oldest'), 'all').json.data.items as Array<{ id: string; isMine: boolean; overdue: boolean }>;
  return all.filter((i) => i[flag]);
}

test('LP-1 ?mine=1 answers the same rows, order and totals as filtering every item, on every page', async () => {
  for (const viewer of [w.imc, w.eval1]) {
    const full = ok(await viewer.get('/applications?mine=1&pageSize=100'), 'mine').json.data;
    const base = ok(await viewer.get('/applications?pageSize=100'), 'all').json.data.items as Array<{ id: string; isMine: boolean }>;
    assert.deepEqual(new Set(full.items.map((i: { id: string }) => i.id)), new Set(base.filter((i) => i.isMine).map((i) => i.id)), 'same rows');
    assert.ok(full.items.every((i: { isMine: boolean }) => i.isMine));
    assert.equal(full.total, full.items.length);
    // page by page = the slices of the full answer
    const pages: string[] = [];
    for (let p = 1; p <= Math.ceil(full.total / 2); p++) {
      const r = ok(await viewer.get(`/applications?mine=1&pageSize=2&page=${p}`), `page ${p}`);
      assert.equal(r.json.data.total, full.total);
      assert.equal(r.json.data.totalPages, Math.max(1, Math.ceil(full.total / 2)));
      pages.push(...ids(r));
    }
    assert.deepEqual(pages, full.items.map((i: { id: string }) => i.id), 'pages join into the full list in order');
  }
  const imcMine = ok(await w.imc.get('/applications?mine=1&pageSize=100'), 'imc').json.data;
  assert.ok(imcMine.total >= 3, `IMC has decisions waiting (${imcMine.total})`);
});

test('LP-2 ?overdue=1 and an empty page beyond the end', async () => {
  const over = ok(await w.imc.get('/applications?overdue=1&pageSize=100'), 'overdue').json.data;
  assert.deepEqual(new Set(over.items.map((i: { id: string }) => i.id)), new Set((await expected(w.imc, 'overdue')).map((i) => i.id)));
  const far = ok(await w.imc.get('/applications?mine=1&page=999'), 'far').json.data;
  assert.deepEqual(far.items, []);
  assert.ok(far.total >= 3);
});

test('LP-3 the applicant: «بانتظاري» is the draft and the study to complete, not the application waiting on IMC', async () => {
  const a = await newApplicant(srv, 'متقدم القائمة');
  const draft = await createCompleteDraft(a);
  const mine = ok(await a.get('/applications?mine=1'), 'mine').json.data;
  assert.deepEqual(ids({ json: { data: mine } }), [draft]);
  ok(await act(a, draft, 'submit'), 'submit');
  assert.equal(ok(await a.get('/applications?mine=1'), 'mine').json.data.total, 0, 'waiting on IMC now');
});
