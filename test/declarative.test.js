/**
 * Declarative config — declare secret names once, decrypt lazily on first read.
 *
 * These use plaintext values (not ranbval.* tokens), which decryptKey() wraps in a SecretString
 * without any crypto — enough to exercise the laziness, caching and reveal behaviour without a real
 * project secret.
 *
 * Run:  node --test test/declarative.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { Secret, defineConfig } = require('../src/config/declarative');
const { RanbvalConfigError } = require('../src/exceptions/config');

test('a declared field decrypts on read and returns a SecretString', () => {
  process.env.SECRET_ONE = 'plaintext-one';
  const Config = defineConfig({ one: Secret('SECRET_ONE') });
  assert.equal(`${Config.one.use()}`, 'plaintext-one');
});

test('reveal: true yields a plain string', () => {
  process.env.SECRET_TWO = 'plaintext-two';
  const Config = defineConfig({ two: Secret('SECRET_TWO', { reveal: true }) });
  assert.equal(Config.two, 'plaintext-two');
  assert.equal(typeof Config.two, 'string');
});

test('nothing is decrypted until the field is read', () => {
  // A name that is not set would throw on decrypt. Declaring it must not.
  assert.doesNotThrow(() => defineConfig({ missing: Secret('SECRET_NEVER_SET') }));
});

test('a field is cached after the first read', () => {
  process.env.SECRET_CACHED = 'first';
  const Config = defineConfig({ cached: Secret('SECRET_CACHED') });
  const a = Config.cached;
  const b = Config.cached;
  assert.strictEqual(a, b, 'the second read should return the same cached instance');
});

test('clearCache forces a re-read', () => {
  process.env.SECRET_RELOAD = 'before';
  const Config = defineConfig({ v: Secret('SECRET_RELOAD', { reveal: true }) });
  assert.equal(Config.v, 'before');
  process.env.SECRET_RELOAD = 'after';
  assert.equal(Config.v, 'before', 'still cached');
  Config.clearCache();
  assert.equal(Config.v, 'after', 'after clearing, the new value is read');
});

test('a non-Secret field is rejected at definition time', () => {
  assert.throws(() => defineConfig({ bad: 'SECRET_X' }), RanbvalConfigError);
});

test('Secret() needs a string name', () => {
  assert.throws(() => Secret(), RanbvalConfigError);
  assert.throws(() => Secret(123), RanbvalConfigError);
});

test('the config object is frozen', () => {
  const Config = defineConfig({ a: Secret('SECRET_A') });
  assert.throws(() => {
    Config.injected = 'x';
  }, TypeError);
});
