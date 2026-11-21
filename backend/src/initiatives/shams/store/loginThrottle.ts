/**
 * M3: تأخير متصاعد لكل (بريد، IP) بدل قفل الحساب — مهاجم من عنوان لا يمنع صاحب الحساب من عنوان آخر.
 * المفتاح hash للبريد المطبّع والعنوان، فيُعامل البريد غير الموجود بنفس الطريقة (لا كشف لوجود الحساب).
 */
import { getDb, tx } from '../db/sqlite.js';
import { sha256 } from '../auth/jwt.js';
import { shamsPolicy } from '../config/shamsPolicy.js';

export function throttleKey(email: string, ip: string): string {
  return sha256(`${email.trim().toLowerCase()}|${ip}`);
}

/** التأخير بعد f محاولة فاشلة: 0 حتى freeFailures، ثم 1، 2، 4… ثانية حتى الحد الأقصى. */
export function delayAfter(failures: number): number {
  const { freeFailures, maxDelaySec } = shamsPolicy.loginThrottle;
  if (failures < freeFailures) return 0;
  return Math.min(2 ** (failures - freeFailures), maxDelaySec) * 1000;
}

interface Row { failures: number; lastFailureAt: string; nextAllowedAt: string }

async function current(key: string, now: number): Promise<Row | null> {
  const r = await getDb().prepare('SELECT failures, lastFailureAt, nextAllowedAt FROM login_throttle WHERE `key` = ?').get(key) as Row | undefined;
  if (!r) return null;
  // بلا محاولات فاشلة لمدة resetAfterMin → يبدأ العد من جديد.
  if (now - Date.parse(r.lastFailureAt) > shamsPolicy.loginThrottle.resetAfterMin * 60_000) return null;
  return r;
}

/** ms المتبقية قبل السماح بمحاولة جديدة (0 = مسموح). */
export async function retryAfterMs(key: string, now = Date.now()): Promise<number> {
  const r = await current(key, now);
  return r ? Math.max(0, Date.parse(r.nextAllowedAt) - now) : 0;
}

/**
 * Read → increment → write in one transaction: concurrent failed attempts for the same key must each count (the former
 * synchronous code was atomic by construction; with the async driver parallel requests read the same count and lost
 * increments, so the delay grew slower than the policy says).
 */
export async function recordThrottleFailure(key: string, now = Date.now()): Promise<number> {
  return tx(async () => {
    const failures = ((await current(key, now))?.failures ?? 0) + 1;
    const next = new Date(now + delayAfter(failures)).toISOString();
    // `key` is a reserved word in MySQL — quoted (SQLite accepts backtick-quoted identifiers as well).
    await getDb().prepare(`INSERT INTO login_throttle (\`key\`, failures, lastFailureAt, nextAllowedAt) VALUES (?, ?, ?, ?)
      ON CONFLICT(\`key\`) DO UPDATE SET failures = excluded.failures, lastFailureAt = excluded.lastFailureAt, nextAllowedAt = excluded.nextAllowedAt`)
      .run(key, failures, new Date(now).toISOString(), next);
    return failures;
  });
}

/**
 * PA-02 (2026-11-06 audit): the outcome of a password check is applied in ONE transaction together with a fresh throttle
 * check. The early retryAfterMs() check runs before the (async, ~100 ms) bcrypt comparison, so N attempts sent at once all
 * passed it and each got a real "wrong password" answer — the progressive delay did not hold under concurrency. Here an
 * attempt whose key became throttled while its password was being checked gets the same 429 as the early check: it reveals
 * nothing about the password, is not counted, and the account is not touched. Sequential behaviour is unchanged
 * (a key that is not throttled: failure → counted exactly as recordThrottleFailure did; success → row cleared as before), and
 * concurrent CORRECT logins are not penalised (the first success clears the row, the others find it gone).
 */
export async function settleAttempt(key: string, passwordOk: boolean, now = Date.now()): Promise<{ throttledMs: number } | { failures: number } | { cleared: true }> {
  return tx(async () => {
    const r = await current(key, now);
    const wait = r ? Math.max(0, Date.parse(r.nextAllowedAt) - now) : 0;
    if (wait > 0) return { throttledMs: wait };
    if (passwordOk) {
      await clearThrottle(key); // unconditional, as before (also removes an expired row)
      return { cleared: true as const };
    }
    return { failures: await recordThrottleFailure(key, now) };
  });
}

export async function clearThrottle(key: string): Promise<void> {
  await getDb().prepare('DELETE FROM login_throttle WHERE `key` = ?').run(key);
}

/** تنظيف الصفوف القديمة (يُستدعى أحيانًا عند الدخول) — الجدول ليس سجل تدقيق. */
export async function pruneThrottle(): Promise<void> {
  const cutoff = new Date(Date.now() - shamsPolicy.loginThrottle.resetAfterMin * 60_000).toISOString();
  await getDb().prepare('DELETE FROM login_throttle WHERE lastFailureAt < ?').run(cutoff);
}

