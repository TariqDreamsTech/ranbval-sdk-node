/**
 * Smoke test: PBKDF2 + AES-256-GCM round-trip parity with the Python SDK wire format.
 *
 * Run:  node --test test/crypto.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { safeDecrypt, deriveKey, decryptKey, SecretString } = require('../src');

/** Build a Python-SDK-compatible vault token from plaintext. */
function buildVaultToken(plaintext, projectSecret) {
  const salt = 'noise12345'.slice(0, 10);
  const key = deriveKey(projectSecret, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, ct, tag]).toString('base64url');
  return `ranbval.${salt}.${packed}.ahsan`;
}

test('safeDecrypt round-trips a token built with the same key derivation', () => {
  const projectSecret = 'ranbval-proj-test-1234567890';
  const plaintext = 'sk-test-supersecretvalue';
  const token = buildVaultToken(plaintext, projectSecret);

  // Repo check skipped via env so the test does not hit the network.
  process.env.RANBVAL_SKIP_REPO_CHECK = '1';

  const out = safeDecrypt(token, projectSecret);
  assert.ok(out instanceof SecretString);
  assert.strictEqual(out.use(), plaintext);
  assert.strictEqual(String(out), '[ranbval:secret]');
  assert.strictEqual(out.length, plaintext.length);
});

test('safeDecrypt throws on wrong project secret', () => {
  const token = buildVaultToken('hello', 'right-secret');
  process.env.RANBVAL_SKIP_REPO_CHECK = '1';
  assert.throws(
    () => safeDecrypt(token, 'wrong-secret'),
    /Decryption failed/,
  );
});

test('safeDecrypt throws on malformed token', () => {
  process.env.RANBVAL_SKIP_REPO_CHECK = '1';
  assert.throws(() => safeDecrypt('not-a-ranbval-token', 'whatever'), /fragmentation error|signature matrix/);
  assert.throws(() => safeDecrypt('foo.bar.baz.ahsan', 'whatever'), /signature matrix/);
});

test('decryptKey reads token from env and uses RANBVAL_PROJECT_SECRET fallback', () => {
  process.env.RANBVAL_SKIP_REPO_CHECK = '1';
  const projectSecret = 'ranbval-proj-globaltest';
  process.env.RANBVAL_PROJECT_SECRET = projectSecret;
  process.env.MY_OPENAI_KEY = buildVaultToken('sk-my-openai', projectSecret);
  const out = decryptKey('MY_OPENAI_KEY');
  assert.strictEqual(out.use(), 'sk-my-openai');
});

test('decryptKey returns plain (non-vault) values as-is', () => {
  process.env.PLAIN_API_KEY = 'sk-plain-12345';
  const out = decryptKey('PLAIN_API_KEY');
  assert.strictEqual(out.use(), 'sk-plain-12345');
});

test('SecretString blocks all leak vectors', () => {
  const s = new SecretString('top-secret');
  assert.strictEqual(String(s), '[ranbval:secret]');
  assert.strictEqual(`${s}`, '[ranbval:secret]');
  assert.strictEqual(JSON.stringify({ s }), '{"s":"[ranbval:secret]"}');
  assert.strictEqual(s.use(), 'top-secret');
  assert.throws(() => { s._value = 'leaked'; });
});
