// اختبار القبول 19: فحص الإنتاج يفشل مع adapter الـmock أو غياب JWT_SECRET — في check:prod وفي إقلاع السيرفر.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const GOOD = {
  NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(30) + 'Zq9x8w7v6u5t4s3r2p1o0n9m8l7k6j5i4h3g2f1e0dcba', CORS_ORIGIN: 'https://shams.example.gov.eg',
  APP_URL: 'https://shams.example.gov.eg', REGISTRY_ADAPTER: 'http', REGISTRY_API_URL: 'https://registry.example.gov.eg', REGISTRY_API_KEY: 'k',
  SEED_ON_BOOT: '0', SMTP_HOST: 'smtp.example.gov.eg', MAIL_FROM_ADDRESS: 'no-reply@example.gov.eg', TRUST_PROXY: '1',
  // A safe production configuration includes MySQL (the production database).
  DB_CLIENT: 'mysql', DB_HOST: 'mysql', DB_PORT: '3306', DB_NAME: 'shams', DB_USER: 'shams', DB_PASSWORD: 'Qx7-not-a-real-password-9Lm2',
};

function baseEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) e[k] = v;
  return e;
}

function checkProd(extra: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ['scripts/check-prod.mjs', '--no-dotenv', '--skip-build-check'], { cwd: root, env: baseEnv(extra), encoding: 'utf8' });
}

test('19a) check:prod passes with a safe configuration', () => {
  const r = checkProd(GOOD);
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('19b) check:prod fails with the mock registry adapter', () => {
  const r = checkProd({ ...GOOD, REGISTRY_ADAPTER: 'mock' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REGISTRY_ADAPTER=mock/);
});

test('19c) check:prod fails without JWT_SECRET', () => {
  const r = checkProd({ ...GOOD, JWT_SECRET: undefined });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /JWT_SECRET is missing/);
});

test('19d) check:prod fails with seed on boot without a strong SEED_PASSWORD, or wildcard CORS', () => {
  assert.equal(checkProd({ ...GOOD, SEED_ON_BOOT: '1' }).status, 1);
  assert.equal(checkProd({ ...GOOD, SEED_ON_BOOT: '1', SEED_PASSWORD: 'Shams@2026' }).status, 1);
  assert.equal(checkProd({ ...GOOD, SEED_ON_BOOT: '1', SEED_PASSWORD: 'short' }).status, 1);
  const ok = checkProd({ ...GOOD, SEED_ON_BOOT: '1', SEED_PASSWORD: 'Demo-Seed-Pass-2026x' });
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.equal(checkProd({ ...GOOD, CORS_ORIGIN: '*' }).status, 1);
});

function boot(extra: Record<string, string | undefined>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shams-boot-'));
  try {
    return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: baseEnv({ ...extra, DB_PATH: path.join(dir, 'b.db'), UPLOAD_DIR: path.join(dir, 'u'), PORT: '0', JOBS_DISABLED: '1' }),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('19e) the server refuses to boot in production with the mock adapter', () => {
  const r = boot({ ...GOOD, REGISTRY_ADAPTER: 'mock' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /REGISTRY_ADAPTER=mock is forbidden/);
});

test('19f) the server refuses to boot in production without JWT_SECRET', () => {
  const r = boot({ ...GOOD, JWT_SECRET: undefined });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /JWT_SECRET must be set/);
});

test('19h) check:prod fails without MySQL (SQLite only as an explicit rollback) or without the MySQL password', () => {
  const sqlite = checkProd({ ...GOOD, DB_CLIENT: undefined });
  assert.equal(sqlite.status, 1);
  assert.match(sqlite.stderr, /DB_CLIENT=mysql is required/);
  assert.equal(checkProd({ ...GOOD, DB_CLIENT: 'sqlite', ALLOW_SQLITE_IN_PRODUCTION: '1' }).status, 0, 'explicit rollback is a warning');
  const noPass = checkProd({ ...GOOD, DB_PASSWORD: undefined });
  assert.equal(noPass.status, 1);
  assert.match(noPass.stderr, /MySQL password/);
  assert.equal(checkProd({ ...GOOD, DB_CLIENT: 'postgres' }).status, 1);
  assert.equal(checkProd({ ...GOOD, DB_HOST: undefined, DB_NAME: undefined, DATABASE_URL: 'mysql://shams:Qx7-not-a-real-password-9Lm2@mysql:3306/shams' }).status, 0);
});

test('19i) the server refuses to boot in production on SQLite unless the rollback is explicit', () => {
  const r = boot({ ...GOOD, DB_CLIENT: 'sqlite' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /DB_CLIENT=mysql is required in production/);
  const bad = boot({ ...GOOD, DB_CLIENT: 'oracle' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /DB_CLIENT must be "mysql" or "sqlite"/);
});

test('19g) the demo seed refuses to run in production without its own strong SEED_PASSWORD', async () => {
  for (const SEED_PASSWORD of [undefined, 'Shams@2026', 'short']) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/db/seed-cli.ts'], {
      cwd: root, encoding: 'utf8', timeout: 30_000, env: baseEnv({ ...GOOD, SEED_PASSWORD, DB_PATH: path.join(os.tmpdir(), `shams-seed-${Date.now()}.db`) }),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /\[seed\] refused: SEED_PASSWORD/);
  }
});

test('19j) the mock registry runs in production only with the explicit demo opt-in', () => {
  assert.equal(checkProd({ ...GOOD, REGISTRY_ADAPTER: 'mock', ALLOW_MOCK_REGISTRY_IN_PRODUCTION: '1' }).status, 0);
  assert.equal(checkProd({ ...GOOD, REGISTRY_ADAPTER: 'mock', ALLOW_MOCK_REGISTRY_IN_PRODUCTION: '0' }).status, 1);
});
