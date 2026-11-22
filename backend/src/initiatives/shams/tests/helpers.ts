/**
 * Test tools (Shams module on the platform): a throw-away MySQL database per test file, the real platform server on a
 * random port, and an HTTP client with cookies. The client keeps the original application's paths: platform account routes
 * (/auth/login, /auth/refresh, …) go to the core, the rest to /api/v1/i/shams (registration to its public router).
 * isolateTestEnv must run before the first database use (settings are lazy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestEnv { dir: string; cleanup: () => Promise<void> }

/** The platform runs on MySQL only. */
export const onMysql = true;

export const TEST_PASSWORD = 'Shams@2026';
const MODULE_BASE = '/i/shams';

/** Original path → platform path (see the file header). */
export function platformPath(p: string): string {
  if (p.startsWith('/i/') || p === '/me' || p.startsWith('/me/') || p === '/health' || p.startsWith('/initiatives')) return p;
  if (p === '/auth/me') return `${MODULE_BASE}/auth/me`;
  if (p === '/auth/register') return `${MODULE_BASE}/public/register`;
  if (p.startsWith('/auth/recovery/')) return `${MODULE_BASE}/public${p.slice('/auth'.length)}`;
  if (p.startsWith('/auth/')) return p;
  if (p === '/meta' || p.startsWith('/meta?')) return `${MODULE_BASE}/public${p}`;
  return `${MODULE_BASE}${p}`;
}

function mysqlAdminUrl(): string {
  return process.env.MYSQL_TEST_URL || 'mysql://root:root@127.0.0.1:3308';
}

/**
 * A fresh database per test file (`mbt_<tag>_<random>`), created synchronously here because isolateTestEnv runs at module
 * load, and dropped in cleanup. Only names with the mbt_ prefix are ever created or dropped.
 */
function createMysqlTestDatabase(tag: string): string {
  const admin = mysqlAdminUrl();
  const name = `mbt_${tag.replace(/\W/g, '_').slice(0, 24)}_${Math.random().toString(36).slice(2, 8)}`;
  const script = `const m=require('mysql2/promise');(async()=>{const u=new URL(process.argv[1]);const c=await m.createConnection({host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password)});await c.query('CREATE DATABASE \`'+process.argv[2]+'\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin');await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})`;
  const r = spawnSync(process.execPath, ['-e', script, admin, name], { cwd: path.resolve(import.meta.dirname, '..', '..', '..', '..'), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not create MySQL test database ${name}: ${r.stderr}`);
  const u = new URL(admin);
  u.pathname = `/${name}`;
  process.env.DATABASE_URL = u.toString();
  return name;
}

async function dropMysqlTestDatabase(name: string): Promise<void> {
  if (!/^mbt_\w+$/.test(name)) return;
  const mysql = await import('mysql2/promise');
  const u = new URL(mysqlAdminUrl());
  const c = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) });
  try { await c.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await c.end(); }
}

export function isolateTestEnv(tag: string): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shams-${tag}-`));
  process.env.NODE_ENV = 'test';
  const mysqlDb = createMysqlTestDatabase(tag);
  // Tests that use the database directly (without startServer) need the module migrations registered too.
  void import('../../../core/boot.js').then((m) => m.registerModuleMigrations());
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.APP_URL = 'http://localhost:5173';
  process.env.JOBS_DISABLED = '1';
  process.env.REGISTRY_ADAPTER = 'mock';
  process.env.BCRYPT_ROUNDS = '4';
  process.env.SEED_PASSWORD = TEST_PASSWORD;
  process.env.RATE_LIMIT_SCALE = process.env.KEEP_RATE_LIMITS === '1' ? '1' : '1000';
  delete process.env.SHAMS_WEBHOOK_URL;
  delete process.env.SHAMS_WEBHOOK_SECRET;
  delete process.env.GMAIL_USER;
  delete process.env.SMTP_HOST;
  return {
    dir,
    cleanup: async () => {
      const { closeDb } = await import('../db/sqlite.js');
      await closeDb();
      await new Promise((r) => setTimeout(r, 50));
      fs.rmSync(dir, { recursive: true, force: true });
      await dropMysqlTestDatabase(mysqlDb);
    },
  };
}

export const sentMails: Array<{ to: string[]; subject: string; html: string; text: string; attachments: Array<{ cid?: string; filename: string }> }> = [];
export const sentSms: Array<{ to: string; text: string }> = [];

export interface Started { base: string; integration: string; origin: string; close: () => Promise<void> }

let booted = false;

/** Migrates (core + modules), seeds the platform and module demo data, and starts the platform server. */
export async function startServer(): Promise<Started> {
  const { bootPlatform } = await import('../../../core/boot.js');
  const { seedIfEmpty } = await import('../../../core/seed.js');
  const { createApp } = await import('../../../app.js');
  const { setMailSenderForTests } = await import('../mail/mailer.js');
  const { setSmsAdapterForTests } = await import('../integrations/sms/index.js');
  if (!booted) { await bootPlatform(); booted = true; }
  await seedIfEmpty();
  setMailSenderForTests(async (m) => { sentMails.push({ to: m.to, subject: m.subject, html: m.html, text: m.text, attachments: (m.attachments ?? []).map((a) => ({ cid: a.cid, filename: a.filename })) }); return 'sent'; });
  setSmsAdapterForTests({ name: 'test', send: async (to, text) => { sentSms.push({ to, text }); } });
  const app = createApp();
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    base: `${origin}/api/v1`, integration: `${origin}/api/integration/v1/i/shams`, origin,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export interface Res<T = any> { status: number; json: T; headers: Headers; raw?: Buffer }

/** عميل HTTP يحفظ كوكي refresh ويستخدم access token في الذاكرة — مثل الواجهة. */
export class Client {
  token: string | null = null;
  cookies = new Map<string, string>();
  user: any = null;
  /** عند true: انتهاء الجلسة بسبب إيقاف الحساب/إعادة تعيينه (M1: TOKEN_REVOKED) يُعالج بتسجيل دخول واحد ثم إعادة الطلب. */
  autoRelogin = false;
  private creds: { email: string; password: string } | null = null;
  constructor(public base: string) {}

  private cookieHeader(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }

  keepCookies(h: Headers) {
    for (const c of (h as any).getSetCookie?.() ?? []) {
      const [pair] = String(c).split(';');
      const [k, ...v] = pair.split('=');
      const value = v.join('=');
      if (!value || /Expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(k.trim()); else this.cookies.set(k.trim(), value);
    }
  }

  async req<T = any>(method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    const r = await fetch(`${this.base}${platformPath(p)}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.keepCookies(r.headers);
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const json = await r.json();
      if (r.status === 401 && json?.code === 'TOKEN_REVOKED' && this.autoRelogin && this.creds && !extra['x-retried']) {
        const keep = { token: this.token, cookies: new Map(this.cookies) };
        this.token = null; this.cookies.clear();
        try {
          await this.login(this.creds.email, this.creds.password);
          return this.req<T>(method, p, body, { ...extra, 'x-retried': '1' });
        } catch {
          this.token = keep.token; this.cookies = keep.cookies; // الحساب موقوف فعلًا: نرجع الرد الأصلي
        }
      }
      return { status: r.status, json, headers: r.headers };
    }
    const raw = Buffer.from(await r.arrayBuffer());
    return { status: r.status, json: null as T, headers: r.headers, raw };
  }

  get<T = any>(p: string) { return this.req<T>('GET', p); }
  post<T = any>(p: string, body: unknown = {}) { return this.req<T>('POST', p, body); }
  put<T = any>(p: string, body: unknown) { return this.req<T>('PUT', p, body); }
  del<T = any>(p: string) { return this.req<T>('DELETE', p); }

  async login(email: string, password = 'Shams@2026'): Promise<this> {
    const r = await this.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.json)}`);
    this.token = r.json.data.accessToken;
    this.user = r.json.data.user;
    this.creds = { email, password };
    // The Shams view of the person (role, organization, factory account status), as the original /auth/login returned.
    const me = await this.get('/auth/me');
    if (me.status === 200) this.user = me.json.data.user;
    return this;
  }

  /** multipart بعدة ملفات (تسجيل المصنع: payload + المستندات). */
  async multipart(p: string, fields: Record<string, string>, files: Array<{ field: string; body: Buffer; name?: string; mime?: string }>): Promise<Res> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append(f.field, new Blob([new Uint8Array(f.body)], { type: f.mime ?? 'application/pdf' }), f.name ?? `${f.field}.pdf`);
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const r = await fetch(`${this.base}${platformPath(p)}`, { method: 'POST', headers, body: fd });
    this.keepCookies(r.headers);
    return { status: r.status, json: await r.json(), headers: r.headers };
  }

  async upload(p: string, fields: Record<string, string>, file: Buffer | null, filename = 'doc.pdf', mime = 'application/pdf'): Promise<Res> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append('file', new Blob([new Uint8Array(file)], { type: mime }), filename);
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const r = await fetch(`${this.base}${platformPath(p)}`, { method: 'POST', headers, body: fd });
    return { status: r.status, json: await r.json(), headers: r.headers };
  }
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
export function pdfVariant(tag: string): Buffer { return Buffer.concat([PDF, Buffer.from(`% ${tag}\n`)]); }

export const DEV = {
  admin: 'admin@shams.local', imc1: 'imc1@shams.local', imc2: 'imc2@shams.local', encpc: 'encpc@shams.local', pmu: 'pmu@shams.local',
  factory: 'factory@shams.local', factory2: 'factory2@shams.local',
};
export const BANK_A = 'org-bank-demo-a';
export const BANK_B = 'org-bank-demo-b';
export const PROVIDER_OK = 'sp-demo-1';
export const PROVIDER_PENDING = 'sp-demo-3';
export const PROVIDER_SUSPENDED = 'sp-demo-4';

export function completeSections(regNumber: string) {
  return {
    general: { companyName: 'مصنع تجريبي للصناعات المعدنية', governorate: 'sharqia', industrialZone: '10th-ramadan', address: 'المنطقة الصناعية الثالثة', phone1: '0221234567' },
    contact: { contactName: 'م. أحمد', contactTitle: 'مدير المصنع', contactMobile: '01012345678', contactEmail: 'contact@factory.test' },
    company: { commercialRegisterNumber: 'CR-12345', industrialRegistryNumber: regNumber, taxNumber: '123-456-789' },
    engineering: {
      roofAreas: [{ name: 'السطح الرئيسي', area: 1500 }, { name: 'المخزن', area: 800.5 }],
      contractedCapacity: 1000, capacityUnit: 'kVA', peakLoad: 750, loadUnit: 'kW', ownershipType: 'owned', ownershipExpiresAt: '2040-12-31',
    },
  };
}

export const FORM_DOCS = ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'ownershipProofFile'] as const;

/** ينشئ مسودة مكتملة (بيانات + مستندات) ويرجع الطلب. */
export async function createCompleteDraft(factory: Client, regNumber = 'IND-2026-1001') {
  const created = await factory.post('/applications', {});
  if (created.status !== 201) throw new Error(`create draft failed ${created.status} ${JSON.stringify(created.json)}`);
  const id = created.json.data.id as string;
  for (const [section, data] of Object.entries(completeSections(regNumber))) {
    const r = await factory.put(`/applications/${id}/data/${section}`, data);
    if (r.status !== 200) throw new Error(`save ${section} failed ${r.status} ${JSON.stringify(r.json)}`);
  }
  for (const kind of FORM_DOCS) {
    const r = await factory.upload(`/applications/${id}/documents`, { kind }, pdfVariant(kind));
    if (r.status !== 201) throw new Error(`upload ${kind} failed ${r.status} ${JSON.stringify(r.json)}`);
  }
  for (let i = 0; i < 3; i++) {
    const r = await factory.upload(`/applications/${id}/documents`, { kind: 'electricityBill' }, pdfVariant(`bill-${i}`), `bill-${i}.pdf`);
    if (r.status !== 201) throw new Error(`upload bill failed ${r.status} ${JSON.stringify(r.json)}`);
  }
  return id;
}

export async function getApp(c: Client, id: string) {
  const r = await c.get(`/applications/${id}`);
  if (r.status !== 200) throw new Error(`get app ${id} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data;
}

/** ينفذ إجراء بالنسخة الحالية للطلب. */
export async function act(c: Client, id: string, action: string, body: Record<string, unknown> = {}) {
  const app = await getApp(c, id);
  return c.post(`/applications/${id}/actions/${action}`, { expectedVersion: app.version, ...body });
}

export async function q<T = any>(sql: string, ...params: Array<string | number | null>): Promise<T[]> {
  const { getDb } = await import('../db/sqlite.js');
  return await getDb().prepare(sql).all(...params) as T[];
}

/**
 * يأخذ الطلب من المسودة حتى حالة معينة على المسار الرئيسي.
 * BANK_SELECTION = قبلت PMU موافقة الكهرباء والمصنع لم يختر البنك بعد (الحالة CONTRACT_OUTCOME بلا بنك — G-01).
 * CONTRACT_OUTCOME = اختار المصنع البنك وينتظر تسجيل النتيجة (لا حساب ولا قرار للبنك — G-02).
 */
export async function advanceTo(
  target: 'IMC_REVIEW' | 'ENCPC_REVIEW' | 'PROVIDER_SELECTION' | 'OFFER_REVIEW' | 'ELECTRICITY_UPLOAD' | 'ELECTRICITY_REVIEW' | 'BANK_SELECTION' | 'CONTRACT_OUTCOME'
    | 'DISTRIBUTION_UPLOAD' | 'DISTRIBUTION_REVIEW',
  c: { factory: Client; imc: Client; encpc: Client; pmu: Client }, regNumber: string, bank = BANK_A,
): Promise<string> {
  const ok = (r: Res, step: string) => { if (r.status !== 200) throw new Error(`${step} -> ${r.status} ${JSON.stringify(r.json)}`); };
  const id = await createCompleteDraft(c.factory, regNumber);
  ok(await act(c.factory, id, 'submit'), 'submit');
  if (target === 'IMC_REVIEW') return id;
  ok(await act(c.imc, id, 'accept'), 'imc accept');
  if (target === 'ENCPC_REVIEW') return id;
  ok(await act(c.encpc, id, 'compliant'), 'encpc compliant');
  if (target === 'PROVIDER_SELECTION') return id;
  ok(await act(c.factory, id, 'select_provider', { providerId: PROVIDER_OK }), 'select provider');
  const up = await c.factory.upload(`/applications/${id}/documents`, { kind: 'technicalOfferFile' }, pdfVariant('offer-1'), 'offer.pdf');
  if (up.status !== 201) throw new Error(`offer upload ${up.status}`);
  ok(await act(c.factory, id, 'submit_offer'), 'submit offer');
  if (target === 'OFFER_REVIEW') return id;
  ok(await act(c.pmu, id, 'accept'), 'pmu accept offer');
  if (target === 'ELECTRICITY_UPLOAD') return id;
  const up2 = await c.factory.upload(`/applications/${id}/documents`, { kind: 'electricityApprovalFile' }, pdfVariant('elec-1'), 'approval.pdf');
  if (up2.status !== 201) throw new Error(`approval upload ${up2.status}`);
  ok(await act(c.factory, id, 'submit_electricity', { distributionCompany: 'شركة توزيع (اختبار)' }), 'submit electricity');
  if (target === 'ELECTRICITY_REVIEW') return id;
  ok(await act(c.pmu, id, 'accept'), 'pmu accept electricity');
  if (target === 'BANK_SELECTION') return id;
  // المسار الثاني: التعاقد عن طريق شركة توزيع الكهرباء (رفع موافقتها ثم مراجعة PMU).
  if (target === 'DISTRIBUTION_UPLOAD' || target === 'DISTRIBUTION_REVIEW') {
    ok(await act(c.factory, id, 'select_distribution_path'), 'select distribution path');
    if (target === 'DISTRIBUTION_UPLOAD') return id;
    await uploadDistributionApproval(c.factory, id, 'dist-1');
    ok(await act(c.factory, id, 'submit_distribution_approval'), 'submit distribution approval');
    return id;
  }
  ok(await act(c.factory, id, 'select_bank', { bankOrgId: bank }), 'select bank');
  return id;
}

/** يرفع موافقة شركة توزيع الكهرباء على التعاقد (مسار التعاقد الثاني). */
export async function uploadDistributionApproval(factory: Client, id: string, tag = 'distribution') {
  const r = await factory.upload(`/applications/${id}/documents`, { kind: 'distributionApprovalFile' }, pdfVariant(tag), `${tag}.pdf`);
  if (r.status !== 201) throw new Error(`distribution approval upload ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data;
}

/** يرفع مستند إثبات التعاقد (G-03) — مطلوب قبل «تم التعاقد». */
export async function uploadContractFile(factory: Client, id: string, tag = 'contract') {
  const r = await factory.upload(`/applications/${id}/documents`, { kind: 'contractFile' }, pdfVariant(tag), `${tag}.pdf`);
  if (r.status !== 201) throw new Error(`contract upload ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data;
}

export async function clients(base: string) {
  // G-02: لا حسابات للبنوك — لا عميل بنك.
  const [factory, factory2, imc, imc2, encpc, pmu, admin] = await Promise.all([
    new Client(base).login(DEV.factory), new Client(base).login(DEV.factory2), new Client(base).login(DEV.imc1), new Client(base).login(DEV.imc2),
    new Client(base).login(DEV.encpc), new Client(base).login(DEV.pmu), new Client(base).login(DEV.admin),
  ]);
  for (const cl of [factory, factory2, imc, imc2, encpc, pmu, admin]) cl.autoRelogin = true;
  return { factory, factory2, imc, imc2, encpc, pmu, admin };
}


/** مستندات نموذج التسجيل كاملة (4 مفردة + فاتورتان) لـ POST /auth/register. */
export function registrationFiles(tag = 'reg'): Array<{ field: string; body: Buffer; name: string }> {
  return [...FORM_DOCS.map((k) => ({ field: k as string, body: pdfVariant(`${tag}-${k}`), name: `${k}.pdf` })),
    { field: 'electricityBill', body: pdfVariant(`${tag}-bill-1`), name: 'bill-1.pdf' }, { field: 'electricityBill', body: pdfVariant(`${tag}-bill-2`), name: 'bill-2.pdf' }];
}

/** payload التسجيل: الحساب + الأقسام الأربعة كاملة (رقم السجل `regNumber`). */
export function registrationPayload(email: string, regNumber: string, over: Record<string, unknown> = {}) {
  const s = completeSections(regNumber);
  const { companyName: _c, ...general } = s.general; void _c;
  return {
    companyName: 'مصنع التسجيل الذاتي', contactName: 'م. سامي', email, mobile: '01033334444', password: 'Factory123',
    application: { general, contact: { contactTitle: 'مدير المصنع' }, company: s.company, engineering: s.engineering },
    ...over,
  };
}

/** POST /auth/register كاملًا (multipart). */
export async function registerFactory(c: Client, payload: Record<string, unknown>, files = registrationFiles(String(payload.email))): Promise<Res> {
  return c.multipart('/auth/register', { payload: JSON.stringify(payload) }, files);
}

/** رابط التفعيل من آخر بريد للعنوان (بعد معالجة الطابور). */
export async function activationTokenFor(email: string): Promise<string> {
  const { processNotifications } = await import('../jobs/notificationWorker.js');
  await processNotifications(200);
  const mail = [...sentMails].reverse().find((m) => m.to.includes(email) && /#verify-email\//.test(m.html));
  if (!mail) throw new Error(`no activation email for ${email}`);
  return /#verify-email\/([a-f0-9]{64})/.exec(mail.html)![1];
}
