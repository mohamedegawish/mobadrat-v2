/**
 * Platform (core) test tools: a throw-away MySQL database per test file, the real server on a random port, and an HTTP
 * client with cookies (paths are the platform's own: /auth/*, /me/*, /admin/*, /i/<module>/*).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const PASSWORD = 'Mobadrat@2026';

function adminUrl(): string { return process.env.MYSQL_TEST_URL || 'mysql://root:root@127.0.0.1:3308'; }

export function isolateTestEnv(tag: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `core-${tag}-`));
  const name = `mbt_core_${tag.replace(/\W/g, '_').slice(0, 20)}_${Math.random().toString(36).slice(2, 8)}`;
  const script = `const m=require('mysql2/promise');(async()=>{const u=new URL(process.argv[1]);const c=await m.createConnection({host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password)});await c.query('CREATE DATABASE \`'+process.argv[2]+'\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin');await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})`;
  const r = spawnSync(process.execPath, ['-e', script, adminUrl(), name], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not create MySQL test database: ${r.stderr}`);
  const u = new URL(adminUrl()); u.pathname = `/${name}`;
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_URL: u.toString(), UPLOAD_DIR: path.join(dir, 'uploads'), CORS_ORIGIN: 'http://localhost:5173', APP_URL: 'http://localhost:5173',
    JOBS_DISABLED: '1', REGISTRY_ADAPTER: 'mock', BCRYPT_ROUNDS: '4', RATE_LIMIT_SCALE: '1000', SEED_PASSWORD: PASSWORD,
  });
  delete process.env.GMAIL_USER; delete process.env.SMTP_HOST;
  return {
    dir,
    cleanup: async () => {
      const { closeDb } = await import('../src/core/db/index.js');
      await closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
      const mysql = await import('mysql2/promise');
      const a = new URL(adminUrl());
      const c = await mysql.createConnection({ host: a.hostname, port: Number(a.port || 3306), user: decodeURIComponent(a.username), password: decodeURIComponent(a.password) });
      try { await c.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await c.end(); }
    },
  };
}

export const sentMails: Array<{ to: string[]; subject: string; html: string }> = [];

export async function startServer(opts: { seed?: boolean } = {}) {
  const { bootPlatform } = await import('../src/core/boot.js');
  const { seedIfEmpty } = await import('../src/core/seed.js');
  const { createApp } = await import('../src/app.js');
  const { setMailSenderForTests } = await import('../src/core/mail/mailer.js');
  await bootPlatform();
  if (opts.seed !== false) await seedIfEmpty();
  setMailSenderForTests(async (m) => { sentMails.push({ to: m.to, subject: m.subject, html: m.html }); return 'sent'; });
  const app = createApp();
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base: `${origin}/api/v1`, origin, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export async function flushMail(): Promise<void> {
  const { processNotifications } = await import('../src/core/jobs/notificationWorker.js');
  await processNotifications(500);
}

export async function tokenFromMail(email: string, kind: 'verify-email' | 'reset-password'): Promise<string> {
  await flushMail();
  const m = [...sentMails].reverse().find((x) => x.to.includes(email) && x.html.includes(`#${kind}/`));
  if (!m) throw new Error(`no ${kind} mail for ${email}`);
  return new RegExp(`#${kind}/([a-f0-9]{64})`).exec(m.html)![1];
}

export interface Res<T = any> { status: number; json: T }

export class Client {
  token: string | null = null;
  cookies = new Map<string, string>();
  constructor(public base: string) {}
  async req<T = any>(method: string, p: string, body?: unknown): Promise<Res<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(`${this.base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of (r.headers as any).getSetCookie?.() ?? []) { const [pair] = String(c).split(';'); const [k, ...v] = pair.split('='); this.cookies.set(k.trim(), v.join('=')); }
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, json: ct.includes('json') ? await r.json() : null as T };
  }
  get<T = any>(p: string) { return this.req<T>('GET', p); }
  post<T = any>(p: string, b: unknown = {}) { return this.req<T>('POST', p, b); }
  put<T = any>(p: string, b: unknown) { return this.req<T>('PUT', p, b); }
  async login(email: string, password = PASSWORD): Promise<this> {
    const r = await this.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.json)}`);
    this.token = r.json.data.accessToken;
    return this;
  }
  async upload(p: string, fields: Record<string, string>, file: Buffer, name = 'doc.pdf'): Promise<Res> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    fd.append('file', new Blob([new Uint8Array(file)], { type: 'application/pdf' }), name);
    const r = await fetch(`${this.base}${p}`, { method: 'POST', headers: this.token ? { Authorization: `Bearer ${this.token}` } : {}, body: fd });
    return { status: r.status, json: await r.json() };
  }
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
export const pdf = (tag: string) => Buffer.concat([PDF, Buffer.from(`% ${tag}\n`)]);

/** Registers on the platform (no initiative), verifies the e-mail and signs in. */
export async function newPerson(base: string, email: string, fullName = 'مواطن تجريبي'): Promise<Client> {
  const c = new Client(base);
  const r = await c.post('/auth/register', { fullName, email, mobile: '01011112222', password: PASSWORD });
  if (r.status !== 201) throw new Error(`register: ${r.status} ${JSON.stringify(r.json)}`);
  const v = await c.post('/auth/verify-email', { token: await tokenFromMail(email, 'verify-email') });
  if (v.status !== 200) throw new Error(`verify: ${v.status}`);
  return c.login(email);
}
