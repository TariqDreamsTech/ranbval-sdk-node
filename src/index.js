/**
 * Ranbval SDK (Node.js) — keep API secrets out of plaintext config.
 *
 *   loadRanbval()        load layered .ranbval* files into process.env
 *   safeDecrypt()        decrypt a vault token locally (with repo allowlist)
 *   decryptKey()         decrypt by env var name — auto-discovers project secret from prefix
 *   proxyRequest()       route any HTTP request through Ranbval secure proxy (secret never local)
 *   emitTelemetry()      log a request to the Ranbval Live Monitor
 *   secureClient()       wrap any vendor SDK so it auto-decrypts on construction
 *   SecretString         no-print wrapper around a decrypted secret
 */

'use strict';

const { safeDecrypt, decryptKey, deriveKey } = require('./crypto/cipher');
const { proxyRequest } = require('./integrations/proxy');
const {
  loadRanbval,
  getProjectKey,
  findRanbvalDirectory,
  findRanbvalFile,
  resolveRanbvalMode,
} = require('./config/loader');
const { emitTelemetry, saltFromRanbvalToken } = require('./telemetry/client');
const { SecretString } = require('./crypto/secretString');
const { setEnforcement, isEnforced } = require('./crypto/enforcement');
const { getAuditLog, clearAuditLog, auditScope } = require('./crypto/audit');
const { Secret, defineConfig } = require('./config/declarative');
const { secureClient } = require('./integrations/factory');
const { buildSecureClient } = require('./integrations/universal');
const { fetchEnvSet, planStatus, pushEnv } = require('./remote/client');
const { isPublic, isSecret, isProxy, kindOf, isExempt } = require('./config/manifest');
const {
  assertRepoAllowedForDecrypt,
  assertRepoAllowedForDecryptAsync,
  fetchRepoPolicy,
  normalizeGitRemoteUrl,
  getGitRemoteOrigin,
} = require('./policy/repo');
const errors = require('./exceptions');

module.exports = {
  // Core crypto
  safeDecrypt,
  decryptKey,
  deriveKey,
  SecretString,
  // Extraction enforcement (strict by default)
  setEnforcement,
  isEnforced,
  // Access audit log
  getAuditLog,
  clearAuditLog,
  auditScope,
  // Config loader
  loadRanbval,
  getProjectKey,
  findRanbvalDirectory,
  findRanbvalFile,
  resolveRanbvalMode,
  // Declarative config
  Secret,
  defineConfig,
  // Remote config (control plane) — owner via projectSecret, developer via apiKey
  fetchEnvSet,
  planStatus,
  pushEnv,
  // Prefix classification
  isPublic,
  isSecret,
  isProxy,
  kindOf,
  isExempt,
  // Secure proxy
  proxyRequest,
  // Every error type, all extending RanbvalError (see ./exceptions). PlanLimitError and ProxyError
  // stay named here because callers have always imported them by name.
  ...errors,
  // Telemetry
  emitTelemetry,
  saltFromRanbvalToken,
  // SDK integrations
  secureClient,
  buildSecureClient,
  // Repo policy (advanced)
  assertRepoAllowedForDecrypt,
  assertRepoAllowedForDecryptAsync,
  fetchRepoPolicy,
  normalizeGitRemoteUrl,
  getGitRemoteOrigin,
};
