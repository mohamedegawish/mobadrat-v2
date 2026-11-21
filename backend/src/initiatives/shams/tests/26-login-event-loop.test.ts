// Production-readiness PR-P1: a burst of logins at production bcrypt cost must not freeze the server for other requests.
// Before the fix (bcrypt.compareSync) every login blocked the single event loop for ~120 ms, so 12 concurrent logins
// held unrelated requests for well over a second (perf smoke run: event-loop delay 2.2 s with 20 users).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, DEV, type Started } from './helpers.js';

const env = isolateTestEnv('loginloop');
process.env.BCRYPT_ROUNDS = '10'; // production cost (helpers default to 4 for speed)
let srv: Started;

before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await env.cleanup(); });

test('12 concurrent logins at 10 bcrypt rounds: an unrelated request keeps answering quickly, and every login still succeeds', async () => {
  const health: number[] = [];
  let done = false;
  const probe = (async () => {
    while (!done) {
      const t0 = performance.now();
      await fetch(`${srv.origin}/health`);
      health.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  const t0 = performance.now();
  const logins = await Promise.all(Array.from({ length: 12 }, () => fetch(`${srv.base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEV.factory, password: 'Shams@2026' }),
  })));
  const burstMs = performance.now() - t0;
  done = true;
  await probe;
  assert.deepEqual(logins.map((r) => r.status), Array(12).fill(200));
  const worst = Math.max(...health);
  console.log(`[PR-P1] 12 logins took ${burstMs.toFixed(0)} ms; /health answered ${health.length} times, worst ${worst.toFixed(0)} ms`);
  assert.ok(health.length >= 5, 'health was probed during the burst');
  assert.ok(worst < 400, `an unrelated request waited ${worst.toFixed(0)} ms behind the login burst`);
  // wrong password and unknown account still fail the same way
  const bad = await fetch(`${srv.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEV.factory, password: 'wrong-Pass1' }) });
  const none = await fetch(`${srv.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@shams.local', password: 'wrong-Pass1' }) });
  assert.equal(bad.status, 401); assert.equal(none.status, 401);
  assert.equal((await bad.json()).code, (await none.json()).code);
});
