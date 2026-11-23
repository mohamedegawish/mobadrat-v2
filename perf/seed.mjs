#!/usr/bin/env node
// Reproducible synthetic dataset for the platform load test — built through the public API with real decisions only
// (registration → the activation link from the captured e-mail → submissions → staff decisions). Never production:
// it talks to the local dataset server that perf/run.mjs starts (development mode, e-mails written to perf/.state/mail).
//
//   node perf/seed.mjs            (perf/run.mjs prepare runs it)   → perf/.state/dataset.json
//   PERF_SHAMS=800 PERF_SONA3=800 PERF_PLATFORM=400 PERF_SEED=20261122 SEED_CONCURRENCY=12
//
// Shams El-Senaa  : factories registered with the full form + documents, spread over every stage of the main path and the
//                   terminal outcomes (rejected, withdrawn, contracted).
// Sona'a El-Mostaqbal: applicants registered on the initiative page, spread over draft → eligibility → study → evaluation.
// Platform only   : accounts with a verified e-mail and a saved personal profile, no initiative yet.
import fs from 'node:fs';
import { Client, DATASET, PW, SEED_PW, must, mailFor, pdf, pool, rng } from './lib.mjs';

const API = process.env.PERF_SEED_API ?? 'http://127.0.0.1:5300/api/v1';
const N_SHAMS = Number(process.env.PERF_SHAMS ?? 800);
const N_SONA3 = Number(process.env.PERF_SONA3 ?? 800);
const N_PLATFORM = Number(process.env.PERF_PLATFORM ?? 400);
const CONC = Number(process.env.SEED_CONCURRENCY ?? 12);
const R = rng(Number(process.env.PERF_SEED ?? 20261122));
const t0 = Date.now();
const log = (m) => console.log(`[dataset +${Math.round((Date.now() - t0) / 1000)}s] ${m}`);
const pad = (n, w = 5) => String(n).padStart(w, '0');

/** Weighted plan: [target, weight] → the target of item i (deterministic with the seed). */
function planner(weights) {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  return () => { let x = R.next() * total; for (const [t, w] of weights) { if ((x -= w) < 0) return t; } return weights[weights.length - 1][0]; };
}

const staff = async (email) => { const c = new Client(API); await c.login(email, SEED_PW); return c; };

/** The activation link of the registration e-mail, opened through the API. */
async function verify(email) {
  const token = (await mailFor(email))[1];
  must(await new Client(API).post('/auth/verify-email', { token }), `verify ${email}`);
}

// ─────────────────────────────── Shams El-Senaa ───────────────────────────────
const S = '/i/shams';
const SHAMS_DOCS = ['commercialRegisterFile', 'industrialRegisterFile', 'taxCardFile', 'ownershipProofFile'];
const GOVS = ['sharqia', 'cairo', 'giza', 'alexandria', 'qalyubia', 'gharbia', 'dakahlia', 'monufia'];
/** governorate → one of its industrial zones (core/reference/industrialZones.ts) */
const ZONES = [['sharqia', '10th-ramadan'], ['cairo', 'zahraa-maadi'], ['giza', 'abu-rawash'], ['alexandria', 'manshiya-west'], ['qalyubia', 'khanka'], ['dakahlia', 'gamasa-south-west'], ['monufia', 'kafour-el-raml']];
const SHAMS_PLAN = planner([
  ['IMC_REVIEW', 20], ['IMC_CORRECTION', 5], ['IMC_REJECTED', 5], ['ENCPC_REVIEW', 15], ['PROVIDER_SELECTION', 12], ['OFFER_REVIEW', 10],
  ['ELECTRICITY_UPLOAD', 8], ['ELECTRICITY_REVIEW', 6], ['BANK_SELECTION', 4], ['CONTRACT_OUTCOME', 5], ['CONTRACTED', 5], ['WITHDRAWN', 5],
]);
const SHAMS_ORDER = ['IMC_REVIEW', 'ENCPC_REVIEW', 'PROVIDER_SELECTION', 'OFFER_REVIEW', 'ELECTRICITY_UPLOAD', 'ELECTRICITY_REVIEW', 'BANK_SELECTION', 'CONTRACT_OUTCOME', 'CONTRACTED'];

async function shamsAct(c, id, action, body = {}) {
  const app = must(await c.get(`${S}/applications/${id}`), `get ${id}`).json.data;
  return must(await c.post(`${S}/applications/${id}/actions/${action}`, { expectedVersion: app.version, ...body }), `${action} ${id}`);
}

async function shamsFactory(i, st) {
  const email = `perf.f${pad(i)}@load.test`;
  const reg = `IND-PERF-${pad(i)}P`; // never ends with 000 (the mock registry answers "invalid" for those)
  const target = SHAMS_PLAN();
  const [gov, zone] = ZONES[i % ZONES.length];
  const payload = {
    companyName: `مصنع الأداء ${i} للصناعات`, contactName: `م. مسؤول ${i}`, email, mobile: `010${pad(i, 8)}`, password: PW,
    application: {
      general: { governorate: gov, industrialZone: zone, address: `المنطقة الصناعية ${i % 7 + 1}`, phone1: '0221234567' },
      contact: { contactTitle: 'مدير المصنع' },
      company: { commercialRegisterNumber: `CR-P-${pad(i)}`, industrialRegistryNumber: reg, taxNumber: `${pad(i % 1000, 3)}-456-789` },
      engineering: {
        roofAreas: [{ name: 'السطح الرئيسي', area: 800 + (i % 50) * 30 }], contractedCapacity: 1000, capacityUnit: 'kVA', peakLoad: 750, loadUnit: 'kW',
        ownershipType: 'owned', ownershipExpiresAt: '2040-12-31',
      },
    },
  };
  const files = [...SHAMS_DOCS.map((k) => ({ field: k, body: pdf(`${reg}-${k}`, R.int(8, 40) * 1024), name: `${k}.pdf` })),
    { field: 'electricityBill', body: pdf(`${reg}-bill-1`, 12 * 1024), name: 'bill-1.pdf' }, { field: 'electricityBill', body: pdf(`${reg}-bill-2`, 12 * 1024), name: 'bill-2.pdf' }];
  must(await new Client(API).multipart(`${S}/public/register`, { payload: JSON.stringify(payload) }, files), `register ${email}`, [201]);
  await verify(email); // auto-submits the registration draft to IMC_REVIEW
  const found = must(await st.imc.get(`${S}/applications?q=${reg}`), `find ${reg}`).json.data.items;
  if (found.length !== 1) throw new Error(`expected one application for ${reg}, got ${found.length}`);
  const id = found[0].id;
  const out = { email, id, target, reg, governorate: gov };
  if (target === 'IMC_REVIEW') return out;
  if (target === 'IMC_CORRECTION') { await shamsAct(st.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان غير مكتمل' }] }); return out; }
  if (target === 'IMC_REJECTED') { await shamsAct(st.imc, id, 'reject', { reason: 'المستندات غير مطابقة للاشتراطات' }); return out; }
  await shamsAct(st.imc, id, 'accept'); // also accepts the factory's account
  const f = await new Client(API).login(email, PW);
  const reach = (s) => target === 'WITHDRAWN' ? s === 'ENCPC_REVIEW' : SHAMS_ORDER.indexOf(target) >= SHAMS_ORDER.indexOf(s);
  if (target === 'WITHDRAWN') { await shamsAct(f, id, 'withdraw', { reason: 'تأجيل المشروع' }); return out; }
  if (!reach('PROVIDER_SELECTION')) return out;
  await shamsAct(st.encpc, id, 'compliant');
  if (!reach('OFFER_REVIEW')) return out;
  await shamsAct(f, id, 'select_provider', { providerId: 'sp-demo-1' });
  must(await f.upload(`${S}/applications/${id}/documents`, 'technicalOfferFile', pdf(`${reg}-offer`, 30 * 1024), 'offer.pdf'), 'offer upload');
  await shamsAct(f, id, 'submit_offer');
  if (!reach('ELECTRICITY_UPLOAD')) return out;
  await shamsAct(st.pmu, id, 'accept');
  if (!reach('ELECTRICITY_REVIEW')) return out;
  must(await f.upload(`${S}/applications/${id}/documents`, 'electricityApprovalFile', pdf(`${reg}-elec`, 20 * 1024), 'approval.pdf'), 'approval upload');
  await shamsAct(f, id, 'submit_electricity', { distributionCompany: 'شركة توزيع (اختبار أداء)' });
  if (!reach('BANK_SELECTION')) return out;
  await shamsAct(st.pmu, id, 'accept');
  if (!reach('CONTRACT_OUTCOME')) return out;
  await shamsAct(f, id, 'select_bank', { bankOrgId: i % 2 ? 'org-bank-demo-a' : 'org-bank-demo-b' });
  if (!reach('CONTRACTED')) return out;
  must(await f.upload(`${S}/applications/${id}/documents`, 'contractFile', pdf(`${reg}-contract`, 25 * 1024), 'contract.pdf'), 'contract upload');
  await shamsAct(f, id, 'record_contract', { contractDate: '2026-10-20', contractAmount: 5_000_000 + i * 1000, contractNotes: 'تم' });
  return out;
}

// ─────────────────────────── Sona'a El-Mostaqbal ───────────────────────────
const N = '/i/sona3';
const SONA3_PLAN = planner([
  ['REGISTERED', 8], ['DRAFT', 12], ['ELIGIBILITY_REVIEW', 28], ['ELIGIBILITY_CORRECTION', 5], ['REJECTED', 5], ['WITHDRAWN', 3],
  ['STUDY_PREPARATION', 15], ['STUDY_REVIEW', 12], ['COMMITTEE_EVALUATION', 10], ['EVALUATED', 2],
]);
const SONA3_ORDER = ['DRAFT', 'ELIGIBILITY_REVIEW', 'STUDY_PREPARATION', 'STUDY_REVIEW', 'COMMITTEE_EVALUATION', 'EVALUATED'];
const SECTORS = ['manufacturing', 'industrial_tech', 'import_substitution', 'industrial_services', 'innovation'];

function nationalIdFor(birthDate, seq) {
  const c = Number(birthDate.slice(0, 4)) >= 2000 ? '3' : '2';
  return `${c}${birthDate.slice(2, 4)}${birthDate.slice(5, 7)}${birthDate.slice(8, 10)}01${String(seq % 10000).padStart(4, '0')}1`;
}

async function sona3Act(c, id, action, body = {}) {
  const app = must(await c.get(`${N}/applications/${id}`), `get ${id}`).json.data;
  return must(await c.post(`${N}/applications/${id}/actions/${action}`, { expectedVersion: app.version, ...body }), `${action} ${id}`);
}

async function sona3Applicant(i, st) {
  const email = `perf.a${pad(i)}@load.test`;
  const name = `متقدم الأداء رقم ${i}`;
  const mobile = `011${pad(i, 8)}`;
  const target = SONA3_PLAN();
  must(await new Client(API).post(`${N}/public/register`, { fullName: name, email, mobile, password: PW }), `register ${email}`, [201]);
  await verify(email);
  const a = await new Client(API).login(email, PW);
  const out = { email, id: null, target };
  if (target === 'REGISTERED') return out;
  const id = must(await a.post(`${N}/applications`, {}), 'create draft').json.data.id;
  out.id = id;
  const birthDate = `${1993 + (i % 10)}-0${1 + (i % 9)}-1${i % 9}`;
  const sections = {
    personal: {
      fullName: name, nationalId: nationalIdFor(birthDate, i), birthDate, nationality: 'egyptian', governorate: GOVS[i % GOVS.length],
      address: `شارع ${i}، القاهرة`, phone: mobile, email, qualification: 'بكالوريوس هندسة', experience: 'خمس سنوات في التصنيع',
    },
    team: { applicationType: 'individual' },
    project: { projectName: `مشروع صناعي ${i}`, sector: SECTORS[i % SECTORS.length], projectStage: 'new_idea', projectGovernorate: 'sharqia', projectLocation: 'العاشر من رمضان' },
    idea: { ideaDescription: 'تصنيع مكونات بديلة للمستورد', problem: 'الاعتماد على الاستيراد', targetCustomers: 'مصانع محلية', competitiveAdvantage: 'سعر أقل' },
    readiness: { startTimeline: 'immediate', estimatedCost: 400000 + (i % 20) * 10000, requestedFunding: 300000, hasOwnFunding: false },
    declarations: { declTermsRead: true, declDataTrue: true, declConfidentiality: true, declParticipation: true },
  };
  const keys = Object.keys(sections);
  const upto = target === 'DRAFT' ? R.int(1, keys.length - 1) : keys.length;
  for (const k of keys.slice(0, upto)) must(await a.put(`${N}/applications/${id}/data/${k}`, sections[k]), `save ${k}`);
  if (target === 'DRAFT') return out;
  must(await a.upload(`${N}/applications/${id}/documents`, 'nationalIdFile', pdf(`nid-${i}`, R.int(20, 60) * 1024), 'nid.pdf'), 'nid upload');
  await sona3Act(a, id, 'submit');
  if (target === 'WITHDRAWN') { await sona3Act(a, id, 'withdraw', { reason: 'تغير الخطة' }); return out; }
  if (target === 'ELIGIBILITY_CORRECTION') { await sona3Act(st.imc, id, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان غير واضح' }] }); return out; }
  if (target === 'REJECTED') { await sona3Act(st.imc, id, 'reject', { reason: 'لا تنطبق الشروط' }); return out; }
  const reach = (s) => SONA3_ORDER.indexOf(target) >= SONA3_ORDER.indexOf(s);
  if (!reach('STUDY_PREPARATION')) return out;
  await sona3Act(st.imc, id, 'accept');
  if (!reach('STUDY_REVIEW')) return out;
  const study = {
    study_market: { productName: 'مكونات', technicalDescription: 'وصف فني', marketProblem: 'نقص المعروض', competitiveEdge: 'تكلفة أقل', targetSegment: 'مصانع', annualDemand: '10000 وحدة', importSubstitution: false, competitors: 'مستوردون', pricing: 'أقل 15%', salesChannels: 'مباشر' },
    study_technical: {
      productionCapacity: '1000 وحدة شهريًا', technologyLevel: 'semi_auto', assets: [{ item: 'ماكينة CNC', specs: '3 محاور', quantity: 1, cost: 250000 }],
      materials: [{ name: 'صلب', source: 'local', monthlyQuantity: '2 طن', monthlyCost: 40000 }], directWorkers: 5, indirectWorkers: 2, monthlyPayroll: 60000, siteArea: 200, utilities: 'كهرباء', licenses: 'ترخيص صناعي',
    },
    study_financial: { establishmentCosts: 50000, workingCapital: 150000, requestedFinancing: 300000, preferredModel: 'soft_loan', firstYearRevenue: 1200000, firstYearCosts: 800000, paybackYears: 2.5, breakEvenPercent: 55 },
    study_risks: { marketRisk: 'انخفاض الطلب', marketMitigation: 'تنويع العملاء', operationalRisk: 'تأخر الخامات', operationalMitigation: 'مخزون', financialRisk: 'تقلب الأسعار', financialMitigation: 'عقود آجلة' },
    study_impact: { directJobs: 7, indirectJobs: 10, localValueAdded: 'مرتفع', environmentalImpact: 'محدود' },
    study_plan: { phases: [{ title: 'المرحلة 1', weeks: 8, amount: 100000 }, { title: 'المرحلة 2', weeks: 8, amount: 200000 }] },
  };
  for (const [k, v] of Object.entries(study)) must(await a.put(`${N}/applications/${id}/data/${k}`, v), `save ${k}`);
  await sona3Act(a, id, 'submit_study');
  if (!reach('COMMITTEE_EVALUATION')) return out;
  const ev = st.evaluators[i % st.evaluators.length];
  must(await st.imc.post(`${N}/applications/${id}/evaluators`, { evaluatorUserId: ev.id }), 'assign evaluator');
  await sona3Act(st.imc, id, 'accept');
  out.evaluator = ev.email;
  if (!reach('EVALUATED')) return out;
  must(await ev.c.post(`${N}/applications/${id}/evaluation/coi`, { hasConflict: false }), 'coi');
  const s = 60 + (i % 30);
  must(await ev.c.post(`${N}/applications/${id}/evaluation/submit`, { scores: { financial: s, technical: s, market: s, innovation: s, jobs: s, team: s }, notes: {}, recommendation: 'recommend' }), 'evaluation');
  await sona3Act(st.imc, id, 'complete_evaluation');
  return out;
}

// ─────────────────────────────── platform only ───────────────────────────────
async function platformPerson(i) {
  const email = `perf.p${pad(i)}@load.test`;
  must(await new Client(API).post('/auth/register', { fullName: `مستخدم المنصة ${i}`, email, mobile: `012${pad(i, 8)}`, password: PW }), `register ${email}`, [201]);
  await verify(email);
  const c = await new Client(API).login(email, PW);
  must(await c.put('/me/profile', { values: { 'person.fullNameAr': `مستخدم المنصة ${i}`, 'person.governorate': GOVS[i % GOVS.length], 'person.address': `عنوان ${i}`, 'person.qualification': 'بكالوريوس' } }), 'profile');
  return { email };
}

// ──────────────────────────────────── run ────────────────────────────────────
async function run(label, n, fn) {
  let done = 0;
  const failures = [];
  const out = await pool(Array.from({ length: n }, (_, k) => k + 1), CONC, async (i) => {
    try { return await fn(i); } catch (e) { failures.push(`${label} #${i}: ${e.message}`); return null; }
    finally { if (++done % 100 === 0) log(`${label}: ${done}/${n}`); }
  });
  if (failures.length) { console.error(failures.slice(0, 10).join('\n')); throw new Error(`${label}: ${failures.length} item(s) failed`); }
  return out;
}

const st = {
  imc: await staff('imc1@shams.local'), encpc: await staff('encpc@shams.local'), pmu: await staff('pmu@shams.local'),
};
log(`Shams El-Senaa: ${N_SHAMS} factories`);
const factories = await run('shams', N_SHAMS, (i) => shamsFactory(i, st));

const st3 = { imc: await staff('imc@sona3.local'), evaluators: [] };
const evs = must(await st3.imc.get(`${N}/evaluators`), 'evaluators').json.data;
const evList = Array.isArray(evs) ? evs : evs.items;
for (const e of evList.filter((x) => /^evaluator\d@sona3\.local$/.test(x.email))) st3.evaluators.push({ id: e.id, email: e.email, c: await staff(e.email) });
if (!st3.evaluators.length) throw new Error('no seeded Sona3 evaluators');
log(`Sona'a El-Mostaqbal: ${N_SONA3} applicants (${st3.evaluators.length} evaluators)`);
const applicants = await run('sona3', N_SONA3, (i) => sona3Applicant(i, st3));

log(`platform only: ${N_PLATFORM} accounts`);
const people = await run('platform', N_PLATFORM, platformPerson);

const count = (xs) => xs.reduce((m, x) => ({ ...m, [x.target]: (m[x.target] ?? 0) + 1 }), {});
const dataset = {
  createdAt: new Date().toISOString(), seed: Number(process.env.PERF_SEED ?? 20261122), password: PW, seedPassword: SEED_PW,
  shams: { factories, byTarget: count(factories) },
  sona3: { applicants, byTarget: count(applicants), evaluators: st3.evaluators.map((e) => e.email) },
  platform: { people },
  staff: {
    shams: { imc: ['imc1@shams.local', 'imc2@shams.local'], encpc: ['encpc@shams.local'], pmu: ['pmu@shams.local'], admin: ['admin@shams.local'] },
    sona3: { imc: ['imc@sona3.local'], admin: ['admin@sona3.local'], funder: ['funder@sona3.local'] },
    platform: { superAdmin: ['admin@mobadrat.local'], ministry: ['ministry@mobadrat.local'], auditor: ['auditor@mobadrat.local'] },
  },
};
fs.writeFileSync(DATASET, JSON.stringify(dataset, null, 1));
log(`done → ${DATASET}`);
log(`shams ${JSON.stringify(dataset.shams.byTarget)}`);
log(`sona3 ${JSON.stringify(dataset.sona3.byTarget)}`);
