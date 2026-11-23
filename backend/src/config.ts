import 'dotenv/config';
import path from 'node:path';

/**
 * Platform configuration (core). Every initiative module reads this object through its own `config.ts` shim, which may
 * override a few module-specific keys (e.g. its outbound webhook). Lazy getters: tests set env after imports are hoisted.
 */
function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * MAX_FILE_SIZE_MB — megabytes in plain decimal notation (e.g. 15, 0.5). Missing/empty = 15.
 * Anything else (0, negative, text, exponent, hex, below one byte) is refused.
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

/** The platform runs on MySQL 8.4 everywhere (development: docker-compose.dev.yml; tests; production). */
export type DbClient = 'mysql';

export interface MysqlSettings {
  host: string; port: number; user: string; password: string; database: string;
  poolSize: number; connectTimeoutMs: number; ssl: boolean;
  /** Seconds a write transaction waits for its turn (write transactions are serialised). */
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
  const isProd = process.env.NODE_ENV === 'production';
  return {
    ...base,
    host: (process.env.DB_HOST ?? '127.0.0.1').trim(), port: num('DB_PORT', 3306),
    // Development defaults match docker-compose.dev.yml; production must set every value explicitly.
    user: (process.env.DB_USER ?? (isProd ? '' : 'mobadrat')).trim(),
    password: process.env.DB_PASSWORD ?? (isProd ? '' : 'mobadrat'),
    database: (process.env.DB_NAME ?? (isProd ? '' : 'mobadrat')).trim(),
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
  get dbClient(): DbClient { return 'mysql'; },
  /** MySQL connection: DATABASE_URL (mysql://user:pass@host:3306/db) or the DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD parts. */
  get mysql(): MysqlSettings { return mysqlSettings(); },
  /** Root of all uploaded files. Each module stores under <uploadDir>/<moduleId>/…, the core under <uploadDir>/core/…. */
  get uploadDir(): string { return process.env.UPLOAD_DIR ?? path.join(rootDir, 'data', 'uploads'); },
  get corsOrigin(): string[] {
    return (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean);
  },
  jsonLimit: process.env.JSON_LIMIT ?? '1mb',
  rateWindowMs: num('RATE_WINDOW_MS', 60_000),
  rateMax: num('RATE_MAX', 300),
  get trustProxy(): boolean { return process.env.TRUST_PROXY === '1'; },
  get seedOnBoot(): boolean { return (process.env.SEED_ON_BOOT ?? '0') === '1'; },
  /** Deploy seeder (core/seedDeploy.ts): one account per role + demo data, at every boot, creating only what is missing. */
  get seedOnDeploy(): boolean { return (process.env.SEED_ON_DEPLOY ?? '0') === '1'; },
  /** Domain of the deploy seeder's accounts (empty = the listed demo addresses). Checked by assertConfigValid. */
  get seedEmailDomain(): string { return (process.env.SEED_EMAIL_DOMAIN ?? '').trim().toLowerCase(); },
  get jwtSecret(): string { return process.env.JWT_SECRET ?? DEV_JWT_SECRET; },
  get jwtAccessTtlSec(): number { return num('JWT_ACCESS_TTL_SEC', 900); },
  get jwtRefreshTtlSec(): number { return num('JWT_REFRESH_TTL_SEC', 7 * 24 * 3600); },
  get bcryptRounds(): number { return num('BCRYPT_ROUNDS', 10); },
  serveFrontend: (process.env.SERVE_FRONTEND ?? '0') === '1',
  get frontendDist(): string { return process.env.FRONTEND_DIST ?? path.join(rootDir, '..', 'frontend', 'dist'); },
  get maxFileSizeMB(): number { return parseMaxFileSizeMB(process.env.MAX_FILE_SIZE_MB); },
  /** Rate-limit multiplier — tests only (production 1). */
  get rateLimitScale(): number { return num('RATE_LIMIT_SCALE', 1); },

  // ── Mail (nodemailer). SMTP_* first, GMAIL_* (App Password) as an alternative. ──
  get smtpHost(): string { return (process.env.SMTP_HOST ?? '').trim(); },
  get smtpPort(): number { return num('SMTP_PORT', 587); },
  get smtpSecure(): boolean { return process.env.SMTP_SECURE === '1'; },
  get smtpUser(): string { return (process.env.SMTP_USER ?? '').trim(); },
  get smtpPass(): string { return process.env.SMTP_PASS ?? ''; },
  get gmailUser(): string { return (process.env.GMAIL_USER ?? '').trim(); },
  get gmailAppPassword(): string { return (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, ''); },
  get mailFromAddress(): string { return (process.env.MAIL_FROM_ADDRESS ?? '').trim() || this.smtpUser || this.gmailUser; },
  get mailFromName(): string { return process.env.MAIL_FROM_NAME ?? 'المنصة الوطنية للمبادرات الصناعية'; },
  // Outside production mail goes only to MAIL_REDIRECT_TO; MAIL_SEND_REAL=1 opts in to real delivery.
  get mailRedirectTo(): string { return (process.env.MAIL_REDIRECT_TO ?? '').trim(); },
  get mailSendReal(): boolean { return this.isProd || process.env.MAIL_SEND_REAL === '1'; },
  get appUrl(): string {
    const fallback = (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',')[0].trim();
    return (process.env.APP_URL?.trim() || fallback).replace(/\/$/, '');
  },

  // ── Official enquiry channel. Empty = not shown, and check:readiness fails. ──
  get supportEmail(): string { return (process.env.SUPPORT_EMAIL ?? '').trim(); },
  get supportPhone(): string { return (process.env.SUPPORT_PHONE ?? '').trim(); },

  // ── SMS (replaceable adapter). Empty = no provider → messages recorded as `skipped`. ──
  get smsProvider(): string { return (process.env.SMS_PROVIDER ?? '').trim(); },
  get smsApiUrl(): string { return (process.env.SMS_API_URL ?? '').trim(); },
  get smsApiKey(): string { return process.env.SMS_API_KEY ?? ''; },
  get smsSender(): string { return (process.env.SMS_SENDER ?? '').trim(); },

  // ── Industrial registry (used by the Shams El-Senaa module and the factory profile) ──
  get registryAdapter(): RegistryAdapterName {
    const v = (process.env.REGISTRY_ADAPTER ?? (this.isProd ? 'http' : 'mock')).trim();
    return v === 'http' ? 'http' : 'mock';
  },
  get registryApiUrl(): string { return (process.env.REGISTRY_API_URL ?? '').trim().replace(/\/$/, ''); },
  get registryApiKey(): string { return process.env.REGISTRY_API_KEY ?? ''; },
  get registryTimeoutMs(): number { return num('REGISTRY_TIMEOUT_MS', 8000); },

  /**
   * Outbound webhooks of the initiative modules (to an external system). Off by default: the platform admin is built in.
   * Each module overrides these two through its config shim (<MODULE>_WEBHOOK_URL / _SECRET).
   */
  get platformWebhookUrl(): string { return ''; },
  get platformWebhookSecret(): string { return ''; },

  /** Full-data scopes of the modules' integration APIs (read_full, read_documents, read_audit). Deployment setting only. */
  get integrationDataScopesEnabled(): boolean { return process.env.INTEGRATION_DATA_SCOPES_ENABLED === '1'; },

  // ── Background jobs ──
  get jobsEnabled(): boolean { return process.env.JOBS_DISABLED !== '1'; },
  get notificationSweepMs(): number { return num('NOTIFICATION_SWEEP_MS', 20_000); },
  get slaSweepMs(): number { return num('SLA_SWEEP_MS', 15 * 60_000); },
  get recoverySweepMs(): number { return num('RECOVERY_SWEEP_MS', 5 * 60_000); },
  /** Days to keep FINISHED outbox messages (sent/skipped/failed). Unset or 0 = keep forever (the default). */
  get outboxRetentionDays(): number { return num('NOTIFICATION_OUTBOX_RETENTION_DAYS', 0); },
  get outboxRetentionSweepMs(): number { return num('OUTBOX_RETENTION_SWEEP_MS', 60 * 60_000); },
};

/** Production secret and lifetime limits — same values in check:prod. */
export const PROD_LIMITS = { jwtSecretMinLength: 48, accessTtlMaxSec: 3600, refreshTtlMaxSec: 30 * 24 * 3600 } as const;

/** Boot guard for every environment: values that cannot be interpreted are refused at start-up. */
export function assertConfigValid(): void {
  parseMaxFileSizeMB(process.env.MAX_FILE_SIZE_MB);
  const d = config.seedEmailDomain;
  if (d && !/^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d)) {
    throw new Error(`[config] SEED_EMAIL_DOMAIN must be a domain such as test.example.gov.eg (got "${process.env.SEED_EMAIL_DOMAIN}").`);
  }
  const m = mysqlSettings();
  const missing = (['host', 'user', 'database'] as const).filter((k) => !m[k]);
  if (missing.length) throw new Error(`[config] MySQL needs DATABASE_URL or ${missing.map((k) => `DB_${k === 'database' ? 'NAME' : k.toUpperCase()}`).join(', ')}.`);
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(m.database)) throw new Error('[config] the MySQL database name may only contain letters, digits, _, $ and -.');
}

/** The development default for the seeded accounts' password; never accepted in production. */
export const DEFAULT_SEED_PASSWORD = 'Mobadrat@2026';
export const SEED_PASSWORD_MIN_LENGTH = 12;

/** Production may seed demo data on an empty database only with its own SEED_PASSWORD. Returns the problem or null. */
export function seedPasswordProblem(): string | null {
  const p = process.env.SEED_PASSWORD ?? '';
  if (!p) return 'SEED_PASSWORD is required to seed accounts in production (SEED_ON_BOOT / SEED_ON_DEPLOY: the password of the seeded accounts).';
  if (p === DEFAULT_SEED_PASSWORD) return 'SEED_PASSWORD must not be the public development default in production.';
  if (p.length < SEED_PASSWORD_MIN_LENGTH) return `SEED_PASSWORD is too short (min ${SEED_PASSWORD_MIN_LENGTH} chars).`;
  return null;
}

/** The development password of the seeded demo accounts (SEED_PASSWORD overrides it). */
export function seedPassword(): string { return process.env.SEED_PASSWORD || DEFAULT_SEED_PASSWORD; }

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
  const scale = process.env.RATE_LIMIT_SCALE;
  if (scale !== undefined && scale !== '' && Number(scale) !== 1) problems.push('RATE_LIMIT_SCALE must be 1 (or unset) in production.');
  if (config.corsOrigin.includes('*')) problems.push('CORS_ORIGIN=* is forbidden in production.');
  if ((config.registryAdapter === 'mock' || process.env.REGISTRY_ADAPTER === 'mock') && !mockRegistryAllowedInProd()) {
    problems.push('REGISTRY_ADAPTER=mock is forbidden in production (ALLOW_MOCK_REGISTRY_IN_PRODUCTION=1 only for a demo deployment).');
  }
  if (config.seedOnBoot || config.seedOnDeploy) { const p = seedPasswordProblem(); if (p) problems.push(p); }
  if (!config.mysql.password) problems.push('The MySQL password (DB_PASSWORD or DATABASE_URL) must be set in production.');
  if (problems.length) throw new Error(`[config] unsafe production configuration:\n - ${problems.join('\n - ')}`);
}
