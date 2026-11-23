// Secrets generated on the first production start (core/secrets.ts): JWT_SECRET, kept in SECRETS_DIR so restarts and other
// instances use the same value; a value from the environment always wins. The seeded accounts' password is fixed
// (config.ts DEFAULT_SEED_PASSWORD), never generated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureGeneratedSecrets, describeGeneratedSecrets } from '../src/core/secrets.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'));

test('SC-1 outside production, or without SECRETS_DIR, nothing is generated', () => {
  const dir = tmp();
  assert.deepEqual(ensureGeneratedSecrets({ NODE_ENV: 'development', SECRETS_DIR: dir, SEED_ON_DEPLOY: '1' }), []);
  assert.deepEqual(ensureGeneratedSecrets({ NODE_ENV: 'production', SEED_ON_DEPLOY: '1' }), []);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('SC-2 production: generated once into SECRETS_DIR, then the same value on every start (and another instance)', () => {
  const dir = path.join(tmp(), 'secrets'); // created on demand
  const first: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, SEED_ON_DEPLOY: '1', JWT_SECRET: '', SEED_PASSWORD: '' };
  const g = ensureGeneratedSecrets(first);
  assert.deepEqual(g.map((s) => [s.name, s.createdNow]), [['JWT_SECRET', true]]);
  assert.ok(first.JWT_SECRET!.length >= 48);
  assert.equal(first.SEED_PASSWORD, '', 'no seed password is generated (the seeded accounts use the fixed one)');
  assert.ok(!fs.existsSync(path.join(dir, 'seed-password')));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'jwt-secret')).mode & 0o777, 0o600);
  assert.ok(!describeGeneratedSecrets(g).some((l) => l.includes(first.JWT_SECRET!)), 'the JWT secret is never printed');

  const again: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, SEED_ON_DEPLOY: '1' };
  const g2 = ensureGeneratedSecrets(again);
  assert.deepEqual(g2.map((s) => s.createdNow), [false]);
  assert.equal(again.JWT_SECRET, first.JWT_SECRET);
});

test('SC-3 a value from the environment wins and nothing is written', () => {
  const dir = tmp();
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, JWT_SECRET: 'j'.repeat(64), SEED_ON_DEPLOY: '1' };
  assert.deepEqual(ensureGeneratedSecrets(env), []);
  assert.equal(env.JWT_SECRET, 'j'.repeat(64));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('SC-4 a damaged secret file is not used: the start is refused by the production checks instead of a weak key', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'jwt-secret'), 'short\n');
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir };
  assert.deepEqual(ensureGeneratedSecrets(env), []);
  assert.equal(env.JWT_SECRET, undefined);
});

test('SC-5 a secret published in the repository history is recognised (by hash only) so production refuses it', async () => {
  const { isPublishedSecret, PUBLISHED_SECRET_SHA256 } = await import('../src/config.js');
  const crypto = await import('node:crypto');
  const sample = 'a-value-that-was-committed-once';
  const hash = crypto.createHash('sha256').update(sample).digest('hex');
  assert.equal(isPublishedSecret(sample, [hash]), true);
  assert.equal(isPublishedSecret('a-fresh-random-value', [hash]), false);
  assert.equal(isPublishedSecret('', [hash]), false);
  assert.ok(PUBLISHED_SECRET_SHA256.length >= 1 && PUBLISHED_SECRET_SHA256.every((h) => /^[0-9a-f]{64}$/.test(h)), 'only hashes are kept');
  assert.equal(isPublishedSecret('x'.repeat(64)), false);
});
