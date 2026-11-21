import { Router } from 'express';
import { ah, okMessage } from '../http/errors.js';
import { str } from '../http/helpers.js';
import { currentUser } from '../middleware/auth.js';
import { listApplications } from '../store/applications.js';
import { addAuditLog, actorFromReq } from '../store/audit.js';
import { listScope } from '../access/visibility.js';
import { buildSummary, reportRows, reportSheet } from '../services/reports.js';
import { policy } from '../config/initiativePolicy.js';

export const reportsRouter = Router();

/**
 * مؤشرات لوحة المتابعة (§13): كل دور يرى نطاقه (listScope). متوسط الدرجات لـ IMC وجهة التمويل والأدمن فقط
 * (المتقدم يرى درجته داخل طلبه بعد قرار الاختيار، والمقيّم لا يرى درجات غيره).
 */
reportsRouter.get('/reports/summary', ah((req, res) => {
  const user = currentUser(req);
  const scope = listScope(user);
  const includeScores = user.role === 'imc_officer' || user.role === 'funder_reviewer' || user.role === 'system_admin';
  return okMessage(res, 200, 'ok', buildSummary(scope, { cohortId: str(req.query.cohortId) || undefined, includeScores }));
}));

reportsRouter.get('/reports/applications', ah((req, res) => {
  const user = currentUser(req);
  const scope = listScope(user);
  const { rows } = listApplications({
    scopeSql: scope.sql, scopeParams: scope.params, includeDrafts: scope.includeDrafts,
    from: str(req.query.from) || undefined, to: str(req.query.to) || undefined, governorate: str(req.query.governorate) || undefined,
    cohortId: str(req.query.cohortId) || undefined, sector: str(req.query.sector) || undefined,
  }, 1, 1, true);
  // الأعمدة الكاملة (الدرجة والتمويل) لـ IMC؛ الأدمن بيانات وصفية فقط ما لم تسمح السياسة.
  const full = user.role === 'imc_officer' || (user.role === 'system_admin' && policy.adminCanViewApplicationDocuments);
  addAuditLog({ ...actorFromReq(req), action: 'report.export', entityType: 'report', entityId: 'applications', summaryAr: `تصدير تقرير الطلبات (${rows.length} صف)` });
  const items = reportRows(rows, full);
  return okMessage(res, 200, 'ok', { items, sheet: reportSheet(items, full) });
}));
