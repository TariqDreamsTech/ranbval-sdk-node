/**
 * Resolve the control-plane host, and refuse to let the environment redirect it.
 *
 * Every server-side control in this product — the repo allowlist above all — is only as
 * trustworthy as the server being asked. Reading the host from `RANBVAL_HOST` without constraint
 * meant anyone who could set an environment variable could point the SDK at a server of their
 * own, have it answer `{"enforce_allowlist": false}`, and walk past the allowlist. Demonstrated,
 * not theorised: a nine-line local HTTP server was enough.
 *
 * The rule:
 *
 *   - **No configuration → the official host.** The common case needs nothing.
 *   - **A host passed in code** (`loadRanbval(null, { host })`, `proxyRequest({ host })`) →
 *     honoured. Code is the same trust boundary as the SDK itself.
 *   - **`RANBVAL_HOST` pointing elsewhere → refused**, unless the *code* has said that is allowed
 *     via `allowHostOverride()`. A self-hosted deployment writes that line once; an attacker
 *     holding only the environment cannot.
 */

'use strict';

const { DEFAULT_RANBVAL_HOST } = require('./defaults');
const { RanbvalConfigError } = require('../exceptions');

/** Set only from code, never from the environment — that asymmetry is the whole point. */
let _overrideAllowed = false;

/**
 * Permit `RANBVAL_HOST` to name a host other than the official one, for a self-hosted control
 * plane. Call it in your application code, before the first decrypt.
 *
 * Deliberately not an environment variable or a `.ranbval` key: both are settable by anyone who
 * can influence the process, and this is the switch that decides which server gets to say whether
 * a decrypt is allowed.
 */
function allowHostOverride(allowed = true) {
  _overrideAllowed = Boolean(allowed);
}

/** True when the code has opted in to a non-default `RANBVAL_HOST`. */
function isHostOverrideAllowed() {
  return _overrideAllowed;
}

const norm = (h) => String(h).trim().replace(/\/+$/, '').toLowerCase();

/**
 * Return the control-plane host to use, refusing an unapproved environment redirect.
 *
 * @param {string} [explicit] a host passed in code — always honoured
 * @returns {string}
 */
function resolveHost(explicit) {
  if (explicit && String(explicit).trim()) {
    return String(explicit).trim().replace(/\/+$/, '');
  }

  const env = String(process.env.RANBVAL_HOST || '').trim();
  if (!env) return DEFAULT_RANBVAL_HOST;

  if (norm(env) === norm(DEFAULT_RANBVAL_HOST) || _overrideAllowed) {
    return env.replace(/\/+$/, '');
  }

  throw new RanbvalConfigError(
    `RANBVAL_HOST is set to '${env}', which is not the Ranbval control plane ` +
    `(${DEFAULT_RANBVAL_HOST}). Refusing to use it.\n` +
    'The host decides whether a decrypt is permitted — the repo allowlist is answered by ' +
    'whichever server is asked — so an environment variable must not be able to redirect it. ' +
    'If you genuinely run your own control plane, say so in code, once:\n' +
    "    const { allowHostOverride } = require('ranbval-sdk');\n" +
    '    allowHostOverride();\n' +
    'Code is a boundary an attacker holding only the environment cannot cross.',
    { code: 'host_not_allowed' },
  );
}

module.exports = { resolveHost, allowHostOverride, isHostOverrideAllowed };
