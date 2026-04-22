/**
 * Single entry: wrap **your** SDK class (OpenAI, Stripe, Anthropic, …) — Ranbval ships zero vendor deps.
 */

'use strict';

const { buildSecureClient } = require('./universal');

/**
 * Build one secure client: read the Ranbval token (or plain key) from `envVar`,
 * decrypt if needed, pass to `SDKClass` via `keyKwarg`, return an instance.
 *
 * You install **openai**, **stripe**, **anthropic**, etc. in your own project — this
 * package does not.
 *
 * @example
 *   const OpenAI = require('openai');
 *   const { loadRanbval, secureClient } = require('ranbval-sdk');
 *
 *   loadRanbval();
 *   const client = secureClient(OpenAI, {
 *     envVar: 'OPENAI_API_KEY',
 *     keyKwarg: 'apiKey',
 *     methodPathToPatch: 'chat.completions.create',
 *   });
 *
 * @param {Function} SDKClass
 * @param {object} opts
 * @param {string} opts.envVar
 * @param {string} opts.keyKwarg
 * @param {string|null} [opts.methodPathToPatch]
 * @param {object} [opts.constructorArgs]   Extra args passed to the underlying SDK constructor.
 */
function secureClient(SDKClass, { envVar, keyKwarg, methodPathToPatch = null, constructorArgs = {} } = {}) {
  const ev = String(envVar || '').trim();
  const kk = String(keyKwarg || '').trim();
  if (!ev || !kk) {
    throw new Error('secureClient requires non-empty envVar and keyKwarg.');
  }
  if (process.env[ev] == null || process.env[ev] === '') {
    throw new Error(
      `secureClient(${SDKClass && SDKClass.name ? SDKClass.name : 'SDK'}): ` +
      `set '${ev}' in the environment or .ranbval.`,
    );
  }
  const Proxy = buildSecureClient(SDKClass, ev, kk, methodPathToPatch);
  return new Proxy(constructorArgs);
}

module.exports = { secureClient };
