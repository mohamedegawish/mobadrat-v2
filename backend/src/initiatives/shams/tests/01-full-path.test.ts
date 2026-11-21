// اختبار القبول 1: المسار الكامل حتى CONTRACTED مع التحقق من الحالة والجهة والإشعارات والسجل في كل خطوة.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, createCompleteDraft, act, getApp, pdfVariant, q, uploadContractFile, PROVIDER_OK, BANK_A, type Started, type Client } from './helpers.js';

const env = isolateTestEnv('fullpath');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function notificationsFor(appId: string, templateKey: string) {
  return q<{ channel: string; recipientAddress: string; status: string }>('SELECT channel, recipientAddress, status FROM notification_outbox WHERE applicationId = ? AND templateKey = ?', appId, templateKey);
}

async function expectStep(viewer: Client, id: string, state: string, responsibleType: string, lastAction: string) {
  const app = await getApp(viewer, id);
  assert.equal(app.state, state, `state should be ${state}`);
  assert.equal(app.responsible.type, responsibleType, `responsible should be ${responsibleType}`);
  const rows = await q<{ toState: string; action: string; actorRole: string; attempt: number }>(
    'SELECT toState, action, actorRole, attempt FROM application_transitions WHERE applicationId = ? ORDER BY createdAt DESC, rowid DESC LIMIT 1', id);
  assert.equal(rows[0].toState, state);
  assert.equal(rows[0].action, lastAction);
  const audit = await q('SELECT 1 FROM audit_logs WHERE applicationId = ? AND action = ?', id, `application.${lastAction}`);
  assert.ok(audit.length >= 1, `audit row for ${lastAction}`);
  return app;
}

test('full path DRAFT → CONTRACTED', async () => {
  const id = await createCompleteDraft(c.factory, 'IND-FULL-001');
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'DRAFT');
  assert.equal(app.number, null, 'number is issued at first successful submit');
  assert.deepEqual(app.allowedActions.map((a: any) => a.action).sort(), ['submit', 'withdraw']);

  // 1 → IMC_REVIEW
  let r = await act(c.factory, id, 'submit');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  app = await expectStep(c.factory, id, 'IMC_REVIEW', 'imc', 'submit');
  assert.match(app.number, /^SHAMS-\d{4}-\d{5}$/);
  assert.equal(app.totalRoofArea, 2300.5, 'server computes total roof area');
  assert.equal(app.registry.result, 'valid');
  assert.ok((await notificationsFor(id, 'app.review_assigned')).some((n) => n.recipientAddress === 'imc1@shams.local'));
  const imcView = await getApp(c.imc, id);
  assert.deepEqual(imcView.allowedActions.map((a: any) => a.action).sort(), ['accept', 'reject', 'request_correction']);
  assert.equal(imcView.currentTask.isMine, true);

  // 2 → ENCPC_REVIEW
  r = await act(c.imc, id, 'accept');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await expectStep(c.imc, id, 'ENCPC_REVIEW', 'encpc', 'accept');
  assert.ok((await notificationsFor(id, 'app.review_assigned')).some((n) => n.recipientAddress === 'encpc@shams.local'));

  // 3 → PROVIDER_SELECTION
  r = await act(c.encpc, id, 'compliant');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await expectStep(c.encpc, id, 'PROVIDER_SELECTION', 'factory', 'compliant');
  const compliant = await notificationsFor(id, 'app.encpc_compliant');
  assert.ok(compliant.some((n) => n.channel === 'email' && n.recipientAddress === 'factory@shams.local'));
  assert.ok(compliant.some((n) => n.channel === 'sms'), 'SMS to the factory contact mobile');

  // 4 → OFFER_UPLOAD
  r = await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await expectStep(c.factory, id, 'OFFER_UPLOAD', 'factory', 'select_provider');

  // 5 → OFFER_REVIEW
  const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer'), 'offer.pdf');
  assert.equal(up.status, 201);
  r = await act(c.factory, id, 'submit_offer');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await expectStep(c.pmu, id, 'OFFER_REVIEW', 'pmu', 'submit_offer');
  assert.ok((await notificationsFor(id, 'app.review_assigned')).some((n) => n.recipientAddress === 'pmu@shams.local'));

  // 6 → ELECTRICITY_UPLOAD
  r = await act(c.pmu, id, 'accept');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await expectStep(c.pmu, id, 'ELECTRICITY_UPLOAD', 'factory', 'accept');
  assert.ok((await notificationsFor(id, 'app.offer_accepted')).length >= 1);

  // 7 → ELECTRICITY_REVIEW (لا بنك في هذه الخطوة — G-01)
  const up2 = await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('elec'), 'approval.pdf');
  assert.equal(up2.status, 201);
  r = await act(c.factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع (اختبار)' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  await expectStep(c.pmu, id, 'ELECTRICITY_REVIEW', 'pmu', 'submit_electricity');
  assert.equal((await getApp(c.pmu, id)).bank, null, 'no bank before PMU acceptance');

  // 8 → قبول PMU يفتح للمصنع اختيار البنك (CONTRACT_OUTCOME بلا بنك)
  r = await act(c.pmu, id, 'accept');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  app = await expectStep(c.factory, id, 'CONTRACT_OUTCOME', 'factory', 'accept');
  assert.equal(app.step, 8, 'stage tracker on «bank»');
  assert.deepEqual(app.allowedActions.map((a: any) => a.action).sort(), ['select_bank', 'select_distribution_path', 'withdraw'], 'only the contracting-path choice is open (bank or distribution company)');
  assert.ok((await notificationsFor(id, 'app.electricity_accepted')).some((n) => n.recipientAddress === 'factory@shams.local'));
  r = await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  app = await expectStep(c.factory, id, 'CONTRACT_OUTCOME', 'factory', 'select_bank');
  assert.equal(app.bank.id, BANK_A);
  assert.equal(app.step, 9, 'stage tracker on «contract»');
  assert.deepEqual(app.allowedActions.map((a: any) => a.action).sort(), ['record_contract', 'record_no_contract', 'withdraw']);
  assert.ok((await notificationsFor(id, 'app.bank_selected')).some((n) => n.recipientAddress === 'factory@shams.local'));

  // 9 → CONTRACTED (مستند إثبات التعاقد إجباري — G-03)
  await uploadContractFile(c.factory, id);
  r = await act(c.factory, id, 'record_contract', { contractDate: '2026-10-20', contractAmount: 25_000_000, contractNotes: 'تم' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  app = await expectStep(c.factory, id, 'CONTRACTED', 'none', 'record_contract');
  assert.equal(app.currentTask, null);
  assert.deepEqual(app.allowedActions, []);
  assert.equal(app.bankReferral.contractStatus, 'contracted');
  const closed = await notificationsFor(id, 'app.closed');
  assert.ok(closed.some((n) => n.recipientAddress === 'factory@shams.local'));
  assert.ok(closed.some((n) => n.recipientAddress === 'pmu@shams.local'));

  // السجل التاريخي كامل ومرتب
  const history = await q<{ fromState: string; toState: string }>('SELECT fromState, toState FROM application_transitions WHERE applicationId = ? ORDER BY createdAt, rowid', id);
  assert.deepEqual(history.map((h) => h.toState), [
    'IMC_REVIEW', 'ENCPC_REVIEW', 'PROVIDER_SELECTION', 'OFFER_UPLOAD', 'OFFER_REVIEW', 'ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW', 'CONTRACT_OUTCOME', 'CONTRACT_OUTCOME', 'CONTRACTED',
  ]);
  // webhook واحد لكل انتقال (skipped لأن الربط غير مضبوط — الموقع يعمل بدونه)
  const hooks = await q<{ status: string }>("SELECT w.status FROM webhook_outbox w JOIN application_transitions t ON t.id = w.transitionId WHERE t.applicationId = ?", id);
  assert.equal(hooks.length, 10);
  assert.ok(hooks.every((h) => h.status === 'skipped'));

  // الإرسال الفعلي عبر العامل (القرار لم ينتظره)
  const { processNotifications } = await import('../src/jobs/notificationWorker.js');
  const result = await processNotifications(500);
  assert.ok(result.sent > 0);
  const pending = await q("SELECT 1 FROM notification_outbox WHERE status = 'pending'");
  assert.equal(pending.length, 0);
});
