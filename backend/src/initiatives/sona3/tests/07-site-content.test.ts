// محتوى الواجهة العامة: القراءة عامة، والتعديل/الاستعادة للأدمن فقط، مع تحقق البنية وتسجيل التدقيق.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, buildWorld, Client, type Started, type World } from './helpers.js';

const env = isolateTestEnv('site-content');
let srv: Started;
let w: World;

before(async () => { srv = await startServer(); w = await buildWorld(srv, {}); });
after(async () => { await srv.close(); await env.cleanup(); });

test('site content: public read, admin-only write, validation, reset, audit', async () => {
  const anon = new Client(srv.base);
  const empty = await anon.get('/site-content');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.data.overrides, {});

  const value = { ar: 'اسم جديد', en: 'New name' };
  assert.equal((await anon.put('/admin/site-content/siteName', { value })).status, 401, 'anonymous cannot write');
  assert.equal((await w.imc.put('/admin/site-content/siteName', { value })).status, 403, 'staff (non-admin) cannot write');

  assert.equal((await w.admin.put('/admin/site-content/nope', { value })).status, 404, 'unknown key');
  assert.equal((await w.admin.put('/admin/site-content/siteName', { value: { ar: '', en: 'x' } })).status, 400, 'empty ar rejected');
  assert.equal((await w.admin.put('/admin/site-content/siteName', { value, extra: 1 })).status, 400, 'unknown body field rejected');
  assert.equal((await w.admin.put('/admin/site-content/figures', { value: [{ value: '', label: value }] })).status, 400, 'empty figure value rejected');
  assert.equal((await w.admin.put('/admin/site-content/eligibility', { value: 'x' })).status, 400, 'list required');

  assert.equal((await w.admin.put('/admin/site-content/siteName', { value })).status, 200);
  const items = [{ value: '60', label: { ar: 'مشروعًا', en: 'projects' } }];
  assert.equal((await w.admin.put('/admin/site-content/figures', { value: items })).status, 200);

  const pub = await anon.get('/site-content');
  assert.deepEqual(pub.json.data.overrides.siteName, value);
  assert.deepEqual(pub.json.data.overrides.figures, items);

  assert.equal((await w.admin.del('/admin/site-content/siteName')).status, 200);
  assert.equal((await anon.get('/site-content')).json.data.overrides.siteName, undefined, 'reset removes override');

  const audit = await w.admin.get('/admin/audit-logs?q=site_content&pageSize=50');
  const actions = (audit.json.data.items ?? audit.json.data.rows ?? []).map((r: any) => r.action);
  assert.ok(actions.includes('site_content.update') && actions.includes('site_content.reset'), `audit has update+reset (got ${actions})`);
});
