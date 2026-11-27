// Workflow audit (docs/review/workflow-audit): the nine acceptance scenarios, end to end through the real HTTP API.
// Every step asserts the state, who may act, the history row, the stored documents and the outbox (recipient, template,
// application reference, notes, link, no secrets, no duplicate logical notification). Fake mail sender + fake HTTP
// registry only: no real email or registry call is made.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { electricityAccept, uploadProof, PROVIDER_INFO, PROVIDERS_LINK,
  isolateTestEnv, startServer, clients, createCompleteDraft, act, getApp, q, advanceTo, pdfVariant, PDF, sentMails,
  BANK_A, BANK_B, uploadContractFile, type Started, type Client,
} from './helpers.js';

const env = isolateTestEnv('workflow-audit');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => {
  const { setMailSenderForTests } = await import('../mail/mailer.js');
  setMailSenderForTests(null);
  await srv.close(); await env.cleanup();
});

type Mail = { templateKey: string; recipientAddress: string; channel: string; subject: string; body: string; textBody: string; status: string; createdAt: string };
const outbox = (id: string) => q<Mail>("SELECT templateKey, recipientAddress, channel, subject, body, textBody, status, createdAt FROM notification_outbox WHERE applicationId = ? AND channel = 'email' ORDER BY createdAt", id);
const emailsTo = async (id: string, key: string, addr: string) => (await outbox(id)).filter((m) => m.templateKey === key && m.recipientAddress === addr);
const history = (id: string) => q<{ fromState: string; toState: string; action: string; actorRole: string; actorUserId: string; reason: string; attempt: number; payload: string }>(
  'SELECT fromState, toState, action, actorRole, actorUserId, reason, attempt, payload FROM shams_application_transitions WHERE applicationId = ? ORDER BY createdAt, rowid', id);
const actionsOf = async (cl: Client, id: string) => (await getApp(cl, id)).allowedActions.map((a: { action: string }) => a.action).sort();
async function dbRun(sql: string, ...params: Array<string | number | null>) {
  const { getDb } = await import('../db/database.js');
  await getDb().prepare(sql).run(...params);
}
async function upload(cl: Client, id: string, kind: string, tag: string) {
  return cl.upload(`/applications/${id}/documents`, { kind }, pdfVariant(tag), `${tag}.pdf`);
}
function ok(r: { status: number; json: any }, step: string) { assert.equal(r.status, 200, `${step}: ${r.status} ${JSON.stringify(r.json)}`); }
/** Isolation between scenarios: a scenario that failed half-way must not block the next one (one open application per factory). */
async function freeFactories() {
  for (const cl of [c.factory, c.factory2]) {
    const openId = (await cl.get('/factory/profile')).json.data.openApplicationId as string | null;
    if (openId) await act(cl, openId, 'withdraw', { reason: 'عزل سيناريو الاختبار' });
  }
}
/** An attacker's raw request with the current version (read from the DB, since the attacker may not even see the application). */
async function raw(cl: Client, id: string, action: string, body: Record<string, unknown> = {}) {
  const v = (await q<{ version: number }>('SELECT version FROM shams_applications WHERE id = ?', id))[0].version;
  return cl.post(`/applications/${id}/actions/${action}`, { expectedVersion: v, ...body });
}
/** Refused without effect: 403 (may see, may not act) or 404 (may not even see). */
function refused(r: { status: number }, what: string) { assert.ok(r.status === 403 || r.status === 404, `${what}: got ${r.status}`); }

/** Email content checks shared by every scenario: reference, link, no secrets, no duplicates. */
async function assertCleanOutbox(id: string, number: string | null) {
  const mails = await outbox(id);
  const seen = new Map<string, number>();
  for (const m of mails) {
    const k = `${m.templateKey}|${m.recipientAddress}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    assert.doesNotMatch(m.body + m.textBody, /eyJ[A-Za-z0-9_-]{10,}/, `no JWT in ${m.templateKey}`);
    assert.doesNotMatch(m.body + m.textBody, /Shams@2026|token=|password=/i, `no secret in ${m.templateKey}`);
    if (number && m.templateKey.startsWith('app.')) assert.ok(m.subject.includes(number) || m.body.includes(number), `${m.templateKey} carries ${number}`);
    // the provider has no account, so its e-mail carries no link into the platform
    if (m.templateKey.startsWith('app.') && m.templateKey !== 'app.provider_offer_accepted') assert.ok(m.body.includes(encodeURIComponent(id)), `${m.templateKey} links to the application`);
  }
  // one logical notification per (event, recipient): only events that legitimately repeat in a cycle may appear twice
  const repeating = new Set(['app.correction_requested', 'app.resubmitted', 'app.review_assigned', 'app.offer_received', 'app.electricity_received', 'app.electricity_rejected', 'app.encpc_rejected', 'ops.electricity_decision']);
  for (const [k, n] of seen) if (!repeating.has(k.split('|')[0])) assert.equal(n, 1, `duplicate logical notification ${k}`);
}

// ─────────────────────────────────────────────────────────────────────────────
test('S1 successful journey: registration → registry verified → IMC → ENCPC → offer → PMU → electricity ministry → factory chooses bank → evidence → contracted', async () => {
  await freeFactories();
  const F = 'factory@shams.local';
  // Stage 1: draft, verification, application creation
  const id = await createCompleteDraft(c.factory, 'IND-WA-S1');
  assert.equal((await c.imc.get(`/applications/${id}`)).status, 404, 'IMC does not see an unsubmitted draft');
  assert.deepEqual(await actionsOf(c.imc, id).catch(() => null), null, 'no IMC access before submission');
  ok(await act(c.factory, id, 'submit'), 'submit');
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'IMC_REVIEW');
  assert.match(app.number, /^SHAMS-\d{4}-\d{5}$/);
  assert.equal(app.registry.result, 'valid');
  assert.equal((await q("SELECT result FROM shams_registry_verifications WHERE applicationId = ?", id))[0].result, 'valid');
  assert.equal((await emailsTo(id, 'app.submitted', F)).length, 1, 'factory receipt');
  assert.equal((await emailsTo(id, 'app.review_assigned', 'imc1@shams.local')).length, 1, 'IMC notified');
  assert.deepEqual(await actionsOf(c.factory, id), ['withdraw'], 'factory only waits');
  assert.deepEqual(await actionsOf(c.imc, id), ['accept', 'reject', 'request_correction']);
  const number = app.number as string;

  // Stage 2: IMC accepts → ENCPC
  ok(await act(c.imc, id, 'accept', { note: 'مستوفى' }), 'imc accept');
  assert.equal((await getApp(c.factory, id)).state, 'ENCPC_REVIEW');
  assert.equal((await emailsTo(id, 'app.imc_accepted', F)).length, 1);
  assert.equal((await emailsTo(id, 'app.review_assigned', 'encpc@shams.local')).length, 1);
  assert.deepEqual(await actionsOf(c.encpc, id), ['compliant', 'non_compliant'], 'ENCPC has no final reject');

  // Stage 3: ENCPC accepts → the providers link and its note reach the factory (D13)
  assert.equal((await act(c.encpc, id, 'compliant', { providersLink: undefined })).status, 400, 'the providers link is required');
  ok(await act(c.encpc, id, 'compliant', { note: 'اختاروا مقدمًا معتمدًا' }), 'encpc compliant');
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'OFFER_UPLOAD');
  const listMail = await emailsTo(id, 'app.encpc_compliant', F);
  assert.equal(listMail.length, 1);
  assert.ok(listMail[0].body.includes(PROVIDERS_LINK) && listMail[0].body.includes('اختاروا مقدمًا معتمدًا'), 'link and note in the email');
  assert.equal(app.encpcAcceptance.providersLink, PROVIDERS_LINK);
  assert.equal(app.encpcAcceptance.note, 'اختاروا مقدمًا معتمدًا');

  // Stage 4: technical offer and its provider mandatory, then PMU queue
  const noOffer = await act(c.factory, id, 'submit_offer');
  assert.equal(noOffer.status, 422); assert.equal(noOffer.json.code, 'DOCUMENT_REQUIRED');
  assert.equal((await upload(c.factory, id, 'technicalOfferFile', 'offer-s1')).status, 201);
  assert.equal((await act(c.factory, id, 'submit_offer', { providerEmail: undefined })).status, 400, 'provider e-mail required');
  ok(await act(c.factory, id, 'submit_offer'), 'submit offer');
  assert.equal((await getApp(c.factory, id)).state, 'OFFER_REVIEW');
  assert.equal((await emailsTo(id, 'app.offer_received', F)).length, 1);
  assert.equal((await emailsTo(id, 'app.review_assigned', 'pmu@shams.local')).length, 1);
  // the ministry sees nothing before PMU accepts the offer
  assert.equal((await c.electricity.get(`/applications/${id}`)).status, 404);
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 409, 'no bank choice before the electricity approval');

  // Stage 5: PMU accepts the offer → the ministry; the factory owner and the provider are told (D17)
  ok(await act(c.pmu, id, 'accept'), 'pmu accept offer');
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'ELECTRICITY_REVIEW');
  assert.equal(app.currentTask.isMine, false);
  assert.equal((await emailsTo(id, 'app.offer_accepted', F)).length, 1);
  assert.equal((await emailsTo(id, 'app.provider_offer_accepted', PROVIDER_INFO.providerEmail)).length, 1);
  assert.equal((await emailsTo(id, 'app.review_assigned', 'electricity@shams.local')).length, 1);

  // Stage 6: the ministry approves with its file — no bank in this step (G-01)
  const noFile = await act(c.electricity, id, 'accept', { distributionCompany: 'شركة توزيع' });
  assert.equal(noFile.status, 422, 'approval document mandatory');
  assert.equal((await upload(c.electricity, id, 'electricityApprovalFile', 'elec-s1')).status, 201);
  assert.ok(!(await getApp(c.factory, id)).documents.some((d: { kind: string }) => d.kind === 'electricityApprovalFile'), 'not shown before the decision');
  assert.equal((await act(c.electricity, id, 'accept', {})).status, 400, 'distribution company required');
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 409, 'no bank choice during the ministry review');
  ok(await act(c.electricity, id, 'accept', { distributionCompany: 'شركة توزيع' }), 'electricity accept');
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'CONTRACT_OUTCOME');
  assert.equal(app.step, 6);
  assert.deepEqual(app.allowedActions.map((a: { action: string }) => a.action).sort(), ['select_bank', 'select_distribution_path', 'withdraw']);
  assert.equal((await emailsTo(id, 'app.electricity_accepted', F)).length, 1, 'factory told to choose the bank');
  assert.equal((await emailsTo(id, 'ops.electricity_decision', 'pmu@shams.local')).length, 1, 'PMU follows up');
  assert.deepEqual(await actionsOf(c.pmu, id), [], 'PMU has nothing more to do');

  // Stage 8: the factory chooses one active bank
  ok(await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A }), 'select bank');
  app = await getApp(c.factory, id);
  assert.equal(app.bank.id, BANK_A); assert.equal(app.step, 7);
  const bankMail = await emailsTo(id, 'app.bank_selected', F);
  assert.equal(bankMail.length, 1, 'bank choice confirmed to the factory');
  assert.ok(bankMail[0].body.includes('خارج المنصة'), 'factory told to deal with the bank outside the platform');

  // Stage 9–10: offline contracting, factory records the result with evidence (G-03)
  const badContract = await act(c.factory, id, 'record_contract', { contractDate: '2026-10-05' });
  assert.equal(badContract.status, 400, 'contract amount required');
  const noEvidence = await act(c.factory, id, 'record_contract', { contractDate: '2026-10-05', contractAmount: 2_500_000 });
  assert.equal(noEvidence.status, 422, 'contract evidence required'); assert.equal(noEvidence.json.code, 'DOCUMENT_REQUIRED');
  await uploadContractFile(c.factory, id, 'evidence-s1');
  ok(await act(c.factory, id, 'record_contract', { contractDate: '2026-10-05', contractAmount: 2_500_000, contractNotes: 'عقد تمويل' }), 'record contract');
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'CONTRACTED');
  assert.equal(app.stateLabelAr, 'اكتمل — تم التعاقد');
  assert.ok(app.closedAt, 'closed');
  assert.equal(app.bankReferral.contractStatus, 'contracted');
  assert.equal(app.bankReferral.contractDate, '2026-10-05');
  assert.ok(app.documents.some((d: { kind: string; submitted: boolean }) => d.kind === 'contractFile' && d.submitted), 'evidence stored with the result');
  assert.deepEqual(app.allowedActions, [], 'closed to ordinary actions');
  assert.equal(app.currentTask, null);
  const closed = (await outbox(id)).filter((m) => m.templateKey === 'app.closed').map((m) => m.recipientAddress);
  assert.ok(closed.includes(F) && closed.includes('pmu@shams.local'), 'factory + PMU told of the final result');

  // closed: no edits, no uploads, no actions
  assert.equal((await act(c.factory, id, 'withdraw', { reason: 'تجربة' })).status, 409);
  assert.ok((await c.factory.put(`/applications/${id}/data/general`, { companyName: 'تغيير' })).status >= 400);
  assert.ok((await upload(c.factory, id, 'technicalOfferFile', 'late')).status >= 400);

  // History: every decision, by the right role, in order; audit row for each
  const h = await history(id);
  assert.deepEqual(h.map((t) => `${t.actorRole}:${t.action}`), [
    'factory_owner:submit', 'imc_reviewer:accept', 'encpc_reviewer:compliant', 'factory_owner:submit_offer',
    'pmu_reviewer:accept', 'electricity_reviewer:accept', 'factory_owner:select_bank', 'factory_owner:record_contract',
  ]);
  assert.deepEqual(h.map((t) => t.toState).at(-1), 'CONTRACTED');
  for (let i = 1; i < h.length; i++) assert.equal(h[i].fromState, h[i - 1].toState, 'continuous chain of states');
  const audits = (await q<{ action: string }>("SELECT action FROM audit_logs WHERE applicationId = ? AND action LIKE 'application.%'", id)).map((a) => a.action);
  for (const t of h) assert.ok(audits.includes(`application.${t.action}`), `audit for ${t.action}`);
  await assertCleanOutbox(id, number);

  // delivery through the (fake) mail sender reaches the factory with the reference
  const { processNotifications } = await import('../jobs/notificationWorker.js');
  await processNotifications(500);
  assert.ok(sentMails.some((m) => m.to.includes(F) && m.subject.includes(number)), 'delivered to the factory');
});

// ─────────────────────────────────────────────────────────────────────────────
test('S2 IMC information request: notes mandatory → factory edits only flagged items → resubmits → IMC accepts', async () => {
  await freeFactories();
  const id = await advanceTo('IMC_REVIEW', c, 'IND-WA-S2');
  assert.equal((await act(c.imc, id, 'request_correction', {})).status, 400, 'deficiencies required');
  assert.equal((await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: '' }] })).status, 400, 'note required');
  ok(await act(c.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'أكمل العنوان التفصيلي' }, { field: 'taxCardFile', note: 'البطاقة منتهية' }], reason: 'نواقص' }), 'request correction');
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'IMC_CORRECTION');
  assert.ok(app.currentTask.isMine);
  assert.deepEqual(app.currentTask.deficiencies.map((d: { note: string }) => d.note).sort(), ['أكمل العنوان التفصيلي', 'البطاقة منتهية'].sort(), 'factory sees the notes');
  const mail = await emailsTo(id, 'app.correction_requested', 'factory@shams.local');
  assert.equal(mail.length, 1);
  assert.ok(mail[0].body.includes('أكمل العنوان التفصيلي'), 'notes in the email');
  // only the flagged items are editable
  assert.ok((await c.factory.put(`/applications/${id}/data/general`, { companyName: 'اسم آخر' })).status >= 400, 'unflagged field locked');
  ok(await c.factory.put(`/applications/${id}/data/general`, { address: 'المنطقة الصناعية الثالثة — قطعة 12' }), 'edit flagged field');
  // M8 (current design): an unchanged flagged item is only a warning, not a block — see business-gaps G-06.
  assert.deepEqual((await getApp(c.factory, id)).unchangedDeficiencies, ['taxCardFile'], 'factory warned the flagged document is unchanged');
  assert.equal((await upload(c.factory, id, 'taxCardFile', 'tax-v2')).status, 201);
  assert.deepEqual((await getApp(c.factory, id)).unchangedDeficiencies, [], 'warning cleared once replaced');
  ok(await act(c.factory, id, 'resubmit'), 'resubmit');
  app = await getApp(c.imc, id);
  assert.equal(app.state, 'IMC_REVIEW', 'back to the IMC queue');
  assert.equal((await emailsTo(id, 'app.resubmitted', 'imc1@shams.local')).length, 1);
  assert.ok(app.deficiencies.every((d: { resolved: boolean }) => d.resolved), 'deficiencies closed by the resubmission');
  const tax = app.documents.filter((d: { kind: string }) => d.kind === 'taxCardFile');
  assert.equal(tax.length, 2, 'both tax card versions kept');
  assert.equal((await q("SELECT COUNT(*) AS n FROM shams_application_data WHERE applicationId = ? AND section = 'general'", id) as any)[0].n, 2, 'both submitted versions of the section kept');
  const h = await history(id);
  assert.equal(h.find((t) => t.action === 'request_correction')?.reason, 'نواقص', 'previous review kept');
  ok(await act(c.imc, id, 'accept'), 'imc accept');
  assert.equal((await getApp(c.factory, id)).state, 'ENCPC_REVIEW', 'workflow continues');
  await assertCleanOutbox(id, app.number);
  ok(await act(c.factory, id, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup');
});

// ─────────────────────────────────────────────────────────────────────────────
test('S3 IMC final rejection: reason mandatory → REJECTED is permanent → no resubmit, edit, upload or reopen', async () => {
  await freeFactories();
  const id = await advanceTo('IMC_REVIEW', c, 'IND-WA-S3');
  assert.equal((await act(c.imc, id, 'reject', {})).status, 400, 'reason required');
  assert.equal((await act(c.imc, id, 'reject', { reason: 'x' })).status, 400, 'reason too short');
  ok(await act(c.imc, id, 'reject', { reason: 'النشاط خارج نطاق المبادرة', reasonCode: 'other' }), 'reject');
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'REJECTED');
  assert.ok(app.closedAt);
  assert.deepEqual(app.allowedActions, []);
  assert.equal(app.transitions.at(-1).reason, 'النشاط خارج نطاق المبادرة', 'factory sees the reason');
  const mail = await emailsTo(id, 'app.rejected', 'factory@shams.local');
  assert.equal(mail.length, 1);
  assert.ok(mail[0].body.includes('النشاط خارج نطاق المبادرة'));
  for (const [cl, action] of [[c.factory, 'resubmit'], [c.factory, 'submit'], [c.factory, 'withdraw'], [c.imc, 'accept'], [c.imc, 'request_correction'], [c.pmu, 'accept']] as const) {
    const r = await act(cl, id, action, action === 'withdraw' ? { reason: 'محاولة' } : {});
    assert.equal(r.status, 409, `${action} after final rejection`); assert.equal(r.json.code, 'INVALID_STATE');
  }
  assert.ok((await c.factory.put(`/applications/${id}/data/general`, { address: 'جديد' })).status >= 400);
  assert.ok((await upload(c.factory, id, 'taxCardFile', 'after-reject')).status >= 400);
  assert.equal((await getApp(c.factory, id)).state, 'REJECTED');
  await assertCleanOutbox(id, app.number);
});

// ─────────────────────────────────────────────────────────────────────────────
test('S4 ENCPC technical rejection cycle (repeated): proof from the factory, back to ENCPC, never to IMC; then the providers link', async () => {
  await freeFactories();
  const id = await advanceTo('ENCPC_REVIEW', c, 'IND-WA-S4');
  assert.equal((await act(c.encpc, id, 'reject', { reason: 'غير مطابق' })).status, 403, 'ENCPC has no final rejection');
  assert.equal((await act(c.encpc, id, 'non_compliant', {})).status, 400, 'reason required');
  assert.equal((await act(c.encpc, id, 'non_compliant', { reason: 'سبب', deficiencies: [{ field: 'address', note: 'x' }] })).status, 400, 'no per-field list');
  for (const round of [1, 2]) {
    ok(await act(c.encpc, id, 'non_compliant', { reason: `قدرة المحول غير كافية (${round})` }), `non_compliant ${round}`);
    const app = await getApp(c.factory, id);
    assert.equal(app.state, 'ENCPC_CORRECTION');
    assert.ok(app.returnDecision.reason.includes(`(${round})`), 'the factory sees the reason');
    assert.deepEqual(app.editableFields, [], 'the form is not reopened');
    assert.ok((await c.factory.put(`/applications/${id}/data/general`, { address: 'x' })).status >= 400);
    assert.ok((await upload(c.factory, id, 'taxCardFile', `tax-${round}`)).status >= 400, 'only proof files');
    assert.equal((await act(c.factory, id, 'resubmit')).status, 422, 'a new proof file is required');
    await uploadProof(c.factory, id, `proof-${round}`);
    ok(await act(c.factory, id, 'resubmit', { note: `تم تركيب محول جديد (${round})` }), `resubmit ${round}`);
    assert.equal((await getApp(c.encpc, id)).state, 'ENCPC_REVIEW', 'back to ENCPC, not IMC');
  }
  const app = await getApp(c.pmu, id);
  assert.equal(app.returnCounts.ENCPC_REVIEW, 2, 'cycles counted for PMU');
  assert.equal((await getApp(c.encpc, id)).documents.filter((d: { kind: string }) => d.kind === 'correctionProofFile').length, 2, 'ENCPC sees the proofs');
  assert.ok(!(await getApp(c.imc, id)).documents.some((d: { kind: string }) => d.kind === 'correctionProofFile'), 'IMC does not');
  assert.equal((await outbox(id)).filter((m) => m.templateKey === 'app.encpc_rejected' && m.recipientAddress === 'factory@shams.local' && m.subject).length, 2, 'one email per rejection');
  assert.equal((await history(id)).filter((t) => t.action === 'non_compliant').length, 2, 'both reviews in history');
  // The IMC never sees it again
  assert.ok(!(await history(id)).some((t, i) => i > 1 && t.toState === 'IMC_REVIEW'));
  ok(await act(c.encpc, id, 'compliant'), 'compliant');
  assert.equal((await getApp(c.factory, id)).state, 'OFFER_UPLOAD');
  assert.equal((await emailsTo(id, 'app.encpc_compliant', 'factory@shams.local')).length, 1, 'link sent once, only after acceptance');
  await assertCleanOutbox(id, app.number);
  ok(await act(c.factory, id, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup');
});

// ─────────────────────────────────────────────────────────────────────────────
test('S5 PMU technical-offer correction: notes mandatory → corrected offer → back to PMU → accepted → the ministry', async () => {
  await freeFactories();
  const id = await advanceTo('OFFER_REVIEW', c, 'IND-WA-S5');
  assert.equal((await act(c.pmu, id, 'request_correction', {})).status, 400, 'reason required');
  ok(await act(c.pmu, id, 'request_correction', { reason: 'العرض لا يحدد قدرة الألواح' }), 'pmu return');
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'OFFER_CORRECTION');
  assert.ok(app.currentTask.deficiencies.some((d: { note: string }) => d.note === 'العرض لا يحدد قدرة الألواح'));
  assert.ok((await emailsTo(id, 'app.correction_requested', 'factory@shams.local'))[0].body.includes('العرض لا يحدد قدرة الألواح'));
  assert.equal((await act(c.factory, id, 'resubmit')).status, 422, 'corrected offer required');
  assert.equal((await upload(c.factory, id, 'technicalOfferFile', 'offer-v2')).status, 201);
  ok(await act(c.factory, id, 'resubmit', { providerName: 'شركة أخرى للطاقة', providerEmail: 'other@provider.test' }), 'resubmit offer');
  assert.equal((await getApp(c.pmu, id)).state, 'OFFER_REVIEW', 'back to PMU offer review, not an earlier stage');
  ok(await act(c.pmu, id, 'accept'), 'pmu accept');
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'ELECTRICITY_REVIEW');
  assert.equal(app.documents.filter((d: { kind: string }) => d.kind === 'technicalOfferFile').length, 2, 'both offers kept');
  assert.equal(app.providerInfo.email, 'other@provider.test', 'the latest provider');
  assert.equal((await emailsTo(id, 'app.provider_offer_accepted', 'other@provider.test')).length, 1);
  const h = await history(id);
  assert.ok(h.some((t) => t.fromState === 'OFFER_REVIEW' && t.action === 'request_correction' && t.reason === 'العرض لا يحدد قدرة الألواح'));
  await assertCleanOutbox(id, app.number);
  ok(await act(c.factory, id, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup');
});

// ─────────────────────────────────────────────────────────────────────────────
test('S6 electricity rejection: notes mandatory → proof from the factory → back to the ministry → accepted → bank stage', async () => {
  await freeFactories();
  const id = await advanceTo('ELECTRICITY_REVIEW', c, 'IND-WA-S6');
  assert.deepEqual(await actionsOf(c.factory, id), ['withdraw'], 'no bank or contract action before the approval');
  assert.equal((await act(c.electricity, id, 'request_correction', {})).status, 400, 'reason required');
  assert.equal((await upload(c.electricity, id, 'electricityApprovalFile', 'draft-approval')).status, 201);
  ok(await act(c.electricity, id, 'request_correction', { reason: 'الرسم الهندسي غير موقع' }), 'ministry rejects');
  let app = await getApp(c.factory, id);
  assert.equal(app.state, 'ELECTRICITY_UPLOAD');
  assert.equal(app.returnDecision.reason, 'الرسم الهندسي غير موقع');
  assert.ok(!app.documents.some((d: { kind: string }) => d.kind === 'electricityApprovalFile'), 'the unused approval file is not sent');
  assert.ok((await emailsTo(id, 'app.electricity_rejected', 'factory@shams.local'))[0].body.includes('الرسم الهندسي غير موقع'));
  assert.equal((await emailsTo(id, 'ops.electricity_decision', 'pmu@shams.local')).length, 1);
  assert.equal((await act(c.factory, id, 'resubmit')).status, 422, 'proof required');
  assert.ok((await upload(c.factory, id, 'electricityApprovalFile', 'forged')).status >= 400, 'the factory cannot upload the approval');
  await uploadProof(c.factory, id, 'signed-drawing');
  ok(await act(c.factory, id, 'resubmit'), 'resubmit');
  assert.equal((await getApp(c.electricity, id)).state, 'ELECTRICITY_REVIEW', 'back to the ministry');
  assert.equal((await emailsTo(id, 'app.resubmitted', 'electricity@shams.local')).length, 1, 'told it is a resubmission');
  const stale = await act(c.electricity, id, 'accept', { distributionCompany: 'شركة توزيع' });
  assert.equal(stale.status, 422, 'the discarded file does not count');
  ok(await electricityAccept(c.electricity, id, 'elec-v2'), 'accept');
  app = await getApp(c.factory, id);
  assert.equal(app.state, 'CONTRACT_OUTCOME');
  assert.deepEqual(app.allowedActions.map((a: { action: string }) => a.action).sort(), ['select_bank', 'select_distribution_path', 'withdraw'], 'bank choice available after acceptance');
  assert.equal(app.documents.filter((d: { kind: string }) => d.kind === 'electricityApprovalFile').length, 1);
  await assertCleanOutbox(id, app.number);
  ok(await act(c.factory, id, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup');
});

// ─────────────────────────────────────────────────────────────────────────────
test('S7 final contracting failure: reason mandatory, no evidence needed → CLOSED_NOT_CONTRACTED is final → no other bank, no restart', async () => {
  await freeFactories();
  const id = await advanceTo('CONTRACT_OUTCOME', c, 'IND-WA-S7');
  assert.equal((await act(c.factory, id, 'record_no_contract', {})).status, 400, 'reason required');
  ok(await act(c.factory, id, 'record_no_contract', { reason: 'لم تكتمل الضمانات المطلوبة من البنك' }), 'record no contract');
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'CLOSED_NOT_CONTRACTED');
  assert.equal(app.stateLabelAr, 'مغلق — لم يتم التعاقد');
  assert.ok(app.closedAt);
  assert.equal(app.bankReferral.contractStatus, 'not_contracted');
  assert.equal(app.bankReferral.notContractedReason, 'لم تكتمل الضمانات المطلوبة من البنك');
  assert.deepEqual(app.allowedActions, []);
  for (const [cl, action, body] of [
    [c.factory, 'record_contract', { contractDate: '2026-10-05', contractAmount: 100 }], [c.factory, 'select_bank', { bankOrgId: BANK_B }],
    [c.factory, 'resubmit', {}], [c.factory, 'withdraw', { reason: 'إعادة فتح' }],
  ] as const) {
    const r = await act(cl, id, action, body as Record<string, unknown>);
    assert.equal(r.status, 409, `${action} after failure`);
  }
  for (const action of ['reassign_bank', 'record_result']) {
    assert.equal((await raw(c.pmu, id, action, { bankOrgId: BANK_B, reason: 'بنك آخر' })).status, 404, `${action} does not exist (G-02)`);
  }
  assert.ok((await upload(c.factory, id, 'contractFile', 'after-close')).status >= 400, 'no evidence added after closure');
  const closedMail = (await outbox(id)).filter((m) => m.templateKey === 'app.closed' && m.recipientAddress === 'factory@shams.local');
  assert.equal(closedMail.length, 1);
  assert.ok(closedMail[0].body.includes('لم تكتمل الضمانات المطلوبة من البنك'), 'reason in the closing email');
  await assertCleanOutbox(id, app.number);

  // G-02: no bank decision gates the factory — both outcomes are open to it as soon as the bank is chosen
  const id2 = await advanceTo('CONTRACT_OUTCOME', { ...c, factory: c.factory2 }, 'IND-WA-S7B', BANK_A);
  assert.deepEqual(await actionsOf(c.factory2, id2), ['record_contract', 'record_no_contract', 'withdraw']);
  ok(await act(c.factory2, id2, 'record_no_contract', { reason: 'رفض البنك التمويل', contractNotes: 'تواصل خارج المنصة' }), 'record failure directly');
  assert.equal((await getApp(c.factory2, id2)).state, 'CLOSED_NOT_CONTRACTED');
});

// ─────────────────────────────────────────────────────────────────────────────
test('S8 authorization attacks are refused server-side', async () => {
  await freeFactories();
  // A: factory, B: factory2
  const A = await advanceTo('OFFER_UPLOAD', c, 'IND-WA-S8A');
  const B = await advanceTo('IMC_REVIEW', { ...c, factory: c.factory2 }, 'IND-WA-S8B');
  const docA = (await getApp(c.factory, A)).documents[0].id;
  const before = await getApp(c.factory, A);

  // another factory's application and documents
  assert.equal((await c.factory2.get(`/applications/${A}`)).status, 404);
  assert.equal((await c.factory2.post(`/applications/${A}/actions/submit_offer`, { expectedVersion: before.version, ...PROVIDER_INFO })).status, 404);
  assert.equal((await c.factory2.get(`/applications/${A}/documents/${docA}/download`)).status, 404);
  assert.equal((await c.factory2.get(`/applications/${B}/documents/${docA}/download`)).status, 404, 'document id swapping');
  assert.ok((await c.factory2.put(`/applications/${A}/data/general`, { address: 'x' })).status >= 400);
  assert.ok((await c.factory2.upload(`/applications/${A}/documents`, { kind: 'technicalOfferFile' }, PDF)).status >= 400);

  // wrong roles
  refused(await raw(c.factory2, B, 'accept'), 'factory cannot make an IMC decision');
  refused(await raw(c.pmu, B, 'accept'), 'PMU cannot make an IMC decision');
  refused(await raw(c.admin, B, 'accept'), 'system_admin makes no decision');
  ok(await act(c.imc, B, 'accept'), 'B → ENCPC');
  refused(await raw(c.pmu, B, 'compliant'), 'PMU cannot make an ENCPC decision');
  refused(await raw(c.imc, B, 'compliant'), 'IMC cannot make an ENCPC decision');

  // retired actions and the removed directory
  assert.equal((await raw(c.factory, A, 'select_provider', { providerId: 'sp-demo-1' })).status, 404, 'provider selection is gone');
  assert.equal((await c.factory.get('/service-providers')).status, 404);

  // skipping stages and changing the state directly
  for (const [action, body] of [['accept', { distributionCompany: 'شركة' }], ['select_bank', { bankOrgId: BANK_A }], ['record_contract', { contractDate: '2026-10-05', contractAmount: 5 }], ['record_no_contract', { reason: 'تخطي' }]] as const) {
    assert.ok([403, 409].includes((await act(c.factory, A, action, body as Record<string, unknown>)).status), `skip via ${action}`);
  }
  assert.equal((await act(c.factory, A, 'submit_offer', { state: 'CONTRACTED' })).status, 400, 'extra fields rejected');
  assert.equal((await c.factory.post(`/applications/${A}/actions/set_state`, { expectedVersion: before.version, state: 'CONTRACTED' })).status, 404, 'no generic state change');
  assert.ok([404, 405].includes((await c.factory.req('PATCH', `/applications/${A}`, { state: 'CONTRACTED' })).status));
  assert.ok([404, 405].includes((await c.factory.put(`/applications/${A}`, { state: 'CONTRACTED' })).status));
  assert.equal((await getApp(c.factory, A)).state, 'OFFER_UPLOAD', 'state untouched by every attack');

  // inactive / non-bank organizations cannot be chosen as the bank
  assert.equal((await upload(c.factory, A, 'technicalOfferFile', 's8-offer')).status, 201);
  ok(await act(c.factory, A, 'submit_offer'), 'offer');
  refused(await raw(c.encpc, A, 'accept'), 'ENCPC cannot approve a PMU stage');
  refused(await raw(c.electricity, A, 'accept'), 'the ministry cannot approve a PMU stage');
  ok(await act(c.pmu, A, 'accept'), 'pmu accept');
  assert.ok((await upload(c.factory, A, 'electricityApprovalFile', 's8-forged')).status >= 400, 'the factory cannot upload the approval');
  assert.ok((await upload(c.electricity, A, 'technicalOfferFile', 's8-x')).status >= 400, 'the ministry uploads its approval only');
  refused(await raw(c.encpc, A, 'accept'), 'ENCPC cannot approve the electricity stage');
  refused(await raw(c.pmu, A, 'accept'), 'PMU cannot approve the electricity stage');
  refused(await raw(c.factory, A, 'accept'), 'the factory cannot approve its own electricity approval');
  ok(await electricityAccept(c.electricity, A, 's8-elec'), 'electricity accept');
  const bankIds = async () => (await c.factory.get('/meta')).json.data.banks.map((b: { id: string }) => b.id);
  assert.ok((await bankIds()).includes(BANK_B), 'active bank listed');
  await dbRun('UPDATE shams_organizations SET isActive = 0 WHERE id = ?', BANK_B);
  try {
    assert.ok(!(await bankIds()).includes(BANK_B), 'inactive bank not offered to the factory');
    const r = await act(c.factory, A, 'select_bank', { bankOrgId: BANK_B });
    assert.equal(r.status, 422, 'inactive bank refused');
  } finally { await dbRun('UPDATE shams_organizations SET isActive = 1 WHERE id = ?', BANK_B); }
  assert.equal((await act(c.factory, A, 'select_bank', { bankOrgId: 'org-pmu' })).status, 422, 'non-bank organization refused');
  assert.equal((await act(c.factory, A, 'select_bank', { bankOrgId: 'org-nope' })).status, 422, 'unknown bank refused');
  refused(await raw(c.pmu, A, 'select_bank', { bankOrgId: BANK_A }), 'PMU cannot choose the bank for the factory');
  assert.equal((await act(c.factory, A, 'record_contract', { contractDate: '2026-10-05', contractAmount: 5 })).json.code, 'BANK_NOT_SELECTED', 'no outcome without a bank');
  assert.equal((await getApp(c.factory, A)).state, 'CONTRACT_OUTCOME');

  // cleanup so the factories are free for the next scenario
  ok(await act(c.factory, A, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup A');
  ok(await act(c.factory2, B, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup B');
  // reopening a withdrawn (final) application is refused too
  assert.equal((await act(c.factory, A, 'submit_offer')).status, 409);
});

// ─────────────────────────────────────────────────────────────────────────────
test('S9 failure and retry: registry timeout / bad response, email failure, duplicates, concurrency, stale version, bad upload, rolled-back transaction', async () => {
  await freeFactories();
  // registry: hangs (timeout), garbage 200, 404 — on the real HTTP adapter
  let mode: 'hang' | 'garbage' | 'missing' | 'ok' = 'hang';
  const fake = http.createServer((req, res) => {
    if (mode === 'hang') return; // never answers
    if (mode === 'garbage') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{not json'); return; }
    if (mode === 'missing') { res.writeHead(404); res.end(); return; }
    const num = decodeURIComponent((req.url ?? '').split('/').pop() ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ found: true, registration: { number: num, name: 'منشأة', status: 'active' } }));
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const { port } = fake.address() as AddressInfo;
  Object.assign(process.env, { REGISTRY_ADAPTER: 'http', REGISTRY_API_URL: `http://127.0.0.1:${port}`, REGISTRY_API_KEY: 'k', REGISTRY_TIMEOUT_MS: '400' });
  let id = '';
  try {
    id = await createCompleteDraft(c.factory, 'IND-WA-S9');
    for (const [m, code] of [['hang', 'REGISTRY_UNAVAILABLE'], ['garbage', 'REGISTRY_UNAVAILABLE'], ['missing', 'REGISTRY_INVALID']] as const) {
      mode = m;
      const r = await act(c.factory, id, 'submit');
      assert.equal(r.status, 422, m); assert.equal(r.json.code, code, `${m} → ${code} (an outage is never reported as an invalid number)`);
      const app = await getApp(c.factory, id);
      assert.equal(app.state, 'DRAFT'); assert.equal(app.number, null, 'no application number issued');
      assert.equal(app.data.general.companyName, 'مصنع تجريبي للصناعات المعدنية', 'entered data preserved');
    }
    assert.equal((await q("SELECT COUNT(*) AS n FROM shams_application_transitions WHERE applicationId = ? AND toState <> 'DRAFT'", id) as any)[0].n, 0, 'no referral');
    assert.deepEqual((await q<{ result: string }>('SELECT result FROM shams_registry_verifications WHERE applicationId = ? ORDER BY checkedAt', id)).map((x) => x.result), ['unavailable', 'unavailable', 'invalid'], 'each failure recorded');
    assert.equal((await emailsTo(id, 'app.registry_failed', 'factory@shams.local')).length, 3, 'factory told each time');
    assert.equal((await emailsTo(id, 'app.review_assigned', 'imc1@shams.local')).length, 0, 'IMC not notified of an unverified application');
    mode = 'ok';
    // duplicate submission (double click): both requests carry the same version → exactly one wins
    const v = (await getApp(c.factory, id)).version;
    const [r1, r2] = await Promise.all([
      c.factory.post(`/applications/${id}/actions/submit`, { expectedVersion: v }), c.factory.post(`/applications/${id}/actions/submit`, { expectedVersion: v }),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409], 'one submission, one conflict');
    assert.equal((await outbox(id)).filter((m) => m.templateKey === 'app.submitted').length, 1, 'one receipt');
  } finally {
    Object.assign(process.env, { REGISTRY_ADAPTER: 'mock' }); delete process.env.REGISTRY_TIMEOUT_MS;
    await new Promise((r) => fake.close(() => r(null)));
  }

  // replay of an applied action and stale version
  const stale = await c.factory.post(`/applications/${id}/actions/submit`, { expectedVersion: 1 });
  assert.equal(stale.status, 409);
  const cur = await getApp(c.imc, id);
  const old = await c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: cur.version - 1 });
  assert.equal(old.status, 409); assert.equal(old.json.code, 'VERSION_CONFLICT');

  // concurrent conflicting IMC decisions → exactly one applies
  const [d1, d2] = await Promise.all([
    c.imc.post(`/applications/${id}/actions/accept`, { expectedVersion: cur.version }),
    c.imc2.post(`/applications/${id}/actions/reject`, { expectedVersion: cur.version, reason: 'قرار متزامن', reasonCode: 'other' }),
  ]);
  assert.deepEqual([d1.status, d2.status].sort(), [200, 409]);
  const decided = (await history(id)).filter((t) => t.fromState === 'IMC_REVIEW');
  assert.equal(decided.length, 1, 'one decision recorded');
  if ((await getApp(c.factory, id)).state !== 'REJECTED') ok(await act(c.factory, id, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup');

  // email delivery failure does not change the workflow, and is retried
  const { processNotifications } = await import('../jobs/notificationWorker.js');
  const { setMailSenderForTests } = await import('../mail/mailer.js');
  await processNotifications(1000);
  setMailSenderForTests(async () => { throw new Error('SMTP 421 (fake outage)'); });
  try {
    const target = await advanceTo('IMC_REVIEW', { ...c, factory: c.factory2 }, 'IND-WA-S9-MAIL');
    assert.equal((await getApp(c.factory2, target)).state, 'IMC_REVIEW', 'action succeeded although mail is down');
    const res = await processNotifications(1000);
    assert.ok(res.retried >= 1, 'email failures scheduled for retry');
    const rows = await q<{ status: string; attempts: number }>("SELECT status, attempts FROM notification_outbox WHERE applicationId = ? AND channel = 'email'", target);
    assert.ok(rows.length && rows.every((r) => r.status === 'pending' && r.attempts === 1), 'queued for retry, not marked sent');
    ok(await act(c.factory2, target, 'withdraw', { reason: 'إنهاء سيناريو الاختبار' }), 'cleanup');
  } finally {
    setMailSenderForTests(async (m) => { sentMails.push({ to: m.to, subject: m.subject, html: m.html, text: m.text, attachments: [] }); return 'sent'; });
  }

  // bad upload: not a PDF → refused, nothing stored
  const draft = await createCompleteDraft(c.factory2, 'IND-WA-S9-UP');
  const docsBefore = (await getApp(c.factory2, draft)).documents.length;
  const bad = await c.factory2.upload(`/applications/${draft}/documents`, { kind: 'taxCardFile' }, Buffer.from('MZ\x90\x00 not a pdf'), 'evil.pdf');
  assert.ok(bad.status >= 400 && bad.status < 500);
  assert.equal((await getApp(c.factory2, draft)).documents.length, docsBefore, 'no partial document');

  // rolled-back transaction: another factory submitting the registry number held by an open application
  const holder = await advanceTo('IMC_REVIEW', c, 'IND-WA-S9-DUP');
  ok(await c.factory2.put(`/applications/${draft}/data/company`, { industrialRegistryNumber: 'IND-WA-S9-DUP' }), 'reuse number');
  const dup = await act(c.factory2, draft, 'submit');
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'DUPLICATE_REGISTRY');
  const d = await getApp(c.factory2, draft);
  assert.equal(d.state, 'DRAFT'); assert.equal(d.number, null, 'no number, no transition');
  assert.equal((await q("SELECT COUNT(*) AS n FROM shams_registry_conflicts WHERE attemptedApplicationId = ?", draft) as any)[0].n, 1, 'conflict recorded for IMC/PMU');
  assert.equal((await getApp(c.factory, holder)).state, 'IMC_REVIEW', 'holder unaffected');
});
