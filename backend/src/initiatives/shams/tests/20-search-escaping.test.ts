// L1 + likePattern: كل بحث بنص حر يجب أن يعمل (لا 500)، والرموز الخاصة بـLIKE (% _ \) تُعامل حرفيًا. كان بحث سجل التدقيق والجهات يرجع 500 دائمًا.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, advanceTo, q, onMysql, type Started } from './helpers.js';

const env = isolateTestEnv('search');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

test('likePattern escapes %, _ and backslash so they match literally', async () => {
  const { likePattern } = await import('../http/helpers.js');
  assert.equal(likePattern('a%b_c'), '%a\\%b\\_c%');
  assert.equal(likePattern('x\\y'), '%x\\\\y%');
  assert.equal(likePattern('plain'), '%plain%');
  const { getDb } = await import('../db/sqlite.js');
  const db = getDb();
  if (onMysql) {
    // MySQL: a TEMPORARY table is per connection (the pool would not see it) — a plain table in this file's test database;
    // values bound as parameters (a backslash inside a MySQL string literal is an escape character).
    await db.exec('CREATE TABLE like_probe (x TEXT)');
    for (const v of ['50% off', 'a_b', 'axb', 'plain', 'c:\\dir']) await db.prepare('INSERT INTO like_probe VALUES (?)').run(v);
  } else {
    await db.exec("CREATE TEMP TABLE like_probe (x TEXT)");
    await db.exec("INSERT INTO like_probe VALUES ('50% off'), ('a_b'), ('axb'), ('plain'), ('c:\\dir')");
  }
  const find = async (term: string) => (await db.prepare("SELECT x FROM like_probe WHERE x LIKE ? ESCAPE '\\'").all(likePattern(term)) as Array<{ x: string }>).map((r) => r.x);
  assert.deepEqual(await find('50%'), ['50% off'], '% is literal');
  assert.deepEqual(await find('a_b'), ['a_b'], '_ is literal, not "any character" (axb is not a match)');
  assert.deepEqual(await find('c:\\d'), ['c:\\dir'], 'backslash is literal');
  assert.deepEqual(await find('%'), ['50% off'], 'a lone % matches only literal percent signs');
});

test('admin audit-log search works (it used to return 500 for any text) and filters correctly', async () => {
  await advanceTo('IMC_REVIEW', c, 'IND-SRCH-1');
  const all = await c.admin.get('/admin/audit-logs?pageSize=50');
  assert.equal(all.status, 200);
  const hit = await c.admin.get(`/admin/audit-logs?q=${encodeURIComponent('application')}&pageSize=50`);
  assert.equal(hit.status, 200, JSON.stringify(hit.json));
  assert.ok(hit.json.data.total > 0);
  assert.ok(hit.json.data.items.every((r: any) => /application/i.test(`${r.actorName} ${r.summaryAr} ${r.entityId} ${r.action}`)));
  const none = await c.admin.get(`/admin/audit-logs?q=${encodeURIComponent('zzz-no-such-text-zzz')}`);
  assert.equal(none.status, 200);
  assert.equal(none.json.data.total, 0);
  // رموز LIKE الخاصة لا تطابق كل شيء ولا تكسر الاستعلام
  for (const term of ['%', '_', '\\', "'; DROP TABLE audit_logs; --", '%_%\\']) {
    const r = await c.admin.get(`/admin/audit-logs?q=${encodeURIComponent(term)}`);
    assert.equal(r.status, 200, `q=${term}`);
    assert.ok(r.json.data.total <= all.json.data.total, 'a wildcard in the search box never widens the result');
  }
  assert.ok((await q("SELECT 1 FROM audit_logs LIMIT 1")).length === 1, 'the table is intact');
});

test('every free-text search box returns 200 (organizations, users, providers, applications)', async () => {
  const org = await c.admin.get(`/admin/organizations?q=${encodeURIComponent('بنك')}`);
  assert.equal(org.status, 200, JSON.stringify(org.json));
  assert.ok(org.json.data.items.length >= 1, 'finds the demo banks by name');
  assert.equal((await c.admin.get(`/admin/organizations?q=${encodeURIComponent('%')}`)).status, 200);
  assert.equal((await c.admin.get(`/admin/users?q=${encodeURIComponent('imc')}`)).status, 200);
  assert.equal((await c.admin.get(`/admin/users?q=${encodeURIComponent('_')}`)).json.data.items.every((u: any) => /_/.test(`${u.nameAr}${u.nameEn}${u.email}`)), true);
  assert.equal((await c.encpc.get(`/service-providers?q=${encodeURIComponent('تجريبي')}`)).status, 200);
  assert.ok((await c.encpc.get(`/service-providers?q=${encodeURIComponent('تجريبي')}`)).json.data.items.length >= 1);
  assert.equal((await c.pmu.get(`/applications?q=${encodeURIComponent('%')}`)).status, 200);
  assert.equal((await c.pmu.get(`/applications?q=${encodeURIComponent("o'brien")}`)).status, 200);
});
