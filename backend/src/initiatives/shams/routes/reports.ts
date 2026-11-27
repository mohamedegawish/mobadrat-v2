import { Router } from 'express';
import { ah, okMessage } from '../http/errors.js';
import { str } from '../http/helpers.js';
import { currentUser, requireRole } from '../middleware/auth.js';
import { listApplications } from '../store/applications.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { listScope } from '../access/visibility.js';
import { buildSummary, reportRows, reportSheet, STAGE_LIMIT } from '../services/reports.js';
import { buildDashboard } from '../services/dashboard.js';
import { shamsPolicy } from '../config/shamsPolicy.js';

export const reportsRouter = Router();

/** التقارير: المصنع طلبه، IMC/ENCPC بيانات مرحلتهما، البنك طلبات بنكه، PMU والأدمن الكل. */
reportsRouter.get('/reports/summary', ah(async (req, res) => {
  const user = currentUser(req);
  const scope = listScope(user);
  return okMessage(res, 200, 'ok', await buildSummary({ sql: scope.sql, params: scope.params, includeDrafts: scope.includeDrafts }, STAGE_LIMIT[user.role] ?? null));
}));

reportsRouter.get('/reports/applications', ah(async (req, res) => {
  const user = currentUser(req);
  const scope = listScope(user);
  const { rows } = await listApplications({
    scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: scope.includeDrafts,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined, governorate: str(req.query.governorate) || undefined,
  }, 1, 1, true);
  // الأعمدة الكاملة (مقدم الخدمة، البنك، التعاقد، الإرجاعات) لـ PMU.
  // الأدمن يرى البيانات الوصفية فقط (shamsPolicy.adminCanViewApplicationDocuments) — لا أعمدة التمويل.
  const full = user.role === 'pmu_reviewer' || (user.role === 'system_admin' && shamsPolicy.adminCanViewApplicationDocuments);
  await addAuditLog({ ...actorFromReq(req), action: 'report.export', entityType: 'report', entityId: 'applications', summaryAr: `تصدير تقرير الطلبات (${rows.length} صف)` });
  const items = await reportRows(rows, full);
  return okMessage(res, 200, 'ok', { items, sheet: reportSheet(items, full) });
}));

/**
 * لوحة الدور (IMC / ENCPC / PMU / البنك): أرقام حقيقية بنطاق رؤية الدور، وروابط إلى قائمة العمل بفلتر صادق.
 * المصنع له «لوحتي»، والأدمن له لوحة الجاهزية.
 */
reportsRouter.get('/dashboard', requireRole('imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'electricity_reviewer'), ah(async (req, res) =>
  okMessage(res, 200, 'ok', await buildDashboard(currentUser(req)))));
