/**
 * Multi-process harness. Every server is a separate Node process (tests/mp/childServer.ts) with its own SQLite connection
 * to one temporary database file. Coordination is explicit, never a bare sleep:
 *  - FakeRegistry: an HTTP stand-in for the industrial registry that can HOLD verify calls until the test releases them
 *    (the registry await is the only await inside the submit path), and reports how many calls are waiting.
 *  - LockBarrier: the test process takes the SQLite write lock (BEGIN IMMEDIATE on its own connection). Requests sent to
 *    the children run their pre-transaction reads, then block in BEGIN IMMEDIATE (busy_timeout). `waitBlocked` observes that
 *    a child's event loop is stalled (its /health stops answering), which proves it is waiting on the lock, then `release`
 *    lets every waiter compete for the lock at once.
 */
import { fork, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '../helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Child { proc: ChildProcess; pid: number; origin: string; base: string; stop: () => Promise<void> }

export async function spawnServer(env: Record<string, string>): Promise<Child> {
  const proc = fork(path.join(here, 'childServer.ts'), [], {
    execArgv: ['--import', 'tsx'], env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  proc.stderr?.on('data', (d) => { stderr += String(d); });
  const ready = await new Promise<{ port: number; pid: number }>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`child did not start: ${stderr}`)), 60_000);
    proc.on('message', (m: any) => { if (m?.type === 'ready') { clearTimeout(t); resolve(m); } });
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`child exited ${code}: ${stderr}`)); });
  });
  const origin = `http://127.0.0.1:${ready.port}`;
  return {
    proc, pid: ready.pid, origin, base: `${origin}/api/v1`,
    stop: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once('exit', () => r()); proc.send('exit'); setTimeout(() => proc.kill(), 3000).unref(); }),
  };
}

export function spawnCrashChild(env: Record<string, string>): { proc: ChildProcess; inTx: Promise<void> } {
  const proc = fork(path.join(here, 'crashChild.ts'), [], { execArgv: ['--import', 'tsx'], env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  proc.stderr?.on('data', (d) => { stderr += String(d); });
  const inTx = new Promise<void>((resolve, reject) => {
    proc.on('message', (m: any) => { if (m?.type === 'in-tx') resolve(); });
    proc.on('exit', (code) => reject(new Error(`crash child exited early ${code}: ${stderr}`)));
  });
  return { proc, inTx };
}

/** Same session, other process: JWT access tokens are stateless, so a login on one child is valid on every child. */
export function on(c: Client, child: Child): Client {
  const n = new Client(child.base);
  n.token = c.token; n.user = c.user; n.cookies = new Map(c.cookies);
  return n;
}

export class FakeRegistry {
  hold = false;
  calls: string[] = [];
  private waiting: Array<() => void> = [];
  private server!: http.Server;
  url = '';

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const num = decodeURIComponent((req.url ?? '').split('/registrations/')[1] ?? '');
      this.calls.push(num);
      const answer = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ found: true, registration: { number: num, name: 'منشأة اختبار', activity: 'test', governorate: 'cairo', status: 'active' } }));
      };
      if (this.hold) this.waiting.push(answer); else answer();
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Resolves when `n` verify calls are parked (every sender has passed its pre-transaction checks). */
  async waitPending(n: number, timeoutMs = 20_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (this.waiting.length < n) {
      if (Date.now() > until) throw new Error(`only ${this.waiting.length}/${n} registry calls arrived`);
      await new Promise((r) => setImmediate(r));
    }
  }

  release(): void { const w = this.waiting.splice(0); this.hold = false; for (const f of w) f(); }
  close(): Promise<void> { this.release(); return new Promise((r) => this.server.close(() => r())); }
}

/** True when the child's event loop does not answer within `ms` (it is inside SQLite's busy wait, which is synchronous). */
export async function isStalled(child: Child, ms = 300): Promise<boolean> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { await fetch(`${child.origin}/health`, { signal: ac.signal }); return false; } catch { return true; } finally { clearTimeout(t); }
}

export class LockBarrier {
  private db: DatabaseSync;
  held = false;
  heldAt = 0;
  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }
  acquire(): void { this.db.exec('BEGIN IMMEDIATE'); this.held = true; this.heldAt = Date.now(); }
  /** Waits until every child is observed stalled on the lock. Must finish well inside busy_timeout (5 s). */
  async waitBlocked(children: Child[], timeoutMs = 3500): Promise<void> {
    const until = Date.now() + timeoutMs;
    const blocked = new Set<number>();
    while (blocked.size < children.length) {
      if (Date.now() > until) throw new Error(`only ${blocked.size}/${children.length} children blocked on the lock`);
      await Promise.all(children.map(async (c) => { if (!blocked.has(c.pid) && await isStalled(c)) blocked.add(c.pid); }));
    }
  }
  release(): number { const heldFor = Date.now() - this.heldAt; this.db.exec('ROLLBACK'); this.held = false; return heldFor; }
  /** Applies `sql` inside the held write transaction and commits it — a commit that lands while the children wait on the lock. */
  commitWith(sql: string[]): void { for (const s of sql) this.db.exec(s); this.db.exec('COMMIT'); this.held = false; }
  close(): void { if (this.held) this.release(); this.db.close(); }
}

export function integrity(dbPath: string): { integrity: string; fkViolations: number } {
  const d = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const ic = (d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    const fk = d.prepare('PRAGMA foreign_key_check').all().length;
    return { integrity: ic, fkViolations: fk };
  } finally { d.close(); }
}
