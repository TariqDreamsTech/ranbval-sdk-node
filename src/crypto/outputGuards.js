/**
 * Global output guards: stop a secret from reaching a terminal or log, however it got there.
 *
 * `SecretString` blocks the *typed* paths — inspect is masked, JSON refuses. But the moment a
 * secret is interpolated, the result is an ordinary string carrying no marker at all:
 *
 *     console.log(key.use())          // still a _ProtectedValue
 *     console.log(`${key.use()}`)     // a plain string holding the plaintext
 *     console.log('Bearer ' + key.use())
 *
 * Template interpolation and `+` cannot be blocked at the source: a client library has to be able
 * to build `Authorization: Bearer <key>`, and once V8 has produced the primitive string there is
 * nothing left to intercept. Guarding the *type* therefore catches only the first spelling.
 *
 * This module guards the **destination** instead. Every value a `.use()` reveals is registered,
 * and anything written to stdout or stderr is checked against those values — so all three lines
 * above throw, along with `String(key)`, a secret nested in a logged object, and any of the
 * `console.*` methods rather than `log` alone.
 *
 * Ported from the Python SDK, where the earlier stack-inspection approach was measured and found
 * to catch one spelling out of nine. This one was measured too.
 *
 * **On by default, and it installs itself.** `loadRanbval()` puts it up during load; if you never
 * went through the loader, `SecretString.use()` puts it up before it produces the plaintext.
 * Either way the guard is in place before this process holds its first secret. That second path
 * matters because a script, a REPL, or `safeDecrypt(token, secret)` called directly would
 * otherwise produce a completely unguarded value.
 *
 * An explicit refusal is remembered: `loadRanbval({ guardStdout: false })` and
 * `uninstallOutputGuards()` both record it, so the next decrypt does not put back what the caller
 * just declined.
 *
 * Honest limits:
 *   - Covers `process.stdout` / `process.stderr` and the `console.*` methods **as they were when
 *     the guard was installed**. A stream replaced afterwards is a different object.
 *   - Not a file the app writes itself, not an outbound request, not a child process's output.
 *   - While installed, the registry holds each revealed plaintext for the life of the process.
 *     Nothing is retained while the guard is off.
 *
 * It is a guard against the accident — a debug log left in, a secret inside a logged object — not
 * against code that is deliberately exfiltrating. Only a `PROXY_` secret keeps the value off the
 * machine entirely.
 */

'use strict';

let _installed = false;

/**
 * Set only by an explicit choice. "Not installed yet" and "the caller said no" must not look the
 * same, or opting out would stop working the moment anything decrypted a secret.
 */
let _optedOut = false;

/** Plaintexts revealed while the guard is on. Populated only then. */
const _revealed = new Set();

/**
 * Below this length a "secret" collides with ordinary output more often than it matches one.
 */
const MIN_TRACKED_LEN = 8;

/** `{ target, key, original }` for everything patched, so uninstall restores exactly those. */
let _patched = [];

const ERR =
  'Ranbval: cannot output a protected secret. Pass it directly to the SDK — ' +
  'e.g. new OpenAI({ apiKey: key.use() })';

const LEAK_ERR =
  'Ranbval: this output contains a decrypted secret. It reached the stream as an ordinary ' +
  'string (a template literal, concatenation, or String()), which the value itself cannot ' +
  'block — a client library has to be able to build a header out of it. Remove the log, or ' +
  'log a masked value, or pass loadRanbval({ guardStdout: false }) if this guard is not for you.';

/** Remember a revealed plaintext so output can be checked against it. No-op when off. */
function registerRevealed(value) {
  if (_installed && typeof value === 'string' && value.length >= MIN_TRACKED_LEN) {
    _revealed.add(value);
  }
}

/** True when `text` carries any revealed secret — the check a type test cannot do. */
function containsSecret(text) {
  if (typeof text !== 'string' || !_revealed.size) return false;
  for (const secret of _revealed) {
    if (text.includes(secret)) return true;
  }
  return false;
}

/**
 * Inspect one console argument. Objects are stringified because a secret nested in a logged
 * object is a routine leak — `console.log({ apiKey: \`${key}\` })`.
 */
function check(arg) {
  if (arg == null) return;
  // A still-typed secret, recognised by brand rather than by stringifying it — stringifying is
  // the thing being prevented.
  if (typeof arg === 'object' && arg[Symbol.for('ranbval.protectedValue')]) {
    throw new PermissionError(ERR);
  }
  if (typeof arg === 'string') {
    if (containsSecret(arg)) throw new PermissionError(LEAK_ERR);
    return;
  }
  if (typeof arg === 'object' || typeof arg === 'function') {
    let text;
    try {
      text = JSON.stringify(arg);
    } catch {
      return; // circular or unserialisable — nothing we can scan
    }
    if (containsSecret(text)) throw new PermissionError(LEAK_ERR);
    return;
  }
  // Numbers, booleans, symbols: cannot hold a credential.
}

/** Thrown for both a directly-passed secret and an ordinary string containing one. */
class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
    this.code = 'EPERM';
  }
}

function patch(target, key, wrap) {
  const original = target[key];
  if (typeof original !== 'function') return;
  _patched.push({ target, key, original });
  target[key] = wrap(original);
}

/**
 * Patch the console methods and the stream writes so a secret cannot reach a terminal or a log.
 *
 * Safe to call twice. `loadRanbval()` calls this for you unless you pass `guardStdout: false`,
 * and `SecretString.use()` calls it before producing any plaintext.
 */
function installOutputGuards() {
  if (_installed) return;

  // Every console method, not just `log`. `console.error` is where a debug line usually ends up
  // once someone decides it is important, and it is what an uncaught handler reaches for.
  for (const name of ['log', 'error', 'warn', 'info', 'debug', 'trace', 'dir']) {
    patch(console, name, (orig) => function guarded(...args) {
      for (const a of args) check(a);
      return orig.apply(this, args);
    });
  }

  for (const stream of [process.stdout, process.stderr]) {
    patch(stream, 'write', (orig) => function guardedWrite(chunk, ...rest) {
      check(typeof chunk === 'string' ? chunk : chunk && chunk.toString && chunk.toString());
      return orig.call(this, chunk, ...rest);
    });
  }

  _installed = true;
}

/**
 * Install unless the guard is already on, or the caller explicitly declined it. Called from
 * `SecretString.use()` so the guard is up before the first plaintext exists.
 */
function ensureInstalled() {
  if (_installed || _optedOut) return;
  installOutputGuards();
}

/** Record that the caller has explicitly declined the guard (or withdrawn that). */
function setOptedOut(value) {
  _optedOut = Boolean(value);
}

/** Restore everything patched and drop every retained plaintext. */
function uninstallOutputGuards() {
  if (!_installed) return;
  setOptedOut(true); // an explicit removal must not be undone by the next decrypt
  for (const { target, key, original } of _patched) {
    target[key] = original;
  }
  _patched = [];
  _revealed.clear();
  _installed = false;
}

module.exports = {
  PermissionError,
  installOutputGuards,
  uninstallOutputGuards,
  ensureInstalled,
  setOptedOut,
  registerRevealed,
  containsSecret,
  // Test seams — not part of the public API.
  _state: () => ({ installed: _installed, optedOut: _optedOut, tracked: _revealed.size }),
};
