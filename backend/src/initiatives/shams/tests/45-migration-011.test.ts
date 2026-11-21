// Migration 011 (contracting paths) on a synthetic v10 database — never a real one.
// Realistic data is produced through the real API (bank contract closed, bank chosen and open, path not chosen yet, a withdrawn
// application with deficiencies, documents, history, inbox and outbox rows). The database is then turned back into a genuine v10
// schema by an inverse script that exists only in this test, and 011 is applied with the real migration runner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, startServer, clients, act, advanceTo, getApp, createCompleteDraft, uploadContractFile, uploadDistributionApproval, q, BANK_A, BANK_B, onMysql, type Started } from './helpers.js';

const env = isolateTestEnv('mig011');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
const ids = { contracted: '', bankOpen: '', noPath: '', withdrawn: '' };
let countsBefore: Record<string, number> = {};
let appsBefore: Array<Record<string, unknown>> = [];
let docsBefore: unknown[] = [];
let transitionsBefore: unknown[] = [];
let indexesBefore: string[] = [];
let ran: string[] = [];

// The v10 shapes of the two rebuilt tables (001 applications, 007 documents), and the v10 index set.
const V10_DOWN = `
CREATE TABLE applications_v10 (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,
  factoryId TEXT NOT NULL REFERENCES factories(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','IMC_REVIEW','IMC_CORRECTION','ENCPC_REVIEW','ENCPC_CORRECTION','PROVIDER_SELECTION','OFFER_UPLOAD',
    'OFFER_REVIEW','OFFER_CORRECTION','ELECTRICITY_UPLOAD','ELECTRICITY_REVIEW','BANK_STUDY','CONTRACT_OUTCOME',
    'REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  providerId TEXT REFERENCES service_providers(id),
  bankOrgId TEXT REFERENCES organizations(id),
  companyName TEXT NOT NULL DEFAULT '',
  governorate TEXT NOT NULL DEFAULT '',
  industrialZone TEXT NOT NULL DEFAULT '',
  industrialRegistryNumber TEXT,
  totalRoofArea REAL NOT NULL DEFAULT 0 CHECK (totalRoofArea >= 0),
  registryVerificationId TEXT REFERENCES registry_verifications(id),
  verifiedRegistryNumber TEXT,
  createdBy TEXT REFERENCES users(id),
  submittedAt TEXT,
  stateEnteredAt TEXT NOT NULL,
  closedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
INSERT INTO applications_v10 SELECT id, number, factoryId, state, version, attempt, providerId, bankOrgId, companyName, governorate, industrialZone,
  industrialRegistryNumber, totalRoofArea, registryVerificationId, verifiedRegistryNumber, createdBy, submittedAt, stateEnteredAt, closedAt, createdAt, updatedAt FROM applications;
DROP TABLE distribution_contracts;
DROP TABLE applications;
ALTER TABLE applications_v10 RENAME TO applications;
CREATE INDEX idx_apps_state ON applications(state);
CREATE INDEX idx_apps_factory ON applications(factoryId);
CREATE INDEX idx_apps_bank ON applications(bankOrgId);
CREATE INDEX idx_apps_governorate ON applications(governorate);
CREATE INDEX idx_apps_created ON applications(createdAt);
CREATE UNIQUE INDEX ux_apps_open_factory ON applications(factoryId)
  WHERE state NOT IN ('REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN');
CREATE UNIQUE INDEX ux_apps_open_registry ON applications(industrialRegistryNumber)
  WHERE industrialRegistryNumber IS NOT NULL AND state NOT IN ('DRAFT','REJECTED','CONTRACTED','CLOSED_NOT_CONTRACTED','WITHDRAWN');
CREATE TABLE documents_v10 (
  id TEXT PRIMARY KEY,
  applicationId TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('commercialRegisterFile','industrialRegisterFile','taxCardFile','electricityBill',
    'ownershipProofFile','technicalOfferFile','electricityApprovalFile','contractFile')),
  version INTEGER NOT NULL CHECK (version >= 1),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  supersededAtAttempt INTEGER,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','removed')),
  uploadedInState TEXT NOT NULL,
  originalName TEXT NOT NULL,
  storedName TEXT NOT NULL UNIQUE,
  mimeType TEXT NOT NULL DEFAULT 'application/pdf',
  sizeBytes INTEGER NOT NULL CHECK (sizeBytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  uploadedBy TEXT NOT NULL REFERENCES users(id),
  createdAt TEXT NOT NULL,
  UNIQUE (applicationId, kind, version)
);
INSERT INTO documents_v10 SELECT * FROM documents;
DROP TABLE documents;
ALTER TABLE documents_v10 RENAME TO documents;
CREATE INDEX idx_docs_app ON documents(applicationId, kind);
DELETE FROM schema_migrations WHERE version = 11;
`;

const OLD_APP_COLUMNS = ['id', 'number', 'factoryId', 'state', 'version', 'attempt', 'providerId', 'bankOrgId', 'companyName', 'governorate', 'industrialZone',
  'industrialRegistryNumber', 'totalRoofArea', 'registryVerificationId', 'verifiedRegistryNumber', 'createdBy', 'submittedAt', 'stateEnteredAt', 'closedAt', 'createdAt', 'updatedAt'];

async function tableCounts(): Promise<Record<string, number>> {
  const tables = await q<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations', 'distribution_contracts') ORDER BY name");
  const out: Record<string, number> = {};
  for (const t of tables) out[t.name] = Number((await q<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t.name}"`))[0].n);
  return out;
}
const indexNames = async (tables: string[]) => (await q<{ name: string }>(
  `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' AND tbl_name IN (${tables.map(() => '?').join(',')}) ORDER BY name`, ...tables)).map((r) => r.name);

before(async () => {
  srv = await startServer();
  c = await clients(srv.base);
  if (onMysql) return; // the SQLite rebuild is what is under test; MySQL 011 is covered by the MySQL schema tests
  // factory 2: an application returned for correction (open deficiency) and then withdrawn; then one on the bank path, still open
  ids.withdrawn = await createCompleteDraft(c.factory2, 'IND-M11-WD');
  assert.equal((await act(c.factory2, ids.withdrawn, 'submit')).status, 200);
  assert.equal((await act(c.imc, ids.withdrawn, 'request_correction', { deficiencies: [{ field: 'address', note: 'العنوان ناقص' }] })).status, 200);
  assert.equal((await act(c.factory2, ids.withdrawn, 'withdraw', { reason: 'انسحاب قبل الترحيل' })).status, 200);
  ids.bankOpen = await advanceTo('CONTRACT_OUTCOME', { ...c, factory: c.factory2 }, 'IND-M11-BANK', BANK_B);
  // factory 1: a contracted bank application (closed), then one waiting for the contracting choice
  ids.contracted = await advanceTo('CONTRACT_OUTCOME', c, 'IND-M11-DONE', BANK_A);
  await uploadContractFile(c.factory, ids.contracted, 'm11-evidence');
  assert.equal((await act(c.factory, ids.contracted, 'record_contract', { contractDate: '2026-10-01', contractAmount: 750_000 })).status, 200);
  ids.noPath = await advanceTo('BANK_SELECTION', c, 'IND-M11-CHOICE');

  // back to a genuine v10 database, with the real migration runner applying 011 next
  const { rawSqlite, runMigrations } = await import('../src/db/sqlite.js');
  const raw = rawSqlite();
  raw.exec('PRAGMA foreign_keys = OFF');
  raw.exec('BEGIN IMMEDIATE');
  raw.exec(V10_DOWN);
  raw.exec('COMMIT');
  raw.exec('PRAGMA foreign_keys = ON');
  assert.ok(!(await q<{ name: string }>('PRAGMA table_info(applications)')).some((col) => col.name === 'contractPath'), 'v10 has no contractPath');

  countsBefore = await tableCounts();
  appsBefore = await q(`SELECT ${OLD_APP_COLUMNS.join(', ')} FROM applications ORDER BY id`);
  docsBefore = await q('SELECT * FROM documents ORDER BY id');
  transitionsBefore = await q('SELECT * FROM application_transitions ORDER BY id');
  indexesBefore = await indexNames(['applications', 'documents']);
  ran = runMigrations(raw);
});
after(async () => { await srv.close(); await env.cleanup(); });

test('M11-1 the runner applies 011 once, with foreign keys restored afterwards and every reference intact', { skip: onMysql ? 'SQLite rebuild path (MySQL 011 is covered by 34-mysql-schema S-6 and the MySQL migration rehearsal)' : false }, async () => {
  assert.deepEqual(ran.map((f) => f.slice(0, 3)), ['011']);
  assert.equal(Number((await q<{ foreign_keys: number }>('PRAGMA foreign_keys'))[0].foreign_keys), 1, 'foreign keys are back on');
  assert.equal((await q<{ integrity_check: string }>('PRAGMA integrity_check'))[0].integrity_check, 'ok');
  assert.equal((await q('PRAGMA foreign_key_check')).length, 0);
  const { rawSqlite, runMigrations } = await import('../src/db/sqlite.js');
  assert.deepEqual(runMigrations(rawSqlite()), [], 're-running is a no-op');
});

test('M11-2 no row is lost or changed: every table keeps its rows; applications, documents and history are identical', { skip: onMysql ? 'SQLite rebuild path (MySQL 011 is covered by 34-mysql-schema S-6 and the MySQL migration rehearsal)' : false }, async () => {
  assert.deepEqual(await tableCounts(), countsBefore, 'row count of every table unchanged (the CASCADE children of applications included)');
  assert.deepEqual(await q(`SELECT ${OLD_APP_COLUMNS.join(', ')} FROM applications ORDER BY id`), appsBefore);
  assert.deepEqual(await q('SELECT * FROM documents ORDER BY id'), docsBefore);
  assert.deepEqual(await q('SELECT * FROM application_transitions ORDER BY id'), transitionsBefore);
  assert.equal(Number((await q<{ n: number }>('SELECT COUNT(*) AS n FROM distribution_contracts'))[0].n), 0);
});

test('M11-3 backfill: an application with a chosen bank is on the bank path; the others have no path yet', { skip: onMysql ? 'SQLite rebuild path (MySQL 011 is covered by 34-mysql-schema S-6 and the MySQL migration rehearsal)' : false }, async () => {
  const rows = await q<{ id: string; bankOrgId: string | null; contractPath: string | null }>('SELECT id, bankOrgId, contractPath FROM applications');
  for (const r of rows) assert.equal(r.contractPath, r.bankOrgId ? 'bank' : null, r.id);
  assert.equal(rows.find((r) => r.id === ids.contracted)!.contractPath, 'bank');
  assert.equal(rows.find((r) => r.id === ids.bankOpen)!.contractPath, 'bank');
  assert.equal(rows.find((r) => r.id === ids.noPath)!.contractPath, null);
  assert.equal(rows.find((r) => r.id === ids.withdrawn)!.contractPath, null);
});

test('M11-4 schema: indexes recreated (+ the new one), new constraints active, history guards still enforced', { skip: onMysql ? 'SQLite rebuild path (MySQL 011 is covered by 34-mysql-schema S-6 and the MySQL migration rehearsal)' : false }, async () => {
  assert.deepEqual(await indexNames(['applications', 'documents']), [...indexesBefore, 'idx_apps_contract_path'].sort());
  const { getDb } = await import('../src/db/sqlite.js');
  const db = getDb();
  await assert.rejects(db.prepare("UPDATE applications SET state = 'DISTRIBUTION_UPLOAD' WHERE id = ?").run(ids.noPath), /CHECK/i, 'a distribution stage needs the distribution path');
  await assert.rejects(db.prepare("UPDATE applications SET contractPath = 'distribution' WHERE id = ?").run(ids.bankOpen), /CHECK/i, 'never both paths');
  await assert.rejects(db.prepare('DELETE FROM application_transitions WHERE applicationId = ?').run(ids.contracted), /append-only/, '006 history guard');
  await assert.rejects(db.prepare("UPDATE applications SET state = 'IMC_REVIEW' WHERE id = ?").run(ids.withdrawn), /UNIQUE/i, 'one open application per factory (partial unique index)');
});

test('M11-5 legacy applications keep working: the open bank application stays on its path; the one without a choice gets both paths', { skip: onMysql ? 'SQLite rebuild path (MySQL 011 is covered by 34-mysql-schema S-6 and the MySQL migration rehearsal)' : false }, async () => {
  // bank chosen before the migration → only the bank outcome, the distribution path is locked
  assert.deepEqual((await getApp(c.factory2, ids.bankOpen)).allowedActions.map((a: any) => a.action).sort(), ['record_contract', 'record_no_contract', 'withdraw']);
  const locked = await act(c.factory2, ids.bankOpen, 'select_distribution_path');
  assert.equal(locked.status, 409);
  assert.equal(locked.json.code, 'CONTRACT_PATH_LOCKED');
  // the closed contract still reads as a bank contract with its evidence
  const done = await getApp(c.factory, ids.contracted);
  assert.equal(done.state, 'CONTRACTED');
  assert.equal(done.contractPath, 'bank');
  assert.equal(done.bankReferral.contractStatus, 'contracted');
  const evidence = done.documents.find((d: any) => d.kind === 'contractFile');
  assert.equal((await c.factory.get(`/applications/${ids.contracted}/documents/${evidence.id}/download`)).status, 200);
  // no choice yet → both paths; the new path works on a pre-migration application
  assert.deepEqual((await getApp(c.factory, ids.noPath)).allowedActions.map((a: any) => a.action).sort(), ['select_bank', 'select_distribution_path', 'withdraw']);
  assert.equal((await act(c.factory, ids.noPath, 'select_distribution_path')).status, 200);
  await uploadDistributionApproval(c.factory, ids.noPath, 'm11-dist');
  assert.equal((await act(c.factory, ids.noPath, 'submit_distribution_approval')).status, 200);
  assert.equal((await act(c.pmu, ids.noPath, 'accept')).status, 200);
  const app = await getApp(c.factory, ids.noPath);
  assert.equal(app.state, 'CONTRACTED');
  assert.equal(app.contractPath, 'distribution');
});
