/**
 * Test tools (Sona3 module on the platform): a throw-away MySQL database per test file, the real platform server on a
 * random port, and an HTTP client with cookies. The client keeps the original application's paths: platform account routes
 * (/auth/login, /auth/refresh, …) go to the core, the rest to /api/v1/i/sona3 (registration/meta/site content to its public
 * router). Accounts and the cohort are created directly through the stores (no demo seed).
 * isolateTestEnv must run before the first database use (settings are lazy).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface TestEnv { dir: string; cleanup: () => Promise<void> }

const MODULE_BASE = '/i/sona3';

/** Original path → platform path (see the file header). */
export function platformPath(p: string): string {
  if (p.startsWith('/i/') || p === '/me' || p.startsWith('/me/') || p === '/health' || p.startsWith('/initiatives')) return p;
  if (p === '/auth/me') return `${MODULE_BASE}/auth/me`;
  if (p === '/auth/register') return `${MODULE_BASE}/public/register`;
  if (p.startsWith('/auth/')) return p;
  if (p === '/meta' || p.startsWith('/meta?') || p === '/site-content') return `${MODULE_BASE}/public${p}`;
  return `${MODULE_BASE}${p}`;
}

function mysqlAdminUrl(): string {
  return process.env.MYSQL_TEST_URL || 'mysql://root:root@127.0.0.1:3308';
}

function createMysqlTestDatabase(tag: string): string {
  const admin = mysqlAdminUrl();
  const name = `mbt_s3_${tag.replace(/\W/g, '_').slice(0, 20)}_${Math.random().toString(36).slice(2, 8)}`;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sona3-${tag}-`));
  process.env.NODE_ENV = 'test';
  const mysqlDb = createMysqlTestDatabase(tag);
  void import('../../../core/boot.js').then((m) => m.registerModuleMigrations());
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.APP_URL = 'http://localhost:5173';
  process.env.JOBS_DISABLED = '1';
  process.env.REGISTRY_ADAPTER = 'mock';
  process.env.BCRYPT_ROUNDS = '4';
  process.env.RATE_LIMIT_SCALE = process.env.KEEP_RATE_LIMITS === '1' ? '1' : '1000';
  delete process.env.SONA3_WEBHOOK_URL;
  delete process.env.SONA3_WEBHOOK_SECRET;
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

export const sentMails: Array<{ to: string[]; subject: string; html: string; text: string }> = [];
export const sentSms: Array<{ to: string; text: string }> = [];

export interface Started { base: string; integration: string; origin: string; close: () => Promise<void> }

let booted = false;

/** The real platform server on a clean database (migrations + reference data only; no demo seed). */
export async function startServer(): Promise<Started> {
  const { bootPlatform } = await import('../../../core/boot.js');
  const { createApp } = await import('../../../app.js');
  const { setMailSenderForTests } = await import('../mail/mailer.js');
  const { setSmsAdapterForTests } = await import('../integrations/sms/index.js');
  if (!booted) { await bootPlatform(); booted = true; }
  setMailSenderForTests(async (m) => { sentMails.push({ to: m.to, subject: m.subject, html: m.html, text: m.text }); return 'sent'; });
  setSmsAdapterForTests({ name: 'test', send: async (to, text) => { sentSms.push({ to, text }); } });
  const app = createApp();
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    base: `${origin}/api/v1`, integration: `${origin}/api/integration/v1/i/sona3`, origin,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export interface Res<T = any> { status: number; json: T; headers: Headers; raw?: Buffer }

export const PASSWORD = 'Test@2026x';

/** عميل HTTP يحفظ كوكي refresh ويستخدم access token في الذاكرة — مثل الواجهة. */
export class Client {
  token: string | null = null;
  cookies = new Map<string, string>();
  user: any = null;
  constructor(public base: string) {}

  private cookieHeader(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }

  private keepCookies(h: Headers) {
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
    if (ct.includes('application/json')) return { status: r.status, json: await r.json(), headers: r.headers };
    const raw = Buffer.from(await r.arrayBuffer());
    return { status: r.status, json: null as T, headers: r.headers, raw };
  }

  async get<T = any>(p: string) { return await this.req<T>('GET', p); }
  async post<T = any>(p: string, body: unknown = {}) { return await this.req<T>('POST', p, body); }
  async put<T = any>(p: string, body: unknown) { return await this.req<T>('PUT', p, body); }
  async del<T = any>(p: string) { return await this.req<T>('DELETE', p); }

  async login(email: string, password = PASSWORD): Promise<this> {
    const r = await this.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.json)}`);
    this.token = r.json.data.accessToken;
    this.user = r.json.data.user;
    const me = await this.get('/auth/me');
    if (me.status === 200) this.user = me.json.data.user;
    return this;
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

// ── التواريخ والرقم القومي ──────────────────────────────────────────────────

export const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const todayIso = (): string => iso(new Date());
export function addDays(date: string, n: number): string { return iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000)); }
export function addYears(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return iso(d);
}

let nidSeq = 1000;
/** رقم قومي صالح البنية لتاريخ ميلاد معين (كود محافظة 01 = القاهرة). */
export function nationalIdFor(birthDate: string, seq = ++nidSeq, gov = '01'): string {
  const year = Number(birthDate.slice(0, 4));
  const c = year >= 2000 ? '3' : '2';
  return `${c}${birthDate.slice(2, 4)}${birthDate.slice(5, 7)}${birthDate.slice(8, 10)}${gov}${String(seq % 10000).padStart(4, '0')}1`;
}

// ── العالم: دورة + حسابات الجهات ────────────────────────────────────────────

export interface World {
  base: string;
  cohortId: string;
  closesAt: string;
  imc: Client; imc2: Client;
  eval1: Client; eval2: Client; eval3: Client;
  funderA: Client; funderB: Client;
  admin: Client;
  funderAOrg: string; funderBOrg: string;
}

let counter = 0;

async function mkUser(role: string, org: string, email: string, name: string) {
  const { createUser } = await import('../store/users.js');
  const { hashPassword } = await import('../auth/jwt.js');
  return createUser({ organizationId: org, role: role as any, email, nameAr: name, nameEn: name, phone: '', passwordHash: hashPassword(PASSWORD), emailVerified: true });
}

export interface CohortOpts {
  selectionTarget?: number; evaluationTarget?: number; maxAge?: number; ageReference?: 'cohort_close' | 'submission';
  weights?: Record<string, number>; minTotalScore?: number; minFinancialScore?: number; minTechnicalScore?: number; minEvaluators?: number;
  opensAt?: string; closesAt?: string;
}

export async function makeCohort(opts: CohortOpts = {}) {
  const { createCohort } = await import('../store/cohorts.js');
  return createCohort({ nameAr: 'دورة اختبار', nameEn: 'Test cohort', opensAt: addDays(todayIso(), -30), closesAt: addDays(todayIso(), 90), ...(opts as any) }, null);
}

/** يبني الدورة والحسابات الثابتة لكل ملف اختبار. يُستدعى بعد startServer. */
export async function buildWorld(srv: Started, opts: CohortOpts = {}): Promise<World> {
  const { ORG_IDS } = await import('../domain.js');
  const { createOrganization } = await import('../store/organizations.js');
  const cohort = await makeCohort(opts);
  const fa = await createOrganization({ type: 'funder', nameAr: 'صندوق تحيا مصر (اختبار)', nameEn: 'Funder A (test)' });
  const fb = await createOrganization({ type: 'funder', nameAr: 'بنك تمويل (اختبار)', nameEn: 'Funder B (test)' });
  await mkUser('evaluator', ORG_IDS.committee, 't3.eval1@sona3.test', 'مقيّم 1');
  await mkUser('evaluator', ORG_IDS.committee, 't3.eval2@sona3.test', 'مقيّم 2');
  await mkUser('evaluator', ORG_IDS.committee, 't3.eval3@sona3.test', 'مقيّم 3');
  await mkUser('imc_officer', ORG_IDS.imc, 't3.imc1@sona3.test', 'مسؤول IMC 1');
  await mkUser('imc_officer', ORG_IDS.imc, 't3.imc2@sona3.test', 'مسؤول IMC 2');
  await mkUser('funder_reviewer', fa.id, 't3.funda@sona3.test', 'مسؤول جهة التمويل أ');
  await mkUser('funder_reviewer', fb.id, 't3.fundb@sona3.test', 'مسؤول جهة التمويل ب');
  await mkUser('system_admin', ORG_IDS.admin, 't3.admin@sona3.test', 'مدير النظام');
  const L = async (e: string) => await new Client(srv.base).login(e);
  const [imc, imc2, eval1, eval2, eval3, funderA, funderB, admin] = await Promise.all([
    L('t3.imc1@sona3.test'), L('t3.imc2@sona3.test'), L('t3.eval1@sona3.test'), L('t3.eval2@sona3.test'), L('t3.eval3@sona3.test'),
    L('t3.funda@sona3.test'), L('t3.fundb@sona3.test'), L('t3.admin@sona3.test'),
  ]);
  return {
    base: srv.base, cohortId: cohort.id, closesAt: cohort.closesAt, imc, imc2, eval1, eval2, eval3, funderA, funderB, admin,
    funderAOrg: fa.id, funderBOrg: fb.id,
  };
}

/** متقدم جديد (جهة applicant + ملف + مستخدم) يسجل دخوله ويرجع العميل. */
export async function newApplicant(srv: Started, name = 'أحمد محمد علي حسن'): Promise<Client> {
  const { createOrganization } = await import('../store/organizations.js');
  const { createApplicant } = await import('../store/applicants.js');
  const n = ++counter;
  const org = await createOrganization({ type: 'applicant', nameAr: name, nameEn: name });
  await createApplicant(org.id, name, null);
  const email = `t3.app${n}@sona3.test`;
  await mkUser('applicant', org.id, email, name);
  return new Client(srv.base).login(email);
}

// ── الاستمارة والدراسة ──────────────────────────────────────────────────────

export interface FormOpts { birthDate?: string; nationalId?: string; nationality?: string; requestedFunding?: number; estimatedCost?: number }

export function applicationSections(o: FormOpts = {}) {
  const birthDate = o.birthDate ?? '1995-05-15';
  return {
    personal: {
      fullName: 'أحمد محمد علي حسن', nationalId: o.nationalId ?? nationalIdFor(birthDate), birthDate, nationality: o.nationality ?? 'egyptian',
      ...(o.nationality === 'other' ? { nationalityOther: 'سودانية' } : {}),
      governorate: 'cairo', address: '12 شارع التحرير، القاهرة', phone: '01012345678', email: 'applicant@test.local',
      qualification: 'بكالوريوس هندسة ميكانيكا', experience: 'خمس سنوات في التصنيع',
    },
    team: { applicationType: 'individual' },
    project: { projectName: 'مصنع قطع غيار', sector: 'manufacturing', projectStage: 'new_idea', projectGovernorate: 'sharqia', projectLocation: 'العاشر من رمضان' },
    idea: {
      ideaDescription: 'تصنيع قطع غيار صناعية بديلة للمستورد بجودة عالية', problem: 'الاعتماد على الاستيراد', targetCustomers: 'مصانع محلية',
      competitiveAdvantage: 'سعر أقل وتوريد أسرع',
    },
    readiness: {
      startTimeline: 'immediate', estimatedCost: o.estimatedCost ?? 500000, requestedFunding: o.requestedFunding ?? 300000, hasOwnFunding: false,
    },
    declarations: { declTermsRead: true, declDataTrue: true, declConfidentiality: true, declParticipation: true },
  };
}

export function studySections(planAmounts: number[] = [100000, 200000]) {
  const requested = planAmounts.reduce((s, x) => s + x, 0);
  return {
    study_market: {
      productName: 'قطع غيار', technicalDescription: 'وصف فني تفصيلي', marketProblem: 'نقص المعروض المحلي', competitiveEdge: 'تكلفة أقل',
      targetSegment: 'مصانع', annualDemand: '10000 وحدة', importSubstitution: false, competitors: 'مستوردون', pricing: 'أقل 15%', salesChannels: 'مباشر',
    },
    study_technical: {
      productionCapacity: '1000 وحدة شهريًا', technologyLevel: 'semi_auto',
      assets: [{ item: 'ماكينة CNC', specs: '3 محاور', quantity: 1, cost: 250000 }],
      materials: [{ name: 'صلب', source: 'local', monthlyQuantity: '2 طن', monthlyCost: 40000 }],
      directWorkers: 5, indirectWorkers: 2, monthlyPayroll: 60000, siteArea: 200, utilities: 'كهرباء ومياه', licenses: 'ترخيص صناعي',
    },
    study_financial: {
      establishmentCosts: 50000, workingCapital: 150000, requestedFinancing: requested, preferredModel: 'soft_loan',
      firstYearRevenue: 1200000, firstYearCosts: 800000, paybackYears: 2.5, breakEvenPercent: 55,
    },
    study_risks: {
      marketRisk: 'انخفاض الطلب', marketMitigation: 'تنويع العملاء', operationalRisk: 'تأخر الخامات', operationalMitigation: 'مخزون أمان',
      financialRisk: 'تقلب الأسعار', financialMitigation: 'عقود آجلة',
    },
    study_impact: { directJobs: 7, indirectJobs: 10, localValueAdded: 'مكوّن محلي مرتفع', environmentalImpact: 'أثر بيئي محدود' },
    study_plan: { phases: planAmounts.map((amount, i) => ({ title: `المرحلة ${i + 1}`, weeks: 8, amount })) },
  };
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

export function ok(r: Res, step: string): Res {
  if (r.status < 200 || r.status >= 300) throw new Error(`${step} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r;
}

export async function q<T = any>(sql: string, ...params: Array<string | number | null>): Promise<T[]> {
  const { getDb } = await import('../db/sqlite.js');
  return await getDb().prepare(sql).all(...params) as T[];
}

/** مسودة مكتملة (بيانات + بطاقة الرقم القومي). */
export async function createCompleteDraft(a: Client, o: FormOpts = {}): Promise<string> {
  const created = ok(await a.post('/applications', {}), 'create draft');
  const id = created.json.data.id as string;
  for (const [section, data] of Object.entries(applicationSections(o))) ok(await a.put(`/applications/${id}/data/${section}`, data), `save ${section}`);
  ok(await a.upload(`/applications/${id}/documents`, { kind: 'nationalIdFile' }, pdfVariant('nid')), 'upload national id');
  return id;
}

export async function fillStudy(a: Client, id: string, planAmounts?: number[]) {
  for (const [section, data] of Object.entries(studySections(planAmounts))) ok(await a.put(`/applications/${id}/data/${section}`, data), `save ${section}`);
}

export const GOOD_SCORES = { financial: 80, technical: 80, market: 80, innovation: 80, jobs: 80, team: 80 };
export function scoresAll(n: number) { return { financial: n, technical: n, market: n, innovation: n, jobs: n, team: n }; }

export type Stage =
  | 'ELIGIBILITY_REVIEW' | 'STUDY_PREPARATION' | 'STUDY_REVIEW' | 'COMMITTEE_EVALUATION' | 'EVALUATED' | 'SELECTED'
  | 'FUNDING_SEARCH' | 'FUNDER_REVIEW' | 'IMPLEMENTATION' | 'OPERATING';

const ORDER: Stage[] = ['ELIGIBILITY_REVIEW', 'STUDY_PREPARATION', 'STUDY_REVIEW', 'COMMITTEE_EVALUATION', 'EVALUATED', 'SELECTED', 'FUNDING_SEARCH', 'FUNDER_REVIEW', 'IMPLEMENTATION', 'OPERATING'];

export interface Journey { id: string; applicant: Client }
export interface AdvanceOpts {
  applicant?: Client; scores?: Partial<Record<string, number>>; evaluators?: Client[]; funder?: 'A' | 'B'; birthDate?: string;
  planAmounts?: number[]; fundingAmount?: number;
}

/** يأخذ طلب متقدم جديد من المسودة حتى مرحلة معينة على المسار الرئيسي. */
export async function advanceTo(srv: Started, w: World, target: Stage, o: AdvanceOpts = {}): Promise<Journey> {
  const reached = (s: Stage) => ORDER.indexOf(target) >= ORDER.indexOf(s);
  const applicant = o.applicant ?? await newApplicant(srv);
  const id = await createCompleteDraft(applicant, { birthDate: o.birthDate });
  ok(await act(applicant, id, 'submit'), 'submit');
  if (!reached('STUDY_PREPARATION')) return { id, applicant };
  ok(await act(w.imc, id, 'accept'), 'eligibility accept');
  if (!reached('STUDY_REVIEW')) return { id, applicant };
  await fillStudy(applicant, id, o.planAmounts);
  ok(await act(applicant, id, 'submit_study'), 'submit study');
  if (!reached('COMMITTEE_EVALUATION')) return { id, applicant };
  const evs = o.evaluators ?? [w.eval1];
  for (const e of evs) ok(await w.imc.post(`/applications/${id}/evaluators`, { evaluatorUserId: e.user.id }), 'assign evaluator');
  ok(await act(w.imc, id, 'accept'), 'study accept');
  if (!reached('EVALUATED')) return { id, applicant };
  const scores = { ...GOOD_SCORES, ...(o.scores ?? {}) };
  for (const e of evs) {
    ok(await e.post(`/applications/${id}/evaluation/coi`, { hasConflict: false }), 'coi');
    ok(await e.post(`/applications/${id}/evaluation/submit`, { scores, notes: {}, recommendation: 'recommend' }), 'submit evaluation');
  }
  ok(await act(w.imc, id, 'complete_evaluation'), 'complete evaluation');
  if (!reached('SELECTED')) return { id, applicant };
  ok(await act(w.imc, id, 'select', { reason: 'اختيار ضمن ترتيب الدورة' }), 'select');
  if (!reached('FUNDING_SEARCH')) return { id, applicant };
  ok(await w.imc.upload(`/applications/${id}/documents`, { kind: 'approvalFile' }, pdfVariant('approval')), 'approval doc');
  ok(await act(w.imc, id, 'record_approval', { approvalDate: todayIso(), approvalReference: 'قرار-2026/15' }), 'record approval');
  if (!reached('FUNDER_REVIEW')) return { id, applicant };
  ok(await act(w.imc, id, 'refer_funder', { funderOrgId: o.funder === 'B' ? w.funderBOrg : w.funderAOrg }), 'refer funder');
  if (!reached('IMPLEMENTATION')) return { id, applicant };
  const funder = o.funder === 'B' ? w.funderB : w.funderA;
  const total = (o.planAmounts ?? [100000, 200000]).reduce((s, x) => s + x, 0);
  ok(await act(funder, id, 'approve_funding', { amount: o.fundingAmount ?? total, model: 'soft_loan', terms: 'سداد على 5 سنوات' }), 'approve funding');
  if (!reached('OPERATING')) return { id, applicant };
  ok(await act(w.imc, id, 'start_operation'), 'start operation');
  return { id, applicant };
}
