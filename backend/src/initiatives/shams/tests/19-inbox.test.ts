// صندوق الإشعارات داخل المنصة + الأحداث المضافة: لكل مستخدم صندوقه، لا تكرار، لا حساس، والأحداث تحمل رقم الطلب.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, q, Client, DEV, type Started } from './helpers.js';

const env = isolateTestEnv('inbox');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-INB-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const inbox = async (client: Client, query = '') => (await client.get(`/notifications?pageSize=100${query}`)).json.data;
const byKey = (d: any, key: string) => d.items.filter((i: any) => i.templateKey === key);

test('every role gets a private inbox: it fills with the same events as email, carries the application reference, and is isolated per user', async () => {
  await closeOpen();
  const f0 = await inbox(c.factory);
  const imc0 = await inbox(c.imc);
  const id = await advanceTo('IMC_REVIEW', c, reg());
  const f1 = await inbox(c.factory);
  const imc1 = await inbox(c.imc);
  assert.equal(f1.total, f0.total + 1, 'factory: submission receipt');
  const receipt = byKey(f1, 'app.submitted')[0];
  assert.match(receipt.title, /SHAMS-\d{4}-\d{5}/, 'title carries the application reference');
  assert.equal(receipt.link, `application/${id}`);
  assert.equal(receipt.applicationId, id);
  assert.equal(receipt.read, false);
  assert.ok(imc1.total > imc0.total, 'IMC reviewers get "review assigned"');
  assert.ok(byKey(imc1, 'app.review_assigned').some((i: any) => i.applicationId === id));
  // العزل: IMC 1 وIMC 2 لكل منهما صندوقه، ولا يرى المصنع الآخر شيئًا من هذا
  const f2inbox = await inbox(c.factory2);
  assert.ok(!f2inbox.items.some((i: any) => i.applicationId === id), 'another factory never sees it');
  assert.ok(!(await inbox(c.admin)).items.some((i: any) => i.applicationId === id));
  // مطابقة للبريد: كل بريد غير حساس لهذا المصنع له صف في الصندوق
  const mails = await q<{ templateKey: string }>("SELECT DISTINCT templateKey FROM notification_outbox WHERE applicationId = ? AND recipientUserId = ? AND sensitive = 0", id, c.factory.user.id);
  for (const m of mails) assert.ok(byKey(f1, m.templateKey).length >= 1, `inbox has ${m.templateKey}`);
});

test('read state: mark one, mark all, unread filter and counter; another user’s notification is a 404', async () => {
  await closeOpen();
  await advanceTo('IMC_REVIEW', c, reg());
  const d = await inbox(c.factory);
  assert.ok(d.unread >= 1);
  assert.equal((await c.factory.get('/notifications/unread-count')).json.data.unread, d.unread);
  const first = d.items[0];
  const marked = await c.factory.post(`/notifications/${first.id}/read`, {});
  assert.equal(marked.status, 200);
  assert.equal(marked.json.data.unread, d.unread - 1);
  assert.equal((await c.factory.post(`/notifications/${first.id}/read`, {})).status, 200, 'idempotent');
  assert.equal((await c.factory.get('/notifications/unread-count')).json.data.unread, d.unread - 1);
  const unread = await inbox(c.factory, '&unread=1');
  assert.ok(unread.items.every((i: any) => i.read === false));
  assert.ok(!unread.items.some((i: any) => i.id === first.id));
  // مستخدم آخر لا يستطيع وسم إشعار غيره ولا يعرف بوجوده
  assert.equal((await c.factory2.post(`/notifications/${first.id}/read`, {})).status, 404);
  assert.equal((await c.admin.post(`/notifications/${first.id}/read`, {})).status, 404);
  assert.equal((await c.factory2.post('/notifications/inb-does-not-exist/read', {})).status, 404);
  assert.equal((await q<{ readAt: string | null }>('SELECT readAt FROM user_notifications WHERE id = ?', first.id))[0].readAt !== null, true);
  // وسم الكل يخص صاحب الجلسة فقط
  const otherBefore = (await c.imc.get('/notifications/unread-count')).json.data.unread;
  const all = await c.factory.post('/notifications/read-all', {});
  assert.equal(all.status, 200);
  assert.equal((await c.factory.get('/notifications/unread-count')).json.data.unread, 0);
  assert.equal((await c.imc.get('/notifications/unread-count')).json.data.unread, otherBefore, 'read-all does not touch other users');
  // حقول غير معروفة مرفوضة
  assert.equal((await c.factory.post(`/notifications/${first.id}/read`, { userId: 'usr-imc-1' })).status, 400);
});

test('pagination, auth and no sensitive content: verification/reset/setup links never reach the inbox', async () => {
  assert.equal((await new Client(srv.base).get('/notifications')).status, 401);
  assert.equal((await new Client(srv.base).post('/notifications/read-all', {})).status, 401);
  const p1 = await c.factory.get('/notifications?pageSize=2&page=1');
  assert.equal(p1.status, 200);
  assert.ok(p1.json.data.items.length <= 2);
  assert.equal(p1.json.data.pageSize, 2);
  // استعادة كلمة المرور تُنشئ بريدًا حساسًا: لا صف في الصندوق ولا رابط
  const before = await inbox(c.imc2);
  assert.equal((await new Client(srv.base).post('/auth/forgot-password', { email: DEV.imc2 })).status, 200);
  const after = await inbox(c.imc2);
  assert.equal(after.total, before.total, 'no inbox row for a reset-link email');
  const all = await q<{ title: string; body: string; link: string }>('SELECT title, body, link FROM user_notifications');
  for (const r of all) {
    assert.doesNotMatch(`${r.title} ${r.body}`, /reset-password|verify-email|cancel-recovery|[a-f0-9]{64}/, 'no token or link in any inbox row');
    assert.ok(!/^https?:/i.test(r.link), 'link is an internal hash path');
    assert.ok(r.link === '' || /^[a-z-]+(\/[A-Za-z0-9_%-]+)?$/.test(r.link), `safe link: ${r.link}`);
  }
  // الأسباب والنواقص لا تُخزَّن (الصندوق = عنوان + نص قصير)
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  assert.equal((await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'ملاحظة داخلية سرية جدًا' }] })).status, 200);
  const rows = await q<{ body: string; title: string }>('SELECT body, title FROM user_notifications WHERE applicationId = ?', id);
  assert.ok(rows.length >= 1);
  assert.ok(!rows.some((r) => `${r.body} ${r.title}`.includes('ملاحظة داخلية سرية جدًا')), 'deficiency notes stay out of the inbox');
});

test('no duplicates: re-dispatching with the same key adds no inbox row, and the inbox works with email not configured', async () => {
  await closeOpen();
  const { dispatch } = await import('../notifications/notify.js');
  const userId = c.factory.user.id as string;
  const rec = [{ userId, email: 'factory@shams.local' }];
  const args = [{ appId: 'app-x', number: 'SHAMS-2026-99999', companyName: 'م' }, rec, { dedupePrefix: 'dup-test-1', channels: ['email' as const] }] as const;
  const before = (await q("SELECT 1 FROM user_notifications WHERE dedupeKey LIKE 'dup-test-1:%'")).length;
  await dispatch('app.submitted', ...args);
  await dispatch('app.submitted', ...args);
  await dispatch('app.submitted', ...args);
  assert.equal((await q("SELECT 1 FROM user_notifications WHERE dedupeKey LIKE 'dup-test-1:%'")).length, before + 1);
  // مستلم مكرر داخل القائمة نفسها → صف واحد
  await dispatch('app.submitted', { appId: 'app-y', number: 'SHAMS-2026-99998', companyName: 'م' }, [...rec, ...rec], { dedupePrefix: 'dup-test-2', channels: ['email'] });
  assert.equal((await q("SELECT 1 FROM user_notifications WHERE dedupeKey LIKE 'dup-test-2:%'")).length, 1);
  // مستلم بلا حساب (بريد فقط) لا يدخل الصندوق
  await dispatch('app.submitted', { appId: 'app-z', number: 'SHAMS-2026-99997', companyName: 'م' }, [{ email: 'outsider@example.test' }], { dedupePrefix: 'dup-test-3', channels: ['email'] });
  assert.equal((await q("SELECT 1 FROM user_notifications WHERE dedupeKey LIKE 'dup-test-3:%'")).length, 0);
  // الصندوق لا يتوقف على إعداد البريد: في الاختبار لا SMTP، والرسائل 'skipped' أو 'sent' ومع ذلك الصندوق ممتلئ
  assert.ok((await inbox(c.factory)).total > 0);
});

test('new events: provider selection, offer receipt, electricity receipt and acceptance, bank choice (factory) reach email and inbox with the application reference', async () => {
  await closeOpen();
  const id = await advanceTo('BANK_SELECTION', c, reg());
  const pending = () => q<{ templateKey: string; recipientAddress: string; subject: string }>(
    "SELECT templateKey, recipientAddress, subject FROM notification_outbox WHERE applicationId = ? AND channel = 'email'", id);
  const before = await pending();
  assert.ok(before.some((m) => m.templateKey === 'app.provider_selected' && m.recipientAddress === 'factory@shams.local'), 'provider selected → factory');
  assert.ok(before.some((m) => m.templateKey === 'app.offer_received' && m.recipientAddress === 'factory@shams.local'), 'offer received → factory');
  const f = await inbox(c.factory);
  assert.ok(byKey(f, 'app.provider_selected').some((i: any) => i.applicationId === id));
  assert.ok(byKey(f, 'app.offer_received').some((i: any) => i.applicationId === id));
  const sel = byKey(f, 'app.provider_selected').find((i: any) => i.applicationId === id);
  assert.match(sel.title, /SHAMS-\d{4}-\d{5}/);
  assert.ok(before.some((m) => m.templateKey === 'app.electricity_received' && m.recipientAddress === 'factory@shams.local'), 'electricity receipt → factory');
  assert.ok(before.some((m) => m.templateKey === 'app.electricity_accepted' && m.recipientAddress === 'factory@shams.local'), 'electricity accepted (choose the bank) → factory');
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: 'org-bank-demo-a' })).status, 200);
  const after = await pending();
  const chosen = after.filter((m) => m.templateKey === 'app.bank_selected');
  assert.deepEqual(chosen.map((m) => m.recipientAddress), ['factory@shams.local'], 'bank choice → factory only (the bank has no account — G-02)');
  assert.ok(byKey(await inbox(c.factory), 'app.bank_selected').some((i: any) => i.applicationId === id), 'bank choice → factory inbox');
  assert.ok(!byKey(await inbox(c.imc), 'app.bank_selected').length, 'IMC is not told about the bank');
  // إعادة رفع العرض بعد تصحيح تُنتج إيصالًا جديدًا (مفتاح الانتقال مختلف)
  const mails = after.filter((m) => m.templateKey === 'app.offer_received').length;
  assert.equal(mails, 1, 'one receipt for the single offer submission');
  const { renderTemplate } = await import('../notifications/templates.js');
  for (const key of ['app.provider_selected', 'app.offer_received', 'app.electricity_received', 'app.electricity_accepted', 'app.bank_selected'] as const) {
    const r = renderTemplate(key, { appId: 'app-1', number: 'SHAMS-2026-00001', companyName: 'مصنع', providerNameAr: 'مقدم', bankNameAr: 'بنك' });
    assert.ok(r.subject.includes('SHAMS-2026-00001') || key === 'app.provider_selected', key);
    assert.match(r.html, /SHAMS-2026-00001/);
    assert.ok((r.html.match(/<a [^>]*href=/g) ?? []).length >= 1);
    assert.ok(r.sms.length > 0 && r.sms.length <= 200, `${key} SMS is short`);
    assert.doesNotMatch(r.html, /undefined|\[object/);
  }
});
