// The Shams module schema on the platform's MySQL (core tables + shams_* tables). The append-only / immutability triggers
// are also exercised end-to-end by 18-business-audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, q } from './helpers.js';

const env = isolateTestEnv('myschema');

before(async () => {
  const { registerModuleMigrations } = await import('../../../core/boot.js');
  registerModuleMigrations();
  await (await import('../db/database.js')).initDb();
});
after(async () => { await env.cleanup(); });

test('S-1 the core and the Shams module migrations are applied and recorded per module', async () => {
  const rows = await q<{ module: string; version: number }>('SELECT module, version FROM schema_migrations ORDER BY module, version');
  assert.ok(rows.some((r) => r.module === 'core' && Number(r.version) === 1));
  assert.ok(rows.some((r) => r.module === 'shams' && Number(r.version) === 1));
});

test('S-2 every Shams table is prefixed, identity/audit/notifications are core tables, structural organizations exist', async () => {
  const tables = new Set((await q<{ t: string }>('SELECT TABLE_NAME AS t FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()')).map((r) => r.t));
  for (const t of ['shams_organizations', 'shams_factories', 'shams_applications', 'shams_application_data', 'shams_documents', 'shams_application_transitions',
    'shams_deficiencies', 'shams_service_providers', 'shams_registry_blocks', 'shams_distribution_contracts', 'shams_webhook_outbox', 'shams_integration_keys']) assert.ok(tables.has(t), t);
  for (const t of ['users', 'refresh_tokens', 'audit_logs', 'notification_outbox', 'user_notifications', 'initiative_memberships', 'industrial_zones']) assert.ok(tables.has(t), t);
  for (const t of ['organizations', 'applications', 'documents', 'factories']) assert.ok(!tables.has(t), 'no unprefixed ' + t);
  const orgs = (await q<{ id: string }>('SELECT id FROM shams_organizations ORDER BY id')).map((r) => r.id);
  assert.deepEqual(orgs, ['org-admin', 'org-electricity', 'org-encpc', 'org-imc', 'org-pmu'], 'structural organisations');
});

test('S-3 the partial-unique keys and the history triggers exist (constraint and trigger names are prefixed: they are schema-global)', async () => {
  const uniques = new Set((await q<{ n: string }>("SELECT DISTINCT INDEX_NAME AS n FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0")).map((r) => r.n));
  for (const n of ['ux_apps_open_factory', 'ux_apps_open_registry', 'ux_account_requests_pending_email', 'ux_account_requests_pending_target',
    'ux_objections_pending', 'ux_recovery_open', 'ux_users_verify_token', 'ux_users_reset_token']) assert.ok(uniques.has(n), n);
  const triggers = new Set((await q<{ n: string }>('SELECT TRIGGER_NAME AS n FROM information_schema.triggers WHERE TRIGGER_SCHEMA = DATABASE()')).map((r) => r.n));
  for (const n of ['audit_no_delete', 'audit_no_update', 'memberships_identity_locked', 'shams_deficiencies_immutable', 'shams_deficiencies_no_delete',
    'shams_referral_history_no_delete', 'shams_referral_history_no_update', 'shams_transitions_no_delete', 'shams_transitions_no_update', 'shams_membership_role_org']) assert.ok(triggers.has(n), n);
});

test('S-4 the partial unique rules hold on MySQL: one open application per factory and per submitted registry number', async () => {
  const { getDb } = await import('../db/database.js');
  const db = getDb();
  const now = new Date().toISOString();
  const ins = (id: string, fac: string, state: string, reg: string | null) => db.prepare(`INSERT INTO shams_applications (id, factoryId, state, industrialRegistryNumber, stateEnteredAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, fac, state, reg, now, now, now);
  for (const n of [1, 2]) {
    await db.prepare("INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES (?, 'factory', ?, ?, ?, ?)").run(`org-f${n}`, `مصنع ${n}`, `F${n}`, now, now);
    await db.prepare('INSERT INTO shams_factories (id, organizationId, companyName, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run(`fac-${n}`, `org-f${n}`, `مصنع ${n}`, now, now);
  }
  await ins('a1', 'fac-1', 'IMC_REVIEW', 'R-1');
  await assert.rejects(ins('a2', 'fac-1', 'DRAFT', null), /Duplicate entry/, 'second open application of the same factory');
  await assert.rejects(ins('a3', 'fac-2', 'IMC_REVIEW', 'R-1'), /Duplicate entry/, 'same registry number, both submitted');
  await ins('a4', 'fac-2', 'DRAFT', 'R-1'); // a draft does not reserve the number
  await db.prepare("UPDATE shams_applications SET state = 'WITHDRAWN' WHERE id = 'a1'").run();
  await ins('a5', 'fac-1', 'IMC_REVIEW', 'R-1'); // closed → a new open application and the number are free again
  await assert.rejects(db.prepare("UPDATE shams_applications SET state = 'IMC_REVIEW' WHERE id = 'a4'").run(), /Duplicate entry/, 'submitting the draft collides');
});

test('S-5 CHECK constraints, character lengths, binary ids and case-insensitive e-mail behave as in SQLite', async () => {
  const { getDb } = await import('../db/database.js');
  const db = getDb();
  const now = new Date().toISOString();
  await assert.rejects(db.prepare("INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('o-x', 'bogus', 'x', 'x', ?, ?)").run(now, now),
    /check constraint|CONSTRAINT .* failed/i, 'MySQL: "Check constraint … is violated"; MariaDB: "CONSTRAINT … failed"');
  // 200 Arabic characters (400 bytes) fit the 200-character limit; 201 do not
  await db.prepare("INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('o-ar', 'bank', ?, 'x', ?, ?)").run('ب'.repeat(200), now, now);
  await assert.rejects(db.prepare("INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('o-ar2', 'bank', ?, 'x', ?, ?)").run('ب'.repeat(201), now, now));
  // ids are binary (case-sensitive), like SQLite
  await db.prepare("INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('O-AR', 'bank', 'y', 'y', ?, ?)").run(now, now);
  // e-mail unique regardless of case (platform accounts)
  const user = (id: string, email: string) => db.prepare('INSERT INTO users (id, email, nameAr, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email, 'n', '', now, now);
  await user('u-1', 'Reviewer@Example.gov.eg');
  await assert.rejects(user('u-2', 'reviewer@example.GOV.eg'), /Duplicate entry/);
  assert.equal((await q('SELECT id FROM users WHERE email = ? COLLATE NOCASE', 'REVIEWER@example.gov.eg')).length, 1);
  // a Shams membership's role must match the organisation type, and never changes
  const member = (id: string, userId: string, role: string, org: string) => db.prepare('INSERT INTO initiative_memberships (id, userId, initiativeId, role, organizationId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, 'shams', role, org, now, now);
  await db.prepare('INSERT IGNORE INTO initiatives (id, slug, moduleId, titleAr, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run('shams', 'shams', 'shams', 'شمس الصناعة', now, now);
  await assert.rejects(member('m-x', 'u-1', 'pmu_reviewer', 'org-imc'), /role does not match organization type/);
  await member('m-1', 'u-1', 'imc_reviewer', 'org-imc');
  await assert.rejects(db.prepare('UPDATE initiative_memberships SET role = ? WHERE id = ?').run('pmu_reviewer', 'm-1'), /membership role and organization cannot change/);
  // audit is append-only
  await db.prepare("INSERT INTO audit_logs (id, at, actorType, action, entityType) VALUES ('aud-x', ?, 'system', 'x', 'x')").run(now);
  await assert.rejects(db.prepare("UPDATE audit_logs SET action = 'y' WHERE id = 'aud-x'").run(), /append-only/);
  await assert.rejects(db.prepare("DELETE FROM audit_logs WHERE id = 'aud-x'").run(), /append-only/);
});

test('S-6 migration 011: new states, the distribution document kind and the two-path constraints are enforced on MySQL', async () => {
  const { getDb } = await import('../db/database.js');
  const db = getDb();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('org-f11', 'factory', 'مصنع 11', 'F11', ?, ?)").run(now, now);
  await db.prepare("INSERT INTO shams_organizations (id, type, nameAr, nameEn, createdAt, updatedAt) VALUES ('org-b11', 'bank', 'بنك 11', 'B11', ?, ?)").run(now, now);
  await db.prepare("INSERT INTO shams_factories (id, organizationId, companyName, createdAt, updatedAt) VALUES ('fac-11', 'org-f11', 'مصنع 11', ?, ?)").run(now, now);
  const ins = (id: string, state: string, path: string | null, bank: string | null) => db.prepare(`INSERT INTO shams_applications (id, factoryId, state, contractPath, bankOrgId, stateEnteredAt, createdAt, updatedAt)
    VALUES (?, 'fac-11', ?, ?, ?, ?, ?, ?)`).run(id, state, path, bank, now, now, now);
  const violated = /check constraint|CONSTRAINT .* failed/i;
  await assert.rejects(ins('x1', 'DISTRIBUTION_UPLOAD', null, null), violated, 'distribution stage without the distribution path');
  await assert.rejects(ins('x2', 'CONTRACT_OUTCOME', 'distribution', 'org-b11'), violated, 'both paths at once');
  await assert.rejects(ins('x3', 'CONTRACT_OUTCOME', 'other', null), violated, 'unknown path');
  await ins('a11', 'DISTRIBUTION_REVIEW', 'distribution', null);
  await assert.rejects(db.prepare("UPDATE shams_applications SET bankOrgId = 'org-b11' WHERE id = 'a11'").run(), violated, 'no bank on the distribution path');
  await db.prepare("UPDATE shams_applications SET state = 'WITHDRAWN' WHERE id = 'a11'").run();
  await ins('a12', 'CONTRACT_OUTCOME', 'bank', 'org-b11');
  await db.prepare('INSERT INTO users (id, email, nameAr, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run('u-f11', 'f11@x.y', 'n', '', now, now);
  await db.prepare(`INSERT INTO shams_documents (id, applicationId, kind, version, attempt, uploadedInState, originalName, storedName, sizeBytes, sha256, uploadedBy, createdAt)
    VALUES ('d11', 'a11', 'distributionApprovalFile', 1, 1, 'DISTRIBUTION_UPLOAD', 'a.pdf', 's11', 10, ?, 'u-f11', ?)`).run('a'.repeat(64), now);
  await assert.rejects(db.prepare(`INSERT INTO shams_documents (id, applicationId, kind, version, attempt, uploadedInState, originalName, storedName, sizeBytes, sha256, uploadedBy, createdAt)
    VALUES ('d12', 'a11', 'bogusKind', 1, 1, 'X', 'a.pdf', 's12', 10, ?, 'u-f11', ?)`).run('a'.repeat(64), now), violated);
  await db.prepare("INSERT INTO shams_distribution_contracts (id, applicationId, selectedAt, approvalDocumentId, reviewStatus) VALUES ('dc11', 'a11', ?, 'd11', 'pending')").run(now);
  await assert.rejects(db.prepare("INSERT INTO shams_distribution_contracts (id, applicationId, selectedAt) VALUES ('dc12', 'a11', ?)").run(now), /Duplicate entry/, 'one result row per application');
  await assert.rejects(db.prepare("UPDATE shams_distribution_contracts SET reviewStatus = 'approved' WHERE id = 'dc11'").run(), violated, 'a decision needs its date');
});
