// Deploy seeder (core/seedDeploy.ts, SEED_ON_DEPLOY=1): one account for every role of the platform and of each initiative,
// usable at once (sign in → forced password change → the role's screens); creates only what is missing on every run; never
// changes an existing account; next to real reference data it adds no demo banks / providers / cohort / experts;
// SEED_EMAIL_DOMAIN; legacy ids already taken; the production guard on SEED_PASSWORD.
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
  shams: ['system_admin', 'imc_reviewer', 'encpc_reviewer', 'pmu_reviewer', 'factory_owner'],
  sona3: ['system_admin', 'imc_officer', 'evaluator', 'funder_reviewer', 'applicant'],
};
const NEW_PW = 'MyOwnPass2026';

async function firstSignIn(email: string): Promise<Client> {
  const c = await new Client(srv.base).login(email, PASSWORD);
  const me = await c.get('/auth/me');
  assert.equal(me.json.data.user.mustChangePassword, true, `${email} must change the shared password`);
  const blocked = await c.get('/me');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'PASSWORD_CHANGE_REQUIRED');
  const ch = await c.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: NEW_PW });
  assert.equal(ch.status, 200, JSON.stringify(ch.json));
  c.token = ch.json.data.accessToken;
  return c;
}

test('SD-1 a fresh database: an account for every role, each usable after its own password; the demo data they need', async () => {
  const r = await seed();
  assert.ok(r.accounts.length >= 17);
  assert.ok(r.accounts.every((a) => a.status === 'created'), JSON.stringify(r.accounts.filter((a) => a.status !== 'created')));
  for (const role of ROLES.platform) assert.ok(r.accounts.some((a) => a.initiativeId === null && a.role === role), `platform ${role}`);
  for (const id of ['shams', 'sona3']) for (const role of ROLES[id]) assert.ok(r.accounts.some((a) => a.initiativeId === id && a.role === role), `${id} ${role}`);
  assert.ok(!r.accounts.some((a) => a.role === 'bank_reviewer'), 'the retired bank role is not seeded');

  // every account: first sign-in with SEED_PASSWORD → forced change → in
  for (const a of r.accounts) await firstSignIn(a.email);

  // each role reaches its own screens
  const admin = await new Client(srv.base).login('admin@mobadrat.local', NEW_PW);
  assert.equal((await admin.get('/admin/stats')).status, 200);
  const imc = await new Client(srv.base).login('imc1@shams.local', NEW_PW);
  assert.equal((await imc.get('/i/shams/dashboard')).status, 200);
  const factory = await new Client(srv.base).login('factory@shams.local', NEW_PW);
  const fp = await factory.get('/i/shams/factory/profile');
  assert.equal(fp.status, 200, JSON.stringify(fp.json));
  assert.equal((await factory.post('/i/shams/applications', {})).status, 201, 'the demo factory can start an application');
  assert.equal((await factory.get('/me/factories')).json.data.items.length, 1, 'with its shared factory profile');
  const applicant = await new Client(srv.base).login('applicant@sona3.local', NEW_PW);
  assert.equal((await applicant.post('/i/sona3/applications', {})).status, 201, 'the demo applicant can start an application in the demo cohort');
  const evaluator = await new Client(srv.base).login('evaluator1@sona3.local', NEW_PW);
  assert.equal((await evaluator.get('/i/sona3/evaluations/mine')).status, 200);
  const funder = await new Client(srv.base).login('funder@sona3.local', NEW_PW);
  assert.equal((await funder.get('/i/sona3/applications')).status, 200);

  // demo reference data — the initiatives had none
  assert.equal(await n("SELECT COUNT(*) AS n FROM shams_organizations WHERE type = 'bank'"), 2);
  assert.equal(await n("SELECT COUNT(*) AS n FROM shams_service_providers WHERE status = 'approved'"), 2);
  assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_cohorts'), 1);
  assert.equal(await n("SELECT COUNT(*) AS n FROM sona3_experts WHERE status = 'approved'"), 2);
  assert.ok(await n('SELECT COUNT(*) AS n FROM platform_bodies') >= 4, 'the directory of bodies');
  assert.ok(r.notes.some((x) => x.includes('demo banks added')));
});

test('SD-2 every later run (each deploy): nothing duplicated, nothing changed — including an account its owner disabled or edited', async () => {
  const counts = async () => Promise.all(['users', 'initiative_memberships', 'shams_organizations', 'shams_factories', 'shams_service_providers', 'sona3_organizations',
    'sona3_applicants', 'sona3_cohorts', 'sona3_experts', 'platform_bodies', 'platform_body_links', 'factory_profiles'].map((t) => n(`SELECT COUNT(*) AS n FROM ${t}`)));
  const { getUserByEmail, updateCoreUser } = await import('../src/core/store/users.js');
  const before = await counts();
  const pmu = (await getUserByEmail('pmu@shams.local'))!;
  await updateCoreUser(pmu.id, { isActive: false });
  const hash = (await getUserByEmail('imc@sona3.local'))!.passwordHash;

  const r = await seed();
  assert.ok(r.accounts.every((a) => a.status !== 'created'), 'nothing created');
  assert.equal(r.accounts.find((a) => a.email === 'pmu@shams.local')!.status, 'exists_disabled');
  assert.deepEqual(await counts(), before);
  assert.equal((await getUserByEmail('pmu@shams.local'))!.isActive, false, 'stays disabled');
  assert.equal((await getUserByEmail('imc@sona3.local'))!.passwordHash, hash, 'its own password kept');
  assert.equal((await getUserByEmail('imc@sona3.local'))!.mustChangePassword, false);
  assert.ok(r.notes.some((x) => x.includes('has its own, no demo bank')));
  await updateCoreUser(pmu.id, { isActive: true });
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
    assert.equal(await n('SELECT COUNT(*) AS n FROM shams_service_providers'), 2);
    assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_cohorts'), 1);
    assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_experts'), 2);
    // the second demo factory / applicant got their own organizations
    assert.equal(await n("SELECT COUNT(*) AS n FROM shams_organizations WHERE type = 'factory'"), 4);
    assert.equal(await n('SELECT COUNT(*) AS n FROM sona3_applicants'), 2);
    await firstSignIn('factory.shams@test.example.gov.eg');
    const f = await new Client(srv.base).login('factory.shams@test.example.gov.eg', NEW_PW);
    assert.equal((await f.get('/i/shams/factory/profile')).status, 200);
  } finally { delete process.env.SEED_EMAIL_DOMAIN; }
});

test('SD-4 configuration: production refuses the seeder without its own SEED_PASSWORD; a malformed SEED_EMAIL_DOMAIN is refused at start', async () => {
  const { assertProductionSafe, assertConfigValid } = await import('../src/config.js');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(64), REGISTRY_ADAPTER: 'http', SEED_ON_DEPLOY: '1', SEED_ON_BOOT: '0', RATE_LIMIT_SCALE: '' });
    delete process.env.SEED_PASSWORD;
    assert.throws(() => assertProductionSafe(), /SEED_PASSWORD is required/);
    process.env.SEED_PASSWORD = 'Mobadrat@2026';
    assert.throws(() => assertProductionSafe(), /must not be the public development default/);
    process.env.SEED_PASSWORD = 'short1A';
    assert.throws(() => assertProductionSafe(), /too short/);
    process.env.SEED_PASSWORD = 'A-strong-seed-pass-2026';
    assert.doesNotThrow(() => assertProductionSafe());
    process.env.SEED_EMAIL_DOMAIN = 'not a domain';
    assert.throws(() => assertConfigValid(), /SEED_EMAIL_DOMAIN/);
    process.env.SEED_EMAIL_DOMAIN = 'test.example.gov.eg';
    assert.doesNotThrow(() => assertConfigValid());
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
