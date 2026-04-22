/**
 * POST /api/telemetry — use with any HTTP stack after `loadRanbval()`.
 */

'use strict';

const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { URL } = require('node:url');

const { DEFAULT_RANBVAL_HOST, warnTelemetrySendFailed } = require('./defaults');

function _getGitRemote() {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim() || null;
  } catch {
    return null;
  }
}

function _getGitBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim() || null;
  } catch {
    return null;
  }
}

function _sdkVersion() {
  try {
    return require('../package.json').version || '';
  } catch {
    return '';
  }
}

/**
 * Return the client salt segment from `ranbval.<salt>.<cipher>.<label>` or null.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function saltFromRanbvalToken(raw) {
  if (!raw || typeof raw !== 'string' || !raw.startsWith('ranbval.')) return null;
  const parts = raw.split('.');
  if (parts.length < 2) return null;
  return parts[1];
}

/**
 * Notify the password-manager of an outbound use (any vendor or custom API).
 *
 * Resolve `clientSalt` explicitly, or pass `vaultTokenEnv` (e.g. "OPENAI_API_KEY")
 * when that env var holds a `ranbval.*` token — salt is taken from the token. If no
 * salt can be resolved, this is a no-op (silent).
 *
 * @param {object} opts
 * @param {string} [opts.clientSalt]
 * @param {string} [opts.vaultTokenEnv]
 * @param {string} [opts.modelUsed='custom.request']
 * @param {number} [opts.promptTokens=0]
 * @param {number} [opts.completionTokens=0]
 * @param {string} [opts.hostUrl]
 * @param {string} [opts.eventKind='custom.request']
 * @param {boolean}[opts.background=false]   Fire-and-forget without awaiting.
 * @returns {Promise<void>|void}
 */
function emitTelemetry({
  clientSalt = null,
  vaultTokenEnv = null,
  modelUsed = 'custom.request',
  promptTokens = 0,
  completionTokens = 0,
  hostUrl = null,
  eventKind = 'custom.request',
  background = false,
} = {}) {
  const post = async () => {
    const off = (process.env.RANBVAL_TELEMETRY || '').trim().toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(off)) return;

    let salt = clientSalt;
    if (!salt && vaultTokenEnv) {
      const raw = process.env[String(vaultTokenEnv).trim()] || '';
      salt = saltFromRanbvalToken(raw);
    }
    if (!salt) return;

    const h = String(hostUrl || process.env.RANBVAL_HOST || DEFAULT_RANBVAL_HOST).replace(/\/+$/, '');
    let transport = 'http';
    try { transport = (new URL(h).protocol || 'http:').replace(':', '').toLowerCase(); } catch {}

    const ciEnvironment = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'JENKINS_URL']
      .some((k) => process.env[k]);

    const sec = {
      event_kind: eventKind,
      sdk_version: _sdkVersion(),
      client_platform: process.platform,
      python_version: '',                    // intentionally blank — Node SDK
      node_version: process.version,
      transport,
      vault_token_format: 'ranbval',
      git_branch: _getGitBranch(),
      ci_environment: Boolean(ciEnvironment),
    };

    const payload = {
      client_salt: salt,
      machine_name: os.hostname(),
      repo_path: process.cwd(),
      git_url: _getGitRemote(),
      model_used: modelUsed,
      prompt_tokens: promptTokens | 0,
      completion_tokens: completionTokens | 0,
      security: sec,
    };

    try {
      const resp = await fetch(`${h}/api/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status === 200) {
        process.stdout.write(`\n[Ranbval] Telemetry synced: ${modelUsed}\n`);
      }
    } catch (e) {
      warnTelemetrySendFailed(h, e);
    }
  };

  if (background) {
    // Fire and forget; do not surface rejections.
    post().catch(() => {});
    return;
  }
  return post();
}

module.exports = { emitTelemetry, saltFromRanbvalToken };
