// The platform's unified directory of bodies (دليل الجهات): every permission, every validation, every link rule and the
// activity numbers against real work done in both initiatives.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, isolateTestEnv, pdf, startServer } from './helpers.js';

const env = isolateTestEnv('bodies');
let srv: Awaited<ReturnType<typeof startServer>>;
let admin: Client;
before(async () => { srv = await startServer(); admin = await new Client(srv.base).login('admin@mobadrat.local'); });
after(async () => { await srv.close(); await env.cleanup(); });

const del = (c: Client, p: string) => c.req('DELETE', p);
const body = async (id: string) => (await admin.get(`/admin/bodies/${id}`)).json.data;
const link = (b: any, initiativeId: string) => b.links.find((l: any) => l.initiativeId === initiativeId);
let seq = 0;
const uniqueName = (tag: string) => `جهة اختبار ${tag} ${Date.now() % 100000}-${++seq}`;
async function newBody(over: Record<string, unknown> = {}) {
  const r = await admin.post('/admin/bodies', { nameAr: uniqueName('عامة'), kind: 'other', ...over });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
}

test('BD-01 the demo directory: each body with its organization in every initiative it takes part in', async () => {
  const r = await admin.get('/admin/bodies');
  assert.equal(r.status, 200);
  const items = r.json.data.items as any[];
  const byId = new Map(items.map((b) => [b.id, b]));
  const imc = byId.get('body-imc');
  assert.deepEqual(imc.links.map((l: any) => l.initiativeId).sort(), ['shams', 'sona3'], 'IMC takes part in both initiatives');
  assert.equal(imc.totals.initiatives, 2);
  for (const l of imc.links) {
    assert.equal(l.organizationId, 'org-imc');
    assert.equal(l.missing, false);
    assert.ok(l.organization.typeLabelAr);
    assert.ok(l.activity, 'activity of each link');
  }
  // Bodies of a single initiative: one link each.
  for (const [id, initiative] of [['body-encpc', 'shams'], ['body-pmu', 'shams'], ['body-bank-a', 'shams'], ['body-committee', 'sona3'], ['body-funder-demo', 'sona3']]) {
    assert.deepEqual(byId.get(id).links.map((l: any) => l.initiativeId), [initiative], `${id} only in ${initiative}`);
  }
  assert.deepEqual(r.json.data.kinds.map((k: any) => k.key), ['government', 'center', 'financial', 'company', 'committee', 'other']);
  assert.deepEqual(r.json.data.initiatives.map((i: any) => i.id), ['shams', 'sona3']);
});

test('BD-02 permissions: super admin manages; ministry viewer and auditor read; everyone else is refused (before any validation)', async () => {
  const target = await newBody();
  const actors: Array<[string, Client, 'manage' | 'read' | 'none']> = [
    ['super_admin', admin, 'manage'],
    ['ministry_viewer', await new Client(srv.base).login('ministry@mobadrat.local'), 'read'],
    ['auditor', await new Client(srv.base).login('auditor@mobadrat.local'), 'read'],
    ['catalog_manager', await new Client(srv.base).login('content@mobadrat.local'), 'none'],
    ['shams IMC reviewer', await new Client(srv.base).login('imc1@shams.local'), 'none'],
    ['shams system admin (no platform role)', await new Client(srv.base).login('admin@shams.local'), 'none'],
    ['sona3 applicant', await new Client(srv.base).login('applicant@sona3.local'), 'none'],
  ];
  const guest = new Client(srv.base);
  for (const p of ['/admin/bodies', '/admin/bodies/organizations', `/admin/bodies/${target.id}`]) {
    assert.equal((await guest.get(p)).status, 401, `guest GET ${p}`);
    for (const [name, c, level] of actors) assert.equal((await c.get(p)).status, level === 'none' ? 403 : 200, `${name} GET ${p}`);
  }
  const writes: Array<[string, (c: Client) => Promise<{ status: number }>]> = [
    ['create', (c) => c.post('/admin/bodies', {})],
    ['update', (c) => c.put(`/admin/bodies/${target.id}`, {})],
    ['delete', (c) => del(c, `/admin/bodies/${target.id}`)],
    ['link', (c) => c.post(`/admin/bodies/${target.id}/links`, {})],
    ['unlink', (c) => del(c, `/admin/bodies/${target.id}/links/shams`)],
  ];
  for (const [what, call] of writes) {
    assert.equal((await call(guest)).status, 401, `guest ${what}`);
    for (const [name, c, level] of actors) {
      if (level === 'manage') continue;
      assert.equal((await call(c)).status, 403, `${name} ${what}`);
    }
  }
  assert.ok(await body(target.id), 'the refused calls changed nothing');
});

test('BD-03 creating: every field validated; unknown fields refused; names unique ignoring case, accents and spaces', async () => {
  const bad: Array<[Record<string, unknown>, string]> = [
    [{ kind: 'center' }, 'nameAr'],
    [{ nameAr: 'ا', kind: 'center' }, 'nameAr'],
    [{ nameAr: 'ج'.repeat(201), kind: 'center' }, 'nameAr'],
    [{ nameAr: 'جهة بلا نوع' }, 'kind'],
    [{ nameAr: 'جهة بنوع خطأ', kind: 'ministry' }, 'kind'],
    [{ nameAr: 'جهة ببريد خطأ', kind: 'center', contactEmail: 'not-mail' }, 'contactEmail'],
    [{ nameAr: 'جهة بهاتف خطأ', kind: 'center', contactPhone: 'abc' }, 'contactPhone'],
    [{ nameAr: 'جهة بموقع خطأ', kind: 'center', website: 'not a url' }, 'website'],
    [{ nameAr: 'جهة بوصف طويل', kind: 'center', description: 'و'.repeat(2001) }, 'description'],
    [{ nameAr: 'جهة بروابط خطأ', kind: 'center', links: 'shams' }, 'links'],
    [{ nameAr: 123, kind: 'center' }, 'nameAr'],
  ];
  for (const [input, field] of bad) {
    const r = await admin.post('/admin/bodies', input);
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.json)}`);
    assert.ok(r.json.details?.some((d: any) => d.field === field), `${field} reported: ${JSON.stringify(r.json.details)}`);
  }
  // Fields the client may not set (id, status) are refused, not silently ignored.
  const hijack = await admin.post('/admin/bodies', { id: 'body-hijack', isActive: false, nameAr: uniqueName('اختطاف'), kind: 'other' });
  assert.equal(hijack.status, 400);
  assert.deepEqual(hijack.json.details.map((d: any) => d.field).sort(), ['id', 'isActive']);
  assert.equal((await admin.get('/admin/bodies/body-hijack')).status, 404);
  const name = uniqueName('Latin Name');
  const ok = await admin.post('/admin/bodies', {
    nameAr: `  ${name}  `, nameEn: 'Test Agency', kind: 'government',
    contactEmail: 'Info@Agency.Example.Org', contactPhone: '0221234567', website: 'www.agency.example.org', description: 'وصف',
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const b = ok.json.data;
  assert.equal(b.isActive, true, 'a new body starts active');
  assert.equal(b.nameAr, name, 'trimmed');
  assert.equal(b.contactEmail, 'info@agency.example.org');
  assert.equal(b.website, 'https://www.agency.example.org');
  assert.equal(b.kindLabelAr, 'جهة حكومية');
  assert.deepEqual(b.links, []);
  assert.deepEqual(b.totals, { staff: 0, decisions: 0, pending: 0, lastActivityAt: null, initiatives: 0 });
  for (const dup of [name, `${name} `, name.toUpperCase(), name.replace('Latin', 'látin')]) {
    const r = await admin.post('/admin/bodies', { nameAr: dup, kind: 'other' });
    assert.equal(r.status, 409, `duplicate «${dup}»`);
    assert.equal(r.json.code, 'BODY_NAME_TAKEN');
  }
});

test('BD-04 updating: partial changes, clearing optional fields, rename rules, activation; unknown body is 404', async () => {
  const b = await newBody({ nameEn: 'Before', contactEmail: 'a@b.example.org', website: 'https://old.example.org' });
  let r = await admin.put(`/admin/bodies/${b.id}`, { nameEn: 'After' });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.nameEn, 'After');
  assert.equal(r.json.data.nameAr, b.nameAr, 'untouched fields stay');
  assert.equal(r.json.data.contactEmail, 'a@b.example.org');
  r = await admin.put(`/admin/bodies/${b.id}`, { contactEmail: '', website: '' });
  assert.equal(r.json.data.contactEmail, '');
  assert.equal(r.json.data.website, '');
  const other = await newBody();
  r = await admin.put(`/admin/bodies/${b.id}`, { nameAr: other.nameAr });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'BODY_NAME_TAKEN');
  for (const [input, field] of [[{ kind: 'bank' }, 'kind'], [{ isActive: 'no' }, 'isActive'], [{ nameAr: 'ب' }, 'nameAr'], [{ contactPhone: 'x' }, 'contactPhone']] as Array<[Record<string, unknown>, string]>) {
    r = await admin.put(`/admin/bodies/${b.id}`, input);
    assert.equal(r.status, 400, field);
  }
  r = await admin.put(`/admin/bodies/${b.id}`, { isActive: false });
  assert.equal(r.json.data.isActive, false);
  assert.ok((await admin.get('/admin/bodies?status=inactive')).json.data.items.some((x: any) => x.id === b.id));
  assert.ok(!(await admin.get('/admin/bodies?status=active')).json.data.items.some((x: any) => x.id === b.id));
  r = await admin.put(`/admin/bodies/${b.id}`, { isActive: true });
  assert.equal(r.json.data.isActive, true);
  assert.equal((await admin.put('/admin/bodies/body-missing', { nameEn: 'x' })).status, 404);
  assert.equal((await admin.get('/admin/bodies/body-missing')).status, 404);
});

test('BD-05 linking: one organization per initiative; re-linking the same pair is harmless; links show the organization', async () => {
  const b = await newBody({ kind: 'government' });
  let r = await admin.post(`/admin/bodies/${b.id}/links`, { initiativeId: 'shams', organizationId: 'org-admin' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(link(r.json.data, 'shams').organization.nameAr, 'إدارة النظام');
  r = await admin.post(`/admin/bodies/${b.id}/links`, { initiativeId: 'shams', organizationId: 'org-admin' });
  assert.equal(r.status, 200, 'the same link again changes nothing');
  assert.equal(r.json.data.links.length, 1);
  r = await admin.post(`/admin/bodies/${b.id}/links`, { initiativeId: 'sona3', organizationId: 'org-admin' });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.totals.initiatives, 2);
  // Free the two admin organizations for the other tests.
  assert.equal((await del(admin, `/admin/bodies/${b.id}/links/shams`)).status, 200);
  assert.equal((await del(admin, `/admin/bodies/${b.id}/links/sona3`)).status, 200);
});

test('BD-06 link rules: taken organization, second organization in one initiative, unknown or info-only initiative, applicants and factories, inactive body', async () => {
  const b = await newBody({ kind: 'financial' });
  const expectErr = async (input: Record<string, unknown>, status: number, code: string, who = b.id) => {
    const r = await admin.post(`/admin/bodies/${who}/links`, input);
    assert.equal(r.status, status, `${JSON.stringify(input)} → ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, code);
  };
  await expectErr({ initiativeId: 'shams', organizationId: 'org-imc' }, 409, 'ORG_ALREADY_LINKED');            // IMC's
  await expectErr({ initiativeId: 'nope', organizationId: 'org-imc' }, 404, 'INITIATIVE_NOT_FOUND');
  await expectErr({ initiativeId: 'shams', organizationId: 'org-does-not-exist' }, 422, 'NOT_A_BODY');
  await expectErr({ initiativeId: 'shams', organizationId: 'org-factory-demo-1' }, 422, 'NOT_A_BODY');      // a factory
  await expectErr({ initiativeId: 'sona3', organizationId: 'org-applicant-demo-1' }, 422, 'NOT_A_BODY');    // an applicant
  await expectErr({ initiativeId: 'sona3', organizationId: 'org-imc' }, 409, 'ORG_ALREADY_LINKED');
  await expectErr({ organizationId: 'org-admin' }, 400, 'VALIDATION_ERROR');
  await expectErr({ initiativeId: 'shams' }, 400, 'VALIDATION_ERROR');
  await expectErr({ initiativeId: 'shams', organizationId: 'org-admin' }, 404, 'NOT_FOUND', 'body-missing');
  // A body already in an initiative cannot take a second organization of it.
  await expectErr({ initiativeId: 'shams', organizationId: 'org-admin' }, 409, 'BODY_ALREADY_IN_INITIATIVE', 'body-imc');
  // An information-only initiative (no module) has no bodies.
  const content = await new Client(srv.base).login('content@mobadrat.local');
  const info = await content.post('/admin/catalog', { titleAr: 'مبادرة معلومات فقط', slug: `info-only-${Date.now() % 100000}`, status: 'active' });
  assert.equal(info.status, 201, JSON.stringify(info.json));
  await expectErr({ initiativeId: info.json.data.id, organizationId: 'org-admin' }, 422, 'INITIATIVE_HAS_NO_MODULE');
  // An inactive body takes no new link.
  await admin.put(`/admin/bodies/${b.id}`, { isActive: false });
  await expectErr({ initiativeId: 'shams', organizationId: 'org-admin' }, 409, 'BODY_INACTIVE');
  await admin.put(`/admin/bodies/${b.id}`, { isActive: true });
});

test('BD-07 an inactive initiative organization can be linked and shows as inactive; a removed one shows as missing', async () => {
  const shamsAdmin = await new Client(srv.base).login('admin@shams.local');
  const bank = await shamsAdmin.post('/i/shams/admin/organizations', { type: 'bank', nameAr: 'بنك معطل للاختبار', nameEn: 'Inactive test bank' });
  assert.equal(bank.status, 201, JSON.stringify(bank.json));
  const bankId = bank.json.data.id;
  assert.equal((await shamsAdmin.put(`/i/shams/admin/organizations/${bankId}`, { isActive: false })).status, 200);
  const b = await newBody({ kind: 'financial', nameAr: uniqueName('بنك') });
  const r = await admin.post(`/admin/bodies/${b.id}/links`, { initiativeId: 'shams', organizationId: bankId });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(link(r.json.data, 'shams').organization.isActive, false);
  assert.equal(link(r.json.data, 'shams').activity.pending, 0, 'banks never have applications waiting (no account in Shams)');

  // The initiative removed its organization (e.g. cleanup by the initiative): the link stays visible, flagged missing.
  const { getDb } = await import('../src/core/db/index.js');
  await getDb().prepare('DELETE FROM shams_organizations WHERE id = ?').run(bankId);
  const d = await body(b.id);
  assert.equal(link(d, 'shams').missing, true);
  assert.equal(link(d, 'shams').organization, null);
  assert.equal(link(d, 'shams').activity, null);
  assert.equal((await del(admin, `/admin/bodies/${b.id}/links/shams`)).status, 200, 'a missing organization can still be unlinked');
});

test('BD-08 unlinking and deleting: a linked body cannot be deleted; unlinking frees the organization; the initiative is untouched', async () => {
  const b = await newBody({ kind: 'government' });
  await admin.post(`/admin/bodies/${b.id}/links`, { initiativeId: 'sona3', organizationId: 'org-admin' });
  let r = await del(admin, `/admin/bodies/${b.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'BODY_HAS_LINKS');
  assert.equal((await del(admin, `/admin/bodies/${b.id}/links/shams`)).status, 404, 'not linked in Shams');
  assert.equal((await del(admin, `/admin/bodies/${b.id}/links/nope`)).status, 404);
  assert.equal((await del(admin, `/admin/bodies/${b.id}/links/sona3`)).status, 200);
  assert.equal((await del(admin, `/admin/bodies/${b.id}/links/sona3`)).status, 404, 'already unlinked');
  // The organization is free for another body, and still exists in the initiative.
  const orgs = (await admin.get('/admin/bodies/organizations')).json.data.items as any[];
  const sonaAdmin = orgs.find((o) => o.initiativeId === 'sona3' && o.organization.id === 'org-admin');
  assert.ok(sonaAdmin, 'the initiative organization is untouched');
  assert.equal(sonaAdmin.body, null);
  r = await del(admin, `/admin/bodies/${b.id}`);
  assert.equal(r.status, 200);
  assert.equal((await admin.get(`/admin/bodies/${b.id}`)).status, 404);
  assert.equal((await del(admin, `/admin/bodies/${b.id}`)).status, 404);
});

test('BD-09 create with links in one step; one invalid link rolls the whole creation back', async () => {
  const name = uniqueName('مع روابط');
  let r = await admin.post('/admin/bodies', { nameAr: name, kind: 'government', links: [{ initiativeId: 'shams', organizationId: 'org-admin' }, { initiativeId: 'sona3', organizationId: 'org-imc' }] });
  assert.equal(r.status, 409, 'sona3 org-imc belongs to IMC');
  assert.ok(!(await admin.get(`/admin/bodies?q=${encodeURIComponent(name)}`)).json.data.items.length, 'nothing was created');
  const orgs = (await admin.get('/admin/bodies/organizations')).json.data.items as any[];
  assert.equal(orgs.find((o) => o.initiativeId === 'shams' && o.organization.id === 'org-admin').body, null, 'the first link was rolled back too');
  r = await admin.post('/admin/bodies', { nameAr: name, kind: 'government', links: [{ initiativeId: 'shams', organizationId: 'org-admin' }, { initiativeId: 'sona3', organizationId: 'org-admin' }] });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.totals.initiatives, 2);
  for (const i of ['shams', 'sona3']) assert.equal((await del(admin, `/admin/bodies/${r.json.data.id}/links/${i}`)).status, 200);
  assert.equal((await del(admin, `/admin/bodies/${r.json.data.id}`)).status, 200);
});

test('BD-10 suggestions: the same body unlinked in two initiatives is proposed once; linking it removes the suggestion', async () => {
  let d = (await admin.get('/admin/bodies/organizations')).json.data;
  assert.ok(d.items.every((o: any) => !['factory', 'applicant'].includes(o.organization.type)), 'only participating bodies are listed');
  const admins = d.suggestions.find((s: any) => s.organizations.some((o: any) => o.organizationId === 'org-admin'));
  assert.ok(admins, 'the two «إدارة النظام» organizations are suggested together');
  assert.deepEqual(admins.organizations.map((o: any) => o.initiativeId).sort(), ['shams', 'sona3']);
  assert.ok(!d.suggestions.some((s: any) => s.organizations.some((o: any) => o.organizationId === 'org-imc')), 'linked organizations are never suggested');
  // A new funder and a new bank with the same name apart from a parenthesised part → suggested.
  const shamsAdmin = await new Client(srv.base).login('admin@shams.local');
  const sona3Admin = await new Client(srv.base).login('admin@sona3.local');
  const suffix = Date.now() % 100000;
  const bank = await shamsAdmin.post('/i/shams/admin/organizations', { type: 'bank', nameAr: `بنك التنمية الصناعية ${suffix} (فرع القاهرة)`, nameEn: 'IDB' });
  const fund = await sona3Admin.post('/i/sona3/admin/organizations', { type: 'funder', nameAr: `بنك التنمية الصناعية ${suffix}`, nameEn: 'IDB' });
  assert.equal(bank.status, 201, JSON.stringify(bank.json));
  assert.equal(fund.status, 201, JSON.stringify(fund.json));
  d = (await admin.get('/admin/bodies/organizations')).json.data;
  const idb = d.suggestions.find((s: any) => s.organizations.some((o: any) => o.organizationId === bank.json.data.id));
  assert.ok(idb, 'suggested across the two initiatives');
  assert.ok(idb.organizations.some((o: any) => o.organizationId === fund.json.data.id));
  // Link both to one body → no longer suggested.
  const b = await admin.post('/admin/bodies', { nameAr: `بنك التنمية الصناعية ${suffix}`, kind: 'financial', links: [
    { initiativeId: 'shams', organizationId: bank.json.data.id }, { initiativeId: 'sona3', organizationId: fund.json.data.id }] });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  d = (await admin.get('/admin/bodies/organizations')).json.data;
  assert.ok(!d.suggestions.some((s: any) => s.organizations.some((o: any) => o.organizationId === bank.json.data.id)));
  assert.equal(d.items.find((o: any) => o.organization.id === bank.json.data.id).body.id, b.json.data.id);
});

test('BD-11 filters: text (Arabic and English), kind, status, initiative; invalid filters are refused', async () => {
  const q = async (s: string) => ((await admin.get(`/admin/bodies?${s}`)).json.data.items as any[]).map((b) => b.id);
  assert.ok((await q(`q=${encodeURIComponent('تحديث الصناعة')}`)).includes('body-imc'));
  assert.ok((await q('q=Modernisation')).includes('body-imc'));
  assert.ok(!(await q('q=Modernisation')).includes('body-encpc'));
  const committees = await q('kind=committee');
  assert.ok(committees.includes('body-committee') && !committees.includes('body-imc'));
  const inSona3 = await q('initiativeId=sona3');
  assert.ok(inSona3.includes('body-imc') && inSona3.includes('body-committee') && !inSona3.includes('body-encpc'));
  const inShams = await q('initiativeId=shams');
  assert.ok(inShams.includes('body-imc') && inShams.includes('body-encpc') && !inShams.includes('body-committee'));
  assert.equal((await admin.get('/admin/bodies?kind=bank')).status, 400);
  assert.equal((await admin.get('/admin/bodies?status=deleted')).status, 400);
  assert.equal((await q('q=%25_%5C')).length, 0, 'LIKE wildcards are literal');
});

test('BD-12 a link grants nothing: the body\'s people keep exactly their memberships', async () => {
  const imcShams = await new Client(srv.base).login('imc1@shams.local');
  const r = await imcShams.get('/i/sona3/applications');
  assert.equal(r.status, 403, 'IMC is linked in both initiatives, but imc1 has no Sona3 membership');
  const me = (await imcShams.get('/me')).json.data;
  assert.deepEqual(me.memberships.map((m: any) => m.initiativeId), ['shams']);
});

test('BD-13 people and staff: a person working for IMC in both initiatives appears once per initiative; deactivation lowers the staff count', async () => {
  const before = await body('body-imc');
  const sona3Admin = await new Client(srv.base).login('admin@sona3.local');
  const added = await sona3Admin.post('/i/sona3/admin/users', { email: 'imc1@shams.local', nameAr: 'مراجع IMC الأول', role: 'imc_officer', organizationId: 'org-imc' });
  assert.equal(added.status, 201, JSON.stringify(added.json));
  const after = await body('body-imc');
  assert.equal(link(after, 'sona3').activity.staff, link(before, 'sona3').activity.staff + 1);
  const imc1 = after.people.filter((p: any) => p.email === 'imc1@shams.local');
  assert.deepEqual(imc1.map((p: any) => p.initiativeId).sort(), ['shams', 'sona3'], 'once per initiative');
  assert.ok(imc1.every((p: any) => p.roleLabelAr));
  // The person now chooses between two initiatives — still from their own memberships, not from the body.
  const me = (await new Client(srv.base).login('imc1@shams.local').then((c) => c.get('/me'))).json.data;
  assert.deepEqual(me.memberships.map((m: any) => m.initiativeId).sort(), ['shams', 'sona3']);
  // A deactivated account is not counted as staff.
  const imc2 = after.people.find((p: any) => p.email === 'imc2@shams.local');
  assert.equal((await admin.put(`/admin/users/${imc2.userId}`, { isActive: false })).status, 200);
  const off = await body('body-imc');
  assert.equal(link(off, 'shams').activity.staff, link(after, 'shams').activity.staff - 1);
  assert.equal((await admin.put(`/admin/users/${imc2.userId}`, { isActive: true })).status, 200);
});

test('BD-14 activity follows the real work: decisions, pending work and totals in both initiatives, per body', async () => {
  const act = async (c: Client, mod: string, id: string, action: string, extra: Record<string, unknown> = {}) => {
    const app = (await c.get(`/i/${mod}/applications/${id}`)).json.data;
    const r = await c.post(`/i/${mod}/applications/${id}/actions/${action}`, { expectedVersion: app.version, ...extra });
    assert.equal(r.status, 200, `${mod} ${action}: ${JSON.stringify(r.json)}`);
  };
  const snap = async () => {
    const all = (await admin.get('/admin/bodies')).json.data.items as any[];
    const get = (id: string, i: string) => link(all.find((b) => b.id === id), i).activity;
    return {
      imcShams: get('body-imc', 'shams'), imcSona3: get('body-imc', 'sona3'), encpc: get('body-encpc', 'shams'),
      committee: get('body-committee', 'sona3'), funder: get('body-funder-demo', 'sona3'), imcTotals: all.find((b) => b.id === 'body-imc').totals,
    };
  };
  const s0 = await snap();
  assert.equal(s0.imcTotals.decisions, s0.imcShams.decisions + s0.imcSona3.decisions, 'totals add up the initiatives');
  assert.equal(s0.imcTotals.pending, s0.imcShams.pending + s0.imcSona3.pending);

  // ── Shams: a factory submits → IMC has one more pending; IMC accepts → one decision, the work moves to ENCPC ──
  const factory = await new Client(srv.base).login('factory2@shams.local');
  const open = (await factory.get('/i/shams/factory/profile')).json.data.openApplicationId;
  if (open) await act(factory, 'shams', open, 'withdraw', { reason: 'بدء طلب جديد للاختبار' });
  const draft = (await factory.post('/i/shams/applications', {})).json.data.id;
  const sections: Record<string, unknown> = {
    general: { companyName: 'مصنع اختبار الجهات', governorate: 'sharqia', industrialZone: '10th-ramadan', address: 'المنطقة الثالثة', phone1: '0221234567' },
    contact: { contactName: 'م. أحمد', contactTitle: 'مدير', contactMobile: '01012345678', contactEmail: 'c@f.test' },
    company: { commercialRegisterNumber: 'CR-1', industrialRegistryNumber: `IND-BODY-${Date.now() % 100000}`, taxNumber: '1-2-3' },
    engineering: { roofAreas: [{ name: 'سطح', area: 1000 }], contractedCapacity: 500, capacityUnit: 'kVA', peakLoad: 400, loadUnit: 'kW', ownershipType: 'owned', ownershipExpiresAt: '2045-12-31' },
  };
  for (const [s, d] of Object.entries(sections)) assert.equal((await factory.put(`/i/shams/applications/${draft}/data/${s}`, d)).status, 200, s);
  for (const kind of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'ownershipProofFile']) assert.equal((await factory.upload(`/i/shams/applications/${draft}/documents`, { kind }, pdf(kind))).status, 201);
  for (let i = 0; i < 3; i++) assert.equal((await factory.upload(`/i/shams/applications/${draft}/documents`, { kind: 'electricityBill' }, pdf(`bill-${i}`), `bill-${i}.pdf`)).status, 201);
  await act(factory, 'shams', draft, 'submit');
  const s1 = await snap();
  assert.equal(s1.imcShams.pending, s0.imcShams.pending + 1);
  assert.equal(s1.imcSona3.pending, s0.imcSona3.pending, 'the other initiative is unaffected');
  await act(await new Client(srv.base).login('imc1@shams.local'), 'shams', draft, 'accept');
  const s2 = await snap();
  assert.equal(s2.imcShams.decisions, s1.imcShams.decisions + 1);
  assert.equal(s2.imcShams.pending, s1.imcShams.pending - 1);
  assert.equal(s2.encpc.pending, s1.encpc.pending + 1, 'now waiting for ENCPC');
  assert.ok(s2.imcShams.lastActivityAt && s2.imcShams.lastActivityAt >= (s1.imcShams.lastActivityAt ?? ''));

  // ── Sona3: the whole path through IMC, the committee and the funder ──
  const applicant = await new Client(srv.base).login('applicant@sona3.local');
  const imc = await new Client(srv.base).login('imc@sona3.local');
  const evaluator = await new Client(srv.base).login('evaluator1@sona3.local');
  const funder = await new Client(srv.base).login('funder@sona3.local');
  const id = (await applicant.post('/i/sona3/applications', {})).json.data.id;
  const nid = `2950515010${String(Date.now() % 10000).padStart(4, '0')}`.slice(0, 13) + '1';
  const app: Record<string, unknown> = {
    personal: { fullName: 'متقدم اختبار الجهات', nationalId: nid, birthDate: '1995-05-15', nationality: 'egyptian', governorate: 'cairo', address: 'القاهرة', phone: '01012345678',
      email: 'applicant@sona3.local', qualification: 'هندسة', experience: 'خبرة' },
    team: { applicationType: 'individual' },
    project: { projectName: 'مشروع اختبار الجهات', sector: 'manufacturing', projectStage: 'new_idea', projectGovernorate: 'sharqia' },
    idea: { ideaDescription: 'فكرة', problem: 'مشكلة', targetCustomers: 'مصانع', competitiveAdvantage: 'ميزة' },
    readiness: { startTimeline: 'immediate', estimatedCost: 500000, requestedFunding: 300000, hasOwnFunding: false },
    declarations: { declTermsRead: true, declDataTrue: true, declConfidentiality: true, declParticipation: true },
  };
  for (const [s, d] of Object.entries(app)) assert.equal((await applicant.put(`/i/sona3/applications/${id}/data/${s}`, d)).status, 200, s);
  assert.equal((await applicant.upload(`/i/sona3/applications/${id}/documents`, { kind: 'nationalIdFile' }, pdf('nid'))).status, 201);
  await act(applicant, 'sona3', id, 'submit');
  const t1 = await snap();
  assert.equal(t1.imcSona3.pending, s2.imcSona3.pending + 1, 'eligibility review waits for IMC');
  await act(imc, 'sona3', id, 'accept');
  const t2 = await snap();
  assert.equal(t2.imcSona3.decisions, t1.imcSona3.decisions + 1);
  assert.equal(t2.imcSona3.pending, t1.imcSona3.pending - 1, 'the study is the applicant\'s turn');
  const study: Record<string, unknown> = {
    study_market: { productName: 'منتج', technicalDescription: 'وصف', marketProblem: 'مشكلة', competitiveEdge: 'ميزة', targetSegment: 'مصانع', annualDemand: '1000', importSubstitution: false, competitors: 'منافسون', pricing: 'سعر', salesChannels: 'مباشر' },
    study_technical: { productionCapacity: '100', technologyLevel: 'semi_auto', assets: [{ item: 'ماكينة', quantity: 1, cost: 250000 }], directWorkers: 5, indirectWorkers: 2, monthlyPayroll: 60000, siteArea: 200, utilities: 'كهرباء', licenses: 'ترخيص' },
    study_financial: { establishmentCosts: 50000, workingCapital: 150000, requestedFinancing: 300000, preferredModel: 'soft_loan', firstYearRevenue: 1200000, firstYearCosts: 800000, paybackYears: 2.5, breakEvenPercent: 55 },
    study_risks: { marketRisk: 'خطر', marketMitigation: 'معالجة', operationalRisk: 'خطر', operationalMitigation: 'معالجة', financialRisk: 'خطر', financialMitigation: 'معالجة' },
    study_impact: { directJobs: 7, indirectJobs: 10, localValueAdded: 'قيمة', environmentalImpact: 'أثر' },
    study_plan: { phases: [{ title: 'المرحلة 1', weeks: 8, amount: 100000 }, { title: 'المرحلة 2', weeks: 8, amount: 200000 }] },
  };
  for (const [s, d] of Object.entries(study)) assert.equal((await applicant.put(`/i/sona3/applications/${id}/data/${s}`, d)).status, 200, s);
  await act(applicant, 'sona3', id, 'submit_study');
  assert.equal((await imc.post(`/i/sona3/applications/${id}/evaluators`, { evaluatorUserId: 's3-usr-eval-1' })).status, 201);
  const t3 = await snap();
  assert.equal(t3.committee.pending, t2.committee.pending + 1, 'an assigned evaluation is the committee\'s pending work');
  await act(imc, 'sona3', id, 'accept');
  assert.equal((await evaluator.post(`/i/sona3/applications/${id}/evaluation/coi`, { hasConflict: false })).status, 200);
  const scores = { financial: 80, technical: 80, market: 80, innovation: 80, jobs: 80, team: 80 };
  assert.equal((await evaluator.post(`/i/sona3/applications/${id}/evaluation/submit`, { scores, notes: {}, recommendation: 'recommend' })).status, 200);
  const t4 = await snap();
  assert.equal(t4.committee.decisions, t3.committee.decisions + 1, 'a submitted evaluation counts for the committee');
  assert.equal(t4.committee.pending, t3.committee.pending - 1);
  await act(imc, 'sona3', id, 'complete_evaluation');
  await act(imc, 'sona3', id, 'select', { reason: 'ضمن الترتيب' });
  assert.equal((await imc.upload(`/i/sona3/applications/${id}/documents`, { kind: 'approvalFile' }, pdf('approval'))).status, 201);
  await act(imc, 'sona3', id, 'record_approval', { approvalDate: new Date().toISOString().slice(0, 10), approvalReference: 'قرار-15' });
  // A second funder (its own body) must not see the first one's referral.
  const sona3Admin = await new Client(srv.base).login('admin@sona3.local');
  const fund2 = await sona3Admin.post('/i/sona3/admin/organizations', { type: 'funder', nameAr: `صندوق ثان ${Date.now() % 100000}`, nameEn: 'Second fund' });
  const body2 = await admin.post('/admin/bodies', { nameAr: fund2.json.data.nameAr, kind: 'financial', links: [{ initiativeId: 'sona3', organizationId: fund2.json.data.id }] });
  assert.equal(body2.status, 201, JSON.stringify(body2.json));
  await act(imc, 'sona3', id, 'refer_funder', { funderOrgId: 'org-funder-demo-1' });
  const t5 = await snap();
  assert.equal(t5.funder.pending, t4.funder.pending + 1, 'the referral waits for this funder');
  assert.equal(link(await body(body2.json.data.id), 'sona3').activity.pending, 0, 'and not for another funder');
  assert.equal(t4.imcSona3.decisions, t2.imcSona3.decisions + 1, 'the study acceptance');
  assert.equal(t5.imcSona3.decisions, t4.imcSona3.decisions + 4, 'complete evaluation, select, approval, referral');
  await act(funder, 'sona3', id, 'approve_funding', { amount: 300000, model: 'soft_loan', terms: 'سداد على 5 سنوات' });
  const t6 = await snap();
  assert.equal(t6.funder.decisions, t5.funder.decisions + 1);
  assert.equal(t6.funder.pending, t5.funder.pending - 1);
  assert.equal(t6.imcTotals.decisions, t6.imcShams.decisions + t6.imcSona3.decisions);
  assert.equal(t6.imcTotals.staff, t6.imcShams.staff + t6.imcSona3.staff);
  assert.equal(t6.encpc.decisions, s2.encpc.decisions, 'ENCPC did nothing in this test');
});

test('BD-15 audit trail: every change is recorded, links with their initiative; the auditor can read it', async () => {
  const b = await newBody({ kind: 'company', nameAr: uniqueName('سجل') });
  await admin.put(`/admin/bodies/${b.id}`, { nameEn: 'Audited' });
  await admin.put(`/admin/bodies/${b.id}`, { isActive: false });
  await admin.put(`/admin/bodies/${b.id}`, { isActive: true });
  await admin.post(`/admin/bodies/${b.id}/links`, { initiativeId: 'shams', organizationId: 'org-admin' });
  await del(admin, `/admin/bodies/${b.id}/links/shams`);
  await del(admin, `/admin/bodies/${b.id}`);
  const auditor = await new Client(srv.base).login('auditor@mobadrat.local');
  const rows = ((await auditor.get('/admin/audit-logs?entityType=platform_body&pageSize=200')).json.data.items as any[]).filter((r) => r.entityId === b.id);
  const actions = rows.map((r) => r.action).sort();
  assert.deepEqual(actions, ['body.activated', 'body.created', 'body.deactivated', 'body.deleted', 'body.linked', 'body.unlinked', 'body.updated'].sort());
  assert.equal(rows.find((r) => r.action === 'body.linked').initiativeId, 'shams');
  assert.equal(rows.find((r) => r.action === 'body.unlinked').initiativeId, 'shams');
  assert.ok(rows.every((r) => r.actorName && r.actorType === 'user'));
  // A save that changes nothing writes nothing.
  const quiet = await newBody();
  await admin.put(`/admin/bodies/${quiet.id}`, { nameAr: quiet.nameAr });
  const quietRows = ((await auditor.get('/admin/audit-logs?entityType=platform_body&pageSize=200')).json.data.items as any[]).filter((r) => r.entityId === quiet.id);
  assert.deepEqual(quietRows.map((r) => r.action), ['body.created']);
});

test('BD-16 concurrency: two bodies racing for one organization, or one body racing for two organizations of an initiative — exactly one wins', async () => {
  const a = await newBody();
  const b = await newBody();
  const race1 = await Promise.all([a, b].map((x) => admin.post(`/admin/bodies/${x.id}/links`, { initiativeId: 'shams', organizationId: 'org-admin' })));
  assert.deepEqual(race1.map((r) => r.status).sort(), [201, 409], JSON.stringify(race1.map((r) => r.json.code)));
  const winner = race1[0].status === 201 ? a : b;
  await del(admin, `/admin/bodies/${winner.id}/links/shams`);
  const shamsAdmin = await new Client(srv.base).login('admin@shams.local');
  const bank = await shamsAdmin.post('/i/shams/admin/organizations', { type: 'bank', nameAr: `بنك السباق ${Date.now() % 100000}`, nameEn: 'Race bank' });
  const race2 = await Promise.all([
    admin.post(`/admin/bodies/${a.id}/links`, { initiativeId: 'shams', organizationId: 'org-admin' }),
    admin.post(`/admin/bodies/${a.id}/links`, { initiativeId: 'shams', organizationId: bank.json.data.id }),
  ]);
  assert.deepEqual(race2.map((r) => r.status).sort(), [201, 409], JSON.stringify(race2.map((r) => r.json.code)));
  assert.equal((await body(a.id)).links.length, 1);
  await del(admin, `/admin/bodies/${a.id}/links/shams`);
});
