/**
 * `use` — one word per secret, nothing else to write.
 *
 * The full-control API (`loadRanbval` → `decryptKey` → `.use()`) is correct but long, and every
 * line of it is a line someone can get wrong. For the ordinary case — hand a credential to a
 * client library — this is the whole program:
 *
 *     const { use } = require('ranbval-sdk');
 *     const client = new OpenAI({ apiKey: use.OPENAI_KEY });
 *
 * `use.NAME` does all of it: loads `.ranbval` on first touch, finds the key whatever prefix it
 * carries, decrypts it, caches it, and returns a value the client can use directly.
 *
 * Name resolution
 * ---------------
 * Write the short name. `use.OPENAI_KEY` finds `SECRET_OPENAI_KEY` — the `SECRET_`, `PUBLIC_` and
 * bare spellings are all tried, so renaming a key's prefix in `.ranbval` does not break your code.
 * Exact names still work. A miss throws naming every spelling that was tried, never `undefined`:
 * a silent `undefined` for a credential surfaces later as a confusing auth failure rather than a
 * clear configuration error.
 *
 * What it does NOT relax
 * ----------------------
 *   - `PROXY_` secrets are refused. They are meant never to be decrypted on this machine, so
 *     handing one back as a string would defeat the prefix. Use `proxyRequest` instead.
 *   - The returned value is still sealed: inspect is masked, and the output guard is installed
 *     before it exists. Shorter code, not weaker code.
 *   - Every access is still recorded in the audit log.
 *
 * Honest limit, unchanged from the long form: `` `${use.OPENAI_KEY}` `` yields the plaintext,
 * because a client library has to be able to build a header out of it. If a value must never
 * exist in this process, that is what `PROXY_` is for.
 */

'use strict';

const { MissingKeyError, RanbvalConfigError } = require('../exceptions');

/** Tried in order against the short name the caller wrote. */
const PREFIXES = ['', 'SECRET_', 'PUBLIC_'];

/**
 * Resolve the real `.ranbval` key for a (possibly prefix-less) name.
 *
 * @param {string} short
 * @returns {string}
 */
function resolveName(short) {
  for (const prefix of PREFIXES) {
    const candidate = `${prefix}${short}`;
    if (Object.hasOwn(process.env, candidate)) return candidate;
  }
  if (Object.hasOwn(process.env, `PROXY_${short}`) || short.startsWith('PROXY_')) {
    throw new RanbvalConfigError(
      `'${short}' is a PROXY_ secret — it is never decrypted on this machine, which is the whole ` +
      'point of the PROXY_ prefix. Send the request through Ranbval instead: ' +
      'proxyRequest({ token, targetUrl, ... }).',
      { code: 'proxy_secret_not_revealable' },
    );
  }
  const tried = PREFIXES.map((p) => `'${p}${short}'`).join(', ');
  throw new MissingKeyError(
    `No key for '${short}' in your .ranbval — tried ${tried}. ` +
    'Check the name, or run `ranbval check` to list what is loaded.',
  );
}

/**
 * Build a `use`-style accessor. Exported as the ready-made `use` singleton; construct your own
 * only to pin a stage: `createUse({ mode: 'staging' }).SUPABASE_URL`.
 *
 * @param {{mode?: string}} [options]
 */
function createUse(options = {}) {
  const cache = new Map();
  let loaded = false;

  const ensureLoaded = () => {
    if (loaded) return;
    // Required lazily: the loader pulls in crypto, which would otherwise be a cycle.
    const { loadRanbval } = require('./loader');
    loadRanbval(null, { mode: options.mode });
    loaded = true;
  };

  const get = (short) => {
    ensureLoaded();
    if (cache.has(short)) return cache.get(short);

    const name = resolveName(short);
    const raw = process.env[name];
    let value;
    if (typeof raw === 'string' && raw.startsWith('ranbval.')) {
      const { decryptKey } = require('../crypto/cipher');
      // .use() here, not the SecretString: the caller is handing this straight to a client
      // library, which expects something string-shaped.
      value = decryptKey(name).use();
    } else {
      value = raw; // ordinary, safe-to-commit config value
    }
    cache.set(short, value);
    return value;
  };

  const target = {
    /** Like `Map.get` — the value, or `fallback` when the key is absent. */
    get(name, fallback = undefined) {
      try {
        return get(name);
      } catch (e) {
        if (e instanceof MissingKeyError || e instanceof RanbvalConfigError) return fallback;
        throw e;
      }
    },
    /** Drop every cached plaintext. Later reads decrypt again. */
    wipe() {
      cache.clear();
    },
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop !== 'string') return Reflect.get(obj, prop);
      // Own helpers and anything the runtime asks for (then, inspect, toJSON…) must not be
      // treated as key lookups, or `await use` and console.log(use) would explode.
      if (prop in obj || prop.startsWith('_') || prop === 'then' || prop === 'constructor') {
        return Reflect.get(obj, prop);
      }
      return get(prop);
    },
    has(obj, prop) {
      if (typeof prop !== 'string') return Reflect.has(obj, prop);
      ensureLoaded();
      try {
        resolveName(prop);
        return true;
      } catch {
        return false;
      }
    },
  });
}

/**
 * Return the raw encrypted `ranbval.*` token for a `PROXY_` secret.
 *
 * `PROXY_` values are never decrypted on this machine — that is the point of the prefix — so this
 * hands back the ciphertext for `proxyRequest`, which sends it to Ranbval to be decrypted and
 * injected server-side. The token alone is useless without the project secret.
 *
 * @param {string} name  with or without the `PROXY_` prefix
 * @returns {string}
 */
function proxyToken(name) {
  const full = name.startsWith('PROXY_') ? name : `PROXY_${name}`;
  const raw = process.env[full];
  if (!raw) {
    throw new MissingKeyError(
      `'${full}' is not set — did you create it in your .ranbval file?`,
    );
  }
  return raw;
}

module.exports = {
  proxyToken,
  createUse,
  use: createUse(),
};
