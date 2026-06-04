/**
 * Smoke test against the BUILT bundle (dist/index.js) — the file npm publishes.
 * Ensures the published artifact behaves identically to the source.
 *
 * Run:  npm run build && node --test test/dist.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const distPath = path.resolve(__dirname, '..', 'dist', 'index.js');

if (!fs.existsSync(distPath)) {
  test('dist bundle exists', () => {
    assert.fail('dist/index.js missing — run `npm run build` first.');
  });
} else {
  const sdk = require(distPath);
  const { safeDecrypt, deriveKey, decryptKey, SecretString } = sdk;

  function buildVaultToken(plaintext, projectSecret) {
    const salt = 'noiseDIST1';
    const key = deriveKey(projectSecret, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `ranbval.${salt}.${Buffer.concat([iv, ct, tag]).toString('base64url')}.ahsan`;
  }

  test('dist: round-trip decrypt', () => {
    process.env.RANBVAL_SKIP_REPO_CHECK = '1';
    const token = buildVaultToken('sk-dist-roundtrip', 'ranbval-proj-dist');
    const out = safeDecrypt(token, 'ranbval-proj-dist');
    assert.strictEqual(String(out.use()), 'sk-dist-roundtrip');
  });

  test('dist: SecretString blocks display', () => {
    const s = new SecretString('top-secret');
    assert.strictEqual(String(s), '[ranbval:secret]');
    assert.strictEqual(JSON.stringify({ s }), '{"s":"[ranbval:secret]"}');
    assert.strictEqual(String(s.use()), 'top-secret');
  });

  test('dist: decryptKey via env prefix discovery', () => {
    process.env.RANBVAL_SKIP_REPO_CHECK = '1';
    process.env.RANBVAL_PROJECT_SECRET = 'ranbval-proj-dist-env';
    process.env.MY_DIST_KEY = buildVaultToken('sk-dist-env', 'ranbval-proj-dist-env');
    assert.strictEqual(String(decryptKey('MY_DIST_KEY').use()), 'sk-dist-env');
  });
}
