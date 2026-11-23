// Secrets generated on the first production start (core/secrets.ts): JWT_SECRET and the seeded accounts' SEED_PASSWORD,
// kept in SECRETS_DIR so restarts and other instances use the same value; a value from the environment always wins.
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

test('SC-2 production: generated once into SECRETS_DIR, then the same values on every start (and another instance)', () => {
  const dir = path.join(tmp(), 'secrets'); // created on demand
  const first: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, SEED_ON_DEPLOY: '1', JWT_SECRET: '', SEED_PASSWORD: '' };
  const g = ensureGeneratedSecrets(first);
  assert.deepEqual(g.map((s) => [s.name, s.createdNow]), [['JWT_SECRET', true], ['SEED_PASSWORD', true]]);
  assert.ok(first.JWT_SECRET!.length >= 48);
  assert.ok(first.SEED_PASSWORD!.length >= 12 && first.SEED_PASSWORD !== 'Mobadrat@2026');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'jwt-secret')).mode & 0o777, 0o600);
  const lines = describeGeneratedSecrets(g);
  assert.ok(lines.some((l) => l.includes(first.SEED_PASSWORD!)), 'the first-sign-in password is shown on the start that created it');
  assert.ok(!lines.some((l) => l.includes(first.JWT_SECRET!)), 'the JWT secret is never printed');

  const again: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, SEED_ON_DEPLOY: '1' };
  const g2 = ensureGeneratedSecrets(again);
  assert.deepEqual(g2.map((s) => s.createdNow), [false, false]);
  assert.equal(again.JWT_SECRET, first.JWT_SECRET);
  assert.equal(again.SEED_PASSWORD, first.SEED_PASSWORD);
  assert.ok(!describeGeneratedSecrets(g2).some((l) => l.includes(first.SEED_PASSWORD!)), 'later starts do not print it again');
});

test('SC-3 values from the environment win and nothing is written; no seed password without seeding', () => {
  const dir = tmp();
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, JWT_SECRET: 'j'.repeat(64), SEED_ON_DEPLOY: '1', SEED_PASSWORD: 'Given-Seed-Pass-2026' };
  assert.deepEqual(ensureGeneratedSecrets(env), []);
  assert.equal(env.SEED_PASSWORD, 'Given-Seed-Pass-2026');
  assert.deepEqual(fs.readdirSync(dir), []);
  const off: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, JWT_SECRET: 'j'.repeat(64), SEED_ON_DEPLOY: '0' };
  assert.deepEqual(ensureGeneratedSecrets(off), []);
  assert.equal(off.SEED_PASSWORD, undefined);
  const cli: NodeJS.ProcessEnv = { NODE_ENV: 'production', SECRETS_DIR: dir, JWT_SECRET: 'j'.repeat(64), SEED_ON_DEPLOY: '0' };
  assert.equal(ensureGeneratedSecrets(cli, { seeding: true }).length, 1, 'the seed CLI always gets the password');
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
