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
 *     secret.use()                 // returns a _ProtectedValue; secret stays valid
 *
 *     // using keyword (Node 22+ / TC39 explicit resource management)
 *     using key = decryptKey('MY_KEY');
 *     const client = new OpenAI({ apiKey: key.use() });
 *     // key.wipe() called automatically at block exit
 *
 *     // Manual wipe
 *     secret.wipe();               // zeroes Buffer; use() throws after this
 *
 * Output guards:
 *     loadRanbval() patches console.log/info/warn/error/debug and process.stdout.write
 *     so that passing a _ProtectedValue (the return of .use()) to any output function
 *     raises a PermissionError. This includes both direct use and template-literal coercion:
 *
 *         console.log(key.use())            // PermissionError
 *         console.log(`${key.use()}`)       // PermissionError
 *         const x = key.use();
 *         console.log(x)                    // PermissionError
 *
 *     SDK usage is unaffected:
 *         new OpenAI({ apiKey: key.use() }) // works — no console output
 *         `Bearer ${key.use()}`             // works inside SDK internals
 */

'use strict';

const util = require('util');
const enforcement = require('./enforcement');
const audit = require('./audit');

// WeakMap keeps wiped state private — cannot be tampered via property access.
const _wiped = new WeakMap();

// Symbol for storing raw string value inside _ProtectedValue — not enumerable.
const _rawSym = Symbol('ranbval.raw');

// ── Call-site tracking for template-literal-in-console detection ──────────────
/** Brand so the output guard can recognise the type without stringifying it. */
const PROTECTED_BRAND = Symbol.for('ranbval.protectedValue');

// ── _ProtectedValue ───────────────────────────────────────────────────────────

/**
 * Returned by SecretString.use(). Behaves like a string in all SDK/HTTP contexts
 * (string concatenation, template literals, httpx header construction) but cannot
 * be accidentally printed or logged:
 *
 *     console.log(key.use())          // PermissionError (direct)
 *     console.log(`${key.use()}`)     // PermissionError (template literal)
 *     `Bearer ${key.use()}`           // works — value reaches SDK, no console call
 */
class _ProtectedValue {
  constructor(raw) {
    Object.defineProperty(this, _rawSym, {
      value: String(raw),
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  get [PROTECTED_BRAND]() {
    return true;
  }

  toString() {
    return this[_rawSym];
  }

  valueOf() {
    return this[_rawSym];
  }

  [Symbol.toPrimitive](hint) {
    if (hint === 'number') return NaN;
    return this[_rawSym];
  }

  [util.inspect.custom]() {
    return 'SecretString(***)';
  }

  toJSON() {
    return '[ranbval:secret]';
  }
}

/**
 * Wrap a revealed value so the extraction routes are watched.
 *
 * Reading it as a whole string — a template literal, passing it to an SDK — is what the value is
 * *for*, so those pass straight through. What gets stopped is reading it apart: iterating it,
 * indexing it, slicing it, or reaching for the raw buffer. Those have no legitimate use and are
 * exactly how a value is lifted out of memory a character at a time.
 *
 * A Proxy is the only way to see a property read in JavaScript. It is not airtight — anyone in
 * this process can call `String.prototype.charAt.call(v, 0)` and bypass the trap entirely — which
 * is why the module docstring says PROXY_ secrets are the only absolute guarantee.
 */
const _SLICERS = new Set(['slice', 'substring', 'substr', 'charAt', 'charCodeAt', 'at', 'codePointAt', 'split']);

function _guarded(protectedValue) {
  return new Proxy(protectedValue, {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) {
        return function* () {
          enforcement.guardReveal('iteration');
          yield* target[_rawSym];
        };
      }
      if (typeof prop === 'string') {
        // val[0], val[1], … — reading it out one character at a time.
        if (/^\d+$/.test(prop)) {
          enforcement.guardReveal('index');
          return target[_rawSym][Number(prop)];
        }
        if (_SLICERS.has(prop)) {
          enforcement.guardReveal('slice');
          return target[_rawSym][prop].bind(target[_rawSym]);
        }
      }
      if (prop === _rawSym) {
        // Nothing outside this module has a reason to want the backing store itself.
        // (It is a module-private Symbol, so in practice nothing outside *can* name it.)
        enforcement.guardReveal('buffer_read');
      }

      const value = Reflect.get(target, prop, receiver);
      // The value's own methods read the backing store through `this`. Left unbound, `this` would
      // be the proxy and every coercion would trip the buffer_read trap above — the guard would
      // fire on the one path it is meant to allow. Bind them to the real object instead.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// ── SecretString ───────────────────────────────────────────────────────────────

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
      writable: false,
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
   * Return the secret value for use in API calls, headers, etc.
   *
   * Returns a _ProtectedValue — an object that works identically to a plain string
   * inside any SDK or HTTP client (string concatenation, template literals, header
   * construction), but cannot be printed, logged, or accidentally output:
   *
   *     const client = new OpenAI({ apiKey: secret.use() });  // correct
   *     console.log(secret.use())                             // PermissionError
   *     const x = secret.use(); console.log(x)               // PermissionError
   *
   * Throws if the secret has already been wiped.
   *
   * @returns {_ProtectedValue}
   */
  use() {
    if (_wiped.get(this)) {
      throw new Error('SecretString has been wiped and cannot be used again');
    }
    // Reveal gate: if this secret is restricted to explicit scopes, refuse to produce the
    // plaintext outside one. Required lazily — reveal.js has no dependency on this module.
    require('../config/reveal').gate(this._label);
    // Recorded before the value is handed over, so the log holds even if the caller then throws.
    audit.recordAccess(this._label);
    const plain = this._buf.toString('utf8');
    // Put the output guard up before this process holds the plaintext, and register the value
    // that triggered it — otherwise the very first secret, the one most likely to be logged
    // while debugging, would be the one value the guard could not recognise. Required lazily to
    // avoid a cycle: outputGuards has no dependency on this module.
    const guards = require('./outputGuards');
    guards.ensureInstalled();
    guards.registerRevealed(plain);
    return _guarded(new _ProtectedValue(plain));
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

module.exports = { PROTECTED_BRAND, SecretString, _ProtectedValue };
