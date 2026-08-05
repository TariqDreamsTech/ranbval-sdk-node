/**
 * Reveal scopes — pin a secret's plaintext to exactly the call sites you approve.
 *
 * For a value your app genuinely must decrypt locally but that you do not want readable from
 * anywhere else, mark it and then reveal it only inside a scope:
 *
 *     requireRevealScope('DATABASE_PASSWORD');            // once, at startup
 *
 *     revealScope('DATABASE_PASSWORD', () => {            // the ONLY approved place
 *       db = connect({ password: decryptKey('DATABASE_PASSWORD').use() });
 *     });
 *
 *     decryptKey('DATABASE_PASSWORD').use();              // anywhere else -> throws
 *
 * Why it helps against a careless or curious colleague: without it, `.use()` works on any line, so
 * the value can be produced anywhere, invisibly. With it, `revealScope(...)` is the only place a
 * reveal is allowed — an explicit, greppable marker you can enforce in review ("this token appears
 * in exactly one file").
 *
 * Honest limit: this gates `.use()`, the normal audited access point. It does not stop someone who
 * bypasses the class entirely, which is unpreventable in-process for any SDK. What it does is
 * shrink the reveal surface from "any line, invisibly" to "one approved, auditable block".
 */

'use strict';

const { RanbvalConfigError } = require('../exceptions');

/** Labels that may only be revealed inside a scope. */
const _required = new Set();

/** Currently-open scope names. Node is single-threaded per context, so a plain set suffices. */
const _open = new Set();

/** Called inside `SecretString.use()`. Throws if `label` is restricted and out of scope. */
function gate(label) {
  if (_required.has(label) && !_open.has(label)) {
    throw new RanbvalConfigError(
      `'${label}' may only be revealed inside revealScope('${label}', ...). ` +
      'A .use() here is outside any approved reveal scope.',
      { code: 'reveal_out_of_scope' },
    );
  }
}

/** Restrict each named secret so its plaintext is revealed only inside `revealScope`. */
function requireRevealScope(...names) {
  for (const n of names) _required.add(n);
}

/** Lift all restrictions (test/reset helper). */
function clearRevealRequirements() {
  _required.clear();
  _open.clear();
}

/**
 * Permit `decryptKey(name).use()` for the duration of `fn`. Re-entrant.
 *
 * @template T
 * @param {string} name
 * @param {() => T} fn
 * @returns {T}
 */
function revealScope(name, fn) {
  const added = !_open.has(name);
  if (added) _open.add(name);
  try {
    return fn();
  } finally {
    if (added) _open.delete(name);
  }
}

module.exports = { gate, requireRevealScope, revealScope, clearRevealRequirements };
