import type { ApiError } from './schemas';
import { getAccessToken as sessionToken, setAccessToken as setSessionToken, clearTokens as clearSession, refreshSession as sharedRefresh, modulePath, API_BASE as PLATFORM_BASE } from '../../../core/session';

// Platform integration: the session (token + refresh) is the platform's single session; the module's original API paths
// are mapped onto /api/v1/i/shams/… (core/session.ts modulePath).
const MODULE_ID = 'shams';
const PUBLIC_PATHS = ["/meta"];
const mapPath = (p: string) => modulePath(MODULE_ID, p, PUBLIC_PATHS);
export function setAccessToken(t: string | null) { setSessionToken(t); }
export function getAccessToken(): string | null { return sessionToken(); }
export function clearTokens() { clearSession(); }
export const API_BASE: string = PLATFORM_BASE;

const tryRefresh = sharedRefresh;


// عميل fetch الوحيد في الواجهة — لا fetch مباشر خارج src/api.
// access token في الذاكرة فقط (لا localStorage)، وrefresh في كوكي httpOnly يديره السيرفر.

export class ApiException extends Error {
  apiError: ApiError;
  http: number;
  constructor(http: number, apiError: ApiError) {
    super(apiError.messageAr || apiError.code);
    this.http = http;
    this.apiError = apiError;
  }
}


export async function refreshSession(): Promise<boolean> {
  return tryRefresh();
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  formData?: FormData;
}

const NETWORK_ERROR: ApiError = { code: 'NETWORK_ERROR', messageAr: 'تعذر الاتصال بالخادم — تحقق من الاتصال وحاول مجددًا.', messageEn: 'Cannot reach the server. Check your connection and retry.' };

export async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE}${mapPath(path)}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { 'Accept-Language': document.documentElement.lang === 'en' ? 'en' : 'ar' };
  let hadToken = false;
  if (sessionToken()) { headers.Authorization = `Bearer ${sessionToken()}`; hadToken = true; }
  let body: BodyInit | undefined;
  if (opts.formData) body = opts.formData;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const doFetch = () => fetch(url.toString(), { method: opts.method ?? 'GET', headers, body, credentials: 'include' });
  let res: Response;
  try { res = await doFetch(); } catch { throw new ApiException(0, NETWORK_ERROR); }
  const isAuthPath = /^\/api\/v1\/auth\/(login|refresh|logout)/.test(path);
  if (res.status === 401 && hadToken && !isAuthPath) {
    if (await tryRefresh() && sessionToken()) {
      headers.Authorization = `Bearer ${sessionToken()}`;
      try { res = await doFetch(); } catch { throw new ApiException(0, NETWORK_ERROR); }
    }
  }
  if (!res.ok) {
    let parsed: ApiError = { code: `HTTP_${res.status}`, messageAr: 'حدث خطأ في الاتصال بالخادم.', messageEn: `Request failed with ${res.status}.` };
    try { parsed = (await res.json()) as ApiError; } catch { /* keep default */ }
    throw new ApiException(res.status, parsed);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

/** تنزيل ملف بنفس المصادقة (التوكن في الذاكرة فلا يكفي رابط <a href>). */
export async function apiFetchBlob(path: string, query: Record<string, string> = {}): Promise<Blob> {
  const url = new URL(`${API_BASE}${mapPath(path)}`, window.location.origin);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  let hadToken = false;
  if (sessionToken()) { headers.Authorization = `Bearer ${sessionToken()}`; hadToken = true; }
  const doFetch = () => fetch(url.toString(), { headers, credentials: 'include' });
  let res = await doFetch();
  if (res.status === 401 && hadToken && await tryRefresh() && sessionToken()) {
    headers.Authorization = `Bearer ${sessionToken()}`;
    res = await doFetch();
  }
  if (!res.ok) {
    let parsed: ApiError = { code: `HTTP_${res.status}`, messageAr: 'تعذر تنزيل الملف.', messageEn: `Download failed with ${res.status}.` };
    try { parsed = (await res.json()) as ApiError; } catch { /* keep default */ }
    throw new ApiException(res.status, parsed);
  }
  return res.blob();
}

/**
 * رفع multipart مع نسبة تقدم (XHR — fetch لا يعطي تقدم الرفع). للتسجيل بالمستندات: طلب عام بلا توكن.
 * الأخطاء بنفس شكل apiFetch (ApiException).
 */
export function apiUpload<T>(path: string, formData: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', new URL(`${API_BASE}${mapPath(path)}`, window.location.origin).toString());
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiException(0, NETWORK_ERROR));
    xhr.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(body as T); return; }
      const err = body && typeof body === 'object' && 'code' in body ? (body as ApiError)
        : { code: 'HTTP_ERROR', messageAr: `تعذر إتمام الطلب (${xhr.status}).`, messageEn: `Request failed (${xhr.status}).` };
      reject(new ApiException(xhr.status, err));
    };
    xhr.send(formData);
  });
}
