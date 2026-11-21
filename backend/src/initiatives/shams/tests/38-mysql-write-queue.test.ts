// PERF-4 (MySQL only, npm run test:mysql): writers queue inside the process before they take a pool connection.
// Before the change every writer waiting for GET_LOCK held one of the DB_POOL_SIZE connections, so a write burst left
// plain reads — even /health's SELECT 1 — waiting for the pool (measured on MySQL 8.4: /health p95 ~570 ms during a burst
// of 80 writes; docs/performance/CONCURRENCY_TEST_REPORT.md, D1). Write transactions must still run strictly one at a time,
// and a writer that waits too long must still fail with the retryable lock-timeout error (errno 1205 → 503 DB_BUSY).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isolateTestEnv, onMysql } from './helpers.js';

process.env.DB_POOL_SIZE = '4';
process.env.DB_TX_LOCK_TIMEOUT_SEC = '1';
const env = isolateTestEnv('write-queue');
const SKIP = !onMysql && 'MySQL only (npm run test:mysql)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let db: typeof import('../src/db/index.js');

before(async () => { if (SKIP) return; db = await import('../src/db/index.js'); await db.initDb(); });
after(async () => { await env.cleanup(); });

test('Q-1 a burst of writers does not take the pool from reads', { skip: SKIP }, async () => {
  // 12 writers, each holding the write lock ~60 ms, on a pool of 4: before PERF-4 they took all 4 connections.
  const writers = Array.from({ length: 12 }, () => db.tx(async () => { await db.getDb().prepare('SELECT 1').get(); await sleep(60); }));
  await sleep(30); // the burst is queued now
  const reads: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await db.getDb().prepare('SELECT 1 AS x').get();
    reads.push(performance.now() - t0);
  }
  await Promise.all(writers);
  // with the pool held by queued writers each read waited for a writer to finish (≥ 60 ms); now they get a free connection
  assert.ok(Math.max(...reads) < 50, `reads during the write burst: ${reads.map((x) => x.toFixed(1)).join(', ')} ms`);
});

test('Q-2 write transactions still run one at a time (read-modify-write never loses an update)', { skip: SKIP }, async () => {
  const year = 2999;
  await db.getDb().prepare('INSERT INTO application_counters (year, lastSeq) VALUES (?, 0)').run(year);
  await Promise.all(Array.from({ length: 25 }, () => db.tx(async () => {
    const r = await db.getDb().prepare('SELECT lastSeq FROM application_counters WHERE year = ?').get(year) as { lastSeq: number };
    await sleep(2); // yield between the read and the write, as real transaction bodies do
    await db.getDb().prepare('UPDATE application_counters SET lastSeq = ? WHERE year = ?').run(Number(r.lastSeq) + 1, year);
  })));
  const r = await db.getDb().prepare('SELECT lastSeq FROM application_counters WHERE year = ?').get(year) as { lastSeq: number };
  assert.equal(Number(r.lastSeq), 25);
  await db.getDb().prepare('DELETE FROM application_counters WHERE year = ?').run(year);
});

test('Q-3 a writer that waits longer than DB_TX_LOCK_TIMEOUT_SEC fails with the retryable lock-timeout error', { skip: SKIP }, async () => {
  const holder = db.tx(async () => { await sleep(2500); });
  await sleep(50);
  const t0 = Date.now();
  await assert.rejects(db.tx(async () => {}), (e: { errno?: number; code?: string }) => e.errno === 1205 && e.code === 'ER_LOCK_WAIT_TIMEOUT');
  const waited = Date.now() - t0;
  assert.ok(waited >= 900 && waited < 2400, `gave up after ${waited} ms (timeout 1 s)`);
  await holder;
  await db.tx(async () => {}); // the queue is usable again
});
