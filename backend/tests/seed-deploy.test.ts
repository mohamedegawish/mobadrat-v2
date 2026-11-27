// Deploy seeder (core/seedDeploy.ts, SEED_ON_DEPLOY=1): one account for every role of the platform and of each initiative,
// usable at once with the fixed seed password (no forced change); creates only what is missing on every run; never changes
// an existing account — except the one-time reset that puts the seeded accounts back in their first state; next to real
// reference data it adds no demo banks / cohort / experts; SEED_EMAIL_DOMAIN; legacy ids already taken;
// production uses the fixed seed password whatever the deployment variables hold.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, Client, PASSWORD } from './helpers.js';

const env = isolateTestEnv('seeddeploy');
let srv: Awaited<ReturnType<typeof startServer>>;

before(async () => { srv = await startServer({ seed: false }); });
after(async () => { delete process.env.SEED_EMAIL_DOMAIN; await srv.close(); await env.cleanup(); });

const db = async () => (await import('../src/core/db/index.js')).getDb();
const n = async (sql: string, ...p: string[]) => Number(((await (await db()).prepare(sql).get(...p)) as { n: number }).n);
const seed = async () => (await import('../src/core/seedDeploy.js')).seedOnDeploy();
const ROLES: Record<string, string[]> = {
  platform: ['super_admin', 'ministry_viewer', 'auditor', 'catalog_manager'],
  shams: ['system_admin', 'imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'electricity_reviewer', 'factory_owner'],
  sona3: ['system_admin', 'imc_officer', 'evaluator', 'funder_reviewer', 'applicant'],
};
const NEW_PW = 'MyOwnPass2026';

/** Signs in with the seed password and checks the account is usable at once (no forced password change). */
async function signIn(email: string, password = PASSWORD): Promise<Client> {
  const c = await new Client(srv.base).login(email, password);
  const me = await c.get('/auth/me');
  assert.equal(me.json.data.user.mustChangePassword, false, `${email} is usable with the seed password`);
  assert.equal((await c.get('/me')).status, 200, email);
  return c;
}

test('SD-1 a fresh database: an account for every role, each usable at once with the seed password; the demo data they need', async () => {
  const r = await seed();
  assert.ok(r.accounts.length >= 17);
  assert.ok(r.accounts.every((a) => a.status === 'created'), JSON.stringify(r.accounts.filter((a) => a.status !== 'created')));
  for (const role of ROLES.platform) assert.ok(r.accounts.some((a) => a.initiativeId === null && a.role === role), `platform ${role}`);
  for (const id of ['shams', 'sona3']) for (const role of ROLES[id]) assert.ok(r.accounts.some((a) => a.initiativeId === id && a.role === role), `${id} ${role}`);
  assert.ok(!r.accounts.some((a) => a.role === 'bank_reviewer'), 'the retired bank role is not seeded');
  assert.ok(r.notes.some((x) => x.includes('0 existing account(s) reset once')), 'the one-time reset ran (nothing to reset on a fresh database)');

  // every account: signs in with the seed password, no forced change
  for (const a of r.accounts) await signIn(a.email);

  // each role reaches its own screens
  const admin = await signIn('admin@mobadrat.local');
  assert.equal((await admin.get('/admin/stats')).status, 200);
  const imc = await signIn('imc1@shams.local');
  assert.equal((await imc.get('/i/shams/dashboard')).status, 200);
  const factory = await signIn('factory@shams.local');
  const fp = await factory.get('/i/shams/factory/profile');
  assert.equal(fp.status, 200, JSON.stringify(fp.json));
  assert.equal((await factory.post('/i/shams/applications', {})).status, 201, 'the demo factory can start an application');
  assert.equal((await factory.get('/me/factories')).json.data.items.length, 1, 'with its shared factory profile');
  const applicant = await signIn('applicant@sona3.local');
  assert.equal((await applicant.post('/i/sona3/applications', {})).status, 201, 'the demo applicant can start an application in the demo cohort');
  const evaluator = await signIn('evaluator1@sona3.local');
  assert.equal((await evaluator.get('/i/sona3/evaluations/mine')).status, 200);
  const funder = await signIn('funder@sona3.local');
  assert.equal((await funder.get('/i/sona3/applications')).status, 200);

  // demo reference data — the initiatives had none
  assert.equal(await n("SELECT COUNT(*) AS n FROM shams_organizations WHERE type = 'bank'"), 2);
  assert.equal(await n('SELECT COUNT(*) AS n FROM shams_service_providers'), 0, 'D14: no provider directory is seeded');
  assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_cohorts'), 1);
  assert.equal(await n("SELECT COUNT(*) AS n FROM sona3_experts WHERE status = 'approved'"), 2);
  assert.ok(await n('SELECT COUNT(*) AS n FROM platform_bodies') >= 4, 'the directory of bodies');
  assert.ok(r.notes.some((x) => x.includes('demo banks added')));
});

/** The accounts of ACCOUNTS.md — one for each dashboard — and the platform dashboard each one opens (null: none). */
const DASHBOARD_ACCOUNTS: Array<[string, string | null]> = [
  ['admin@mobadrat.local', 'system_admin'], ['ministry@mobadrat.local', null], ['auditor@mobadrat.local', null], ['content@mobadrat.local', null],
  ['imc@mobadrat.local', 'imc'], ['encpc@shams.local', 'encpc'], ['pmu@shams.local', 'pmu'], ['funder@sona3.local', 'funder'],
  ['evaluator1@sona3.local', 'evaluator'], ['admin@shams.local', 'system_admin'], ['factory@shams.local', null], ['applicant@sona3.local', null],
  ['electricity@shams.local', 'electricity'],
];

test('SD-1b the accounts of ACCOUNTS.md exist after the deploy seeder, each signs in and opens its dashboard', async () => {
  for (const [email, type] of DASHBOARD_ACCOUNTS) {
    const c = await signIn(email);
    if (!type) continue;
    const r = await c.get(`/me/workspace/${type}`);
    assert.equal(r.status, 200, `${email} → ${type}: ${JSON.stringify(r.json)}`);
    assert.ok(r.json.data.parts.every((p: { ok: boolean }) => p.ok), email);
  }
  // the shared IMC account: IMC in both initiatives, one dashboard for both
  const imc = await signIn('imc@mobadrat.local');
  const d = (await imc.get('/me/workspace/imc')).json.data;
  assert.deepEqual(d.initiatives.map((i: { initiativeId: string }) => i.initiativeId).sort(), ['shams', 'sona3']);
});

test('SD-2 every later run (each deploy): nothing duplicated, nothing changed — including an account its owner disabled or edited', async () => {
  const counts = async () => Promise.all(['users', 'initiative_memberships', 'shams_organizations', 'shams_factories', 'shams_service_providers', 'sona3_organizations',
    'sona3_applicants', 'sona3_cohorts', 'sona3_experts', 'platform_bodies', 'platform_body_links', 'factory_profiles'].map((t) => n(`SELECT COUNT(*) AS n FROM ${t}`)));
  const { getUserByEmail, updateCoreUser } = await import('../src/core/store/users.js');
  const imc = await signIn('imc@sona3.local');
  assert.equal((await imc.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PW })).status, 200);
  const before = await counts();
  const pmu = (await getUserByEmail('pmu@shams.local'))!;
  await updateCoreUser(pmu.id, { isActive: false });
  const hash = (await getUserByEmail('imc@sona3.local'))!.passwordHash;

  const r = await seed();
  assert.ok(r.accounts.every((a) => a.status !== 'created' && a.status !== 'reset'), 'nothing created, the one-time reset does not run again');
  assert.equal(r.accounts.find((a) => a.email === 'pmu@shams.local')!.status, 'exists_disabled');
  assert.deepEqual(await counts(), before);
  assert.equal((await getUserByEmail('pmu@shams.local'))!.isActive, false, 'stays disabled');
  assert.equal((await getUserByEmail('imc@sona3.local'))!.passwordHash, hash, 'its own password kept');
  assert.equal((await getUserByEmail('imc@sona3.local'))!.mustChangePassword, false);
  assert.ok(r.notes.some((x) => x.includes('has its own, no demo bank')));
  await updateCoreUser(pmu.id, { isActive: true });
});

test('SD-2b the one-time reset (a database from an older deployment): every seeded account back in its first state, once', async () => {
  const { getUserByEmail, updateCoreUser, setPassword } = await import('../src/core/store/users.js');
  const { hashPassword } = await import('../src/core/auth/jwt.js');
  const d = await db();
  // an older deployment: accounts created with another shared password and a forced change, one disabled, one membership
  // suspended, a platform role removed — and no reset marker yet
  await d.prepare("DELETE FROM meta WHERE `key` = 'seed_accounts_reset_v1'").run();
  const other = hashPassword('An-Old-Seed-Pass-2026');
  for (const email of ['admin@mobadrat.local', 'factory@shams.local', 'evaluator2@sona3.local']) await setPassword((await getUserByEmail(email))!.id, other, true);
  const encpc = (await getUserByEmail('encpc@shams.local'))!;
  await updateCoreUser(encpc.id, { isActive: false });
  const funder = (await getUserByEmail('funder@sona3.local'))!;
  await d.prepare("UPDATE initiative_memberships SET status = 'suspended' WHERE userId = ? AND initiativeId = 'sona3'").run(funder.id);
  const content = (await getUserByEmail('content@mobadrat.local'))!;
  await d.prepare('UPDATE users SET platformRole = NULL WHERE id = ?').run(content.id);
  const old = await new Client(srv.base).login('factory@shams.local', 'An-Old-Seed-Pass-2026'); // an open session

  const r = await seed();
  assert.ok(r.accounts.every((a) => a.status === 'reset'), JSON.stringify(r.accounts.filter((a) => a.status !== 'reset')));
  assert.ok(r.notes.some((x) => x.includes(`${r.accounts.length} existing account(s) reset once`)));
  for (const a of r.accounts) await signIn(a.email); // every one: the seed password, usable at once
  assert.equal((await getUserByEmail('encpc@shams.local'))!.isActive, true, 'enabled again');
  assert.equal(await n("SELECT COUNT(*) AS n FROM initiative_memberships WHERE userId = ? AND initiativeId = 'sona3' AND status = 'active'", funder.id), 1, 'membership active');
  assert.equal((await getUserByEmail('content@mobadrat.local'))!.platformRole, 'catalog_manager', 'platform role restored');
  assert.equal((await old.get('/me')).status, 401, 'the older sessions are ended');

  // once: later runs leave the accounts as their owners keep them
  const admin = await signIn('admin@mobadrat.local');
  assert.equal((await admin.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PW })).status, 200);
  const again = await seed();
  assert.ok(again.accounts.every((a) => a.status === 'exists'), 'no second reset');
  await new Client(srv.base).login('admin@mobadrat.local', NEW_PW);
});

test('SD-3 SEED_EMAIL_DOMAIN on a database with real data: accounts on the new domain, no demo reference data next to the real one, taken ids skipped', async () => {
  process.env.SEED_EMAIL_DOMAIN = 'test.example.gov.eg';
  try {
    const r = await seed();
    const created = r.accounts.filter((a) => a.status === 'created');
    assert.equal(created.length, r.accounts.length, 'all on the new domain');
    assert.ok(r.accounts.some((a) => a.email === 'imc1.shams@test.example.gov.eg'));
    assert.ok(r.accounts.some((a) => a.email === 'admin.mobadrat@test.example.gov.eg'));
    assert.ok(r.accounts.every((a) => a.email.endsWith('@test.example.gov.eg')));
    // the listed ids (usr-imc-1 …) were taken by the first accounts: new ones, no collision
    const { getUserByEmail } = await import('../src/core/store/users.js');
    assert.notEqual((await getUserByEmail('imc1.shams@test.example.gov.eg'))!.id, 'usr-imc-1');
    // reference data already existed: still exactly the first run's
    assert.equal(await n("SELECT COUNT(*) AS n FROM shams_organizations WHERE type = 'bank'"), 2);
    assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_cohorts'), 1);
    assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_experts'), 2);
    // the second demo factory / applicant got their own organizations
    assert.equal(await n("SELECT COUNT(*) AS n FROM shams_organizations WHERE type = 'factory'"), 4);
    assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_applicants'), 2);
    const f = await signIn('factory.shams@test.example.gov.eg');
    assert.equal((await f.get('/i/shams/factory/profile')).status, 200);
  } finally { delete process.env.SEED_EMAIL_DOMAIN; }
});

test('SD-4 configuration: production seeds with the fixed seed password whatever the variables hold; a malformed SEED_EMAIL_DOMAIN is refused at start', async () => {
  const { assertProductionSafe, assertConfigValid, seedPassword, DEFAULT_SEED_PASSWORD } = await import('../src/config.js');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(64), REGISTRY_ADAPTER: 'http', SEED_ON_DEPLOY: '1', SEED_ON_BOOT: '0', RATE_LIMIT_SCALE: '' });
    delete process.env.SEED_PASSWORD;
    assert.doesNotThrow(() => assertProductionSafe(), 'no deployment variable needed for the seeded accounts');
    assert.equal(seedPassword(), DEFAULT_SEED_PASSWORD);
    process.env.SEED_PASSWORD = 'An-Old-Generated-Value-From-Coolify';
    assert.equal(seedPassword(), DEFAULT_SEED_PASSWORD, 'an old SERVICE_PASSWORD_SEED does not change it');
    process.env.SEED_EMAIL_DOMAIN = 'not a domain';
    assert.throws(() => assertConfigValid(), /SEED_EMAIL_DOMAIN/);
    process.env.SEED_EMAIL_DOMAIN = 'test.example.gov.eg';
    assert.doesNotThrow(() => assertConfigValid());
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
