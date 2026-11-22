// The reports summary on MySQL with real history: the average time spent in each state is computed from the transitions
// (found by the load test: the query used SQLite's julianday() and every call answered 500 once a state had been left).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, buildWorld, advanceTo, ok, type Started, type World } from './helpers.js';

const env = isolateTestEnv('reports');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv); });
after(async () => { await srv.close(); await env.cleanup(); });

test('RP-1 the summary answers with the average days per state once applications have moved on', async () => {
  await advanceTo(srv, w, 'STUDY_REVIEW');
  await advanceTo(srv, w, 'STUDY_PREPARATION');
  for (const viewer of [w.imc, w.admin]) {
    const r = ok(await viewer.get('/reports/summary'), 'summary');
    const s = r.json.data;
    assert.ok(s.total >= 2);
    const eligibility = s.avgDaysPerState.ELIGIBILITY_REVIEW;
    assert.ok(eligibility, 'ELIGIBILITY_REVIEW was left by both applications');
    assert.equal(eligibility.samples, 2);
    assert.ok(eligibility.avgDays >= 0 && eligibility.avgDays < 1, `same-day decisions: ${eligibility.avgDays}`);
    assert.equal(s.avgDaysPerState.STUDY_PREPARATION.samples, 1, 'only one application left the study preparation');
    assert.equal(s.avgDaysPerState.STUDY_REVIEW, undefined, 'a state nobody has left has no average yet');
  }
});

test('RP-2 the summary of a cohort filter and of the applications report both answer', async () => {
  ok(await w.imc.get(`/reports/summary?cohortId=${encodeURIComponent(w.cohortId)}`), 'summary by cohort');
  ok(await w.imc.get('/reports/applications'), 'applications report');
});
