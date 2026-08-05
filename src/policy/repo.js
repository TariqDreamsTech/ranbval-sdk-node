/**
 * Enforce project allowlisted git remotes before decrypting Ranbval keys.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const { URL } = require('node:url');

const { assertSafeUrl } = require('../_internal/transport');

/**
 * Normalize a git remote URL to `https://host/owner/repo` (lowercase, no .git).
 * Handles:
 *   git@github.com:owner/repo.git   →  https://github.com/owner/repo
 *   https://github.com/owner/repo/  →  https://github.com/owner/repo
 *
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function normalizeGitRemoteUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.trim().replace(/\/+$/, '');
  if (!u) return null;
  if (u.toLowerCase().endsWith('.git')) {
    u = u.slice(0, -4);
  }
  const lower = u.toLowerCase();
  if (lower.startsWith('git@')) {
    const at = u.indexOf('@');
    const colon = u.indexOf(':', at);
    if (colon === -1) return lower;
    const host = u.slice(at + 1, colon).trim().toLowerCase();
    const path = u.slice(colon + 1).trim().replace(/^\/+|\/+$/g, '').toLowerCase();
    return `https://${host}/${path}`;
  }
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return lower;
  }
  if (!parsed.host) return lower;
  let path = (parsed.pathname || '').replace(/^\/+|\/+$/g, '').toLowerCase();
  if (path.endsWith('.git')) path = path.slice(0, -4);
  const scheme = (parsed.protocol || 'https:').replace(':', '').toLowerCase();
  return `${scheme}://${parsed.host.toLowerCase()}/${path}`;
}

/** @returns {string|null} */
function getGitRemoteOrigin() {
  try {
    const out = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function _originAllowed(origin, allowed) {
  const g = normalizeGitRemoteUrl(origin);
  if (!g) return false;
  const norms = new Set();
  for (const x of allowed || []) {
    const n = normalizeGitRemoteUrl(x);
    if (n) norms.add(n);
  }
  return norms.has(g);
}

/**
 * @param {string} ranbvalHost
 * @param {string} clientSalt
 * @returns {Promise<{enforce_allowlist?: boolean, allowed_repos?: string[]}>}
 */
async function fetchRepoPolicy(ranbvalHost, clientSalt) {
  const base = String(ranbvalHost).replace(/\/+$/, '');
  const url = assertSafeUrl(`${base}/api/public/repo-policy?client_salt=${encodeURIComponent(clientSalt)}`);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = new Error(`repo-policy HTTP ${res.status}`);
    err.code = res.status;
    throw err;
  }
  return res.json();
}

/** Cache the policy briefly, as Python does, so repeated decrypts don't each pay a round-trip. */
const _POLICY_TTL_MS = 60_000;
const _policyCache = new Map();

/**
 * Blocking policy fetch, so the synchronous `safeDecrypt` can enforce the allowlist the way
 * Python's does.
 *
 * Node has no synchronous HTTP, which is why this check used to be skipped here — the previous
 * implementation returned early whenever it could not reach the network, and honoured a
 * `RANBVAL_SKIP_REPO_CHECK` escape hatch besides. The result was that `safeDecrypt()` performed
 * no allowlist check at all: verified by decrypting outside any git repository, with no flag set,
 * and getting the plaintext. A control the client can decline is not a control, and this is the
 * one mechanism in the product that is supposed to be unbypassable.
 *
 * A short-lived child process gives us the blocking call. It costs a process spawn per policy
 * miss, paid once per TTL rather than per decrypt.
 *
 * @param {string} ranbvalHost
 * @param {string} clientSalt
 * @returns {{enforce_allowlist?: boolean, allowed_repos?: string[]}}
 */
function fetchRepoPolicySync(ranbvalHost, clientSalt) {
  const key = `${String(ranbvalHost).replace(/\/+$/, '')}|${clientSalt}`;
  const hit = _policyCache.get(key);
  if (hit && Date.now() - hit.at < _POLICY_TTL_MS) return hit.policy;

  const base = String(ranbvalHost).replace(/\/+$/, '');
  const url = assertSafeUrl(`${base}/api/public/repo-policy?client_salt=${encodeURIComponent(clientSalt)}`);
  const script =
    'fetch(process.argv[1],{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)})' +
    '.then(r=>r.ok?r.text().then(t=>process.stdout.write(t)):' +
    'Promise.reject(Object.assign(new Error("HTTP "+r.status),{status:r.status})))' +
    '.catch(e=>{process.stderr.write(String(e&&e.status||e&&e.message||e));process.exit(3);});';

  let out;
  try {
    out = execFileSync(process.execPath, ['-e', script, url], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const detail = (e && e.stderr ? String(e.stderr) : '').trim();
    if (detail === '404') {
      const err = new Error(
        'Ranbval: unknown session for this key (repo policy could not be loaded). ' +
        'Check RANBVAL_HOST and that this token belongs to a valid project session.',
      );
      err.code = 'EPERM';
      throw err;
    }
    // Fail closed. An unreachable control plane must not mean "allowed" — that would make
    // pulling the network cable a bypass.
    const err = new Error(
      `Ranbval: could not verify the repository allowlist (${detail || 'network error'}). ` +
      'Decryption is refused rather than allowed, because an unreachable policy server must ' +
      'not act as a bypass.',
    );
    err.code = 'EPERM';
    throw err;
  }

  let policy;
  try {
    policy = JSON.parse(out);
  } catch {
    const err = new Error('Ranbval: repo policy response was not valid JSON.');
    err.code = 'EPERM';
    throw err;
  }
  _policyCache.set(key, { at: Date.now(), policy });
  return policy;
}

/** Shared decision, so the sync and async paths cannot drift apart. */
function _enforcePolicy(policy) {
  if (!policy || !policy.enforce_allowlist) return;

  const allowed = policy.allowed_repos || [];
  const origin = getGitRemoteOrigin();
  if (!origin) {
    const err = new Error(
      'Ranbval: this key may only be used from an allowlisted Git repository, ' +
      'but no `git remote origin` was found. Work inside a clone of an allowed repo ' +
      '(run `git remote -v` to confirm).',
    );
    err.code = 'EPERM';
    throw err;
  }
  if (!_originAllowed(origin, allowed)) {
    const err = new Error(
      'Ranbval: you are not allowed to use this key from this repository. ' +
      `Current origin is '${origin}'. Add this URL (or its GitHub https/ssh equivalent) ` +
      'to Allowed repositories in the Ranbval dashboard for this project.',
    );
    err.code = 'EPERM';
    throw err;
  }
}

/**
 * Enforce the project's repo allowlist before decryption — the same contract as Python's
 * `assert_repo_allowed_for_decrypt`. There is no client-side skip.
 *
 * @param {string} ranbvalHost
 * @param {string} clientSalt
 */
function assertRepoAllowedForDecrypt(ranbvalHost, clientSalt) {
  _enforcePolicy(fetchRepoPolicySync(ranbvalHost, clientSalt));
}

async function assertRepoAllowedForDecryptAsync(ranbvalHost, clientSalt) {
  let policy;
  try {
    policy = await fetchRepoPolicy(ranbvalHost, clientSalt);
  } catch (e) {
    if (e && e.code === 404) {
      const err = new Error(
        'Ranbval: unknown session for this key (repo policy could not be loaded). ' +
        'Check RANBVAL_HOST and that this token belongs to a valid project session.',
      );
      err.code = 'EPERM';
      throw err;
    }
    const err = new Error(
      `Ranbval: could not load repo policy: ${e && e.message ? e.message : e}.`,
    );
    err.code = 'EPERM';
    throw err;
  }
  _enforcePolicy(policy);
}

module.exports = {
  fetchRepoPolicySync,
  normalizeGitRemoteUrl,
  getGitRemoteOrigin,
  fetchRepoPolicy,
  assertRepoAllowedForDecrypt,
  assertRepoAllowedForDecryptAsync,
};
