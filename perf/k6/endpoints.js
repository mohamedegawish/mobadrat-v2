// Per-endpoint saturation (closed model, no think time): each endpoint alone for a short window with EP_VUS concurrent
// callers, one after the other, to rank the endpoints by cost on the full dataset. Reads use accounts signed in by setup();
// `login` measures the sign-in itself (bcrypt) and `sona3_section_put` / `me_profile_put` the serialised write path.
//   k6 run -e EP_VUS=20 -e EP_WINDOW=15 perf/k6/endpoints.js            (EP=name1,name2 to run a subset)
import { DS, TREND_STATS, get, ipFor, nth, pick, post, put, signInMany, summaryHandler } from './lib.js';

const VUS = Number(__ENV.EP_VUS || 20);
const WINDOW = Number(__ENV.EP_WINDOW || 15);
const GAP = 3;
const S = '/i/shams';
const N = '/i/sona3';

const pw = () => DS.password;
const SEEDPW = () => DS.seedPassword;
// [name, account pool, call] — the account is chosen per VU from the pool
const EPS = [
  ['health', null, (s) => get(s, '/health', 'health')],
  ['pub_initiatives', null, (s) => get(s, '/initiatives', 'pub_initiatives')],
  ['pub_initiative', null, (s) => get(s, '/initiatives/sona3', 'pub_initiative')],
  ['pub_impact', null, (s) => get(s, '/catalog/impact', 'pub_impact')],
  ['pub_sona3_content', null, (s) => get(s, `${N}/public/site-content`, 'pub_sona3_content')],
  ['login', 'login', (s, vu, it) => post(s, '/auth/login', { email: nth(DS.people, vu * 131 + it), password: pw() }, 'login', [200])],
  ['me_person', 'people', (s) => get(s, '/me', 'me_person')],
  ['me_factory', 'factories', (s) => get(s, '/me', 'me_factory')],
  ['me_applicant', 'applicants', (s) => get(s, '/me', 'me_applicant')],
  ['me_profile', 'people', (s) => get(s, '/me/profile', 'me_profile')],
  ['me_notifications', 'factories', (s) => get(s, '/me/notifications', 'me_notifications')],
  ['me_requirements', 'people', (s) => get(s, '/me/initiatives/shams/requirements', 'me_requirements')],
  ['me_profile_put', 'people', (s, vu, it) => put(s, '/me/profile', { values: { 'person.address': `عنوان ${vu}-${it}` } }, 'me_profile_put')],
  ['shams_factory_profile', 'factories', (s) => get(s, `${S}/factory/profile`, 'shams_factory_profile')],
  ['shams_list_factory', 'factories', (s) => get(s, `${S}/applications`, 'shams_list_factory')],
  ['shams_app_detail_factory', 'factories', (s, vu) => get(s, `${S}/applications/${nth(DS.factories, vu).id}`, 'shams_app_detail_factory')],
  ['shams_dashboard_imc', 'imc', (s) => get(s, `${S}/dashboard`, 'shams_dashboard_imc')],
  ['shams_list_mine_imc', 'imc', (s) => get(s, `${S}/applications?mine=1`, 'shams_list_mine_imc')],
  ['shams_list_all_imc', 'imc', (s) => get(s, `${S}/applications?page=${1 + Math.floor(Math.random() * 20)}`, 'shams_list_all_imc')],
  ['shams_search_imc', 'imc', (s) => get(s, `${S}/applications?q=${encodeURIComponent(pick(DS.shamsApps).reg)}`, 'shams_search_imc')],
  ['shams_app_detail_imc', 'imc', (s) => get(s, `${S}/applications/${pick(DS.shamsApps).id}`, 'shams_app_detail_imc')],
  ['shams_dashboard_pmu', 'pmu', (s) => get(s, `${S}/dashboard`, 'shams_dashboard_pmu')],
  ['shams_report_pmu', 'pmu', (s) => get(s, `${S}/reports/summary`, 'shams_report_pmu')],
  ['sona3_list_applicant', 'applicants', (s) => get(s, `${N}/applications`, 'sona3_list_applicant')],
  ['sona3_app_detail_applicant', 'withApp', (s, vu) => get(s, `${N}/applications/${nth(WITH_APP(), vu).id}`, 'sona3_app_detail_applicant')],
  ['sona3_inbox', 'applicants', (s) => get(s, `${N}/notifications/mine`, 'sona3_inbox')],
  ['sona3_section_put', 'drafts', (s, vu, it) => put(s, `${N}/applications/${nth(DS.drafts, vu).id}/data/idea`, { ideaDescription: 'تصنيع مكونات', problem: 'الاستيراد', targetCustomers: `مصانع ${it}`, competitiveAdvantage: 'سعر أقل' }, 'sona3_section_put')],
  ['sona3_list_mine_imc', 'sona3imc', (s) => get(s, `${N}/applications?mine=1`, 'sona3_list_mine_imc')],
  ['sona3_list_state_imc', 'sona3imc', (s) => get(s, `${N}/applications?state=ELIGIBILITY_REVIEW`, 'sona3_list_state_imc')],
  ['sona3_app_detail_imc', 'sona3imc', (s) => get(s, `${N}/applications/${pick(DS.sona3Apps)}`, 'sona3_app_detail_imc')],
  ['sona3_report_imc', 'sona3imc', (s) => get(s, `${N}/reports/summary`, 'sona3_report_imc')],
  ['admin_stats', 'superAdmin', (s) => get(s, '/admin/stats', 'admin_stats')],
  ['admin_stats_shams', 'superAdmin', (s) => get(s, '/admin/stats/shams', 'admin_stats_shams')],
  ['admin_bodies', 'superAdmin', (s) => get(s, '/admin/bodies', 'admin_bodies')],
  ['admin_body', 'superAdmin', (s) => get(s, '/admin/bodies/body-imc', 'admin_body')],
  ['admin_users_search', 'superAdmin', (s) => get(s, `/admin/users?q=perf.f0${Math.floor(Math.random() * 10)}`, 'admin_users_search')],
  ['admin_users_page', 'superAdmin', (s) => get(s, `/admin/users?page=${1 + Math.floor(Math.random() * 50)}`, 'admin_users_page')],
  ['admin_activity', 'superAdmin', (s) => get(s, '/admin/activity', 'admin_activity')],
  ['admin_audit', 'superAdmin', (s) => get(s, `/admin/audit-logs?page=${1 + Math.floor(Math.random() * 50)}`, 'admin_audit')],
];
let withApp = null;
const WITH_APP = () => withApp || (withApp = DS.applicants.filter((a) => a.id));
const POOLS = {
  people: () => DS.people.map((e) => [e, pw()]),
  factories: () => DS.factories.map((f) => [f.email, pw()]),
  applicants: () => DS.applicants.map((a) => [a.email, pw()]),
  withApp: () => WITH_APP().map((a) => [a.email, pw()]),
  drafts: () => DS.drafts.map((a) => [a.email, pw()]),
  imc: () => DS.staff.shams.imc.map((e) => [e, SEEDPW()]),
  pmu: () => DS.staff.shams.pmu.map((e) => [e, SEEDPW()]),
  sona3imc: () => DS.staff.sona3.imc.map((e) => [e, SEEDPW()]),
  superAdmin: () => DS.staff.platform.superAdmin.map((e) => [e, SEEDPW()]),
};

const cache = {};
const poolOf = (p) => cache[p] || (cache[p] = POOLS[p]());

const only = (__ENV.EP || '').split(',').filter(Boolean);
const picked = EPS.filter(([n]) => !only.length || only.includes(n));

const scenarios = {};
const thresholds = {};
picked.forEach(([name], k) => {
  scenarios[name] = { executor: 'constant-vus', vus: VUS, duration: `${WINDOW}s`, startTime: `${k * (WINDOW + GAP)}s`, exec: 'run', env: { EPNAME: name }, gracefulStop: '5s' };
  thresholds[`http_req_duration{ep:${name}}`] = ['p(95)<60000'];
  thresholds[`unexpected_status{ep:${name}}`] = ['rate<1.01'];
  thresholds[`http_reqs{ep:${name}}`] = ['count>=0'];
});

export const options = { scenarios, thresholds, summaryTrendStats: TREND_STATS, setupTimeout: '300s' };

export function setup() {
  const need = new Set(picked.map(([, pool]) => pool).filter((p) => p && p !== 'login'));
  const accounts = [];
  for (const p of need) accounts.push(...poolOf(p).slice(0, VUS));
  return { tokens: signInMany(accounts) };
}

const CALLS = Object.fromEntries(EPS.map(([n, pool, fn]) => [n, { pool, fn }]));
const session = { ip: null, token: null };

export function run(data) {
  const { pool, fn } = CALLS[__ENV.EPNAME];
  const vu = __VU % VUS;
  session.ip = ipFor(__VU, __ITER); // every call from its own address: the per-address limit is not what is measured
  session.token = null;
  if (pool && pool !== 'login') {
    const list = poolOf(pool);
    session.token = data.tokens[list[vu % list.length][0]] || null;
  }
  fn(session, vu, __ITER);
}

export const handleSummary = summaryHandler(__ENV.NAME || 'endpoints');
