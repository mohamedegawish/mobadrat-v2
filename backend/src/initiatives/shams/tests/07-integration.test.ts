// اختبار القبول 18: API الربط — مفتاح بلا نطاق أو ملغى مرفوض، لا endpoint للقرارات، الـwebhook موقّع ولا يتكرر.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { isolateTestEnv, startServer, clients, advanceTo, act, getApp, q, createCompleteDraft, pdfVariant, PROVIDER_OK, BANK_A, type Started, type Client } from './helpers.js';

const env = isolateTestEnv('integration');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function createKey(scopes: string[], rateLimitPerMinute = 1000) {
  const r = await c.admin.post('/admin/integration-keys', { name: `key-${scopes.join('+')}`, scopes, rateLimitPerMinute });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.data.key.id as string, key: r.json.data.plaintextKey as string };
}

function call(key: string | null, method: string, p: string, body?: unknown, header: 'bearer' | 'x-api-key' = 'bearer') {
  const headers: Record<string, string> = {};
  if (key) headers[header === 'bearer' ? 'Authorization' : 'X-API-Key'] = header === 'bearer' ? `Bearer ${key}` : key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${srv.integration}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('18a) keys: stored hashed, scope enforced, revoked/rotated keys rejected', async () => {
  const read = await createKey(['read']);
  assert.match(read.key, /^shk_[a-f0-9]{8}_/);
  const stored = await q<{ keyHash: string }>('SELECT keyHash FROM shams_integration_keys WHERE id = ?', read.id);
  assert.notEqual(stored[0].keyHash, read.key);
  assert.equal(stored[0].keyHash.length, 64);
  // لا مفتاح / مفتاح خطأ
  assert.equal((await call(null, 'GET', '/summary')).status, 401);
  assert.equal((await call('shk_deadbeef_xxxxxxxxxxxxxxxxxxxxxxxx', 'GET', '/summary')).status, 401);
  // نطاق صحيح
  const s = await call(read.key, 'GET', '/summary');
  assert.equal(s.status, 200);
  const sj = await s.json();
  assert.ok('byState' in sj.data && 'overdue' in sj.data && 'avgDaysPerState' in sj.data);
  assert.equal((await call(read.key, 'GET', '/applications', undefined, 'x-api-key')).status, 200);
  // نطاق ناقص
  for (const p of ['/users', '/organizations', '/service-providers', '/audit-logs']) {
    const r = await call(read.key, 'GET', p);
    assert.equal(r.status, 403, p);
    assert.equal((await r.json()).code, 'INSUFFICIENT_SCOPE');
  }
  // الإلغاء
  await c.admin.post(`/admin/integration-keys/${read.id}/revoke`, {});
  assert.equal((await call(read.key, 'GET', '/summary')).status, 401);
  // التدوير: القديم يُلغى والجديد يعمل بنفس النطاقات
  const k2 = await createKey(['read', 'manage_providers']);
  const rot = await c.admin.post(`/admin/integration-keys/${k2.id}/rotate`, {});
  assert.equal(rot.status, 201);
  assert.equal((await call(k2.key, 'GET', '/summary')).status, 401);
  assert.equal((await call(rot.json.data.plaintextKey, 'GET', '/service-providers')).status, 200);
  // كل طلب ربط مُدقق
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE actorType = 'integration_key'")).length > 0);
  // غير الأدمن لا يدير المفاتيح
  assert.equal((await c.pmu.get('/admin/integration-keys')).status, 403);
});

test('H1) data scopes are disabled by project decision: no key can be created or used with them', async () => {
  for (const scope of ['read_documents', 'read_audit', 'read_full']) {
    const r = await c.admin.post('/admin/integration-keys', { name: `data-${scope}`, scopes: ['read', scope], rateLimitPerMinute: 60 });
    assert.equal(r.status, 403, scope);
    assert.equal(r.json.code, 'DATA_SCOPES_DISABLED');
  }
  assert.equal((await q("SELECT 1 FROM shams_integration_keys WHERE name LIKE 'data-%'")).length, 0, 'no key row was created');
  // مفتاح قديم بنطاق بيانات (قبل التعطيل) لا يعمل: يُدرج مباشرة كما لو أنشئ قبل القرار.
  const { createIntegrationKey } = await import('../store/integrationKeys.js');
  const legacy = await createIntegrationKey({ name: 'legacy-docs', scopes: ['read', 'read_documents'], rateLimitPerMinute: 60, createdBy: null });
  const r = await call(legacy.plaintext, 'GET', '/audit-logs');
  assert.equal(r.status, 403);
  const d = await call(legacy.plaintext, 'GET', '/applications/none/documents/none');
  assert.equal(d.status, 403);
  assert.equal((await d.json()).code, 'DATA_SCOPES_DISABLED');
});

test('M4) failed integration auth is audited once per IP window, not once per request', async () => {
  const before = (await q("SELECT 1 FROM audit_logs WHERE action = 'integration.auth_failed'")).length;
  for (let i = 0; i < 5; i++) assert.equal((await call(`shk_deadbeef_${'x'.repeat(24)}`, 'GET', '/summary')).status, 401);
  const after = (await q("SELECT 1 FROM audit_logs WHERE action = 'integration.auth_failed'")).length;
  assert.ok(after - before <= 1, `audit rows added: ${after - before}`);
});

test('18b) per-key rate limit', async () => {
  const k = await createKey(['read'], 2);
  const statuses = [];
  for (let i = 0; i < 2 * 1000 + 1; i++) {
    const r = await call(k.key, 'GET', '/summary');
    statuses.push(r.status);
    if (r.status === 429) break;
  }
  assert.ok(statuses.includes(429), 'the key is limited (scaled by RATE_LIMIT_SCALE only for site limits)');
});

test('18c) there is no decision endpoint, and manage_users cannot touch system admins', async () => {
  const all = await createKey(['read', 'manage_users', 'manage_providers']);
  const id = await advanceTo('IMC_REVIEW', c, 'IND-INT-1');
  const app = await getApp(c.imc, id);
  for (const [m, p] of [
    ['POST', `/applications/${id}/actions/accept`], ['POST', `/applications/${id}/decisions`], ['PUT', `/applications/${id}`],
    ['POST', `/applications/${id}/transitions`], ['PATCH', `/applications/${id}`], ['DELETE', `/applications/${id}`],
  ] as const) {
    const r = await call(all.key, m, p, { expectedVersion: app.version });
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  assert.equal((await getApp(c.imc, id)).state, 'IMC_REVIEW');
  // الوثيقة نفسها لا تحتوي أي عملية كتابة على الطلبات
  const spec = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'contracts', 'integration.openapi.json'), 'utf8'));
  for (const [p, ops] of Object.entries<Record<string, unknown>>(spec.paths)) {
    if (p.startsWith('/applications')) assert.deepEqual(Object.keys(ops).filter((k) => k !== 'parameters'), ['get'], p);
  }
  // تفاصيل الطلب + التنزيل
  const detail = await (await call(all.key, 'GET', `/applications/${id}`)).json();
  assert.equal(detail.data.state, 'IMC_REVIEW');
  assert.equal(detail.data.allowedActions, undefined);
  // F-02: السجل التاريخي وصفي (حالات وإجراء ودور وتوقيت)، والمستندات لم تعد جزءًا من عرض الربط — المعرّف من القاعدة (التفاصيل في اختبار F-02).
  assert.ok(detail.data.history.length >= 1);
  assert.equal(detail.data.documents, undefined);
  const doc = (await q<{ id: string }>('SELECT id FROM shams_documents WHERE applicationId = ? LIMIT 1', id))[0];
  // تنزيل المستندات يحتاج read_documents وهو معطل: لا مفتاح من هذا الاختبار يستطيع التنزيل.
  const dl = await call(all.key, 'GET', `/applications/${id}/documents/${doc.id}`);
  assert.equal(dl.status, 403);
  // إدارة الحسابات (H2): الربط يسجل طلبًا تعتمده الجهة، لا ينشئ حسابًا ولا يرجع كلمة مؤقتة. system_admin ممنوع.
  const created = await call(all.key, 'POST', '/users', { email: 'new.pmu@shams.local', nameAr: 'مستخدم PMU جديد', role: 'pmu_reviewer', organizationId: 'org-pmu' });
  assert.equal(created.status, 202);
  const cj = await created.json();
  assert.equal(cj.data.user, null);
  assert.equal(cj.data.request.status, 'pending');
  assert.equal(cj.data.temporaryPassword, undefined);
  assert.equal((await q("SELECT 1 FROM users WHERE email = 'new.pmu@shams.local'")).length, 0, 'no account exists before approval');
  assert.equal((await call(all.key, 'POST', '/users', { email: 'evil@shams.local', nameAr: 'مدير', role: 'system_admin', organizationId: 'org-admin' })).status, 400);
  assert.equal((await call(all.key, 'PUT', '/users/usr-admin', { isActive: false })).status, 403);
  // مقدمو الخدمة
  const sp = await call(all.key, 'POST', '/service-providers', { nameAr: 'مقدم خدمة عبر الربط' });
  assert.equal(sp.status, 201);
  const spj = await sp.json();
  // M5: الربط لا يعتمد مقدمي الخدمة ولا يوقفهم (قرار PMU فقط).
  assert.equal((await call(all.key, 'PUT', `/service-providers/${spj.data.id}`, { status: 'approved' })).status, 400);
  assert.equal((await call(all.key, 'PUT', `/service-providers/${spj.data.id}`, { notes: 'ملاحظة' })).status, 200);
  assert.equal((await q<{ status: string }>('SELECT status FROM shams_service_providers WHERE id = ?', spj.data.id))[0].status, 'pending');
});

test('18d) webhook: HMAC-signed, same eventId on retry, never re-sent after delivery', async () => {
  const secret = 'w'.repeat(40);
  const received: Array<{ id: string; ts: string; sig: string; body: string }> = [];
  const seen = new Set<string>();
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const id = String(req.headers['x-shams-event-id']);
      received.push({ id, ts: String(req.headers['x-shams-timestamp']), sig: String(req.headers['x-shams-signature']), body });
      // أول محاولة لكل حدث تفشل → يجب أن يُعاد إرساله بنفس eventId.
      if (!seen.has(id)) { seen.add(id); res.writeHead(500); res.end(); return; }
      res.writeHead(204); res.end();
    });
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', () => r()));
  process.env.SHAMS_WEBHOOK_URL = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hooks`;
  process.env.SHAMS_WEBHOOK_SECRET = secret;
  try {
    const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء' });
    const id = await advanceTo('IMC_REVIEW', c, 'IND-HOOK-1');
    const rows = await q<{ id: string; eventId: string; status: string }>(
      "SELECT w.id, w.eventId, w.status FROM shams_webhook_outbox w JOIN shams_application_transitions t ON t.id = w.transitionId WHERE t.applicationId = ? AND t.toState = 'IMC_REVIEW'", id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
    const { processWebhooks } = await import('../jobs/webhookWorker.js');
    const first = await processWebhooks();
    assert.equal(first.retried >= 1, true);
    // تقديم موعد إعادة المحاولة ثم تشغيل العامل مجددًا
    const { getDb } = await import('../db/database.js');
    await getDb().prepare("UPDATE shams_webhook_outbox SET nextAttemptAt = '2000-01-01T00:00:00.000Z' WHERE status = 'pending'").run();
    await processWebhooks();
    const forThis = received.filter((r) => r.id === rows[0].eventId);
    assert.equal(forThis.length, 2, 'one failed attempt + one retry');
    assert.equal(new Set(forThis.map((r) => r.id)).size, 1, 'same eventId on retry');
    for (const r of forThis) {
      const expected = `v1=${createHmac('sha256', secret).update(`${r.ts}.${r.body}`).digest('hex')}`;
      assert.equal(r.sig, expected, 'valid HMAC signature');
      const payload = JSON.parse(r.body);
      assert.equal(payload.type, 'application.state_changed');
      assert.equal(payload.id, rows[0].eventId);
      assert.equal(payload.data.toState, 'IMC_REVIEW');
    }
    const status = await q<{ status: string }>('SELECT status FROM shams_webhook_outbox WHERE id = ?', rows[0].id);
    assert.equal(status[0].status, 'delivered');
    // لا إعادة إرسال بعد التسليم
    await getDb().prepare("UPDATE shams_webhook_outbox SET nextAttemptAt = '2000-01-01T00:00:00.000Z'").run();
    const before = received.length;
    await processWebhooks();
    assert.equal(received.filter((r) => r.id === rows[0].eventId).length, 2);
    assert.ok(received.length >= before);
  } finally {
    delete process.env.SHAMS_WEBHOOK_URL;
    delete process.env.SHAMS_WEBHOOK_SECRET;
    await new Promise((r) => hook.close(() => r(null)));
  }
});

// ── F-02: API الربط بنطاق read يعرض بيانات وصفية فقط (قرار المشروع 3) — قائمة سماح صريحة، لا حذف حقول من العرض الكامل ──
const SECRET = {
  deficiency: 'SECRET-DEFICIENCY-NOTE-7731', offerReason: 'SECRET-OFFER-REASON-7732', bankNotes: 'SECRET-BANK-NOTES-7733',
  contractNotes: 'SECRET-CONTRACT-NOTES-7734', rejectReason: 'SECRET-REJECT-REASON-7735', amount: 7654321.5,
  tax: '555-444-333', origTax: '123-456-789', email: 'contact@factory.test', mobile: '01012345678', contactName: 'م. أحمد',
  company: 'مصنع تجريبي للصناعات المعدنية', address: 'المنطقة الصناعية الثالثة', distribution: 'شركة توزيع (اختبار)',
};
const LIST_KEYS = ['bank', 'closedAt', 'contractPath', 'createdAt', 'daysInState', 'dueAt', 'governorate', 'id', 'industrialZone', 'number', 'overdue', 'responsible',
  'stateEnteredAt', 'state', 'stateLabelAr', 'stateLabelEn', 'step', 'submittedAt', 'updatedAt'].sort();
const FORBIDDEN_KEYS = ['companyName', 'industrialRegistryNumber', 'totalRoofArea', 'attempt', 'version', 'factoryId', 'data', 'registry', 'registryConflicts', 'provider',
  'referralHistory', 'bankReferral', 'referralSummary', 'documents', 'deficiencies', 'returnCounts', 'allowedActions', 'editableFields', 'currentTask',
  'reason', 'note', 'actorName', 'actorOrgId', 'sha256', 'originalName', 'storedName', 'facility', 'taxNumber', 'contactEmail', 'contactMobile', 'contactName',
  'address', 'contractAmount', 'contractNotes', 'bankNotes', 'studyResult', 'notContractedReason', 'orgId', 'orgNameAr', 'orgNameEn', 'logoUrl', 'url', 'path'];

function allKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); allKeys(x, out); }
  return out;
}

async function freeFactory(cl: Client) {
  const open = (await cl.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(cl, open, 'withdraw', { reason: 'إنهاء' });
}

/** طلب يمر بكل المراحل ويحمل كل أنواع البيانات الحساسة (نواقص، أسباب، ملاحظات بنك، قيمة تعاقد) حتى CONTRACTED. */
async function richContractedApplication(): Promise<string> {
  const ok = (r: { status: number; json: unknown }, step: string) => assert.equal(r.status, 200, `${step}: ${JSON.stringify(r.json)}`);
  await freeFactory(c.factory);
  const id = await createCompleteDraft(c.factory, 'IND-META-1');
  ok(await act(c.factory, id, 'submit'), 'submit');
  ok(await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'taxNumber', note: SECRET.deficiency }] }), 'imc correction');
  assert.equal((await c.factory.put(`/applications/${id}/data/company`, { taxNumber: SECRET.tax })).status, 200);
  ok(await act(c.factory, id, 'resubmit'), 'resubmit');
  ok(await act(c.imc, id, 'accept'), 'imc accept');
  ok(await act(c.encpc, id, 'compliant'), 'encpc compliant');
  ok(await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK }), 'select provider');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('meta-offer-1'), 'offer-private-name.pdf')).status, 201);
  ok(await act(c.factory, id, 'submit_offer'), 'submit offer');
  ok(await act(c.pmu, id, 'request_correction', { reason: SECRET.offerReason }), 'pmu offer correction');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('meta-offer-2'), 'offer-private-name-2.pdf')).status, 201);
  ok(await act(c.factory, id, 'resubmit'), 'offer resubmit');
  ok(await act(c.pmu, id, 'accept'), 'pmu accept offer');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('meta-elec'), 'approval-private-name.pdf')).status, 201);
  ok(await act(c.factory, id, 'submit_electricity', { distributionCompany: SECRET.distribution }), 'submit electricity');
  ok(await act(c.pmu, id, 'accept'), 'pmu accept electricity');
  ok(await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A }), 'select bank');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, pdfVariant('meta-contract'), 'contract-private-name.pdf')).status, 201);
  ok(await act(c.factory, id, 'record_contract', { contractDate: '2026-10-20', contractAmount: SECRET.amount, contractNotes: SECRET.contractNotes }), 'record contract');
  return id;
}

test('F-02) integration `read` returns an explicit metadata allowlist only — nothing private, even nested', async () => {
  const contractedId = await richContractedApplication();
  await freeFactory(c.factory2);
  const rejectedId = await createCompleteDraft(c.factory2, 'IND-META-2');
  assert.equal((await act(c.factory2, rejectedId, 'submit')).status, 200);
  assert.equal((await act(c.imc, rejectedId, 'reject', { reason: SECRET.rejectReason, reasonCode: 'other' })).status, 200);

  const rich = await getApp(c.pmu, contractedId);
  const providerName: string = rich.provider.nameAr;
  const docRows = await q<{ originalName: string; sha256: string; storedName: string }>('SELECT originalName, sha256, storedName FROM shams_documents WHERE applicationId = ?', contractedId);
  const factoryId: string = (await q<{ factoryId: string }>('SELECT factoryId FROM shams_applications WHERE id = ?', contractedId))[0].factoryId;
  const allSecrets = [
    ...Object.values(SECRET).map(String), 'IND-META-1', 'IND-META-2', providerName, factoryId,
    ...docRows.flatMap((d) => [d.originalName, d.sha256, d.storedName]), 'offer-private-name', 'approval-private-name', 'contract-private-name',
  ];

  const read = await createKey(['read']);
  const listRes = await call(read.key, 'GET', '/applications?pageSize=200&includeDrafts=1');
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  const detailRes = await call(read.key, 'GET', `/applications/${contractedId}`);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  const rejectedDetail = await (await call(read.key, 'GET', `/applications/${rejectedId}`)).json();

  // 1) المفاتيح بالضبط: قائمة سماح لا تتسع تلقائيًا بإضافة أعمدة جديدة
  const items: any[] = list.data.items;
  assert.ok(items.length >= 2);
  for (const it of items) {
    assert.deepEqual(Object.keys(it).sort(), LIST_KEYS, `list item ${it.id}`);
    assert.deepEqual(Object.keys(it.responsible).sort(), ['labelAr', 'labelEn', 'type']);
    if (it.bank) assert.deepEqual(Object.keys(it.bank).sort(), ['id', 'nameAr', 'nameEn']);
  }
  for (const d of [detail.data, rejectedDetail.data]) {
    assert.deepEqual(Object.keys(d).sort(), [...LIST_KEYS, 'history'].sort());
    for (const h of d.history) assert.deepEqual(Object.keys(h).sort(), ['action', 'actorRole', 'createdAt', 'fromState', 'toState']);
  }
  assert.equal(detail.data.state, 'CONTRACTED');
  assert.equal(detail.data.number, rich.number);
  assert.ok(detail.data.history.length >= 10, 'workflow history is still available (states, actions, roles, times)');
  assert.equal(rejectedDetail.data.state, 'REJECTED');

  // 2) سلبي لكل حقل حساس: لا يظهر كمفتاح في أي مستوى
  const keys = new Set([...allKeys(list.data), ...allKeys(detail.data), ...allKeys(rejectedDetail.data)]);
  for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `forbidden key "${k}" must not appear`);

  // 3) سلبي لكل قيمة حساسة مزروعة: لا تظهر في أي نص من الردود
  const blob = JSON.stringify([list, detail, rejectedDetail]);
  for (const s of allSecrets) assert.ok(!blob.includes(s), `secret value leaked: ${s}`);
  assert.ok(!/\.pdf|sha256|download/i.test(blob), 'no document names, hashes or download hints');

  // 4) البحث لا يتجسس على حقول مستبعدة: رقم الطلب فقط
  const byNumber = await (await call(read.key, 'GET', `/applications?q=${encodeURIComponent(rich.number)}`)).json();
  assert.equal(byNumber.data.items.length, 1);
  for (const probe of ['IND-META-1', 'IND-META-2', 'مصنع تجريبي']) {
    const r = await (await call(read.key, 'GET', `/applications?q=${encodeURIComponent(probe)}&includeDrafts=1`)).json();
    assert.equal(r.data.items.length, 0, `q must not search "${probe}"`);
  }

  // 5) لا تصعيد: مفتاح قديم بنطاق read_full يحصل على العرض الوصفي نفسه، ونطاقات البيانات الأخرى ما زالت مرفوضة
  const { createIntegrationKey } = await import('../store/integrationKeys.js');
  const legacy = await createIntegrationKey({ name: 'legacy-full', scopes: ['read', 'read_full', 'read_documents', 'read_audit'], rateLimitPerMinute: 1000, createdBy: null });
  const ld = await (await call(legacy.plaintext, 'GET', `/applications/${contractedId}`)).json();
  assert.deepEqual(Object.keys(ld.data).sort(), [...LIST_KEYS, 'history'].sort(), 'read_full does not widen the response');
  assert.ok(!JSON.stringify(ld).includes(SECRET.bankNotes));
  const docId = (await q<{ id: string }>('SELECT id FROM shams_documents WHERE applicationId = ? LIMIT 1', contractedId))[0].id;
  const dl = await call(legacy.plaintext, 'GET', `/applications/${contractedId}/documents/${docId}`);
  assert.equal(dl.status, 403);
  assert.equal((await dl.json()).code, 'DATA_SCOPES_DISABLED');
  assert.equal((await call(legacy.plaintext, 'GET', '/audit-logs')).status, 403);

  // 6) ما زال محفوظًا: غير موجود 404، ومفتاح بلا نطاق read مرفوض، والملخص التجميعي يعمل
  assert.equal((await call(read.key, 'GET', '/applications/none')).status, 404);
  const providersOnly = await createKey(['manage_providers']);
  assert.equal((await call(providersOnly.key, 'GET', `/applications/${contractedId}`)).status, 403);
  const summary = await (await call(read.key, 'GET', '/summary')).json();
  assert.ok('byState' in summary.data && summary.data.total >= 2);
  assert.ok(!JSON.stringify(summary).includes('IND-META-1'));
});
