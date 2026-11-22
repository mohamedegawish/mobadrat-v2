// Production-readiness security checks that the earlier suites (05, 09, 14, 07, 17) do not already cover:
// deep-link authorization (D20), document-id swapping and traversal, filename manipulation, aborted uploads, error leakage,
// and the integration API response contract (D15 metadata-only) checked field by field against contracts/integration.openapi.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { isolateTestEnv, startServer, clients, act, advanceTo, createCompleteDraft, pdfVariant, q, Client, type Started } from './helpers.js';

const env = isolateTestEnv('prsec');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
const contract = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'contracts', 'integration.openapi.json'), 'utf8'));

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen(factory: Client) {
  const open = (await factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}

const LEAK = /\bat [\w.<>]+ \(|node_modules|[A-Za-z]:\\|\/src\/|SQLITE|sqlite|stack/;

test('SEC-1 D20 deep link: the selection link carries no credential; login is required and ownership is checked on the server', async () => {
  await closeOpen(c.factory);
  const id = await advanceTo('PROVIDER_SELECTION', c, 'IND-SEC-1');
  const mail = (await q<any>("SELECT body FROM notification_outbox WHERE applicationId = ? AND channel = 'email' AND body LIKE '%#i/shams/task/%'", id))[0];
  assert.ok(mail, 'selection email queued');
  const links = [...String(mail.body).matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h.includes('#i/shams/task/'));
  assert.ok(links.length >= 1);
  for (const l of links) {
    const u = new URL(l.replace(/&amp;/g, '&'));
    assert.equal(u.search, '', `no query string (no token) in ${l}`);
    assert.equal(u.hash, `#i/shams/task/${encodeURIComponent(id)}`);
  }
  // the link alone grants nothing: the API behind the page needs a session, and only the owner gets the application
  assert.equal((await new Client(srv.base).get(`/applications/${id}`)).status, 401);
  assert.equal((await new Client(srv.base).post(`/applications/${id}/actions/select_provider`, { expectedVersion: 1, providerId: 'sp-demo-1' })).status, 401);
  assert.equal((await c.factory2.get(`/applications/${id}`)).status, 404, 'another factory changing the identifier gets 404');
  const other = await c.factory2.post(`/applications/${id}/actions/select_provider`, { expectedVersion: 99, providerId: 'sp-demo-1' });
  assert.equal(other.status, 404);
  assert.equal((await c.factory.get(`/applications/${id}`)).status, 200);
  assert.equal((await q<any>('SELECT state FROM shams_applications WHERE id = ?', id))[0].state, 'PROVIDER_SELECTION');
});

test('SEC-2 a document id from another application (or a traversal string) never downloads through an application the caller can see', async () => {
  await closeOpen(c.factory); await closeOpen(c.factory2);
  const mine = await createCompleteDraft(c.factory, 'IND-SEC-2A');
  const theirs = await createCompleteDraft(c.factory2, 'IND-SEC-2B');
  const theirDoc = (await q<any>("SELECT id FROM shams_documents WHERE applicationId = ? AND kind = 'taxCardFile'", theirs))[0].id;
  const myDoc = (await q<any>("SELECT id FROM shams_documents WHERE applicationId = ? AND kind = 'taxCardFile'", mine))[0].id;
  assert.equal((await c.factory.get(`/applications/${mine}/documents/${myDoc}/download`)).status, 200);
  assert.equal((await c.factory.get(`/applications/${mine}/documents/${theirDoc}/download`)).status, 404, 'id swap through my own application');
  assert.equal((await c.factory.get(`/applications/${theirs}/documents/${theirDoc}/download`)).status, 404, 'their application');
  assert.equal((await c.pmu.get(`/applications/${mine}/documents/${theirDoc}/download`)).status, 404, 'even PMU cannot pair a document with the wrong application');
  for (const bad of ['..%2F..%2Fetc%2Fpasswd', '%2e%2e%2f%2e%2e%2ftest.db', '..\\..\\test.db']) {
    const r = await c.factory.get(`/applications/${mine}/documents/${bad}/download`);
    assert.ok(r.status === 404 || r.status === 400, `${bad} -> ${r.status}`);
  }
  assert.equal((await new Client(srv.base).get(`/applications/${mine}/documents/${myDoc}/download`)).status, 401);
  // cannot replace a document of another factory, and its versions stay untouched
  const before_ = (await q<any>('SELECT COUNT(*) AS n FROM shams_documents WHERE applicationId = ?', theirs))[0].n;
  assert.equal((await c.factory.upload(`/applications/${theirs}/documents`, { kind: 'taxCardFile' }, pdfVariant('sec2-replace'), 'x.pdf')).status, 404);
  assert.equal((await q<any>('SELECT COUNT(*) AS n FROM shams_documents WHERE applicationId = ?', theirs))[0].n, before_);
});

test('SEC-3 a hostile file name is stored under a random name inside the upload directory and cannot inject response headers', async () => {
  await closeOpen(c.factory);
  const id = (await c.factory.post('/applications', {})).json.data.id;
  const evil = '../../../outside"\r\nX-Injected: yes;‮gnp.pdf';
  const r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, pdfVariant('sec3'), evil);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const row = (await q<any>('SELECT storedName, originalName FROM shams_documents WHERE id = ?', r.json.data.id))[0];
  assert.match(row.storedName, /^[0-9a-f-]{36}\.pdf$/, 'random stored name');
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR!, 'shams', 'documents', row.storedName)));
  assert.equal(fs.existsSync(path.join(env.dir, 'outside')), false);
  const dl = await c.factory.get(`/applications/${id}/documents/${r.json.data.id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-injected'), null);
  const cd = dl.headers.get('content-disposition') ?? '';
  assert.doesNotMatch(cd, /[\r\n]/);
  assert.match(cd, /^attachment; filename="[\x20-\x7E]*"; filename\*=UTF-8''/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
});

test('SEC-4 an upload aborted by the client mid-stream leaves no temporary or stored file and no row', async () => {
  await closeOpen(c.factory);
  const id = (await c.factory.post('/applications', {})).json.data.id;
  const tmp = path.join(process.env.UPLOAD_DIR!, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const docsBefore = fs.readdirSync(path.join(process.env.UPLOAD_DIR!, 'shams', 'documents')).length;
  const boundary = '----sec4boundary';
  const u = new URL(`${srv.base}/applications/${id}/documents`);
  await new Promise<void>((resolve) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: {
      Authorization: `Bearer ${c.factory.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(5 * 1024 * 1024),
    } });
    req.on('error', () => resolve());
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\ntaxCardFile\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`);
    req.write(Buffer.alloc(256 * 1024, 0x41), () => setTimeout(() => { req.destroy(); resolve(); }, 100));
  });
  const until = Date.now() + 5000;
  while (fs.readdirSync(tmp).length && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(fs.readdirSync(tmp), [], 'temporary part removed');
  assert.equal(fs.readdirSync(path.join(process.env.UPLOAD_DIR!, 'shams', 'documents')).length, docsBefore);
  assert.equal((await q('SELECT 1 FROM shams_documents WHERE applicationId = ?', id)).length, 0);
  // backstop for a crash during an upload: stale temp parts are swept, fresh ones and other files are kept
  const { sweepStaleTmp } = await import('../http/upload.js');
  const old = path.join(tmp, 'up-00000000-0000-4000-8000-000000000001.tmp');
  const fresh = path.join(tmp, 'up-00000000-0000-4000-8000-000000000002.tmp');
  const other = path.join(tmp, 'keep-me.txt');
  for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  fs.utimesSync(old, twoHoursAgo, twoHoursAgo); fs.utimesSync(other, twoHoursAgo, twoHoursAgo);
  assert.equal(sweepStaleTmp(), 1);
  assert.deepEqual(fs.readdirSync(tmp).sort(), ['keep-me.txt', path.basename(fresh)].sort());
  for (const f of [fresh, other]) fs.rmSync(f);
});

test('SEC-5 error responses carry a code and bilingual message only: no stack, path, SQL or library text', async () => {
  const raw = async (method: string, p: string, body: string, ct = 'application/json') => {
    const r = await fetch(`${srv.base}${p}`, { method, headers: { Authorization: `Bearer ${c.factory.token}`, 'Content-Type': ct }, body: method === 'GET' ? undefined : body });
    return { status: r.status, text: await r.text() };
  };
  const cases = [
    await raw('POST', '/applications/x/actions/submit', '{"expectedVersion": 1,'),
    await raw('POST', '/applications/x/actions/submit', JSON.stringify({ expectedVersion: 'x'.repeat(2 * 1024 * 1024) })),
    await raw('PUT', '/applications/x/data/general', '[1,2,3]'),
    await raw('POST', '/applications/x/actions/__proto__', '{}'),
    await raw('POST', '/auth/login', '{"email": {"$ne": null}, "password": {"$gt": ""}}'),
    await raw('GET', '/no/such/route', ''),
  ];
  for (const r of cases) {
    assert.ok(r.status >= 400 && r.status < 500, `${r.status} ${r.text.slice(0, 200)}`);
    const j = JSON.parse(r.text);
    assert.ok(j.code && j.messageAr && j.messageEn, r.text.slice(0, 200));
    assert.doesNotMatch(r.text, LEAK, r.text.slice(0, 300));
  }
  // abusive paging and filter values are normalised (capped page size, unknown states ignored), not errors
  const list = await c.pmu.get('/applications?page=-1&pageSize=99999&state=DRAFT,%00');
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.length <= 100);
  assert.equal(list.json.data.pageSize ?? 100, 100);
});

test('SEC-6 integration API read responses match contracts/integration.openapi.json exactly and expose no identity (D15)', async () => {
  await closeOpen(c.factory);
  const id = await advanceTo('CONTRACT_OUTCOME', c, 'IND-SEC-6');
  const created = await c.admin.post('/admin/integration-keys', { name: 'sec6', scopes: ['read'] });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.json));
  const key: string = created.json.data.plaintextKey; // same contract as test 07 (read-only keys need no approval)
  assert.match(key, /^shk_/);
  const get = async (p: string) => {
    const r = await fetch(`${srv.integration}${p}`, { headers: { Authorization: `Bearer ${key}` } });
    return { status: r.status, text: await r.text() };
  };
  const schemas = contract.components.schemas;
  const keysOf = (s: any): string[] => Object.keys(s.properties ?? {}).sort();
  const list = await get('/applications?pageSize=100');
  assert.equal(list.status, 200, list.text);
  const item = JSON.parse(list.text).data.items.find((i: any) => i.id === id);
  assert.ok(item);
  assert.deepEqual(Object.keys(item).sort(), keysOf(schemas.ApplicationListItem), 'list item fields = contract');
  assert.deepEqual(Object.keys(item.responsible).sort(), keysOf(schemas.Responsible));
  const detail = await get(`/applications/${id}`);
  assert.equal(detail.status, 200);
  const d = JSON.parse(detail.text).data;
  assert.deepEqual(Object.keys(d).sort(), [...keysOf(schemas.ApplicationListItem), 'history'].sort(), 'detail fields = contract');
  for (const h of d.history) assert.deepEqual(Object.keys(h).sort(), keysOf(schemas.HistoryEntry));
  // the identity values themselves appear nowhere in either response
  const app = (await q<any>('SELECT companyName, industrialRegistryNumber, factoryId FROM shams_applications WHERE id = ?', id))[0];
  for (const text of [list.text, detail.text]) {
    for (const secret of [app.companyName, app.industrialRegistryNumber, app.factoryId, 'org-factory-demo-1', '123-456-789', 'contact@factory.test', '01012345678']) {
      assert.equal(text.includes(secret), false, `"${secret}" leaked`);
    }
  }
  // the read scope cannot write, and search does not match on identity
  const put = await fetch(`${srv.integration}/service-providers/sp-demo-1`, { method: 'PUT', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{"nameAr":"x"}' });
  assert.equal(put.status, 403);
  const byName = JSON.parse((await get(`/applications?q=${encodeURIComponent(app.industrialRegistryNumber)}`)).text);
  assert.equal(byName.data.items.length, 0, 'q does not search the registry number');
});
