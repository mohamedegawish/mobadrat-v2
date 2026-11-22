/**
 * The platform HTTP application: the core (public site, accounts, profiles, catalog, unified admin) + every registered
 * initiative module mounted under /api/v1/i/<id>.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { isDbBusy } from './core/db/index.js';
import { auth, moduleAuth, requirePasswordChanged } from './core/middleware/auth.js';
import { ah, apiError, AppError, rateLimitedBody } from './core/http/errors.js';
import { makeLimiter } from './core/http/rateLimits.js';
import { healthHandler, healthRouter } from './core/routes/health.js';
import { authRouter } from './core/routes/auth.js';
import { meRouter, profileMetaRouter } from './core/routes/me.js';
import { adminCatalogRouter, publicCatalogRouter } from './core/routes/catalog.js';
import { adminRouter } from './core/routes/admin.js';
import { bodiesRouter } from './core/routes/bodies.js';
import { MODULES } from './initiatives/registry.js';
import type { ModuleContext } from './initiatives/contract.js';

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: config.isProd ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        frameSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: config.corsOrigin.includes('*') ? false : config.corsOrigin, credentials: true }));
  morgan.token('path', (req) => (req as express.Request).path ?? '');
  if (!config.isTest) app.use(morgan(':remote-addr [:date[iso]] ":method :path" :status :res[content-length] - :response-time ms'));
  app.use(cookieParser());
  app.use(express.json({ limit: config.jsonLimit }));

  app.get('/health', ah(healthHandler));

  const ctx: ModuleContext = { appUrl: config.appUrl };
  const v1 = express.Router();
  v1.use(healthRouter);
  v1.use('/meta', makeLimiter('publicRead'));
  v1.use(profileMetaRouter);
  v1.use(publicCatalogRouter);
  v1.use(authRouter); // public (own limits per route) + /auth/me and /auth/change-password protected inside
  // Each initiative's public endpoints (registration with its own form, public metadata).
  for (const m of MODULES) {
    const pub = m.publicRouter?.(ctx);
    if (pub) v1.use(`/i/${m.id}/public`, pub);
  }
  v1.use(rateLimit({ windowMs: config.rateWindowMs, limit: () => Math.round(config.rateMax * config.rateLimitScale), standardHeaders: true, legacyHeaders: false, message: rateLimitedBody() }));
  v1.use(auth);
  v1.use(requirePasswordChanged);
  v1.use(meRouter);
  v1.use(adminCatalogRouter);
  v1.use(adminRouter);
  v1.use(bodiesRouter);
  for (const m of MODULES) v1.use(`/i/${m.id}`, moduleAuth(m), m.router(ctx));
  app.use('/api/v1', v1);
  app.use('/api/v1', (req, res) => apiError(res, 404, 'NOT_FOUND', 'المسار غير موجود.', `Route not found: ${req.method} ${req.path}`));

  // Each initiative's integration API (its own API keys, not JWT).
  for (const m of MODULES) {
    const r = m.integrationRouter?.(ctx);
    if (r) app.use(`/api/integration/v1/i/${m.id}`, r);
  }

  // One container: the backend serves the built frontend on the same origin.
  const serveSpa = config.serveFrontend && fs.existsSync(path.join(config.frontendDist, 'index.html'));
  if (serveSpa) {
    app.use(express.static(config.frontendDist, { maxAge: '1d', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.frontendDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => res.json({ name: 'mobadrat-platform-server', health: '/health', modules: MODULES.map((m) => m.id) }));
  }

  // Final error handler in the unified ApiError shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) return apiError(res, err.http, err.code, err.messageAr, err.messageEn, err.details);
    const type = err && typeof err === 'object' ? (err as { type?: string }).type : undefined;
    if (type === 'entity.parse.failed') return apiError(res, 400, 'VALIDATION_ERROR', 'صيغة JSON غير صحيحة.', 'Malformed JSON body.');
    if (type === 'entity.too.large') return apiError(res, 413, 'PAYLOAD_TOO_LARGE', 'حجم الطلب كبير جدًا.', 'Request body too large.');
    // Errors thrown by a module carry the module's own AppError class (same shape): answer them the same way.
    if (err && typeof err === 'object' && typeof (err as AppError).http === 'number' && typeof (err as AppError).code === 'string' && typeof (err as AppError).messageAr === 'string') {
      const e = err as AppError;
      return apiError(res, e.http, e.code, e.messageAr, e.messageEn, e.details);
    }
    if (isDbBusy(err)) {
      console.warn('[db-busy]', _req.method, _req.path);
      res.setHeader('Retry-After', '2');
      return apiError(res, 503, 'DB_BUSY', 'الخدمة مشغولة حاليًا — أعد المحاولة بعد لحظات.', 'The service is busy. Retry in a moment.');
    }
    console.error('[api-error]', (err as Error)?.message ?? err, (err as Error)?.stack?.split('\n').slice(0, 4).join(' | ') ?? '');
    return apiError(res, 500, 'INTERNAL_ERROR', 'خطأ داخلي — حاول لاحقًا.', 'Internal server error.');
  });
  return app;
}
