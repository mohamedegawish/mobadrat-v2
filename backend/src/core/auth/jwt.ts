import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../../config.js';
import { comparePassword, hashPasswordInPool } from './passwordPool.js';

/** tv = رقم إصدار جلسات المستخدم (M1): يُرفض التوكن إن لم يطابق users.tokenVersion في القاعدة. */
export interface AccessClaims { sub: string; role: string; org: string; tv?: number; typ: 'access' }
export interface RefreshClaims { sub: string; jti: string; typ: 'refresh' }

/** Synchronous hash — seed and CLIs only. Request handlers use hashPasswordAsync (PA-03). */
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, config.bcryptRounds);
}

/** Request-path hash: same algorithm and rounds, computed in the worker pool so the event loop keeps serving. */
export function hashPasswordAsync(plain: string): Promise<string> {
  return hashPasswordInPool(plain, config.bcryptRounds);
}

/** L6: hash وهمي بنفس الكلفة — يُقارن به حين لا يوجد حساب أو كلمة مرور، حتى لا يكشف زمن الرد وجود البريد. */
let dummyHash: string | null = null;
export function burnPasswordCheck(plain: unknown): void {
  dummyHash ??= bcrypt.hashSync('dummy-password-for-timing-only', config.bcryptRounds);
  try { bcrypt.compareSync(typeof plain === 'string' ? plain : '', dummyHash); } catch { /* ignore */ }
}

/**
 * PR-P1: request-path variants. bcryptjs is pure JavaScript (~120 ms per check at 10 rounds on the test machine); on the
 * event loop a burst of N logins stalled every other request for about N × 120 ms. These run the same comparison in a
 * worker-thread pool (auth/passwordPool.ts). Same hashes, same algorithm, same timing-equalisation for unknown accounts.
 */
export async function burnPasswordCheckAsync(plain: unknown): Promise<void> {
  dummyHash ??= bcrypt.hashSync('dummy-password-for-timing-only', config.bcryptRounds);
  await comparePassword(typeof plain === 'string' ? plain : '', dummyHash);
}

export async function verifyPasswordAsync(plain: string, hash: string): Promise<boolean> {
  if (!hash) { await burnPasswordCheckAsync(plain); return false; }
  return comparePassword(plain, hash);
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!hash) { burnPasswordCheck(plain); return false; }
  try { return bcrypt.compareSync(plain, hash); }
  catch { return false; }
}

export function signAccess(userId: string, role: string, org: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, role, org, tv: tokenVersion, typ: 'access' } as AccessClaims, config.jwtSecret, { expiresIn: config.jwtAccessTtlSec });
}

export function signRefresh(userId: string): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ sub: userId, jti, typ: 'refresh' } as RefreshClaims, config.jwtSecret, { expiresIn: config.jwtRefreshTtlSec });
  return { token, jti };
}

export function verifyAccess(token: string): AccessClaims | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as AccessClaims;
    return p.typ === 'access' ? p : null;
  } catch { return null; }
}

export function verifyRefresh(token: string): RefreshClaims | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as RefreshClaims;
    return p.typ === 'refresh' ? p : null;
  } catch { return null; }
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
