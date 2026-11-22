// اختبارات القبول 15–17: قرار متزامن، منع التكرار، رفض الملفات غير PDF.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, PDF, q, onMysql, type Started } from './helpers.js';

const env = isolateTestEnv('concurrency');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen(factory = c.factory) {
  const open = (await factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}

test('15) concurrent decisions by two reviewers of the same org: exactly one wins, no duplicate notifications', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, 'IND-CONC-1');
  const { version } = await getApp(c.imc, id);
  const [a, b] = await Promise.all([
    c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: version }),
    c.imc2.post(`/applications/${id}/actions/request_correction`, { expectedVersion: version, deficiencies: [{ field: 'address', note: 'x' }] }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.json.code, 'VERSION_CONFLICT');
  const transitions = await q("SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND fromState = 'IMC_REVIEW'", id);
  assert.equal(transitions.length, 1);
  const notifs = await q<{ dedupeKey: string }>("SELECT dedupeKey FROM notification_outbox WHERE applicationId = ? AND templateKey IN ('app.review_assigned','app.correction_requested')", id);
  const afterSubmit = notifs.filter((n) => !n.dedupeKey.includes(':app.review_assigned:') || true);
  assert.equal(new Set(afterSubmit.map((n) => n.dedupeKey)).size, afterSubmit.length, 'no duplicate notification rows');
  const corr = await q("SELECT 1 FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.correction_requested'", id);
  const encpc = await q("SELECT 1 FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.review_assigned' AND recipientAddress = 'encpc@shams.local'", id);
  assert.equal(corr.length + encpc.length > 0, true);
  assert.ok(corr.length === 0 || encpc.length === 0, 'only the winning decision notified');
  // إعادة نفس الطلب بنسخة قديمة → 409
  const stale = await c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: version });
  assert.equal(stale.status, 409);
});

test('16) a second open application for the same factory or the same registry number is rejected', async () => {
  await closeOpen();
  await closeOpen(c.factory2);
  const id = await createCompleteDraft(c.factory, 'IND-UNIQ-1');
  const second = await c.factory.post('/applications', {});
  assert.equal(second.status, 409);
  assert.equal(second.json.code, 'OPEN_APPLICATION_EXISTS');
  assert.equal((await act(c.factory, id, 'submit')).status, 200);
  // مصنع آخر بنفس رقم السجل
  const other = await createCompleteDraft(c.factory2, 'IND-UNIQ-1');
  const r = await act(c.factory2, other, 'submit');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'DUPLICATE_REGISTRY');
  assert.equal((await getApp(c.factory2, other)).state, 'DRAFT');
  // بعد وصول الأول لحالة نهائية يمكن الإرسال
  await act(c.imc, id, 'reject', { reason: 'رفض لأغراض الاختبار' });
  const ok = await act(c.factory2, other, 'submit');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // فهرس فريد جزئي على مستوى القاعدة أيضًا (MySQL: the same two unique keys, on generated flag columns)
  const idx = onMysql
    ? await q<{ name: string }>("SELECT DISTINCT INDEX_NAME AS name FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shams_applications' AND NON_UNIQUE = 0 AND INDEX_NAME IN ('ux_apps_open_factory','ux_apps_open_registry')")
    : await q<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('ux_apps_open_factory','ux_apps_open_registry')");
  assert.equal(idx.length, 2);
});

test('17) non-PDF or fake-extension files are rejected', async () => {
  await closeOpen();
  const created = await c.factory.post('/applications', {});
  const id = created.json.data.id;
  const fakePdf = Buffer.from('MZ\x90\x00 this is an exe renamed to pdf');
  let r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, fakePdf, 'tax.pdf');
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'INVALID_FILE_TYPE');
  r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, PDF, 'tax.exe', 'application/octet-stream');
  assert.equal(r.status, 400, 'real PDF bytes with a wrong extension');
  r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, Buffer.from('<html>pdf</html>'), 'tax.pdf', 'application/pdf');
  assert.equal(r.status, 400);
  r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, PDF, 'image.png', 'image/png');
  assert.equal(r.status, 400);
  r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, null);
  assert.equal(r.status, 400);
  r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'notAKind' }, PDF);
  assert.equal(r.status, 400);
  r = await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, PDF);
  assert.equal(r.status, 409, 'offer cannot be uploaded in DRAFT');
  const ok = await c.factory.upload(`/applications/${id}/documents`, { kind: 'taxCardFile' }, PDF, 'بطاقة ضريبية.pdf');
  assert.equal(ok.status, 201);
  assert.equal(ok.json.data.sha256.length, 64);
  assert.equal(ok.json.data.originalName, 'بطاقة ضريبية.pdf');
  // لا ملفات مؤقتة متبقية من الرفض
  const fs = await import('node:fs');
  const path = await import('node:path');
  const tmp = path.join(process.env.UPLOAD_DIR!, 'tmp');
  assert.equal(fs.existsSync(tmp) ? fs.readdirSync(tmp).length : 0, 0);
  // حد 12 فاتورة كهرباء
  for (let i = 0; i < 12; i++) assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, PDF, `b${i}.pdf`)).status, 201);
  const extra = await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, PDF, 'b13.pdf');
  assert.equal(extra.status, 422);
});
