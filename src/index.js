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

const { safeDecrypt, decryptKey, deriveKey } = require('./crypto');
const { proxyRequest, PlanLimitError, ProxyError } = require('./proxy');
const {
  loadRanbval,
  getProjectKey,
  findRanbvalDirectory,
  findRanbvalFile,
  resolveRanbvalMode,
} = require('./dotRanbval');
const { emitTelemetry, saltFromRanbvalToken } = require('./telemetry');
const { SecretString } = require('./secretString');
const { secureClient } = require('./integrations/factory');
const { buildSecureClient } = require('./integrations/universal');
const { fetchEnvSet, planStatus, pushEnv } = require('./remote');
const { isPublic, isSecret, isProxy, kindOf, isExempt } = require('./manifest');
const {
  assertRepoAllowedForDecrypt,
  assertRepoAllowedForDecryptAsync,
  fetchRepoPolicy,
  normalizeGitRemoteUrl,
  getGitRemoteOrigin,
} = require('./repoPolicy');

module.exports = {
  // Core crypto
  safeDecrypt,
  decryptKey,
  deriveKey,
  SecretString,
  // Config loader
  loadRanbval,
  getProjectKey,
  findRanbvalDirectory,
  findRanbvalFile,
  resolveRanbvalMode,
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
  PlanLimitError,
  ProxyError,
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
