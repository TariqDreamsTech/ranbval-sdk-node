/**
 * Audit log for SecretString access.
 *
 * Every `.use()` is recorded with its label, a timestamp and the caller's location. The secret
 * value itself is never recorded — the point is to answer "what read this key, and from where",
 * which needs the call site, not the plaintext.
 *
 *     const { getAuditLog, clearAuditLog } = require('ranbval-sdk');
 *
 *     getAuditLog();
 *     // [{ label: 'OPENAI_KEY', timestamp: 1716000000000, caller: 'app.js:42' }]
 *
 * Mirrors ranbval_sdk.crypto.audit. Node is single-threaded, so where the Python side takes a lock
 * this simply appends — the operation is already atomic with respect to other JavaScript.
 */

'use strict';

const path = require('path');

/** @type {{label: string, timestamp: number, caller: string}[]} */
let _log = [];

//: Frames inside the SDK to step over when looking for the real caller.
const _SDK_DIR = path.resolve(__dirname, '..');

let _notifier = null;

/** Register — or clear with `null` — a callback `fn(label)` fired on each access. */
function setAccessNotifier(fn) {
  _notifier = typeof fn === 'function' ? fn : null;
}

/**
 * The first stack frame outside the SDK.
 *
 * Reporting an internal frame would name our own file on every entry, which tells the reader
 * nothing about which line of *their* program touched the secret.
 */
function _callerLocation() {
  const stack = new Error().stack || '';
  for (const line of stack.split('\n').slice(2)) {
    // The path may contain spaces — "…/all projects/…" is ordinary on macOS — so this must not
    // exclude whitespace when capturing it. Anchoring on the trailing `:line:col` is what makes
    // the greedy match safe.
    const m = line.match(/\(?(.+):(\d+):\d+\)?$/);
    if (!m) continue;
    const file = m[1].replace(/^.*?\(/, '');
    if (file.startsWith('node:') || file.startsWith(_SDK_DIR)) continue;
    return `${path.basename(file)}:${m[2]}`;
  }
  return 'unknown';
}

/** Record one access. Never throws — auditing must not break the program it observes. */
function recordAccess(label) {
  try {
    _log.push({
      label: String(label || 'secret'),
      timestamp: Date.now(),
      caller: _callerLocation(),
    });
    if (_notifier) _notifier(label);
  } catch {
    // Deliberately swallowed: see above.
  }
}

/** A copy of the log, so a caller iterating it cannot be surprised by a concurrent append. */
function getAuditLog() {
  return _log.map((e) => ({ ...e }));
}

/** Drop every recorded entry. */
function clearAuditLog() {
  _log = [];
}

/**
 * Run `fn` and return only the entries it produced, leaving the surrounding log untouched.
 *
 * Useful in tests and in request handlers: "which secrets did *this* piece of work read?"
 *
 * @param {() => any} fn
 * @returns {{result: any, entries: {label: string, timestamp: number, caller: string}[]}}
 */
function auditScope(fn) {
  const before = _log.length;
  const result = fn();
  return { result, entries: _log.slice(before).map((e) => ({ ...e })) };
}

module.exports = {
  setAccessNotifier,
  recordAccess,
  getAuditLog,
  clearAuditLog,
  auditScope,
};
