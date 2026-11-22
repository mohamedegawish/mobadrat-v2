/**
 * قواعد رؤية البيانات (docs/SONA3_DESIGN.md §12) — تُطبَّق في الباك على كل قراءة وتنزيل، مع فحص الجهة في كل طلب.
 */
import type { UserInternal } from '../store/users.js';
import type { AppRow, TransitionRow, DeficiencyRow } from '../store/applications.js';
import type { DocumentRow } from '../store/documents.js';
import { isActiveAt } from '../store/documents.js';
import { assignmentFor } from '../store/evaluations.js';
import { hasReferralTo } from '../store/lifecycle.js';
import { FORM_SECTIONS, type DataSection } from '../workflow/applicationForm.js';
import type { SqlParam } from '../http/helpers.js';
import { ORG_IDS } from '../domain.js';

/** شرط SQL لنطاق قائمة الطلبات حسب الدور والجهة (a = applications، p = applicants). */
export function listScope(user: UserInternal): { sql: string; params: SqlParam[]; includeDrafts: boolean } {
  switch (user.role) {
    case 'applicant':
      return { sql: 'p.organizationId = ?', params: [user.organizationId], includeDrafts: true };
    case 'evaluator':
      return { sql: "EXISTS (SELECT 1 FROM sona3_evaluator_assignments e WHERE e.applicationId = a.id AND e.evaluatorUserId = ? AND e.status <> 'removed')", params: [user.id], includeDrafts: false };
    case 'funder_reviewer':
      return { sql: 'EXISTS (SELECT 1 FROM sona3_funding_referrals r WHERE r.applicationId = a.id AND r.funderOrgId = ?)', params: [user.organizationId], includeDrafts: false };
    case 'imc_officer':
      return user.organizationId === ORG_IDS.imc ? { sql: '1 = 1', params: [], includeDrafts: true } : { sql: '1 = 0', params: [], includeDrafts: false };
    case 'system_admin':
      return { sql: '1 = 1', params: [], includeDrafts: true };
    default:
      return { sql: '1 = 0', params: [], includeDrafts: false };
  }
}

/** هل يرى المستخدم هذا الطلب؟ (غير ذلك → 404 دون كشف وجوده). */
export async function canSeeApplication(user: UserInternal, app: AppRow): Promise<boolean> {
  switch (user.role) {
    case 'applicant': return app.applicantOrgId === user.organizationId;
    case 'evaluator': return await assignmentFor(app.id, user.id) !== null;
    case 'funder_reviewer': return await hasReferralTo(app.id, user.organizationId);
    case 'imc_officer': return user.organizationId === ORG_IDS.imc;
    case 'system_admin': return true;
    default: return false;
  }
}

export function isApplicantOf(user: UserInternal, app: AppRow): boolean {
  return user.role === 'applicant' && app.applicantOrgId === user.organizationId;
}

/** المقيّم يرى بيانات الطلب فقط بعد إقراره بعدم تضارب المصالح. */
export async function evaluatorCleared(user: UserInternal, app: AppRow): Promise<boolean> {
  if (user.role !== 'evaluator') return false;
  const a = await assignmentFor(app.id, user.id);
  return a !== null && (a.status === 'draft' || a.status === 'submitted');
}

/** الأقسام المسموح بها لكل دور. */
export async function visibleSections(user: UserInternal, app: AppRow): Promise<Set<DataSection>> {
  const all: DataSection[] = [...FORM_SECTIONS, 'approval'];
  switch (user.role) {
    case 'applicant': return isApplicantOf(user, app) ? new Set(all) : new Set();
    case 'imc_officer': return new Set(all);
    case 'funder_reviewer': return new Set(all);
    case 'evaluator': return await evaluatorCleared(user, app) ? new Set(FORM_SECTIONS) : new Set();
    default: return new Set();
  }
}

/** آخر محاولة يراها المستخدم: المتقدم يرى ما لم يُرسل بعد (المحاولة القادمة)، والجهات ترى المُرسل فقط. */
export function viewAttempt(user: UserInternal, app: AppRow): number | undefined {
  return user.role === 'applicant' ? undefined : app.attempt;
}

/** المستندات ونسخها السابقة المسموح بها. */
export async function visibleDocuments(user: UserInternal, app: AppRow, docs: DocumentRow[]): Promise<DocumentRow[]> {
  switch (user.role) {
    case 'applicant':
      return isApplicantOf(user, app) ? docs : [];
    case 'imc_officer':
    case 'system_admin':
      return docs.filter((d) => d.attempt <= Math.max(app.attempt, 1));
    case 'evaluator':
      return await evaluatorCleared(user, app)
        ? docs.filter((d) => isActiveAt(d, app.attempt) && !['approvalFile', 'fundingDecisionFile', 'milestoneEvidence'].includes(d.kind))
        : [];
    case 'funder_reviewer':
      // آخر نسخة سارية فقط من كل مستند.
      return docs.filter((d) => isActiveAt(d, Math.max(app.attempt, 1)));
    default:
      return [];
  }
}

/** القرارات وأسبابها: المقيّم وجهة التمويل لا يريان سجل القرارات الداخلي. */
export function visibleTransitions(user: UserInternal, rows: TransitionRow[]): TransitionRow[] {
  switch (user.role) {
    case 'evaluator':
    case 'funder_reviewer':
      return [];
    default:
      return rows;
  }
}

export function visibleDeficiencies(user: UserInternal, rows: DeficiencyRow[]): DeficiencyRow[] {
  switch (user.role) {
    case 'evaluator':
    case 'funder_reviewer':
      return [];
    default:
      return rows;
  }
}
