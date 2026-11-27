// تهيئة بيانات عبر API لاختبارات لا تهدف لتجربة المعالج نفسه (المعالج له اختباره في journey.spec).
import type { APIRequestContext } from '@playwright/test';
import { PASSWORD, pdfFile } from './helpers';

type Result = { status: number; json: any };
export interface ApiSession {
  token: string;
  get: (p: string) => Promise<any>;
  post: (p: string, body?: unknown) => Promise<Result>;
  put: (p: string, body: unknown) => Promise<Result>;
  upload: (p: string, kind: string, name: string) => Promise<number>;
}

export async function apiLogin(request: APIRequestContext, email: string, password = PASSWORD): Promise<ApiSession> {
  const r = await request.post('/api/v1/auth/login', { data: { email, password } });
  if (!r.ok()) throw new Error(`api login ${email}: ${r.status()}`);
  const token = (await r.json()).data.accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  return {
    token,
    get: async (p) => (await (await request.get(`/api/v1/i/shams${p}`, { headers })).json()).data,
    post: async (p, body = {}) => { const x = await request.post(`/api/v1/i/shams${p}`, { headers, data: body }); return { status: x.status(), json: await x.json() }; },
    put: async (p, body) => { const x = await request.put(`/api/v1/i/shams${p}`, { headers, data: body }); return { status: x.status(), json: await x.json() }; },
    upload: async (p, kind, name) => (await request.post(`/api/v1/i/shams${p}`, { headers, multipart: { kind, file: pdfFile(name) } })).status(),
  };
}

/** يسحب أي طلب مفتوح للمصنع (الانسحاب) ليبدأ الاختبار من حال نظيفة. */
export async function closeOpenApplication(s: ApiSession): Promise<void> {
  const open = (await s.get('/factory/profile')).openApplicationId as string | null;
  if (!open) return;
  const app = await s.get(`/applications/${open}`);
  const r = await s.post(`/applications/${open}/actions/withdraw`, { expectedVersion: app.version, reason: 'تنظيف قبل الاختبار' });
  if (r.status !== 200) throw new Error(`cleanup withdraw failed ${r.status}`);
}

/** مسودة مكتملة (بيانات + مستندات) برقم سجل محدد؛ ترجع المعرف. */
export async function seedCompleteDraft(s: ApiSession, regNumber: string): Promise<string> {
  const created = await s.post('/applications', {});
  const id = created.json.data.id as string;
  const sections = {
    general: { companyName: 'مصنع تجريبي للصناعات المعدنية', governorate: 'sharqia', industrialZone: '10th-ramadan', address: 'المنطقة الصناعية الثالثة', phone1: '0221234567' },
    contact: { contactName: 'م. أحمد', contactTitle: 'مدير المصنع', contactMobile: '01012345678', contactEmail: 'contact@factory.test' },
    company: { commercialRegisterNumber: 'CR-12345', industrialRegistryNumber: regNumber, taxNumber: '123-456-789' },
    engineering: { roofAreas: [{ name: 'السطح الرئيسي', area: 1500 }], contractedCapacity: 1000, capacityUnit: 'kVA', peakLoad: 750, loadUnit: 'kW', ownershipType: 'owned', ownershipExpiresAt: '2040-12-31' },
  };
  for (const [section, data] of Object.entries(sections)) {
    const r = await s.put(`/applications/${id}/data/${section}`, data);
    if (r.status !== 200) throw new Error(`save ${section}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  for (const kind of ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'ownershipProofFile']) {
    if ((await s.upload(`/applications/${id}/documents`, kind, `${kind}.pdf`)) !== 201) throw new Error(`upload ${kind}`);
  }
  for (let i = 0; i < 2; i++) if ((await s.upload(`/applications/${id}/documents`, 'electricityBill', `bill-${i}.pdf`)) !== 201) throw new Error('upload bill');
  return id;
}

export async function submitApplication(s: ApiSession, id: string): Promise<Result> {
  const app = await s.get(`/applications/${id}`);
  return s.post(`/applications/${id}/actions/submit`, { expectedVersion: app.version });
}

export const PROVIDERS_LINK = 'https://encpc.example.eg/providers';
export const PROVIDER_INFO = { providerName: 'شركة طاقة (اختبار)', providerEmail: 'offers@provider.test' };

/** ينفذ إجراء على طلب بنسخته الحالية. ENCPC's link and the offer's provider are filled in unless the test passes its own. */
export async function act(s: ApiSession, id: string, action: string, body: Record<string, unknown> = {}): Promise<Result> {
  const app = await s.get(`/applications/${id}`);
  const offer = action === 'submit_offer' || (action === 'resubmit' && app.state === 'OFFER_CORRECTION');
  const defaults = action === 'compliant' ? { providersLink: PROVIDERS_LINK } : offer ? PROVIDER_INFO : {};
  return s.post(`/applications/${id}/actions/${action}`, { expectedVersion: app.version, ...defaults, ...body });
}

/** D18: the Ministry of Electricity uploads its approval and accepts. */
export async function electricityAccept(request: APIRequestContext, id: string): Promise<Result> {
  const ministry = await apiLogin(request, 'electricity@shams.local');
  if ((await ministry.upload(`/applications/${id}/documents`, 'electricityApprovalFile', 'approval.pdf')) !== 201) throw new Error('approval upload');
  return act(ministry, id, 'accept', { distributionCompany: 'شركة توزيع (اختبار)' });
}
