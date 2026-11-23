// 2026-11-06 performance audit (docs/performance/PERFORMANCE_ISSUES_AUDIT.md) — regression tests for its fixes.
//   PA-04  the dashboard, the reports summary, ?mine=1 / ?overdue=1 and the stuck-application check no longer load the
//          terminal history (about 80 % of the applications in production-like data); the numbers stay identical.
//   PA-02  the login throttle holds under concurrency: a burst of wrong passwords gets at most `freeFailures` answers.
//   PA-03  password hashing (register / reset / change) runs off the event loop and outside the write transaction.
//   PA-05  the opt-in outbox retention deletes only finished messages older than the cutoff.
// Runs on SQLite (npm test) and MySQL 8.4 (npm run test:mysql).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, q, Client, DEV, registerFactory, registrationPayload, type Started } from './helpers.js';

const env = isolateTestEnv('perf-audit');
process.env.BCRYPT_ROUNDS = '10'; // production cost: the hashing / throttle windows are real (helpers default to 4)
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-PA-${++seq}`;

before(async () => {
  srv = await startServer();
  c = await clients(srv.base);
  // open applications in several stages + one terminal one through the real workflow
  await advanceTo('IMC_REVIEW', { factory: c.factory, imc: c.imc, encpc: c.encpc, pmu: c.pmu }, reg());
  const w = await advanceTo('IMC_REVIEW', { factory: c.factory2, imc: c.imc, encpc: c.encpc, pmu: c.pmu }, reg());
  assert.equal((await act(c.factory2, w, 'withdraw', { reason: 'انسحاب' })).status, 200);
  await advanceTo('BANK_SELECTION', { factory: c.factory2, imc: c.imc, encpc: c.encpc, pmu: c.pmu }, reg());
});
after(async () => { await srv.close(); await env.cleanup(); });

/** Counts statements and returned rows while `fn` runs (the server runs in this process). */
async function measure<T>(fn: () => Promise<T>): Promise<{ out: T; queries: number; rows: number }> {
  const { getDb } = await import('../db/database.js');
  const db = getDb() as unknown as Record<string, unknown> & { prepare: (sql: string) => Record<string, unknown> };
  const own = Object.prototype.hasOwnProperty.call(db, 'prepare');
  const real = db.prepare;
  let queries = 0; let rows = 0;
  db.prepare = function (this: unknown, sql: string) {
    const st = real.call(db, sql) as Record<string, (...a: unknown[]) => unknown>;
    return new Proxy(st, {
      get(t, k) {
        const v = t[k as string];
        if (typeof v !== 'function') return v;
        if (k === 'all' || k === 'get' || k === 'run') {
          return async (...a: unknown[]) => {
            queries++;
            const r = await v.apply(t, a);
            if (k === 'all') rows += (r as unknown[]).length; else if (k === 'get' && r) rows++;
            return r;
          };
        }
        return v.bind(t);
      },
    });
  };
  try { return { out: await fn(), queries, rows }; } finally { if (own) db.prepare = real; else delete (db as Record<string, unknown>).prepare; }
}

/** N terminal (rejected) applications that the IMC, PMU and admin scopes all contain — history, as in production data. */
async function addTerminalHistory(n: number) {
  const [{ fid }] = await q<{ fid: string }>(`SELECT f.id AS fid FROM shams_factories f JOIN initiative_memberships m ON m.organizationId = f.organizationId AND m.initiativeId = 'shams' JOIN users u ON u.id = m.userId WHERE u.email = ?`, DEV.factory);
  const t = '2025-01-01T00:00:00.000Z';
  for (let i = 0; i < n; i++) {
    const id = `app-hist-${seq}-${i}`;
    await q(`INSERT INTO shams_applications (id, number, factoryId, state, version, attempt, companyName, governorate, industrialZone, submittedAt, stateEnteredAt, closedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, 'REJECTED', 3, 1, ?, 'cairo', 'z', ?, ?, ?, ?, ?)`, id, `SHAMS-H-${seq}-${i}`, fid, `مصنع تاريخي ${i}`, t, t, t, t, t);
    await q(`INSERT INTO shams_application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, createdAt) VALUES (?, ?, 'DRAFT', 'IMC_REVIEW', 'submit', 'factory_owner', 0, ?)`, `tr-h1-${seq}-${i}`, id, t);
    await q(`INSERT INTO shams_application_transitions (id, applicationId, fromState, toState, action, actorRole, attempt, createdAt) VALUES (?, ?, 'IMC_REVIEW', 'REJECTED', 'reject', 'imc_reviewer', 1, ?)`, `tr-h2-${seq}-${i}`, id, t);
  }
  seq++;
}

type Reader = { get: (p: string) => Promise<{ status: number; json: any }> };
const data = async (cl: Reader, path: string) => { const r = await cl.get(path); assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.json).slice(0, 200)}`); return r.json.data; };
async function fullList(cl: Reader, query = '') {
  const items: any[] = [];
  for (let page = 1; ; page++) {
    const d = await data(cl, `/applications?pageSize=100&page=${page}${query}`);
    items.push(...d.items);
    if (page >= d.totalPages) return items;
  }
}

test('PA-04: terminal history no longer feeds the aggregate pages (rows loaded stay flat), and the counts include it', async () => {
  const views: Array<[string, Reader, string]> = [
    ['imc dashboard', c.imc, '/dashboard'], ['encpc dashboard', c.encpc, '/dashboard'], ['pmu dashboard', c.pmu, '/dashboard'],
    ['pmu summary', c.pmu, '/reports/summary'], ['imc summary', c.imc, '/reports/summary'],
    ['imc mine', c.imc, '/applications?mine=1'], ['pmu mine', c.pmu, '/applications?mine=1'], ['pmu overdue', c.pmu, '/applications?overdue=1'],
  ];
  const before = new Map<string, { queries: number; rows: number; out: any }>();
  for (const [k, cl, p] of views) before.set(k, await measure(() => data(cl, p)));
  const exportBefore = await measure(() => data(c.pmu, '/reports/applications'));

  const N = 300;
  await addTerminalHistory(N);

  for (const [k, cl, p] of views) {
    const a = await measure(() => data(cl, p));
    const b = before.get(k)!;
    assert.equal(a.queries, b.queries, `${k}: statement count independent of the history size (${b.queries} → ${a.queries})`);
    assert.ok(a.rows - b.rows < N / 2, `${k}: ${N} terminal applications must not be loaded (rows read ${b.rows} → ${a.rows})`);
  }
  // the counts still include the history
  assert.equal((await data(c.imc, '/dashboard')).total, before.get('imc dashboard')!.out.total + N);
  assert.equal((await data(c.pmu, '/dashboard')).total, before.get('pmu dashboard')!.out.total + N);
  const sum = await data(c.pmu, '/reports/summary');
  assert.equal(sum.total, before.get('pmu summary')!.out.total + N);
  assert.equal(sum.byState.REJECTED, before.get('pmu summary')!.out.byState.REJECTED + N);
  // the export is batched: a constant number of statements for N more rows (PERF-3), every row present
  const exportAfter = await measure(() => data(c.pmu, '/reports/applications'));
  assert.equal(exportAfter.out.items.length, exportBefore.out.items.length + N);
  assert.equal(exportAfter.queries, exportBefore.queries, `export statements ${exportBefore.queries} → ${exportAfter.queries}`);
});

test('PA-04: dashboard, mine / overdue lists, summary and stuck check equal the full-list computation (with SLA on)', async () => {
  const { shamsPolicy } = await import('../config/shamsPolicy.js');
  const saved = { ...shamsPolicy.slaDays };
  shamsPolicy.slaDays.IMC_REVIEW = 1; // make "overdue" non-trivial: one IMC_REVIEW application entered 10 days ago
  const [open] = await q<{ id: string }>("SELECT id FROM shams_applications WHERE state = 'IMC_REVIEW' ORDER BY id LIMIT 1");
  await q('UPDATE shams_applications SET stateEnteredAt = ? WHERE id = ?', new Date(Date.now() - 10 * 86_400_000).toISOString(), open.id);
  try {
    for (const [role, cl] of [['imc', c.imc], ['encpc', c.encpc], ['pmu', c.pmu]] as const) {
      const all = await fullList(cl);
      const dash = await data(cl, '/dashboard');
      assert.equal(dash.total, all.length, `${role}: total`);
      assert.equal(dash.awaitingMe.count, all.filter((i) => i.isMine).length, `${role}: awaiting me`);
      const overdue = all.filter((i) => i.overdue).length;
      assert.equal(dash.attention.find((a: any) => a.key === 'overdue')?.count ?? 0, overdue, `${role}: overdue`);
      if (role === 'imc') assert.ok(overdue >= 1, 'the SLA case is exercised');
      const count = (...s: string[]) => all.filter((i) => s.includes(i.state)).length;
      for (const card of dash.cards as Array<{ key: string; count: number; link: { param: string } | null }>) {
        if (card.link && /^[A-Z_-]+$/.test(card.link.param)) assert.equal(card.count, count(...card.link.param.split('-')), `${role}: card ${card.key}`);
      }
      if (role === 'pmu') {
        for (const s of dash.byStage) assert.equal(s.count, count(s.state), `pmu: byStage ${s.state}`);
        assert.equal(dash.cards.find((x: any) => x.key === 'bank-choice').count, all.filter((i) => i.state === 'CONTRACT_OUTCOME' && !i.bank).length);
        assert.equal(dash.cards.find((x: any) => x.key === 'outcome').count, all.filter((i) => i.state === 'CONTRACT_OUTCOME' && i.bank).length);
      }
      // ?mine=1 / ?overdue=1, with and without a state filter that mixes terminal and open states
      const oldest = await fullList(cl, '&sort=oldest');
      const mine = await data(cl, '/applications?mine=1&pageSize=100');
      assert.deepEqual(mine.items, oldest.filter((i) => i.isMine), `${role}: mine=1`);
      assert.equal(mine.total, oldest.filter((i) => i.isMine).length);
      const mixed = await data(cl, '/applications?mine=1&state=IMC_REVIEW,REJECTED,WITHDRAWN&pageSize=100');
      assert.deepEqual(mixed.items, oldest.filter((i) => i.isMine && ['IMC_REVIEW', 'REJECTED', 'WITHDRAWN'].includes(i.state)), `${role}: mine=1 + mixed states`);
      const onlyTerminal = await data(cl, '/applications?mine=1&state=REJECTED&pageSize=100');
      assert.deepEqual([onlyTerminal.items, onlyTerminal.total], [[], 0], `${role}: mine=1 on terminal states only`);
      const od = await data(cl, '/applications?overdue=1&pageSize=100');
      assert.deepEqual(od.items, all.filter((i) => i.overdue), `${role}: overdue=1`);
    }
    // summary open / overdue against every row of the PMU scope
    const { listApplications } = await import('../store/applications.js');
    const { slaInfo } = await import('../workflow/applicationView.js');
    const { isTerminal, NON_TERMINAL_STATES } = await import('../workflow/shamsWorkflow.js');
    const rows = (await listApplications({ scopeSql: '1 = 1', scopeParams: [], includeDrafts: true }, 1, 1, true)).rows;
    const sum = await data(c.pmu, '/reports/summary');
    assert.equal(sum.open, rows.filter((a) => !isTerminal(a.state) && a.state !== 'DRAFT').length);
    assert.equal(sum.overdue, rows.filter((a) => slaInfo(a).overdue).length);
    assert.ok(sum.overdue >= 1);
    // stuckApplications now reads the non-terminal rows in SQL: the same rows in the same order as the former JS filter
    const former = (await listApplications({ scopeSql: '1 = 1', scopeParams: [] }, 1, 1, true)).rows.filter((a) => !isTerminal(a.state)).map((a) => a.id);
    const now = (await listApplications({ scopeSql: '1 = 1', scopeParams: [], states: [...NON_TERMINAL_STATES] }, 1, 1, true)).rows.map((a) => a.id);
    assert.deepEqual(now, former);
  } finally {
    Object.assign(shamsPolicy.slaDays, saved);
  }
});

test('PA-02: a burst of wrong passwords for one (email, IP) gets at most freeFailures answers; concurrent correct logins are not penalised', async () => {
  const { shamsPolicy } = await import('../config/shamsPolicy.js');
  const free = shamsPolicy.loginThrottle.freeFailures;
  const N = 10;
  const rs = await Promise.all(Array.from({ length: N }, () => new Client(srv.base).post('/auth/login', { email: DEV.imc2, password: 'Wrong-password-9' })));
  const st = rs.map((r) => r.status);
  assert.ok(st.every((s) => s === 401 || s === 429), `401/429 only: ${st.join(',')}`);
  const answered = st.filter((s) => s === 401).length;
  assert.ok(answered >= 1 && answered <= free, `at most ${free} password answers in a burst of ${N} (got ${answered}: ${st.join(',')})`);
  assert.ok(rs.filter((r) => r.status === 429).every((r) => r.json.code === 'LOGIN_THROTTLED' && Number(r.headers.get('retry-after')) >= 1));
  const throttleRows = await q<{ failures: number }>('SELECT failures FROM login_throttle');
  assert.equal(throttleRows.length, 1, 'one throttle row for this (email, IP)');
  assert.equal(Number(throttleRows[0].failures), answered, 'exactly the answered attempts are counted');
  const [u] = await q<{ n: number }>('SELECT failedLoginCount AS n FROM users WHERE email = ?', DEV.imc2);
  assert.equal(Number(u.n), answered, 'the account counter matches (throttled attempts touch nothing)');

  // two failures (still free), then 6 correct logins at once: all succeed and the throttle row is gone
  for (let i = 0; i < free - 1; i++) assert.equal((await new Client(srv.base).post('/auth/login', { email: DEV.encpc, password: 'Wrong-password-8' })).status, 401);
  const ok = await Promise.all(Array.from({ length: 6 }, () => new Client(srv.base).post('/auth/login', { email: DEV.encpc, password: 'Shams@2026' })));
  assert.deepEqual(ok.map((r) => r.status), Array(6).fill(200));
  assert.equal((await q('SELECT failures FROM login_throttle')).length, 1, "the correct login cleared this key's row (only the burst's row is left)");
});

test('PA-03: a burst of registrations hashes passwords off the event loop; reset and change still set a working password', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  const health: number[] = [];
  let done = false;
  const probe = (async () => {
    while (!done) { const t0 = performance.now(); await fetch(`${srv.origin}/health`); health.push(performance.now() - t0); await new Promise((r) => setTimeout(r, 10)); }
  })();
  const N = 16; // ~100 ms of bcrypt each: on the event loop (before PA-03) that is ~1.6 s during which nothing else is served
  // التسجيل يحمل نموذج التسجيل كاملًا ومستنداته (multipart) — نفس التجزئة خارج حلقة الأحداث.
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => registerFactory(new Client(srv.base), registrationPayload(`burst${i}@pa.test`, `IND-BURST-${i}`, {
    companyName: `مصنع دفعة ${i}`, contactName: 'مالك', mobile: `010123${String(10000 + i)}`, password: `BurstPass${i}x`,
  }))));
  done = true; await probe;
  assert.deepEqual(rs.map((r) => r.status), Array(N).fill(201), JSON.stringify(rs.map((r) => r.json?.code)));
  const worst = Math.max(...health);
  console.log(`[PA-03] ${N} registrations at 10 rounds: /health answered ${health.length} times, worst ${worst.toFixed(0)} ms`);
  assert.ok(health.length >= 3, 'health was probed during the burst');
  assert.ok(worst < 400, `an unrelated request waited ${worst.toFixed(0)} ms behind password hashing`);
  const stored = await q<{ email: string; passwordHash: string }>("SELECT email, passwordHash FROM users WHERE email LIKE 'burst%@pa.test' ORDER BY email");
  assert.equal(stored.length, N);
  for (const s of stored) {
    const i = Number(/burst(\d+)@/.exec(s.email)![1]);
    assert.equal(bcrypt.getRounds(s.passwordHash), 10);
    assert.ok(bcrypt.compareSync(`BurstPass${i}x`, s.passwordHash), `${s.email}: stored hash matches the password`);
  }

  // reset-password with a valid link → the new password logs in; a malformed link is refused as before
  const { sha256 } = await import('../auth/jwt.js');
  const token = 'b2'.repeat(32);
  await q('UPDATE users SET passwordResetTokenHash = ?, passwordResetExpiresAt = ?, emailVerifiedAt = ? WHERE email = ?',
    sha256(token), new Date(Date.now() + 3_600_000).toISOString(), new Date().toISOString(), 'burst0@pa.test');
  assert.equal((await new Client(srv.base).post('/auth/reset-password', { token, newPassword: 'ResetPass-77a' })).status, 200);
  assert.equal((await new Client(srv.base).post('/auth/reset-password', { token: 'not-a-token', newPassword: 'ResetPass-77a' })).json.code, 'TOKEN_INVALID');
  const u = await new Client(srv.base).login('burst0@pa.test', 'ResetPass-77a');
  assert.ok(u.token);
  // change-password → the new one works, the old one does not
  assert.equal((await u.post('/auth/change-password', { currentPassword: 'ResetPass-77a', newPassword: 'ChangedPass-88b' })).status, 200);
  assert.equal((await new Client(srv.base).post('/auth/login', { email: 'burst0@pa.test', password: 'ChangedPass-88b' })).status, 200);
  assert.equal((await new Client(srv.base).post('/auth/login', { email: 'burst0@pa.test', password: 'ResetPass-77a' })).status, 401);
});

test('PA-05: outbox retention is off by default and deletes only finished messages older than the cutoff, in batches', async () => {
  const { config } = await import('../config.js');
  const { purgeOutbox } = await import('../../../core/jobs/outboxRetention.js');
  delete process.env.NOTIFICATION_OUTBOX_RETENTION_DAYS;
  assert.equal(config.outboxRetentionDays, 0, 'disabled unless configured');
  assert.equal(await purgeOutbox(config.outboxRetentionDays), 0);

  const now = Date.now();
  const old = new Date(now - 100 * 86_400_000).toISOString();
  const recent = new Date(now - 86_400_000).toISOString();
  const rows: Array<[string, string, string]> = [];
  for (const status of ['sent', 'skipped', 'failed']) for (let i = 0; i < 3; i++) rows.push([`ob-old-${status}-${i}`, status, old]);
  for (const status of ['pending', 'sending']) rows.push([`ob-old-${status}`, status, old]);
  for (const status of ['sent', 'skipped', 'failed', 'pending']) rows.push([`ob-new-${status}`, status, recent]);
  for (const [id, status, at] of rows) {
    await q(`INSERT INTO notification_outbox (id, dedupeKey, channel, templateKey, recipientAddress, status, nextAttemptAt, createdAt)
      VALUES (?, ?, 'email', 'test.retention', 'x@pa.test', ?, ?, ?)`, id, `retention:${id}`, status, at, at);
  }
  const deleted = await purgeOutbox(30, now, 2); // batch of 2 → several batches
  assert.equal(deleted, 9, 'the 9 old finished messages');
  const left = (await q<{ id: string }>("SELECT id FROM notification_outbox WHERE templateKey = 'test.retention' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(left, ['ob-new-failed', 'ob-new-pending', 'ob-new-sent', 'ob-new-skipped', 'ob-old-pending', 'ob-old-sending']);
  const audit = await q<{ summaryAr: string }>("SELECT summaryAr FROM audit_logs WHERE action = 'system.outbox_purged'");
  assert.equal(audit.length, 1);
  assert.match(audit[0].summaryAr, /9/);
  assert.equal(await purgeOutbox(30, now, 2), 0, 'idempotent');
  assert.equal((await q("SELECT id FROM audit_logs WHERE action = 'system.outbox_purged'")).length, 1, 'no audit row for an empty sweep');
});

test('PA-14: the stuck check loads the chosen providers in one query and still flags an OFFER_UPLOAD whose provider is no longer approved', async () => {
  const { stuckApplications } = await import('../services/readiness.js');
  const { listApplications } = await import('../store/applications.js');
  const { getProvider, isSelectable } = await import('../store/providers.js');
  const { NON_TERMINAL_STATES } = await import('../workflow/shamsWorkflow.js');
  // the factory's open application → withdrawn; a new one up to OFFER_UPLOAD with provider sp-demo-2
  const [open] = await q<{ id: string }>(`SELECT a.id FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId JOIN initiative_memberships m ON m.organizationId = f.organizationId AND m.initiativeId = 'shams' JOIN users u ON u.id = m.userId
    WHERE u.email = ? AND a.state NOT IN ('REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')`, DEV.factory);
  if (open) assert.equal((await act(c.factory, open.id, 'withdraw', { reason: 'إعادة تهيئة' })).status, 200);
  const id = await advanceTo('PROVIDER_SELECTION', { factory: c.factory, imc: c.imc, encpc: c.encpc, pmu: c.pmu }, reg());
  assert.equal((await act(c.factory, id, 'select_provider', { providerId: 'sp-demo-2' })).status, 200);
  await q("UPDATE shams_service_providers SET isActive = 0 WHERE id = 'sp-demo-2'");
  try {
    const m = await measure(() => stuckApplications());
    const stuck = m.out;
    const mine = stuck.find((s) => s.id === id);
    assert.ok(mine, 'the OFFER_UPLOAD application whose provider is inactive is listed');
    assert.equal(mine!.reasonEn, 'The chosen provider is no longer approved');
    // former per-row computation for the same rows → identical list
    const rows = (await listApplications({ scopeSql: '1 = 1', scopeParams: [], states: [...NON_TERMINAL_STATES] }, 1, 1, true)).rows;
    const flagged: string[] = [];
    for (const a of rows) if (a.state === 'OFFER_UPLOAD' && a.providerId && !isSelectable(await getProvider(a.providerId))) flagged.push(a.id);
    assert.deepEqual(stuck.filter((s) => s.reasonEn === 'The chosen provider is no longer approved').map((s) => s.id), flagged);
    const providerQueries = m.queries; // one batched provider query regardless of the number of OFFER_UPLOAD rows
    assert.ok(providerQueries < 20, `stuck check statements: ${providerQueries}`);
  } finally {
    await q("UPDATE shams_service_providers SET isActive = 1 WHERE id = 'sp-demo-2'");
  }
  assert.ok(!(await stuckApplications()).some((s) => s.id === id), 'not stuck once the provider is active again');
});
