// Shared k6 helpers of the platform load test: the dataset, one synthetic client address per virtual user, sign-in with a
// cached token per VU, measured requests tagged by endpoint, and the JSON summary perf/run.mjs turns into the report.
import http from 'k6/http';
import { SharedArray } from 'k6/data';
import { Counter, Rate } from 'k6/metrics';
import { sleep } from 'k6';

export const BASE = __ENV.BASE || 'http://127.0.0.1:5400';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw new Error(`refusing non-local target ${BASE}`);
export const API = `${BASE}/api/v1`;

const DS = new SharedArray('dataset', () => {
  const d = JSON.parse(open(__ENV.DATASET || '../.state/dataset.json'));
  const isApproved = (t) => !['IMC_REVIEW', 'IMC_CORRECTION', 'IMC_REJECTED'].includes(t);
  return [{
    password: d.password,
    seedPassword: d.seedPassword,
    factories: d.shams.factories.filter((f) => isApproved(f.target)).map((f) => ({ email: f.email, id: f.id, reg: f.reg })),
    pendingFactories: d.shams.factories.filter((f) => !isApproved(f.target)).map((f) => ({ email: f.email, id: f.id })),
    shamsApps: d.shams.factories.map((f) => ({ id: f.id, reg: f.reg })),
    applicants: d.sona3.applicants.map((a) => ({ email: a.email, id: a.id, target: a.target })),
    drafts: d.sona3.applicants.filter((a) => a.target === 'DRAFT').map((a) => ({ email: a.email, id: a.id })),
    sona3Apps: d.sona3.applicants.filter((a) => a.id && a.target !== 'DRAFT').map((a) => a.id),
    people: d.platform.people.map((p) => p.email),
    staff: d.staff,
  }];
})[0];
export { DS };

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const nth = (arr, i) => arr[i % arr.length];
export const think = (lo = 1, hi = 4) => sleep(lo + Math.random() * (hi - lo));

/** A distinct client address per VU (and per iteration when `iter` is given): requests carry it in X-Forwarded-For and
 *  the server trusts one proxy hop (TRUST_PROXY=1), as behind the production reverse proxy. Limits stay real. */
export function ipFor(vu, iter = 0) {
  const n = (vu * 7919 + iter) % 16_000_000;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${(n & 255) || 1}`;
}

const STATUS = [200, 201, 304, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504];
const SC = {};
for (const s of STATUS) SC[s] = new Counter(`status_${s}`);
const SC_OTHER = new Counter('status_other');
export const unexpected = new Rate('unexpected_status');

/** Records the status class and whether it was one of the correct answers for this call. */
function record(res, ok, ep) {
  (SC[res.status] || SC_OTHER).add(1);
  unexpected.add(!ok.includes(res.status), { ep });
  return res;
}

export const TREND_STATS = ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'];

export function params(session, ep, extra = {}) {
  const headers = { 'X-Forwarded-For': session.ip, ...(extra.headers || {}) };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  return { headers, tags: { ep, ...(extra.tags || {}) }, timeout: '60s', responseType: extra.responseType || 'text' };
}

export function get(session, path, ep, ok = [200]) {
  return record(http.get(`${API}${path}`, params(session, ep)), ok, ep);
}
export function post(session, path, body, ep, ok = [200, 201]) {
  const p = params(session, ep, { headers: { 'Content-Type': 'application/json' } });
  return record(http.post(`${API}${path}`, JSON.stringify(body), p), ok, ep);
}
export function put(session, path, body, ep, ok = [200]) {
  const p = params(session, ep, { headers: { 'Content-Type': 'application/json' } });
  return record(http.put(`${API}${path}`, JSON.stringify(body), p), ok, ep);
}

/** One screen of the app: its API calls in parallel, like the browser loading the page. */
export function screen(session, calls) {
  const reqs = calls.map(([method, path, ep, body]) => {
    const p = params(session, ep, body !== undefined ? { headers: { 'Content-Type': 'application/json' } } : {});
    return { method, url: `${API}${path}`, body: body === undefined ? null : JSON.stringify(body), params: p };
  });
  const res = http.batch(reqs);
  res.forEach((r, i) => record(r, calls[i][4] || [200], calls[i][2]));
  return res;
}

/** Signs in once per VU (and again when the 15-minute access token expires). */
export function signIn(session, email, password, ep = 'login') {
  const r = post({ ip: session.ip }, '/auth/login', { email, password }, ep, [200]);
  if (r.status !== 200) { session.token = null; return false; }
  session.token = r.json('data.accessToken');
  session.email = email;
  session.at = Date.now();
  return true;
}
/** Tokens signed in by setup() (stress and endpoint runs measure the screens, not a sign-in storm). */
let PRESET = null;
export function useTokens(map) { PRESET = map; }
export function ensureSignedIn(session, email, password) {
  if (session.token && session.email === email && Date.now() - session.at < 12 * 60_000) return true;
  if (PRESET && PRESET[email]) { session.token = PRESET[email]; session.email = email; session.at = Date.now(); return true; }
  return signIn(session, email, password);
}

/** Signs in each account once, 20 at a time, each from its own address (the per-address sign-in limit stays real). */
export function signInMany(accounts) {
  const tokens = {};
  for (let i = 0; i < accounts.length; i += 20) {
    const chunk = accounts.slice(i, i + 20);
    const res = http.batch(chunk.map(([email, password], k) => ({
      method: 'POST', url: `${API}/auth/login`, body: JSON.stringify({ email, password }),
      params: { headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ipFor(65_000 + i + k) }, tags: { ep: 'setup_login' }, timeout: '60s' },
    })));
    res.forEach((r, k) => { if (r.status === 200) tokens[chunk[k][0]] = r.json('data.accessToken'); });
  }
  return tokens;
}

export function json(res, path) {
  try { return res.json(path); } catch { return undefined; }
}

/** Summary JSON (k6 end-of-test data) for perf/run.mjs, plus k6's own text summary on stdout. */
export function summaryHandler(name) {
  return (data) => {
    const out = {};
    out[`${__ENV.OUT_DIR || '../.state/results'}/${name}.json`] = JSON.stringify(data, null, 1);
    out.stdout = textSummary(data);
    return out;
  };
}

function textSummary(data) {
  const m = data.metrics;
  const d = m.http_req_duration?.values || {};
  const lines = [
    `requests ${m.http_reqs?.values.count ?? 0}  rate ${(m.http_reqs?.values.rate ?? 0).toFixed(1)}/s`,
    `latency avg ${(d.avg ?? 0).toFixed(1)} ms  p50 ${(d.med ?? 0).toFixed(1)}  p95 ${(d['p(95)'] ?? 0).toFixed(1)}  p99 ${(d['p(99)'] ?? 0).toFixed(1)}  max ${(d.max ?? 0).toFixed(1)}`,
    `failed ${(((m.http_req_failed?.values.rate) ?? 0) * 100).toFixed(2)}%  unexpected ${(((m.unexpected_status?.values.rate) ?? 0) * 100).toFixed(2)}%`,
  ];
  const eps = Object.keys(m).filter((k) => k.startsWith('http_req_duration{ep:')).sort();
  for (const k of eps) {
    const v = m[k].values;
    lines.push(`  ${k.slice(21, -1).padEnd(28)} n=${String(v.count ?? '').padStart(6)}  p50 ${(v.med ?? 0).toFixed(1).padStart(8)}  p95 ${(v['p(95)'] ?? 0).toFixed(1).padStart(8)}  p99 ${(v['p(99)'] ?? 0).toFixed(1).padStart(8)}`);
  }
  return `${lines.join('\n')}\n`;
}
