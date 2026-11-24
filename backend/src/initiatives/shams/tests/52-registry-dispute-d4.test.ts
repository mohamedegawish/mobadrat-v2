// F3 / D4 + D5 (QA 2026-11-23, BUG-09): a registry dispute decision is enforced at every stage.
//  - While an objection is under PMU review, the holder's application does not move forward (IMC/ENCPC/PMU are refused).
//  - PMU authorises the objector → the holder's open application closes as Rejected (REGISTRY_OWNERSHIP) at any stage, both
//    histories record it, and the objector can submit. PMU authorises the holder → the objection closes, the holder moves on,
//    and the objector stays blocked.
//  - D5: the losing factory's notice carries the decision, reason and reference, never the other company's name.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, clients, act, getApp, q, pdfVariant, Client, registerFactory, registrationPayload, activationTokenFor,
  advanceTo, type Started,
} from './helpers.js';

const env = isolateTestEnv('d4');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function freeFactory2() {
  const own = (await c.factory2.get('/factory/profile')).json.data.openApplicationId;
  if (own) await act(c.factory2, own, 'withdraw', { reason: 'تنظيف قبل الاختبار' });
}
/** A brand-new factory signs up with the holder's number (held draft) and objects. */
async function objector(N: string, company: string) {
  const email = `d4-${process.pid}-${++seq}@factory.test`;
  assert.equal((await registerFactory(new Client(srv.base), registrationPayload(email, N, { companyName: company }))).status, 201);
  await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(email) });
  const f = await new Client(srv.base).login(email, 'Factory123');
  const appId = (await q<{ id: string }>("SELECT a.id FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId JOIN shams_organizations o ON o.id = f.organizationId WHERE o.contactEmail = ?", email))[0].id;
  const o = await f.multipart('/registry-objections', { registryNumber: N, note: 'الرقم لمنشأتنا' }, [{ field: 'file', body: pdfVariant(`obj-${N}`), name: 'objection.pdf' }]);
  assert.equal(o.status, 201, JSON.stringify(o.json));
  return { f, appId, email, objectionId: o.json.data.id as string };
}
const mailsTo = (emails: string[], key: string) => q<{ body: string; recipientAddress: string }>(
  `SELECT body, recipientAddress FROM notification_outbox WHERE templateKey = ? AND channel = 'email' AND recipientAddress IN (${emails.map(() => '?').join(',')})`, key, ...emails);

test('objector authorised after IMC acceptance: frozen while pending, then the holder closes as Rejected (REGISTRY_OWNERSHIP)', async () => {
  await freeFactory2();
  const N = `IND-D4-A-${process.pid}`;
  const holderId = await advanceTo('ENCPC_REVIEW', { factory: c.factory2, imc: c.imc, encpc: c.encpc, pmu: c.pmu }, N);
  const holderCompany = (await getApp(c.pmu, holderId)).companyName as string;
  const e = await objector(N, 'مصنع المعترض الفائز');
  // frozen
  const frozen = await act(c.encpc, holderId, 'compliant');
  assert.equal(frozen.status, 409);
  assert.equal(frozen.json.code, 'REGISTRY_DISPUTE_OPEN');
  const encpcView = await getApp(c.encpc, holderId);
  assert.equal(encpcView.registryDisputeOpen, true);
  assert.deepEqual(encpcView.allowedActions, [], 'no buttons while frozen');
  // PMU authorises the objector
  const d = await c.pmu.post(`/registry-objections/${e.objectionId}/accept`, { reason: 'مستندات الملكية تخص المنشأة المعترضة', reference: 'PMU-D4-A' });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  const holder = await getApp(c.pmu, holderId);
  assert.equal(holder.state, 'REJECTED', 'closed at ENCPC review');
  const t = holder.transitions.at(-1);
  assert.equal(t.action, 'registry_dispute_reject');
  assert.equal(t.fromState, 'ENCPC_REVIEW');
  assert.equal((await q<{ payload: string }>('SELECT payload FROM shams_application_transitions WHERE id = ?', t.id))[0].payload.includes('REGISTRY_OWNERSHIP'), true);
  assert.equal((await act(c.encpc, holderId, 'compliant')).status, 409, 'no one can move the losing application');
  // the objector's history and its submit
  const ev = await getApp(e.f, e.appId);
  assert.ok(ev.transitions.some((x: any) => x.action === 'registry_dispute_decided'), 'objector history records the decision');
  const sub = await act(e.f, e.appId, 'submit');
  assert.equal(sub.status, 200, `objector unblocked: ${JSON.stringify(sub.json)}`);
  // D5 notices
  const { processNotifications } = await import('../jobs/notificationWorker.js');
  await processNotifications(200);
  const f2 = c.factory2.user.email as string;
  const lost = await mailsTo([f2], 'registry.decision_lost');
  assert.equal(lost.length, 1, 'the losing holder gets the decision');
  assert.ok(!lost[0].body.includes('مصنع المعترض الفائز'), 'without the other company name');
  assert.ok(lost[0].body.includes('PMU-D4-A'), 'with the reference');
  const rejected = await mailsTo([f2], 'app.rejected');
  assert.ok(rejected.length >= 1 && rejected.every((m) => !m.body.includes('مصنع المعترض الفائز')), 'closing notice without the other name');
  const staff = await mailsTo(['imc1@shams.local'], 'registry.released');
  assert.ok(staff.some((m) => m.body.includes('مصنع المعترض الفائز') && m.body.includes(holderCompany)), 'IMC sees both names');
  await act(e.f, e.appId, 'withdraw', { reason: 'تنظيف بعد الاختبار' });
});

test('holder authorised: the objection closes, the holder moves on, the objector stays blocked (no other name in its notice)', async () => {
  await freeFactory2();
  const N = `IND-D4-B-${process.pid}`;
  const holderId = await advanceTo('IMC_REVIEW', { factory: c.factory2, imc: c.imc, encpc: c.encpc, pmu: c.pmu }, N);
  const holderCompany = (await getApp(c.pmu, holderId)).companyName as string;
  const e = await objector(N, 'مصنع المعترض الخاسر');
  assert.equal((await act(c.imc, holderId, 'accept')).json.code, 'REGISTRY_DISPUTE_OPEN', 'IMC cannot accept while the dispute is open');
  const holderFactoryId = (await getApp(c.pmu, holderId)).factoryId as string;
  const d = await c.pmu.post('/registry-disputes/decide', { registryNumber: N, allowedFactoryId: holderFactoryId, reason: 'السجل الصناعي باسم المنشأة الأولى', reference: 'PMU-D4-B' });
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal((await q<{ status: string }>('SELECT status FROM shams_registry_objections WHERE id = ?', e.objectionId))[0].status, 'rejected');
  assert.equal((await act(c.imc, holderId, 'accept')).status, 200, 'the holder moves on');
  assert.ok((await getApp(c.pmu, holderId)).transitions.some((x: any) => x.action === 'registry_dispute_decided'), 'holder history records the decision');
  const ev = await getApp(e.f, e.appId);
  assert.ok(ev.transitions.some((x: any) => x.action === 'registry_dispute_decided'));
  const sub = await act(e.f, e.appId, 'submit');
  assert.equal(sub.status, 409, 'the objector stays blocked');
  const { processNotifications } = await import('../jobs/notificationWorker.js');
  await processNotifications(200);
  const lost = await mailsTo([e.email], 'registry.decision_lost');
  assert.equal(lost.length, 1);
  assert.ok(!lost[0].body.includes(holderCompany), 'the loser does not learn the holder name');
  await act(c.factory2, holderId, 'withdraw', { reason: 'تنظيف بعد الاختبار' });
});
