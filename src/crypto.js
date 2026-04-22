/**
 * Decrypt Ranbval vault tokens locally with AES-256-GCM (key derived via PBKDF2-SHA256).
 *
 * Wire format compatible with the Python SDK:
 *   ranbval . <salt 10-char> . <urlsafe-base64(IV ‖ ciphertext ‖ authTag)> . ahsan
 *
 * Where:
 *   IV         = first 12 bytes of the decoded payload
 *   authTag    = last 16 bytes of the decoded payload
 *   ciphertext = bytes in between
 *
 * Key = PBKDF2-SHA256(password=projectSecret, salt=token.salt, iterations=100_000, length=32)
 */

'use strict';

const crypto = require('node:crypto');

const { DEFAULT_RANBVAL_HOST } = require('./defaults');
const { assertRepoAllowedForDecrypt } = require('./repoPolicy');
const { SecretString } = require('./secretString');

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

/**
 * Derive an AES-256 key from the project secret + token salt.
 *
 * @param {string} password
 * @param {string} saltStr
 * @returns {Buffer} 32-byte key
 */
function deriveKey(password, saltStr) {
  const salt = saltStr ? Buffer.from(saltStr, 'utf8') : Buffer.from('fallback-salt', 'utf8');
  return crypto.pbkdf2Sync(
    Buffer.from(String(password), 'utf8'),
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH_BYTES,
    'sha256',
  );
}

function _enforceRepoAllowlistIfConfigured(clientSalt) {
  const host = (process.env.RANBVAL_HOST || DEFAULT_RANBVAL_HOST).trim();
  assertRepoAllowedForDecrypt(host, clientSalt);
}

/**
 * Decrypt a Ranbval vault token using your project secret.
 *
 * @param {string} copyToken    Vault token of the form `ranbval.<salt>.<blob>.ahsan`.
 * @param {string} projectSecret The `ranbval-proj-…` key for the project.
 * @returns {SecretString} the plaintext, wrapped so it is never accidentally logged.
 *
 * @example
 *   const secret = safeDecrypt(token, projectSecret);
 *   const client = new OpenAI({ apiKey: secret.use() });
 */
function safeDecrypt(copyToken, projectSecret) {
  if (typeof copyToken !== 'string' || !copyToken) {
    throw new Error('Corrupted cryptographic token identifier or signature matrix');
  }
  if (typeof projectSecret !== 'string' || !projectSecret) {
    throw new Error('safeDecrypt requires a non-empty project secret');
  }

  const segments = copyToken.split('.');

  let key;
  let b64Payload;

  if (segments.length === 4) {
    const [header, noiseSalt, blob, tailSig] = segments;
    if (header !== 'ranbval' || tailSig !== 'ahsan') {
      throw new Error('Corrupted cryptographic token identifier or signature matrix');
    }
    _enforceRepoAllowlistIfConfigured(noiseSalt);
    key = deriveKey(projectSecret, noiseSalt);
    b64Payload = blob;
  } else if (segments.length === 5) {
    // Backwards-compat: old 5-part format.
    const [header, noise, salt, blob /* , tail */] = segments;
    if (header !== 'ranbval') {
      throw new Error('Corrupted cryptographic token identifier or signature matrix');
    }
    _enforceRepoAllowlistIfConfigured(noise);
    key = deriveKey(projectSecret, salt);
    b64Payload = blob;
  } else {
    throw new Error(
      `E2E packet fragmentation error: expected 4 segments, got ${segments.length}`,
    );
  }

  let packed;
  try {
    packed = Buffer.from(b64Payload, 'base64url');
  } catch (e) {
    throw new Error('Decryption failed! Did you provide the correct E2E vault secret?');
  }

  if (packed.length < IV_LENGTH_BYTES + TAG_LENGTH_BYTES) {
    throw new Error('Decryption failed! Did you provide the correct E2E vault secret?');
  }

  const iv = packed.subarray(0, IV_LENGTH_BYTES);
  const authTag = packed.subarray(packed.length - TAG_LENGTH_BYTES);
  const ciphertext = packed.subarray(IV_LENGTH_BYTES, packed.length - TAG_LENGTH_BYTES);

  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    throw new Error('Decryption failed! Did you provide the correct E2E vault secret?');
  }

  return new SecretString(plaintext.toString('utf8'));
}

/**
 * Auto-discover the project secret for *envVar* using the prefix convention.
 *
 * Resolution order:
 *  1. `{PREFIX}_PROJECT_SECRET` where PREFIX is the longest matching env-var prefix
 *     e.g. `MYAPP_OPENAI_KEY` → looks for `MYAPP_PROJECT_SECRET`
 *  2. `RANBVAL_PROJECT_SECRET` — global fallback / single-project setups
 *
 * @param {string} envVar
 * @returns {string}
 */
function _findProjectSecretFor(envVar) {
  const parts = String(envVar).toUpperCase().split('_');
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('_') + '_PROJECT_SECRET';
    const value = (process.env[candidate] || '').trim();
    if (value) return value;
  }
  const fallback = (process.env.RANBVAL_PROJECT_SECRET || '').trim();
  if (fallback) return fallback;

  const prefixHint = parts[0] + '_PROJECT_SECRET';
  throw new Error(
    `No project secret found for '${envVar}'. ` +
    `Add ${prefixHint} (or RANBVAL_PROJECT_SECRET) to your .ranbval file.`,
  );
}

/**
 * Read a vault token from `envVar` and decrypt it — project secret discovered automatically.
 *
 * Convention: name your env vars with a project prefix and store the matching project
 * secret under `{PREFIX}_PROJECT_SECRET`. Works for any number of projects in one file:
 *
 *   # .ranbval
 *   MYAPP_PROJECT_SECRET=ranbval-proj-xxx
 *   MYAPP_OPENAI_KEY=ranbval.xxx.…ahsan
 *
 *   BILLING_PROJECT_SECRET=ranbval-proj-yyy
 *   BILLING_STRIPE_KEY=ranbval.yyy.…ahsan
 *
 *   // app.js
 *   const { loadRanbval, decryptKey } = require('ranbval-sdk');
 *   loadRanbval();
 *   const openaiKey = decryptKey('MYAPP_OPENAI_KEY');    // finds MYAPP_PROJECT_SECRET
 *   const stripeKey = decryptKey('BILLING_STRIPE_KEY');  // finds BILLING_PROJECT_SECRET
 *
 * If the value is not a vault token (does not start with `ranbval.`), it is returned
 * as-is wrapped in SecretString.
 *
 * @param {string} envVar
 * @returns {SecretString}
 */
function decryptKey(envVar) {
  const token = (process.env[envVar] || '').trim();
  if (!token) {
    throw new Error(`'${envVar}' is not set. Add it to your .ranbval file or environment.`);
  }
  if (!token.startsWith('ranbval.')) {
    return new SecretString(token, envVar);
  }
  const projectSecret = _findProjectSecretFor(envVar);
  const out = safeDecrypt(token, projectSecret);
  // Re-wrap with envVar as label for traceability — SecretString is frozen so build a fresh one.
  return new SecretString(out.use(), envVar);
}

module.exports = {
  deriveKey,
  safeDecrypt,
  decryptKey,
  _findProjectSecretFor,
};
