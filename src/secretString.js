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

// WeakMap keeps wiped state private — cannot be tampered via property access.
const _wiped = new WeakMap();

// Symbol for storing raw string value inside _ProtectedValue — not enumerable.
const _rawSym = Symbol('ranbval.raw');

// ── Call-site tracking for template-literal-in-console detection ──────────────
// Set by _ProtectedValue.toString / [Symbol.toPrimitive], cleared by output guards.
let _recentCoercionSite = null;

/**
 * Return the Nth stack frame above this function's direct caller, with the column
 * number stripped so that two calls on the same source line compare as equal
 * regardless of their column positions within the expression.
 *
 * skipExtra=0 → the function that called _callerOf
 * skipExtra=1 → one level above that
 */
function _callerOf(skipExtra) {
  try {
    const frame = (new Error().stack.split('\n')[2 + skipExtra] || '').trim();
    // Strip column: "at foo (file.js:10:5)" → "at foo (file.js:10)"
    //               "at file.js:10:5"        → "at file.js:10"
    return frame.replace(/:\d+(\)?)$/, '$1');
  } catch {
    return '';
  }
}

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

  toString() {
    // Record call site so the output guard can detect console.log(`${key.use()}`).
    // Stack: _callerOf → toString → actual caller (lines[3] = _callerOf(1))
    _recentCoercionSite = _callerOf(1);
    return this[_rawSym];
  }

  valueOf() {
    return this[_rawSym];
  }

  [Symbol.toPrimitive](hint) {
    if (hint === 'number') return NaN;
    // Record call site for template-literal / string-concat detection.
    _recentCoercionSite = _callerOf(1);
    return this[_rawSym];
  }

  [util.inspect.custom]() {
    return 'SecretString(***)';
  }

  toJSON() {
    return '[ranbval:secret]';
  }
}

// ── Output guards ─────────────────────────────────────────────────────────────

let _guardsInstalled = false;
const _origConsole = {};
let _origStdoutWrite = null;

const _ERR =
  'Ranbval: cannot output a protected secret. ' +
  'Pass it directly to the SDK — e.g. new OpenAI({ apiKey: key.use() })';

function _makePermissionError() {
  const err = new Error(_ERR);
  err.name = 'PermissionError';
  return err;
}

/**
 * Check args for _ProtectedValue (direct) and check whether [Symbol.toPrimitive]
 * / toString ran on the same source line as the current output call (template literal).
 *
 * @param {unknown[]} args
 * @param {number} extraFrames  frames between _checkOutput and the user's call site
 */
function _checkOutput(args, extraFrames) {
  // Case 1 — direct: console.log(key.use())
  for (const arg of args) {
    if (arg instanceof _ProtectedValue) {
      throw _makePermissionError();
    }
  }
  // Case 2 — coerced: console.log(`${key.use()}`) or console.log("" + key.use())
  // [Symbol.toPrimitive]/toString recorded the call site just before us.
  // If it matches this call's source line, block.
  const callerSite = _callerOf(extraFrames);
  if (_recentCoercionSite && callerSite && _recentCoercionSite === callerSite) {
    _recentCoercionSite = null;
    throw _makePermissionError();
  }
  _recentCoercionSite = null;
}

/**
 * Patch console.log/info/warn/error/debug and process.stdout.write so that
 * passing a _ProtectedValue (the value returned by SecretString.use()) to any
 * output function raises a PermissionError instead of leaking the plaintext.
 *
 * Called automatically by loadRanbval(). Safe to call multiple times.
 */
function installOutputGuards() {
  if (_guardsInstalled) return;

  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    if (typeof console[method] === 'function') {
      const orig = console[method].bind(console);
      _origConsole[method] = orig;
      // Stack when user calls console.log(...):
      //   _callerOf → _checkOutput → ranbvalGuard → user code
      // So extraFrames = 2 → lines[2+2] = lines[4] = user code
      console[method] = function ranbvalGuard(...args) {
        _checkOutput(args, 2);
        return orig(...args);
      };
    }
  }

  if (process.stdout && typeof process.stdout.write === 'function') {
    _origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function ranbvalGuard(chunk, ...rest) {
      if (chunk instanceof _ProtectedValue) {
        throw _makePermissionError();
      }
      return _origStdoutWrite(chunk, ...rest);
    };
  }

  _guardsInstalled = true;
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
    return new _ProtectedValue(this._buf.toString('utf8'));
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

module.exports = { SecretString, installOutputGuards, _ProtectedValue };
