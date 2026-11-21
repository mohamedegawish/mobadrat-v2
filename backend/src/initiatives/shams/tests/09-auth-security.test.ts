// المصادقة والأمان: تفعيل بريد حقيقي بلا توكن في الرد، قفل الحساب، تدوير refresh وكشف إعادة الاستخدام،
// كلمة مؤقتة إجبارية التغيير على السيرفر، لا مصادقة تجريبية، تدقيق append-only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, Client, sentMails, q, DEV, registerFactory, registrationPayload, type Started } from './helpers.js';

const env = isolateTestEnv('auth');
let srv: Started;

before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); await env.cleanup(); });

async function flushMail() {
  const { processNotifications } = await import('../src/jobs/notificationWorker.js');
  await processNotifications(200);
}

function tokenFrom(html: string, kind: 'verify-email' | 'reset-password'): string {
  const m = html.match(new RegExp(`#${kind}/([a-f0-9]{64})`));
  assert.ok(m, `link with ${kind} token in email`);
  return m![1];
}

test('factory self-registration sends a real verification email and never returns the token', async () => {
  const c = new Client(srv.base);
  const body = registrationPayload('new.factory@test.local', 'IND-AUTH-1', { companyName: 'مصنع الاختبار', contactName: 'أحمد', mobile: '01099999999' }) as { email: string; password: string } & Record<string, unknown>;
  const r = await registerFactory(c, body);
  assert.equal(r.status, 201);
  assert.ok(!/token/i.test(JSON.stringify(r.json)), 'no token in the response');
  // L6: التسجيل ببريد مسجل يرجع نفس الرد العام (لا كشف لوجود الحساب) ولا ينشئ حسابًا ثانيًا.
  const dup = await registerFactory(c, body);
  assert.equal(dup.status, 201);
  assert.equal(dup.json.message, r.json.message);
  assert.equal((await q("SELECT 1 FROM users WHERE email = ?", body.email)).length, 1, 'no second account');
  assert.equal((await registerFactory(c, { ...body, email: 'x@test.local', password: 'short' })).status, 400);
  assert.equal((await registerFactory(c, { ...body, email: 'y@test.local', role: 'system_admin' })).status, 400, 'mass assignment');
  assert.equal((await c.post('/auth/register', { ...body, email: 'z@test.local' })).status, 400, 'JSON without documents is refused');

  const blocked = await c.post('/auth/login', { email: body.email, password: body.password });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'EMAIL_NOT_VERIFIED');

  await flushMail();
  const mail = sentMails.find((m) => m.to.includes(body.email));
  assert.ok(mail, 'verification email sent');
  const token = tokenFrom(mail!.html, 'verify-email');
  const purged = await q<{ body: string; status: string }>("SELECT body, status FROM notification_outbox WHERE templateKey = 'auth.verify_email' AND recipientAddress = ?", body.email);
  assert.equal(purged[0].status, 'sent');
  assert.equal(purged[0].body, '', 'sensitive email body purged after sending');

  assert.equal((await c.post('/auth/verify-email', { token: 'f'.repeat(64) })).status, 400);
  assert.equal((await c.post('/auth/verify-email', { token })).status, 200);
  assert.equal((await c.post('/auth/verify-email', { token })).status, 400, 'single use');
  // الحساب لا يدخل قبل قبول IMC لطلب التسجيل (أُرسل للمراجعة عند التفعيل).
  const pendingLogin = await c.post('/auth/login', { email: body.email, password: body.password });
  assert.equal(pendingLogin.status, 403);
  assert.equal(pendingLogin.json.code, 'ACCOUNT_UNDER_REVIEW');
  const imc = await new Client(srv.base).login(DEV.imc1);
  const [app] = await q<{ id: string; version: number }>("SELECT a.id, a.version FROM applications a JOIN factories f ON f.id = a.factoryId JOIN users u ON u.organizationId = f.organizationId WHERE u.email = ?", body.email);
  assert.equal((await imc.post(`/applications/${app.id}/actions/accept`, { expectedVersion: app.version })).status, 200);
  await c.login(body.email, body.password);
  assert.equal(c.user.role, 'factory_owner');
  // التسجيل العام للمصانع فقط
  const prof = await c.get('/factory/profile');
  assert.equal(prof.status, 200);
  assert.equal(prof.json.data.factory.companyName, 'مصنع الاختبار');
});

test('M3: escalating delay per (email, IP) instead of locking the account', async () => {
  const c = new Client(srv.base);
  const free = 3; // shamsPolicy.loginThrottle.freeFailures
  for (let i = 0; i < free; i++) assert.equal((await c.post('/auth/login', { email: DEV.encpc, password: 'wrong-pass1' })).status, 401);
  const delayed = await c.post('/auth/login', { email: DEV.encpc, password: 'wrong-pass1' });
  assert.equal(delayed.status, 429);
  assert.equal(delayed.json.code, 'LOGIN_THROTTLED');
  assert.ok(Number(delayed.headers.get('retry-after')) >= 1, 'Retry-After header');
  const correct = await c.post('/auth/login', { email: DEV.encpc, password: 'Shams@2026' });
  assert.equal(correct.status, 429, 'delayed even with the right password until the wait passes');
  // لا قفل للحساب نفسه: عنوان/بريد آخر لا يتأثر، والحساب لم يُقفل في القاعدة.
  assert.equal((await q<{ lockedUntil: string | null }>('SELECT lockedUntil FROM users WHERE email = ?', DEV.encpc))[0].lockedUntil, null);
  assert.equal((await c.post('/auth/login', { email: DEV.pmu, password: 'Shams@2026' })).status, 200, 'other accounts unaffected');
  // بعد انقضاء مهلة الانتظار يعمل الدخول الصحيح ويمسح العداد.
  const { getDb } = await import('../src/db/sqlite.js');
  await getDb().prepare("UPDATE login_throttle SET nextAllowedAt = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await c.post('/auth/login', { email: DEV.encpc, password: 'Shams@2026' })).status, 200);
  assert.equal((await c.post('/auth/login', { email: 'nobody@test.local', password: 'x' })).status, 401, 'unknown email: same response as a wrong password');
});

test('refresh token: httpOnly cookie only, rotation, reuse revokes the whole family', async () => {
  const c = new Client(srv.base);
  const r = await c.post('/auth/login', { email: DEV.pmu, password: 'Shams@2026' });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.refreshToken, undefined, 'refresh token never in the body');
  const setCookie = r.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /shams_refresh=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Path=\/api\/v1\/auth/);
  c.token = r.json.data.accessToken;
  const old = c.cookies.get('shams_refresh')!;
  const rot = await c.post('/auth/refresh');
  assert.equal(rot.status, 200);
  const fresh = c.cookies.get('shams_refresh')!;
  assert.notEqual(old, fresh);
  // إعادة استخدام القديم → 401 وإلغاء العائلة (يسقط الجديد أيضًا)
  const thief = new Client(srv.base);
  thief.cookies.set('shams_refresh', old);
  assert.equal((await thief.post('/auth/refresh')).status, 401);
  assert.equal((await c.post('/auth/refresh')).status, 401, 'family revoked after reuse');
  // تسجيل الخروج يلغي التوكن
  await c.login(DEV.pmu);
  assert.equal((await c.post('/auth/logout')).status, 200);
  assert.equal((await c.post('/auth/refresh')).status, 401);
});

test('no demo authentication: x-user-id ignored, switch-user does not exist', async () => {
  const r = await fetch(`${srv.base}/applications`, { headers: { 'x-user-id': 'usr-admin' } });
  assert.equal(r.status, 401);
  const admin = await new Client(srv.base).login(DEV.admin);
  const s = await admin.post('/auth/switch-user', { userId: 'usr-factory-1' });
  assert.equal(s.status, 404, 'route does not exist even for an authenticated admin');
  const asOther = await fetch(`${srv.base}/factory/profile`, { headers: { Authorization: `Bearer ${admin.token}`, 'x-user-id': 'usr-factory-1' } });
  assert.equal(asOther.status, 403, 'header cannot impersonate another user');
});

test('H2: staff account = request approved by an active user of the same org; first password set via one-time link (no temp password)', async () => {
  const admin = await new Client(srv.base).login(DEV.admin);
  const created = await admin.post('/admin/users', { email: 'new.imc@shams.local', nameAr: 'مراجع جديد', role: 'imc_reviewer', organizationId: 'org-imc' });
  assert.equal(created.status, 202, JSON.stringify(created.json));
  assert.equal(created.json.data.user, null, 'no account before approval');
  assert.equal(created.json.data.temporaryPassword, undefined);
  const reqId = created.json.data.request.id as string;
  assert.equal((await q("SELECT 1 FROM users WHERE email = 'new.imc@shams.local'")).length, 0);
  assert.equal((await admin.post('/admin/users', { email: 'x@shams.local', nameAr: 'x', role: 'imc_reviewer', organizationId: 'org-pmu' })).status, 400, 'role/org mismatch');
  assert.equal((await admin.post('/admin/users', { email: 'y@shams.local', nameAr: 'y', role: 'factory_owner', organizationId: 'org-imc' })).status, 400, 'no factory accounts via admin');
  // الأدمن لا يوافق على طلب حساب، وجهات أخرى لا توافق على طلب جهة غيرها، والأدوار غير الأدمن لا تنشئ طلبات.
  assert.equal((await admin.post(`/account-requests/${reqId}/approve`, {})).status, 403, 'admin cannot approve');
  const pmu = await new Client(srv.base).login(DEV.pmu);
  assert.equal((await pmu.post('/admin/users', { email: 'z@shams.local', nameAr: 'z', role: 'imc_reviewer', organizationId: 'org-imc' })).status, 403);
  assert.equal((await pmu.post(`/account-requests/${reqId}/approve`, {})).status, 403, 'PMU is not the IMC org (banks only)');
  const encpc = await new Client(srv.base).login(DEV.encpc);
  assert.equal((await encpc.post(`/account-requests/${reqId}/approve`, {})).status, 403);
  // مستخدم IMC نشط يوافق.
  const imc = await new Client(srv.base).login(DEV.imc1);
  assert.ok((await imc.get('/account-requests')).json.data.items.some((r: any) => r.id === reqId), 'listed for the IMC approver');
  const ok = await imc.post(`/account-requests/${reqId}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await imc.post(`/account-requests/${reqId}/approve`, {})).status, 409, 'single decision');
  const user = (await q<{ id: string; passwordHash: string; mustChangePassword: number }>("SELECT id, passwordHash, mustChangePassword FROM users WHERE email = 'new.imc@shams.local'"))[0];
  assert.ok(user, 'account created after approval');
  assert.equal(user.passwordHash, '', 'no password until the owner uses the setup link');
  assert.equal((await new Client(srv.base).post('/auth/login', { email: 'new.imc@shams.local', password: 'anything' })).status, 401);
  await flushMail();
  const mail = [...sentMails].reverse().find((m) => m.to.includes('new.imc@shams.local') && /#reset-password\/[a-f0-9]{64}/.test(m.html));
  assert.ok(mail, 'setup email sent to the new account');
  const token = tokenFrom(mail!.html, 'reset-password');
  const set = new Client(srv.base);
  assert.equal((await set.post('/auth/reset-password', { token, newPassword: 'NewPass2026' })).status, 200);
  const u = await new Client(srv.base).login('new.imc@shams.local', 'NewPass2026');
  assert.equal((await u.get('/applications')).status, 200);
  // تعطيل الحساب يقطع الجلسة
  assert.equal((await admin.put(`/admin/users/${user.id}`, { isActive: false })).status, 200);
  assert.equal((await u.get('/applications')).status, 401);
  // الطالب لا يوافق على طلبه: طلب من حساب IMC نفسه مرفوض بالقاعدة.
  const own = await imc.post('/admin/users', { email: 'own@shams.local', nameAr: 'o', role: 'imc_reviewer', organizationId: 'org-imc' });
  assert.equal(own.status, 403, 'only the admin screen creates requests');
});

test('forgot/reset password: generic response, single-use link, sessions revoked', async () => {
  const c = new Client(srv.base);
  const unknown = await c.post('/auth/forgot-password', { email: 'nobody@test.local' });
  const known = await c.post('/auth/forgot-password', { email: DEV.imc2 });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.equal(unknown.json.message, known.json.message, 'no account enumeration');
  await flushMail();
  const mail = [...sentMails].reverse().find((m) => m.to.includes(DEV.imc2));
  const token = tokenFrom(mail!.html, 'reset-password');
  const session = await new Client(srv.base).login(DEV.imc2);
  assert.equal((await c.post('/auth/reset-password', { token, newPassword: 'weak' })).status, 400);
  assert.equal((await c.post('/auth/reset-password', { token, newPassword: 'BankReset2026' })).status, 200);
  assert.equal((await c.post('/auth/reset-password', { token, newPassword: 'BankReset2027' })).status, 400, 'single use');
  assert.equal((await session.post('/auth/refresh')).status, 401, 'old sessions revoked');
  await new Client(srv.base).login(DEV.imc2, 'BankReset2026');
});

test('audit log is append-only and never stores secrets', async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  await assert.rejects(async () => await getDb().prepare("UPDATE audit_logs SET action = 'x'").run(), /append-only/);
  await assert.rejects(async () => await getDb().prepare('DELETE FROM audit_logs').run(), /append-only/);
  const rows = await q<{ details: string }>('SELECT details FROM audit_logs');
  const all = rows.map((r) => r.details).join('\n');
  assert.ok(!all.includes('Shams@2026') && !all.includes('NewPass2026') && !all.includes('BankReset2026'));
  const { redact } = await import('../src/store/audit.js');
  assert.deepEqual(redact({ password: 'x', nested: { apiKey: 'y', ok: 1 } }), { password: '[REDACTED]', nested: { apiKey: '[REDACTED]', ok: 1 } });
  const admin = await new Client(srv.base).login(DEV.admin);
  const list = await admin.get('/admin/audit-logs?pageSize=5');
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.length > 0);
  assert.equal((await (await new Client(srv.base).login(DEV.pmu)).get('/admin/audit-logs')).status, 403);
});

test('health endpoints', async () => {
  const h = await fetch(`${srv.origin}/health`);
  assert.equal(h.status, 200);
  const j = await h.json();
  assert.equal(j.status, 'ok');
  assert.equal((await fetch(`${srv.base}/health`)).status, 200);
});

test('L4: outbox rows stuck in "sending" after a crash are reclaimed and delivered, fresh claims are left alone', async () => {
  const { getDb } = await import('../src/db/sqlite.js');
  const { reclaimStaleSending } = await import('../src/store/outbox.js');
  const db = getDb();
  const row = await db.prepare("SELECT id FROM notification_outbox LIMIT 1").get() as { id: string } | undefined;
  assert.ok(row, 'a notification row exists from earlier tests');
  const old = new Date(Date.now() - 30 * 60_000).toISOString();
  await db.prepare("UPDATE notification_outbox SET status = 'sending', claimedAt = ? WHERE id = ?").run(old, row!.id);
  assert.equal(await reclaimStaleSending('notification_outbox', 10 * 60_000), 1, 'stale claim returns to pending');
  assert.equal((await db.prepare('SELECT status FROM notification_outbox WHERE id = ?').get(row!.id) as { status: string }).status, 'pending');
  await db.prepare("UPDATE notification_outbox SET status = 'sending', claimedAt = ? WHERE id = ?").run(new Date().toISOString(), row!.id);
  assert.equal(await reclaimStaleSending('notification_outbox', 10 * 60_000), 0, 'a fresh claim is not stolen');
  await db.prepare("UPDATE notification_outbox SET status = 'sent' WHERE id = ?").run(row!.id);
});
