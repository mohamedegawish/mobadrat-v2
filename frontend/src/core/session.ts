/**
 * The ONE browser session of the platform, shared by the platform screens and every initiative module:
 *  - the access token lives in memory only (never localStorage);
 *  - the refresh token is an httpOnly cookie the server rotates — refreshes are single-flight (two parallel refreshes of the
 *    same cookie would look like token theft and revoke the whole session family).
 * Initiative modules keep their original API paths (/api/v1/…); `modulePath` maps them onto the platform
 * (/api/v1/i/<module>/…, public endpoints under /public, account endpoints to the platform's /api/v1/auth/*).
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

let access: string | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null { return access; }
export function setAccessToken(t: string | null): void {
  if (t === access) return;
  access = t;
  listeners.forEach((l) => l(t));
}
export function clearTokens(): void { setAccessToken(null); }
export function onTokenChange(fn: (token: string | null) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

let refreshing: Promise<boolean> | null = null;

/** Silent session renewal through the refresh cookie (one shared request for concurrent callers). */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(new URL('/api/v1/auth/refresh', API_BASE || window.location.origin).toString(), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!res.ok) { setAccessToken(null); return false; }
      const j = (await res.json()) as { data?: { accessToken?: string } };
      if (!j.data?.accessToken) return false;
      setAccessToken(j.data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

/** Platform account endpoints (shared by every initiative). */
const CORE_AUTH = /^\/api\/v1\/auth\/(login|refresh|logout|verify-email|resend-verification|forgot-password|reset-password|change-password)(\/|$|\?)/;

/** Maps an initiative module's original API path onto the platform. */
export function modulePath(moduleId: string, path: string, publicPaths: string[] = ['/meta']): string {
  if (!path.startsWith('/api/v1')) return path;
  if (path.startsWith(`/api/v1/i/`)) return path;
  if (CORE_AUTH.test(path)) return path;
  const rest = path.slice('/api/v1'.length);
  if (rest === '/auth/register') return `/api/v1/i/${moduleId}/public/register`;
  if (rest.startsWith('/auth/recovery/')) return `/api/v1/i/${moduleId}/public${rest.slice('/auth'.length)}`;
  if (publicPaths.some((p) => rest === p || rest.startsWith(`${p}?`))) return `/api/v1/i/${moduleId}/public${rest}`;
  return `/api/v1/i/${moduleId}${rest}`;
}
