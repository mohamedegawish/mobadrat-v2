// دليل مقدمي الخدمة (ENCPC): إدارة بالدور، الظهور للمصنع (تفعيل ENCPC + اعتماد PMU ★)، الشعار، بريد الاختيار، وضمانات الاختيار.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, pdfVariant, q, Client, PDF, sentMails, type Started } from './helpers.js';

const env = isolateTestEnv('directory');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-DIR-${++seq}`;

// PNG 1×1 صالح، وJPEG بترويسة صحيحة، وSVG (مرفوض) وPDF (مرفوض)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary'), Buffer.alloc(32, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
async function flushMail() {
  const { processNotifications } = await import('../src/jobs/notificationWorker.js');
  await processNotifications(200);
}
const factoryList = async (client: Client = c.factory) => (await client.get('/service-providers')).json.data.items as Array<Record<string, any>>;
async function newProvider(extra: Record<string, unknown> = {}) {
  const r = await c.encpc.post('/service-providers', { nameAr: `مقدم خدمة اختبار ${++seq}`, description: 'تفاصيل المقدم للاختبار', website: 'provider.example', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data as Record<string, any>;
}
async function publish(id: string) {
  assert.equal((await c.encpc.post(`/service-providers/${id}/activate`, {})).status, 200);
  assert.equal((await c.pmu.post(`/service-providers/${id}/approve`, {})).status, 200);
}

test('governance: ENCPC manages the directory; PMU only approves/suspends; nobody else touches it', async () => {
  const body = { nameAr: 'مقدم بصلاحيات', description: 'وصف' };
  for (const [role, client] of [['pmu', c.pmu], ['admin', c.admin], ['factory', c.factory], ['imc', c.imc]] as const) {
    assert.equal((await client.post('/service-providers', body)).status, 403, `${role} cannot add`);
  }
  const p = await newProvider();
  assert.equal(p.isActive, false, 'new provider starts inactive');
  assert.equal(p.status, 'pending');
  assert.equal(p.selectable, false);
  for (const [role, client] of [['pmu', c.pmu], ['admin', c.admin], ['factory', c.factory], ['imc', c.imc]] as const) {
    assert.equal((await client.put(`/service-providers/${p.id}`, { description: 'x' })).status, 403, `${role} cannot edit`);
    assert.equal((await client.post(`/service-providers/${p.id}/activate`, {})).status, 403, `${role} cannot activate`);
    assert.equal((await client.post(`/service-providers/${p.id}/deactivate`, {})).status, 403, `${role} cannot deactivate`);
    assert.equal((await client.post(`/service-providers/${p.id}/logo`, {})).status, 403, `${role} cannot upload a logo`);
  }
  // ENCPC لا تعتمد ولا توقف (قرار PMU ★)، والأدمن والمصنع كذلك
  for (const [role, client] of [['encpc', c.encpc], ['admin', c.admin], ['factory', c.factory]] as const) {
    assert.equal((await client.post(`/service-providers/${p.id}/approve`, {})).status, 403, `${role} cannot approve`);
    assert.equal((await client.post(`/service-providers/${p.id}/suspend`, {})).status, 403, `${role} cannot suspend`);
  }
  const edited = await c.encpc.put(`/service-providers/${p.id}`, { description: 'وصف محدّث', nameEn: 'Test Provider' });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.data.description, 'وصف محدّث');
  assert.equal((await c.encpc.put(`/service-providers/${p.id}`, { status: 'approved' })).status, 400, 'status is not editable as a field');
  assert.equal((await c.encpc.put(`/service-providers/${p.id}`, { isActive: true })).status, 400);
  assert.equal((await c.encpc.post('/service-providers', { description: 'بلا اسم' })).status, 400);
  assert.equal((await c.encpc.put('/service-providers/sp-none', { description: 'x' })).status, 404);
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE action = 'provider.update' AND entityId = ?", p.id)).length >= 1);
});

test('visibility: a provider reaches factories only when ENCPC activated it AND the PMU approved it (★); deactivation hides it again', async () => {
  const p = await newProvider({ contactEmail: 'secret@provider.example', contactPhone: '01000000999' });
  const ids = async () => (await factoryList()).map((x) => x.id);
  assert.ok(!(await ids()).includes(p.id), 'inactive + pending: hidden');
  assert.equal((await c.encpc.post(`/service-providers/${p.id}/activate`, {})).status, 200);
  assert.ok(!(await ids()).includes(p.id), 'activated but not approved by PMU: hidden');
  await flushMail();
  assert.ok(sentMails.some((m) => m.to.includes('pmu@shams.local') && /بانتظار اعتمادكم/.test(m.subject)), 'PMU told a provider awaits approval');
  assert.equal((await c.pmu.post(`/service-providers/${p.id}/approve`, {})).status, 200);
  const shown = (await factoryList()).find((x) => x.id === p.id);
  assert.ok(shown, 'activated + approved: visible');
  assert.equal(shown!.description, 'تفاصيل المقدم للاختبار');
  assert.equal(shown!.website, 'https://provider.example', 'website normalized');
  // الدليل = اسم + تفاصيل + شعار + موقع: لا بيانات اتصال للمصنع
  for (const k of ['contactEmail', 'contactPhone', 'contactName', 'notes', 'isActive', 'selectable']) assert.equal(k in shown!, false, `factory must not receive ${k}`);
  const mgr = (await c.encpc.get('/service-providers')).json.data.items.find((x: any) => x.id === p.id);
  assert.equal(mgr.contactEmail, 'secret@provider.example', 'ENCPC sees contact details');
  assert.equal(mgr.selectable, true);
  assert.ok((await c.pmu.get('/service-providers')).json.data.items.some((x: any) => x.id === p.id));
  for (const client of [c.imc, c.admin]) assert.ok((await factoryList(client)).some((x) => x.id === p.id) && !('contactEmail' in (await factoryList(client))[0]), 'other roles see the public view');
  // إلغاء التفعيل يخفيه، ولا يمكن اختياره
  assert.equal((await c.encpc.post(`/service-providers/${p.id}/deactivate`, {})).status, 200);
  assert.ok(!(await ids()).includes(p.id));
  await closeOpen();
  const appId = await advanceTo('PROVIDER_SELECTION', c, reg());
  const sel = await act(c.factory, appId, 'select_provider', { providerId: p.id });
  assert.equal(sel.status, 422);
  assert.equal(sel.json.code, 'PROVIDER_NOT_APPROVED');
  // إعادة التفعيل تعيده (الاعتماد ما زال قائمًا)
  assert.equal((await c.encpc.post(`/service-providers/${p.id}/activate`, {})).status, 200);
  assert.ok((await ids()).includes(p.id));
  assert.equal((await act(c.factory, appId, 'select_provider', { providerId: p.id })).status, 200);
});

test('gate off (providerApprovalRequired = false): ENCPC activation alone publishes; PMU approve/suspend are refused', async () => {
  const { shamsPolicy } = await import('../src/config/shamsPolicy.js');
  shamsPolicy.providerApprovalRequired = false;
  try {
    const p = await newProvider();
    assert.equal((await c.encpc.post(`/service-providers/${p.id}/activate`, {})).status, 200);
    assert.ok((await factoryList()).some((x) => x.id === p.id), 'visible with no PMU approval');
    const r = await c.pmu.post(`/service-providers/${p.id}/approve`, {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'PROVIDER_APPROVAL_DISABLED');
    assert.equal((await c.pmu.post(`/service-providers/${p.id}/suspend`, {})).status, 409);
    await closeOpen();
    const appId = await advanceTo('PROVIDER_SELECTION', c, reg());
    assert.equal((await act(c.factory, appId, 'select_provider', { providerId: p.id })).status, 200);
    // إلغاء التفعيل يعمل بنفس الأثر
    assert.equal((await c.encpc.post(`/service-providers/${p.id}/deactivate`, {})).status, 200);
    assert.ok(!(await factoryList()).some((x) => x.id === p.id));
  } finally { shamsPolicy.providerApprovalRequired = true; }
});

test('logo: PNG/JPEG/WebP only (magic bytes), size-limited, replaced files are deleted, served only to those allowed', async () => {
  const p = await newProvider();
  const up = (file: Buffer | null, name = 'logo.png', mime = 'image/png') => c.encpc.upload(`/service-providers/${p.id}/logo`, {}, file, name, mime);
  // مرفوض: بلا ملف، SVG، PDF بامتداد صورة، نص بامتداد صورة
  assert.equal((await up(null)).status, 400);
  assert.equal((await up(SVG, 'logo.svg', 'image/svg+xml')).status, 400);
  assert.equal((await up(PDF, 'logo.png', 'image/png')).status, 400, 'a PDF renamed .png is refused');
  assert.equal((await up(Buffer.from('just text, not an image at all'), 'logo.png')).status, 400);
  assert.equal((await up(Buffer.concat([PNG, Buffer.alloc(1_100_000)]))).status, 413, 'over 1 MB');
  assert.equal((await q<{ logoStoredName: string | null }>('SELECT logoStoredName FROM service_providers WHERE id = ?', p.id))[0].logoStoredName, null);
  // مقبول
  const ok = await up(PNG);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.hasLogo, true);
  assert.match(ok.json.data.logoUrl, /^\/api\/v1\/service-providers\/.+\/logo\?v=/);
  const { config } = await import('../src/config.js');
  const row1 = (await q<{ logoStoredName: string; logoMime: string }>('SELECT logoStoredName, logoMime FROM service_providers WHERE id = ?', p.id))[0];
  assert.equal(row1.logoMime, 'image/png');
  assert.match(row1.logoStoredName, /^[0-9a-f-]{36}\.png$/, 'random name, not the uploaded file name');
  const file1 = path.join(config.uploadDir, 'providers', row1.logoStoredName);
  assert.ok(fs.existsSync(file1));
  // استبدال: الجديد يُحفظ والقديم يُحذف
  assert.equal((await up(JPEG, 'new.jpg', 'image/jpeg')).status, 200);
  const row2 = (await q<{ logoStoredName: string; logoMime: string }>('SELECT logoStoredName, logoMime FROM service_providers WHERE id = ?', p.id))[0];
  assert.equal(row2.logoMime, 'image/jpeg');
  assert.notEqual(row2.logoStoredName, row1.logoStoredName);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(file1), false, 'the replaced logo file is deleted');
  assert.ok(fs.existsSync(path.join(config.uploadDir, 'providers', row2.logoStoredName)));
  // التقديم: غير المنشور لـENCPC وPMU فقط (404 لغيرهم)، وبعد النشر لكل مسجَّل، ولا دخول بلا توكن
  const get = (client: Client) => fetch(`${srv.base}/service-providers/${p.id}/logo`, { headers: client.token ? { Authorization: `Bearer ${client.token}` } : {} });
  assert.equal((await get(c.encpc)).status, 200);
  assert.equal((await get(c.pmu)).status, 200);
  for (const client of [c.factory, c.factory2, c.imc, c.admin]) assert.equal((await get(client)).status, 404, 'hidden provider: no logo for others');
  await publish(p.id);
  const res = await get(c.factory);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.equal((await get(new Client(srv.base))).status, 401);
  assert.equal((await fetch(`${srv.base}/service-providers/sp-none/logo`, { headers: { Authorization: `Bearer ${c.factory.token}` } })).status, 404);
  // ملف مؤقت لغير المخوَّل لا يبقى في التخزين
  const before = fs.readdirSync(path.join(config.uploadDir, 'tmp')).length;
  assert.equal((await c.factory.upload(`/service-providers/${p.id}/logo`, {}, PNG)).status, 403);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.readdirSync(path.join(config.uploadDir, 'tmp')).length, before, 'the rejected upload left no temp file');
});

test('selection email: lists the available providers (name, details, website), embeds logos, links to the in-account page, carries no token', async () => {
  await closeOpen();
  const withLogo = await newProvider({ nameAr: 'مقدم بشعار للبريد', description: 'خبرة في الطاقة الشمسية الصناعية' });
  assert.equal((await c.encpc.upload(`/service-providers/${withLogo.id}/logo`, {}, PNG, 'l.png', 'image/png')).status, 200);
  await publish(withLogo.id);
  const hidden = await newProvider({ nameAr: 'مقدم غير مفعّل لن يظهر' });
  const appId = await advanceTo('ENCPC_REVIEW', c, reg());
  sentMails.length = 0;
  assert.equal((await act(c.encpc, appId, 'compliant')).status, 200);
  await flushMail();
  // الصندوق قد يحمل رسائل مطابقة قديمة من اختبارات سابقة: نختار رسالة هذا الطلب بالذات برابطه.
  const mail = sentMails.find((m) => m.to.includes('factory@shams.local') && /اختر مقدم الخدمة/.test(m.subject) && m.html.includes(`#task/${appId}`));
  assert.ok(mail, 'factory email sent');
  assert.match(mail!.html, /مقدم بشعار للبريد/);
  assert.match(mail!.html, /خبرة في الطاقة الشمسية الصناعية/);
  assert.match(mail!.html, /مقدم خدمة تجريبي \(1\)/, 'the seeded approved providers are listed too');
  assert.doesNotMatch(mail!.html, new RegExp(hidden.nameAr), 'inactive/unapproved providers are not listed');
  assert.match(mail!.html, new RegExp(`cid:provider-logo-${withLogo.id}`), 'logo referenced inline');
  assert.ok(mail!.attachments.some((a) => a.cid === `provider-logo-${withLogo.id}`), 'logo attached for inline display');
  assert.ok(!mail!.attachments.some((a) => a.cid === `provider-logo-${hidden.id}`));
  assert.match(mail!.html, new RegExp(`#task/${appId}`), 'the CTA opens the selection page of this application');
  assert.doesNotMatch(mail!.html, /#task\/[^"]*[?&]token|[a-f0-9]{64}/, 'no token or secret in the link');
  assert.match(mail!.text, /مقدم بشعار للبريد/, 'the plain-text part lists the providers as well');
  assert.doesNotMatch(mail!.html, /secret@provider|contactEmail/, 'no contact data in the email');
  // لا اختيار بمجرد معرفة الرابط: يلزم تسجيل دخول المالك
  const anon = new Client(srv.base);
  assert.equal((await anon.get(`/applications/${appId}`)).status, 401);
  assert.equal((await anon.post(`/applications/${appId}/actions/select_provider`, { expectedVersion: 1, providerId: withLogo.id })).status, 401);
  const v = (await getApp(c.factory, appId)).version;
  for (const other of [c.factory2, c.imc, c.pmu, c.admin]) {
    const r = await other.post(`/applications/${appId}/actions/select_provider`, { expectedVersion: v, providerId: withLogo.id });
    assert.ok([403, 404].includes(r.status), `forwarded link used by another account -> ${r.status}`);
  }
  assert.equal((await getApp(c.factory, appId)).state, 'PROVIDER_SELECTION', 'nothing changed');
  // المالك يختار من لوحته (الصفحة نفسها): يُحفظ المقدم والتوقيت، ولا اختيار مزدوج
  const sel = await act(c.factory, appId, 'select_provider', { providerId: withLogo.id });
  assert.equal(sel.status, 200, JSON.stringify(sel.json));
  const view = await getApp(c.factory, appId);
  assert.equal(view.state, 'OFFER_UPLOAD');
  assert.equal(view.provider.id, withLogo.id);
  const t = view.transitions.find((x: any) => x.action === 'select_provider');
  assert.ok(t && Date.parse(t.createdAt) > 0, 'selection timestamp recorded');
  assert.equal((await act(c.factory, appId, 'select_provider', { providerId: 'sp-demo-2' })).status, 409, 'no second selection');
});

test('deactivating a provider through ENCPC returns offer-stage applications to OFFER_UPLOAD (rule F) with ENCPC as the accountable actor', async () => {
  await closeOpen();
  const p = await newProvider();
  await publish(p.id);
  const appId = await advanceTo('PROVIDER_SELECTION', c, reg());
  assert.equal((await act(c.factory, appId, 'select_provider', { providerId: p.id })).status, 200);
  assert.equal((await c.factory.upload(`/applications/${appId}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('dir-offer'), 'offer.pdf')).status, 201);
  assert.equal((await act(c.factory, appId, 'submit_offer')).status, 200);
  assert.equal((await getApp(c.pmu, appId)).state, 'OFFER_REVIEW');
  assert.equal((await c.encpc.post(`/service-providers/${p.id}/deactivate`, {})).status, 200);
  const view = await getApp(c.pmu, appId);
  assert.equal(view.state, 'OFFER_UPLOAD');
  const t = view.transitions.find((x: any) => x.action === 'provider_suspended_return');
  assert.ok(t);
  assert.equal(t.actorRole, 'encpc_reviewer');
  assert.ok((await getApp(c.factory, appId)).allowedActions.some((a: any) => a.action === 'select_provider'));
});

test('integration API cannot publish a provider: created inactive and pending, status/activation not settable', async () => {
  const k = await c.admin.post('/admin/integration-keys', { name: 'providers-key', scopes: ['manage_providers'], rateLimitPerMinute: 100 });
  assert.equal(k.status, 201);
  const key = k.json.data.plaintextKey as string;
  const call = (method: string, p: string, body?: unknown) => fetch(`${srv.integration}${p}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const created = await call('POST', '/service-providers', { nameAr: 'مقدم عبر الربط' });
  assert.equal(created.status, 201);
  const id = (await created.json()).data.id as string;
  assert.ok(!(await factoryList()).some((x) => x.id === id), 'not visible to factories');
  assert.equal((await call('PUT', `/service-providers/${id}`, { isActive: true })).status, 400);
  assert.equal((await call('PUT', `/service-providers/${id}`, { status: 'approved' })).status, 400);
  const row = (await q<{ isActive: number; status: string }>('SELECT isActive, status FROM service_providers WHERE id = ?', id))[0];
  assert.equal(row.isActive, 0);
  assert.equal(row.status, 'pending');
});
