import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { auth, requirePasswordChanged } from './middleware/auth.js';
import { apiError, AppError, rateLimitedBody } from './http/errors.js';
import { makeLimiter } from './http/rateLimits.js';
import { healthHandler, healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { metaRouter } from './routes/meta.js';
import { siteContentRouter } from './routes/siteContent.js';
import { applicantRouter } from './routes/applicant.js';
import { applicationsRouter } from './routes/applications.js';
import { expertsRouter } from './routes/experts.js';
import { cohortsRouter } from './routes/cohorts.js';
import { inboxRouter } from './routes/inbox.js';
import { reportsRouter } from './routes/reports.js';
import { adminRouter } from './routes/admin.js';
import { integrationRouter } from './integration/router.js';

function contractFile(name: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), 'contracts', name),
    path.join(process.cwd(), '..', 'contracts', name),
    path.join(here, '..', '..', 'contracts', name),
    path.join(here, '..', 'contracts', name),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function createApp() {
  const app = express();
  // TRUST_PROXY=1 خلف reverse proxy واحد → req.ip = عنوان العميل الحقيقي (rate limit + التدقيق).
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
        imgSrc: ["'self'", 'data:', 'blob:'],
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
  // لا تُسجل أجسام الطلبات ولا Authorization/Cookie ولا query (قد تحوي بيانات).
  morgan.token('path', (req) => (req as express.Request).path ?? '');
  if (!config.isTest) app.use(morgan(':remote-addr [:date[iso]] ":method :path" :status :res[content-length] - :response-time ms'));
  app.use(cookieParser());
  app.use(express.json({ limit: config.jsonLimit }));

  // /health للمراقبة (بدون مصادقة)
  app.get('/health', healthHandler);

  const v1 = express.Router();
  v1.use(healthRouter);
  v1.get('/openapi.json', (_req, res) => {
    const f = contractFile('openapi.json');
    if (!f) return apiError(res, 404, 'NOT_FOUND', 'ملف العقد غير موجود.', 'OpenAPI not found.');
    res.type('application/json').send(fs.readFileSync(f, 'utf8'));
  });
  v1.use('/meta', makeLimiter('publicRead'));
  v1.use(metaRouter);
  v1.use('/site-content', makeLimiter('publicRead'));
  v1.use(siteContentRouter);
  v1.use(authRouter); // عامة (بحدود خاصة لكل مسار) + /auth/me و/auth/change-password محمية داخليًا
  v1.use(rateLimit({ windowMs: config.rateWindowMs, limit: () => Math.round(config.rateMax * config.rateLimitScale), standardHeaders: true, legacyHeaders: false, message: rateLimitedBody() }));
  v1.use(auth);
  v1.use(requirePasswordChanged);
  v1.use(applicantRouter);
  v1.use(applicationsRouter);
  v1.use(expertsRouter);
  v1.use(cohortsRouter);
  v1.use(inboxRouter);
  v1.use(reportsRouter);
  v1.use(adminRouter);
  app.use('/api/v1', v1);
  app.use('/api/v1', (req, res) => apiError(res, 404, 'NOT_FOUND', 'المسار غير موجود.', `Route not found: ${req.method} ${req.path}`));

  // API الربط بأدمن المنصة الأصلية (مفاتيح API، لا JWT).
  app.get('/api/integration/v1/openapi.json', (_req, res) => {
    const f = contractFile('integration.openapi.json');
    if (!f) return apiError(res, 404, 'NOT_FOUND', 'ملف العقد غير موجود.', 'OpenAPI not found.');
    res.type('application/json').send(fs.readFileSync(f, 'utf8'));
  });
  app.use('/api/integration/v1', integrationRouter);

  // حاوية واحدة: الباك يخدم الواجهة المبنية على نفس الأصل.
  const serveSpa = config.serveFrontend && fs.existsSync(path.join(config.frontendDist, 'index.html'));
  if (serveSpa) {
    app.use(express.static(config.frontendDist, { maxAge: '1d', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.frontendDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => res.json({ name: 'sona3-server', docs: '/api/v1/openapi.json', health: '/health' }));
  }

  // معالج الأخطاء الأخير بشكل ApiError الموحد.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof AppError) return apiError(res, err.http, err.code, err.messageAr, err.messageEn, err.details);
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
      return apiError(res, 400, 'VALIDATION_ERROR', 'صيغة JSON غير صحيحة.', 'Malformed JSON body.');
    }
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
      return apiError(res, 413, 'PAYLOAD_TOO_LARGE', 'حجم الطلب كبير جدًا.', 'Request body too large.');
    }
    console.error('[api-error]', (err as Error)?.message ?? err, (err as Error)?.stack?.split('\n').slice(0, 4).join(' | ') ?? '');
    return apiError(res, 500, 'INTERNAL_ERROR', 'خطأ داخلي — حاول لاحقًا.', 'Internal server error.');
  });
  return app;
}
