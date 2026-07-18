/**
 * Prefix classification — the one rule that tells the SDK what a variable is.
 *
 * Mirrors the Python SDK's ranbval_sdk.config.manifest so both behave identically:
 *   PUBLIC_  plaintext config, safe to read
 *   SECRET_  sealed token, decrypted only in-process
 *   PROXY_   sealed token, never decrypted locally (only /execute can use it)
 */

'use strict';

const PUBLIC_PREFIX = 'PUBLIC_';
const SECRET_PREFIX = 'SECRET_';
const PROXY_PREFIX = 'PROXY_';

/** @returns {'public'|'secret'|'proxy'|null} the class of `name`, or null if unclassified. */
function kindOf(name) {
  const upper = String(name || '').toUpperCase();
  if (upper.startsWith(PUBLIC_PREFIX)) return 'public';
  if (upper.startsWith(SECRET_PREFIX)) return 'secret';
  if (upper.startsWith(PROXY_PREFIX)) return 'proxy';
  return null;
}

/** True when `name` starts with `PUBLIC_` — plaintext config, safe to read. */
function isPublic(name) {
  return kindOf(name) === 'public';
}

/** True when `name` starts with `SECRET_` — decrypted in-process when you ask. */
function isSecret(name) {
  return kindOf(name) === 'secret';
}

/** True when `name` starts with `PROXY_` — never decrypted locally; only /execute can use it. */
function isProxy(name) {
  return kindOf(name) === 'proxy';
}

/** Infrastructure keys that need no class prefix: `RANBVAL_*` and `*_PROJECT_SECRET`. */
function isExempt(name) {
  const upper = String(name || '').toUpperCase();
  return upper.startsWith('RANBVAL_') || upper.endsWith('_PROJECT_SECRET');
}

module.exports = {
  PUBLIC_PREFIX,
  SECRET_PREFIX,
  PROXY_PREFIX,
  kindOf,
  isPublic,
  isSecret,
  isProxy,
  isExempt,
};
