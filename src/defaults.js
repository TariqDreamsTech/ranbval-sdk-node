/**
 * Shared defaults for optional configuration.
 *
 * Override with environment variables when needed (e.g. self-hosted or local dev).
 */

'use strict';

// Password-manager origin only — no `/api` suffix (SDK appends `/api/...` paths).
const DEFAULT_RANBVAL_HOST = 'https://api.secret.ranbval.com';

/** If `RANBVAL_TELEMETRY_DEBUG=1`, print why POST /api/telemetry failed (default is silent). */
function warnTelemetrySendFailed(host, exc) {
  const v = (process.env.RANBVAL_TELEMETRY_DEBUG || '').trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on'].includes(v)) return;
  const url = `${String(host || '').replace(/\/+$/, '')}/api/telemetry`;
  process.stderr.write(`[Ranbval] Telemetry POST failed (${url}): ${exc && exc.message ? exc.message : exc}\n`);
}

module.exports = {
  DEFAULT_RANBVAL_HOST,
  warnTelemetrySendFailed,
};
