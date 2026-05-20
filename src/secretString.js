/**
 * SecretString — a wrapper that never exposes its value via toString / inspect / JSON.
 *
 * The decrypted secret is stored in a mutable Buffer so it can be genuinely zeroed
 * from memory after use. All display paths are blocked against accidental exposure:
 *
 *     console.log(secret)          // [ranbval:secret]
 *     `${secret}`                  // [ranbval:secret]
 *     util.inspect(secret)         // SecretString(***)
 *     JSON.stringify(secret)       // "[ranbval:secret]"   (intentional, no leak)
 *
 * Two ways to consume the value:
 *
 *     // Direct access
 *     secret.use()                 // returns the raw string; secret stays valid
 *
 *     // using keyword (Node 22+ / TC39 explicit resource management)
 *     using key = decryptKey('MY_KEY');
 *     const client = new OpenAI({ apiKey: key.use() });
 *     // key.wipe() called automatically at block exit
 *
 *     // Manual wipe
 *     secret.wipe();               // zeroes Buffer; use() throws after this
 */

'use strict';

const util = require('util');

// WeakMap keeps wiped state private — cannot be tampered via property access.
const _wiped = new WeakMap();

class SecretString {
  /**
   * @param {string} value
   * @param {string} [label]
   */
  constructor(value, label = 'secret') {
    // Store secret in a mutable Buffer — can be genuinely zeroed unlike a JS string.
    Object.defineProperty(this, '_buf', {
      value: Buffer.from(String(value), 'utf8'),
      enumerable: false,
      writable: false,      // reference can't be replaced
      configurable: false,
    });
    Object.defineProperty(this, '_label', {
      value: String(label),
      enumerable: false,
      writable: false,
      configurable: false,
    });
    _wiped.set(this, false);
  }

  // ── Memory wipe ───────────────────────────────────────────────────────────

  /**
   * Zero the secret bytes in memory. After this, use() throws.
   * Called automatically when used with the `using` keyword (Node 22+).
   */
  wipe() {
    this._buf.fill(0);
    _wiped.set(this, true);
  }

  /**
   * TC39 explicit resource management — called automatically by the `using` keyword.
   *
   * @example
   *   using key = decryptKey('MY_KEY');
   *   const client = new OpenAI({ apiKey: key.use() });
   *   // wipe() called here automatically
   */
  [Symbol.dispose]() {
    this.wipe();
  }

  // ── All display paths blocked ─────────────────────────────────────────────

  toString() {
    return '[ranbval:secret]';
  }

  [util.inspect.custom]() {
    return 'SecretString(***)';
  }

  toJSON() {
    return '[ranbval:secret]';
  }

  [Symbol.toPrimitive]() {
    return '[ranbval:secret]';
  }

  // ── Only explicit access point ────────────────────────────────────────────

  /**
   * Return the raw secret value for use in API calls, headers, etc.
   * Throws if the secret has already been wiped.
   *
   * @returns {string}
   *
   * @example
   *   const client = new OpenAI({ apiKey: secret.use() });
   */
  use() {
    if (_wiped.get(this)) {
      throw new Error('SecretString has been wiped and cannot be used again');
    }
    return this._buf.toString('utf8');
  }

  /** Length of the secret in bytes (safe — does not reveal content). */
  get length() {
    return this._buf.length;
  }

  /** Optional label set at decrypt time (e.g. env var name). */
  get label() {
    return this._label;
  }
}

module.exports = { SecretString };
