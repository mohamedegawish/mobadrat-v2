// Manual verification of the industrial registry (REGISTRY_ADAPTER=manual) — until the registry API is connected:
// factories register and reach IMC normally, the check is recorded honestly as 'manual' (never 'valid'), IMC sees it and
// checks the uploaded certificate, and the checks that need no API (one open application per number) still apply.
// Compared with http without a URL, where nobody could even register (503 REGISTRY_UNAVAILABLE).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolateTestEnv, startServer, clients, Client, q, act, getApp, registerFactory, registrationPayload, activationTokenFor, type Started,
} from './helpers.js';

const env = isolateTestEnv('regmanual');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let seq = 0;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { process.env.REGISTRY_ADAPTER = 'mock'; delete process.env.REGISTRY_API_URL; await srv.close(); await env.cleanup(); });

const appOf = async (email: string) => (await q<{ id: string }>(`SELECT a.id FROM shams_applications a JOIN shams_factories f ON f.id = a.factoryId
  JOIN initiative_memberships m ON m.organizationId = f.organizationId AND m.initiativeId = 'shams' JOIN users u ON u.id = m.userId WHERE u.email = ?`, email))[0].id;

test('RM-1 the registry API is not set (http, no URL): a factory cannot even register — the reason for the manual mode', async () => {
  process.env.REGISTRY_ADAPTER = 'http';
  delete process.env.REGISTRY_API_URL;
  const r = await registerFactory(new Client(srv.base), registrationPayload(`rm.none.${++seq}@test.local`, `IND-RM-NONE-${seq}`));
  assert.equal(r.status, 503, JSON.stringify(r.json));
  assert.equal(r.json.code, 'REGISTRY_UNAVAILABLE');
});

test('RM-2 manual: registration and activation go to IMC; recorded as a manual check; IMC sees it with the certificate', async () => {
  process.env.REGISTRY_ADAPTER = 'manual';
  const email = `rm.ok.${++seq}@test.local`;
  const reg = `IND-RM-OK-${seq}`;
  const r = await registerFactory(new Client(srv.base), registrationPayload(email, reg));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const v = await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(email) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.data.submitted, true, 'auto-submitted to IMC');

  const id = await appOf(email);
  const app = await getApp(c.imc, id);
  assert.equal(app.state, 'IMC_REVIEW');
  assert.equal(app.registry.result, 'manual', 'never presented as verified');
  assert.equal(app.registry.registryNumber, reg);
  assert.equal(app.registry.facility, null);
  assert.ok(app.documents.some((d: { kind: string; isCurrent: boolean }) => d.kind === 'industrialRegisterFile' && d.isCurrent), 'the certificate IMC checks');
  const rows = await q<{ result: string; adapter: string }>('SELECT result, adapter FROM shams_registry_verifications WHERE applicationId = ?', id);
  assert.deepEqual(rows.map((x) => [x.result, x.adapter]), [['manual', 'manual']]);
  const t = await q<{ payload: string }>("SELECT payload FROM shams_application_transitions WHERE applicationId = ? AND toState = 'IMC_REVIEW'", id);
  assert.equal(JSON.parse(t[0].payload).registryResult, 'manual');

  // IMC decides as usual (after checking the certificate by hand)
  assert.equal((await act(c.imc, id, 'accept')).status, 200);
  assert.equal((await getApp(c.imc, id)).state, 'ENCPC_REVIEW');
});

test('RM-3 manual: a number already used by an open application holds the new draft (F2 / D3: account + held draft, never submitted until PMU decides)', async () => {
  process.env.REGISTRY_ADAPTER = 'manual';
  const reg = `IND-RM-DUP-${++seq}`;
  const first = `rm.dup1.${seq}@test.local`;
  assert.equal((await registerFactory(new Client(srv.base), registrationPayload(first, reg))).status, 201);
  assert.equal((await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(first) })).json.data.submitted, true);
  const secondEmail = `rm.dup2.${seq}@test.local`;
  const second = await registerFactory(new Client(srv.base), registrationPayload(secondEmail, reg));
  assert.equal(second.status, 201, JSON.stringify(second.json));
  assert.equal(second.json.data.registryHeld, true);
  const v = await new Client(srv.base).post('/auth/verify-email', { token: await activationTokenFor(secondEmail) });
  assert.equal(v.json.data.submitted, false, 'the held draft is not submitted');
  assert.equal(v.json.data.modules.shams.registryHeld, true);
});

test('RM-4 production accepts the manual mode (unlike mock); readiness says the registry is checked by hand', async () => {
  const { assertProductionSafe } = await import('../../../config.js');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(64), REGISTRY_ADAPTER: 'manual', SEED_ON_BOOT: '0', SEED_ON_DEPLOY: '0', RATE_LIMIT_SCALE: '' });
    assert.doesNotThrow(() => assertProductionSafe());
    process.env.REGISTRY_ADAPTER = 'mock';
    delete process.env.ALLOW_MOCK_REGISTRY_IN_PRODUCTION;
    assert.throws(() => assertProductionSafe(), /REGISTRY_ADAPTER=mock is forbidden/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  process.env.REGISTRY_ADAPTER = 'manual';
  const { readinessReport } = await import('../services/readiness.js');
  const check = (await readinessReport()).checks.find((x: { key: string }) => x.key === 'registry_api');
  assert.ok(check);
  assert.equal(check!.ok, false, 'a reminder to connect the API');
  assert.match(check!.detailAr, /تحقق يدوي/);
});
