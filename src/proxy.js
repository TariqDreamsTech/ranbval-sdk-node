/**
 * Ranbval Secure Proxy — route any HTTP request through /api/execute.
 *
 * The real API key is NEVER on the caller's machine. Ranbval decrypts it
 * server-side, injects it into the outbound request, and returns the response.
 *
 * Works from anywhere: Node scripts, Express, Fastify, Next.js routes, n8n, CI.
 *
 * @example
 *   const { loadRanbval, proxyRequest } = require('ranbval-sdk');
 *   loadRanbval();
 *
 *   const resp = await proxyRequest({
 *     token: 'ranbval.xxxx.….ahsan',
 *     targetUrl: 'https://api.openai.com/v1/chat/completions',
 *     method: 'POST',
 *     injectAs: 'bearer',
 *     body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] },
 *   });
 *   console.log(resp.body);
 *
 * Inject modes:
 *   "bearer"          → Authorization: Bearer <secret>
 *   "basic"           → Authorization: Basic <secret>
 *   "header:X-Name"   → X-Name: <secret>
 *   "query:api_key"   → ?api_key=<secret> appended to targetUrl
 */

'use strict';

const { DEFAULT_RANBVAL_HOST } = require('./defaults');
const { _findProjectSecretFor } = require('./crypto');

const { PlanLimitError } = require('./planError');

class ProxyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProxyError';
  }
}

/**
 * Send an HTTP request through the Ranbval secure proxy.
 *
 * @param {object} opts
 * @param {string} opts.token              Vault token from the session card.
 * @param {string} opts.targetUrl          The real API endpoint to call.
 * @param {string} [opts.method='POST']    HTTP verb.
 * @param {object} [opts.headers]          Extra forwarded headers (do NOT include auth).
 * @param {*}      [opts.body]             Request body. Object → JSON, string → text, null → none.
 * @param {string} [opts.injectAs='bearer'] How to inject the decrypted secret.
 * @param {string} [opts.apiKey]           Ranbval SDK API key. Defaults to RANBVAL_API_KEY.
 * @param {string} [opts.projectSecret]    Project secret. Defaults to RANBVAL_PROJECT_SECRET.
 * @param {string} [opts.tokenEnvVar]      Name of env var holding `token`, used to auto-discover
 *                                          project secret when `projectSecret` is omitted.
 * @param {string} [opts.hostUrl]          Override Ranbval server. Defaults to RANBVAL_HOST.
 * @param {string} [opts.modelUsed='http.proxy']
 * @param {number} [opts.promptTokens=0]
 * @param {number} [opts.completionTokens=0]
 * @returns {Promise<{status:number, ok:boolean, body:*, headers:object, session_name?:string, project?:string}>}
 */
async function proxyRequest({
  token,
  targetUrl,
  method = 'POST',
  headers = null,
  body = null,
  injectAs = 'bearer',
  apiKey = null,
  projectSecret = null,
  tokenEnvVar = null,
  hostUrl = null,
  modelUsed = 'http.proxy',
  promptTokens = 0,
  completionTokens = 0,
}) {
  const host = String(hostUrl || process.env.RANBVAL_HOST || DEFAULT_RANBVAL_HOST).replace(/\/+$/, '');

  // ── Resolve api_key ──────────────────────────────────────────────────────
  const resolvedApiKey = String(apiKey || process.env.RANBVAL_API_KEY || '').trim();
  if (!resolvedApiKey) {
    throw new ProxyError(
      'No Ranbval API key found. Set RANBVAL_API_KEY in your .ranbval file ' +
      'or pass apiKey to proxyRequest().',
    );
  }

  // ── Resolve project_secret ───────────────────────────────────────────────
  let resolvedSecret = String(projectSecret || '').trim();
  if (!resolvedSecret && tokenEnvVar) {
    try {
      resolvedSecret = _findProjectSecretFor(tokenEnvVar);
    } catch {
      resolvedSecret = '';
    }
  }
  if (!resolvedSecret) {
    resolvedSecret = String(process.env.RANBVAL_PROJECT_SECRET || '').trim();
  }
  if (!resolvedSecret) {
    throw new ProxyError(
      'No project secret found. Set RANBVAL_PROJECT_SECRET in your .ranbval file ' +
      'or pass projectSecret to proxyRequest().',
    );
  }

  const payload = {
    project_secret: resolvedSecret,
    token,
    target_url: targetUrl,
    method: String(method).toUpperCase(),
    headers: headers || {},
    body,
    inject_as: injectAs,
    model_used: modelUsed,
    prompt_tokens: promptTokens | 0,
    completion_tokens: completionTokens | 0,
  };

  let resp;
  try {
    resp = await fetch(`${host}/api/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ranbval-API-Key': resolvedApiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new ProxyError(`Could not reach Ranbval proxy at '${host}': ${e && e.message ? e.message : e}`);
  }

  const text = await resp.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!resp.ok) {
    const raw = parsed && parsed.detail ? parsed.detail : (parsed && parsed.raw) || text;

    // 429/402 mean the plan's allowance is spent — a different situation from a broken proxy, and
    // one a caller may want to handle (back off, upgrade, switch key) rather than retry into a
    // wall. The server sends a structured detail; surface it as fields, not a stringified object.
    if ((resp.status === 429 || resp.status === 402) && raw && typeof raw === 'object') {
      throw new PlanLimitError(String(raw.message || raw.error || 'Plan limit reached.'), {
        used: raw.used,
        limit: raw.limit,
        period: raw.period,
        plan: raw.plan,
        kind: resp.status === 429 ? 'requests' : 'quota',
        code: String(raw.error || 'plan_limit_reached'),
      });
    }

    let detail = raw;
    if (typeof detail !== 'string') {
      try { detail = JSON.stringify(detail); } catch { detail = String(detail); }
    }
    throw new ProxyError(`Ranbval proxy returned HTTP ${resp.status}: ${detail}`);
  }
  return parsed;
}

module.exports = {
  PlanLimitError, proxyRequest, ProxyError };
