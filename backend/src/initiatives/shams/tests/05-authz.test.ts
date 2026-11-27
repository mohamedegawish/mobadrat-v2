// اختبارا القبول 13 و14: كل دور يُمنع من كل إجراء خارج الجدول (بما فيه الأدمن)، وعزل البيانات بين الجهات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, getApp, advanceTo, createCompleteDraft, q, uploadContractFile, type Started, type Client } from './helpers.js';

const env = isolateTestEnv('authz');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

// record_result / reassign_bank: إجراءات ملغاة (G-02) — تبقى في القائمة لإثبات أن الخادم يرفضها لكل دور.
const ALL_ACTIONS = ['submit', 'resubmit', 'accept', 'request_correction', 'reject', 'compliant', 'non_compliant',
  'submit_offer', 'select_bank', 'record_contract', 'record_no_contract', 'withdraw', 'record_result', 'reassign_bank',
  'select_distribution_path', 'submit_distribution_approval', 'reject_distribution'];

/** الإجراءات المسموحة لكل (دور، حالة) وفق جدول الانتقالات. */
const EXPECTED: Record<string, Record<string, string[]>> = {
  IMC_REVIEW: { imc: ['accept', 'request_correction', 'reject'], factory: ['withdraw'] },
  ENCPC_REVIEW: { encpc: ['compliant', 'non_compliant'], factory: ['withdraw'] },
  OFFER_REVIEW: { pmu: ['accept', 'request_correction'], factory: ['withdraw'] },
  ELECTRICITY_REVIEW: { electricity: ['accept', 'request_correction'], factory: ['withdraw'] },
  // G-01/G-02: بعد قبول الكهرباء لا يتصرف إلا المصنع — يختار مسار التعاقد (البنك أو شركة التوزيع)، وعلى مسار البنك يسجل النتيجة.
  BANK_SELECTION: { factory: ['select_bank', 'select_distribution_path', 'withdraw'] },
  CONTRACT_OUTCOME: { factory: ['record_contract', 'record_no_contract', 'withdraw'] },
  // مسار شركة توزيع الكهرباء: المصنع يرسل الموافقة، وPMU وحدها تقرر (قبول = تم التعاقد / رفض نهائي).
  DISTRIBUTION_UPLOAD: { factory: ['submit_distribution_approval', 'withdraw'] },
  DISTRIBUTION_REVIEW: { pmu: ['accept', 'reject_distribution'], factory: ['withdraw'] },
};

async function closeOpen() {
  const open = (await c.factory.get('/factory/profile')).json.data.openApplicationId;
  if (open) await act(c.factory, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
}

test('13) every role is blocked from every action outside the transition table — including admin', async () => {
  let n = 0;
  for (const [state, allowed] of Object.entries(EXPECTED)) {
    await closeOpen();
    const id = await advanceTo(state as any, c, `IND-AZ-${++n}`);
    const version = (await getApp(c.pmu, id)).version;
    const roles: Record<string, Client> = { factory: c.factory, imc: c.imc, encpc: c.encpc, pmu: c.pmu, electricity: c.electricity, admin: c.admin, factory2: c.factory2 };
    for (const [role, client] of Object.entries(roles)) {
      // allowedActions من السيرفر يطابق الجدول
      const view = await client.get(`/applications/${id}`);
      if (view.status === 200) {
        const got = view.json.data.allowedActions.map((a: any) => a.action).sort();
        assert.deepEqual(got, [...(allowed[role] ?? [])].sort(), `${role}@${state} allowedActions`);
      }
      for (const action of ALL_ACTIONS) {
        if ((allowed[role] ?? []).includes(action)) continue;
        const r = await client.post(`/applications/${id}/actions/${action}`, { expectedVersion: version, reason: 'سبب اختبار', deficiencies: [{ field: 'address', note: 'x' }] });
        assert.ok([403, 404, 409, 400].includes(r.status) && r.status !== 200, `${role} ${action}@${state} must be blocked (got ${r.status})`);
        assert.notEqual(r.status, 200);
      }
    }
    assert.equal((await getApp(c.pmu, id)).version, version, `state unchanged at ${state}`);
  }
  // الأدمن: لا يملك أي قرار، ويرى الطلبات
  const anyApp = (await c.admin.get('/applications')).json.data.items[0];
  assert.ok(anyApp);
  assert.deepEqual((await getApp(c.admin, anyApp.id)).allowedActions, []);
});

test('14) data isolation: factory↔factory, IMC/ENCPC vs later-stage documents, contract evidence', async () => {
  await closeOpen();
  const id = await advanceTo('CONTRACT_OUTCOME', c, 'IND-AZ-ISO');
  await uploadContractFile(c.factory, id, 'evidence');
  assert.equal((await act(c.factory, id, 'record_contract', { contractDate: '2026-10-05', contractAmount: 1_000_000 })).status, 200);
  const app = await getApp(c.factory, id);
  const offerDoc = app.documents.find((d: any) => d.kind === 'technicalOfferFile');
  const elecDoc = app.documents.find((d: any) => d.kind === 'electricityApprovalFile');
  const taxDoc = app.documents.find((d: any) => d.kind === 'taxCardFile');
  const contractDoc = app.documents.find((d: any) => d.kind === 'contractFile');
  assert.ok(offerDoc && elecDoc && taxDoc && contractDoc);

  // G-03: مستند التعاقد — المصنع وPMU فقط؛ الأدمن بيانات وصفية بلا تنزيل
  assert.equal((await c.factory.get(`/applications/${id}/documents/${contractDoc.id}/download`)).status, 200);
  assert.equal((await c.pmu.get(`/applications/${id}/documents/${contractDoc.id}/download`)).status, 200);
  assert.ok((await getApp(c.pmu, id)).documents.some((d: any) => d.kind === 'contractFile'), 'PMU sees it');
  assert.notEqual((await c.admin.get(`/applications/${id}/documents/${contractDoc.id}/download`)).status, 200, 'admin is metadata only');
  assert.equal((await c.factory2.get(`/applications/${id}/documents/${contractDoc.id}/download`)).status, 404);

  // مصنع آخر: لا طلب ولا ملفات ولا ظهور في القائمة
  assert.equal((await c.factory2.get(`/applications/${id}`)).status, 404);
  assert.equal((await c.factory2.get(`/applications/${id}/documents/${taxDoc.id}/download`)).status, 404);
  assert.ok(!(await c.factory2.get('/applications')).json.data.items.some((a: any) => a.id === id));
  assert.equal((await c.factory2.put(`/applications/${id}/data/general`, { address: 'x' })).status, 404);


  // IMC وENCPC: لا عرض فني ولا موافقة كهرباء ولا بيانات مقدم الخدمة
  for (const reviewer of [c.imc, c.encpc]) {
    const v = await getApp(reviewer, id);
    assert.ok(!v.documents.some((d: any) => ['technicalOfferFile', 'electricityApprovalFile', 'contractFile'].includes(d.kind)));
    assert.equal((await reviewer.get(`/applications/${id}/documents/${contractDoc.id}/download`)).status, 404);
    assert.equal(v.providerInfo, null);
    assert.equal(v.data.provider, undefined);
    assert.equal(v.data.electricity, undefined);
    assert.equal(v.bankReferral, null);
    assert.equal((await reviewer.get(`/applications/${id}/documents/${offerDoc.id}/download`)).status, 404);
    assert.equal((await reviewer.get(`/applications/${id}/documents/${elecDoc.id}/download`)).status, 404);
    const tax = await reviewer.get(`/applications/${id}/documents/${taxDoc.id}/download`);
    assert.equal(tax.status, 200);
    assert.equal(tax.headers.get('content-type'), 'application/pdf');
    assert.ok(tax.raw!.subarray(0, 5).toString() === '%PDF-');
  }
  // IMC يرى قرارات مرحلته فقط
  const imcView = await getApp(c.imc, id);
  assert.ok(imcView.transitions.every((t: any) => ['DRAFT', 'IMC_REVIEW', 'IMC_CORRECTION'].includes(t.fromState)));
  // IMC لا يرى مسودة لم تُرسل (الطلب السابق مغلق «تم التعاقد» فلا يمنع طلبًا جديدًا — G-09)
  const draft = await createCompleteDraft(c.factory, 'IND-AZ-DRAFT');
  assert.equal((await c.imc.get(`/applications/${draft}`)).status, 404);
  assert.equal((await c.encpc.get(`/applications/${draft}`)).status, 404);
  // المعرفات تُفحص بالجهة في كل طلب حتى للتنزيل المباشر
  const docs = await q<{ id: string }>('SELECT id FROM shams_documents WHERE applicationId = ?', draft);
  assert.equal((await c.factory2.get(`/applications/${draft}/documents/${docs[0].id}/download`)).status, 404);
});
