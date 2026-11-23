/**
 * The secret the platform generates on its first production start when the deployment does not provide it, so a fresh
 * deployment works with no manual step (on Coolify the compose file's SERVICE_PASSWORD_64_JWT normally provides it):
 *   • JWT_SECRET — the session signing key.
 * It is kept in SECRETS_DIR (the persistent /data volume in the image, mode 0600) so every restart and every instance
 * uses the same value; created with an exclusive open, so two instances starting together agree on one value.
 * A value set in the environment always wins and is never written to disk.
 * (The seeded accounts' password is fixed — config.ts DEFAULT_SEED_PASSWORD — so there is nothing to generate for it.)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEV_JWT_SECRET, PROD_LIMITS } from '../config.js';

export interface GeneratedSecret { name: 'JWT_SECRET'; file: string; createdNow: boolean; value: string }

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

/** Fills JWT_SECRET from SECRETS_DIR (generating it once) when the environment leaves it empty. */
export function ensureGeneratedSecrets(env: NodeJS.ProcessEnv = process.env): GeneratedSecret[] {
  const dir = (env.SECRETS_DIR ?? '').trim();
  if (env.NODE_ENV !== 'production' || !dir) return [];
  const out: GeneratedSecret[] = [];
  if (!(env.JWT_SECRET ?? '').trim()) {
    const file = path.join(dir, 'jwt-secret');
    const r = readOrCreate(file, () => crypto.randomBytes(48).toString('hex'), (v) => v.length >= PROD_LIMITS.jwtSecretMinLength && v !== DEV_JWT_SECRET);
    if (r) { env.JWT_SECRET = r.value; out.push({ name: 'JWT_SECRET', file, ...r }); }
  }
  return out;
}

/** Boot log lines: where each generated secret lives (never its value). */
export function describeGeneratedSecrets(list: GeneratedSecret[]): string[] {
  return list.map((s) => `[secrets] ${s.name} ${s.createdNow ? 'generated' : 'loaded'} (${s.file})`);
}
