import 'dotenv/config';
import path from 'node:path';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * PR-F1: MAX_FILE_SIZE_MB — megabytes in plain decimal notation (e.g. 15, 0.5). Missing/empty = 15.
 * Anything else (0, negative, text, exponent, hex, below one byte) is refused: an invalid value must never be silently
 * replaced by a different limit. The limit is enforced in whole bytes: floor(MB × 1 MiB).
 */
export const DEFAULT_MAX_FILE_SIZE_MB = 15;
export function parseMaxFileSizeMB(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_FILE_SIZE_MB;
  const t = raw.trim();
  const n = /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(n) || n <= 0 || maxFileSizeBytes(n) < 1) {
    throw new Error(`[config] MAX_FILE_SIZE_MB must be a positive number of megabytes such as 15 or 0.5 (got "${raw}").`);
  }
  return n;
}
export function maxFileSizeBytes(mb: number): number { return Math.floor(mb * 1024 * 1024); }

const rootDir = process.cwd();
export const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me';

export type DbClient = 'sqlite' | 'mysql';
export function parseDbClient(raw: string | undefined): DbClient {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'sqlite') return 'sqlite';
  if (v === 'mysql') return 'mysql';
  throw new Error(`[config] DB_CLIENT must be "mysql" or "sqlite" (got "${raw}").`);
}

export interface MysqlSettings {
  host: string; port: number; user: string; password: string; database: string;
  poolSize: number; connectTimeoutMs: number; ssl: boolean;
  /** Seconds a write transaction waits for its turn (the transactions are serialised, like SQLite's single writer). */
  txLockTimeoutSec: number;
}

function mysqlSettings(): MysqlSettings {
  const base = {
    poolSize: num('DB_POOL_SIZE', 10),
    connectTimeoutMs: num('DB_CONNECT_TIMEOUT_MS', 60_000),
    txLockTimeoutSec: num('DB_TX_LOCK_TIMEOUT_SEC', 10),
    ssl: process.env.DB_SSL === '1',
  };
  const url = (process.env.DATABASE_URL ?? '').trim();
  if (url) {
    let u: URL;
    try { u = new URL(url); } catch { throw new Error('[config] DATABASE_URL is not a valid URL (expected mysql://user:password@host:3306/database).'); }
    if (u.protocol !== 'mysql:') throw new Error(`[config] DATABASE_URL must start with mysql:// (got ${u.protocol}//).`);
    return {
      ...base,
      host: u.hostname, port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    };
  }
  return {
    ...base,
    host: (process.env.DB_HOST ?? '127.0.0.1').trim(), port: num('DB_PORT', 3306),
    user: (process.env.DB_USER ?? '').trim(), password: process.env.DB_PASSWORD ?? '',
    database: (process.env.DB_NAME ?? '').trim(),
  };
}

export type RegistryAdapterName = 'mock' | 'http';

export const config = {
  get env(): string { return process.env.NODE_ENV ?? 'development'; },
  get isProd(): boolean { return (process.env.NODE_ENV ?? 'development') === 'production'; },
  get isTest(): boolean { return process.env.NODE_ENV === 'test'; },
  port: num('PORT', 5000),
  /** Interface to listen on. 0.0.0.0 in containers (the image sets it); unset = Node's default (all interfaces). */
  get host(): string | undefined { return process.env.HOST?.trim() || undefined; },
  // Lazy getters: tests set env (DB_PATH, UPLOAD_DIR, …) after imports are hoisted.
  /** Database engine: `mysql` (production) or `sqlite` (development and tests; the default when unset). */
  get dbClient(): DbClient { return parseDbClient(process.env.DB_CLIENT); },
  get dbPath(): string { return process.env.DB_PATH ?? path.join(rootDir, 'data', 'app.db'); },
  /** MySQL connection: DATABASE_URL (mysql://user:pass@host:3306/db) or the DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD parts. */
  get mysql(): MysqlSettings { return mysqlSettings(); },
  get uploadDir(): string { return process.env.UPLOAD_DIR ?? path.join(rootDir, 'data', 'uploads'); },
  get corsOrigin(): string[] {
    return (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean);
  },
  jsonLimit: process.env.JSON_LIMIT ?? '1mb',
  rateWindowMs: num('RATE_WINDOW_MS', 60_000),
  rateMax: num('RATE_MAX', 300),
  get trustProxy(): boolean { return process.env.TRUST_PROXY === '1'; },
  // Development seed only. Production refuses to seed (see db/seed.ts + boot guard).
  get seedOnBoot(): boolean { return (process.env.SEED_ON_BOOT ?? '0') === '1'; },
  get jwtSecret(): string { return process.env.JWT_SECRET ?? DEV_JWT_SECRET; },
  get jwtAccessTtlSec(): number { return num('JWT_ACCESS_TTL_SEC', 900); },
  get jwtRefreshTtlSec(): number { return num('JWT_REFRESH_TTL_SEC', 7 * 24 * 3600); },
  get bcryptRounds(): number { return num('BCRYPT_ROUNDS', 10); },
  serveFrontend: (process.env.SERVE_FRONTEND ?? '0') === '1',
  get frontendDist(): string { return process.env.FRONTEND_DIST ?? path.join(rootDir, '..', 'frontend', 'dist'); },
  get maxFileSizeMB(): number { return parseMaxFileSizeMB(process.env.MAX_FILE_SIZE_MB); },
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
  get mailFromName(): string { return process.env.MAIL_FROM_NAME ?? 'مبادرة شمس الصناعة'; },
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

  // ── Industrial registry ──
  get registryAdapter(): RegistryAdapterName {
    const v = (process.env.REGISTRY_ADAPTER ?? (this.isProd ? 'http' : 'mock')).trim();
    return v === 'http' ? 'http' : 'mock';
  },
  get registryApiUrl(): string { return (process.env.REGISTRY_API_URL ?? '').trim().replace(/\/$/, ''); },
  get registryApiKey(): string { return process.env.REGISTRY_API_KEY ?? ''; },
  get registryTimeoutMs(): number { return num('REGISTRY_TIMEOUT_MS', 8000); },

  // ── Link to the original platform's admin (outbound webhooks). Optional. ──
  get platformWebhookUrl(): string { return (process.env.PLATFORM_WEBHOOK_URL ?? '').trim(); },
  get platformWebhookSecret(): string { return process.env.PLATFORM_WEBHOOK_SECRET ?? ''; },

  /**
   * H1 (قرار المشروع 3): نطاقات البيانات الكاملة في API الربط (read_full, read_documents, read_audit).
   * إعداد نشر فقط (لا يُغيَّر من الواجهة). false = معطلة: يُرفض إنشاء المفتاح بها، ويُرفض أي طلب بها.
   */
  get integrationDataScopesEnabled(): boolean { return process.env.INTEGRATION_DATA_SCOPES_ENABLED === '1'; },

  // ── Background jobs ──
  get jobsEnabled(): boolean { return process.env.JOBS_DISABLED !== '1'; },
  get notificationSweepMs(): number { return num('NOTIFICATION_SWEEP_MS', 20_000); },
  get slaSweepMs(): number { return num('SLA_SWEEP_MS', 15 * 60_000); },
  get recoverySweepMs(): number { return num('RECOVERY_SWEEP_MS', 5 * 60_000); },
  /** PA-05: days to keep FINISHED outbox messages (sent/skipped/failed). Unset or 0 = keep forever (the default). */
  get outboxRetentionDays(): number { return num('NOTIFICATION_OUTBOX_RETENTION_DAYS', 0); },
  get outboxRetentionSweepMs(): number { return num('OUTBOX_RETENTION_SWEEP_MS', 60 * 60_000); },
};

/** L8: حدود أسرار ومدد الإنتاج — نفس القيم في check:prod. */
export const PROD_LIMITS = { jwtSecretMinLength: 48, accessTtlMaxSec: 3600, refreshTtlMaxSec: 30 * 24 * 3600 } as const;

/** Boot guard for every environment: values that cannot be interpreted are refused at start-up (not at the first upload). */
export function assertConfigValid(): void {
  parseMaxFileSizeMB(process.env.MAX_FILE_SIZE_MB);
  if (parseDbClient(process.env.DB_CLIENT) === 'mysql') {
    const m = mysqlSettings();
    const missing = (['host', 'user', 'database'] as const).filter((k) => !m[k]);
    if (missing.length) throw new Error(`[config] DB_CLIENT=mysql needs DATABASE_URL or ${missing.map((k) => `DB_${k === 'database' ? 'NAME' : k.toUpperCase()}`).join(', ')}.`);
    if (!/^[A-Za-z0-9_$-]{1,64}$/.test(m.database)) throw new Error('[config] the MySQL database name may only contain letters, digits, _, $ and -.');
  }
}

/** The development default for the seeded accounts' password; never accepted in production. */
export const DEFAULT_SEED_PASSWORD = 'Shams@2026';
export const SEED_PASSWORD_MIN_LENGTH = 12;

/**
 * Production may seed the demo accounts on the first boot of an empty database (SEED_ON_BOOT=1), but only with its own
 * SEED_PASSWORD: the default one is public (it is in the repository). Returns the problem, or null when it is acceptable.
 */
export function seedPasswordProblem(): string | null {
  const p = process.env.SEED_PASSWORD ?? '';
  if (!p) return 'SEED_PASSWORD is required to seed the demo data in production (the password of the seeded accounts).';
  if (p === DEFAULT_SEED_PASSWORD) return 'SEED_PASSWORD must not be the public development default in production.';
  if (p.length < SEED_PASSWORD_MIN_LENGTH) return `SEED_PASSWORD is too short (min ${SEED_PASSWORD_MIN_LENGTH} chars).`;
  return null;
}

/** Demo deployments only: lets production run on the mock industrial registry (accepts any registry number). */
export function mockRegistryAllowedInProd(): boolean { return process.env.ALLOW_MOCK_REGISTRY_IN_PRODUCTION === '1'; }

/** Boot guards — the process must refuse to start with an unsafe production setup. */
export function assertProductionSafe(): void {
  if (!config.isProd) return;
  const problems: string[] = [];
  if (!process.env.JWT_SECRET || config.jwtSecret === DEV_JWT_SECRET) problems.push('JWT_SECRET must be set to a strong random value.');
  else if (config.jwtSecret.length < PROD_LIMITS.jwtSecretMinLength) problems.push(`JWT_SECRET is too short (min ${PROD_LIMITS.jwtSecretMinLength} chars).`);
  if (config.jwtAccessTtlSec > PROD_LIMITS.accessTtlMaxSec) problems.push(`JWT_ACCESS_TTL_SEC must be at most ${PROD_LIMITS.accessTtlMaxSec}.`);
  if (config.jwtRefreshTtlSec > PROD_LIMITS.refreshTtlMaxSec) problems.push(`JWT_REFRESH_TTL_SEC must be at most ${PROD_LIMITS.refreshTtlMaxSec}.`);
  // M2: مضاعف حدود الطلبات للاختبارات فقط — أي قيمة غير 1 مرفوضة في الإنتاج (ولو كانت غير صالحة).
  const scale = process.env.RATE_LIMIT_SCALE;
  if (scale !== undefined && scale !== '' && Number(scale) !== 1) problems.push('RATE_LIMIT_SCALE must be 1 (or unset) in production.');
  if (config.corsOrigin.includes('*')) problems.push('CORS_ORIGIN=* is forbidden in production.');
  if ((config.registryAdapter === 'mock' || process.env.REGISTRY_ADAPTER === 'mock') && !mockRegistryAllowedInProd()) {
    problems.push('REGISTRY_ADAPTER=mock is forbidden in production (ALLOW_MOCK_REGISTRY_IN_PRODUCTION=1 only for a demo deployment).');
  }
  if (config.seedOnBoot) { const p = seedPasswordProblem(); if (p) problems.push(p); }
  // MySQL is the production database. SQLite stays available only as an explicit, temporary rollback.
  if (config.dbClient !== 'mysql' && process.env.ALLOW_SQLITE_IN_PRODUCTION !== '1') {
    problems.push('DB_CLIENT=mysql is required in production (ALLOW_SQLITE_IN_PRODUCTION=1 only as a temporary rollback to SQLite).');
  }
  if (config.dbClient === 'mysql' && !config.mysql.password) problems.push('The MySQL password (DB_PASSWORD or DATABASE_URL) must be set in production.');
  if (problems.length) throw new Error(`[config] unsafe production configuration:\n - ${problems.join('\n - ')}`);
}
