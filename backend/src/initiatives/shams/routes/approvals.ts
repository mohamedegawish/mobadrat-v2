/**
 * مسارات الموافقات الموزعة (H1/H2/H4) — لا يملك الأدمن أي موافقة هنا:
 *  - طلبات الحسابات: يوافق عليها مستخدم نشط من الجهة نفسها (وPMU للبنوك)، وليس مقدم الطلب.
 *  - استرداد بريد المصنع: PMU وحدها توافق (الأدمن يسجل الطلب ويقرأ فقط).
 *  - مفاتيح الربط ذات نطاقات البيانات: PMU وحدها.
 * الفحص الفعلي داخل الخدمات (canApproveAccountRequest / canDecide / assertApprover)؛ requireRole هنا طبقة أولى فقط.
 */
import { Router } from 'express';
import { ah, okMessage, Errors } from '../http/errors.js';
import { clientIp } from '../http/helpers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { singlePdfUpload, sendStoredPdf } from '../http/upload.js';
import { actorFromReq } from '../store/audit.js';
import { decideAccountRequest, listAccountRequests } from '../services/accounts.js';
import {
  approveRecovery, cancelRecoveryByPmu, listRecoveries, recoveryDocument, rejectRecovery, requestRecovery,
} from '../services/accountRecovery.js';
import { decideKey, pendingKeys } from '../services/integrationKeys.js';

export const approvalsRouter = Router();

const STAFF = ['imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'system_admin'] as const;

// ── طلبات الحسابات (H2) ──
approvalsRouter.get('/account-requests', requireRole(...STAFF), ah(async (req, res) =>
  okMessage(res, 200, 'ok', { items: await listAccountRequests(currentUser(req)) })));

for (const [path, approve] of [['approve', true], ['reject', false]] as const) {
  approvalsRouter.post(`/account-requests/:id/${path}`, requireRole('imc_reviewer', 'encpc_reviewer', 'pmu_reviewer'), ah(async (req, res) =>
    okMessage(res, 200, approve ? 'تمت الموافقة على الطلب.' : 'تم رفض الطلب.', await decideAccountRequest(currentUser(req), req.params.id, approve, req.body, clientIp(req)))));
}

// ── استرداد بريد حساب مصنع (H4) ──
approvalsRouter.get('/recovery-requests', requireRole('system_admin', 'pmu_reviewer'), ah(async (_req, res) =>
  okMessage(res, 200, 'ok', { items: await listRecoveries() })));

approvalsRouter.post('/recovery-requests', requireRole('system_admin'), singlePdfUpload, ah(async (req, res) => {
  const user = currentUser(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { userId, ...rest } = body;
  if (typeof userId !== 'string' || !userId) {
    throw Errors.validation([{ field: 'userId', issue: 'required' }]);
  }
  return okMessage(res, 201, 'سُجّل طلب الاسترداد — بانتظار موافقة وحدة إدارة المبادرة، ولن يتغير شيء قبل انتهاء مهلة الانتظار.',
    await requestRecovery({ ...actorFromReq(req), actorUserId: user.id }, userId, rest, req.file));
}));

approvalsRouter.get('/recovery-requests/:id/document', requireRole('system_admin', 'pmu_reviewer'), ah(async (req, res) => {
  const r = await recoveryDocument(currentUser(req), req.params.id);
  sendStoredPdf(res, r.documentStoredName, r.documentOriginalName, false);
}));

approvalsRouter.post('/recovery-requests/:id/approve', requireRole('pmu_reviewer'), ah(async (req, res) =>
  okMessage(res, 200, 'اعتُمد الطلب — بدأت مهلة الانتظار.', await approveRecovery(currentUser(req), req.params.id, req.body, clientIp(req)))));
approvalsRouter.post('/recovery-requests/:id/reject', requireRole('pmu_reviewer'), ah(async (req, res) =>
  okMessage(res, 200, 'رُفض طلب الاسترداد.', await rejectRecovery(currentUser(req), req.params.id, req.body, clientIp(req)))));
approvalsRouter.post('/recovery-requests/:id/cancel', requireRole('pmu_reviewer'), ah(async (req, res) =>
  okMessage(res, 200, 'أُلغي طلب الاسترداد.', await cancelRecoveryByPmu(currentUser(req), req.params.id, req.body, clientIp(req)))));

// ── اعتماد مفاتيح الربط (H1) ──
approvalsRouter.get('/integration-keys/pending', requireRole('pmu_reviewer'), ah(async (req, res) =>
  okMessage(res, 200, 'ok', { items: await pendingKeys(currentUser(req)) })));
for (const [path, approve] of [['approve', true], ['reject', false]] as const) {
  approvalsRouter.post(`/integration-keys/:id/${path}`, requireRole('pmu_reviewer'), ah(async (req, res) =>
    okMessage(res, 200, approve ? 'اعتُمد المفتاح.' : 'رُفض المفتاح.', await decideKey(currentUser(req), req.params.id, approve, req.body, actorFromReq(req)))));
}
