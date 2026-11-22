// إصلاحات مراجعة القبول (docs/FIX_REPORT.md) — التشغيل: الطرق المغلقة (B2)، إعادة الإحالة (I4)، مقدم الخدمة الموقوف (I11)،
// قيمة التعاقد (I8)، صلاحيات الأدمن ومقدمي الخدمة (21)، قوائم العمل واللوحات والتقرير (I5 I6 I7 M5 M6).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, q, pdfVariant, uploadContractFile, PROVIDER_OK, BANK_A, BANK_B, onMysql, type Started,
} from './helpers.js';

const env = isolateTestEnv('ops');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-OPS-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const outbox = (appId: string, key: string) => q<{ recipientAddress: string; channel: string }>(
  'SELECT recipientAddress, channel FROM notification_outbox WHERE applicationId = ? AND templateKey = ?', appId, key);

test('G-02: a bank is an external institution — an active configured bank is offered without any user; an inactive one is hidden and refused', async () => {
  await closeOpen();
  const created = await c.admin.post('/admin/organizations', { type: 'bank', nameAr: 'بنك خارجي بلا مستخدمين', nameEn: 'External bank' });
  assert.equal(created.status, 201);
  const ext = created.json.data.id as string;
  const banks = async () => (await c.factory.get('/meta')).json.data.banks.map((b: any) => b.id);
  assert.ok((await banks()).includes(ext), 'offered although it has no platform user');
  const id = await advanceTo('BANK_SELECTION', c, reg());
  assert.equal((await c.admin.put(`/admin/organizations/${ext}`, { isActive: false })).status, 200);
  assert.ok(!(await banks()).includes(ext), 'inactive bank hidden');
  const r = await act(c.factory, id, 'select_bank', { bankOrgId: ext });
  assert.equal(r.status, 422); assert.equal(r.json.code, 'BANK_INVALID');
  assert.equal((await c.admin.put(`/admin/organizations/${ext}`, { isActive: true })).status, 200);
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: ext })).status, 200, 'chosen once active again');
  const ready = (await c.admin.get('/admin/readiness')).json.data.checks;
  assert.ok(!ready.find((x: any) => x.key === 'orgs_without_users').items.some((i: any) => i.id === ext), 'a bank without users is not a readiness problem');
});

test('B2: entering a stage whose organization has no active users alerts PMU and admin', async () => {
  await closeOpen();
  const id = await advanceTo('IMC_REVIEW', c, reg());
  const encpcUser = 'usr-encpc-1';
  assert.equal((await c.admin.put(`/admin/users/${encpcUser}`, { isActive: false })).status, 200);
  try {
    assert.equal((await act(c.imc, id, 'accept')).status, 200);
    const alerts = (await outbox(id, 'ops.no_recipients')).filter((r) => r.channel === 'email').map((r) => r.recipientAddress);
    assert.ok(alerts.includes('pmu@shams.local') && alerts.includes('admin@shams.local'), `alerts: ${alerts}`);
    assert.ok(!(await outbox(id, 'app.review_assigned')).some((r) => r.recipientAddress === 'encpc@shams.local'));
    const ready = await c.admin.get('/admin/readiness');
    assert.equal(ready.status, 200);
    const orgs = ready.json.data.checks.find((x: any) => x.key === 'orgs_without_users');
    assert.equal(orgs.ok, false);
    assert.ok(orgs.items.some((i: any) => i.id === 'org-encpc'));
    assert.ok(ready.json.data.stuck.some((s: any) => s.id === id), 'stuck application listed');
  } finally {
    await c.admin.put(`/admin/users/${encpcUser}`, { isActive: true });
  }
});

test('B2: reaching provider selection with no approved provider alerts PMU and admin', async () => {
  await closeOpen();
  const id = await advanceTo('ENCPC_REVIEW', c, reg());
  for (const p of ['sp-demo-1', 'sp-demo-2']) assert.equal((await c.pmu.post(`/service-providers/${p}/suspend`, {})).status, 200);
  try {
    assert.equal((await act(c.encpc, id, 'compliant')).status, 200);
    const alerts = (await outbox(id, 'ops.no_providers')).map((r) => r.recipientAddress);
    assert.ok(alerts.includes('pmu@shams.local') && alerts.includes('admin@shams.local'));
    const ready = (await c.admin.get('/admin/readiness')).json.data;
    assert.equal(ready.checks.find((x: any) => x.key === 'providers_approved').ok, false);
  } finally {
    for (const p of ['sp-demo-1', 'sp-demo-2']) await c.pmu.post(`/service-providers/${p}/approve`, {});
  }
});

test('B2/I9: check:readiness fails without a support channel and reports each condition', async () => {
  const run = (extra: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/checkReadiness.ts'], {
    cwd: path.resolve(import.meta.dirname, '..', '..', '..', '..'), encoding: 'utf8', env: { ...process.env, ...extra },
  });
  const missing = run({ SUPPORT_EMAIL: '', SUPPORT_PHONE: '' });
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stdout, /قناة استفسار رسمية/);
  assert.match(missing.stderr, /check:readiness FAILED/);
  // No database: a missing SQLite file, or (MySQL) a database that does not exist on the server.
  const missingMysql = () => { const u = new URL(process.env.DATABASE_URL!); u.pathname = '/mbt_missing_db_x'; return u.toString(); };
  const noDb = run(onMysql ? { DATABASE_URL: missingMysql() } : { DB_PATH: path.join(env.dir, 'missing.db') });
  assert.equal(noDb.status, 1);
  const { readinessReport } = await import('../services/readiness.js');
  process.env.SUPPORT_EMAIL = 'support@shams.test';
  process.env.SUPPORT_PHONE = '19000';
  try {
    assert.equal((await readinessReport()).checks.find((x) => x.key === 'support_contact')!.ok, true);
  } finally { delete process.env.SUPPORT_EMAIL; delete process.env.SUPPORT_PHONE; }
});

test('G-02: no bank referral or reassignment exists — PMU cannot move the bank; the retired actions are unknown to the server', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), BANK_A);
  const v = (await getApp(c.pmu, id)).version;
  for (const action of ['reassign_bank', 'record_result']) {
    const r = await c.pmu.post(`/applications/${id}/actions/${action}`, { expectedVersion: v, bankOrgId: BANK_B, reason: 'محاولة', studyResult: 'approved', studyDate: '2026-10-01' });
    assert.equal(r.status, 404, action);
  }
  assert.deepEqual((await getApp(c.pmu, id)).allowedActions, [], 'PMU has no action after the electricity acceptance');
  assert.equal((await getApp(c.pmu, id)).bank.id, BANK_A, 'bank unchanged');
});

test('disabling a bank chosen by open applications needs explicit confirmation, alerts PMU, and never blocks the factory from recording the outcome', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), BANK_A);
  const blocked = await c.admin.put(`/admin/organizations/${BANK_A}`, { isActive: false });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'OPEN_REFERRALS');
  assert.match(blocked.json.messageAr, /1 طلب/);
  assert.equal((await q("SELECT isActive FROM shams_organizations WHERE id = ?", BANK_A))[0].isActive, 1, 'nothing changed');
  const ok = await c.admin.put(`/admin/organizations/${BANK_A}`, { isActive: false, confirmOpenReferrals: true });
  assert.equal(ok.status, 200);
  try {
    const alert = await q<{ recipientAddress: string }>("SELECT recipientAddress FROM notification_outbox WHERE templateKey = 'ops.bank_unavailable'");
    assert.ok(alert.some((a) => a.recipientAddress === 'pmu@shams.local'));
    assert.ok(!(await c.admin.get('/admin/readiness')).json.data.stuck.some((s: any) => s.id === id), 'not stuck: the factory still acts');
    const done = await act(c.factory, id, 'record_no_contract', { reason: 'البنك أوقف التمويل' });
    assert.equal(done.status, 200, 'outcome recorded although the bank is now inactive (the bank is external)');
  } finally {
    await c.admin.put(`/admin/organizations/${BANK_A}`, { isActive: true });
  }
});

test('I11: provider suspended before the offer is sent → submit_offer blocked, reselection allowed; during offer review → returned to offer upload (details in test 15)', async () => {
  await closeOpen();
  const id = await advanceTo('PROVIDER_SELECTION', c, reg());
  assert.equal((await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK })).status, 200);
  const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('o-1'), 'offer.pdf');
  assert.equal(up.status, 201);
  assert.deepEqual((await getApp(c.factory, id)).allowedActions.map((a: any) => a.action).sort(), ['submit_offer', 'withdraw']);
  assert.equal((await act(c.factory, id, 'select_provider', { providerId: 'sp-demo-2' })).status, 409, 'cannot change an approved provider');
  assert.equal((await c.pmu.post(`/service-providers/${PROVIDER_OK}/suspend`, {})).status, 200);
  try {
    const v = await getApp(c.factory, id);
    assert.equal(v.provider.status, 'suspended');
    assert.deepEqual(v.allowedActions.map((a: any) => a.action).sort(), ['select_provider', 'withdraw']);
    const blocked = await act(c.factory, id, 'submit_offer');
    assert.equal(blocked.status, 422);
    assert.equal(blocked.json.code, 'PROVIDER_SUSPENDED');
    assert.ok((await outbox(id, 'app.provider_suspended')).some((r) => r.recipientAddress === 'factory@shams.local'));
    assert.equal((await act(c.factory, id, 'select_provider', { providerId: 'sp-demo-1' })).status, 422, 'suspended provider cannot be re-chosen');
    const re = await act(c.factory, id, 'select_provider', { providerId: 'sp-demo-2' });
    assert.equal(re.status, 200, JSON.stringify(re.json));
    const after1 = await getApp(c.factory, id);
    assert.equal(after1.state, 'OFFER_UPLOAD');
    assert.equal(after1.provider.id, 'sp-demo-2');
    assert.ok(after1.transitions.some((t: any) => t.action === 'select_provider' && t.fromState === 'OFFER_UPLOAD'));
    assert.equal((await act(c.factory, id, 'submit_offer')).status, 422, 'a new offer from the new provider is required');
    await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('o-2'), 'offer2.pdf');
    assert.equal((await act(c.factory, id, 'submit_offer')).status, 200);
    // أثناء مراجعة العرض (القرار 6): الإيقاف يعيد الطلب آليًا إلى رفع العرض — لا قبول لعرض مقدم موقوف.
    assert.equal((await c.pmu.post('/service-providers/sp-demo-2/suspend', {})).status, 200);
    const pmuView = await getApp(c.pmu, id);
    assert.equal(pmuView.state, 'OFFER_UPLOAD');
    assert.equal(pmuView.provider.status, 'suspended');
    assert.ok(!pmuView.allowedActions.some((a: any) => a.action === 'accept'));
    assert.ok(pmuView.transitions.some((t: any) => t.action === 'provider_suspended_return' && t.fromState === 'OFFER_REVIEW' && t.toState === 'OFFER_UPLOAD'));
  } finally {
    await c.pmu.post(`/service-providers/${PROVIDER_OK}/approve`, {});
    await c.pmu.post('/service-providers/sp-demo-2/approve', {});
  }
});

test('I8: contract amount above the alert threshold is recorded (not rejected), labelled factory-recorded, and alerts PMU', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg());
  await uploadContractFile(c.factory, id);
  const r = await act(c.factory, id, 'record_contract', { contractDate: '2026-10-15', contractAmount: 900_000_000 });
  assert.equal(r.status, 200);
  const v = await getApp(c.pmu, id);
  assert.equal(v.state, 'CONTRACTED');
  assert.equal(v.bankReferral.contractAmountRecordedBy, 'factory');
  assert.equal(v.bankReferral.contractAmountAboveAlert, true);
  assert.ok((await outbox(id, 'ops.contract_amount_alert')).some((x) => x.recipientAddress === 'pmu@shams.local'));
  const s = (await c.pmu.get('/reports/summary')).json.data;
  assert.equal(s.contracted.amountRecordedBy, 'factory');
  assert.ok(s.contracted.aboveAlertCount >= 1);
  assert.equal(s.contracted.alertThresholdEGP, 100_000_000);
});

test('21: providers are approved by PMU only; admin sees application metadata only (no data, no download)', async () => {
  assert.equal((await c.admin.post('/service-providers/sp-demo-3/approve', {})).status, 403);
  assert.equal((await c.admin.post('/service-providers', { nameAr: 'مقدم من الأدمن' })).status, 403);
  await closeOpen();
  const id = await advanceTo('OFFER_REVIEW', c, reg());
  const a = await getApp(c.admin, id);
  assert.equal(a.metadataOnly, true);
  assert.deepEqual(Object.keys(a.data).filter((k) => ['general', 'contact', 'company', 'engineering'].includes(k)), []);
  assert.ok(a.documents.length > 0 && a.documents.every((d: any) => d.downloadable === false), 'metadata only');
  assert.equal(a.registry.facility, null);
  for (const d of a.documents) assert.equal((await c.admin.get(`/applications/${id}/documents/${d.id}/download`)).status, 404);
  const p = await getApp(c.pmu, id);
  assert.ok(p.data.general && p.documents.every((d: any) => d.downloadable === true));
  assert.equal((await c.pmu.get(`/applications/${id}/documents/${p.documents[0].id}/download`)).status, 200);
  const rows = (await c.admin.get('/reports/applications')).json.data.items;
  assert.ok(!('contractAmount' in rows[0]), 'no financing columns for admin');
});

test('M5/I6: PMU work queue excludes drafts (counted separately) and "awaiting me" lists the oldest first', async () => {
  await closeOpen();
  await createCompleteDraft(c.factory2, reg());
  const a1 = await advanceTo('OFFER_REVIEW', c, reg());
  const all = (await c.pmu.get('/applications?pageSize=100')).json.data;
  assert.ok(all.items.every((i: any) => i.state !== 'DRAFT'));
  assert.ok(all.draftsCount >= 1);
  const drafts = (await c.pmu.get('/applications?state=DRAFT')).json.data;
  assert.ok(drafts.items.length >= 1 && drafts.items.every((i: any) => i.state === 'DRAFT'));
  const { getDb } = await import('../db/sqlite.js');
  await getDb().prepare("UPDATE shams_applications SET stateEnteredAt = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(a1);
  const mine = (await c.pmu.get('/applications?mine=1')).json.data.items;
  const dates = mine.map((i: any) => i.stateEnteredAt);
  assert.deepEqual(dates, [...dates].sort(), 'oldest first');
  assert.equal(mine[0].id, a1);
  assert.ok(mine[0].daysInState > 100);
  await act(c.factory2, (await c.factory2.get('/factory/profile')).json.data.openApplicationId, 'withdraw', { reason: 'إنهاء المسودة' });
});

test('I5: without any SLA the summary says so instead of "overdue: 0"', async () => {
  const s = (await c.pmu.get('/reports/summary')).json.data;
  assert.equal(s.slaConfigured, false);
  assert.equal((await c.pmu.get('/meta')).json.data.policy.slaConfigured, false);
});

test('I7: the Excel sheet has Arabic headers, readable names, Cairo time and yes/no', async () => {
  const r = (await c.pmu.get('/reports/applications')).json.data;
  const { headers, rows } = r.sheet;
  assert.ok(headers.every((h: string) => /[؀-ۿ]/.test(h)), `Arabic headers: ${headers}`);
  assert.ok(!headers.some((h: string) => /^[a-z]+[A-Z]/.test(h)), 'no camelCase keys');
  const gov = headers.indexOf('المحافظة');
  assert.ok(rows.some((row: any[]) => row[gov] === 'الشرقية'), 'governorate name, not code');
  const state = headers.indexOf('الحالة');
  assert.ok(!rows.some((row: any[]) => /^[A-Z_]+$/.test(String(row[state]))), 'state label, not code');
  const sub = headers.indexOf('تاريخ الإرسال (القاهرة)');
  assert.ok(rows.some((row: any[]) => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(String(row[sub]))), 'Cairo dd/mm/yyyy hh:mm');
  const { cairoDateTime } = await import('../services/reports.js');
  assert.equal(cairoDateTime('2026-11-02T22:30:00.000Z'), '03/11/2026 00:30', 'UTC+2 Cairo (no DST in November)');
  const above = headers.findIndex((h: string) => h.startsWith('أعلى من'));
  assert.ok(rows.some((row: any[]) => row[above] === 'نعم'));
  assert.ok(headers.includes('قيمة التعاقد — مسجلة من المصنع (جنيه)'));
});

test('M6: notification log carries the application number', async () => {
  const r = (await c.admin.get('/admin/notifications?pageSize=200')).json.data.items;
  const withApp = r.filter((n: any) => n.applicationId);
  assert.ok(withApp.length && withApp.some((n: any) => /^SHAMS-\d{4}-\d{5}$/.test(n.applicationNumber ?? '')));
});
