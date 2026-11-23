// Shared helpers of the platform load test (host side, Node 22+). Local only: every target is checked before use.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BACKEND = path.join(ROOT, 'backend');
export const STATE = path.join(ROOT, 'perf', '.state');
export const MAIL_DIR = path.join(STATE, 'mail');
export const UPLOAD_DIR = path.join(STATE, 'uploads');
export const DATASET = path.join(STATE, 'dataset.json');
export const RESULTS = path.join(STATE, 'results');
fs.mkdirSync(STATE, { recursive: true });

/** The seeded demo accounts' password (development seed). */
export const SEED_PW = 'Mobadrat@2026';
export const PW = 'PerfLoad2026x';

export const PERF_DB = 'mobadrat_perf';
export const MYSQL_URL = new URL(process.env.MYSQL_PERF_URL ?? 'mysql://root:root@127.0.0.1:3306');

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export function assertLocal(u, what) {
  const url = u instanceof URL ? u : new URL(u);
  if (!LOCAL.has(url.hostname)) throw new Error(`[perf] refusing non-local ${what}: ${url.host} (the load test runs on this machine only)`);
  return url;
}
assertLocal(MYSQL_URL, 'MySQL server');

export function mysqlModule() { return createRequire(path.join(BACKEND, 'package.json'))('mysql2/promise'); }
export async function sql(database) {
  const mysql = mysqlModule();
  return mysql.createConnection({
    host: MYSQL_URL.hostname, port: Number(MYSQL_URL.port || 3306),
    user: decodeURIComponent(MYSQL_URL.username), password: decodeURIComponent(MYSQL_URL.password), database,
  });
}
export function dbUrl() { const u = new URL(MYSQL_URL); u.pathname = `/${PERF_DB}`; return u.toString(); }

/** Deterministic PRNG (mulberry32): the dataset is reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)] };
}

/** A small valid PDF (magic bytes, trailer), unique per tag. */
export function pdf(tag, size = 0) {
  const head = Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n`);
  const tail = Buffer.from('trailer\n<< /Root 1 0 R >>\n%%EOF\n');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length - tail.length), 0x20), tail]);
}

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal API client: Bearer access token, optional base path for an initiative (/i/<id>), synthetic client IP. */
export class Client {
  constructor(api, { ip } = {}) { this.api = assertLocal(api, 'API').toString().replace(/\/$/, ''); this.token = null; this.ip = ip; this.user = null; }
  headers(extra = {}) {
    const h = { ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.ip) h['X-Forwarded-For'] = this.ip;
    return h;
  }
  async req(method, p, body) {
    const headers = this.headers();
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`${this.api}${p}`, { method, headers, body: payload });
      const ct = r.headers.get('content-type') ?? '';
      const json = ct.includes('application/json') ? await r.json() : (await r.arrayBuffer(), null);
      // the dataset server serialises writes; a busy answer is retried (never a business error)
      if ((r.status === 503 || r.status === 429) && attempt < 8) { await sleep(200 * (attempt + 1)); continue; }
      return { status: r.status, json };
    }
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b) { return this.req('PUT', p, b); }
  async login(email, password) {
    const r = await this.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
    this.token = r.json.data.accessToken; this.user = r.json.data.user;
    return this;
  }
  multipart(p, fields, files) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append(f.field, new Blob([new Uint8Array(f.body)], { type: 'application/pdf' }), f.name);
    return this.req('POST', p, fd);
  }
  upload(p, kind, body, name = `${kind}.pdf`) { return this.multipart(p, { kind }, [{ field: 'file', body, name }]); }
}

export function must(r, step, ok = [200, 201]) {
  if (!ok.includes(r.status)) throw new Error(`${step} -> ${r.status} ${JSON.stringify(r.json)?.slice(0, 400)}`);
  return r;
}

/** Runs fn over items with at most n in flight. */
export async function pool(items, n, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** The newest captured e-mail for an address (the dataset server writes every mail to MAIL_DIR). */
export async function mailFor(email, re = /#verify-email\/([a-f0-9]{64})/, timeoutMs = 30_000) {
  const safe = email.replace(/[^\w.@-]/g, '_');
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const files = fs.readdirSync(MAIL_DIR).filter((f) => f.endsWith(`-${safe}.html`)).sort().reverse();
    for (const f of files) {
      const m = re.exec(fs.readFileSync(path.join(MAIL_DIR, f), 'utf8'));
      if (m) return m;
    }
    await sleep(250);
  }
  throw new Error(`no mail matching ${re} for ${email}`);
}

/** Waits until a local server answers /health. */
export async function waitHealthy(origin, timeoutMs = 120_000) {
  assertLocal(origin, 'server');
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const r = await fetch(`${origin}/health`); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`server ${origin} not healthy after ${timeoutMs} ms`);
}
