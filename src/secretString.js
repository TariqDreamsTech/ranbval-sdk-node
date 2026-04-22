/**
 * SecretString — a wrapper that never exposes its value via toString / inspect / JSON.
 *
 * The decrypted secret is held in memory but blocked from accidental exposure:
 *
 *     console.log(secret)          // [ranbval:secret]
 *     `${secret}`                  // [ranbval:secret]
 *     util.inspect(secret)         // SecretString(***)
 *     JSON.stringify(secret)       // "[ranbval:secret]"   (intentional, no leak)
 *     console.dir(secret)          // SecretString { _value: '[ranbval:secret]' }
 *
 * To actually use the value (pass to an API, header, etc.):
 *
 *     secret.use()                 // returns the raw string (only access point)
 */

'use strict';

const util = require('util');

class SecretString {
  /**
   * @param {string} value
   * @param {string} [label]
   */
  constructor(value, label = 'secret') {
    // Store value as a non-enumerable, non-writable property so it does not
    // appear in console.dir / Object.keys / JSON.stringify output.
    Object.defineProperty(this, '_value', {
      value: String(value),
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, '_label', {
      value: String(label),
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.freeze(this);
  }

  // ── All display paths blocked ─────────────────────────────────────────────

  toString() {
    return '[ranbval:secret]';
  }

  // util.inspect uses this when console.log is given the object directly
  [util.inspect.custom]() {
    return 'SecretString(***)';
  }

  // JSON.stringify path
  toJSON() {
    return '[ranbval:secret]';
  }

  // Template-literal coercion
  [Symbol.toPrimitive]() {
    return '[ranbval:secret]';
  }

  // ── Only explicit access point ────────────────────────────────────────────

  /**
   * Return the raw secret value for use in API calls, headers, etc.
   * This is the only way to access the plaintext — call deliberately.
   *
   * @returns {string}
   *
   * @example
   *   const client = new OpenAI({ apiKey: secret.use() });
   */
  use() {
    return this._value;
  }

  /** Length of the secret (safe — does not reveal content). */
  get length() {
    return this._value.length;
  }

  /** Optional label set at decrypt time (e.g. env var name). */
  get label() {
    return this._label;
  }
}

module.exports = { SecretString };
