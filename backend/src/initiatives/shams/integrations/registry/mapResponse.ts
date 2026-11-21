/**
 * تحويل طلب/استجابة خدمة السجل الصناعي — المكان الوحيد الذي يعرف شكل الـAPI الخارجي.
 * TODO(تكامل): مواصفات API السجل غير متوفرة بعد. الشكل أدناه افتراض مؤقت ويجب استبداله عند استلامها:
 *   GET {REGISTRY_API_URL}/registrations/{number}   Header: Authorization: Bearer {REGISTRY_API_KEY}
 *   200 { found: true, registration: { number, name, activity, governorate, status } }
 *   404 أو { found: false } → invalid
 *   أي شيء آخر (5xx، مهلة، شبكة، شكل غير متوقع) → unavailable (لا يُعامل أبدًا كـ valid)
 */
import type { RegistryResult } from './types.js';

export function buildRequest(baseUrl: string, apiKey: string, registryNumber: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/registrations/${encodeURIComponent(registryNumber)}`,
    init: { method: 'GET', headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } },
  };
}

export function mapResponse(registryNumber: string, status: number, body: unknown): RegistryResult {
  if (status === 404) return { result: 'invalid', errorCode: 'NOT_FOUND' };
  if (status !== 200 || typeof body !== 'object' || body === null) return { result: 'unavailable', errorCode: `HTTP_${status}` };
  const b = body as { found?: unknown; registration?: Record<string, unknown> };
  if (b.found === false) return { result: 'invalid', errorCode: 'NOT_FOUND' };
  if (b.found !== true || typeof b.registration !== 'object' || b.registration === null) return { result: 'unavailable', errorCode: 'UNEXPECTED_RESPONSE' };
  const r = b.registration;
  const s = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : undefined);
  if (typeof r.status === 'string' && /^(cancel|revok|inactive|suspend)/i.test(r.status)) return { result: 'invalid', errorCode: 'NOT_ACTIVE' };
  return {
    result: 'valid',
    facility: { registryNumber: s(r.number) ?? registryNumber, facilityName: s(r.name), activity: s(r.activity), governorate: s(r.governorate), status: s(r.status) },
  };
}
