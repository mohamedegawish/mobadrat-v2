// F8 (QA 2026-11-23, BUG-12): the page-load session probe (POST /auth/refresh). A visitor — no refresh cookie at all — is
// answered «no session» (200, no token, no cookie) instead of an error status the browser logs on every page; a signed-in
// person's probe renews the session; a cookie that is invalid or already rotated is still refused (401) and cleared.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, isolateTestEnv, newPerson, startServer } from './helpers.js';

const env = isolateTestEnv('session-probe');
let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await env.cleanup(); });

test('a visitor\'s probe answers «no session»: 200, no token, nothing set or cleared', async () => {
  const r = await fetch(`${srv.base}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200, 'no error status for a visitor');
  const j = await r.json();
  assert.equal(j.data.accessToken, null);
  assert.equal(j.data.user, null);
  assert.equal(r.headers.get('set-cookie'), null, 'no cookie to set or clear');
});

test('signed in: the probe renews the session; a rotated or forged cookie is still refused and cleared', async () => {
  const person = await newPerson(srv.base, `probe.${Date.now()}@test.local`);
  const first = person.cookies.get('mobadrat_refresh');
  assert.ok(first, 'signed in with a refresh cookie');
  const renewed = await person.post('/auth/refresh');
  assert.equal(renewed.status, 200);
  assert.ok(renewed.json.data.accessToken, 'a new access token');

  const forged = new Client(srv.base);
  forged.cookies.set('mobadrat_refresh', 'not-a-token');
  const f = await forged.post('/auth/refresh');
  assert.equal(f.status, 401, 'a forged cookie is refused');

  const r = await fetch(`${srv.base}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', Cookie: `mobadrat_refresh=${first}` }, body: '{}' });
  assert.equal(r.status, 401, 'the rotated cookie replayed is refused (theft detection unchanged)');
  assert.match(r.headers.get('set-cookie') ?? '', /mobadrat_refresh=;.*1970/, 'and cleared');
});
