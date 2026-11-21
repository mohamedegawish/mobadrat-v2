import 'dotenv/config';
import path from 'node:path';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const rootDir = process.cwd();
export const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me';

export const config = {
  get env(): string { return process.env.NODE_ENV ?? 'development'; },
  get isProd(): boolean { return (process.env.NODE_ENV ?? 'development') === 'production'; },
  get isTest(): boolean { return process.env.NODE_ENV === 'test'; },
  port: num('PORT', 5000),
  // Lazy getters: tests set env (DB_PATH, UPLOAD_DIR, …) after imports are hoisted.
  get dbPath(): string { return process.env.DB_PATH ?? path.join(rootDir, 'data', 'app.db'); },
  get uploadDir(): string { return process.env.UPLOAD_DIR ?? path.join(rootDir, 'data', 'uploads'); },
  get corsOrigin(): string[] {
    return (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean);
  },
  jsonLimit: process.env.JSON_LIMIT ?? '1mb',
  rateWindowMs: num('RATE_WINDOW_MS', 60_000),
  rateMax: num('RATE_MAX', 300),
  trustProxy: process.env.TRUST_PROXY === '1',
  // Development seed only. Production refuses to seed (see db/seed.ts + boot guard).
  get seedOnBoot(): boolean { return (process.env.SEED_ON_BOOT ?? '0') === '1'; },
  /** يسمح بالبذرة في الإنتاج صراحةً (نشر تجريبي/عرض). تعمل مرة واحدة فقط عندما تكون القاعدة فارغة. */
  get seedAllowProduction(): boolean { return process.env.SEED_ALLOW_PRODUCTION === '1'; },
  get jwtSecret(): string { return process.env.JWT_SECRET ?? DEV_JWT_SECRET; },
  jwtAccessTtlSec: num('JWT_ACCESS_TTL_SEC', 900),
  jwtRefreshTtlSec: num('JWT_REFRESH_TTL_SEC', 7 * 24 * 3600),
  get bcryptRounds(): number { return num('BCRYPT_ROUNDS', 10); },
  serveFrontend: (process.env.SERVE_FRONTEND ?? '0') === '1',
  get frontendDist(): string { return process.env.FRONTEND_DIST ?? path.join(rootDir, '..', 'frontend', 'dist'); },
  get maxFileSizeMB(): number { return num('MAX_FILE_SIZE_MB', 15); },
  /** مضاعف حدود الطلبات — للاختبارات فقط (الإنتاج 1). */
  get rateLimitScale(): number { return num('RATE_LIMIT_SCALE', 1); },

  // ── Mail (nodemailer). SMTP_* first, GMAIL_* (App Password) as in the original platform. ──
  get smtpHost(): string { return (process.env.SMTP_HOST ?? '').trim(); },
  get smtpPort(): number { return num('SMTP_PORT', 587); },
  get smtpSecure(): boolean { return process.env.SMTP_SECURE === '1'; },
  get smtpUser(): string { return (process.env.SMTP_USER ?? '').trim(); },
  get smtpPass(): string { return process.env.SMTP_PASS ?? ''; },
  get gmailUser(): string { return (process.env.GMAIL_USER ?? '').trim(); },
  get gmailAppPassword(): string { return (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, ''); },
  get mailFromAddress(): string { return (process.env.MAIL_FROM_ADDRESS ?? '').trim() || this.smtpUser || this.gmailUser; },
  get mailFromName(): string { return process.env.MAIL_FROM_NAME ?? 'صُنّاع المستقبل'; },
  // Outside production mail goes only to MAIL_REDIRECT_TO; MAIL_SEND_REAL=1 opts in to real delivery.
  get mailRedirectTo(): string { return (process.env.MAIL_REDIRECT_TO ?? '').trim(); },
  get mailSendReal(): boolean { return this.isProd || process.env.MAIL_SEND_REAL === '1'; },
  get appUrl(): string {
    const fallback = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0].trim();
    return (process.env.APP_URL?.trim() || fallback).replace(/\/$/, '');
  },

  // ── قناة الاستفسار الرسمية (I9). فارغة = لا تُعرض، وcheck:readiness يفشل. ──
  get supportEmail(): string { return (process.env.SUPPORT_EMAIL ?? '').trim(); },
  get supportPhone(): string { return (process.env.SUPPORT_PHONE ?? '').trim(); },

  // ── SMS (replaceable adapter). Empty = no provider → messages recorded as `skipped`. ──
  get smsProvider(): string { return (process.env.SMS_PROVIDER ?? '').trim(); },
  get smsApiUrl(): string { return (process.env.SMS_API_URL ?? '').trim(); },
  get smsApiKey(): string { return process.env.SMS_API_KEY ?? ''; },
  get smsSender(): string { return (process.env.SMS_SENDER ?? '').trim(); },

  // ── Link to the original platform's admin (outbound webhooks). Optional. ──
  get platformWebhookUrl(): string { return (process.env.PLATFORM_WEBHOOK_URL ?? '').trim(); },
  get platformWebhookSecret(): string { return process.env.PLATFORM_WEBHOOK_SECRET ?? ''; },

  // ── Background jobs ──
  get jobsEnabled(): boolean { return process.env.JOBS_DISABLED !== '1'; },
  get notificationSweepMs(): number { return num('NOTIFICATION_SWEEP_MS', 20_000); },
  get slaSweepMs(): number { return num('SLA_SWEEP_MS', 15 * 60_000); },
};

/** Boot guards — the process must refuse to start with an unsafe production setup. */
export function assertProductionSafe(): void {
  if (!config.isProd) return;
  const problems: string[] = [];
  if (!process.env.JWT_SECRET || config.jwtSecret === DEV_JWT_SECRET) problems.push('JWT_SECRET must be set to a strong random value.');
  else if (config.jwtSecret.length < 32) problems.push('JWT_SECRET is too short (min 32 chars).');
  if (config.corsOrigin.includes('*')) problems.push('CORS_ORIGIN=* is forbidden in production.');
  if (config.seedOnBoot && !config.seedAllowProduction) problems.push('SEED_ON_BOOT=1 is forbidden in production unless SEED_ALLOW_PRODUCTION=1 is set explicitly.');
  if (problems.length) throw new Error(`[config] unsafe production configuration:\n - ${problems.join('\n - ')}`);
}
