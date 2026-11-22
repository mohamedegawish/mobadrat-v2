// Races introduced by the synchronous → async database conversion (final pre-deployment review).
// The former node:sqlite code ran each request's statements without yielding, so "read, then write" sequences were atomic
// by construction. With the async driver (SQLite gate / MySQL pool) other requests interleave between the awaits; these
// flows must therefore run inside tx(). Each test fires the requests concurrently and checks the invariant that the
// synchronous code guaranteed. Runs on SQLite (npm test) and MySQL (npm run test:mysql).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, Client, q, DEV, type Started } from './helpers.js';

const env = isolateTestEnv('races');
let srv: Started;

before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await env.cleanup(); });

test('RACE-1 concurrent refreshes of one refresh token: exactly one succeeds, the reuse revokes the family', async () => {
  const c = new Client(srv.base);
  await c.login(DEV.factory);
  const cookie = c.cookies.get('mobadrat_refresh');
  assert.ok(cookie, 'refresh cookie issued at login');
  const userId = c.user.id as string;

  const N = 6;
  const racers = Array.from({ length: N }, () => { const r = new Client(srv.base); r.cookies.set('mobadrat_refresh', cookie!); return r; });
  const results = await Promise.all(racers.map((r) => r.post('/auth/refresh')));
  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, 1, `exactly one concurrent refresh may rotate the token (got ${results.map((r) => r.status).join(',')})`);
  assert.ok(results.every((r) => r.status === 200 || r.status === 401), 'the others are refused as a reuse');

  // The reuse was detected, so the whole family — including the token the winner just received — is revoked
  // (the behaviour of the synchronous implementation and of tests/09).
  const winner = racers[results.findIndex((r) => r.status === 200)];
  assert.equal((await winner.post('/auth/refresh')).status, 401, 'family revoked after the concurrent reuse');
  const live = await q<{ n: number }>('SELECT COUNT(*) AS n FROM refresh_tokens WHERE userId = ? AND revokedAt IS NULL', userId);
  assert.equal(Number(live[0].n), 0, 'no valid refresh token left in the family');
});

test('RACE-2 concurrent failed logins for one (email, IP) are all counted by the throttle', async () => {
  const email = DEV.imc1;
  const N = 8;
  const results = await Promise.all(Array.from({ length: N }, () => new Client(srv.base).post('/auth/login', { email, password: 'Wrong-password-1' })));
  const refused = results.filter((r) => r.status === 401).length;
  assert.ok(results.every((r) => r.status === 401 || r.status === 429), `401/429 only (got ${results.map((r) => r.status).join(',')})`);
  assert.ok(refused >= 1);
  const rows = await q<{ failures: number }>('SELECT failures FROM login_throttle');
  assert.equal(rows.length, 1, 'one throttle row for this (email, IP)');
  assert.equal(Number(rows[0].failures), refused, 'every refused password check incremented the counter (no lost update)');
});

test('RACE-3 one password-reset link used twice concurrently: only one request sets the password', async () => {
  const { sha256 } = await import('../auth/jwt.js');
  const token = 'a1'.repeat(32);
  const [user] = await q<{ id: string }>('SELECT id FROM users WHERE email = ?', DEV.encpc);
  await q('UPDATE users SET passwordResetTokenHash = ?, passwordResetExpiresAt = ? WHERE id = ?', sha256(token), new Date(Date.now() + 3_600_000).toISOString(), user.id);
  const results = await Promise.all(['NewPass-111a', 'NewPass-222b', 'NewPass-333c'].map((newPassword) =>
    new Client(srv.base).post('/auth/reset-password', { token, newPassword })));
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, 1, `a one-time link works once (got ${results.map((r) => r.status).join(',')})`);
  assert.ok(results.every((r) => r.status === 200 || (r.status === 400 && r.json.code === 'TOKEN_INVALID')));
  const audits = await q<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.password_reset' AND entityId = ?", user.id);
  assert.equal(Number(audits[0].n), 1, 'one reset recorded');
});

test('SHUTDOWN-1 graceful stop waits for a running background job, bounded by its timeout', async () => {
  const { trackJob, drainJobs, runningJobs } = await import('../jobs/inflight.js');
  let finished = false;
  void trackJob(new Promise<void>((r) => setTimeout(() => { finished = true; r(); }, 150)));
  void trackJob(Promise.reject(new Error('a failed round must not break the drain'))).catch(() => undefined);
  assert.equal(await drainJobs(5_000), true, 'drained');
  assert.equal(finished, true, 'the running job completed before the drain resolved');
  assert.equal(runningJobs(), 0);

  let release!: () => void;
  void trackJob(new Promise<void>((r) => { release = r; }));
  const t0 = Date.now();
  assert.equal(await drainJobs(100), false, 'a stuck job does not hold the shutdown beyond the timeout');
  assert.ok(Date.now() - t0 < 1_000);
  release();
  assert.equal(await drainJobs(1_000), true);
});
