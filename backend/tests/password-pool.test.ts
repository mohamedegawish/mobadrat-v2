// PASSWORD_POOL_SIZE: the number of password-check workers (load test: a burst of sign-ins is limited by this pool).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordPoolSizeFor } from '../src/core/auth/passwordPool.js';

test('PP-1 default: cores − 1, at least 1, at most 4', () => {
  assert.equal(passwordPoolSizeFor(undefined, 16), 4);
  assert.equal(passwordPoolSizeFor('', 4), 3);
  assert.equal(passwordPoolSizeFor(undefined, 1), 1);
});

test('PP-2 PASSWORD_POOL_SIZE sets it (1–32); anything else keeps the default', () => {
  assert.equal(passwordPoolSizeFor('8', 16), 8);
  assert.equal(passwordPoolSizeFor('1', 16), 1);
  assert.equal(passwordPoolSizeFor('32', 2), 32);
  for (const bad of ['0', '33', '-2', '2.5', 'eight', ' ']) assert.equal(passwordPoolSizeFor(bad, 16), 4, `refused: "${bad}"`);
});
