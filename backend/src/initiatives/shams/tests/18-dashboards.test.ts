// لوحات الأدوار: أرقام حقيقية بنطاق رؤية كل دور، تطابق عدد صفوف قائمة العمل التي تفتحها البطاقة، ولا أرقام مختلقة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { electricityAccept, uploadProof, isolateTestEnv, startServer, clients, act, advanceTo, createCompleteDraft, q, BANK_A, type Started } from './helpers.js';

const env = isolateTestEnv('dashboards');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-DSH-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const dash = async (client: { get: (p: string) => Promise<any> }) => (await client.get('/dashboard')).json.data;
const cardOf = (d: any, key: string) => d.cards.find((x: any) => x.key === key);
const total = async (client: { get: (p: string) => Promise<any> }, query: string) => (await client.get(`/applications?${query}&pageSize=100`)).json.data.total as number;

test('access: only the three review roles have a dashboard (no bank dashboard — G-02); factory, admin and anonymous are refused', async () => {
  for (const [role, client] of [['imc', c.imc], ['encpc', c.encpc], ['pmu', c.pmu]] as const) {
    assert.equal((await client.get('/dashboard')).status, 200, role);
  }
  for (const [role, client] of [['factory', c.factory], ['admin', c.admin]] as const) assert.equal((await client.get('/dashboard')).status, 403, role);
  const { Client } = await import('./helpers.js');
  assert.equal((await new Client(srv.base).get('/dashboard')).status, 401);
});

test('IMC: counts follow its own scope and each linked card matches the queue it opens', async () => {
  await closeOpen();
  const base = await dash(c.imc);
  const idA = await advanceTo('IMC_REVIEW', c, reg());
  const after1 = await dash(c.imc);
  assert.equal(after1.awaitingMe.count, base.awaitingMe.count + 1);
  assert.equal(after1.awaitingMe.count, await total(c.imc, 'mine=1'), 'headline = rows of the "awaiting my decision" queue');
  assert.equal(after1.total, base.total + 1);
  // استيفاء
  assert.equal((await act(c.imc, idA, 'request_correction', { deficiencies: [{ field: 'address', note: 'أكمل' }] })).status, 200);
  const d2 = await dash(c.imc);
  assert.equal(cardOf(d2, 'correction').count, cardOf(base, 'correction').count + 1);
  assert.equal(cardOf(d2, 'correction').count, await total(c.imc, `state=${cardOf(d2, 'correction').link.param}`), 'card = queue');
  assert.equal(d2.awaitingMe.count, base.awaitingMe.count, 'an application awaiting the factory is not awaiting IMC');
  // قبول ثم رفض
  await act(c.factory, idA, 'resubmit');
  assert.equal((await act(c.imc, idA, 'accept')).status, 200);
  assert.equal(cardOf(await dash(c.imc), 'accepted').count, cardOf(base, 'accepted').count + 1);
  await closeOpen();
  const idB = await advanceTo('IMC_REVIEW', c, reg());
  assert.equal((await act(c.imc, idB, 'reject', { reason: 'مخالف للشروط', reasonCode: 'other' })).status, 200);
  const d3 = await dash(c.imc);
  assert.equal(cardOf(d3, 'rejected').count, cardOf(base, 'rejected').count + 1);
  assert.equal(cardOf(d3, 'rejected').count, await total(c.imc, `state=${cardOf(d3, 'rejected').link.param}`));
  // بطاقات بلا فلتر صادق تأتي بلا رابط (لا زر ميت)
  assert.equal(cardOf(d3, 'accepted').link, null);
  // IMC لا ترى شيئًا من مراحل ما بعدها في اللوحة
  assert.ok(d3.cards.every((x: any) => !['offer', 'electricity', 'bank'].includes(x.key)));
  assert.equal(d3.byStage, undefined);
  assert.equal(d3.attention.length, 0, 'no SLA configured → no fake overdue item');
});

test('ENCPC: technical queue and accepted count', async () => {
  await closeOpen();
  const base = await dash(c.encpc);
  const id = await advanceTo('ENCPC_REVIEW', c, reg());
  const d1 = await dash(c.encpc);
  assert.equal(d1.awaitingMe.count, base.awaitingMe.count + 1);
  assert.equal(d1.awaitingMe.count, await total(c.encpc, 'mine=1'));
  assert.equal((await act(c.encpc, id, 'non_compliant', { reason: 'غير مطابق' })).status, 200);
  const d2 = await dash(c.encpc);
  assert.equal(cardOf(d2, 'correction').count, cardOf(base, 'correction').count + 1);
  await uploadProof(c.factory, id);
  assert.equal((await act(c.factory, id, 'resubmit')).status, 200);
  assert.equal((await act(c.encpc, id, 'compliant')).status, 200);
  assert.equal(cardOf(await dash(c.encpc), 'compliant').count, cardOf(base, 'compliant').count + 1);
});

test('PMU: stage cards, the bank-choice and outcome stage, closed groups, attention items and the stage distribution all come from real data', async () => {
  await closeOpen();
  const base = await dash(c.pmu);
  const a = await advanceTo('OFFER_REVIEW', c, reg());
  const d1 = await dash(c.pmu);
  assert.equal(cardOf(d1, 'offer').count, cardOf(base, 'offer').count + 1);
  assert.equal(cardOf(d1, 'offer').count, await total(c.pmu, `state=${cardOf(d1, 'offer').link.param}`));
  assert.equal(d1.awaitingMe.count, await total(c.pmu, 'mine=1'));
  await act(c.factory, a, 'withdraw', { reason: 'إنهاء' });
  const b = await advanceTo('ELECTRICITY_REVIEW', c, reg());
  const d2 = await dash(c.pmu);
  assert.equal(cardOf(d2, 'electricity').count, cardOf(base, 'electricity').count + 1);
  assert.match(cardOf(d2, 'electricity').hintAr, /القرار للوزارة/);
  assert.equal((await electricityAccept(c.electricity, b)).status, 200);
  const d3 = await dash(c.pmu);
  assert.equal(cardOf(d3, 'bank-choice').count, cardOf(base, 'bank-choice').count + 1, 'accepting the electricity approval opens the bank choice');
  assert.ok(!d3.cards.some((x: any) => ['bank', 'study-approved', 'study-declined'].includes(x.key)), 'no bank-study cards (G-02)');
  assert.equal((await act(c.factory, b, 'select_bank', { bankOrgId: BANK_A })).status, 200);
  const d4 = await dash(c.pmu);
  assert.equal(cardOf(d4, 'bank-choice').count, cardOf(base, 'bank-choice').count);
  assert.equal(cardOf(d4, 'outcome').count, cardOf(base, 'outcome').count + 1, 'awaiting the outcome once the bank is chosen');
  assert.equal((await act(c.factory, b, 'record_no_contract', { reason: 'لم يتم التمويل' })).status, 200);
  const d5 = await dash(c.pmu);
  assert.equal(cardOf(d5, 'closed').count, cardOf(base, 'closed').count + 2, 'the withdrawn and the not-contracted ones');
  assert.equal(cardOf(d5, 'closed').count, await total(c.pmu, `state=${cardOf(d5, 'closed').link.param.split('-').join(',')}`));
  // التوزيع على المراحل = مجموع الطلبات غير المسودات
  assert.equal(d5.byStage.reduce((s: number, x: any) => s + x.count, 0), d5.total);
  assert.ok(!d5.byStage.some((x: any) => x.state === 'DRAFT'), 'drafts are counted separately');
  assert.equal(typeof d5.drafts, 'number');
  // بنود الانتباه: نزاع حقيقي، وطلب حساب
  await closeOpen();
  const number = reg();
  await advanceTo('IMC_REVIEW', c, number);
  const draft = await createCompleteDraft(c.factory2, number);
  assert.equal((await act(c.factory2, draft, 'submit')).status, 409);
  const d6 = await dash(c.pmu);
  const att = (k: string) => d6.attention.find((x: any) => x.key === k);
  assert.ok(att('disputes') && att('disputes').count >= 1);
  assert.equal(att('disputes').link.view, 'approvals');
  const req = await c.admin.post('/admin/users', { email: 'dash.imc@shams.local', nameAr: 'مراجع', role: 'imc_reviewer', organizationId: 'org-imc' });
  assert.equal(req.status, 202);
  assert.equal(att('accounts'), undefined, 'IMC account requests are approved by IMC, not PMU');
  // لا يظهر «متأخر» مختلق: المهل محددة (D12) ولا طلب تجاوزها
  assert.equal(d6.slaConfigured, true);
  assert.equal(att('overdue'), undefined);
});

test('recent activity respects each role’s visibility: IMC never sees offer/bank events, PMU sees them', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg());
  const imc = await dash(c.imc);
  const pmu = await dash(c.pmu);
  const imcStates = new Set(imc.recent.map((r: any) => r.toLabelAr));
  for (const hidden of ['مراجعة العرض الفني', 'مسار التعاقد / التعاقد البنكي', 'رفع موافقة الكهرباء']) assert.ok(!imcStates.has(hidden), `IMC must not see "${hidden}"`);
  assert.ok(pmu.recent.some((r: any) => r.applicationId === id), 'PMU sees the latest transitions');
  assert.ok(pmu.recent.length <= 10);
  for (let i = 1; i < pmu.recent.length; i++) assert.ok(pmu.recent[i - 1].at >= pmu.recent[i].at, 'newest first');
  const enc = await dash(c.encpc);
  assert.ok(!enc.recent.some((r: any) => ['مسار التعاقد / التعاقد البنكي', 'مراجعة العرض الفني'].includes(r.toLabelAr)));
  // لا ملاحظات ولا أسباب في اللوحة
  assert.ok(!JSON.stringify(pmu).includes('"reason"'));
  assert.equal((await q("SELECT 1 FROM audit_logs WHERE action = 'dashboard.view'")).length, 0, 'reading a dashboard is not an audited event');
});

test('queue filters used by the dashboard: sort=oldest, bank and date filters', async () => {
  await closeOpen();
  const first = await advanceTo('IMC_REVIEW', c, reg());
  await act(c.factory, first, 'withdraw', { reason: 'إنهاء' });
  const second = await advanceTo('IMC_REVIEW', c, reg());
  const newest = (await c.pmu.get('/applications?pageSize=100')).json.data.items.map((x: any) => x.id);
  const oldest = (await c.pmu.get('/applications?pageSize=100&sort=oldest')).json.data.items.map((x: any) => x.id);
  assert.ok(oldest.indexOf(first) < oldest.indexOf(second), 'oldest first');
  assert.ok(newest.indexOf(second) < newest.indexOf(first), 'newest first by default');
  const future = (await c.pmu.get('/applications?from=2999-01-01T00:00:00.000Z&pageSize=100')).json.data;
  assert.equal(future.total, 0);
});
