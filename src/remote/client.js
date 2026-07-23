/**
 * Fetch a project's env-set from the Ranbval control plane over HTTPS.
 *
 * Faithful port of the Python SDK's ranbval_sdk.remote.client. Owner auth is the project secret
 * (`ranbval-proj-…`) — the same secret that decrypts the tokens; a developer authenticates with a
 * `ranbval-dev-…` token. The response carries env vars exactly as they'd sit in a `.ranbval` file:
 * SECRET_/PROXY_ values are still encrypted `ranbval.*` tokens, PUBLIC_ values are plaintext.
 * Nothing here decrypts anything.
 */

'use strict';

const { DEFAULT_RANBVAL_HOST } = require('../_internal/defaults');

class RanbvalConfigError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RanbvalConfigError';
    this.code = code;
  }
}

function _host(host) {
  return String(host || process.env.RANBVAL_HOST || DEFAULT_RANBVAL_HOST).replace(/\/+$/, '');
}

/** Owner uses projectSecret; developer uses apiKey. Exactly one is required. */
function _credential(projectSecret, apiKey) {
  if (projectSecret && String(projectSecret).trim()) {
    return { project_secret: String(projectSecret).trim() };
  }
  if (apiKey && String(apiKey).trim()) {
    return { api_key: String(apiKey).trim() };
  }
  throw new RanbvalConfigError(
    'remote needs a projectSecret (owner) or apiKey (developer).',
    'remote_no_secret',
  );
}

// The same variables that select a local .ranbval.{mode} file also select the remote stage.
const _ENV_VARS = ['RANBVAL_ENV', 'ENVIRONMENT', 'ENV'];

/**
 * The stage to pull: explicit arg → RANBVAL_ENV → ENVIRONMENT → ENV.
 * Unlike local mode there is NO "development" default: null means "let the server use the
 * project's first environment", so a project that never named its stages still works.
 */
function _environment(environment) {
  if (environment && String(environment).trim()) {
    return String(environment).trim().toLowerCase();
  }
  for (const key of _ENV_VARS) {
    const v = process.env[key];
    if (v && String(v).trim()) return String(v).trim().toLowerCase();
  }
  return null;
}

async function _post(url, payload, timeout) {
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Math.round((timeout || 10) * 1000)),
    });
  } catch (e) {
    throw new RanbvalConfigError(
      `Could not reach the Ranbval control plane at ${url}: ${e && e.message ? e.message : e}`,
      'remote_unreachable',
    );
  }
  const text = await resp.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!resp.ok) {
    const detail = resp.status === 403 ? 'Invalid credential.' : `HTTP ${resp.status}`;
    throw new RanbvalConfigError(`${url}: ${detail}`, 'remote_fetch_failed');
  }
  return body;
}

/**
 * Return `{ name: value }` for every env var in ONE environment of the project.
 *
 * `environment` selects the stage ("development", "staging", "production", …) and defaults to
 * RANBVAL_ENV, then the project's first environment — so a developer machine never receives
 * production credentials. Owner authenticates with `projectSecret`, a developer with `apiKey`.
 *
 * @param {{projectSecret?: string, apiKey?: string, environment?: string, host?: string,
 *          timeout?: number}} [opts]
 * @returns {Promise<Record<string,string>>}
 */
async function fetchEnvSet(opts = {}) {
  const { projectSecret, apiKey, environment, host, timeout = 10 } = opts || {};
  const payload = _credential(projectSecret, apiKey);
  const env = _environment(environment);
  if (env) payload.environment = env;
  const body = await _post(`${_host(host)}/api/envs/pull`, payload, timeout);
  const out = {};
  for (const e of body.envs || []) {
    if (e && e.name) out[e.name] = e.value;
  }
  return out;
}

/**
 * Add a PUBLIC_ env to one environment, attributed to the caller (owner or developer).
 *
 * Only PUBLIC_ names are accepted — SECRET_/PROXY_ keys are created in the dashboard (encrypted
 * server-side). `environment` defaults to RANBVAL_ENV, then the project's first stage.
 *
 * @param {string} name
 * @param {string} value
 * @param {{projectSecret?: string, apiKey?: string, environment?: string, host?: string,
 *          timeout?: number}} [opts]
 * @returns {Promise<{name: string, kind: string, added_by: string}>}
 */
async function pushEnv(name, value, opts = {}) {
  const { projectSecret, apiKey, environment, host, timeout = 10 } = opts || {};
  const payload = { name, value, ..._credential(projectSecret, apiKey) };
  const env = _environment(environment);
  if (env) payload.environment = env;
  return _post(`${_host(host)}/api/envs/add`, payload, timeout);
}

/**
 * What plan this project is on, what it allows, and how much is used this month.
 *
 *   {plan: 'free', plan_name: 'Free', has_active_subscription: false,
 *    limits: {projects: 1, secrets: 5, requests_month: 1000},
 *    usage:  {projects: 1, secrets: 3, requests_month: 412,
 *             requests_remaining: 588, period: '2026-07'}}
 *
 * A `null` limit means unlimited on this plan.
 *
 * This is for visibility — showing usage in your own tooling, or warning before a batch job runs
 * into a cap. It is not a permission check: every limit is enforced by the server on the call
 * itself, so there is nothing to gain by consulting this first, and nothing lost by skipping it.
 *
 * @param {{projectSecret?: string, apiKey?: string, host?: string, timeout?: number}} [opts]
 * @returns {Promise<object>}
 */
async function planStatus(opts = {}) {
  const { projectSecret, apiKey, host, timeout = 10 } = opts || {};
  const payload = _credential(projectSecret, apiKey);
  return _post(`${_host(host)}/api/envs/plan-status`, payload, timeout);
}

module.exports = { fetchEnvSet, planStatus, pushEnv, RanbvalConfigError };
