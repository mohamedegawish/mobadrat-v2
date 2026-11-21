// القاعدة G: نزاع رقم السجل الصناعي بين مصنعين — PMU تحدد المصنع المخوَّل بسبب ومرجع، والتاريخ محفوظ،
// ولا تسجيل مكرر أثناء النزاع، والمستندات معزولة. القرار 4 من docs/SECURITY_REVIEW.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, q, PDF, sentMails, type Started } from './helpers.js';

const env = isolateTestEnv('disputes');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-DSP-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const factoryId = async (client: { user: { organizationId: string } }) => (await q<{ id: string }>('SELECT id FROM factories WHERE organizationId = ?', client.user.organizationId))[0].id;
const decision = { reason: 'ثبت التفويض بخطاب رسمي من المنشأة', reference: 'PMU-2026-31' };
async function flushMail() {
  const { processNotifications } = await import('../src/jobs/notificationWorker.js');
  await processNotifications(200);
}

test('conflict → objection with PDF → PMU accepts: number reserved for the objector only, history kept, parties notified', async () => {
  await closeOpen();
  const number = reg();
  const holder = await advanceTo('IMC_REVIEW', c, number);         // c.factory يحجز الرقم
  const draft = await createCompleteDraft(c.factory2, number);       // c.factory2 يحاول نفس الرقم
  const blocked = await act(c.factory2, draft, 'submit');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'DUPLICATE_REGISTRY');

  // لا اعتراض إلا لمتضرر: المصنع الحاجز نفسه (لا حظر ولا تعارض يخصه) يُرفض
  const noStanding = await c.factory.upload('/registry-objections', { registryNumber: number }, PDF);
  assert.equal(noStanding.status, 409);
  assert.equal(noStanding.json.code, 'OBJECTION_NOT_APPLICABLE');
  // الاعتراض يتطلب مستند PDF صالحًا
  assert.equal((await c.factory2.upload('/registry-objections', { registryNumber: number }, null)).status, 400);
  assert.equal((await c.factory2.upload('/registry-objections', { registryNumber: number }, Buffer.from('not a pdf'), 'x.pdf')).status, 400);
  // الأدوار الأخرى لا تعترض
  for (const client of [c.imc, c.pmu, c.admin]) assert.equal((await client.upload('/registry-objections', { registryNumber: number }, PDF)).status, 403);

  sentMails.length = 0;
  const obj = await c.factory2.upload('/registry-objections', { registryNumber: number, note: 'السجل الصناعي باسم منشأتنا' }, PDF);
  assert.equal(obj.status, 201, JSON.stringify(obj.json));
  assert.equal(obj.json.data.status, 'pending');
  const id = obj.json.data.id as string;
  assert.equal((await c.factory2.upload('/registry-objections', { registryNumber: number }, PDF)).status, 409, 'one pending objection per factory and number');
  await flushMail();
  assert.ok(sentMails.some((m) => m.to.includes('pmu@shams.local') && /اعتراض/.test(m.subject)), 'PMU notified');

  // أثناء الاعتراض: الرقم ما زال محجوزًا — لا تسجيل مكرر
  assert.equal((await act(c.factory2, draft, 'submit')).status, 409);

  // العزل: مستند الاعتراض لصاحبه وPMU فقط
  assert.equal((await c.factory2.get(`/registry-objections/${id}/document`)).status, 200);
  assert.equal((await c.pmu.get(`/registry-objections/${id}/document`)).status, 200);
  for (const client of [c.factory, c.imc, c.admin]) assert.ok([403, 404].includes((await client.get(`/registry-objections/${id}/document`)).status));
  assert.deepEqual((await c.factory.get('/registry-objections')).json.data.items, [], 'another factory sees none');
  assert.equal((await c.factory2.get('/registry-objections')).json.data.items.length, 1);
  assert.equal((await c.admin.get('/registry-objections')).status, 403);

  // القرار: PMU فقط، بسبب ومرجع
  for (const client of [c.imc, c.admin, c.factory2]) assert.equal((await client.post(`/registry-objections/${id}/accept`, decision)).status, 403);
  assert.equal((await c.pmu.post(`/registry-objections/${id}/accept`, { reason: 'قصير' })).status, 400);
  const ok = await c.pmu.post(`/registry-objections/${id}/accept`, decision);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.objection.status, 'accepted');
  assert.equal(ok.json.data.heldByOtherApplication.id, holder, 'PMU is told another open application still holds the number');
  assert.equal((await c.pmu.post(`/registry-objections/${id}/accept`, decision)).status, 409, 'single decision');

  // الرقم صار للمعترض فقط
  const { registryAccess } = await import('../src/store/registry.js');
  const f1 = await factoryId(c.factory);
  const f2 = await factoryId(c.factory2);
  assert.equal((await registryAccess(number, f2)).allowed, true);
  assert.equal((await registryAccess(number, f1)).allowed, false);

  // التاريخ والتدقيق والإشعارات
  const dispute = (await c.pmu.get('/registry-disputes')).json.data.items.find((d: any) => d.registryNumber === number);
  assert.equal(dispute.status, 'decided');
  assert.equal(dispute.allowedFactory.id, f2);
  assert.equal(dispute.allowedFactory.reference, decision.reference);
  assert.equal(dispute.conflicts.length, 1);
  assert.equal(dispute.objections.length, 1);
  assert.equal(dispute.blocks.length, 1);
  assert.equal(dispute.blocks[0].source, 'objection');
  assert.ok(dispute.parties.length >= 2);
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE action = 'registry_objection.accept' AND entityId = ?", id)).length === 1);
  await flushMail();
  assert.ok(sentMails.some((m) => m.to.includes('factory2@shams.local') && /قُبل اعتراضك/.test(m.html)), 'objector told');
  assert.ok(sentMails.some((m) => m.to.includes('imc1@shams.local') && /قرار بشأن رقم السجل/.test(m.subject)), 'IMC told to deal with the holder application');
});

test('PMU decides a dispute directly: only a party can be named, reason + reference required, pending objections closed with it', async () => {
  await closeOpen();
  const number = reg();
  const holder = await advanceTo('IMC_REVIEW', c, number);
  const draft = await createCompleteDraft(c.factory2, number);
  assert.equal((await act(c.factory2, draft, 'submit')).status, 409);
  const f1 = await factoryId(c.factory);
  const f2 = await factoryId(c.factory2);
  assert.equal((await c.factory2.upload('/registry-objections', { registryNumber: number }, PDF)).status, 201);

  const body = { registryNumber: number, allowedFactoryId: f1, ...decision };
  for (const client of [c.imc, c.admin, c.factory, c.factory2]) assert.equal((await client.post('/registry-disputes/decide', body)).status, 403);
  assert.equal((await c.pmu.post('/registry-disputes/decide', { ...body, reason: 'قصير' })).status, 400);
  assert.equal((await c.pmu.post('/registry-disputes/decide', { ...body, allowedFactoryId: 'fac-unknown' })).status, 400);
  assert.equal((await c.pmu.post('/registry-disputes/decide', { ...body, registryNumber: 'IND-NO-DISPUTE' })).status, 404);
  assert.equal((await c.pmu.post('/registry-disputes/decide', { ...body, isAdmin: true })).status, 400, 'unknown fields rejected');
  const listing = (await c.pmu.get('/registry-disputes')).json.data.items.find((d: any) => d.registryNumber === number);
  assert.equal(listing.status, 'open');
  assert.equal(listing.holderApplication.id, holder);

  const r = await c.pmu.post('/registry-disputes/decide', body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.dispute.status, 'decided');
  assert.equal(r.json.data.dispute.allowedFactory.id, f1);
  assert.equal(r.json.data.heldByOtherApplication, null, 'the holder is the named factory itself');
  const objs = (await c.pmu.get('/registry-objections')).json.data.items.filter((o: any) => o.registryNumber === number);
  assert.equal(objs[0].status, 'rejected', 'the competing objection is closed by the decision');
  const { registryAccess } = await import('../src/store/registry.js');
  assert.equal((await registryAccess(number, f1)).allowed, true);
  assert.equal((await registryAccess(number, f2)).allowed, false);
  assert.equal((await act(c.factory2, draft, 'submit')).status, 409, 'the other factory cannot register the number any more');
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE action = 'registry_dispute.decide' AND entityId = ?", number)).length === 1);
});

test('objection after an IMC ownership-mismatch rejection: reject keeps the block, a rejected factory may object again later', async () => {
  await closeOpen();
  const number = reg();
  const app = await advanceTo('IMC_REVIEW', c, number);
  assert.equal((await act(c.imc, app, 'reject', { reason: 'رقم السجل لمنشأة أخرى', reasonCode: 'registry_ownership_mismatch' })).status, 200);
  await flushMail();
  assert.ok(sentMails.some((m) => m.to.includes('factory@shams.local') && /حظر استخدام رقم السجل/.test(m.subject)), 'registry.blocked notice sent to the rejected factory');
  const again = await createCompleteDraft(c.factory, number);
  assert.equal((await act(c.factory, again, 'submit')).json.code, 'REGISTRY_BLOCKED');
  const o1 = await c.factory.upload('/registry-objections', { registryNumber: number }, PDF);
  assert.equal(o1.status, 201);
  const rej = await c.pmu.post(`/registry-objections/${o1.json.data.id}/reject`, decision);
  assert.equal(rej.status, 200);
  assert.equal(rej.json.data.objection.status, 'rejected');
  assert.equal((await act(c.factory, again, 'submit')).json.code, 'REGISTRY_BLOCKED', 'rejection leaves the block in place');
  const o2 = await c.factory.upload('/registry-objections', { registryNumber: number }, PDF);
  assert.equal(o2.status, 201, 'a new objection is possible after a rejected one');
  const d = (await c.pmu.get('/registry-disputes')).json.data.items.find((x: any) => x.registryNumber === number);
  assert.equal(d.status, 'open');
  assert.equal(d.objections.length, 2, 'history keeps both objections');
});
