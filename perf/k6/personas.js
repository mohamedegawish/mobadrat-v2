// The people who use the platform, each as a sequence of screens (the API calls a screen makes, in parallel, like the browser).
// Every call is tagged with its endpoint (`ep`) so the report ranks them. Write screens only touch data that can be written
// again and again (personal profile, draft sections, notification reads) — the dataset stays reusable between runs.
import { DS, ensureSignedIn, get, json, nth, pick, put, screen } from './lib.js';

const S = '/i/shams';
const N = '/i/sona3';

// ── guest: the public site ──
export function guest(s) {
  const r = Math.random();
  if (r < 0.4) {
    screen(s, [['GET', '/initiatives', 'pub_initiatives'], ['GET', '/highlights', 'pub_highlights'], ['GET', '/catalog/impact', 'pub_impact']]);
  } else if (r < 0.7) {
    screen(s, [['GET', '/initiatives/sona3', 'pub_initiative'], ['GET', `${N}/public/site-content`, 'pub_sona3_content'], ['GET', `${N}/public/meta`, 'pub_sona3_meta']]);
  } else {
    screen(s, [['GET', '/initiatives/shams', 'pub_initiative'], ['GET', `${S}/public/meta`, 'pub_shams_meta']]);
  }
}

// ── a person with a platform account and no initiative yet ──
export function person(s, vu) {
  if (!ensureSignedIn(s, nth(DS.people, vu), DS.password)) return;
  const r = Math.random();
  if (r < 0.5) {
    screen(s, [['GET', '/me', 'me'], ['GET', '/me/notifications/unread-count', 'me_unread'], ['GET', '/initiatives', 'pub_initiatives']]);
  } else if (r < 0.8) {
    screen(s, [['GET', '/me/profile', 'me_profile'], ['GET', '/meta/profile', 'meta_profile']]);
  } else if (r < 0.9) {
    screen(s, [['GET', '/me/initiatives/sona3/requirements', 'me_requirements'], ['GET', '/me/notifications', 'me_notifications']]);
  } else {
    put(s, '/me/profile', { values: { 'person.address': `عنوان ${vu}-${Date.now() % 1000}` } }, 'me_profile_put');
  }
}

// ── a Shams factory (account accepted by IMC) ──
export function factory(s, vu) {
  const f = nth(DS.factories, vu);
  if (!ensureSignedIn(s, f.email, DS.password)) return;
  const r = Math.random();
  if (r < 0.35) {
    screen(s, [['GET', '/me', 'me'], ['GET', '/me/notifications/unread-count', 'me_unread']]);
  } else if (r < 0.75) {
    screen(s, [['GET', `${S}/auth/me`, 'shams_auth_me'], ['GET', `${S}/factory/profile`, 'shams_factory_profile'], ['GET', `${S}/applications`, 'shams_list_factory'],
      ['GET', `${S}/notifications/unread-count`, 'shams_unread']]);
  } else if (r < 0.92) {
    screen(s, [['GET', `${S}/applications/${f.id}`, 'shams_app_detail'], ['GET', `${S}/meta`, 'shams_meta']]);
  } else {
    screen(s, [['GET', `${S}/notifications`, 'shams_notifications'], ['GET', `${S}/service-providers`, 'shams_providers']]);
  }
}

// ── a Sona'a El-Mostaqbal applicant ──
export function applicant(s, vu) {
  const a = nth(DS.applicants, vu);
  if (!ensureSignedIn(s, a.email, DS.password)) return;
  const r = Math.random();
  if (r < 0.3) {
    screen(s, [['GET', '/me', 'me'], ['GET', '/me/notifications/unread-count', 'me_unread']]);
  } else if (r < 0.65) {
    screen(s, [['GET', `${N}/auth/me`, 'sona3_auth_me'], ['GET', `${N}/applicant/profile`, 'sona3_applicant_profile'], ['GET', `${N}/applications`, 'sona3_list_applicant'],
      ['GET', `${N}/notifications/mine`, 'sona3_inbox']]);
  } else if (r < 0.9 && a.id) {
    screen(s, [['GET', `${N}/applications/${a.id}`, 'sona3_app_detail'], ['GET', `${N}/meta`, 'sona3_meta'], ['GET', `${N}/cohorts`, 'sona3_cohorts']]);
  } else if (a.target === 'DRAFT' && a.id) {
    // auto-save of one draft field (the form saves on blur)
    put(s, `${N}/applications/${a.id}/data/idea`, { ideaDescription: 'تصنيع مكونات بديلة للمستورد', problem: 'الاعتماد على الاستيراد', targetCustomers: `مصانع ${Date.now() % 997}`, competitiveAdvantage: 'سعر أقل' }, 'sona3_section_put');
  } else {
    screen(s, [['GET', `${N}/site-content`, 'sona3_content']]);
  }
}

// ── Shams staff: IMC / ENCPC / PMU work queues ──
const SHAMS_STAFF = () => [...DS.staff.shams.imc, ...DS.staff.shams.encpc, ...DS.staff.shams.pmu];
export function shamsStaff(s, vu) {
  const email = nth(SHAMS_STAFF(), vu);
  if (!ensureSignedIn(s, email, DS.seedPassword)) return;
  const r = Math.random();
  if (r < 0.25) {
    screen(s, [['GET', `${S}/dashboard`, 'shams_dashboard'], ['GET', `${S}/notifications/unread-count`, 'shams_unread']]);
  } else if (r < 0.5) {
    screen(s, [['GET', `${S}/applications?mine=1`, 'shams_list_mine']]);
  } else if (r < 0.65) {
    screen(s, [['GET', `${S}/applications?page=${1 + Math.floor(Math.random() * 10)}`, 'shams_list_all']]);
  } else if (r < 0.75) {
    screen(s, [['GET', `${S}/applications?q=${encodeURIComponent(pick(DS.shamsApps).reg)}`, 'shams_search']]);
  } else if (r < 0.92) {
    // open a row of the work list (the role sees only its own scope)
    const list = screen(s, [['GET', `${S}/applications?page=${1 + Math.floor(Math.random() * 3)}`, 'shams_list_all']])[0];
    const items = json(list, 'data.items') || [];
    if (items.length) screen(s, [['GET', `${S}/applications/${pick(items).id}`, 'shams_app_detail']]);
  } else {
    screen(s, [['GET', `${S}/reports/summary`, 'shams_report_summary']]);
  }
}

// ── Sona3 staff: IMC officer ──
export function sona3Staff(s) {
  if (!ensureSignedIn(s, DS.staff.sona3.imc[0], DS.seedPassword)) return;
  const r = Math.random();
  if (r < 0.3) {
    screen(s, [['GET', `${N}/applications?mine=1`, 'sona3_list_mine'], ['GET', `${N}/notifications/mine`, 'sona3_inbox']]);
  } else if (r < 0.5) {
    screen(s, [['GET', `${N}/applications?state=ELIGIBILITY_REVIEW&page=${1 + Math.floor(Math.random() * 5)}`, 'sona3_list_state']]);
  } else if (r < 0.75) {
    const list = screen(s, [['GET', `${N}/applications?page=${1 + Math.floor(Math.random() * 3)}`, 'sona3_list_state']])[0];
    const items = json(list, 'data.items') || [];
    if (items.length) screen(s, [['GET', `${N}/applications/${pick(items).id}`, 'sona3_app_detail']]);
  } else if (r < 0.9) {
    screen(s, [['GET', `${N}/reports/summary`, 'sona3_report_summary']]);
  } else {
    screen(s, [['GET', `${N}/applications?q=${encodeURIComponent('متقدم الأداء رقم ' + (1 + Math.floor(Math.random() * 500)))}`, 'sona3_search']]);
  }
}

// ── platform administration: super admin / ministry viewer / auditor ──
export function platformAdmin(s, vu) {
  const accounts = [DS.staff.platform.superAdmin[0], DS.staff.platform.ministry[0], DS.staff.platform.superAdmin[0]];
  const email = nth(accounts, vu);
  if (!ensureSignedIn(s, email, DS.seedPassword)) return;
  const admin = email === DS.staff.platform.superAdmin[0];
  const r = Math.random();
  if (r < 0.35) {
    screen(s, [['GET', '/admin/stats', 'admin_stats'], ['GET', '/admin/modules', 'admin_modules']]);
  } else if (r < 0.5) {
    screen(s, [['GET', `/admin/stats/${Math.random() < 0.5 ? 'shams' : 'sona3'}`, 'admin_stats_module']]);
  } else if (r < 0.7) {
    const list = screen(s, [['GET', '/admin/bodies', 'admin_bodies']])[0];
    const items = json(list, 'data.items') || [];
    if (items.length) screen(s, [['GET', `/admin/bodies/${pick(items).id}`, 'admin_body']]);
  } else if (r < 0.85 && admin) {
    screen(s, [['GET', `/admin/users?q=${encodeURIComponent(`perf.${pick(['f', 'a', 'p'])}0${Math.floor(Math.random() * 10)}`)}`, 'admin_users_search']]);
  } else if (admin) {
    screen(s, [['GET', '/admin/activity', 'admin_activity'], ['GET', '/admin/audit-logs', 'admin_audit']]);
  } else {
    screen(s, [['GET', '/admin/stats', 'admin_stats']]);
  }
}

/** Share of each persona in the realistic mix (sums to 100). */
export const MIX = [
  [guest, 30], [person, 12], [factory, 18], [applicant, 18], [shamsStaff, 10], [sona3Staff, 5], [platformAdmin, 7],
];
export function personaOf(vu) {
  // deterministic per VU, spread across the mix
  const slot = (vu * 37) % 100;
  let acc = 0;
  for (const [fn, w] of MIX) { acc += w; if (slot < acc) return fn; }
  return guest;
}

/** Every endpoint tag the personas use (one summary row each). */
export const EPS = [
  'login', 'pub_initiatives', 'pub_highlights', 'pub_impact', 'pub_initiative', 'pub_sona3_content', 'pub_sona3_meta', 'pub_shams_meta',
  'me', 'me_unread', 'me_profile', 'meta_profile', 'me_requirements', 'me_notifications', 'me_profile_put',
  'shams_auth_me', 'shams_factory_profile', 'shams_list_factory', 'shams_unread', 'shams_app_detail', 'shams_meta', 'shams_notifications', 'shams_providers',
  'shams_dashboard', 'shams_list_mine', 'shams_list_all', 'shams_search', 'shams_report_summary',
  'sona3_auth_me', 'sona3_applicant_profile', 'sona3_list_applicant', 'sona3_inbox', 'sona3_app_detail', 'sona3_meta', 'sona3_cohorts', 'sona3_section_put', 'sona3_content',
  'sona3_list_mine', 'sona3_list_state', 'sona3_report_summary', 'sona3_search',
  'admin_stats', 'admin_modules', 'admin_stats_module', 'admin_bodies', 'admin_body', 'admin_users_search', 'admin_activity', 'admin_audit',
];

/** The accounts the first `n` VUs of each persona use (for setup() sign-in): [email, password]. */
export function accountsOf(n) {
  const out = new Map();
  for (let vu = 0; vu < n; vu++) {
    const p = personaOf(vu);
    let email = null; let pw = DS.password;
    if (p === person) email = nth(DS.people, vu);
    else if (p === factory) email = nth(DS.factories, vu).email;
    else if (p === applicant) email = nth(DS.applicants, vu).email;
    else if (p === shamsStaff) { email = nth(SHAMS_STAFF(), vu); pw = DS.seedPassword; }
    else if (p === sona3Staff) { email = DS.staff.sona3.imc[0]; pw = DS.seedPassword; }
    else if (p === platformAdmin) { email = nth([DS.staff.platform.superAdmin[0], DS.staff.platform.ministry[0], DS.staff.platform.superAdmin[0]], vu); pw = DS.seedPassword; }
    if (email) out.set(email, pw);
  }
  return [...out.entries()];
}
