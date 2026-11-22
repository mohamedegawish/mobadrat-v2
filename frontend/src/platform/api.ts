/** The platform's API client (the only fetch of the platform screens). Uses the shared session (core/session.ts). */
import { API_BASE, getAccessToken, refreshSession, setAccessToken, clearTokens } from '../core/session';

export interface ApiErrorBody { code: string; messageAr: string; messageEn: string; details?: Array<{ field: string; issue: string }> }

export class ApiError extends Error {
  constructor(public http: number, public body: ApiErrorBody) { super(body.messageAr || body.code); }
}

const NETWORK: ApiErrorBody = { code: 'NETWORK_ERROR', messageAr: 'تعذر الاتصال بالخادم — تحقق من الاتصال وحاول مجددًا.', messageEn: 'Cannot reach the server. Check your connection and retry.' };

type Opts = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; query?: Record<string, string | number | undefined>; form?: FormData };

export async function call<T>(path: string, opts: Opts = {}): Promise<T> {
  const url = new URL(`${API_BASE}/api/v1${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const run = async () => {
    const headers: Record<string, string> = {};
    const t = getAccessToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    return fetch(url.toString(), { method: opts.method ?? 'GET', headers, body, credentials: 'include' });
  };
  let res: Response;
  try { res = await run(); } catch { throw new ApiError(0, NETWORK); }
  if (res.status === 401 && getAccessToken() && !path.startsWith('/auth/')) {
    if (await refreshSession()) { try { res = await run(); } catch { throw new ApiError(0, NETWORK); } }
  }
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) throw new ApiError(res.status, json ?? { code: `HTTP_${res.status}`, messageAr: 'حدث خطأ في الاتصال بالخادم.', messageEn: `Request failed (${res.status}).` });
  return (json?.data ?? json) as T;
}

export async function download(path: string): Promise<Blob> {
  const url = new URL(`${API_BASE}/api/v1${path}`, window.location.origin);
  const res = await fetch(url.toString(), { headers: getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}, credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, { code: 'DOWNLOAD_FAILED', messageAr: 'تعذر تنزيل الملف.', messageEn: 'Download failed.' });
  return res.blob();
}

// ── Types ───────────────────────────────────────────────────────────────

export type Lang = 'ar' | 'en';
export interface CoreUser { id: string; email: string; nameAr: string; nameEn: string; phone: string; platformRole: string | null; mustChangePassword: boolean; emailVerified: boolean }
export interface HubCard { statusAr: string; statusEn: string; nextActionAr?: string; nextActionEn?: string; view: string; tone?: string; applicationNumber?: string | null }
export interface MembershipItem {
  initiativeId: string; slug: string; titleAr: string; titleEn: string; themeColor: string; accentColor: string; role: string; roleKind: string;
  roleLabelAr: string; roleLabelEn: string; status: string; access: { status: string; code?: string; messageAr?: string; messageEn?: string };
  card: HubCard | null; defaultView: string; unread: number;
}
export interface Me {
  user: CoreUser; platformRoleLabel: { ar: string; en: string } | null; memberships: MembershipItem[];
  adminEntries: Array<{ initiativeId: string; defaultView: string; titleAr: string; titleEn: string }>; unreadTotal: number;
  profile: { personUpdatedAt: string | null; factories: number };
}
export interface Initiative {
  id: string; slug: string; moduleId: string | null; titleAr: string; titleEn: string; taglineAr: string; taglineEn: string; descriptionAr: string; descriptionEn: string;
  category: string; categoryEn: string; status: string; registrationOpen: boolean; coverImage: string; logoImage: string; themeColor: string; accentColor: string;
  badgeTextAr: string; badgeTextEn: string; startDate: string; endDate: string; budgetTotalEGP: number; targetSectors: string[]; targetGovernorates: string[];
  benefits: Array<Record<string, string>>; faqs: Array<Record<string, string>>; objectives: Array<Record<string, string> | string>; eligibilityRequirements: Array<Record<string, string> | string>;
  selectionCriteria: Array<Record<string, string> | string>; requiredDocsList: Array<Record<string, string> | string>; participatingOrgs: Array<Record<string, string> | string>;
  financialTerms: Record<string, unknown>; executionNotesAr: string; executionNotesEn: string; sortOrder: number;
  hasModule: boolean; subject: 'person' | 'factory' | null; registerView: string | null; moduleStepsAr: string[]; moduleStepsEn: string[];
}
export interface Option { value: string; labelAr: string; labelEn: string }
export interface Governorate extends Option { zones: Option[] }
export interface ProfileField {
  key: string; scope: 'person' | 'factory'; type: string; labelAr: string; labelEn: string; max?: number;
  options?: Option[] | 'governorates' | 'zones'; dependsOn?: string; hintAr?: string; hintEn?: string;
}
export interface ProfileMeta { fields: ProfileField[]; documentKinds: Array<{ kind: string; scope: 'person' | 'factory'; labelAr: string; labelEn: string }>; governorates: Governorate[] }
export interface ProfileDoc { id: string; kind: string; originalName: string; sizeBytes: number; createdAt: string; version: number }
export interface RequirementItem extends ProfileField { required: boolean; filled: boolean; value: unknown }
export interface Requirements {
  initiativeId: string; titleAr: string; titleEn: string; enrolled: boolean; membershipStatus: string | null; defaultView: string | null;
  subject: 'person' | 'factory'; factoryOptions: Array<{ id: string; companyName: string }>; selectedFactoryId: string | null; needsFactory: boolean;
  fields: RequirementItem[]; documents: Array<{ kind: string; scope: string; labelAr: string; labelEn: string; required: boolean; filled: boolean; document: ProfileDoc | null }>;
  missing: RequirementItem[]; missingDocuments: Array<{ kind: string; scope: string; labelAr: string; labelEn: string; required: boolean }>;
  blockers: Array<{ code: string; messageAr: string; messageEn: string }>; complete: boolean; moduleStepsAr: string[]; moduleStepsEn: string[];
}
export interface Banner {
  id: string; imageUrl: string; titleAr: string; titleEn: string; subtitleAr: string; subtitleEn: string; ctaLabelAr: string; ctaLabelEn: string;
  linkType: 'none' | 'initiative' | 'url'; linkTarget: string; placement: string; sortOrder: number; active: boolean; startsAt: string; endsAt: string;
}
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

// ── Endpoints ───────────────────────────────────────────────────────────

export const api = {
  async login(email: string, password: string) {
    const d = await call<{ accessToken: string; user: CoreUser }>('/auth/login', { method: 'POST', body: { email, password } });
    setAccessToken(d.accessToken);
    return d.user;
  },
  async logout() { try { await call('/auth/logout', { method: 'POST', body: {} }); } finally { clearTokens(); } },
  register: (b: { fullName: string; email: string; mobile: string; password: string }) => call<{ email: string }>('/auth/register', { method: 'POST', body: b }),
  verifyEmail: (token: string) => call<Record<string, unknown> | undefined>('/auth/verify-email', { method: 'POST', body: { token } }),
  resendVerification: (email: string) => call('/auth/resend-verification', { method: 'POST', body: { email } }),
  forgotPassword: (email: string) => call('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token: string, newPassword: string) => call('/auth/reset-password', { method: 'POST', body: { token, newPassword } }),
  async changePassword(currentPassword: string, newPassword: string) {
    const d = await call<{ accessToken: string }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    setAccessToken(d.accessToken);
  },
  me: () => call<Me>('/me'),

  initiatives: () => call<Initiative[]>('/initiatives'),
  initiative: (slug: string) => call<Initiative>(`/initiatives/${encodeURIComponent(slug)}`),
  banners: () => call<Banner[]>('/highlights'),
  impact: () => call<{ totals: { applications: number; positiveOutcome: number; open: number }; byGovernorate: Array<{ governorate: string; count: number }>; initiatives: Array<{ initiativeId: string; titleAr: string; titleEn: string; themeColor: string; applications: number; positiveOutcome: number; kpis: Array<{ key: string; labelAr: string; labelEn: string; value: number; unit?: string }> }> }>('/catalog/impact'),

  profileMeta: () => call<ProfileMeta>('/meta/profile'),
  profile: () => call<{ values: Record<string, unknown>; documents: ProfileDoc[]; email: string }>('/me/profile'),
  saveProfile: (values: Record<string, unknown>) => call<{ values: Record<string, unknown> }>('/me/profile', { method: 'PUT', body: { values } }),
  factories: () => call<{ items: Array<{ id: string; role: string; values: Record<string, unknown>; documents: ProfileDoc[] }> }>('/me/factories').then((d) => d.items),
  createFactory: (values: Record<string, unknown>) => call<{ id: string }>('/me/factories', { method: 'POST', body: { values } }),
  saveFactory: (id: string, values: Record<string, unknown>) => call<{ id: string }>(`/me/factories/${encodeURIComponent(id)}`, { method: 'PUT', body: { values } }),
  uploadDocument(kind: string, file: File, ownerId?: string) {
    const fd = new FormData();
    fd.append('kind', kind);
    if (ownerId) fd.append('ownerId', ownerId);
    fd.append('file', file, file.name);
    return call<ProfileDoc>('/me/profile-documents', { method: 'POST', form: fd });
  },
  downloadDocument: (id: string) => download(`/me/profile-documents/${encodeURIComponent(id)}/download`),
  requirements: (slug: string, factoryId?: string | null) => call<Requirements>(`/me/initiatives/${encodeURIComponent(slug)}/requirements`, { query: { factoryId: factoryId ?? undefined } }),
  enroll: (slug: string, factoryId?: string | null) => call<{ initiativeId: string; view: string; applicationId?: string; alreadyEnrolled?: boolean }>(`/me/initiatives/${encodeURIComponent(slug)}/enroll`, { method: 'POST', body: factoryId ? { factoryId } : {} }),

  notifications: (page = 1, unread = false) => call<Page<{ id: string; initiativeId: string | null; title: string; body: string; link: string; readAt: string | null; createdAt: string }> & { unread: number }>('/me/notifications', { query: { page, unread: unread ? '1' : undefined } }),
  markRead: (id: string) => call(`/me/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} }),
  markAllRead: () => call('/me/notifications/read-all', { method: 'POST', body: {} }),

  // admin
  adminStats: (q: { from?: string; to?: string } = {}) => call<AdminStats>('/admin/stats', { query: q }),
  adminInitiativeStats: (id: string) => call<AdminInitiativeStats>('/admin/stats/' + encodeURIComponent(id)),
  adminBodies: (q: { q?: string; kind?: string; status?: string; initiativeId?: string } = {}) => call<{ items: PlatformBody[] } & BodiesMeta>('/admin/bodies', { query: q }),
  adminBody: (id: string) => call<PlatformBodyDetail>('/admin/bodies/' + encodeURIComponent(id)),
  adminBodyOrganizations: () => call<BodyOrganizations>('/admin/bodies/organizations'),
  adminCreateBody: (b: BodyInput & { links?: Array<{ initiativeId: string; organizationId: string }> }) => call<PlatformBody>('/admin/bodies', { method: 'POST', body: b }),
  adminUpdateBody: (id: string, b: Partial<BodyInput> & { isActive?: boolean }) => call<PlatformBody>('/admin/bodies/' + encodeURIComponent(id), { method: 'PUT', body: b }),
  adminDeleteBody: (id: string) => call<unknown>('/admin/bodies/' + encodeURIComponent(id), { method: 'DELETE' }),
  adminLinkBody: (id: string, l: { initiativeId: string; organizationId: string }) => call<PlatformBody>(`/admin/bodies/${encodeURIComponent(id)}/links`, { method: 'POST', body: l }),
  adminUnlinkBody: (id: string, initiativeId: string) => call<PlatformBody>(`/admin/bodies/${encodeURIComponent(id)}/links/${encodeURIComponent(initiativeId)}`, { method: 'DELETE' }),
  adminActivity: () => call<{ items: Array<{ at: string; initiativeId: string; titleAr: string; titleEn: string; labelAr: string; labelEn: string; view: string }> }>('/admin/activity', { query: { limit: 30 } }),
  adminModules: () => call<{ items: Array<{ id: string; titleAr: string; titleEn: string; staffEntryPoints: Array<{ view: string; labelAr: string; labelEn: string }>; defaultAdminView: string }>; platformRoles: Array<{ key: string; ar: string; en: string }> }>('/admin/modules'),
  adminUsers: (q: { q?: string; page?: number; platformRole?: string; initiativeId?: string }) => call<Page<AdminUser>>('/admin/users', { query: q }),
  adminCreateUser: (b: { email: string; nameAr: string; nameEn?: string; phone?: string; platformRole: string }) => call<AdminUser>('/admin/users', { method: 'POST', body: b }),
  adminUpdateUser: (id: string, b: Record<string, unknown>) => call<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: b }),
  adminResetPassword: (id: string) => call(`/admin/users/${encodeURIComponent(id)}/reset-password`, { method: 'POST', body: {} }),
  adminMembership: (id: string, status: 'active' | 'suspended') => call<AdminUser>(`/admin/memberships/${encodeURIComponent(id)}`, { method: 'PUT', body: { status } }),
  adminCatalog: () => call<{ items: Initiative[]; modules: Array<{ id: string; titleAr: string }> }>('/admin/catalog'),
  adminSaveCatalog: (id: string, b: Record<string, unknown>) => call<Initiative>(`/admin/catalog/${encodeURIComponent(id)}`, { method: 'PUT', body: b }),
  adminCreateCatalog: (b: Record<string, unknown>) => call<Initiative>('/admin/catalog', { method: 'POST', body: b }),
  adminBanners: () => call<Banner[]>('/admin/highlights'),
  adminSaveBanner: (id: string | null, b: Record<string, unknown>) => (id ? call<Banner>(`/admin/highlights/${encodeURIComponent(id)}`, { method: 'PUT', body: b }) : call<Banner>('/admin/highlights', { method: 'POST', body: b })),
  adminDeleteBanner: (id: string) => call(`/admin/highlights/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  adminAudit: (q: { page?: number; initiativeId?: string; q?: string }) => call<Page<{ id: string; at: string; initiativeId: string | null; actorName: string; actorRole: string; action: string; summaryAr: string; ip: string }>>('/admin/audit-logs', { query: q }),
  adminAuditExport: (initiativeId?: string) => download(`/admin/audit-logs/export${initiativeId ? `?initiativeId=${encodeURIComponent(initiativeId)}` : ''}`),
  adminOutbox: (q: { page?: number; status?: string; initiativeId?: string }) => call<Page<{ id: string; initiativeId: string | null; channel: string; templateKey: string; recipientAddress: string; subject: string; status: string; skipReason: string; attempts: number; lastError: string; createdAt: string }>>('/admin/notifications', { query: q }),
  adminRetry: (id: string) => call(`/admin/notifications/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} }),
  adminReadiness: () => call<{ core: Array<{ key: string; ok: boolean; labelAr: string; labelEn: string; detail?: string }>; modules: Array<{ initiativeId: string; titleAr: string; titleEn: string; checks: Array<{ key: string; ok: boolean; labelAr: string; labelEn: string; detail?: string }> }> }>('/admin/readiness'),
};

export interface AdminUser {
  id: string; email: string; nameAr: string; nameEn: string; phone: string; platformRole: string | null; isActive: boolean; emailVerified: boolean; lastLoginAt: string | null; createdAt: string;
  memberships: Array<{ id: string; initiativeId: string; role: string; status: string; titleAr: string; titleEn: string; roleLabelAr: string; roleLabelEn: string; roleKind: string }>;
}

export interface StatsSummary {
  totals: { applicants: number; applications: number; drafts: number; open: number; positiveOutcome: number; negativeOutcome: number; withdrawn: number; overdue: number };
  byPhase: Record<string, number>;
  byState: Array<{ key: string; labelAr: string; labelEn: string; count: number; phase: string }>;
  funnel: Array<{ key: string; labelAr: string; labelEn: string; count: number }>;
  byGovernorate: Array<{ governorate: string; count: number }>;
  money?: { requestedEGP?: number; approvedEGP?: number; investmentEGP?: number; disbursedEGP?: number };
  jobs?: { expected?: number; actual?: number };
  kpis: Array<{ key: string; labelAr: string; labelEn: string; value: number; unit?: string }>;
  timeline: Array<{ month: string; submitted: number; closed: number }>;
}
export type AdminInitiativeStats = AdminStats['initiatives'][number] & { staffEntryPoints: Array<{ view: string; labelAr: string; labelEn: string }> };

// ── The unified directory of bodies ──
export interface BodyActivity { staff: number; decisions: number; pending: number; lastActivityAt: string | null }
export interface ModuleBody { id: string; type: string; typeLabelAr: string; typeLabelEn: string; nameAr: string; nameEn: string; isActive: boolean }
export interface BodyLinkView {
  initiativeId: string; titleAr: string; titleEn: string; organizationId: string; organization: ModuleBody | null; missing: boolean;
  activity: BodyActivity | null; linkedAt: string;
}
export interface BodyInput { nameAr: string; nameEn?: string; kind: string; description?: string; contactEmail?: string; contactPhone?: string; website?: string }
export interface PlatformBody extends Required<BodyInput> {
  id: string; kindLabelAr: string; kindLabelEn: string; isActive: boolean; createdAt: string; updatedAt: string;
  links: BodyLinkView[]; totals: BodyActivity & { initiatives: number };
}
export interface BodiesMeta { kinds: Array<{ key: string; labelAr: string; labelEn: string }>; initiatives: Array<{ id: string; titleAr: string; titleEn: string }> }
export interface PlatformBodyDetail extends PlatformBody, BodiesMeta {
  people: Array<{ userId: string; nameAr: string; email: string; isActive: boolean; initiativeId: string; titleAr: string; role: string; roleLabelAr: string; roleLabelEn: string; status: string }>;
}
export interface BodyOrganizations extends BodiesMeta {
  items: Array<{ initiativeId: string; titleAr: string; titleEn: string; organization: ModuleBody; body: { id: string; nameAr: string; nameEn: string } | null }>;
  suggestions: Array<{ nameAr: string; nameEn: string; organizations: Array<{ initiativeId: string; titleAr: string; organizationId: string; nameAr: string }> }>;
}

export interface AdminStats {
  generatedAt: string;
  platform: { accounts: number; platformStaff: number; multiInitiativeAccounts: number; initiatives: number };
  totals: StatsSummary['totals']; byPhase: Record<string, number>;
  byGovernorate: Array<{ governorate: string; count: number }>; timeline: Array<{ month: string; submitted: number; closed: number }>;
  initiatives: Array<{ initiativeId: string; titleAr: string; titleEn: string; themeColor: string; status: string; summary: StatsSummary | null; error?: string }>;
}

export function errText(e: unknown, isAr: boolean): string {
  if (e instanceof ApiError) return isAr ? e.body.messageAr : e.body.messageEn;
  return isAr ? 'حدث خطأ غير متوقع.' : 'Unexpected error.';
}

export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (e instanceof ApiError) for (const d of e.body.details ?? []) out[d.field] = d.issue;
  return out;
}
