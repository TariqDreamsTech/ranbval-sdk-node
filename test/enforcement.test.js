/**
 * Extraction enforcement — what a revealed secret lets you do, and what it refuses.
 *
 * The line this draws: reading the value as a whole (using it) is allowed; reading it apart
 * (stealing it character by character) is not. The tests assert both halves, because a guard that
 * also blocks the legitimate path is a guard nobody will leave on.
 *
 * Run:  node --test test/enforcement.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { SecretString } = require('../src/crypto/secretString');
const { setEnforcement, isEnforced } = require('../src/crypto/enforcement');
const { RanbvalSecurityError } = require('../src/exceptions/crypto');

const VALUE = 'sk-super-secret-value-123';

test('enforcement is on by default', () => {
  assert.equal(isEnforced(), true);
});

test('the documented use paths still work', () => {
  const v = new SecretString(VALUE).use();
  assert.equal(`Bearer ${v}`, `Bearer ${VALUE}`);   // template literal — the whole point
  assert.equal(String(v), VALUE);
  assert.equal('' + v, VALUE);                       // string concat
});

test('iterating a secret is blocked', () => {
  const v = new SecretString(VALUE).use();
  assert.throws(() => [...v].join(''), RanbvalSecurityError);
});

test('indexing a secret is blocked', () => {
  const v = new SecretString(VALUE).use();
  assert.throws(() => v[0], RanbvalSecurityError);
});

test('slicing a secret is blocked', () => {
  const v = new SecretString(VALUE).use();
  assert.throws(() => v.slice(0, 4), RanbvalSecurityError);
  assert.throws(() => v.substring(0, 4), RanbvalSecurityError);
  assert.throws(() => v.charAt(0), RanbvalSecurityError);
});

test('the error is machine-readable', () => {
  const v = new SecretString(VALUE).use();
  try {
    [...v];
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.code, 'secret_extraction_blocked');
    assert.equal(e.context.method, 'iteration');
  }
});

test('setEnforcement(false) reverts to permissive, and back', () => {
  setEnforcement(false);
  try {
    const v = new SecretString(VALUE).use();
    assert.equal([...v].join(''), VALUE, 'iteration should be allowed with enforcement off');
  } finally {
    setEnforcement(true);
  }
  const v = new SecretString(VALUE).use();
  assert.throws(() => [...v], RanbvalSecurityError, 'enforcement should be back on');
});

test('a PlanLimitError-style extraction message names the fix', () => {
  const v = new SecretString(VALUE).use();
  try {
    v.slice(0, 2);
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /setEnforcement\(false\)/);
    assert.match(e.message, /PROXY_/);
  }
});
