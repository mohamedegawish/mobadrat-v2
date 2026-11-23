#!/usr/bin/env node
// Platform load test — local only (this machine's MySQL and API; nothing else is ever targeted).
//
//   node perf/run.mjs prepare            fresh database `mobadrat_perf` + the synthetic dataset (perf/seed.mjs) through the API
//   node perf/run.mjs load [runs…]       production build on that database, then the k6 runs (default: endpoints mixed stress)
//                                        and perf/.state/results/report.md
//
// The load server runs the PRODUCTION configuration: NODE_ENV=production, real rate limits (RATE_LIMIT_SCALE unset),
// behind one trusted proxy hop (TRUST_PROXY=1, each virtual user is its own client address), no mail transport (messages
// are recorded as skipped — no e-mail can leave the machine), the mock industrial registry (demo flag).
// Options (env): MIXED_LEVELS=50,150,300,500  MIXED_DURATION=3m  STRESS_PEAK=400  STRESS_RAMP=6m  EP_VUS=20  EP_WINDOW=15
//                K6=<path to k6>  MYSQL_PERF_URL=mysql://root:root@127.0.0.1:3306  PERF_SHAMS / PERF_SONA3 / PERF_PLATFORM
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BACKEND, DATASET, MAIL_DIR, PERF_DB, RESULTS, ROOT, STATE, UPLOAD_DIR, dbUrl, sql, waitHealthy } from './lib.mjs';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const K6 = process.env.K6 || (process.platform === 'win32' ? 'C:\\Program Files\\k6\\k6.exe' : 'k6');
const SEED_PORT = 5300;
const LOAD_PORT = 5400;
const LOAD_ORIGIN = `http://127.0.0.1:${LOAD_PORT}`;
const log = (m) => console.log(`[perf] ${m}`);

/** Environment of every server the harness starts: no mail transport and no .env file can reach a real inbox. */
function quietEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(SMTP_|GMAIL_|MAIL_|SMS_|REGISTRY_API|SHAMS_WEBHOOK|SONA3_WEBHOOK|SEED_PASSWORD$)/.test(k)) delete env[k];
  return {
    ...env, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', MAIL_REDIRECT_TO: '', MAIL_SEND_REAL: '',
    SMS_PROVIDER: '', DOTENV_CONFIG_PATH: path.join(STATE, 'no.env'), DATABASE_URL: dbUrl(), UPLOAD_DIR, ...extra,
  };
}

function startServer(args, env, logFile) {
  const out = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, args, { cwd: BACKEND, env, stdio: ['ignore', out, out] });
  child.on('exit', (code, sig) => { if (code !== null && code !== 0) console.error(`[perf] server exited with ${code ?? sig} — see ${logFile}`); });
  return child;
}
async function stopServer(child) {
  if (child.exitCode !== null) return;
  const done = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await Promise.race([done, new Promise((r) => setTimeout(r, 15_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

// ───────────────────────────── prepare ─────────────────────────────
async function prepare() {
  const root = await sql();
  await root.query(`DROP DATABASE IF EXISTS \`${PERF_DB}\``);
  await root.query(`CREATE DATABASE \`${PERF_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`);
  await root.end();
  for (const d of [MAIL_DIR, UPLOAD_DIR]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
  log(`fresh database ${PERF_DB}; dataset server on :${SEED_PORT} (development mode, e-mails captured to ${MAIL_DIR})`);
  const srv = startServer(['--import', 'tsx', 'scripts/e2e-server.ts'], quietEnv({
    NODE_ENV: 'development', PORT: String(SEED_PORT), HOST: '127.0.0.1', E2E_MAIL_DIR: MAIL_DIR, SEED_ON_BOOT: '1', REGISTRY_ADAPTER: 'mock',
    RATE_LIMIT_SCALE: '1000', NOTIFICATION_SWEEP_MS: '300', APP_URL: `http://127.0.0.1:${SEED_PORT}`, CORS_ORIGIN: `http://127.0.0.1:${SEED_PORT}`,
  }), path.join(STATE, 'seed-server.log'));
  try {
    await waitHealthy(`http://127.0.0.1:${SEED_PORT}`);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'perf', 'seed.mjs')], {
      stdio: 'inherit', env: { ...process.env, PERF_SEED_API: `http://127.0.0.1:${SEED_PORT}/api/v1` },
    });
    if (r.status !== 0) throw new Error('dataset build failed');
  } finally { await stopServer(srv); }
  await snapshotCounts('dataset');
}

async function snapshotCounts(tag) {
  const c = await sql(PERF_DB);
  const [rows] = await c.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`, [PERF_DB]);
  const counts = {};
  for (const { t } of rows) { const [[{ n }]] = await c.query(`SELECT COUNT(*) AS n FROM \`${t}\``); counts[t] = Number(n); }
  await c.end();
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(STATE, `counts-${tag}.json`), JSON.stringify(counts, null, 1));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t, n]) => `${t}=${n}`).join('  ');
  log(`rows (${tag}): ${top}`);
  return counts;
}

// ───────────────────────────── load ─────────────────────────────
/** CPU (% of one core) and memory of the API process, and the MySQL container's CPU, every 2 s. */
function startSampler(pid) {
  const samples = [];
  const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
    `$p = Get-Process -Id ${pid}; while ($true) { $p.Refresh(); "{0} {1}" -f [int64]$p.TotalProcessorTime.TotalMilliseconds, $p.WorkingSet64; Start-Sleep -Milliseconds 2000 }`]);
  let last = null;
  ps.stdout.on('data', (b) => {
    for (const line of String(b).split(/\r?\n/).filter(Boolean)) {
      const [cpuMs, rss] = line.trim().split(' ').map(Number);
      const now = Date.now();
      if (last) samples.push({ t: now, kind: 'api', cpu: ((cpuMs - last.cpuMs) / (now - last.t)) * 100, rssMb: rss / 1048576 });
      last = { cpuMs, t: now };
    }
  });
  const container = spawnSync('docker', ['ps', '--format', '{{.Names}} {{.Ports}}']).stdout?.toString().split('\n').find((l) => /:3306->3306/.test(l))?.split(' ')[0];
  let ds = null;
  if (container) {
    ds = spawn('docker', ['stats', '--format', '{{.CPUPerc}};{{.MemUsage}}', container]);
    ds.stdout.on('data', (b) => {
      for (const m of String(b).matchAll(/([\d.]+)%;([\d.]+)(MiB|GiB)/g)) samples.push({ t: Date.now(), kind: 'mysql', cpu: Number(m[1]), rssMb: Number(m[2]) * (m[3] === 'GiB' ? 1024 : 1) });
    });
  }
  return { samples, stop: () => { ps.kill(); ds?.kill(); } };
}

function k6(script, name, env) {
  const args = ['run', '--quiet', '-e', `BASE=${LOAD_ORIGIN}`, '-e', `DATASET=${DATASET}`, '-e', `OUT_DIR=${RESULTS.replace(/\\/g, '/')}`, '-e', `NAME=${name}`];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(path.join(ROOT, 'perf', 'k6', script));
  log(`k6 ${name} (${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')})`);
  const t0 = Date.now();
  // asynchronous on purpose: the CPU/memory sampler keeps reading while k6 runs (spawnSync would freeze it)
  return new Promise((resolve) => {
    const child = spawn(K6, args, { stdio: 'inherit', cwd: path.join(ROOT, 'perf', 'k6') });
    child.on('exit', (code) => resolve({ name, script, env, start: t0, end: Date.now(), exit: code }));
  });
}

async function load(runs) {
  if (!fs.existsSync(DATASET)) throw new Error('no dataset — run `node perf/run.mjs prepare` first');
  log('production build (backend)');
  const b = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: BACKEND, stdio: 'inherit', shell: process.platform === 'win32' });
  if (b.status !== 0) throw new Error('backend build failed');
  fs.rmSync(RESULTS, { recursive: true, force: true });
  fs.mkdirSync(RESULTS, { recursive: true });
  const serverLog = path.join(STATE, 'load-server.log');
  const srv = startServer(['dist/index.js'], quietEnv({
    NODE_ENV: 'production', PORT: String(LOAD_PORT), HOST: '127.0.0.1', JWT_SECRET: crypto.randomBytes(48).toString('hex'), JWT_ACCESS_TTL_SEC: '3600',
    TRUST_PROXY: '1', REGISTRY_ADAPTER: 'mock', ALLOW_MOCK_REGISTRY_IN_PRODUCTION: '1', SEED_ON_BOOT: '0',
    APP_URL: LOAD_ORIGIN, CORS_ORIGIN: LOAD_ORIGIN, RATE_LIMIT_SCALE: '',
  }), serverLog);
  await waitHealthy(LOAD_ORIGIN);
  log(`production server on ${LOAD_ORIGIN} (pid ${srv.pid}), log ${serverLog}`);
  const sampler = startSampler(srv.pid);
  const done = [];
  try {
    for (const run of runs) {
      if (run === 'endpoints') done.push(await k6('endpoints.js', 'endpoints', { EP_VUS: process.env.EP_VUS || 20, EP_WINDOW: process.env.EP_WINDOW || 15, ...(process.env.EP ? { EP: process.env.EP } : {}) }));
      else if (run === 'mixed') {
        for (const vus of (process.env.MIXED_LEVELS || '50,150,300,500').split(',').map(Number)) {
          done.push(await k6('mixed.js', `mixed-${vus}`, { VUS: vus, DURATION: process.env.MIXED_DURATION || '3m' }));
          await new Promise((r) => setTimeout(r, 10_000)); // let the server settle between levels
        }
      } else if (run === 'stress') done.push(await k6('stress.js', 'stress', { START: 20, PEAK: process.env.STRESS_PEAK || 400, RAMP: process.env.STRESS_RAMP || '6m' }));
      else throw new Error(`unknown run ${run}`);
    }
  } finally {
    sampler.stop();
    await stopServer(srv);
  }
  fs.writeFileSync(path.join(RESULTS, 'runs.json'), JSON.stringify({ runs: done, samples: sampler.samples }, null, 1));
  await snapshotCounts('after-load').catch((e) => log(`row counts after the load skipped (${e.code ?? e.message})`));
  report(done, sampler.samples);
}

// ───────────────────────────── report ─────────────────────────────
const f1 = (x) => (x === undefined || Number.isNaN(x) ? '–' : x.toFixed(1));
function usage(samples, run, kind) {
  const xs = samples.filter((s) => s.kind === kind && s.t >= run.start && s.t <= run.end);
  if (!xs.length) return { cpuAvg: undefined, cpuMax: undefined, memMax: undefined };
  return { cpuAvg: xs.reduce((s, x) => s + x.cpu, 0) / xs.length, cpuMax: Math.max(...xs.map((x) => x.cpu)), memMax: Math.max(...xs.map((x) => x.rssMb)) };
}
function readSummary(name) {
  const f = path.join(RESULTS, `${name}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}
function epRows(sum) {
  const m = sum.metrics;
  return Object.keys(m).filter((k) => k.startsWith('http_req_duration{ep:')).map((k) => {
    const ep = k.slice(21, -1);
    const v = m[k].values;
    const n = m[`http_reqs{ep:${ep}}`]?.values;
    const bad = m[`unexpected_status{ep:${ep}}`]?.values?.rate;
    return { ep, count: v.count, rate: n?.rate, p50: v.med, p95: v['p(95)'], p99: v['p(99)'], max: v.max, bad };
  }).filter((r) => r.count > 0);
}

function report(runs, samples) {
  const lines = [];
  const cpus = os.cpus();
  lines.push('# Load test report', '', `Run ${new Date().toISOString()} on ${cpus[0]?.model ?? 'cpu'} ×${cpus.length}, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM, ${os.type()} ${os.release()}, Node ${process.version}.`);
  lines.push('The API (production build) and MySQL 8.4 (Docker) run on the same machine as k6, so the numbers are a lower bound for a dedicated server.', '');
  const counts = JSON.parse(fs.readFileSync(path.join(STATE, 'counts-dataset.json'), 'utf8'));
  const pick = ['users', 'initiative_memberships', 'shams_applications', 'shams_documents', 'shams_application_transitions', 'sona3_applications', 'sona3_documents', 'audit_logs', 'notification_outbox', 'refresh_tokens'];
  lines.push('## Dataset', '', '| table | rows |', '|---|---:|', ...pick.filter((t) => t in counts).map((t) => `| ${t} | ${counts[t]} |`), '');

  const mixed = runs.filter((r) => r.name.startsWith('mixed-'));
  if (mixed.length) {
    lines.push('## Realistic mix — concurrent users (closed model, 2–6 s reading time between screens)', '');
    lines.push('| users | requests | req/s | p50 ms | p95 ms | p99 ms | max ms | failed % | unexpected % | API CPU avg / max % | API RAM max MB | MySQL CPU avg / max % |');
    lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of mixed) {
      const s = readSummary(r.name); if (!s) continue;
      const d = s.metrics.http_req_duration.values; const api = usage(samples, r, 'api'); const db = usage(samples, r, 'mysql');
      lines.push(`| ${r.env.VUS} | ${s.metrics.http_reqs.values.count} | ${f1(s.metrics.http_reqs.values.rate)} | ${f1(d.med)} | ${f1(d['p(95)'])} | ${f1(d['p(99)'])} | ${f1(d.max)} | ${f1(s.metrics.http_req_failed.values.rate * 100)} | ${f1((s.metrics.unexpected_status?.values.rate ?? 0) * 100)} | ${f1(api.cpuAvg)} / ${f1(api.cpuMax)} | ${f1(api.memMax)} | ${f1(db.cpuAvg)} / ${f1(db.cpuMax)} |`);
    }
    const top = readSummary(mixed[mixed.length - 1].name);
    if (top) {
      lines.push('', `### Slowest endpoints at ${mixed[mixed.length - 1].env.VUS} users`, '', '| endpoint | n | p50 | p95 | p99 | max | unexpected % |', '|---|---:|---:|---:|---:|---:|---:|');
      for (const e of epRows(top).sort((a, b) => b.p95 - a.p95).slice(0, 15)) lines.push(`| ${e.ep} | ${e.count} | ${f1(e.p50)} | ${f1(e.p95)} | ${f1(e.p99)} | ${f1(e.max)} | ${f1((e.bad ?? 0) * 100)} |`);
    }
    lines.push('');
  }
  const ep = runs.find((r) => r.name === 'endpoints');
  const es = ep && readSummary('endpoints');
  if (es) {
    lines.push(`## Each endpoint alone — ${ep.env.EP_VUS} concurrent callers, no think time, ${ep.env.EP_WINDOW} s each`, '');
    lines.push('| endpoint | requests | req/s | p50 ms | p95 ms | p99 ms | max ms | unexpected % |', '|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const e of epRows(es).sort((a, b) => b.p95 - a.p95)) lines.push(`| ${e.ep} | ${e.count} | ${f1(e.rate * (es.state.testRunDurationMs / 1000) / Number(ep.env.EP_WINDOW))} | ${f1(e.p50)} | ${f1(e.p95)} | ${f1(e.p99)} | ${f1(e.max)} | ${f1((e.bad ?? 0) * 100)} |`);
    lines.push('');
  }
  const st = runs.find((r) => r.name === 'stress');
  const ss = st && readSummary('stress');
  if (ss) {
    const d = ss.metrics.http_req_duration.values; const api = usage(samples, st, 'api'); const db = usage(samples, st, 'mysql');
    lines.push(`## Stress ramp — screens arriving from ${st.env.START} to ${st.env.PEAK} per second (open model)`, '');
    lines.push(`- ${ss.metrics.http_reqs.values.count} requests in ${f1(ss.state.testRunDurationMs / 1000)} s (${f1(ss.metrics.http_reqs.values.rate)} req/s on average), k6 exit ${st.exit} ${st.exit === 99 ? '(a threshold aborted the ramp: the saturation point was reached)' : ''}`);
    lines.push(`- latency p50 ${f1(d.med)} ms, p95 ${f1(d['p(95)'])} ms, p99 ${f1(d['p(99)'])} ms; failed ${f1(ss.metrics.http_req_failed.values.rate * 100)} %; dropped screens ${ss.metrics.dropped_iterations?.values.count ?? 0}`);
    lines.push(`- API CPU avg ${f1(api.cpuAvg)} % / max ${f1(api.cpuMax)} % of one core, RAM max ${f1(api.memMax)} MB; MySQL CPU avg ${f1(db.cpuAvg)} % / max ${f1(db.cpuMax)} %`, '');
  }
  const file = path.join(RESULTS, 'report.md');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  log(`report → ${file}`);
}

if (cmd === 'prepare') await prepare();
else if (cmd === 'load') await load(rest.length ? rest : ['endpoints', 'mixed', 'stress']);
else if (cmd === 'report') { const j = JSON.parse(fs.readFileSync(path.join(RESULTS, 'runs.json'), 'utf8')); report(j.runs, j.samples); }
else { console.log('usage: node perf/run.mjs prepare | load [endpoints mixed stress] | report'); process.exit(cmd === 'help' ? 0 : 1); }
