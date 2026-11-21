// Two contracting paths after PMU accepts the electricity approval: the existing bank path (A) and the new
// electricity distribution company path (B, C), plus the business-rule / authorization / concurrency guarantees (D).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, uploadContractFile, uploadDistributionApproval, pdfVariant, q, BANK_A,
  type Started, type Client,
} from './helpers.js';

const env = isolateTestEnv('paths');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-PATH-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

const F = 'factory@shams.local';
const PMU = 'pmu@shams.local';

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const actionsOf = async (client: Client, id: string) => (await getApp(client, id)).allowedActions.map((a: { action: string }) => a.action).sort();
const emails = (id: string, key: string) =>
  q<{ recipientAddress: string; subject: string; body: string; textBody: string }>("SELECT recipientAddress, subject, body, textBody FROM notification_outbox WHERE applicationId = ? AND templateKey = ? AND channel = 'email'", id, key);
const inbox = (id: string, key: string) => q<{ userId: string }>('SELECT userId FROM user_notifications WHERE applicationId = ? AND templateKey = ?', id, key);
const upload = (client: Client, id: string, kind: string, tag: string) => client.upload(`/applications/${id}/documents`, { kind }, pdfVariant(tag), `${tag}.pdf`);
const transitionsOf = (id: string, action: string) => q<{ fromState: string; toState: string; reason: string; actorRole: string; payload: string }>(
  'SELECT fromState, toState, reason, actorRole, payload FROM application_transitions WHERE applicationId = ? AND action = ? ORDER BY createdAt, rowid', id, action);

// ── Scenario A — the existing bank path still works end to end ─────────────────────────────────────────────────────────
test('A) bank path: electricity accepted → both paths offered → bank chosen (path locked to bank) → evidence → contracted', async () => {
  await closeOpen();
  const id = await advanceTo('BANK_SELECTION', c, reg());
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'CONTRACT_OUTCOME');
  assert.equal(app.contractPath, null, 'no path before the factory chooses');
  assert.equal(app.step, 8, 'stage 8 = contracting path');
  assert.match(app.currentTask.labelAr, /مسار التعاقد/);
  assert.deepEqual(await actionsOf(c.factory, id), ['select_bank', 'select_distribution_path', 'withdraw']);
  const accepted = await emails(id, 'app.electricity_accepted');
  assert.ok(accepted.some((m) => m.recipientAddress === F), 'the factory is told the path choice is open');
  assert.match(accepted[0].body, /شركة توزيع الكهرباء/, 'the email explains both paths');

  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 200);
  app = await getApp(c.factory, id);
  assert.equal(app.contractPath, 'bank');
  assert.equal(app.bank.id, BANK_A);
  assert.deepEqual(await actionsOf(c.factory, id), ['record_contract', 'record_no_contract', 'withdraw'], 'the distribution path is gone once a bank is chosen');
  assert.equal(JSON.parse((await transitionsOf(id, 'select_bank'))[0].payload).contractPath, 'bank');

  await uploadContractFile(c.factory, id, 'bank-evidence');
  assert.equal((await act(c.factory, id, 'record_contract', { contractDate: '2026-11-01', contractAmount: 2_500_000 })).status, 200);
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'CONTRACTED');
  assert.ok(app.closedAt);
  assert.equal(app.contractPath, 'bank');
  assert.equal(app.bankReferral.contractStatus, 'contracted');
  assert.equal(app.distributionContract, null);
  assert.equal(app.currentTask, null);
  const closed = await emails(id, 'app.closed');
  assert.ok(closed.some((m) => m.recipientAddress === F && /عن طريق البنك/.test(m.subject)), 'path-specific success email');
});

// ── Scenario B — the distribution company path, end to end ─────────────────────────────────────────────────────────────
test('B) distribution path: choose path → upload (+ re-upload) → submit with note → PMU accepts → contracted via distribution company', async () => {
  await closeOpen();
  const id = await advanceTo('BANK_SELECTION', c, reg());
  assert.equal((await act(c.factory, id, 'select_distribution_path')).status, 200);
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'DISTRIBUTION_UPLOAD');
  assert.equal(app.contractPath, 'distribution');
  assert.equal(app.bank, null);
  assert.equal(app.responsible.type, 'factory');
  assert.deepEqual(await actionsOf(c.factory, id), ['submit_distribution_approval', 'withdraw']);
  assert.ok(app.distributionContract && app.distributionContract.selectedAt && app.distributionContract.reviewStatus === null);
  assert.ok((await emails(id, 'app.distribution_path_selected')).some((m) => m.recipientAddress === F));
  assert.ok((await inbox(id, 'app.distribution_path_selected')).length >= 1, 'in-app notification too');

  // the document is required, and it must be a new upload
  const noDoc = await act(c.factory, id, 'submit_distribution_approval');
  assert.equal(noDoc.status, 422);
  assert.equal(noDoc.json.code, 'DOCUMENT_REQUIRED');

  const v1 = await uploadDistributionApproval(c.factory, id, 'dist-v1');
  const v2 = await uploadDistributionApproval(c.factory, id, 'dist-v2');
  app = await getApp(c.factory, id);
  const versions = app.documents.filter((d: any) => d.kind === 'distributionApprovalFile');
  assert.equal(versions.length, 2, 'both uploads are kept');
  assert.equal(versions.find((d: any) => d.id === v1.id).isCurrent, false, 're-upload supersedes, does not delete');
  assert.ok(versions.every((d: any) => d.uploadedByName), 'the uploader is recorded');

  const sent = await act(c.factory, id, 'submit_distribution_approval', { note: 'مرفق خطاب شركة التوزيع' });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'DISTRIBUTION_REVIEW');
  assert.equal(app.responsible.type, 'pmu');
  assert.equal(app.distributionContract.reviewStatus, 'pending');
  assert.equal(app.distributionContract.submissionCount, 1);
  assert.equal(app.distributionContract.approvalDocumentId, v2.id, 'the submitted version is pinned');
  const submitT = (await transitionsOf(id, 'submit_distribution_approval'))[0];
  assert.equal(submitT.reason, 'مرفق خطاب شركة التوزيع', 'the factory note is kept in the history');
  assert.equal(JSON.parse(submitT.payload).documentId, v2.id);
  assert.ok((await emails(id, 'app.review_assigned')).some((m) => m.recipientAddress === PMU), 'PMU is asked to review');
  const receipt = await emails(id, 'app.distribution_received');
  assert.ok(receipt.some((m) => m.recipientAddress === F), 'receipt to the factory');
  assert.match(receipt[0].body, /مرفق خطاب شركة التوزيع/);

  // PMU sees the submitted document and can download it; the factory can no longer upload
  const pmuView = await getApp(c.pmu, id);
  assert.deepEqual(pmuView.allowedActions.map((a: any) => a.action).sort(), ['accept', 'reject_distribution']);
  const pmuDoc = pmuView.documents.find((d: any) => d.id === v2.id);
  assert.ok(pmuDoc && pmuDoc.submitted);
  assert.equal((await c.pmu.get(`/applications/${id}/documents/${v2.id}/download`)).status, 200);
  assert.deepEqual(await actionsOf(c.factory, id), ['withdraw']);
  assert.equal((await upload(c.factory, id, 'distributionApprovalFile', 'late')).status, 409, 'no upload while under review');

  const ok = await act(c.pmu, id, 'accept', { note: 'الموافقة مستوفاة' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'CONTRACTED');
  assert.ok(app.closedAt);
  assert.equal(app.contractPath, 'distribution');
  assert.equal(app.bankReferral, null, 'no bank record on this path');
  assert.equal(app.distributionContract.reviewStatus, 'approved');
  assert.equal(app.distributionContract.decisionNotes, 'الموافقة مستوفاة');
  assert.ok(app.distributionContract.decidedAt && app.distributionContract.decidedByName);
  assert.equal(app.data.contract.contractPath, 'distribution');
  assert.equal(app.data.contract.contractStatus, 'contracted');
  // the full journey is in the timeline, with the responsible user for every step
  const journey = app.transitions.map((t: any) => t.action);
  for (const a of ['submit', 'compliant', 'select_provider', 'submit_offer', 'submit_electricity', 'select_distribution_path', 'submit_distribution_approval']) assert.ok(journey.includes(a), a);
  assert.ok(app.transitions.every((t: any) => t.actorName), 'every step names its actor');
  const closed = await emails(id, 'app.closed');
  assert.ok(closed.some((m) => m.recipientAddress === F && /تم التعاقد عن طريق شركة توزيع الكهرباء/.test(m.subject)));
  assert.ok(closed.some((m) => m.recipientAddress === PMU));
  // exactly one message per recipient for each event of this path (dedupe by transition)
  for (const key of ['app.distribution_path_selected', 'app.distribution_received', 'app.closed']) {
    const rows = await emails(id, key);
    assert.equal(new Set(rows.map((r) => r.recipientAddress)).size, rows.length, `${key}: no duplicate emails`);
  }
  // closed: nothing more can happen
  for (const [client, action] of [[c.pmu, 'accept'], [c.pmu, 'reject_distribution'], [c.factory, 'withdraw'], [c.factory, 'submit_distribution_approval']] as const) {
    assert.equal((await act(client, id, action, { reason: 'محاولة بعد الإغلاق' })).status, 409, `${action} after closure`);
  }
});

// ── Scenario C — PMU rejects the distribution approval: final closure ──────────────────────────────────────────────────
test('C) PMU rejects the distribution approval with notes → closed (not contracted), final, red outcome data, factory cannot continue', async () => {
  await closeOpen();
  const id = await advanceTo('DISTRIBUTION_REVIEW', c, reg());
  const noReason = await act(c.pmu, id, 'reject_distribution');
  assert.equal(noReason.status, 400, 'a reason is mandatory');
  assert.equal((await act(c.pmu, id, 'reject_distribution', { reason: 'سبب', reasonCode: 'registry_ownership_mismatch' })).status, 400, 'IMC reason codes are not accepted here');
  assert.equal((await getApp(c.pmu, id)).state, 'DISTRIBUTION_REVIEW', 'refused attempts change nothing');

  const r = await act(c.pmu, id, 'reject_distribution', { reason: 'الموافقة منتهية الصلاحية' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'CLOSED_NOT_CONTRACTED');
  assert.ok(app.closedAt);
  assert.equal(app.contractPath, 'distribution');
  assert.equal(app.distributionContract.reviewStatus, 'rejected');
  assert.equal(app.distributionContract.decisionNotes, 'الموافقة منتهية الصلاحية');
  assert.equal(app.data.contract.contractStatus, 'not_contracted');
  assert.equal(app.currentTask, null);
  assert.deepEqual(app.allowedActions, []);
  const last = app.transitions[app.transitions.length - 1];
  assert.equal(last.toState, 'CLOSED_NOT_CONTRACTED');
  assert.equal(last.reason, 'الموافقة منتهية الصلاحية');
  const closed = await emails(id, 'app.closed');
  const toFactory = closed.find((m) => m.recipientAddress === F);
  assert.ok(toFactory && /رُفضت موافقة شركة التوزيع/.test(toFactory.subject));
  assert.match(toFactory!.body, /الموافقة منتهية الصلاحية/, 'the rejection reason is in the email');
  assert.match(toFactory!.body, /application\//, 'direct link to the application');

  for (const action of ['submit_distribution_approval', 'withdraw', 'select_bank', 'select_distribution_path', 'record_contract']) {
    assert.equal((await act(c.factory, id, action, { reason: 'x'.repeat(5), bankOrgId: BANK_A })).status, 409, `${action} on a closed application`);
  }
  assert.equal((await act(c.pmu, id, 'accept')).status, 409, 'PMU cannot reopen it');
  assert.equal((await upload(c.factory, id, 'distributionApprovalFile', 'after-close')).status, 409);
  // G-09: the closed application stays in history; the factory may start a new one
  const profile = (await c.factory.get('/factory/profile')).json.data;
  assert.equal(profile.openApplicationId ?? null, null);
  const fresh = await createCompleteDraft(c.factory, reg());
  assert.ok(fresh && fresh !== id);
  await closeOpen();
});

// ── Scenario D — business rules, authorization, concurrency ────────────────────────────────────────────────────────────
test('D1) no contracting path before PMU accepts the electricity approval', async () => {
  await closeOpen();
  for (const target of ['ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW'] as const) {
    const id = await advanceTo(target, c, reg());
    const r = await act(c.factory, id, 'select_distribution_path');
    assert.equal(r.status, 409, `${target}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, 'INVALID_STATE');
    assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 409);
    assert.equal((await upload(c.factory, id, 'distributionApprovalFile', `early-${target}`)).status, 409);
    assert.equal((await getApp(c.factory, id)).contractPath, null);
    await closeOpen();
  }
});

test('D2) the two paths can never be combined or switched (API and database)', async () => {
  // bank first → distribution refused
  await closeOpen();
  let id = await advanceTo('CONTRACT_OUTCOME', c, reg(), BANK_A);
  const locked = await act(c.factory, id, 'select_distribution_path');
  assert.equal(locked.status, 409);
  assert.equal(locked.json.code, 'CONTRACT_PATH_LOCKED');
  assert.equal((await upload(c.factory, id, 'distributionApprovalFile', 'cross-1')).status, 409, 'bank path cannot upload the distribution approval');
  assert.equal((await act(c.factory, id, 'submit_distribution_approval')).status, 409);
  assert.equal((await getApp(c.factory, id)).contractPath, 'bank');

  // distribution first → bank refused
  await closeOpen();
  id = await advanceTo('DISTRIBUTION_UPLOAD', c, reg());
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 409, 'distribution path cannot choose a bank');
  assert.equal((await act(c.factory, id, 'select_distribution_path')).status, 409, 'choosing again is refused');
  assert.equal((await upload(c.factory, id, 'contractFile', 'cross-2')).status, 409, 'distribution path cannot upload bank evidence');
  assert.equal((await act(c.factory, id, 'record_contract', { contractDate: '2026-11-01', contractAmount: 1 })).status, 409);
  const app = await getApp(c.factory, id);
  assert.equal(app.contractPath, 'distribution');
  assert.equal(app.bank, null);

  // the database itself refuses an inconsistent row
  const { getDb } = await import('../src/db/sqlite.js');
  await assert.rejects(getDb().prepare('UPDATE applications SET bankOrgId = ? WHERE id = ?').run(BANK_A, id), /CHECK|constraint/i, 'no bank on the distribution path');
  await assert.rejects(getDb().prepare("UPDATE applications SET contractPath = NULL WHERE id = ?").run(id), /CHECK|constraint/i, 'distribution stages require the distribution path');
  await assert.rejects(getDb().prepare("UPDATE applications SET contractPath = 'other' WHERE id = ?").run(id), /CHECK|constraint/i);
  await closeOpen();
});

test('D3) only PMU decides; other roles, other factories and direct requests cannot bypass the workflow', async () => {
  await closeOpen();
  const id = await advanceTo('DISTRIBUTION_REVIEW', c, reg());
  const version = (await getApp(c.pmu, id)).version;
  const docId = (await getApp(c.factory, id)).documents.find((d: any) => d.kind === 'distributionApprovalFile').id;
  for (const [name, client] of [['imc', c.imc], ['encpc', c.encpc], ['admin', c.admin], ['factory', c.factory], ['factory2', c.factory2]] as const) {
    for (const action of ['accept', 'reject_distribution']) {
      const r = await client.post(`/applications/${id}/actions/${action}`, { expectedVersion: version, reason: 'محاولة غير مصرح بها' });
      assert.ok([403, 404].includes(r.status), `${name} ${action} → ${r.status}`);
    }
  }
  // object-level authorization: another factory sees nothing of it
  assert.equal((await c.factory2.get(`/applications/${id}`)).status, 404);
  assert.equal((await c.factory2.get(`/applications/${id}/documents/${docId}/download`)).status, 404);
  assert.equal((await c.factory2.upload(`/applications/${id}/documents`, { kind: 'distributionApprovalFile' }, pdfVariant('idor'), 'idor.pdf')).status, 404);
  // IMC / ENCPC never see later-stage documents or the distribution result
  for (const client of [c.imc, c.encpc]) {
    const v = await client.get(`/applications/${id}`);
    if (v.status === 200) {
      assert.ok(!v.json.data.documents.some((d: any) => d.kind === 'distributionApprovalFile'));
      assert.equal(v.json.data.distributionContract, null);
    }
    assert.ok([403, 404].includes((await client.get(`/applications/${id}/documents/${docId}/download`)).status));
  }
  // a stale version is refused; skipping a stage is refused
  assert.equal((await c.pmu.post(`/applications/${id}/actions/accept`, { expectedVersion: version - 1 })).status, 409);
  assert.equal((await getApp(c.pmu, id)).state, 'DISTRIBUTION_REVIEW', 'nothing changed');
  await closeOpen();
  const early = await advanceTo('DISTRIBUTION_UPLOAD', c, reg());
  assert.equal((await act(c.pmu, early, 'accept')).status, 409, 'PMU cannot decide before the approval is submitted');
  assert.equal((await act(c.pmu, early, 'reject_distribution', { reason: 'قبل الإرسال' })).status, 409);
  await closeOpen();
});

test('D4) concurrent decisions, double submissions and racing path choices leave one consistent outcome', async () => {
  // PMU accept + reject at the same moment
  await closeOpen();
  let id = await advanceTo('DISTRIBUTION_REVIEW', c, reg());
  let v = (await getApp(c.pmu, id)).version;
  const decisions = await Promise.all([
    c.pmu.post(`/applications/${id}/actions/accept`, { expectedVersion: v }),
    c.pmu.post(`/applications/${id}/actions/reject_distribution`, { expectedVersion: v, reason: 'رفض متزامن' }),
  ]);
  assert.deepEqual(decisions.map((r) => r.status).sort(), [200, 409]);
  const decided = await getApp(c.pmu, id);
  const t = await q('SELECT COUNT(*) AS n FROM application_transitions WHERE applicationId = ? AND fromState = ?', id, 'DISTRIBUTION_REVIEW');
  assert.equal(Number((t[0] as { n: number }).n), 1, 'exactly one decision recorded');
  assert.equal(decided.distributionContract.reviewStatus, decided.state === 'CONTRACTED' ? 'approved' : 'rejected', 'result row matches the state');

  // the same submission twice at once
  await closeOpen();
  id = await advanceTo('DISTRIBUTION_UPLOAD', c, reg());
  await uploadDistributionApproval(c.factory, id, 'race');
  v = (await getApp(c.factory, id)).version;
  const subs = await Promise.all([0, 1].map(() => c.factory.post(`/applications/${id}/actions/submit_distribution_approval`, { expectedVersion: v })));
  assert.deepEqual(subs.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await transitionsOf(id, 'submit_distribution_approval')).length, 1);
  assert.equal((await getApp(c.factory, id)).distributionContract.submissionCount, 1);

  // bank and distribution chosen at the same moment
  await closeOpen();
  id = await advanceTo('BANK_SELECTION', c, reg());
  v = (await getApp(c.factory, id)).version;
  const race = await Promise.all([
    c.factory.post(`/applications/${id}/actions/select_bank`, { expectedVersion: v, bankOrgId: BANK_A }),
    c.factory.post(`/applications/${id}/actions/select_distribution_path`, { expectedVersion: v }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const row = (await q<{ state: string; contractPath: string; bankOrgId: string | null }>('SELECT state, contractPath, bankOrgId FROM applications WHERE id = ?', id))[0];
  assert.ok((row.contractPath === 'bank' && row.bankOrgId === BANK_A && row.state === 'CONTRACT_OUTCOME')
    || (row.contractPath === 'distribution' && row.bankOrgId === null && row.state === 'DISTRIBUTION_UPLOAD'), JSON.stringify(row));
  assert.equal(Number((await q<{ n: number }>('SELECT COUNT(*) AS n FROM distribution_contracts WHERE applicationId = ?', id))[0].n), row.contractPath === 'distribution' ? 1 : 0);
  await closeOpen();
});

test('D5) withdrawing on the distribution path is still possible before the decision; dashboards and reports count the new path', async () => {
  await closeOpen();
  const id = await advanceTo('DISTRIBUTION_UPLOAD', c, reg());
  const dash = (await c.pmu.get('/dashboard')).json.data;
  assert.ok(dash.cards.some((x: any) => x.key === 'distribution-upload' && x.count >= 1));
  assert.ok(dash.cards.some((x: any) => x.key === 'distribution'));
  assert.equal((await act(c.factory, id, 'withdraw', { reason: 'انسحاب قبل الرفع' })).status, 200);
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'WITHDRAWN');
  assert.equal(app.contractPath, 'distribution', 'the chosen path stays in the record');

  const report = (await c.pmu.get('/reports/summary')).json.data;
  assert.ok(report.contracted.byPath.distribution >= 1, 'scenario B contract counted');
  assert.ok(report.contracted.byPath.bank >= 1, 'scenario A contract counted');
  assert.equal(report.contracted.count, report.contracted.byPath.bank + report.contracted.byPath.distribution);
  const sheet = (await c.pmu.get('/reports/applications')).json.data.sheet;
  const col = sheet.headers.indexOf('مسار التعاقد');
  assert.ok(col >= 0);
  assert.ok(sheet.rows.some((r: unknown[]) => r[col] === 'شركة توزيع الكهرباء'));
});
