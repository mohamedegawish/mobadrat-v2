/**
 * In-flight background work (outbox sends, SLA/recovery sweeps), so a graceful stop can let a running round finish before
 * the database pool closes. Without it a SIGTERM during a send could close the pool after the e-mail/webhook went out but
 * before it was marked sent: the row stays `sending`, is reclaimed after the stale window and is sent a second time.
 */
const running = new Set<Promise<unknown>>();

/** Registers `p` until it settles; returns `p` unchanged. */
export function trackJob<T>(p: Promise<T>): Promise<T> {
  running.add(p);
  const done = () => { running.delete(p); };
  p.then(done, done);
  return p;
}

/** Resolves when every tracked job has settled, or after `timeoutMs` — whichever comes first. Never rejects. */
export async function drainJobs(timeoutMs: number): Promise<boolean> {
  if (!running.size) return true;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref(); });
  const all = Promise.allSettled([...running]).then(() => true as const);
  try { return await Promise.race([all, timeout]); } finally { clearTimeout(timer); }
}

export function runningJobs(): number { return running.size; }
