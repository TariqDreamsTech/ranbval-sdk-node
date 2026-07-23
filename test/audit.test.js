/**
 * Access audit log — records that a secret was used, never the secret itself.
 *
 * Run:  node --test test/audit.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { SecretString } = require('../src/crypto/secretString');
const { getAuditLog, clearAuditLog, auditScope } = require('../src/crypto/audit');

test('use() records an entry', () => {
  clearAuditLog();
  new SecretString('sk-x', 'OPENAI_KEY').use();
  const log = getAuditLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].label, 'OPENAI_KEY');
  assert.equal(typeof log[0].timestamp, 'number');
});

test('the plaintext is never in the log', () => {
  clearAuditLog();
  const secret = 'sk-this-must-not-appear';
  const s = new SecretString(secret, 'KEY');
  `Bearer ${s.use()}`;
  assert.ok(!JSON.stringify(getAuditLog()).includes(secret));
});

test('the caller location points outside the SDK', () => {
  clearAuditLog();
  new SecretString('sk-x', 'KEY').use();
  const { caller } = getAuditLog()[0];
  // The caller is this test file — not audit.js or secretString.js. Whatever the path (it may well
  // contain spaces), it must resolve to the user's file, not our own.
  assert.match(caller, /audit\.test\.js:\d+/);
});

test('clearAuditLog empties it', () => {
  new SecretString('sk-x', 'KEY').use();
  clearAuditLog();
  assert.equal(getAuditLog().length, 0);
});

test('getAuditLog returns a copy, not the live array', () => {
  clearAuditLog();
  new SecretString('sk-x', 'KEY').use();
  const snapshot = getAuditLog();
  new SecretString('sk-y', 'KEY2').use();
  assert.equal(snapshot.length, 1, 'a snapshot must not grow when a later access happens');
});

test('auditScope isolates the entries produced inside it', () => {
  clearAuditLog();
  new SecretString('sk-before', 'BEFORE').use();
  const { entries } = auditScope(() => {
    new SecretString('sk-inside', 'INSIDE').use();
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'INSIDE');
});
