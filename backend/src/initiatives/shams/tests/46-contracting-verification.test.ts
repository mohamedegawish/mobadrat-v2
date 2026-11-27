// Independent verification of the two contracting paths (final review before commit). Deliberately does NOT use advanceTo:
// every journey starts from a public self-registration and walks each stage through the raw API, including every correction
// and re-upload loop, then checks the notifications actually delivered (outbox → real worker → mail transport), the history,
// historical document access, and direct-API abuse.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { electricityAccept, uploadProof,
  isolateTestEnv, startServer, clients, Client, act, getApp, q, pdfVariant, sentMails, registerFactory, registrationPayload, activationTokenFor,
  BANK_A, type Started,
} from './helpers.js';

const env = isolateTestEnv('verify');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const PASSWORD = 'Factory123';
const APP_URL = 'http://localhost:5173';
const PMU = 'pmu@shams.local';

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

const ok = (r: { status: number; json: unknown }, what: string) => assert.equal(r.status, 200, `${what}: ${r.status} ${JSON.stringify(r.json)}`);
async function flush() {
  const { processNotifications } = await import('../jobs/notificationWorker.js');
  for (let i = 0; i < 20; i++) { const r = await processNotifications(500); if (r.sent + r.skipped + r.retried + r.failed === 0) return; }
}
/** Delivered emails (after the worker ran) for an application and template, from the outbox rows actually marked sent. */
async function delivered(appId: string, key: string) {
  await flush();
  return q<{ recipientAddress: string; subject: string; body: string; textBody: string; status: string }>(
    "SELECT recipientAddress, subject, body, textBody, status FROM notification_outbox WHERE applicationId = ? AND templateKey = ? AND channel = 'email' ORDER BY createdAt", appId, key);
}
const upload = (f: Client, id: string, kind: string, tag: string) => f.upload(`/applications/${id}/documents`, { kind }, pdfVariant(tag), `${tag}.pdf`);

/** Public self-registration with the full form → e-mail activation (auto-submit to IMC). Returns the factory e-mail and application. */
async function register(tag: string) {
  const email = `verify.${tag}.${++seq}@test.local`;
  const reg = `IND-VER-${tag}-${seq}`;
  const r = await registerFactory(new Client(srv.base), registrationPayload(email, reg, { companyName: `مصنع التحقق ${tag} ${seq}` }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const v = await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(email) });
  ok(v, 'verify email');
  const appId = (await q<{ id: string }>(`SELECT a.id FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId JOIN initiative_memberships m ON m.organizationId = f.organizationId AND m.initiativeId = 'shams' JOIN users u ON u.id = m.userId WHERE u.email = ?`, email))[0].id;
  return { email, appId, company: `مصنع التحقق ${tag} ${seq}` };
}

/**
 * Registration → CONTRACT_OUTCOME through the raw API. With `loops`, every reviewer sends the application back once
 * (IMC data completion, ENCPC technical correction, PMU offer revision, PMU electricity re-upload) and the factory fixes it.
 */
async function toContractOutcome(tag: string, loops: boolean) {
  const { email, appId, company } = await register(tag);
  assert.equal((await getApp(c.imc, appId)).state, 'IMC_REVIEW');
  let f: Client;
  if (loops) {
    ok(await act(c.imc, appId, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان غير مكتمل' }] }), 'IMC data completion');
    f = await new Client(srv.base).login(email, PASSWORD); // restricted sign-in: requested items + resubmit only
    assert.equal((await f.put(`/applications/${appId}/data/general`, { address: 'العنوان الكامل بعد الاستيفاء' })).status, 200);
    ok(await act(f, appId, 'resubmit'), 'factory resubmits to IMC');
  }
  ok(await act(c.imc, appId, 'accept'), 'IMC accepts');
  f = await new Client(srv.base).login(email, PASSWORD);
  f.autoRelogin = true;
  if (loops) {
    ok(await act(c.encpc, appId, 'non_compliant', { reason: 'العنوان لا يطابق الموقع' }), 'ENCPC rejection');
    await uploadProof(f, appId, `${tag}-proof-1`);
    ok(await act(f, appId, 'resubmit'), 'factory resubmits to ENCPC');
  }
  ok(await act(c.encpc, appId, 'compliant'), 'ENCPC compliant');
  assert.equal((await upload(f, appId, 'technicalOfferFile', `${tag}-offer-1`)).status, 201);
  ok(await act(f, appId, 'submit_offer'), 'submit offer');
  if (loops) {
    ok(await act(c.pmu, appId, 'request_correction', { reason: 'العرض بلا جدول زمني' }), 'PMU offer revision');
    assert.equal((await act(f, appId, 'resubmit')).status, 422, 'the same offer cannot be resubmitted');
    assert.equal((await upload(f, appId, 'technicalOfferFile', `${tag}-offer-2`)).status, 201);
    ok(await act(f, appId, 'resubmit'), 'revised offer');
  }
  ok(await act(c.pmu, appId, 'accept'), 'PMU accepts offer');
  if (loops) {
    ok(await act(c.electricity, appId, 'request_correction', { reason: 'الرسم غير مختوم' }), 'ministry rejection');
    assert.equal((await getApp(f, appId)).state, 'ELECTRICITY_UPLOAD');
    await uploadProof(f, appId, `${tag}-proof-2`);
    ok(await act(f, appId, 'resubmit'), 'answer to the ministry');
  }
  ok(await electricityAccept(c.electricity, appId, `${tag}-elec`), 'ministry approves');
  const app = await getApp(f, appId);
  assert.equal(app.state, 'CONTRACT_OUTCOME');
  return { email, appId, company, f, number: app.number as string };
}

function assertEmail(m: { subject: string; body: string; textBody: string } | undefined, o: { number: string; company: string; link: string; includes?: RegExp[] }, what: string) {
  assert.ok(m, `${what}: delivered`);
  assert.ok(m!.subject.includes(o.number), `${what}: number in the subject`);
  assert.ok(m!.body.includes(o.number) && m!.body.includes(o.company), `${what}: number + factory name in the body`);
  assert.ok(m!.body.includes(o.link) && m!.textBody.includes(o.link), `${what}: direct link ${o.link} (HTML and text)`);
  for (const re of o.includes ?? []) assert.match(m!.body, re, `${what}: ${re}`);
}
function onePerRecipient(rows: Array<{ recipientAddress: string }>, what: string) {
  assert.equal(new Set(rows.map((r) => r.recipientAddress)).size, rows.length, `${what}: no duplicate emails`);
}

// ── Bank path, every return loop, evidence re-upload, success ─────────────────────────────────────────────────────────
test('V1 registration → every correction loop → bank chosen → evidence re-uploaded → contracted; history and emails complete', async () => {
  const { email, appId, company, f, number } = await toContractOutcome('bank', true);
  const taskLink = `${APP_URL}/#i/shams/task/${appId}`;
  const appLink = `${APP_URL}/#i/shams/application/${appId}`;
  const accepted = (await delivered(appId, 'app.electricity_accepted')).filter((m) => m.recipientAddress === email);
  assert.equal(accepted.length, 1);
  assertEmail(accepted[0], { number, company, link: taskLink, includes: [/مسار التعاقد/, /من خلال بنك/, /شركة توزيع الكهرباء/, /مسار التعاقد \/ التعاقد البنكي/] }, 'electricity accepted');

  ok(await act(f, appId, 'select_bank', { bankOrgId: BANK_A }), 'select bank');
  assert.equal((await act(f, appId, 'record_contract', { contractDate: '2026-11-07', contractAmount: 3_000_000 })).status, 422, 'evidence required');
  const ev1 = (await upload(f, appId, 'contractFile', 'bank-ev-1')).json.data;
  const ev2 = (await upload(f, appId, 'contractFile', 'bank-ev-2')).json.data;
  ok(await act(f, appId, 'record_contract', { contractDate: '2026-11-07', contractAmount: 3_000_000, contractNotes: 'عقد تمويل' }), 'record contract');
  const app = await getApp(f, appId);
  assert.equal(app.state, 'CONTRACTED');
  assert.equal(app.contractPath, 'bank');
  assert.equal(app.bankReferral.contractStatus, 'contracted');
  // the whole journey, in order, every step with its actor
  const steps = app.transitions.map((t: any) => `${t.fromState}>${t.action}`);
  assert.deepEqual(steps, [
    'DRAFT>submit', 'IMC_REVIEW>request_correction', 'IMC_CORRECTION>resubmit', 'IMC_REVIEW>accept', 'ENCPC_REVIEW>non_compliant', 'ENCPC_CORRECTION>resubmit',
    'ENCPC_REVIEW>compliant', 'OFFER_UPLOAD>submit_offer', 'OFFER_REVIEW>request_correction', 'OFFER_CORRECTION>resubmit',
    'OFFER_REVIEW>accept', 'ELECTRICITY_REVIEW>request_correction', 'ELECTRICITY_UPLOAD>resubmit',
    'ELECTRICITY_REVIEW>accept', 'CONTRACT_OUTCOME>select_bank', 'CONTRACT_OUTCOME>record_contract',
  ]);
  assert.ok(app.transitions.every((t: any) => t.actorName && t.createdAt));
  // every version of every re-uploaded document is kept, and stays downloadable by its owner after closure
  for (const kind of ['technicalOfferFile', 'correctionProofFile', 'contractFile']) {
    assert.equal(app.documents.filter((d: any) => d.kind === kind).length, 2, `${kind}: both versions kept`);
  }
  for (const d of [ev1, ev2]) assert.equal((await f.get(`/applications/${appId}/documents/${d.id}/download`)).status, 200);
  const closed = await delivered(appId, 'app.closed');
  onePerRecipient(closed, 'app.closed');
  assertEmail(closed.find((m) => m.recipientAddress === email), { number, company, link: appLink, includes: [/تم التعاقد عن طريق البنك/, /بنك تجريبي/] }, 'closed (bank)');
  assert.ok(closed.some((m) => m.recipientAddress === PMU), 'PMU informed');
  assert.ok(closed.every((m) => m.status === 'sent'), 'actually sent by the worker');
});

test('V2 bank path, not contracted: the reason is recorded and emailed; red outcome; the application is closed', async () => {
  const { email, appId, company, f, number } = await toContractOutcome('nocontract', false);
  ok(await act(f, appId, 'select_bank', { bankOrgId: BANK_A }), 'select bank');
  assert.equal((await act(f, appId, 'record_no_contract', {})).status, 400, 'reason required');
  ok(await act(f, appId, 'record_no_contract', { reason: 'رفض البنك التمويل' }), 'no contract');
  const app = await getApp(f, appId);
  assert.equal(app.state, 'CLOSED_NOT_CONTRACTED');
  assert.equal(app.bankReferral.notContractedReason, 'رفض البنك التمويل');
  const m = (await delivered(appId, 'app.closed')).find((x) => x.recipientAddress === email);
  assertEmail(m, { number, company, link: `${APP_URL}/#i/shams/application/${appId}`, includes: [/لم يتم التعاقد/, /رفض البنك التمويل/] }, 'closed (no contract)');
  assert.equal((await act(f, appId, 'select_distribution_path')).status, 409, 'no switching after closure');
});

// ── Distribution path: success, with re-upload, notes and every email checked ─────────────────────────────────────────
test('V3 registration → distribution path → re-upload → submission with a note → PMU accepts with a note → contracted; emails verified', async () => {
  const { email, appId, company, f, number } = await toContractOutcome('dist', false);
  const taskLink = `${APP_URL}/#i/shams/task/${appId}`;
  const appLink = `${APP_URL}/#i/shams/application/${appId}`;
  ok(await act(f, appId, 'select_distribution_path'), 'choose the distribution path');
  const chosen = (await delivered(appId, 'app.distribution_path_selected'));
  onePerRecipient(chosen, 'path selected');
  assert.deepEqual(chosen.map((m) => m.recipientAddress), [email]);
  assertEmail(chosen[0], { number, company, link: taskLink, includes: [/رفع موافقة شركة التوزيع/, /رفع موافقة شركة توزيع الكهرباء/] }, 'path selected');

  const v1 = (await upload(f, appId, 'distributionApprovalFile', 'dist-v1')).json.data;
  const v2 = (await upload(f, appId, 'distributionApprovalFile', 'dist-v2')).json.data;
  ok(await act(f, appId, 'submit_distribution_approval', { note: 'خطاب الموافقة رقم 55/2026' }), 'submit');
  const assigned = (await delivered(appId, 'app.review_assigned')).filter((m) => /مراجعة موافقة شركة التوزيع/.test(m.body));
  onePerRecipient(assigned, 'review assigned');
  assertEmail(assigned.find((m) => m.recipientAddress === PMU), { number, company, link: appLink, includes: [/بانتظار مراجعتكم|بانتظار المراجعة/, /خطاب الموافقة رقم 55\/2026/] }, 'PMU review request');
  const receipt = await delivered(appId, 'app.distribution_received');
  assert.deepEqual(receipt.map((m) => m.recipientAddress), [email]);
  assertEmail(receipt[0], { number, company, link: appLink, includes: [/قيد المراجعة/, /خطاب الموافقة رقم 55\/2026/] }, 'factory receipt');

  // PMU sees only what was sent: the replaced draft version is neither listed nor downloadable for it; the owner keeps both
  const pmuView = await getApp(c.pmu, appId);
  assert.deepEqual(pmuView.documents.filter((d: any) => d.kind === 'distributionApprovalFile').map((d: any) => d.id), [v2.id]);
  assert.equal((await c.pmu.get(`/applications/${appId}/documents/${v1.id}/download`)).status, 404);
  assert.equal((await c.pmu.get(`/applications/${appId}/documents/${v2.id}/download`)).status, 200);
  assert.equal((await f.get(`/applications/${appId}/documents/${v1.id}/download`)).status, 200);

  ok(await act(c.pmu, appId, 'accept', { note: 'مستوفاة ومختومة' }), 'PMU accepts');
  const app = await getApp(f, appId);
  assert.equal(app.state, 'CONTRACTED');
  assert.equal(app.distributionContract.reviewStatus, 'approved');
  assert.equal(app.distributionContract.approvalDocumentId, v2.id);
  const closed = await delivered(appId, 'app.closed');
  onePerRecipient(closed, 'app.closed');
  assert.deepEqual(closed.map((m) => m.recipientAddress).sort(), [email, PMU].sort());
  assertEmail(closed.find((m) => m.recipientAddress === email), { number, company, link: appLink, includes: [/تم التعاقد عن طريق شركة توزيع الكهرباء/, /ملاحظات المراجعة/, /مستوفاة ومختومة/, /لا إجراء آخر مطلوب/] }, 'closed (distribution, accepted)');
  // in-app inbox: one row per user, per event (transition — the dedupe-key prefix) and template. PMU legitimately gets
  // app.review_assigned once per review stage (offer, electricity, distribution): three events, not duplicates.
  const inbox = await q<{ userId: string; templateKey: string; dedupeKey: string }>('SELECT userId, templateKey, dedupeKey FROM user_notifications WHERE applicationId = ?', appId);
  const perEvent = new Map<string, number>();
  for (const r of inbox) { const k = `${r.userId}|${r.templateKey}|${r.dedupeKey.split(':')[0]}`; perEvent.set(k, (perEvent.get(k) ?? 0) + 1); }
  assert.ok([...perEvent.values()].every((n) => n === 1), 'no duplicate inbox rows for one event');
  for (const key of ['app.distribution_path_selected', 'app.distribution_received', 'app.closed']) {
    const users = inbox.filter((r) => r.templateKey === key).map((r) => r.userId);
    assert.equal(new Set(users).size, users.length, `${key}: one inbox row per user`);
  }
  // every email of this application went through the worker exactly once
  assert.equal((await q("SELECT 1 FROM notification_outbox WHERE applicationId = ? AND channel = 'email' AND status <> 'sent'", appId)).length, 0);
});

test('V4 distribution path rejected: final decision, the rejection email carries the reason; closed for good. Two PMU sessions racing: one decision', async () => {
  // a second application where two separate PMU sessions decide at the same moment
  const race = await toContractOutcome('distrace', false);
  ok(await act(race.f, race.appId, 'select_distribution_path'), 'choose the distribution path (race)');
  await upload(race.f, race.appId, 'distributionApprovalFile', 'distrace-v1');
  ok(await act(race.f, race.appId, 'submit_distribution_approval'), 'submit (race)');
  const pmuA = await new Client(srv.base).login(PMU);
  const pmuB = await new Client(srv.base).login(PMU);
  const rv = (await getApp(pmuA, race.appId)).version;
  const [ra, rb] = await Promise.all([
    pmuA.post(`/applications/${race.appId}/actions/reject_distribution`, { expectedVersion: rv, reason: 'قرار متزامن' }),
    pmuB.post(`/applications/${race.appId}/actions/accept`, { expectedVersion: rv }),
  ]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  const raced = await getApp(race.f, race.appId);
  assert.equal(raced.state, ra.status === 200 ? 'CLOSED_NOT_CONTRACTED' : 'CONTRACTED');
  assert.equal(raced.distributionContract.reviewStatus, ra.status === 200 ? 'rejected' : 'approved');
  assert.equal((await q('SELECT 1 FROM shams_application_transitions WHERE applicationId = ? AND fromState = ?', race.appId, 'DISTRIBUTION_REVIEW')).length, 1);
  onePerRecipient(await delivered(race.appId, 'app.closed'), 'app.closed (race)');
  assert.equal((await race.f.post(`/applications/${race.appId}/actions/withdraw`, { expectedVersion: raced.version, reason: 'xxxx' })).status, 409, 'closed after the race');

  // the deterministic rejection
  const { email, appId, company, f, number } = await toContractOutcome('distno', false);
  ok(await act(f, appId, 'select_distribution_path'), 'choose the distribution path');
  await upload(f, appId, 'distributionApprovalFile', 'distno-v1');
  ok(await act(f, appId, 'submit_distribution_approval'), 'submit');
  ok(await act(c.pmu, appId, 'reject_distribution', { reason: 'الموافقة صادرة لموقع مختلف' }), 'PMU rejects');
  const app = await getApp(f, appId);
  assert.equal(app.state, 'CLOSED_NOT_CONTRACTED');
  assert.equal(app.distributionContract.reviewStatus, 'rejected');
  const closed = await delivered(appId, 'app.closed');
  onePerRecipient(closed, 'app.closed');
  assert.deepEqual(closed.map((m) => m.recipientAddress).sort(), [email, PMU].sort());
  assertEmail(closed.find((m) => m.recipientAddress === email), { number, company, link: `${APP_URL}/#i/shams/application/${appId}`, includes: [/رُفضت موافقة شركة التوزيع/, /سبب الرفض/, /الموافقة صادرة لموقع مختلف/, /قرار نهائي/, /طلب جديد/] }, 'closed (distribution, rejected)');
  // closed for good: no action, no upload, no edit, no document removal
  for (const [cl, action, body] of [[f, 'submit_distribution_approval', {}], [f, 'withdraw', { reason: 'xxxx' }], [f, 'select_bank', { bankOrgId: BANK_A }], [c.pmu, 'accept', {}], [c.pmu, 'reject_distribution', { reason: 'xxxx' }]] as const) {
    assert.equal((await act(cl, appId, action, body as Record<string, unknown>)).status, 409, `${action} on a closed application`);
  }
  assert.equal((await upload(f, appId, 'distributionApprovalFile', 'late')).status, 409);
  assert.equal((await f.put(`/applications/${appId}/data/general`, { address: 'تعديل بعد الإغلاق' })).status, 409);
  const docId = app.documents.find((d: any) => d.kind === 'distributionApprovalFile').id;
  assert.equal((await f.del(`/applications/${appId}/documents/${docId}`)).status, 409);
});

// ── Direct API manipulation and historical documents ──────────────────────────────────────────────────────────────────
test('V5 direct API manipulation is refused: unknown actions, injected fields, state edits, cross-path uploads, foreign documents', async () => {
  const { appId, f } = await toContractOutcome('abuse', false);
  assert.equal((await f.post(`/applications/${appId}/actions/approve`, { expectedVersion: 1 })).status, 404, 'unknown action');
  assert.equal((await f.post(`/applications/${appId}/actions/record_result`, { expectedVersion: 1 })).status, 404, 'retired action');
  const v = (await getApp(f, appId)).version;
  for (const body of [{ expectedVersion: v, contractPath: 'bank' }, { expectedVersion: v, state: 'CONTRACTED' }, { expectedVersion: v, bankOrgId: BANK_A }, { expectedVersion: 'x' }, {}]) {
    assert.equal((await f.post(`/applications/${appId}/actions/select_distribution_path`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await getApp(f, appId)).version, v, 'nothing changed');
  ok(await act(f, appId, 'select_distribution_path'), 'choose the distribution path');
  assert.equal((await upload(f, appId, 'technicalOfferFile', 'wrong-kind')).status, 409, 'only the distribution approval can be uploaded now');
  assert.equal((await upload(f, appId, 'contractFile', 'wrong-path')).status, 409);
  assert.equal((await f.put(`/applications/${appId}/data/general`, { address: 'تعديل غير مسموح' })).status, 409, 'form data is frozen');
  const doc = (await upload(f, appId, 'distributionApprovalFile', 'abuse-v1')).json.data;
  assert.equal((await f.del(`/applications/${appId}/documents/${doc.id}`)).status, 409, 'stage documents cannot be removed (only replaced)');
  const sv = (await getApp(f, appId)).version;
  assert.equal((await f.post(`/applications/${appId}/actions/submit_distribution_approval`, { expectedVersion: sv, note: 'x', reviewStatus: 'approved' })).status, 400, 'injected field');
  assert.equal((await c.pmu.post(`/applications/${appId}/actions/submit_distribution_approval`, { expectedVersion: sv })).status, 403, 'PMU cannot submit for the factory');
  assert.equal((await c.pmu.post(`/applications/${appId}/actions/select_distribution_path`, { expectedVersion: sv })).status, 403);
  // other parties and the metadata-only admin get nothing of this document
  for (const [who, cl] of [['factory2', c.factory2], ['imc', c.imc], ['encpc', c.encpc], ['admin', c.admin]] as const) {
    assert.equal((await cl.get(`/applications/${appId}/documents/${doc.id}/download`)).status, 404, `${who} download`);
  }
  assert.equal((await c.factory2.get(`/applications/${appId}`)).status, 404, 'other factory: the application does not exist for it');
  assert.equal((await c.factory2.post(`/applications/${appId}/actions/withdraw`, { expectedVersion: sv, reason: 'محاولة' })).status, 404);
  // the result row is never written by an unauthorised request
  assert.equal((await q<{ s: string | null }>('SELECT reviewStatus AS s FROM shams_distribution_contracts WHERE applicationId = ?', appId))[0].s, null);
});
