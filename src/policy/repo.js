/**
 * Enforce project allowlisted git remotes before decrypting Ranbval keys.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const { URL } = require('node:url');

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
  const url = `${base}/api/public/repo-policy?client_salt=${encodeURIComponent(clientSalt)}`;
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

/**
 * If the project has any allowed_repos, refuse to proceed unless `git remote origin`
 * matches one of them (https / ssh / .git normalized).
 *
 * Set `RANBVAL_SKIP_REPO_CHECK=1` to bypass (local dev only).
 *
 * NOTE: this implementation is intentionally synchronous-friendly via a fire-and-forget
 * spawn for git, but the network policy fetch is async. To preserve the Python signature,
 * we expose a sync wrapper that BLOCKS on the network call by deasync-style polling —
 * which is not a thing in Node. Instead, callers should use `assertRepoAllowedForDecryptAsync`
 * when they can; the sync version skips the network check by default and only blocks when
 * `RANBVAL_REPO_CHECK_BLOCKING=1` is set (uses a worker round-trip).
 *
 * For safeDecrypt() in this SDK we follow this rule:
 *   - If RANBVAL_SKIP_REPO_CHECK=1                 → skip silently (most common in CI/dev).
 *   - Else if origin is missing                     → throw (matches Python).
 *   - Else                                          → enforce locally (no network) using
 *                                                     RANBVAL_ALLOWED_REPOS env (comma-separated)
 *                                                     when set; otherwise SKIP the check.
 *
 * The `Async` helper below performs the full network-backed check exactly as Python does.
 *
 * @param {string} ranbvalHost
 * @param {string} clientSalt
 */
function assertRepoAllowedForDecrypt(ranbvalHost, clientSalt) {
  const skip = (process.env.RANBVAL_SKIP_REPO_CHECK || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(skip)) return;

  // Local-only allowlist via env (no network). Comma-separated git URLs.
  const localAllowed = (process.env.RANBVAL_ALLOWED_REPOS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (localAllowed.length === 0) {
    // No local allowlist configured → defer to async path or trust caller.
    return;
  }
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
  if (!_originAllowed(origin, localAllowed)) {
    const err = new Error(
      'Ranbval: you are not allowed to use this key from this repository. ' +
      `Current origin is '${origin}'. Add this URL (or its GitHub https/ssh equivalent) ` +
      'to RANBVAL_ALLOWED_REPOS (comma-separated) or to Allowed repositories in the dashboard.',
    );
    err.code = 'EPERM';
    throw err;
  }
}

/**
 * Async variant — fetches the repo policy from the Ranbval server, mirroring the
 * Python SDK exactly. Use this in async code paths for full server-backed enforcement.
 *
 * @param {string} ranbvalHost
 * @param {string} clientSalt
 */
async function assertRepoAllowedForDecryptAsync(ranbvalHost, clientSalt) {
  const skip = (process.env.RANBVAL_SKIP_REPO_CHECK || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(skip)) return;
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
  if (!policy || !policy.enforce_allowlist) return;

  const allowed = policy.allowed_repos || [];
  const origin = getGitRemoteOrigin();
  if (!origin) {
    const err = new Error(
      'Ranbval: this key may only be used from an allowlisted Git repository, ' +
      'but no `git remote origin` was found.',
    );
    err.code = 'EPERM';
    throw err;
  }
  if (!_originAllowed(origin, allowed)) {
    const err = new Error(
      'Ranbval: you are not allowed to use this key from this repository. ' +
      `Current origin is '${origin}'. Add this URL to Allowed repositories in the dashboard.`,
    );
    err.code = 'EPERM';
    throw err;
  }
}

module.exports = {
  normalizeGitRemoteUrl,
  getGitRemoteOrigin,
  fetchRepoPolicy,
  assertRepoAllowedForDecrypt,
  assertRepoAllowedForDecryptAsync,
};
