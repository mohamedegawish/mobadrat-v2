// Migration 004 (D14, D18): applications waiting in the two retired factory steps move on, with a history entry that says why.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolateTestEnv, startServer, clients, act, advanceTo, getApp, q, type Started } from './helpers.js';
import { splitSqlStatements } from '../../../core/db/migrate.js';

const env = isolateTestEnv('migration004');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;

before(async () => { srv = await startServer(); c = await clients(srv.base); });
after(async () => { await srv.close(); await env.cleanup(); });

test('provider selection moves to the offer upload, electricity upload to the ministry', async () => {
  const a = await advanceTo('OFFER_UPLOAD', c, 'IND-M004-1');
  const b = await advanceTo('OFFER_UPLOAD', { ...c, factory: c.factory2 }, 'IND-M004-2');
  const { getDb } = await import('../db/database.js');
  await getDb().prepare("UPDATE shams_applications SET state = 'PROVIDER_SELECTION' WHERE id = ?").run(a);
  await getDb().prepare("UPDATE shams_applications SET state = 'ELECTRICITY_UPLOAD' WHERE id = ?").run(b);
  const sql = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'db', 'migrations', '004_owner_changes.sql'), 'utf8');
  const moves = splitSqlStatements(sql).filter((s) => /^(--[^\n]*\n)*\s*(INSERT INTO shams_application_transitions|UPDATE shams_applications)/.test(s.trim()));
  assert.equal(moves.length, 4);
  for (const statement of moves) await getDb().prepare(statement).run();

  const first = await getApp(c.factory, a);
  assert.equal(first.state, 'OFFER_UPLOAD');
  assert.equal(first.transitions.at(-1).action, 'provider_selection_retired');
  assert.equal(first.currentTask.slaDays, 9, 'its offer deadline starts now');
  assert.equal(first.currentTask.overdue, false);
  const second = await getApp(c.electricity, b);
  assert.equal(second.state, 'ELECTRICITY_REVIEW');
  assert.equal(second.transitions.at(-1).action, 'electricity_upload_retired');
  assert.equal((await act(c.factory, a, 'withdraw', { reason: 'إنهاء' })).status, 200);
  assert.equal((await q("SELECT COUNT(*) AS n FROM shams_applications WHERE state IN ('PROVIDER_SELECTION','ELECTRICITY_UPLOAD')"))[0].n, 0);
});
