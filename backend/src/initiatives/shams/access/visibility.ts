/**
 * قواعد رؤية البيانات (القسم 4 من المواصفة) — تُطبَّق في الباك على كل قراءة وتنزيل، مع فحص الجهة في كل طلب.
 */
import type { UserInternal } from '../store/users.js';
import type { AppRow, TransitionRow, DeficiencyRow } from '../store/applications.js';
import { hasEnteredState } from '../store/applications.js';
import type { DocumentRow } from '../store/documents.js';
import { wasSubmitted } from '../store/documents.js';
import { FORM_DOCUMENT_KINDS, type DataSection } from '../workflow/applicationForm.js';
import type { ApplicationState } from '../workflow/shamsWorkflow.js';
import type { SqlParam } from '../http/helpers.js';

const IMC_STAGE: ApplicationState[] = ['DRAFT', 'IMC_REVIEW', 'IMC_CORRECTION'];
const ENCPC_STAGE: ApplicationState[] = [...IMC_STAGE, 'ENCPC_REVIEW', 'ENCPC_CORRECTION'];

/** شرط SQL لنطاق قائمة الطلبات حسب الدور والجهة. */
export function listScope(user: UserInternal): { sql: string; params: SqlParam[]; includeDrafts: boolean } {
  switch (user.role) {
    case 'factory_owner':
      return { sql: 'f.organizationId = ?', params: [user.organizationId], includeDrafts: true };
    // PR-P2: same meaning as a correlated EXISTS, but evaluated once. Without ANALYZE statistics (never run in production)
    // SQLite planned the EXISTS through idx_transitions_to and rescanned every IMC_REVIEW transition for each application:
    // quadratic (100 ms per list at 1,000 applications, more for the dashboard), all on the single event loop.
    case 'imc_reviewer':
      return { sql: "a.id IN (SELECT t.applicationId FROM shams_application_transitions t WHERE t.toState = 'IMC_REVIEW' AND t.fromState <> t.toState)", params: [], includeDrafts: false };
    case 'encpc_reviewer':
      return { sql: "a.id IN (SELECT t.applicationId FROM shams_application_transitions t WHERE t.toState = 'ENCPC_REVIEW' AND t.fromState <> t.toState)", params: [], includeDrafts: false };
    // bank_reviewer: دور ملغى (G-02) — لا يرى شيئًا (يقع في default).
    case 'pmu_reviewer':
    case 'system_admin':
      return { sql: '1 = 1', params: [], includeDrafts: true };
    default:
      return { sql: '1 = 0', params: [], includeDrafts: false };
  }
}

/** هل يرى المستخدم هذا الطلب؟ (غير ذلك → 404 دون كشف وجوده). */
export async function canSeeApplication(user: UserInternal, app: AppRow): Promise<boolean> {
  switch (user.role) {
    case 'factory_owner': return app.factoryOrgId === user.organizationId;
    case 'imc_reviewer': return await hasEnteredState(app.id, 'IMC_REVIEW');
    case 'encpc_reviewer': return await hasEnteredState(app.id, 'ENCPC_REVIEW');
    case 'pmu_reviewer': case 'system_admin': return true;
    default: return false;
  }
}

export function isFactoryOwnerOf(user: UserInternal, app: AppRow): boolean {
  return user.role === 'factory_owner' && app.factoryOrgId === user.organizationId;
}

/** الأقسام المسموح بها: مقدم الخدمة والعرض والكهرباء ونتائج البنك والتعاقد ممنوعة على IMC وENCPC. */
export function visibleSections(user: UserInternal): Set<DataSection> {
  const base: DataSection[] = ['general', 'contact', 'company', 'engineering'];
  if (user.role === 'imc_reviewer' || user.role === 'encpc_reviewer') return new Set(base);
  return new Set([...base, 'provider', 'offer', 'electricity', 'bank_result', 'contract']);
}

/** آخر محاولة يراها المستخدم: المصنع يرى ما لم يُرسل بعد (المحاولة القادمة)، والجهات ترى المُرسل فقط. */
export function viewAttempt(user: UserInternal, app: AppRow): number | undefined {
  return user.role === 'factory_owner' ? undefined : app.attempt;
}

/** المستندات ونسخها السابقة المسموح بها. */
export function visibleDocuments(user: UserInternal, app: AppRow, docs: DocumentRow[]): DocumentRow[] {
  switch (user.role) {
    case 'factory_owner':
      return docs;
    case 'pmu_reviewer':
    case 'system_admin':
      return docs.filter((d) => wasSubmitted(d, app.attempt));
    case 'imc_reviewer':
      return docs.filter((d) => wasSubmitted(d, app.attempt) && FORM_DOCUMENT_KINDS.includes(d.kind) && IMC_STAGE.includes(d.uploadedInState));
    case 'encpc_reviewer':
      return docs.filter((d) => wasSubmitted(d, app.attempt) && FORM_DOCUMENT_KINDS.includes(d.kind) && ENCPC_STAGE.includes(d.uploadedInState));
    default:
      return [];
  }
}

/** قرارات الجهات وأسبابها: IMC وENCPC حتى مرحلتهما. */
export function visibleTransitions(user: UserInternal, rows: TransitionRow[]): TransitionRow[] {
  switch (user.role) {
    case 'imc_reviewer': return rows.filter((t) => IMC_STAGE.includes(t.fromState));
    case 'encpc_reviewer': return rows.filter((t) => ENCPC_STAGE.includes(t.fromState));
    default: return rows;
  }
}

export function visibleDeficiencies(user: UserInternal, rows: DeficiencyRow[]): DeficiencyRow[] {
  switch (user.role) {
    case 'imc_reviewer': return rows.filter((d) => d.stage === 'IMC_REVIEW');
    case 'encpc_reviewer': return rows.filter((d) => d.stage === 'IMC_REVIEW' || d.stage === 'ENCPC_REVIEW');
    default: return rows;
  }
}
