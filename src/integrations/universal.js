/**
 * Wrap any vendor SDK class so it auto-decrypts the API key on construction
 * and (optionally) emits telemetry after a chosen method runs.
 *
 * The Node port mirrors the Python `build_secure_client` semantics. The wrapped
 * SDK class is **your** dependency — Ranbval ships zero vendor deps.
 */

'use strict';

const { safeDecrypt } = require('../crypto');
const { DEFAULT_RANBVAL_HOST } = require('../defaults');
const { emitTelemetry } = require('../telemetry');

/**
 * Build a class that, when constructed, reads `envVarName`, decrypts it (if it
 * is a vault token), and forwards the plaintext as `keyKwarg` to `SDKClass`.
 *
 * @param {Function} SDKClass
 * @param {string} envVarName
 * @param {string} keyKwarg
 * @param {string|null} [methodPathToPatch]   Dot-path of an instance method to patch
 *                                             so each call emits a telemetry event.
 *                                             e.g. "chat.completions.create"
 * @returns {Function} a subclass of SDKClass with secret resolution baked in.
 */
function buildSecureClient(SDKClass, envVarName, keyKwarg, methodPathToPatch = null) {
  class SecurePlatformProxy extends SDKClass {
    constructor(opts = {}) {
      const encodedKey = process.env[envVarName] || '';
      let secret = String(process.env.RANBVAL_PROJECT_SECRET || '').trim();
      if (!secret && process.env.RANBVAL_VAULT_SECRET) {
        process.stderr.write(
          '[Ranbval] DeprecationWarning: RANBVAL_VAULT_SECRET is deprecated. ' +
          'Rename it to RANBVAL_PROJECT_SECRET.\n',
        );
        secret = String(process.env.RANBVAL_VAULT_SECRET).trim();
      }
      const host = process.env.RANBVAL_HOST || DEFAULT_RANBVAL_HOST;

      if (!encodedKey) {
        throw new Error(`No ${envVarName} found or provided.`);
      }

      let salt = null;
      if (encodedKey.startsWith('ranbval.')) {
        if (!secret) {
          throw new Error(
            `Found encoded vault token for ${envVarName} but RANBVAL_PROJECT_SECRET is missing. ` +
            'Set it in .ranbval or your environment.',
          );
        }
        const decrypted = safeDecrypt(encodedKey, secret);
        const merged = { ...opts, [keyKwarg]: decrypted.use() };
        super(merged);
        salt = encodedKey.split('.')[1] || null;
      } else {
        super(opts);
      }

      Object.defineProperty(this, '_ranbvalSalt', { value: salt, enumerable: false });
      Object.defineProperty(this, '_vaultTokenFormat', { value: salt ? 'ranbval' : null, enumerable: false });
      Object.defineProperty(this, '_ranbvalHost', { value: host, enumerable: false });

      if (salt && methodPathToPatch) {
        this._patchMethod(methodPathToPatch, SDKClass.name || 'SDK');
      }
    }

    _patchMethod(dotPath, sdkName) {
      const parts = String(dotPath).split('.');
      let target = this;
      for (let i = 0; i < parts.length - 1; i++) {
        target = target && target[parts[i]];
        if (target == null) return;
      }
      const last = parts[parts.length - 1];
      const orig = target[last];
      if (typeof orig !== 'function') return;
      const salt = this._ranbvalSalt;
      const host = this._ranbvalHost;
      const wrapped = function (...args) {
        const result = orig.apply(target, args);
        emitTelemetry({
          clientSalt: salt,
          modelUsed: `${sdkName} API`,
          hostUrl: host,
          eventKind: 'platform.invocation',
          background: true,
        });
        return result;
      };
      target[last] = wrapped;
    }
  }
  return SecurePlatformProxy;
}

module.exports = { buildSecureClient };
