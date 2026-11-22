// كل نداءات API الموقع — المكونات تستخدم api.* فقط.
import { apiFetch, apiUpload, apiFetchBlob, setAccessToken, clearTokens } from './client';
import type {
  AccountRequest, RecoveryRequest, RoleDashboard, InboxNotification, RegistryDispute, RegistryObjection, ActionBody, ActionName, ApplicationDetail, ApplicationListItem, AuditLogEntry, DocumentKind, Envelope, FactoryProfile, FormSection,
  IntegrationKey, IntegrationScope, LoginRes, Meta, NotificationLogEntry, Organization, Page, Readiness, RegistryBlock, ReportRow, ReportSheet, Role, ServiceProvider, Summary, User,
  WebhookLogEntry,
} from './schemas';

const V1 = '/api/v1';
const data = async <T>(p: Promise<Envelope<T>>): Promise<T> => (await p).data;

export interface ApplicationQuery {
  page?: number; pageSize?: number; q?: string; state?: string; governorate?: string; bankOrgId?: string; overdue?: '1'; mine?: '1'; from?: string; to?: string; sort?: 'oldest';
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
  /** التسجيل بكل نموذج التسجيل: payload (الحساب + الأقسام) + المستندات بأسماء أنواعها، مع نسبة تقدم الرفع. */
  register: (payload: { companyName: string; contactName: string; email: string; mobile: string; password: string; application: Record<string, Record<string, unknown>> },
    files: Array<{ kind: string; file: File }>, onProgress?: (fraction: number) => void) => {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    for (const f of files) fd.append(f.kind, f.file, f.file.name);
    return apiUpload<Envelope<{ email: string }>>(`${V1}/auth/register`, fd, onProgress);
  },
  verifyEmail: (token: string) => apiFetch<Envelope<{ submitted?: boolean } | undefined>>(`${V1}/auth/verify-email`, { method: 'POST', body: { token } }),
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

  // ── المصنع ──
  factoryProfile: () => data(apiFetch<Envelope<FactoryProfile>>(`${V1}/factory/profile`)),

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

  // ── مقدمو الخدمة ──
  listProviders: (status?: string) => data(apiFetch<Envelope<{ items: ServiceProvider[] }>>(`${V1}/service-providers`, { query: { status } })).then((d) => d.items),
  createProvider: (body: Partial<ServiceProvider>) => data(apiFetch<Envelope<ServiceProvider>>(`${V1}/service-providers`, { method: 'POST', body })),
  updateProvider: (id: string, body: Partial<ServiceProvider>) => data(apiFetch<Envelope<ServiceProvider>>(`${V1}/service-providers/${encodeURIComponent(id)}`, { method: 'PUT', body })),
  /** الدليل كاملًا لـENCPC وPMU (بكل الحالات وحقل approvalRequired). */
  providerDirectory: () => data(apiFetch<Envelope<{ items: ServiceProvider[]; approvalRequired?: boolean }>>(`${V1}/service-providers`)),
  setProviderActive: (id: string, active: boolean) =>
    data(apiFetch<Envelope<ServiceProvider>>(`${V1}/service-providers/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`, { method: 'POST', body: {} })),
  uploadProviderLogo(id: string, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return data(apiFetch<Envelope<ServiceProvider>>(`${V1}/service-providers/${encodeURIComponent(id)}/logo`, { method: 'POST', formData: fd }));
  },
  setProviderStatus: (id: string, op: 'approve' | 'suspend') => data(apiFetch<Envelope<ServiceProvider>>(`${V1}/service-providers/${encodeURIComponent(id)}/${op}`, { method: 'POST', body: {} })),

  // ── صندوق الإشعارات ──
  notifications: (q: { page?: number; pageSize?: number; unread?: '1' } = {}) =>
    data(apiFetch<Envelope<Page<InboxNotification> & { unread: number }>>(`${V1}/notifications`, { query: q })),
  unreadNotifications: () => data(apiFetch<Envelope<{ unread: number }>>(`${V1}/notifications/unread-count`)),
  markNotificationRead: (id: string) => data(apiFetch<Envelope<{ unread: number }>>(`${V1}/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} })),
  markAllNotificationsRead: () => data(apiFetch<Envelope<{ changed: number; unread: number }>>(`${V1}/notifications/read-all`, { method: 'POST', body: {} })),

  roleDashboard: () => data(apiFetch<Envelope<RoleDashboard>>(`${V1}/dashboard`)),

  // ── التقارير ──
  reportSummary: () => data(apiFetch<Envelope<Summary>>(`${V1}/reports/summary`)),
  reportApplications: () => data(apiFetch<Envelope<{ items: ReportRow[]; sheet: ReportSheet }>>(`${V1}/reports/applications`)),
  registryBlocks: () => data(apiFetch<Envelope<{ items: RegistryBlock[] }>>(`${V1}/registry-blocks`)).then((d) => d.items),
  releaseRegistryBlock: (id: string, body: { reason: string; reference: string; allowedFactoryId: string }) => apiFetch(`${V1}/registry-blocks/${encodeURIComponent(id)}/release`, { method: 'POST', body }),

  // ── نزاعات أرقام السجل (القاعدة G) ──
  registryDisputes: () => data(apiFetch<Envelope<{ items: RegistryDispute[] }>>(`${V1}/registry-disputes`)).then((d) => d.items),
  decideRegistryDispute: (body: { registryNumber: string; allowedFactoryId: string; reason: string; reference: string }) =>
    data(apiFetch<Envelope<{ dispute: RegistryDispute | null; heldByOtherApplication: { id: string; number: string | null; companyName: string; state: string } | null }>>(`${V1}/registry-disputes/decide`, { method: 'POST', body })),
  registryObjections: () => data(apiFetch<Envelope<{ items: RegistryObjection[] }>>(`${V1}/registry-objections`)).then((d) => d.items),
  createRegistryObjection(registryNumber: string, note: string, file: File) {
    const fd = new FormData();
    fd.append('registryNumber', registryNumber); if (note) fd.append('note', note); fd.append('file', file);
    return data(apiFetch<Envelope<RegistryObjection>>(`${V1}/registry-objections`, { method: 'POST', formData: fd }));
  },
  registryObjectionDocument: (id: string) => apiFetchBlob(`${V1}/registry-objections/${encodeURIComponent(id)}/document`),
  decideRegistryObjection: (id: string, op: 'accept' | 'reject', body: { reason: string; reference: string }) =>
    data(apiFetch<Envelope<{ objection: RegistryObjection; heldByOtherApplication: { id: string; number: string | null; companyName: string; state: string } | null }>>(`${V1}/registry-objections/${encodeURIComponent(id)}/${op}`, { method: 'POST', body })),

  // ── الأدمن ──
  adminOrganizations: (type?: string) => data(apiFetch<Envelope<{ items: Organization[] }>>(`${V1}/admin/organizations`, { query: { type } })).then((d) => d.items),
  adminCreateOrganization: (body: { type: 'bank'; nameAr: string; nameEn: string; contactEmail?: string }) => data(apiFetch<Envelope<Organization>>(`${V1}/admin/organizations`, { method: 'POST', body })),
  adminReadiness: () => data(apiFetch<Envelope<Readiness>>(`${V1}/admin/readiness`)),
  /** H4: طلب استرداد بمستند PDF رسمي — لا يتغير شيء قبل موافقة PMU ومهلة الانتظار. */
  createRecoveryRequest(userId: string, f: { newEmail: string; reason: string; requestReference: string }, file: File) {
    const fd = new FormData();
    fd.append('userId', userId); fd.append('newEmail', f.newEmail); fd.append('reason', f.reason); fd.append('requestReference', f.requestReference);
    fd.append('file', file);
    return data(apiFetch<Envelope<RecoveryRequest>>(`${V1}/recovery-requests`, { method: 'POST', formData: fd }));
  },
  recoveryRequests: () => data(apiFetch<Envelope<{ items: RecoveryRequest[] }>>(`${V1}/recovery-requests`)).then((d) => d.items),
  recoveryDocument: (id: string) => apiFetchBlob(`${V1}/recovery-requests/${encodeURIComponent(id)}/document`),
  decideRecovery: (id: string, op: 'approve' | 'reject' | 'cancel', body: { note?: string; reason?: string } = {}) =>
    data(apiFetch<Envelope<RecoveryRequest>>(`${V1}/recovery-requests/${encodeURIComponent(id)}/${op}`, { method: 'POST', body })),
  cancelRecoveryByOwner: (token: string) => apiFetch<Envelope<undefined>>(`${V1}/auth/recovery/cancel`, { method: 'POST', body: { token } }),
  // ── طلبات الحسابات (H2) ──
  adminAccountRequests: () => data(apiFetch<Envelope<{ items: AccountRequest[] }>>(`${V1}/admin/account-requests`)).then((d) => d.items),
  accountRequests: () => data(apiFetch<Envelope<{ items: AccountRequest[] }>>(`${V1}/account-requests`)).then((d) => d.items),
  decideAccountRequest: (id: string, op: 'approve' | 'reject', note?: string) =>
    data(apiFetch<Envelope<AccountRequest>>(`${V1}/account-requests/${encodeURIComponent(id)}/${op}`, { method: 'POST', body: note ? { note } : {} })),
  adminResetPassword: (id: string) => apiFetch<Envelope<{ user: User }>>(`${V1}/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: {} }),
  // ── اعتماد مفاتيح الربط (H1) ──
  pendingIntegrationKeys: () => data(apiFetch<Envelope<{ items: IntegrationKey[] }>>(`${V1}/integration-keys/pending`)).then((d) => d.items),
  decideIntegrationKey: (id: string, op: 'approve' | 'reject', reason?: string) =>
    data(apiFetch<Envelope<IntegrationKey>>(`${V1}/integration-keys/${encodeURIComponent(id)}/${op}`, { method: 'POST', body: reason ? { reason } : {} })),
  adminUpdateOrganization: (id: string, body: Partial<Pick<Organization, 'nameAr' | 'nameEn' | 'contactEmail' | 'isActive'>> & { confirmOpenReferrals?: true }) =>
    data(apiFetch<Envelope<Organization>>(`${V1}/admin/organizations/${encodeURIComponent(id)}`, { method: 'PUT', body })),
  adminUsers: (q: { page?: number; q?: string; role?: string; organizationId?: string } = {}) => data(apiFetch<Envelope<Page<User>>>(`${V1}/admin/users`, { query: q })),
  /** H2: جهات القرار ← طلب معلق (request)؛ مدير نظام ← حساب مباشر برابط تعيين (user). لا كلمة مؤقتة في أي حال. */
  adminCreateUser: (body: { email: string; nameAr: string; nameEn?: string; phone?: string; role: Role; organizationId: string; reason?: string }) =>
    data(apiFetch<Envelope<{ user: User | null; request: AccountRequest | null }>>(`${V1}/admin/users`, { method: 'POST', body })),
  adminUpdateUser: (id: string, body: { nameAr?: string; nameEn?: string; phone?: string; isActive?: boolean; confirmOpenReferrals?: true }) =>
    data(apiFetch<Envelope<{ user: User }>>(`${V1}/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body })),
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
