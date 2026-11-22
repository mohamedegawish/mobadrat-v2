// نداءات واجهات الموظفين (IMC، المقيّم، جهة التمويل، الأدمن). ملف مستقل عن endpoints.ts حتى لا يتعارض مع واجهة المتقدم.
// نقاط النهاية المعلّمة [مفترضة] لم تُنشأ في الباك وقت الكتابة — الواجهات تتحمل غيابها (إدخال يدوي / رسالة واضحة).
import { apiFetch, apiFetchBlob } from './client';
import type {
  Cohort, Detail, Expert, ListItem, Meta, OrgRow, Page, Person, QueueRow, Ranking, Readiness, UserRow,
} from '../components/review/types';

const V1 = '/api/v1';
interface Env<T> { data: T }
async function d<T>(p: Promise<Env<T>>): Promise<T> { return (await p).data; }
const enc = encodeURIComponent;
type Q = Record<string, string | number | undefined>;

export interface StaffAppQuery {
  page?: number; pageSize?: number; q?: string; state?: string; mine?: '1'; overdue?: '1'; cohortId?: string;
  sector?: string; governorate?: string; funderOrgId?: string; sort?: 'score';
}
export interface EvalBody { scores: Record<string, number>; notes: Record<string, string>; recommendation: string }

export const staffApi = {
  meta: () => d(apiFetch<Env<Meta>>(`${V1}/meta`)),

  // ── الطلبات (مشترك) ──
  list: (q: StaffAppQuery = {}) => d(apiFetch<Env<Page<ListItem>>>(`${V1}/applications`, { query: q as Q })),
  get: (id: string) => d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}`)),
  action: (id: string, action: string, body: Record<string, unknown>) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/actions/${action}`, { method: 'POST', body })),
  download: (id: string, docId: string) => apiFetchBlob(`${V1}/applications/${enc(id)}/documents/${enc(docId)}/download`),
  uploadStaffDoc(id: string, kind: 'approvalFile' | 'fundingDecisionFile', file: File) {
    const fd = new FormData(); fd.append('kind', kind); fd.append('file', file);
    return d(apiFetch<Env<{ id: string }>>(`${V1}/applications/${enc(id)}/documents`, { method: 'POST', formData: fd }));
  },

  // ── IMC ──
  ranking: (cohortId: string) => d(apiFetch<Env<Ranking>>(`${V1}/cohorts/${enc(cohortId)}/ranking`)),
  assignEvaluator: (id: string, evaluatorUserId: string) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/evaluators`, { method: 'POST', body: { evaluatorUserId } })),
  unassignEvaluator: (id: string, assignmentId: string, reason: string) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/evaluators/${enc(assignmentId)}`, { method: 'DELETE', body: { reason } })),
  reviewMilestone: (id: string, mid: string, body: { verified: boolean; note?: string }) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/milestones/${enc(mid)}/review`, { method: 'POST', body })),
  markStalled: (id: string, body: { stalled: boolean; note?: string }) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/stalled`, { method: 'POST', body })),
  decideAppeal: (id: string, body: { accepted: boolean; note: string; expectedVersion: number }) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/appeal/decision`, { method: 'POST', body })),
  experts: (status?: string) => d(apiFetch<Env<{ items: Expert[] }>>(`${V1}/experts`, { query: { status } })).then((r) => r.items),
  createExpert: (body: Partial<Expert>) => d(apiFetch<Env<Expert>>(`${V1}/experts`, { method: 'POST', body })),
  updateExpert: (id: string, body: Partial<Expert>) => d(apiFetch<Env<Expert>>(`${V1}/experts/${enc(id)}`, { method: 'PUT', body })),
  setExpertStatus: (id: string, op: 'approve' | 'suspend') => d(apiFetch<Env<Expert>>(`${V1}/experts/${enc(id)}/${op}`, { method: 'POST', body: {} })),
  /** [مفترضة] المقيّمون النشطون — لإسنادهم من شاشة IMC. */
  evaluators: () => d(apiFetch<Env<{ items: Person[] }>>(`${V1}/evaluators`)).then((r) => r.items),
  /** [مفترضة] جهات التمويل النشطة — لإحالة الملف من شاشة IMC. */
  funders: () => d(apiFetch<Env<{ items: Array<{ id: string; nameAr: string; nameEn: string }> }>>(`${V1}/funders`)).then((r) => r.items),

  // ── المقيّم ──
  myAssignments: () => d(apiFetch<Env<{ items: QueueRow[] }>>(`${V1}/evaluations/mine`)).then((r) => r.items),
  declareCoi: (id: string, body: { hasConflict: boolean; note?: string }) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/evaluation/coi`, { method: 'POST', body })),
  saveEvaluation: (id: string, body: EvalBody) => d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/evaluation`, { method: 'PUT', body })),
  submitEvaluation: (id: string, body: EvalBody) => d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/evaluation/submit`, { method: 'POST', body })),

  // ── جهة التمويل ──
  disburse: (id: string, mid: string, reference: string) =>
    d(apiFetch<Env<Detail>>(`${V1}/applications/${enc(id)}/milestones/${enc(mid)}/disburse`, { method: 'POST', body: { reference } })),

  // ── الأدمن ──
  /** [مفترضة] دورات التقديم. */
  cohorts: () => d(apiFetch<Env<{ items: Cohort[] }>>(`${V1}/admin/cohorts`)).then((r) => r.items),
  createCohort: (body: Partial<Cohort>) => d(apiFetch<Env<Cohort>>(`${V1}/admin/cohorts`, { method: 'POST', body })),
  updateCohort: (id: string, body: Partial<Cohort>) => d(apiFetch<Env<Cohort>>(`${V1}/admin/cohorts/${enc(id)}`, { method: 'PUT', body })),
  readiness: () => d(apiFetch<Env<Readiness>>(`${V1}/admin/readiness`)),
  orgs: (type?: string) => d(apiFetch<Env<{ items: OrgRow[] }>>(`${V1}/admin/organizations`, { query: { type } })).then((r) => r.items),
  createOrg: (body: { type: string; nameAr: string; nameEn: string; contactEmail?: string }) =>
    d(apiFetch<Env<OrgRow>>(`${V1}/admin/organizations`, { method: 'POST', body })),
  updateOrg: (id: string, body: Partial<Pick<OrgRow, 'nameAr' | 'nameEn' | 'contactEmail' | 'isActive'>> & { confirmOpenReferrals?: true }) =>
    d(apiFetch<Env<OrgRow>>(`${V1}/admin/organizations/${enc(id)}`, { method: 'PUT', body })),
  users: (q: { page?: number; q?: string; role?: string; organizationId?: string } = {}) =>
    d(apiFetch<Env<Page<UserRow>>>(`${V1}/admin/users`, { query: q })),
  createUser: (body: { email: string; nameAr: string; nameEn?: string; phone?: string; role: string; organizationId: string }) =>
    d(apiFetch<Env<{ user: UserRow; temporaryPassword: string }>>(`${V1}/admin/users`, { method: 'POST', body })),
  updateUser: (id: string, body: { nameAr?: string; nameEn?: string; phone?: string; isActive?: boolean; resetPassword?: true; confirmOpenReferrals?: true }) =>
    d(apiFetch<Env<{ user: UserRow; temporaryPassword?: string }>>(`${V1}/admin/users/${enc(id)}`, { method: 'PUT', body })),
};
