// Production-readiness: MAX_FILE_SIZE_MB. Valid fractional values must be enforced exactly (in whole bytes); invalid values
// must be refused, never silently replaced by another limit. Uploads use the real server and multipart parser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolateTestEnv, startServer, clients, PDF, q, type Started } from './helpers.js';

const env = isolateTestEnv('filesize');
let srv: Started;
let c: Awaited<ReturnType<typeof clients>>;
let draftId = '';

before(async () => {
  srv = await startServer();
  c = await clients(srv.base);
  draftId = (await c.factory.post('/applications', {})).json.data.id;
});
after(async () => { delete process.env.MAX_FILE_SIZE_MB; await srv.close(); await env.cleanup(); });

/** A valid PDF of exactly `size` bytes (header + padding comment). */
function pdfOfSize(size: number): Buffer {
  const pad = Math.max(0, size - PDF.length);
  return Buffer.concat([PDF, Buffer.from(`%${'x'.repeat(Math.max(0, pad - 2))}\n`)]).subarray(0, Math.max(size, PDF.length));
}

async function uploadWithLimit(limit: string | undefined, size: number) {
  if (limit === undefined) delete process.env.MAX_FILE_SIZE_MB; else process.env.MAX_FILE_SIZE_MB = limit;
  try {
    return await c.factory.upload(`/applications/${draftId}/documents`, { kind: 'taxCardFile' }, pdfOfSize(size), 'tax.pdf');
  } finally { delete process.env.MAX_FILE_SIZE_MB; }
}

test('fractional MAX_FILE_SIZE_MB is enforced in whole bytes: at the limit accepted, one byte over refused, never truncated', async () => {
  const limitBytes = Math.floor(0.01 * 1024 * 1024); // 10485
  const atLimit = await uploadWithLimit('0.01', limitBytes);
  assert.equal(atLimit.status, 201, JSON.stringify(atLimit.json));
  assert.equal(atLimit.json.data.sizeBytes, limitBytes);
  const over = await uploadWithLimit('0.01', limitBytes + 1);
  assert.equal(over.status, 413, `one byte over: ${JSON.stringify(over.json)}`);
  assert.equal(over.json.code, 'FILE_TOO_LARGE');
  const far = await uploadWithLimit('0.01', 40_000);
  assert.equal(far.status, 413, `40 KB against ~10 KB: ${JSON.stringify(far.json)}`);
  // nothing truncated was stored: every stored file has the size and hash recorded for it
  for (const d of await q<any>('SELECT storedName, sizeBytes FROM shams_documents WHERE applicationId = ?', draftId)) {
    assert.equal(fs.statSync(path.join(process.env.UPLOAD_DIR!, 'shams', 'documents', d.storedName)).size, d.sizeBytes);
  }
  assert.equal(fs.readdirSync(path.join(process.env.UPLOAD_DIR!, 'tmp')).length, 0, 'no temp file left behind');
});

test('whole-number and default limits still behave as before', async () => {
  const one = 1024 * 1024;
  assert.equal((await uploadWithLimit('1', one)).status, 201);
  assert.equal((await uploadWithLimit('1', one + 1)).status, 413);
  assert.equal((await uploadWithLimit(undefined, 2 * one)).status, 201, 'default 15 MB');
});

test('invalid MAX_FILE_SIZE_MB values are refused instead of silently becoming another limit', async () => {
  for (const bad of ['0', '-1', '-0.5', 'abc', '15MB', 'Infinity', 'NaN', '1e3', '0x10', '0.0000001']) {
    const r = await uploadWithLimit(bad, 1000);
    assert.equal(r.status, 500, `${bad}: the upload must not run with a guessed limit (${r.status} ${JSON.stringify(r.json)})`);
    assert.equal(r.json.code, 'INTERNAL_ERROR');
  }
});

test('parseMaxFileSizeMB: valid, fractional, missing, zero, negative and malformed values; the boot check refuses bad values', async () => {
  const { parseMaxFileSizeMB, maxFileSizeBytes, assertConfigValid } = await import('../config.js');
  assert.equal(parseMaxFileSizeMB(undefined), 15);
  assert.equal(parseMaxFileSizeMB(''), 15);
  assert.equal(parseMaxFileSizeMB('  '), 15);
  assert.equal(parseMaxFileSizeMB('15'), 15);
  assert.equal(parseMaxFileSizeMB(' 2 '), 2);
  assert.equal(parseMaxFileSizeMB('0.5'), 0.5);
  assert.equal(parseMaxFileSizeMB('1.25'), 1.25);
  assert.equal(maxFileSizeBytes(0.5), 524288);
  assert.equal(maxFileSizeBytes(0.01), 10485);
  assert.equal(maxFileSizeBytes(15), 15 * 1024 * 1024);
  for (const bad of ['0', '0.0', '-1', '-0.5', 'abc', '15MB', 'Infinity', 'NaN', '1e3', '0x10', '1,5', '0.0000001']) {
    assert.throws(() => parseMaxFileSizeMB(bad), /MAX_FILE_SIZE_MB/, bad);
  }
  process.env.MAX_FILE_SIZE_MB = '-3';
  try { assert.throws(() => assertConfigValid(), /MAX_FILE_SIZE_MB/); } finally { delete process.env.MAX_FILE_SIZE_MB; }
  assert.doesNotThrow(() => assertConfigValid());
});
