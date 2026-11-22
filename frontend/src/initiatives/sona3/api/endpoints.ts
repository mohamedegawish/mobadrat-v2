// كل نداءات API الموقع — المكونات تستخدم api.* فقط.
import { apiFetch, apiFetchBlob, setAccessToken, clearTokens } from './client';
import type {
  ActionBody, ActionName, ApplicantProfile, ApplicationDetail, ApplicationListItem, AuditLogEntry, DocumentKind, Envelope, Expert, FormSection,
  ImpactReport, IntegrationKey, IntegrationScope, LoginRes, Meta, NotificationLogEntry, Organization, Page, Readiness, RegisterBody, ReportRow, ReportSheet,
  Role, Summary, User, WebhookLogEntry,
} from './schemas';

const V1 = '/api/v1';
const data = async <T>(p: Promise<Envelope<T>>): Promise<T> => (await p).data;
const enc = encodeURIComponent;

export interface ApplicationQuery {
  page?: number; pageSize?: number; q?: string; state?: string; governorate?: string; cohortId?: string; sector?: string; funderOrgId?: string;
  overdue?: '1'; mine?: '1'; sort?: 'score'; from?: string; to?: string;
}

export const api = {
  // ── المصادقة ──
  async login(email: string, password: string): Promise<LoginRes> {
    const r = await data(apiFetch<Envelope<LoginRes>>(`${V1}/auth/login`, { method: 'POST', body: { email, password } }));
    setAccessToken(r.accessToken);
    // The platform answers with the account; this initiative's view of the person (role, organization) is /auth/me.
    try { r.user = await api.me(); } catch { /* not enrolled in this initiative */ }
    return r;
  },
  register: (body: RegisterBody) =>
    apiFetch<Envelope<{ email: string }>>(`${V1}/auth/register`, { method: 'POST', body }),
  verifyEmail: (token: string) => apiFetch<Envelope<undefined>>(`${V1}/auth/verify-email`, { method: 'POST', body: { token } }),
  resendVerification: (email: string) => apiFetch<Envelope<undefined>>(`${V1}/auth/resend-verification`, { method: 'POST', body: { email } }),
  forgotPassword: (email: string) => apiFetch<Envelope<undefined>>(`${V1}/auth/forgot-password`, { method: 'POST', body: { email } }),
  resetPassword: (token: string, newPassword: string) => apiFetch<Envelope<undefined>>(`${V1}/auth/reset-password`, { method: 'POST', body: { token, newPassword } }),
  async changePassword(currentPassword: string, newPassword: string): Promise<LoginRes> {
    const r = await data(apiFetch<Envelope<LoginRes>>(`${V1}/auth/change-password`, { method: 'POST', body: { currentPassword, newPassword } }));
    setAccessToken(r.accessToken);
    try { r.user = await api.me(); } catch { /* keep */ }
    return r;
  },
  me: () => data(apiFetch<Envelope<{ user: User }>>(`${V1}/auth/me`)).then((d) => d.user),
  async logout(): Promise<void> {
    try { await apiFetch(`${V1}/auth/logout`, { method: 'POST', body: {} }); } finally { clearTokens(); }
  },

  // ── مرجعي ──
  meta: () => data(apiFetch<Envelope<Meta>>(`${V1}/meta`)),

  // ── المتقدم ──
  applicantProfile: () => data(apiFetch<Envelope<ApplicantProfile>>(`${V1}/applicant/profile`)),
  updateApplicantProfile: (fullName: string) => data(apiFetch<Envelope<{ id: string; fullName: string }>>(`${V1}/applicant/profile`, { method: 'PUT', body: { fullName } })),

  // ── الطلبات ──
  listApplications: (q: ApplicationQuery = {}) => data(apiFetch<Envelope<Page<ApplicationListItem>>>(`${V1}/applications`, { query: q as Record<string, string | number | undefined> })),
  createApplication: () => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications`, { method: 'POST', body: {} })),
  getApplication: (id: string) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${encodeURIComponent(id)}`)),
  saveSection: (id: string, section: FormSection, patch: Record<string, unknown>) =>
    data(apiFetch<Envelope<{ section: string; data: Record<string, unknown> }>>(`${V1}/applications/${encodeURIComponent(id)}/data/${section}`, { method: 'PUT', body: patch })),
  uploadDocument(id: string, kind: DocumentKind, file: File) {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file);
    return data(apiFetch<Envelope<{ id: string; version: number }>>(`${V1}/applications/${encodeURIComponent(id)}/documents`, { method: 'POST', formData: fd }));
  },
  removeDocument: (id: string, docId: string) => apiFetch<Envelope<undefined>>(`${V1}/applications/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' }),
  downloadDocument: (id: string, docId: string) => apiFetchBlob(`${V1}/applications/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}/download`),
  performAction: (id: string, action: ActionName, body: ActionBody) =>
    data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${encodeURIComponent(id)}/actions/${action}`, { method: 'POST', body })),

  // ── دليل الخبراء ومقدمي الخدمات ──
  listExperts: (status?: string) => data(apiFetch<Envelope<{ items: Expert[] }>>(`${V1}/experts`, { query: { status } })).then((d) => d.items),
  createExpert: (body: Partial<Expert>) => data(apiFetch<Envelope<Expert>>(`${V1}/experts`, { method: 'POST', body })),
  updateExpert: (id: string, body: Partial<Expert>) => data(apiFetch<Envelope<Expert>>(`${V1}/experts/${enc(id)}`, { method: 'PUT', body })),
  setExpertStatus: (id: string, op: 'approve' | 'suspend') => data(apiFetch<Envelope<Expert>>(`${V1}/experts/${enc(id)}/${op}`, { method: 'POST', body: {} })),

  listFunders: () => data(apiFetch<Envelope<{ items: Array<{ id: string; nameAr: string; nameEn: string }> }>>(`${V1}/funders`)).then((d) => d.items),
  listEvaluators: () => data(apiFetch<Envelope<{ items: Array<{ id: string; nameAr: string; email: string }> }>>(`${V1}/evaluators`)).then((d) => d.items),

  // ── التقييم (IMC / لجنة التقييم) ──
  cohortRanking: (cohortId: string) => data(apiFetch<Envelope<{ cohort: Record<string, unknown>; selected: number; items: Array<ApplicationListItem & { rank: number }> }>>(`${V1}/cohorts/${enc(cohortId)}/ranking`)),
  myEvaluations: () => data(apiFetch<Envelope<{ items: unknown[] }>>(`${V1}/evaluations/mine`)).then((d) => d.items),
  assignEvaluator: (id: string, body: Record<string, unknown>) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/evaluators`, { method: 'POST', body })),
  unassignEvaluator: (id: string, assignmentId: string, body: Record<string, unknown> = {}) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/evaluators/${enc(assignmentId)}`, { method: 'DELETE', body })),
  declareConflict: (id: string, body: Record<string, unknown>) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/evaluation/coi`, { method: 'POST', body })),
  saveEvaluation: (id: string, body: Record<string, unknown>) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/evaluation`, { method: 'PUT', body })),
  submitEvaluation: (id: string, body: Record<string, unknown> = {}) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/evaluation/submit`, { method: 'POST', body })),

  // ── التنفيذ والمتابعة (07–08) والتظلمات ──
  reportMilestone(id: string, milestoneId: string, note: string, file: File) {
    const fd = new FormData();
    fd.append('note', note);
    fd.append('file', file);
    return data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/milestones/${enc(milestoneId)}/report`, { method: 'POST', formData: fd }));
  },
  reviewMilestone: (id: string, milestoneId: string, body: { verified: boolean; note?: string }) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/milestones/${enc(milestoneId)}/review`, { method: 'POST', body })),
  disburseMilestone: (id: string, milestoneId: string, body: { reference: string }) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/milestones/${enc(milestoneId)}/disburse`, { method: 'POST', body })),
  submitImpactReport: (id: string, body: Omit<ImpactReport, 'id' | 'applicationId' | 'createdAt'>) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/impact-reports`, { method: 'POST', body })),
  markStalled: (id: string, body: { stalled: boolean; note?: string }) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/stalled`, { method: 'POST', body })),
  fileAppeal: (id: string, reason: string) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/appeal`, { method: 'POST', body: { reason } })),
  decideAppeal: (id: string, body: { accepted: boolean; note: string; expectedVersion?: number }) => data(apiFetch<Envelope<ApplicationDetail>>(`${V1}/applications/${enc(id)}/appeal/decision`, { method: 'POST', body })),

  // ── التقارير ──
  reportSummary: (q?: { cohortId?: string }) => data(apiFetch<Envelope<Summary>>(`${V1}/reports/summary`, { query: q })),
  reportApplications: () => data(apiFetch<Envelope<{ items: ReportRow[]; sheet: ReportSheet }>>(`${V1}/reports/applications`)),

  // ── الأدمن ──
  adminOrganizations: (type?: string) => data(apiFetch<Envelope<{ items: Organization[] }>>(`${V1}/admin/organizations`, { query: { type } })).then((d) => d.items),
  adminCreateOrganization: (body: { type: 'funder'; nameAr: string; nameEn: string; contactEmail?: string }) => data(apiFetch<Envelope<Organization>>(`${V1}/admin/organizations`, { method: 'POST', body })),
  adminReadiness: () => data(apiFetch<Envelope<Readiness>>(`${V1}/admin/readiness`)),
  adminRecoverEmail: (id: string, body: { newEmail: string; reason: string; requestReference: string }) =>
    data(apiFetch<Envelope<{ user: User }>>(`${V1}/admin/users/${encodeURIComponent(id)}/recover-email`, { method: 'POST', body })),
  adminUpdateOrganization: (id: string, body: Partial<Pick<Organization, 'nameAr' | 'nameEn' | 'contactEmail' | 'isActive'>> & { confirmOpenReferrals?: true }) =>
    data(apiFetch<Envelope<Organization>>(`${V1}/admin/organizations/${encodeURIComponent(id)}`, { method: 'PUT', body })),
  adminUsers: (q: { page?: number; q?: string; role?: string; organizationId?: string } = {}) => data(apiFetch<Envelope<Page<User>>>(`${V1}/admin/users`, { query: q })),
  adminCreateUser: (body: { email: string; nameAr: string; nameEn?: string; phone?: string; role: Role; organizationId: string }) =>
    data(apiFetch<Envelope<{ user: User; temporaryPassword: string }>>(`${V1}/admin/users`, { method: 'POST', body })),
  adminUpdateUser: (id: string, body: { nameAr?: string; nameEn?: string; phone?: string; isActive?: boolean; resetPassword?: true; confirmOpenReferrals?: true }) =>
    data(apiFetch<Envelope<{ user: User; temporaryPassword?: string }>>(`${V1}/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body })),
  adminAuditLogs: (q: { page?: number; pageSize?: number; q?: string; action?: string; from?: string; to?: string } = {}) =>
    data(apiFetch<Envelope<Page<AuditLogEntry>>>(`${V1}/admin/audit-logs`, { query: q })),
  adminLogAuditExport: (format: string, rows: number) => apiFetch(`${V1}/admin/audit-logs/export`, { method: 'POST', body: { format, rows } }),
  adminIntegrationKeys: () => data(apiFetch<Envelope<{ items: IntegrationKey[]; scopes: IntegrationScope[] }>>(`${V1}/admin/integration-keys`)),
  adminCreateIntegrationKey: (body: { name: string; scopes: IntegrationScope[]; rateLimitPerMinute: number }) =>
    data(apiFetch<Envelope<{ key: IntegrationKey; plaintextKey: string }>>(`${V1}/admin/integration-keys`, { method: 'POST', body })),
  adminRevokeIntegrationKey: (id: string) => data(apiFetch<Envelope<IntegrationKey>>(`${V1}/admin/integration-keys/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} })),
  adminRotateIntegrationKey: (id: string) =>
    data(apiFetch<Envelope<{ key: IntegrationKey; plaintextKey: string }>>(`${V1}/admin/integration-keys/${encodeURIComponent(id)}/rotate`, { method: 'POST', body: {} })),
  adminNotifications: (q: { page?: number; status?: string; channel?: string } = {}) => data(apiFetch<Envelope<Page<NotificationLogEntry>>>(`${V1}/admin/notifications`, { query: q })),
  adminRetryNotification: (id: string) => apiFetch(`${V1}/admin/notifications/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} }),
  adminWebhooks: (q: { page?: number; status?: string } = {}) => data(apiFetch<Envelope<Page<WebhookLogEntry>>>(`${V1}/admin/webhooks`, { query: q })),
  adminRetryWebhook: (id: string) => apiFetch(`${V1}/admin/webhooks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} }),
};
