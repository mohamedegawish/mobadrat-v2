// العقود: كل route في Express موثق في openapi وكل مسار موثق موجود (الاتجاهين)، والحالات في العقد = الـworkflow.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import { isolateTestEnv } from './helpers.js';

const env = isolateTestEnv('contracts');
after(async () => { await env.cleanup(); });
const contractsDir = path.resolve(import.meta.dirname, '..', 'contracts');

function routesOf(router: Router): string[] {
  const out: string[] = [];
  for (const layer of (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${layer.route.path.replace(/:(\w+)/g, '{$1}')}`);
  }
  return out;
}

function specOps(file: string): string[] {
  const spec = JSON.parse(fs.readFileSync(path.join(contractsDir, file), 'utf8'));
  const out: string[] = [];
  for (const [p, ops] of Object.entries<Record<string, unknown>>(spec.paths)) {
    for (const m of Object.keys(ops)) if (['get', 'post', 'put', 'delete', 'patch'].includes(m)) out.push(`${m.toUpperCase()} ${p}`);
  }
  return out.sort();
}

test('site API: Express routes ⇔ contracts/openapi.json ⇔ ROUTES', async () => {
  // The module's API (mounted at /api/v1/i/shams): its private router and its public router under /public.
  const mods = await Promise.all([
    import('../routes/auth.js'), import('../routes/meta.js'), import('../routes/factory.js'),
    import('../routes/applications.js'), import('../routes/reports.js'), import('../routes/admin.js'),
    import('../routes/registry.js'), import('../routes/approvals.js'), import('../routes/notifications.js'),
  ]);
  const routers = [mods[0].meRouter, mods[1].metaRouter, mods[2].factoryRouter, mods[3].applicationsRouter, mods[4].reportsRouter, mods[5].adminRouter, mods[6].registryRouter, mods[7].approvalsRouter, mods[8].notificationsRouter];
  const publicRoutes = [mods[0].publicAuthRouter, mods[1].metaRouter].flatMap(routesOf).map((r) => r.replace(' /', ' /public/'));
  const express = [...new Set([...routers.flatMap(routesOf), ...publicRoutes])].sort();
  const documented = specOps('openapi.json');
  assert.deepEqual(express.filter((r) => !documented.includes(r)), [], 'undocumented routes');
  assert.deepEqual(documented.filter((r) => !express.includes(r)), [], 'documented but missing routes');
  const { ROUTES } = await import('../contracts/api.contracts.js');
  const fromContract = Object.values(ROUTES).map((r) => r.replace('/api/v1/i/shams', '').replace(/:(\w+)/g, '{$1}')).sort();
  assert.deepEqual(fromContract, express, 'ROUTES constant matches the server');
});

test('integration API: Express routes ⇔ contracts/integration.openapi.json, read-only on applications', async () => {
  const { integrationRouter } = await import('../integration/router.js');
  const express = routesOf(integrationRouter).sort();
  const documented = specOps('integration.openapi.json');
  assert.deepEqual(express, documented);
  assert.ok(express.filter((r) => r.includes('/applications')).every((r) => r.startsWith('GET ')), 'no write operation on applications');
});

test('states and actions in the contract match the workflow source of truth', async () => {
  const contract = await import('../contracts/api.contracts.js');
  const wf = await import('../workflow/shamsWorkflow.js');
  assert.deepEqual([...contract.APPLICATION_STATES], [...wf.APPLICATION_STATES]);
  assert.deepEqual([...contract.ACTIONS], [...wf.ACTIONS]);
  assert.deepEqual([...contract.TERMINAL_STATES], [...wf.TERMINAL_STATES]);
  const spec = JSON.parse(fs.readFileSync(path.join(contractsDir, 'integration.openapi.json'), 'utf8'));
  assert.deepEqual(spec.components.schemas.ApplicationState.enum, [...wf.APPLICATION_STATES]);
});

test('transition table: every non-terminal state has a way forward and only listed roles act', async () => {
  const wf = await import('../workflow/shamsWorkflow.js');
  for (const s of wf.APPLICATION_STATES) {
    if (wf.isTerminal(s)) { assert.equal(wf.transitionsFrom(s).length, 0, `${s} is terminal`); continue; }
    // G-02: a retired state is entered by no transition and leads nowhere except withdrawal (the migration moved every application out of it).
    if (wf.RETIRED_STATES.includes(s)) {
      assert.ok(!wf.TRANSITIONS.some((t) => t.to === s || t.from === s), `${s} is retired`);
      continue;
    }
    assert.ok(wf.transitionsFrom(s).some((t) => t.action !== 'withdraw'), `${s} has a forward transition`);
  }
  assert.ok(!wf.TRANSITIONS.some((t) => t.actorRole === 'system_admin'), 'admin has no decision');
  assert.ok(!wf.TRANSITIONS.some((t) => t.action === 'reject' && t.actorRole !== 'imc_reviewer'), 'only IMC can reject');
  const policy = (await import('../config/shamsPolicy.js')).shamsPolicy;
  for (const k of ['companyName', 'industrialRegistryNumber', 'electricityBills', 'ownershipProofFile'] as const) assert.equal(typeof policy.requiredFields[k], 'boolean');
});
