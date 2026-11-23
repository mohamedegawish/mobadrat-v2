/**
 * H3 / القرار 4: حظر رقم السجل الصناعي بعد رفض IMC بسبب «عدم تطابق ملكية رقم السجل».
 * الحظر على الرقم نفسه لكل الحسابات؛ PMU وحدها تحدد المصنع المسموح له بالرقم بإجراء موثق (سبب + مرجع).
 * ليس انتقالًا على الطلب (الطلب المرفوض يبقى نهائيًا)؛ يُدقق في audit_logs.
 */
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { Checker, onlyKeys } from '../http/validate.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { getBlock, listBlocks, releaseNumber } from '../store/registry.js';
import { getFactory } from '../store/factories.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { tx } from '../db/database.js';
import { clientIp } from '../http/helpers.js';
import { sendStoredPdf, singlePdfUpload } from '../http/upload.js';
import { decideDispute, decideObjection, disputesFor, listObjectionsFor, objectionDocument, publicObjection, submitObjection } from '../services/registryDisputes.js';

export const registryRouter = Router();
registryRouter.use('/registry-blocks', requireRole('pmu_reviewer'));

registryRouter.get('/registry-blocks', ah(async (req, res) => okMessage(res, 200, 'ok', { items: await listBlocks(req.query.all !== '1') })));

registryRouter.post('/registry-blocks/:id/release', ah(async (req, res) => {
  const user = currentUser(req);
  const block = await getBlock(req.params.id);
  if (!block) throw Errors.notFound();
  if (block.releasedAt) throw Errors.conflict('ALREADY_RELEASED', 'رُفع هذا الحظر بالفعل.', 'This block was already released.');
  const b = onlyKeys(req.body ?? {}, ['reason', 'reference', 'allowedFactoryId']);
  const c = new Checker();
  const reason = c.text(b, 'reason', { required: true, min: 10, max: 1000 });
  const reference = c.text(b, 'reference', { required: true, min: 3, max: 120 });
  // القرار: مصنع واحد فقط يُسمح له بالرقم، ويحدده PMU صراحة (لا افتراضي: صاحب الحظر الأصلي قد يكون هو المنتحل).
  const allowedFactoryId = c.text(b, 'allowedFactoryId', { required: true, max: 80 });
  c.throwIfAny();
  if (!await getFactory(allowedFactoryId!)) throw Errors.validation([{ field: 'allowedFactoryId', issue: 'unknown factory' }]);
  await tx(async () => {
    await releaseNumber(block.registryNumber, user.id, reason!, reference!, allowedFactoryId!);
    await addAuditLog({ ...actorFromReq(req), action: 'registry_block.release', entityType: 'registry_block', entityId: block.id, applicationId: block.applicationId,
      summaryAr: `رفع حظر رقم السجل ${block.registryNumber} لمصنع محدد (مرجع ${reference})`, details: { registryNumber: block.registryNumber, allowedFactoryId, reason, reference } });
  });
  return okMessage(res, 200, 'رُفع الحظر للمصنع المحدد فقط.', await getBlock(block.id));
}));

// ── نزاعات أرقام السجل (القاعدة G / القرار 4) ──
// PMU وحدها تحدد المصنع المخوَّل. المصنع يعترض بمستند ويرى اعتراضاته وقراراتها فقط.
registryRouter.get('/registry-disputes', requireRole('pmu_reviewer'), ah(async (req, res) => okMessage(res, 200, 'ok', { items: await disputesFor(currentUser(req)) })));
registryRouter.post('/registry-disputes/decide', requireRole('pmu_reviewer'), ah(async (req, res) =>
  okMessage(res, 200, 'سُجّل القرار — الرقم مسموح للمصنع المسمّى فقط.', await decideDispute(currentUser(req), req.body, clientIp(req)))));

registryRouter.get('/registry-objections', requireRole('factory_owner', 'pmu_reviewer'), ah(async (req, res) =>
  okMessage(res, 200, 'ok', { items: await listObjectionsFor(currentUser(req)) })));
registryRouter.post('/registry-objections', requireRole('factory_owner'), singlePdfUpload, ah(async (req, res) =>
  okMessage(res, 201, 'استُلم اعتراضك — ستراجعه وحدة إدارة المبادرة وتُبلغك بالقرار. يبقى الرقم موقوفًا حتى ذلك الحين.',
    await publicObjection(await submitObjection(currentUser(req), req.body, req.file, clientIp(req))))));
registryRouter.get('/registry-objections/:id/document', requireRole('factory_owner', 'pmu_reviewer'), ah(async (req, res) => {
  const o = await objectionDocument(currentUser(req), req.params.id);
  sendStoredPdf(res, o.storedName, o.originalName, false);
}));
for (const [path, accept] of [['accept', true], ['reject', false]] as const) {
  registryRouter.post(`/registry-objections/:id/${path}`, requireRole('pmu_reviewer'), ah(async (req, res) =>
    okMessage(res, 200, accept ? 'قُبل الاعتراض — الرقم مسموح للمنشأة المعترضة فقط.' : 'رُفض الاعتراض.', await decideObjection(currentUser(req), req.params.id, accept, req.body, clientIp(req)))));
}
