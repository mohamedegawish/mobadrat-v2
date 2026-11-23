/**
 * Secrets the platform generates on its first production start when the deployment does not provide them, so a fresh
 * deployment works with no manual step (on Coolify the compose file's SERVICE_PASSWORD_* variables normally provide them):
 *   • JWT_SECRET — the session signing key;
 *   • SEED_PASSWORD — the first-sign-in password of the accounts the seeder creates (SEED_ON_DEPLOY / SEED_ON_BOOT).
 * Each is kept in SECRETS_DIR (the persistent /data volume in the image, mode 0600) so every restart and every instance
 * uses the same value; created with an exclusive open, so two instances starting together agree on one value.
 * A value set in the environment always wins and is never written to disk.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SEED_PASSWORD, DEV_JWT_SECRET, PROD_LIMITS, SEED_PASSWORD_MIN_LENGTH } from '../config.js';

export interface GeneratedSecret { name: 'JWT_SECRET' | 'SEED_PASSWORD'; file: string; createdNow: boolean; value: string }

function readOrCreate(file: string, make: () => string, valid: (v: string) => boolean): { value: string; createdNow: boolean } | null {
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (valid(v)) return { value: v, createdNow: false };
  } catch { /* not there yet */ }
  const value = make();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${value}\n`, { flag: 'wx', mode: 0o600 });
    return { value, createdNow: true };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') { // another instance created it first: use its value
      const v = fs.readFileSync(file, 'utf8').trim();
      return valid(v) ? { value: v, createdNow: false } : null;
    }
    return null; // not writable: the production checks then report the missing value
  }
}

/** Fills JWT_SECRET / SEED_PASSWORD from SECRETS_DIR (generating them once) when the environment leaves them empty. */
export function ensureGeneratedSecrets(env: NodeJS.ProcessEnv = process.env, opts: { seeding?: boolean } = {}): GeneratedSecret[] {
  const dir = (env.SECRETS_DIR ?? '').trim();
  if (env.NODE_ENV !== 'production' || !dir) return [];
  const out: GeneratedSecret[] = [];
  if (!(env.JWT_SECRET ?? '').trim()) {
    const file = path.join(dir, 'jwt-secret');
    const r = readOrCreate(file, () => crypto.randomBytes(48).toString('hex'), (v) => v.length >= PROD_LIMITS.jwtSecretMinLength && v !== DEV_JWT_SECRET);
    if (r) { env.JWT_SECRET = r.value; out.push({ name: 'JWT_SECRET', file, ...r }); }
  }
  const seeding = opts.seeding || env.SEED_ON_DEPLOY === '1' || env.SEED_ON_BOOT === '1';
  if (seeding && !(env.SEED_PASSWORD ?? '').trim()) {
    const file = path.join(dir, 'seed-password');
    const r = readOrCreate(file, () => crypto.randomBytes(18).toString('base64url'), (v) => v.length >= SEED_PASSWORD_MIN_LENGTH && v !== DEFAULT_SEED_PASSWORD);
    if (r) { env.SEED_PASSWORD = r.value; out.push({ name: 'SEED_PASSWORD', file, ...r }); }
  }
  return out;
}

/** Boot log lines: where each generated secret lives; the first-sign-in password itself only on the start that created it. */
export function describeGeneratedSecrets(list: GeneratedSecret[]): string[] {
  return list.map((s) => {
    if (s.name === 'JWT_SECRET') return `[secrets] JWT_SECRET ${s.createdNow ? 'generated' : 'loaded'} (${s.file})`;
    return s.createdNow
      ? `[secrets] SEED_PASSWORD generated for the seeded accounts' FIRST sign-in (each account then sets its own): ${s.value}  — also in ${s.file}`
      : `[secrets] SEED_PASSWORD loaded (${s.file})`;
  });
}
