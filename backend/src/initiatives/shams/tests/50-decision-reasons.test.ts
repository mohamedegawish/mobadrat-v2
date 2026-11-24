// F1 / D10 (QA 2026-11-23, BUG-06): every negative decision carries its reason in-app (full), by e-mail (template) and in the
// stored SMS (cut to two segments, with a link). Covers T5, T7, T9, T14, T18 and T23.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, pdfVariant, q, type Started } from './helpers.js';
import { composeDecisionTexts, smsCapacity } from '../../../core/notify/decisionText.js';
import { decisionReason as sona3Reason } from '../../sona3/notifications/notify.js';

const env = isolateTestEnv('reasons');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;
const reg = () => `IND-RSN-${++seq}`;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

async function closeOpen() {
  for (const f of [c.factory, c.factory2]) {
    const open = (await f.get('/factory/profile')).json.data.openApplicationId;
    if (open) await act(f, open, 'withdraw', { reason: 'إنهاء لأغراض الاختبار' });
  }
}
/** The latest in-app notification of `who` on this application, and the stored SMS of `template`. */
async function channels(who: typeof c.factory, appId: string, template: string) {
  const inbox = (await who.get('/notifications?pageSize=50')).json.data.items.filter((n: any) => n.applicationId === appId && n.templateKey === template);
  const sms = await q<{ body: string }>("SELECT body FROM notification_outbox WHERE applicationId = ? AND templateKey = ? AND channel = 'sms' ORDER BY createdAt DESC", appId, template);
  const mail = await q<{ body: string }>("SELECT body FROM notification_outbox WHERE applicationId = ? AND templateKey = ? AND channel = 'email' ORDER BY createdAt DESC", appId, template);
  return { inbox: inbox[0]?.body as string | undefined, sms: sms[0]?.body, mail: mail[0]?.body };
}
function assertReason(ch: { inbox?: string; sms?: string; mail?: string }, reason: string, what: string) {
  assert.ok(ch.inbox?.includes(reason), `${what}: in-app carries the full reason — got «${ch.inbox}»`);
  assert.ok(ch.mail?.includes(reason.slice(0, 20)), `${what}: e-mail carries the reason`);
  assert.ok(ch.sms, `${what}: the SMS text is stored`);
  assert.ok(ch.sms!.length <= smsCapacity(ch.sms!), `${what}: SMS fits two segments (${ch.sms!.length})`);
  assert.ok(ch.sms!.includes(reason.slice(0, 8)), `${what}: SMS carries the start of the reason — got «${ch.sms}»`);
  assert.ok(/https?:\/\//.test(ch.sms!), `${what}: SMS carries a link`);
}

test('composeDecisionTexts: full reason in-app, SMS cut to two UCS-2 segments with an ellipsis and the link', () => {
  const long = 'سبب طويل جدًا '.repeat(30);
  const t = composeDecisionTexts('شمس الصناعة: رُفض الطلب SHAMS-2026-00001.', { text: long, labelAr: 'سبب الرفض' }, 'https://x.gov.eg');
  assert.ok(t.inbox.includes(long.trim()));
  assert.equal(smsCapacity(t.sms), 134);
  assert.ok(t.sms.length <= 134, `length ${t.sms.length}`);
  assert.ok(t.sms.endsWith(' https://x.gov.eg'));
  assert.ok(t.sms.includes('…'));
  const short = composeDecisionTexts('decision.', { text: 'short reason' }, 'https://x');
  assert.equal(short.sms, 'decision. السبب: short reason https://x');
});

test('IMC استيفاء and رفض, ENCPC غير مطابق: the reason reaches the factory in every channel (T5, T7, T9)', async () => {
  await closeOpen();
  const a = await advanceTo('IMC_REVIEW', c, reg());
  const r5 = 'العنوان ناقص — اكتب رقم القطعة والشارع';
  assert.equal((await act(c.imc, a, 'request_correction', { deficiencies: [{ field: 'address', note: r5 }], reason: r5 })).status, 200);
  assertReason(await channels(c.factory, a, 'app.correction_requested'), r5, 'T5');
  await c.factory.put(`/applications/${a}/data/general`, { address: 'المنطقة الثالثة قطعة 12' });
  assert.equal((await act(c.factory, a, 'resubmit')).status, 200);
  const r7 = 'السجل الصناعي لا يخص المنشأة المقدِّمة';
  assert.equal((await act(c.imc, a, 'reject', { reason: r7 })).status, 200);
  assertReason(await channels(c.factory, a, 'app.rejected'), r7, 'T7');

  const b = await advanceTo('ENCPC_REVIEW', c, reg());
  const r9 = 'مساحات الأسطح لا تطابق الرسومات المرفقة';
  assert.equal((await act(c.encpc, b, 'non_compliant', { deficiencies: [{ field: 'roofAreas', note: r9 }], reason: r9 })).status, 200);
  assertReason(await channels(c.factory, b, 'app.correction_requested'), r9, 'T9');
});

test('PMU غير مقبول and غير مستوفاة; a withdrawal reaches the reviewer whose turn it was (T14, T18, T23)', async () => {
  await closeOpen();
  const a = await advanceTo('OFFER_REVIEW', c, reg());
  const r14 = 'العرض لا يذكر ضمان الألواح وقدرة العاكس';
  assert.equal((await act(c.pmu, a, 'request_correction', { reason: r14 })).status, 200);
  assertReason(await channels(c.factory, a, 'app.correction_requested'), r14, 'T14');
  const up = await c.factory.upload(`/applications/${a}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-2'), 'offer-2.pdf');
  assert.equal(up.status, 201);
  assert.equal((await act(c.factory, a, 'resubmit')).status, 200);
  assert.equal((await act(c.pmu, a, 'accept')).status, 200);
  const up2 = await c.factory.upload(`/applications/${a}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('elec'), 'elec.pdf');
  assert.equal(up2.status, 201);
  assert.equal((await act(c.factory, a, 'submit_electricity', { distributionCompany: 'شركة القناة' })).status, 200);
  const r18 = 'موافقة الكهرباء غير مختومة من شركة التوزيع';
  assert.equal((await act(c.pmu, a, 'request_correction', { reason: r18 })).status, 200);
  assertReason(await channels(c.factory, a, 'app.correction_requested'), r18, 'T18');

  await closeOpen();
  const b = await advanceTo('ENCPC_REVIEW', c, reg());
  await closeOpen(); // withdraws b (the open one) with the helper's reason
  const r23 = 'إنهاء لأغراض الاختبار';
  assertReason(await channels(c.encpc, b, 'app.closed'), r23, 'T23 (ENCPC, whose turn it was)');
});

test('Sona3 uses the same shared layer: its negative decisions carry the reason too (F1 applies to every initiative)', () => {
  assert.deepEqual(sona3Reason('app.rejected', { reason: 'لا يستوفي شرط الحد الأدنى' }), { labelAr: 'سبب القرار', text: 'لا يستوفي شرط الحد الأدنى' });
  assert.equal(sona3Reason('app.appeal_decided', { reason: 'x', accepted: true }), undefined);
  assert.equal(sona3Reason('app.approved', { reason: 'x' }), undefined);
});
