// إصلاحات مراجعة القبول (docs/FIX_REPORT.md) — المصنع: انتحال رقم السجل (I3/M1)، الاسترداد الإداري (I10)، مستلمو الإشعارات (M11)،
// إيصال الاستلام وقناة الاستفسار (I9)، الأرقام العربية والموقع (I2)، التنبيه عند إعادة التقديم دون تعديل (M8)، الملخص الإنجليزي (M7)، النص العام (B3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, q, Client, DEV, PDF, sentMails, registerFactory, registrationPayload, type Started } from './helpers.js';

const env = isolateTestEnv('identity');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-ID-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}

test('I3: duplicate registry number → conflict recorded, IMC and PMU notified once with both numbers, objection path shown', async () => {
  await closeOpen();
  const number = reg();
  const holder = await advanceTo('IMC_REVIEW', c, number);
  const draft = await createCompleteDraft(c.factory2, number);
  const r = await act(c.factory2, draft, 'submit');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'DUPLICATE_REGISTRY');
  assert.match(r.json.messageAr, /أُبلغت IMC ووحدة إدارة المبادرة/);
  assert.match(r.json.messageAr, /فاعترض/);
  assert.equal((await act(c.factory2, draft, 'submit')).status, 409);
  const rows = await q<{ attempts: number }>('SELECT attempts FROM registry_conflicts WHERE attemptedApplicationId = ? AND holdingApplicationId = ?', draft, holder);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempts, 2);
  const mails = await q<{ recipientAddress: string; body: string }>("SELECT recipientAddress, body FROM notification_outbox WHERE templateKey = 'ops.registry_conflict' AND applicationId = ?", holder);
  const to = mails.map((m) => m.recipientAddress).sort();
  assert.deepEqual(to, ['imc1@shams.local', 'imc2@shams.local', 'pmu@shams.local'], 'once per recipient');
  const holderNo = (await getApp(c.imc, holder)).number;
  assert.ok(mails[0].body.includes(holderNo) && mails[0].body.includes('مصنع تجريبي للصناعات المعدنية'));
  // IMC يرى التعارض في الطلب المفتوح
  const v = await getApp(c.imc, holder);
  assert.equal(v.registryConflicts.length, 1);
  assert.equal(v.registryConflicts[0].thisApplicationHoldsNumber, true);
  assert.equal(v.registryConflicts[0].other.id, draft);
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE action = 'application.registry_conflict' AND applicationId = ?", draft)).length === 2);
  // M1: بيانات السجل بتسميات عربية + تمييز عدم تطابق الاسم (لا منع)
  const labels = v.registry.fields.map((f: any) => f.labelAr);
  assert.ok(labels.includes('اسم المنشأة في السجل') && labels.includes('حالة القيد'));
  assert.ok(v.registry.fields.some((f: any) => f.key === 'status' && f.valueAr === 'سارٍ'));
  assert.equal(v.registry.nameCheck.matches, false, 'mock facility name differs from the company name');
  assert.ok(v.allowedActions.some((a: any) => a.action === 'accept'), 'no automatic block');
  assert.equal((await getApp(c.encpc, holder).catch(() => null)), null, 'ENCPC does not see a pre-ENCPC application');
});

test('H3: IMC rejection for registry_ownership_mismatch blocks the NUMBER for every account until PMU names the one allowed factory', async () => {
  await closeOpen();
  const number = reg();
  const impostorApp = await advanceTo('IMC_REVIEW', c, number); // c.factory = المنتحل
  assert.equal((await act(c.imc, impostorApp, 'reject', { reason: 'رقم السجل لمنشأة أخرى', reasonCode: 'bogus' })).status, 400);
  const rej = await act(c.imc, impostorApp, 'reject', { reason: 'رقم السجل يخص منشأة أخرى', reasonCode: 'registry_ownership_mismatch' });
  assert.equal(rej.status, 200);
  // الحظر على الرقم لكل الحسابات: المالك الحقيقي أيضًا لا يرسل قبل قرار PMU (فلا التفاف بحساب جديد).
  const ownerDraft = await createCompleteDraft(c.factory2, number);
  const ownerBlocked = await act(c.factory2, ownerDraft, 'submit');
  assert.equal(ownerBlocked.status, 409);
  assert.equal(ownerBlocked.json.code, 'REGISTRY_BLOCKED');
  const again = await createCompleteDraft(c.factory, number);
  const blocked = await act(c.factory, again, 'submit');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'REGISTRY_BLOCKED');
  const list = (await c.pmu.get('/registry-blocks')).json.data.items;
  const block = list.find((x: any) => x.registryNumber === number);
  assert.ok(block);
  assert.equal(block.source, 'imc_reject');
  assert.equal((await c.admin.get('/registry-blocks')).status, 403);
  assert.equal((await c.imc.post(`/registry-blocks/${block.id}/release`, { reason: 'محاولة من IMC للرفع', reference: 'REF-1', allowedFactoryId: 'x' })).status, 403);
  assert.equal((await c.pmu.post(`/registry-blocks/${block.id}/release`, { reason: 'قصير' })).status, 400, 'reason, reference and the allowed factory are required');
  const ownerFactory = (await q<{ id: string }>('SELECT id FROM factories WHERE organizationId = ?', c.factory2.user.organizationId))[0].id;
  const body = { reason: 'ثبت التفويض بخطاب رسمي من المنشأة', reference: 'PMU-2026-17' };
  assert.equal((await c.pmu.post(`/registry-blocks/${block.id}/release`, { ...body, allowedFactoryId: 'fac-unknown' })).status, 400);
  const rel = await c.pmu.post(`/registry-blocks/${block.id}/release`, { ...body, allowedFactoryId: ownerFactory });
  assert.equal(rel.status, 200);
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE action = 'registry_block.release' AND entityId = ?", block.id)).length === 1);
  assert.equal((await act(c.factory2, ownerDraft, 'submit')).status, 200, 'the named factory may use the number');
  await act(c.factory2, ownerDraft, 'withdraw', { reason: 'إنهاء للاختبار' });
  const still = await act(c.factory, again, 'submit');
  assert.equal(still.status, 409, 'the impostor stays blocked: the number is reserved for the named factory');
  assert.equal(still.json.details?.[0]?.issue, 'reserved');
});

async function flushMail() {
  const { processNotifications } = await import('../src/jobs/notificationWorker.js');
  await processNotifications(200);
}

test('H4: email recovery = admin request with official PDF → PMU approval → 48 h cooling (owner can cancel) → worker executes; admin never approves', async () => {
  const owner = await new Client(srv.base).login(DEV.factory2);
  const uid = owner.user.id as string;
  const fields = { userId: uid, newEmail: 'New.Owner@factory.test', reason: 'فقد المالك الوصول لبريده بعد ترك الموظف العمل', requestReference: 'خطاب رقم 55/2026' };
  assert.equal((await c.admin.post(`/admin/users/${uid}/recover-email`, { newEmail: 'x@y.test' })).status, 404, 'immediate recovery removed');
  assert.equal((await c.pmu.upload('/recovery-requests', fields, PDF)).status, 403, 'PMU cannot create requests');
  assert.equal((await c.admin.upload('/recovery-requests', fields, null)).status, 400, 'official PDF is mandatory');
  assert.equal((await c.admin.upload('/recovery-requests', { ...fields, reason: 'قصير' }, PDF)).status, 400);
  assert.equal((await c.admin.upload('/recovery-requests', { ...fields, userId: 'usr-imc-1' }, PDF)).status, 403, 'factory accounts only');
  assert.equal((await c.admin.upload('/recovery-requests', { ...fields, newEmail: DEV.factory }, PDF)).status, 409, 'email in use');
  // الطلب الأول: يلغيه المالك برابط الإلغاء
  sentMails.length = 0;
  const r1 = await c.admin.upload('/recovery-requests', fields, PDF);
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  assert.equal(r1.json.data.status, 'pending_approval');
  assert.equal((await q<{ email: string }>('SELECT email FROM users WHERE id = ?', uid))[0].email, DEV.factory2, 'nothing changes at request time');
  assert.equal((await c.admin.upload('/recovery-requests', fields, PDF)).status, 409, 'one open request per account');
  await flushMail();
  const cancelMail = sentMails.find((m) => m.to.includes(DEV.factory2) && /#cancel-recovery\/[a-f0-9]{64}/.test(m.html));
  assert.ok(cancelMail, 'owner told on the CURRENT address with a one-time cancel link');
  assert.ok((await q("SELECT 1 FROM notification_outbox WHERE templateKey = 'ops.recovery_pending' AND recipientAddress = 'pmu@shams.local'")).length >= 1, 'PMU notified');
  const cancelToken = cancelMail!.html.match(/#cancel-recovery\/([a-f0-9]{64})/)![1];
  assert.equal((await new Client(srv.base).post('/auth/recovery/cancel', { token: cancelToken })).status, 200);
  assert.equal((await new Client(srv.base).post('/auth/recovery/cancel', { token: cancelToken })).status, 400, 'single use');
  assert.equal((await c.pmu.post(`/recovery-requests/${r1.json.data.id}/approve`, {})).status, 409, 'closed request cannot be approved');
  // الطلب الثاني: موافقة PMU ثم مهلة 48 ساعة
  const r2 = await c.admin.upload('/recovery-requests', fields, PDF);
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
  const id = r2.json.data.id as string;
  assert.equal((await c.admin.post(`/recovery-requests/${id}/approve`, {})).status, 403, 'system_admin can never approve (not even its own request)');
  assert.equal((await c.imc.post(`/recovery-requests/${id}/approve`, {})).status, 403);
  assert.equal((await c.admin.get(`/recovery-requests/${id}/document`)).status, 200, 'requester can read its document');
  assert.equal((await c.pmu.get(`/recovery-requests/${id}/document`)).status, 200);
  assert.equal((await c.imc.get(`/recovery-requests/${id}/document`)).status, 403);
  const approved = await c.pmu.post(`/recovery-requests/${id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(approved.json.data.status, 'cooling');
  const hours = (Date.parse(approved.json.data.coolingEndsAt) - Date.now()) / 3_600_000;
  assert.ok(hours > 47.5 && hours <= 48.01, `cooling window ≈ 48h, got ${hours}`);
  const { executeDueRecoveries } = await import('../src/services/accountRecovery.js');
  assert.equal(await executeDueRecoveries(Date.now() + 3_600_000), 0, 'nothing executes during the cooling window');
  assert.equal((await q<{ email: string }>('SELECT email FROM users WHERE id = ?', uid))[0].email, DEV.factory2);
  assert.equal((await owner.get('/auth/me')).status, 200, 'owner session still alive during cooling');
  // بعد المهلة
  assert.equal(await executeDueRecoveries(Date.now() + 49 * 3_600_000), 1);
  assert.equal(await executeDueRecoveries(Date.now() + 50 * 3_600_000), 0, 'executes once');
  assert.equal((await q<{ email: string }>('SELECT email FROM users WHERE id = ?', uid))[0].email, 'new.owner@factory.test');
  assert.equal((await owner.get('/auth/me')).status, 401, 'live access token rejected');
  owner.token = null;
  assert.equal((await owner.post('/auth/refresh', {})).status, 401, 'refresh sessions revoked');
  await flushMail();
  const mails = await q<{ templateKey: string; recipientAddress: string }>(
    "SELECT templateKey, recipientAddress FROM notification_outbox WHERE templateKey IN ('auth.email_changed_old','auth.email_changed_new','auth.recovery_closed')");
  assert.ok(mails.some((m) => m.recipientAddress === DEV.factory2), 'old address informed');
  const verify = sentMails.find((m) => m.to.includes('new.owner@factory.test') && /#verify-email\/[a-f0-9]{64}/.test(m.html));
  assert.ok(verify, 'activation link sent to the new address');
  const audit = await q<{ action: string }>("SELECT action FROM audit_logs WHERE entityId = ? AND action LIKE 'account_recovery.%' ORDER BY at", id);
  assert.deepEqual(audit.map((a) => a.action).slice(0, 2), ['account_recovery.request', 'account_recovery.approve']);
  assert.equal((await new Client(srv.base).post('/auth/login', { email: 'new.owner@factory.test', password: 'Shams@2026' })).json.code, 'EMAIL_NOT_VERIFIED');
  const token = verify!.html.match(/#verify-email\/([a-f0-9]{64})/)![1];
  assert.equal((await new Client(srv.base).post('/auth/verify-email', { token })).status, 200);
  const relogin = await new Client(srv.base).login('new.owner@factory.test');
  assert.equal(relogin.user.organizationId, 'org-factory-demo-2', 'same factory, same applications');
  assert.equal((await new Client(srv.base).post('/auth/login', { email: DEV.factory2, password: 'Shams@2026' })).status, 401, 'old email no longer signs in');
  c.factory2 = relogin;
});

test('M11 + I9: factory notifications go to the verified account only; receipt on submit and notice on IMC acceptance', async () => {
  await closeOpen();
  const id = await advanceTo('ENCPC_REVIEW', c, reg());
  const rows = await q<{ templateKey: string; recipientAddress: string }>("SELECT templateKey, recipientAddress FROM notification_outbox WHERE applicationId = ? AND channel = 'email'", id);
  assert.ok(!rows.some((r) => r.recipientAddress === 'contact@factory.test'), 'unverified contactEmail is not a recipient');
  assert.ok(rows.some((r) => r.templateKey === 'app.submitted' && r.recipientAddress === 'factory@shams.local'));
  assert.ok(rows.some((r) => r.templateKey === 'app.imc_accepted' && r.recipientAddress === 'factory@shams.local'));
  const receipt = await q<{ subject: string }>("SELECT subject FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.submitted' AND channel = 'email'", id);
  assert.match(receipt[0].subject, /SHAMS-\d{4}-\d{5}/);
});

test('I9 + M7: support contact shown only when configured; no "use the website" line; English summary has no Arabic free text', async () => {
  const { renderTemplate } = await import('../src/notifications/templates.js');
  const base = { appId: 'app-1', number: 'SHAMS-2026-00001', companyName: 'مصنع', reason: 'سبب عربي للرفض' };
  const none = renderTemplate('app.rejected', base).html;
  assert.ok(!none.includes('للاستفسار استخدم الموقع'));
  assert.ok(!none.includes('للاستفسار:'), 'no channel when not configured');
  assert.equal((await c.factory.get('/meta')).json.data.support.email, null);
  process.env.SUPPORT_EMAIL = 'support@shams.test';
  process.env.SUPPORT_PHONE = '19000';
  try {
    const html = renderTemplate('app.rejected', base).html;
    assert.ok(html.includes('support@shams.test') && html.includes('19000'));
    assert.deepEqual((await c.factory.get('/meta')).json.data.support, { email: 'support@shams.test', phone: '19000' });
  } finally { delete process.env.SUPPORT_EMAIL; delete process.env.SUPPORT_PHONE; }
  const english = none.match(/<td dir="ltr"[^>]*>([^<]*)<\/td>/)![1];
  assert.ok(!/[؀-ۿ]/.test(english), `English summary is LTR-only: ${english}`);
  // «The reason is shown above» يجب أن يصدق في البديل النصي أيضًا
  const text = renderTemplate('app.rejected', base).text;
  assert.ok(text.includes('سبب الرفض: سبب عربي للرفض'), text);
  const corr = renderTemplate('app.correction_requested', { ...base, deficiencies: [{ labelAr: 'العنوان', labelEn: 'Address', note: 'ناقص' }] }).text;
  assert.match(corr, /- العنوان — ناقص/);
});

test('I2: Arabic-Indic digits are normalized and a bare website gets https://', async () => {
  await closeOpen();
  const id = (await c.factory.post('/applications', {})).json.data.id;
  const r = await c.factory.put(`/applications/${id}/data/general`, { phone1: '٠٢٢١٢٣٤٥٦٧', website: 'www.factory.com' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.data.phone1, '0221234567');
  assert.equal(r.json.data.data.website, 'https://www.factory.com');
  const eng = await c.factory.put(`/applications/${id}/data/engineering`, { contractedCapacity: '١٢٥٠' });
  assert.equal(eng.json.data.data.contractedCapacity, 1250);
  const c2 = await c.factory.put(`/applications/${id}/data/contact`, { contactMobile: '۰۱۰۱۲۳۴۵۶۷۸' });
  assert.equal(c2.json.data.data.contactMobile, '01012345678', 'Persian digits too');
  const regRes = await registerFactory(new Client(srv.base), registrationPayload('digits@test.local', 'IND-DIGITS-1', { companyName: 'مصنع', contactName: 'أحمد', mobile: '٠١٠١٢٣٤٥٦٧٨' }));
  assert.equal(regRes.status, 201);
  await act(c.factory, id, 'withdraw', { reason: 'إنهاء' });
});

test('M8: resubmitting a correction with untouched items is flagged (warning only)', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  assert.equal((await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان ناقص' }, { field: 'taxCardFile', note: 'البطاقة منتهية' }] })).status, 200);
  let v = await getApp(c.factory, id);
  assert.deepEqual([...v.unchangedDeficiencies].sort(), ['address', 'taxCardFile']);
  await c.factory.put(`/applications/${id}/data/general`, { address: 'العنوان الكامل الجديد' });
  v = await getApp(c.factory, id);
  assert.deepEqual(v.unchangedDeficiencies, ['taxCardFile']);
  assert.equal((await act(c.factory, id, 'resubmit')).status, 200, 'not blocked');
});

test('B3: the public journey no longer names the proposed electricity reviewer', () => {
  const content = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'frontend', 'src', 'content', 'shams.ts'), 'utf8');
  assert.ok(!content.includes('وتراجعها وحدة إدارة المبادرة'));
  assert.ok(!content.includes('reviewed by the PMU'));
});
