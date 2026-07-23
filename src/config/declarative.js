/**
 * Declarative secret configuration — declare the shape once, decrypt lazily.
 *
 * The imperative style (`decryptKey('OPENAI_API_KEY')` at each call site) scatters variable names
 * through the codebase, so a rename means grepping strings. Here the names live in one object and
 * everything else refers to fields:
 *
 *     const { defineConfig, Secret } = require('ranbval-sdk');
 *
 *     const Config = defineConfig({
 *       openai: Secret('SECRET_OPENAI_KEY'),
 *       stripe: Secret('SECRET_STRIPE_KEY', { reveal: true }),   // plaintext string
 *     });
 *
 *     Config.openai        // -> SecretString, decrypted on first read and cached
 *     Config.stripe        // -> plaintext string
 *
 * Nothing is decrypted at definition time. A field is decrypted the first time it is read and
 * cached after that, so declaring a key you never use costs nothing — and a config object can name
 * every secret in the system without every process needing all of them.
 *
 * Mirrors ranbval_sdk.config.declarative. Python uses descriptors on a class; JavaScript has no
 * descriptor protocol, so this uses lazy accessors on a frozen object — same laziness, same
 * caching, same single source of names.
 */

'use strict';

const { RanbvalConfigError } = require('../exceptions/config');

const _SPEC = Symbol('ranbval.secretSpec');

/**
 * Declare one secret field.
 *
 * @param {string} envVar  The `.ranbval` variable name, e.g. `SECRET_OPENAI_KEY`.
 * @param {{reveal?: boolean}} [opts]
 *   `reveal: true` yields the plaintext string instead of a SecretString. Use it only where a
 *   library refuses anything else — a SecretString is what stops the value reaching a log.
 */
function Secret(envVar, opts = {}) {
  if (!envVar || typeof envVar !== 'string') {
    throw new RanbvalConfigError('Secret() needs the .ranbval variable name as a string.', {
      code: 'config_error',
    });
  }
  return { [_SPEC]: true, envVar, reveal: Boolean(opts.reveal) };
}

/**
 * Build a config object from a map of `Secret()` declarations.
 *
 * @param {Record<string, ReturnType<typeof Secret>>} fields
 * @returns {Record<string, any>} frozen; each field decrypts on first read, then caches.
 */
function defineConfig(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new RanbvalConfigError('defineConfig() needs an object of Secret() declarations.', {
      code: 'config_error',
    });
  }

  const target = {};
  const cache = new Map();

  for (const [name, spec] of Object.entries(fields)) {
    if (!spec || !spec[_SPEC]) {
      throw new RanbvalConfigError(
        `Field "${name}" is not a Secret() declaration. Write: ${name}: Secret('SECRET_…')`,
        { code: 'config_error', field: name },
      );
    }

    Object.defineProperty(target, name, {
      enumerable: true,
      configurable: false,
      get() {
        if (cache.has(name)) return cache.get(name);
        // Required lazily: importing the cipher at module load would pull the whole crypto path in
        // for anyone who merely declares a config, and would make this file's import order matter.
        const { decryptKey } = require('../crypto/cipher');
        const secret = decryptKey(spec.envVar);
        const value = spec.reveal ? String(secret.use()) : secret;
        cache.set(name, value);
        return value;
      },
    });
  }

  /** Drop cached values so the next read decrypts again — used by tests and after a reload. */
  Object.defineProperty(target, 'clearCache', {
    enumerable: false,
    value: () => cache.clear(),
  });

  return Object.freeze(target);
}

module.exports = { Secret, defineConfig };
