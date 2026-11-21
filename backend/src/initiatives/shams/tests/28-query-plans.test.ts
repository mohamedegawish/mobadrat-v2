// Production-readiness PR-P2: reviewer list scopes and hasEnteredState must not degrade quadratically with the number of
// applications. Production never runs ANALYZE, and without statistics SQLite planned the correlated EXISTS through
// idx_transitions_to (all rows of that state, for each application). Synthetic data only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv } from './helpers.js';

const env = isolateTestEnv('qplan');
const N = 2000;
const OLD_IMC = "EXISTS (SELECT 1 FROM application_transitions t WHERE t.applicationId = a.id AND t.toState = 'IMC_REVIEW' AND t.fromState <> t.toState)";

before(async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  const db = getDb();
  await db.exec('PRAGMA foreign_keys = OFF');
  const now = '2026-10-01T00:00:00.000Z';
  await db.exec('BEGIN');
  const org = db.prepare("INSERT INTO organizations (id, type, nameAr, nameEn, contactEmail, isActive, createdAt, updatedAt) VALUES (?, 'factory', 'x', 'x', '', 1, ?, ?)");
  const fac = db.prepare('INSERT INTO factories (id, organizationId, companyName, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
  const app = db.prepare("INSERT INTO applications (id, factoryId, state, version, attempt, stateEnteredAt, createdAt, updatedAt, createdBy) VALUES (?, ?, ?, 2, 1, ?, ?, ?, 'u')");
  const tr = db.prepare("INSERT INTO application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, createdAt) VALUES (?, ?, ?, ?, 'submit', 'factory_owner', 1, ?)");
  for (let i = 0; i < N; i++) {
    await org.run(`o${i}`, now, now); await fac.run(`f${i}`, `o${i}`, 'x', now, now);
    // mix: 0 → never submitted; 1 → only a registry re-check (IMC_REVIEW → IMC_REVIEW, does not count); 2,3 → entered IMC (and ENCPC for 3)
    const kind = i % 4;
    await app.run(`a${i}`, `f${i}`, kind === 0 ? 'DRAFT' : kind === 3 ? 'ENCPC_REVIEW' : 'IMC_REVIEW', `2026-10-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`, now, now);
    if (kind === 1) await tr.run(`t${i}a`, `a${i}`, 'IMC_REVIEW', 'IMC_REVIEW', now);
    if (kind >= 2) await tr.run(`t${i}b`, `a${i}`, 'DRAFT', 'IMC_REVIEW', now);
    if (kind === 3) await tr.run(`t${i}c`, `a${i}`, 'IMC_REVIEW', 'ENCPC_REVIEW', now);
  }
  await db.exec('COMMIT');
  await db.exec('PRAGMA foreign_keys = ON');
});
after(async () => { await env.cleanup(); });

test('PR-P2 the IMC and ENCPC scopes select exactly the same applications as the old correlated EXISTS', async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  const { listScope } = await import('../src/access/visibility.js');
  const ids = async (where: string) => (await getDb().prepare(`SELECT a.id FROM applications a JOIN factories f ON f.id = a.factoryId WHERE ${where} ORDER BY a.id`).all() as Array<{ id: string }>).map((r) => r.id);
  const imc = listScope({ role: 'imc_reviewer', organizationId: 'org-imc' } as never).sql;
  const encpc = listScope({ role: 'encpc_reviewer', organizationId: 'org-encpc' } as never).sql;
  assert.deepEqual(await ids(imc), await ids(OLD_IMC));
  assert.deepEqual(await ids(encpc), await ids(OLD_IMC.replace("'IMC_REVIEW'", "'ENCPC_REVIEW'")));
  assert.equal((await ids(imc)).length, N / 2, 'only applications that really entered IMC review (not drafts, not self-transitions)');
});

test('PR-P2 query plans avoid the per-application scan of idx_transitions_to, and the work list stays fast at 2,000 applications', async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  const { listScope } = await import('../src/access/visibility.js');
  const { listApplications, hasEnteredState } = await import('../src/store/applications.js');
  const plan = async (sql: string, ...p: Array<string | number>) => (await getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p) as Array<{ detail: string }>).map((r) => r.detail);
  const imc = listScope({ role: 'imc_reviewer', organizationId: 'org-imc' } as never);
  const listPlan = await plan(`SELECT a.id FROM applications a JOIN factories f ON f.id = a.factoryId WHERE ${imc.sql} AND a.state <> 'DRAFT' ORDER BY a.stateEnteredAt DESC LIMIT 20`);
  assert.ok(!listPlan.some((d) => /EXISTS USING INDEX idx_transitions_to/.test(d)), listPlan.join(' | '));
  const oldPlan = await plan(`SELECT a.id FROM applications a JOIN factories f ON f.id = a.factoryId WHERE ${OLD_IMC} AND a.state <> 'DRAFT' ORDER BY a.stateEnteredAt DESC LIMIT 20`);
  console.log(`[PR-P2] old plan: ${oldPlan.join(' | ')}\n[PR-P2] new plan: ${listPlan.join(' | ')}`);
  const hePlan = await plan("SELECT 1 FROM application_transitions WHERE applicationId = ? AND +toState = ? AND fromState <> toState LIMIT 1", 'a1', 'IMC_REVIEW');
  assert.ok(hePlan.some((d) => /idx_transitions_app/.test(d)), hePlan.join(' | '));

  const time = (fn: () => unknown, n = 10) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };
  const tNew = time(async () => await listApplications({ scopeSql: imc.sql, scopeParams: [], includeDrafts: false }, 1, 20));
  const tOld = time(async () => await listApplications({ scopeSql: OLD_IMC, scopeParams: [], includeDrafts: false }, 1, 20), 3);
  const tHe = time(async () => await hasEnteredState('a2', 'IMC_REVIEW'), 200);
  console.log(`[PR-P2] IMC work list at ${N} applications: old ${tOld.toFixed(1)} ms, new ${tNew.toFixed(1)} ms; hasEnteredState ${tHe.toFixed(3)} ms`);
  assert.ok(tNew < 40, `work list took ${tNew.toFixed(1)} ms`);
  assert.ok(tHe < 1, `hasEnteredState took ${tHe.toFixed(3)} ms`);
  assert.equal(await hasEnteredState('a2', 'IMC_REVIEW'), true);
  assert.equal(await hasEnteredState('a1', 'IMC_REVIEW'), false, 'a self-transition is not an entry');
  assert.equal(await hasEnteredState('a0', 'IMC_REVIEW'), false);
});
