# ranbval-sdk `v0.12.0`

[![npm version](https://img.shields.io/npm/v/ranbval-sdk.svg)](https://www.npmjs.com/package/ranbval-sdk)
[![Node.js](https://img.shields.io/node/v/ranbval-sdk.svg)](https://nodejs.org)
[![License](https://img.shields.io/npm/l/ranbval-sdk.svg)](LICENSE)

**Keep API secrets out of plaintext config.**

Ranbval SDK for Node.js lets you store encrypted vault tokens in `.ranbval` files alongside your code and decrypt them only at runtime — using AES-256-GCM + PBKDF2, zero runtime dependencies, and your own HTTP/SDK stack.

---

## Table of Contents

- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [.ranbval file format](#ranbval-file-format)
- [API reference](#api-reference)
  - [loadRanbval](#loadranbvalpath-options)
  - [fetchEnvSet / pushEnv](#fetchenvsetoptions--pushenvname-value-options)
  - [isPublic / isSecret / isProxy](#ispublicname--issecretname--isproxyname)
  - [decryptKey](#decryptkeyenvvar)
  - [safeDecrypt](#safedecrypttoken-projectsecret)
  - [SecretString](#secretstring)
  - [secureClient](#secureclientsdkclass-opts)
  - [buildSecureClient](#buildsecureclientsdkclass-envvarname-keykwarg-methodpathtopatch)
  - [proxyRequest](#proxyrequestopts)
  - [emitTelemetry](#emittelemetryopts)
  - [Repo policy](#repo-policy)
- [Environment variables](#environment-variables)
- [Wire format](#wire-format)
- [TypeScript and ESM](#typescript-and-esm)
- [Running tests](#running-tests)
- [Links](#links)
- [License](#license)

---

## Install

```bash
npm install ranbval-sdk
```

Node 18 or later is required. No production dependencies — only Node built-ins (`crypto`, `fs`, `path`, `https`).

---

## Quick start

```js
const { loadRanbval, decryptKey } = require('ranbval-sdk');

// Load .ranbval into process.env
loadRanbval();

// Decrypt a vault token at the moment you actually need it
const openaiKey = await decryptKey('MYAPP_OPENAI_KEY');

// Use it, then it's gone from memory
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  headers: { Authorization: `Bearer ${openaiKey.use()}` },
  // ...
});
openaiKey.wipe();
```

That's the core pattern. Your `.ranbval` file lives in the project root (or any parent directory) and is safe to commit — the tokens inside it are AES-256-GCM encrypted and useless without the project secret.

---

## How it works

1. You create a project in the [Ranbval dashboard](https://secret.ranbval.com) and copy its project secret.
2. You paste API keys (OpenAI, Stripe, etc.) into the dashboard — it returns encrypted vault tokens.
3. You put those tokens in a `.ranbval` file next to your code.
4. At runtime `loadRanbval()` loads the file into `process.env`. Calling `decryptKey()` decrypts a single token on demand using AES-256-GCM + PBKDF2.
5. The plaintext key exists only in the returned `SecretString` until you call `.wipe()` or it falls out of scope.

The project secret never leaves your environment. The encrypted tokens in `.ranbval` are safe to commit because decryption requires the secret, which you store separately (in `MYAPP_PROJECT_SECRET` or `.ranbval.local`).

---

## .ranbval file format

`.ranbval` files use the same `KEY=VALUE` syntax as `.env` files. Comments start with `#`. Blank lines are ignored.

```dotenv
# .ranbval
MYAPP_PROJECT_SECRET=ranbval-proj-xxxxxxxxxxxxxxxxxxxxxxxxxx
MYAPP_OPENAI_KEY=ranbval.<noise>.<encrypted-blob>.ahsan
MYAPP_STRIPE_KEY=ranbval.<noise>.<encrypted-blob>.ahsan
RANBVAL_API_KEY=ranbvalahsantariq...
```

### Layering

The SDK loads files in this order, with later files overriding earlier ones:

| File | Committed? | Purpose |
|---|---|---|
| `.ranbval` | Yes | Shared encrypted tokens, project metadata |
| `.ranbval.{mode}` | Yes | Mode-specific tokens (e.g. `.ranbval.staging`) |
| `.ranbval.local` | No | Local overrides, personal project secret |
| `.ranbval.{mode}.local` | No | Mode + local combined |

`{mode}` is resolved from `RANBVAL_ENV`, `ENVIRONMENT`, or `ENV` (in that order).

Add these lines to `.gitignore`:

```
.ranbval.local
.ranbval.*.local
```

---

## API reference

### `loadRanbval(path?, options?)`

Loads `.ranbval` (and its layer variants) into `process.env`. Must be called before any `decryptKey()` or `safeDecrypt()` calls that depend on env vars.

```js
const { loadRanbval } = require('ranbval-sdk');

// Load from the current working directory (default)
loadRanbval();

// Load from a specific directory or file path
loadRanbval('/app/config/.ranbval');

// With options
loadRanbval(null, {
  environment: 'production', // which stage to load (local: .ranbval.production)
  override: true,            // overwrite existing process.env values
  projectSecret: 's3cr3t',   // inline project secret (skip env lookup)
  projectName: 'myapp',      // project name prefix for env var discovery
});

// Remote: pull the env-set from the control plane instead of reading local files.
// fetch() is async, so the remote path returns a Promise — await it.
await loadRanbval(null, { remote: true, environment: 'production' });     // owner (project secret in env)
await loadRanbval(null, { remote: true, apiKey: 'ranbval-dev-…' });      // teammate with a developer token
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `environment` | `string` | auto | Which stage to load — `"development"`, `"staging"`, `"production"`, … Works for local files (merges `.ranbval.{environment}`) **and** `remote: true`. |
| `mode` | `string` | auto | Older alias for `environment`; wins if both are given. Falls back to `RANBVAL_ENV` / `ENVIRONMENT` / `ENV`. |
| `remote` | `boolean` | `false` | Fetch the env-set from the control plane instead of local files. Requires `projectSecret` (owner) or `apiKey` (developer). **Returns a `Promise` — `await` it.** |
| `apiKey` | `string` | — | A `ranbval-dev-…` developer token, for a teammate fetching config remotely. |
| `host` | `string` | — | Override the control-plane host. Defaults to `api.secret.ranbval.com`. |
| `start` | `string` | `process.cwd()` | Directory to start searching for `.ranbval` files |
| `override` | `boolean` | `false` | If `true`, overwrite variables already set in `process.env` |
| `projectSecret` | `string` | — | Inline project secret (also the owner credential for `remote: true`); skips env var lookup |
| `projectName` | `string` | — | Prefix used to look up `{NAME}_PROJECT_SECRET` in env |

Returns `true` when at least one file was loaded (or the remote fetch succeeded), `false` otherwise. With `remote: true`, returns `Promise<boolean>`.

---

### `fetchEnvSet(options?)` · `pushEnv(name, value, options?)`

Talk to the Ranbval control plane directly — the same remote source `loadRanbval({ remote: true })` uses, without touching `process.env`.

```js
const { fetchEnvSet, pushEnv } = require('ranbval-sdk');

// Owner pulls one environment's env-set (SECRET_/PROXY_ come back as encrypted ranbval.* tokens)
const envs = await fetchEnvSet({ projectSecret: 'ranbval-proj-…', environment: 'production' });

// A teammate uses a developer token instead of the project secret
const dev = await fetchEnvSet({ apiKey: 'ranbval-dev-…', environment: 'development' });

// A developer can add PUBLIC_ config — attributed to them in the dashboard
await pushEnv('PUBLIC_FEATURE_FLAG', 'on', { apiKey: 'ranbval-dev-…', environment: 'staging' });
```

A **developer token** can pull the project's sealed `SECRET_`/`PROXY_` tokens and add `PUBLIC_` config, but the tokens stay ciphertext — decryption needs the project secret, which a developer token never carries. Creating `SECRET_`/`PROXY_` keys stays owner-only.

---

### `isPublic(name)` · `isSecret(name)` · `isProxy(name)`

Prefix classification helpers — the same rule the SDK uses internally.

```js
const { isPublic, isSecret, isProxy } = require('ranbval-sdk');

isPublic('PUBLIC_DATABASE_URL'); // true — plaintext config
isSecret('SECRET_OPENAI_KEY');   // true — decrypted in-process
isProxy('PROXY_STRIPE_KEY');     // true — never decrypted locally; only /execute can use it
```

---

### `decryptKey(envVar)`

Decrypts a single vault token stored in `process.env[envVar]`. Returns a `SecretString`.

```js
const { loadRanbval, decryptKey } = require('ranbval-sdk');

loadRanbval();

// decryptKey auto-discovers the project secret from the env var prefix.
// MYAPP_OPENAI_KEY  ->  looks for MYAPP_PROJECT_SECRET in process.env
const key = await decryptKey('MYAPP_OPENAI_KEY');

// Check the length without exposing the value
console.log(key.length); // byte length, no plaintext logged

// Retrieve the plaintext when you are ready to use it
const plaintext = key.use();
doSomethingWith(plaintext);

// Wipe from memory when done
key.wipe();
```

Project secret discovery order:

1. `{PREFIX}_PROJECT_SECRET` — derived from the env var name (everything before the last segment that matches a known project prefix)
2. `RANBVAL_PROJECT_SECRET` — global fallback
3. `projectSecret` option passed to `loadRanbval()`

Throws a `TypeError` if the env var is not set or the token format is invalid. Throws a `RangeError` if decryption fails (wrong secret or corrupted token).

---

### `safeDecrypt(token, projectSecret)`

Lower-level decryption. Decrypts a raw vault token string using the given project secret. Returns a `SecretString`.

```js
const { safeDecrypt } = require('ranbval-sdk');

const token = process.env.MYAPP_OPENAI_KEY; // ranbval.<noise>.<blob>.ahsan
const secret = process.env.MYAPP_PROJECT_SECRET;

const key = await safeDecrypt(token, secret);
const plaintext = key.use();
key.wipe();
```

Use `decryptKey()` in application code when possible — it handles prefix discovery automatically. Use `safeDecrypt()` when you need full control over which secret to use.

---

### `SecretString`

The value returned by `decryptKey()` and `safeDecrypt()`. Wraps a plaintext string in an object that prevents accidental logging and supports explicit memory wiping.

```js
const key = await decryptKey('MYAPP_OPENAI_KEY');

key.use()           // Returns the plaintext string; throws after wipe()
key.wipe()          // Overwrites the internal buffer; subsequent .use() throws
key.length          // Byte length of the plaintext (safe to log)
key.label           // Source env var name, e.g. "MYAPP_OPENAI_KEY"

// toString() and toJSON() return "[SecretString]" — safe in logs
console.log(String(key));    // [SecretString]
JSON.stringify({ k: key });  // {"k":"[SecretString]"}

// Explicit resource management (Node 18+)
{
  await using key = await decryptKey('MYAPP_OPENAI_KEY');
  // key.wipe() called automatically at block exit via [Symbol.dispose]
}
```

**Blocked paths.** Passing a `SecretString` to common serialization paths returns the safe sentinel `"[SecretString]"` rather than leaking plaintext:

- `JSON.stringify`
- `String()` coercion
- Template literals (via `[Symbol.toPrimitive]`)
- `console.log` / `console.info` / `console.error` / `console.warn`

Call `.use()` to deliberately retrieve the plaintext when you are ready to pass it to an SDK or HTTP client.

---

### `secureClient(SDKClass, opts)`

Wraps an SDK constructor so that the API key is decrypted from a vault token and injected just-in-time, only when a method is actually called. The plaintext key is never stored on the constructed client instance.

```js
const { loadRanbval, secureClient } = require('ranbval-sdk');
const OpenAI = require('openai');

loadRanbval();

const client = await secureClient(OpenAI, {
  envVar: 'MYAPP_OPENAI_KEY',   // vault token env var
  keyKwarg: 'apiKey',           // constructor option name for the API key
  constructorArgs: [{}],        // extra constructor args (merged with key)
});

// Use exactly like a normal OpenAI client
const resp = await client.chat.completions.create({ ... });
```

**Options:**

| Option | Type | Required | Description |
|---|---|---|---|
| `envVar` | `string` | Yes | Env var holding the vault token |
| `keyKwarg` | `string` | Yes | Constructor parameter name for the API key |
| `methodPathToPatch` | `string[]` | No | Dot-path to the method to intercept (default: first callable method found) |
| `constructorArgs` | `any[]` | No | Additional arguments passed to the SDK constructor |

Returns a proxied instance of `SDKClass`. Each intercepted method call triggers decryption, injects the key, invokes the real method, then wipes the plaintext.

---

### `buildSecureClient(SDKClass, envVarName, keyKwarg, methodPathToPatch?)`

Returns a subclass of `SDKClass` with key injection baked in. Use this when you want to export a pre-configured secure client class rather than wrapping at call time.

```js
const { buildSecureClient } = require('ranbval-sdk');
const Stripe = require('stripe');

const SecureStripe = buildSecureClient(
  Stripe,
  'MYAPP_STRIPE_KEY',   // vault token env var
  'apiKey',             // Stripe constructor key param
);

// Instantiate normally — key is injected on each method call
const stripe = new SecureStripe();
const charge = await stripe.charges.create({ amount: 2000, currency: 'usd', source: 'tok_visa' });
```

`methodPathToPatch` is an optional array of strings describing the dot-path of a specific method to patch. If omitted, the SDK patches the first interceptable method it discovers on the class prototype.

---

### `proxyRequest(opts)`

Sends an HTTP/HTTPS request through the Ranbval proxy, injecting a decrypted API key into the request headers or body without the plaintext ever appearing in your source code.

```js
const { loadRanbval, proxyRequest } = require('ranbval-sdk');

loadRanbval();

const result = await proxyRequest({
  url: 'https://api.openai.com/v1/chat/completions',
  method: 'POST',
  envVar: 'MYAPP_OPENAI_KEY',
  injectMode: 'bearer',
  body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] },
  headers: { 'Content-Type': 'application/json' },
});

console.log(result.status);   // HTTP status code
console.log(result.body);     // parsed response body
console.log(result.headers);  // response headers
```

**Options:**

| Option | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | Yes | Target URL |
| `method` | `string` | No | HTTP method (default: `'GET'`) |
| `envVar` | `string` | Yes | Vault token env var holding the API key to inject |
| `injectMode` | `string` | No | How to inject the key: `'bearer'` (default), `'header'`, `'body'`, `'query'` |
| `injectKey` | `string` | No | Header/body/query field name (required for `'header'`, `'body'`, `'query'` modes) |
| `body` | `object` | No | Request body (serialized to JSON) |
| `headers` | `object` | No | Additional request headers |
| `timeout` | `number` | No | Request timeout in milliseconds (default: `30000`) |

**Inject modes:**

| Mode | Behavior |
|---|---|
| `'bearer'` | Adds `Authorization: Bearer <key>` header |
| `'header'` | Adds `{injectKey}: <key>` as a custom header |
| `'body'` | Merges `{ [injectKey]: key }` into the JSON body |
| `'query'` | Appends `?{injectKey}=<key>` to the URL |

**Return shape:**

```js
{
  status: 200,
  headers: { 'content-type': 'application/json', ... },
  body: { ... }   // parsed JSON, or raw string if response is not JSON
}
```

Throws `ProxyError` on non-2xx responses. `ProxyError` extends `Error` and exposes `.status` (number) and `.body` (string or object).

---

### `emitTelemetry(opts)`

Sends a usage event to the Ranbval telemetry endpoint. If `RANBVAL_TELEMETRY=0` is set, this function returns immediately without making any network calls.

```js
const { emitTelemetry } = require('ranbval-sdk');

await emitTelemetry({
  event: 'api_call',
  envVar: 'MYAPP_OPENAI_KEY',   // used to derive a non-reversible project salt
  metadata: { model: 'gpt-4o', tokens: 512 },
});
```

**Options:**

| Option | Type | Required | Description |
|---|---|---|---|
| `event` | `string` | Yes | Event name (arbitrary string) |
| `envVar` | `string` | No | Env var name; used to derive a non-reversible project salt |
| `metadata` | `object` | No | Arbitrary key-value pairs attached to the event |
| `host` | `string` | No | Override the telemetry host (default: `RANBVAL_HOST`) |

Telemetry payloads contain only salted, non-reversible identifiers — no plaintext keys or secrets are transmitted. Set `RANBVAL_TELEMETRY_DEBUG=1` to have failures logged to `stderr` rather than silently swallowed.

---

### Repo policy

These exports let you gate decryption on whether the current repository's git remote origin appears on an allowlist configured in the Ranbval dashboard or locally via `RANBVAL_ALLOWED_REPOS`.

```js
const {
  assertRepoAllowedForDecrypt,
  assertRepoAllowedForDecryptAsync,
  fetchRepoPolicy,
  normalizeGitRemoteUrl,
  getGitRemoteOrigin,
} = require('ranbval-sdk');

// Sync check using RANBVAL_ALLOWED_REPOS (comma-separated local list, no network)
assertRepoAllowedForDecrypt();

// Async check — fetches the allowlist from the Ranbval API
await assertRepoAllowedForDecryptAsync({ projectSecret: process.env.MYAPP_PROJECT_SECRET });

// Low-level helpers
const remote = await getGitRemoteOrigin();           // e.g. "git@github.com:org/repo.git"
const normalized = normalizeGitRemoteUrl(remote);    // e.g. "github.com/org/repo"
const policy = await fetchRepoPolicy({ projectSecret: process.env.MYAPP_PROJECT_SECRET });
```

Both assert functions throw if the current repo is not on the allowlist. Set `RANBVAL_SKIP_REPO_CHECK=1` to bypass the check entirely (useful in CI environments that clone to non-standard paths).

---

## Environment variables

| Variable | Effect |
|---|---|
| `RANBVAL_HOST` | Override the Ranbval API host (default: `https://api.secret.ranbval.com`) |
| `RANBVAL_PROJECT_SECRET` | Default project secret used when prefix-based discovery finds nothing |
| `RANBVAL_API_KEY` | SDK API key required by `proxyRequest()` |
| `RANBVAL_SKIP_REPO_CHECK=1` | Bypass the git-origin allowlist check |
| `RANBVAL_ALLOWED_REPOS` | Comma-separated local allowlist (no network call) |
| `RANBVAL_TELEMETRY=0` | Disable `emitTelemetry()` silently |
| `RANBVAL_TELEMETRY_DEBUG=1` | Log telemetry failures to `stderr` |
| `RANBVAL_ENV` | Explicit mode for `.ranbval.{mode}` layer selection |
| `ENVIRONMENT` | Fallback mode if `RANBVAL_ENV` is not set |
| `ENV` | Fallback mode if neither `RANBVAL_ENV` nor `ENVIRONMENT` is set |

---

## Wire format

### Vault token structure

A vault token is a dot-delimited string with four parts:

```
ranbval.<noise>.<encrypted-blob>.<author-tag>
```

| Part | Description |
|---|---|
| `ranbval` | Literal prefix — identifies the string as a Ranbval token |
| `<noise>` | Base64-encoded salt/nonce metadata |
| `<encrypted-blob>` | AES-256-GCM ciphertext + auth tag, base64-encoded |
| `<author-tag>` | Short identifier tag (e.g. `ahsan`) |

The SDK also understands a legacy 5-part format from early releases (backward-compat parsing was added in `0.8.x`).

### Key derivation

```
projectKey = PBKDF2-SHA256(projectSecret, salt, iterations=210_000, keylen=32)
plaintext  = AES-256-GCM-Decrypt(projectKey, iv, ciphertext, authTag)
```

- PBKDF2 iterations follow the OWASP 2023 recommendation for PBKDF2-HMAC-SHA256.
- The IV and auth tag are packed into the encrypted blob alongside the ciphertext.
- The project secret is the only secret material that ever leaves the Ranbval dashboard — it is never transmitted by this SDK.

---

## TypeScript and ESM

The published package is CommonJS (built with esbuild targeting Node 18). It works in TypeScript projects using `require`:

```ts
// tsconfig: "moduleResolution": "node" or "bundler"
const { loadRanbval, decryptKey } = require('ranbval-sdk');
```

Native ESM (`import`) is not supported in this release. If your project uses `"type": "module"`, use `createRequire`:

```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadRanbval, decryptKey } = require('ranbval-sdk');
```

TypeScript type declarations (`.d.ts`) will be added in a future release. Until then, you can add a local shim in `globals.d.ts`:

```ts
declare module 'ranbval-sdk' {
  export function loadRanbval(path?: string | null, options?: object): void;
  export function decryptKey(envVar: string): Promise<SecretString>;
  export function safeDecrypt(token: string, projectSecret: string): Promise<SecretString>;
  export class SecretString {
    use(): string;
    wipe(): void;
    readonly length: number;
    readonly label: string;
    [Symbol.dispose](): void;
  }
  // ... extend as needed
}
```

---

## Running tests

```bash
npm install
node --test test/*.test.js
```

Or via the npm script:

```bash
npm test
```

Tests use Node's built-in `node:test` runner — no additional test framework is needed.

---

## Links

- Website: [https://secret.ranbval.com](https://secret.ranbval.com)
- npm: [https://www.npmjs.com/package/ranbval-sdk](https://www.npmjs.com/package/ranbval-sdk)
- Issues: [https://github.com/TariqDreamsTech/ranbval-sdk-node/issues](https://github.com/TariqDreamsTech/ranbval-sdk-node/issues)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

---

## License

Apache-2.0 — see [LICENSE](LICENSE) for the full text.

Copyright 2024 Ahsan Tariq, Hussnain Tariq, Sundas Tariq
