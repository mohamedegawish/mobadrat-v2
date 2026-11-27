// PERF-3 regression: the batched list/export paths return exactly what the former per-row code returned.
//   • GET /applications?mine=1 / ?overdue=1 now filter on listFlags and build list items for the requested page only;
//   • list items, the factory profile and the Excel export load their organizations (and the export its referrals,
//     transitions and providers) in batched queries instead of one query per row.
// Measured before the change on MySQL 8.4 with 5,000 applications: 750 organization queries per IMC ?mine=1 request
// (5 req/s ceiling), a 5.8 s export (docs/performance/PERFORMANCE_TEST_REPORT.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { q, PROVIDER_INFO, isolateTestEnv, startServer, clients, act, advanceTo, uploadContractFile, type Started } from './helpers.js';

const env = isolateTestEnv('perf-batching');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-PB-${++seq}`;

before(async () => {
  srv = await startServer();
  c = await clients(srv.base);
  // history on both factories (terminal applications) + one open application each, in different stages and banks
  const a = await advanceTo('CONTRACT_OUTCOME', { factory: c.factory, imc: c.imc, encpc: c.encpc, pmu: c.pmu, electricity: c.electricity }, reg());
  await uploadContractFile(c.factory, a);
  assert.equal((await act(c.factory, a, 'record_contract', { contractDate: '2026-10-01', contractAmount: 1200000 })).status, 200);
  const b = await advanceTo('IMC_REVIEW', { factory: c.factory, imc: c.imc, encpc: c.encpc, pmu: c.pmu, electricity: c.electricity }, reg());
  assert.equal((await act(c.imc, b, 'request_correction', { reason: 'نواقص', deficiencies: [{ field: 'taxNumber', note: 'تصحيح' }] })).status, 200);
  assert.equal((await act(c.factory, b, 'resubmit')).status, 200);
  assert.equal((await act(c.factory, b, 'withdraw', { reason: 'انسحاب' })).status, 200);
  await advanceTo('IMC_REVIEW', { factory: c.factory, imc: c.imc, encpc: c.encpc, pmu: c.pmu, electricity: c.electricity }, reg());
  await advanceTo('OFFER_REVIEW', { factory: c.factory2, imc: c.imc, encpc: c.encpc, pmu: c.pmu, electricity: c.electricity }, reg());
});
after(async () => { await srv.close(); await env.cleanup(); });

const list = async (client: { get: (p: string) => Promise<any> }, query: string) => (await client.get(`/applications?${query}`)).json.data;

test('?mine=1 pages are exactly the "awaiting me" rows of the full list, in the same order, with identical items', async () => {
  for (const [role, client] of [['imc', c.imc], ['encpc', c.encpc], ['pmu', c.pmu], ['admin', c.admin]] as const) {
    const full = await list(client, 'sort=oldest&pageSize=100');
    const expected = full.items.filter((i: any) => i.isMine);
    const pages: any[] = [];
    let page = 1;
    for (;;) {
      const p = await list(client, `mine=1&pageSize=1&page=${page}`);
      assert.equal(p.total, expected.length, `${role}: total`);
      pages.push(...p.items);
      if (page >= p.totalPages) break;
      page++;
    }
    assert.deepEqual(pages, expected, `${role}: mine=1 items`);
    const overdue = await list(client, 'overdue=1&pageSize=100');
    assert.deepEqual(overdue.items, full.items.filter((i: any) => i.overdue), `${role}: overdue=1 items`);
  }
});

test('list items, details and the factory profile carry the same organizations as an unbatched lookup', async () => {
  const { buildListItem } = await import('../workflow/applicationView.js');
  const { getApplication } = await import('../store/applications.js');
  const { getUserById } = await import('../store/users.js');
  for (const client of [c.imc, c.pmu, c.admin, c.factory]) {
    const user = (await getUserById(client.user.id))!;
    const items = client === c.factory ? (await client.get('/factory/profile')).json.data.applications : (await list(client, 'pageSize=100')).items;
    assert.ok(items.length > 0);
    for (const it of items) {
      const direct = await buildListItem(user, (await getApplication(it.id))!); // no organization cache: one lookup per field
      assert.deepEqual(it, JSON.parse(JSON.stringify(direct)), `${user.role} ${it.id}`);
    }
  }
});

test('the export rows equal the former per-row computation (referral, returns, provider, bank, responsible)', async () => {
  const { reportRows } = await import('../services/reports.js');
  const { listApplications, getBankReferral, listTransitions } = await import('../store/applications.js');
  const { getOrganization } = await import('../store/organizations.js');
  const { responsibleInfo, returnCounts } = await import('../workflow/applicationView.js');
  const apps = (await listApplications({ scopeSql: '1 = 1', scopeParams: [], includeDrafts: true }, 1, 1, true)).rows;
  assert.ok(apps.length >= 4);
  const rows = await reportRows(apps, true);
  for (const [i, a] of apps.entries()) {
    const resp = await responsibleInfo(a);
    const ref = await getBankReferral(a.id);
    const returns = returnCounts(await listTransitions(a.id));
    assert.equal(rows[i].responsibleAr, resp.orgNameAr ?? resp.labelAr, a.id);
    assert.equal(rows[i].responsibleEn, resp.orgNameEn ?? resp.labelEn, a.id);
    assert.equal((rows[i] as any).returnsTotal, Object.values(returns).reduce((s, n) => s + (n ?? 0), 0), a.id);
    const [named] = await q<{ data: string }>("SELECT data FROM shams_application_data WHERE applicationId = ? AND section = 'provider' ORDER BY attempt DESC LIMIT 1", a.id);
    assert.equal((rows[i] as any).providerAr, named ? JSON.parse(named.data).providerName : '', a.id);
    assert.equal((rows[i] as any).bankAr, a.bankOrgId ? (await getOrganization(a.bankOrgId))?.nameAr ?? '' : '', a.id);
    assert.equal((rows[i] as any).contractStatus, ref?.contractStatus ?? '', a.id);
    assert.equal((rows[i] as any).contractAmount, ref?.contractAmount ?? null, a.id);
  }
  assert.ok((rows as any[]).some((r) => r.providerAr === PROVIDER_INFO.providerName), 'covers an application with a provider');
  assert.ok((rows as any[]).some((r) => r.returnsTotal > 0), 'covers an application with a return');
  assert.ok((rows as any[]).some((r) => r.contractStatus === 'contracted'), 'covers a recorded contract');
  const limited = await reportRows(apps, false);
  for (const [i, r] of limited.entries()) assert.equal(r.responsibleAr, rows[i].responsibleAr);
});

test('008: the admin outbox and audit lists are served by their indexes and keep their order', async () => {
  const { onMysql, q } = await import('./helpers.js');
  const names = onMysql
    ? (await q<{ n: string }>("SELECT DISTINCT INDEX_NAME AS n FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('idx_notif_created', 'idx_audit_at_id')")).map((r) => r.n)
    : (await q<{ n: string }>("SELECT name AS n FROM sqlite_master WHERE type = 'index' AND name IN ('idx_notif_created', 'idx_audit_at_id')")).map((r) => r.n);
  assert.deepEqual(names.sort(), ['idx_audit_at_id', 'idx_notif_created']);
  const audit = (await c.admin.get('/admin/audit-logs?pageSize=500')).json.data.items as Array<{ at: string; id: string }>;
  assert.ok(audit.length > 10);
  for (let i = 1; i < audit.length; i++) {
    const [p, n] = [audit[i - 1], audit[i]];
    assert.ok(p.at > n.at || (p.at === n.at && p.id > n.id), `audit order at ${i}: ${p.at}/${p.id} before ${n.at}/${n.id}`);
  }
  const outbox = (await c.admin.get('/admin/notifications?pageSize=200')).json.data.items as Array<{ createdAt: string }>;
  assert.ok(outbox.length > 0);
  for (let i = 1; i < outbox.length; i++) assert.ok(outbox[i - 1].createdAt >= outbox[i].createdAt, `outbox order at ${i}`);
});
