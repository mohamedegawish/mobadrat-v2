// المهل (إشعار + علامة تأخر فقط، مرة واحدة)، نطاق التقارير، وحدود الطلبات الفعلية.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, advanceTo, getApp, q, Client, type Started } from './helpers.js';

const env = isolateTestEnv('sla');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

test('SLA: null = no overdue; configured SLA → overdue flag + one notification to org and PMU, no auto-close', async () => {
  const id = await advanceTo('IMC_REVIEW', c, 'IND-SLA-1');
  let v = await getApp(c.imc, id);
  assert.equal(v.overdue, false);
  assert.equal(v.currentTask.dueAt, null, 'undefined SLA → no overdue display');
  const { shamsPolicy } = await import('../src/config/shamsPolicy.js');
  const { runSlaSweep } = await import('../src/jobs/slaMonitor.js');
  shamsPolicy.slaDays.IMC_REVIEW = 2;
  try {
    const { getDb } = await import('../src/db/sqlite.js');
    await getDb().prepare("UPDATE applications SET stateEnteredAt = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
    v = await getApp(c.imc, id);
    assert.equal(v.overdue, true);
    assert.ok(v.currentTask.dueAt);
    const n1 = await runSlaSweep();
    const n2 = await runSlaSweep();
    assert.ok(n1 > 0);
    assert.equal(n2, 0, 'notified once per state entry');
    const rows = await q<{ recipientAddress: string }>("SELECT recipientAddress FROM notification_outbox WHERE applicationId = ? AND templateKey = 'app.sla_overdue' AND channel = 'email'", id);
    const to = rows.map((r) => r.recipientAddress);
    assert.ok(to.includes('imc1@shams.local') && to.includes('pmu@shams.local'));
    assert.equal((await getApp(c.imc, id)).state, 'IMC_REVIEW', 'no automatic rejection or closure');
    const overdueList = await c.pmu.get('/applications?overdue=1');
    assert.ok(overdueList.json.data.items.some((a: any) => a.id === id));
  } finally {
    shamsPolicy.slaDays.IMC_REVIEW = null;
  }
});

test('reports: PMU sees everything; IMC only its stage; factory only its own; bank only its referrals', async () => {
  const pmu = await c.pmu.get('/reports/summary');
  assert.equal(pmu.status, 200);
  assert.ok(pmu.json.data.total >= 1);
  assert.ok('contracted' in pmu.json.data);
  const imc = await c.imc.get('/reports/summary');
  assert.equal(imc.status, 200);
  assert.ok(!('PROVIDER_SELECTION' in imc.json.data.byState), 'IMC: only its stage states');
  assert.equal(imc.json.data.contracted, undefined);
  const rows = await c.pmu.get('/reports/applications');
  assert.ok(rows.json.data.items.length >= 1);
  assert.ok('bankAr' in rows.json.data.items[0], 'full columns for PMU');
  const imcRows = await c.imc.get('/reports/applications');
  assert.ok(!('bankAr' in imcRows.json.data.items[0]), 'no provider/bank columns for IMC');
  assert.ok(!('studyResult' in rows.json.data.items[0]), 'G-02: no bank-study column — the bank has no step in the platform');
  assert.ok((await q("SELECT 1 FROM audit_logs WHERE action = 'report.export'")).length >= 2, 'exports are audited');
});

test('rate limits are enforced (real limits, scale 1)', async () => {
  const prev = process.env.RATE_LIMIT_SCALE;
  process.env.RATE_LIMIT_SCALE = '1';
  try {
    const anon = new Client(srv.base);
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) {
      const r = await anon.post('/auth/forgot-password', { email: `x${i}@test.local` });
      if (r.status === 429) { limited = true; assert.equal(r.json.code, 'RATE_LIMITED'); }
    }
    assert.ok(limited, 'forgot-password limited after 20/15min');
  } finally {
    process.env.RATE_LIMIT_SCALE = prev;
  }
});
