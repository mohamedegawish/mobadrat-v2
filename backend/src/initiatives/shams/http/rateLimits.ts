/**
 * حدود الطلبات — مكان واحد للأرقام. RATE_LIMIT_SCALE يضاعفها (للاختبارات فقط؛ الإنتاج 1).
 */
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { config } from '../config.js';
import { rateLimitedBody } from './errors.js';

export const RATE_LIMITS = {
  login: { windowMs: 15 * 60_000, max: 50 },
  register: { windowMs: 15 * 60_000, max: 20 },
  emailFlow: { windowMs: 15 * 60_000, max: 20 },
  refresh: { windowMs: 60_000, max: 60 },
  publicRead: { windowMs: 60_000, max: 120 },
  upload: { windowMs: 60_000, max: 30 },
  actions: { windowMs: 60_000, max: 60 },
  registryCheck: { windowMs: 15 * 60_000, max: 20 },
} as const;

export function makeLimiter(name: keyof typeof RATE_LIMITS, extra: Partial<Options> = {}, ar?: string, en?: string) {
  const { windowMs, max } = RATE_LIMITS[name];
  return rateLimit({
    windowMs,
    limit: () => Math.max(1, Math.round(max * config.rateLimitScale)),
    standardHeaders: true,
    legacyHeaders: false,
    message: rateLimitedBody(ar, en),
    ...extra,
  });
}

/** مفتاح الحد بالمستخدم بعد المصادقة (لا بالـ IP)، مع fallback آمن لـ IPv6. */
export const byUser = (req: Request) => {
  const id = (req as Request & { user?: { id: string } }).user?.id;
  return id ? `u:${id}` : ipKeyGenerator(req.ip ?? '');
};
