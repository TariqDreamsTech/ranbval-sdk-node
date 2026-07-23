/**
 * Extraction enforcement, plus the reveal-signal notifier for revealed secrets.
 *
 * With enforcement on (the default), a detected extraction of a revealed value — iterating it
 * character by character, indexing or slicing it, or reading its internal buffer — throws
 * `RanbvalSecurityError` instead of quietly handing over the plaintext. The notifier fires first,
 * so an installed access monitor records the attempt before the caller crashes.
 *
 * ## Where this differs from the Python SDK, and why
 *
 * Python blocks `str()`/`print()` while leaving f-strings working, because `__str__` and
 * `__format__` are separate hooks. JavaScript has no such split: a template literal, `String(v)`
 * and `'' + v` all funnel through the same `Symbol.toPrimitive`/`toString`. Blocking that would
 * break `` `Bearer ${key.use()}` `` — the very pattern the documentation tells people to use.
 *
 * So on this side, string coercion stays allowed and the output guards (see secretString.js) catch
 * the case that actually matters: a secret reaching the console or stdout. Iteration, indexing and
 * raw-buffer reads — which have no legitimate use and are exactly how in-memory theft is written —
 * are what throw here.
 *
 * ## Honest limit
 *
 * This stops the naive vectors. Anyone running code in this process can still reach the plaintext:
 * `String.prototype.charAt.call(v, 0)` sidesteps a Proxy trap, and a debugger sidesteps everything.
 * Only `PROXY_` secrets are absolute, because their plaintext never enters the process at all.
 * Turn enforcement off with `setEnforcement(false)`.
 *
 * Mirrors ranbval_sdk.crypto.enforcement.
 */

'use strict';

const { RanbvalSecurityError } = require('../exceptions/crypto');

// ── Reveal notifier (set by the access monitor) ───────────────────────────────

let _revealNotifier = null;

/** Register — or clear with `null` — a callback `fn(method)` for reveal-side signals. */
function setRevealNotifier(fn) {
  _revealNotifier = typeof fn === 'function' ? fn : null;
}

/** Fire the reveal-side signal if a monitor is installed. Never throws into the caller. */
function notifyReveal(method) {
  if (!_revealNotifier) return;
  try {
    _revealNotifier(method);
  } catch {
    // A broken monitor must not break the program it is watching.
  }
}

// ── Enforcement flag (strict by default) ──────────────────────────────────────

let _enforced = true;

/**
 * Turn extraction enforcement on or off process-wide (default: on).
 *
 * On  → a detected extraction (iteration / index / slice / raw buffer read) throws.
 * Off → the attempt is only reported to the access monitor and the real value is returned, for
 *       when a legitimate library trips the check.
 */
function setEnforcement(enabled) {
  _enforced = Boolean(enabled);
}

/** True when extraction attempts throw. */
function isEnforced() {
  return _enforced;
}

const _EXTRACTION_MESSAGE = {
  iteration:
    'Ranbval: character-by-character iteration of a secret is blocked — this is how in-memory ' +
    "extraction ([...key.use()].join('')) works. Pass the value straight to your SDK or HTTP " +
    'client instead. If a legitimate library needs to iterate it, call setEnforcement(false); ' +
    'for an absolute guarantee use a PROXY_ secret.',
  index:
    'Ranbval: indexing a secret (val[0]) is blocked — it reads the plaintext out one character ' +
    'at a time. Pass key.use() straight to your client; template literals still work. ' +
    '(setEnforcement(false) to disable; a PROXY_ secret is the only absolute guarantee.)',
  slice:
    'Ranbval: slicing a secret (val.slice(), val.substring()) is blocked — it reads the plaintext ' +
    'out piece by piece. Pass key.use() straight to your client; template literals still work. ' +
    '(setEnforcement(false) to disable; a PROXY_ secret is the only absolute guarantee.)',
  buffer_read:
    'Ranbval: reading a secret’s internal buffer is blocked — no legitimate caller touches it. ' +
    'Use key.use() at the point of use. (setEnforcement(false) to disable; a PROXY_ secret is the ' +
    'only absolute guarantee.)',
};

/**
 * Throw the extraction error without notifying.
 *
 * For paths that are frequent and already masked when enforcement is off, where notifying would
 * flood the monitor.
 */
function raiseExtraction(method) {
  throw new RanbvalSecurityError(
    _EXTRACTION_MESSAGE[method] || `Ranbval: blocked secret extraction via ${method}.`,
    { code: 'secret_extraction_blocked', method },
  );
}

/**
 * Report the reveal-side signal, then throw if enforcement is on.
 *
 * The notify runs first so a Live Monitor still records the attempt before the caller crashes —
 * the throw is what turns silent theft into a loud, alerting failure.
 */
function guardReveal(method) {
  notifyReveal(method);
  if (_enforced) raiseExtraction(method);
}

module.exports = {
  setRevealNotifier,
  notifyReveal,
  setEnforcement,
  isEnforced,
  raiseExtraction,
  guardReveal,
};
