// Business decisions G-03 (contracting evidence) and G-09 (closed applications and new applications) — server-side rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, pdfVariant, PDF, q, BANK_A, type Started } from './helpers.js';

const env = isolateTestEnv('decisions');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-DEC-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
const upload = (id: string, file: Buffer, name: string, mime = 'application/pdf') =>
  c.factory.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, file, name, mime);

test('G-03a «تم التعاقد» requires date, amount and the evidence document; notes are optional', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), BANK_A);
  const noDoc = await act(c.factory, id, 'record_contract', { contractDate: '2026-10-20', contractAmount: 1000 });
  assert.equal(noDoc.status, 422); assert.equal(noDoc.json.code, 'DOCUMENT_REQUIRED');
  assert.ok(noDoc.json.details.some((d: any) => d.field === 'contractFile'));
  assert.equal((await upload(id, pdfVariant('ev-1'), 'contract.pdf')).status, 201);
  for (const [body, field] of [
    [{ contractAmount: 1000 }, 'contractDate'], [{ contractDate: '2026-13-45', contractAmount: 1000 }, 'contractDate'], [{ contractDate: '20-10-2026', contractAmount: 1000 }, 'contractDate'],
    [{ contractDate: '2026-10-20' }, 'contractAmount'], [{ contractDate: '2026-10-20', contractAmount: 0 }, 'contractAmount'],
    [{ contractDate: '2026-10-20', contractAmount: -5 }, 'contractAmount'], [{ contractDate: '2026-10-20', contractAmount: '1000' }, 'contractAmount'],
    [{ contractDate: '2026-10-20', contractAmount: 1000, contractNotes: 'x'.repeat(2001) }, 'contractNotes'],
  ] as const) {
    const r = await act(c.factory, id, 'record_contract', body as Record<string, unknown>);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.json.details.some((d: any) => d.field === field), `${field} named for ${JSON.stringify(body)}`);
  }
  assert.equal((await getApp(c.factory, id)).state, 'CONTRACT_OUTCOME', 'nothing recorded by the refused attempts');
  const ok = await act(c.factory, id, 'record_contract', { contractDate: '2026-10-20', contractAmount: 1_250_000.5 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const app = await getApp(c.factory, id);
  assert.equal(app.bankReferral.contractStatus, 'contracted');
  assert.equal(app.bankReferral.contractDate, '2026-10-20');
  assert.equal(app.bankReferral.contractAmount, 1_250_000.5);
  const doc = app.documents.find((d: any) => d.kind === 'contractFile');
  assert.ok(doc && doc.submitted, 'evidence kept and marked submitted with the outcome');
  assert.equal(doc.attempt, app.attempt, 'evidence belongs to the attempt that recorded the outcome');
  assert.equal((await q("SELECT payload FROM application_transitions WHERE applicationId = ? AND action = 'record_contract'", id)).length, 1);
});

test('G-03b the evidence must be a real PDF within the size limit; the upload is only possible at the outcome step, after the bank choice', async () => {
  await closeOpen();
  const id = await advanceTo('BANK_SELECTION', c, reg());
  assert.ok((await upload(id, pdfVariant('too-early'), 'early.pdf')).status >= 400, 'not before the bank is chosen');
  assert.equal((await act(c.factory, id, 'select_bank', { bankOrgId: BANK_A })).status, 200);
  const before_ = (await getApp(c.factory, id)).documents.length;
  for (const [file, name, mime, why] of [
    [Buffer.from('MZ\x90\x00 executable'), 'contract.pdf', 'application/pdf', 'wrong magic bytes'],
    [PDF, 'contract.exe', 'application/pdf', 'wrong extension'],
    [PDF, 'contract.pdf', 'image/png', 'wrong MIME type'],
    [Buffer.concat([PDF, Buffer.alloc(31 * 1024 * 1024, 32)]), 'big.pdf', 'application/pdf', 'over the size limit'],
  ] as const) {
    const r = await upload(id, file as Buffer, name, mime);
    assert.ok(r.status >= 400 && r.status < 500, `${why} -> ${r.status}`);
  }
  assert.equal((await getApp(c.factory, id)).documents.length, before_, 'no partial document stored');
  // unknown document kind is refused, and other factories cannot upload
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'bankLetter' }, PDF, 'x.pdf')).status, 400);
  assert.equal((await c.factory2.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, PDF, 'x.pdf')).status, 404);
  // a replacement before recording keeps the earlier version (superseded, not deleted)
  assert.equal((await upload(id, pdfVariant('v1'), 'v1.pdf')).status, 201);
  assert.equal((await upload(id, pdfVariant('v2'), 'v2.pdf')).status, 201);
  const versions = (await getApp(c.factory, id)).documents.filter((d: any) => d.kind === 'contractFile');
  assert.equal(versions.length, 2);
  assert.equal(versions.filter((d: any) => d.isCurrent).length, 1);
});

test('G-03c «لم يتم التعاقد» requires only a reason (notes optional); no evidence document is required', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), BANK_A);
  assert.equal((await act(c.factory, id, 'record_no_contract', {})).status, 400);
  assert.equal((await act(c.factory, id, 'record_no_contract', { reason: 'رفض البنك', contractNotes: 'x'.repeat(2001) })).status, 400, 'notes length checked');
  const r = await act(c.factory, id, 'record_no_contract', { reason: 'لم تتوفر الضمانات المطلوبة' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const app = await getApp(c.factory, id);
  assert.equal(app.state, 'CLOSED_NOT_CONTRACTED');
  assert.equal(app.bankReferral.notContractedReason, 'لم تتوفر الضمانات المطلوبة');
  assert.equal(app.bankReferral.contractNotes, '');
});

test('G-09 a closed application stays in history, is not active, never blocks a valid new application; only one active application at a time', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, reg(), BANK_A);
  let profile = (await c.factory.get('/factory/profile')).json.data;
  assert.equal(profile.openApplicationId, id);
  assert.equal(profile.canStartNew, false, 'one active application');
  const dup = await c.factory.post('/applications', {});
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'OPEN_APPLICATION_EXISTS');
  assert.equal((await c.factory.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, pdfVariant('g9'), 'c.pdf')).status, 201);
  assert.equal((await act(c.factory, id, 'record_contract', { contractDate: '2026-10-20', contractAmount: 900 })).status, 200);

  profile = (await c.factory.get('/factory/profile')).json.data;
  assert.equal(profile.openApplicationId, null, 'a closed application is not active');
  assert.equal(profile.canStartNew, true);
  const inHistory = profile.applications.find((a: any) => a.id === id);
  assert.ok(inHistory, 'closed application listed in the history');
  assert.equal(inHistory.state, 'CONTRACTED'); assert.ok(inHistory.closedAt);
  assert.equal((await getApp(c.factory, id)).state, 'CONTRACTED', 'still readable — closed, not deleted');

  // a new application can start; two concurrent creations still produce one active application
  const [a, b] = await Promise.all([c.factory.post('/applications', {}), c.factory.post('/applications', {})]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const fresh = (a.status === 201 ? a : b).json.data.id;
  profile = (await c.factory.get('/factory/profile')).json.data;
  assert.equal(profile.openApplicationId, fresh);
  assert.equal(profile.applications.filter((x: any) => !x.closedAt).length, 1, 'exactly one active application');
  assert.ok(profile.applications.some((x: any) => x.id === id), 'the closed one is still in the history');
  assert.equal((await act(c.factory, fresh, 'withdraw', { reason: 'إنهاء' })).status, 200);
});
