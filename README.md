# Ranbval SDK

Keep API secrets out of plaintext config. Layered `.ranbval*` env files, decrypt vault tokens only when used, optional usage telemetry — minimal deps, your own HTTP/SDK stack.

## Install

```bash
npm install ranbval-sdk
```

Requires Node 18 or newer. Zero runtime dependencies (Node built-ins only: `crypto`, `https`, `child_process`).

## Quick start

```js
const { loadRanbval, decryptKey } = require('ranbval-sdk');

// 1. Load .ranbval files into process.env
loadRanbval(null, { projectName: 'myapp' });

// 2. Decrypt a vault token by env var name
const openaiKey = decryptKey('MYAPP_OPENAI_KEY');

// 3. Use it (the only access point — never logs)
const client = new OpenAI({ apiKey: openaiKey.use() });
```

## `.ranbval` file

```dotenv
# Project secret — created when you make a project in the Ranbval dashboard
MYAPP_PROJECT_SECRET=ranbval-proj-xxxxxxxxxxxxxxxxxxxxxx

# Vault tokens — encrypted with the project secret above
MYAPP_OPENAI_KEY=ranbval.<noise>.<blob>.ahsan
MYAPP_STRIPE_KEY=ranbval.<noise>.<blob>.ahsan

# Optional: SDK API key for proxyRequest()
RANBVAL_API_KEY=ranbvalahsantariq0724XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Optional: server override
RANBVAL_HOST=https://api.ranbval.com
```

The loader merges layers (later overrides earlier):

1. `.ranbval`
2. `.ranbval.{development|production}`
3. `.ranbval.local`
4. `.ranbval.{mode}.local`

## API

### `loadRanbval(path?, options?)`

Loads `.ranbval*` files into `process.env`.

```js
loadRanbval();                                                  // auto-discover
loadRanbval('/path/to/.ranbval');                               // single file
loadRanbval(null, { mode: 'production', override: true });      // pick mode + force
loadRanbval(null, {
  projectName: 'myapp',                                         // sets RANBVAL_PROJECT_PREFIX=MYAPP
  projectSecret: 'ranbval-proj-xxx',                            // sets RANBVAL_PROJECT_SECRET
});
```

### `decryptKey(envVar)`

Reads `process.env[envVar]` and decrypts it. The project secret is auto-discovered from the prefix:

* `MYAPP_OPENAI_KEY` → looks for `MYAPP_PROJECT_SECRET`
* falls back to `RANBVAL_PROJECT_SECRET`

Returns a `SecretString`.

### `safeDecrypt(token, projectSecret)`

Lower-level decrypt when you already have both pieces.

### `SecretString`

Wrapper that refuses every implicit display path:

```js
const s = decryptKey('MY_KEY');

console.log(s);                  // [ranbval:secret]
`${s}`;                          // [ranbval:secret]
JSON.stringify(s);               // "[ranbval:secret]"
require('util').inspect(s);      // SecretString(***)

s.use();                         // ← only access point, returns the raw string
s.length;                        // safe (just length)
```

### `proxyRequest(opts)`

Send any HTTP request through Ranbval's secure proxy — the real key is decrypted **server-side** and never reaches the caller.

```js
const { proxyRequest } = require('ranbval-sdk');

const resp = await proxyRequest({
  token: process.env.MYAPP_OPENAI_KEY,
  targetUrl: 'https://api.openai.com/v1/chat/completions',
  method: 'POST',
  injectAs: 'bearer',                           // → Authorization: Bearer <secret>
  body: { model: 'gpt-4o', messages: [/* … */] },
});
console.log(resp.body);
```

Inject modes: `"bearer"`, `"basic"`, `"header:X-Api-Key"`, `"query:api_key"`.

### `secureClient(SDKClass, opts)`

Wrap any vendor SDK so the key auto-decrypts on construction:

```js
const OpenAI = require('openai');
const { loadRanbval, secureClient } = require('ranbval-sdk');

loadRanbval();

const client = secureClient(OpenAI, {
  envVar: 'OPENAI_API_KEY',
  keyKwarg: 'apiKey',
  methodPathToPatch: 'chat.completions.create',   // optional: emit telemetry per call
});

const resp = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

### `emitTelemetry(opts)`

Send a Live Monitor event for any custom HTTP call you make outside the proxy.

```js
await emitTelemetry({
  vaultTokenEnv: 'MYAPP_OPENAI_KEY',
  modelUsed: 'gpt-4o',
  promptTokens: 123,
  completionTokens: 456,
});
```

## Environment flags

| Variable | Effect |
|---|---|
| `RANBVAL_HOST` | Override the Ranbval API host (default: `https://api.ranbval.com`) |
| `RANBVAL_PROJECT_SECRET` | Default project secret used when prefix discovery fails |
| `RANBVAL_API_KEY` | SDK API key for `proxyRequest()` |
| `RANBVAL_SKIP_REPO_CHECK=1` | Bypass git-origin allowlist (local dev / CI) |
| `RANBVAL_ALLOWED_REPOS` | Comma-separated allow-list for the local repo check |
| `RANBVAL_TELEMETRY=0` | Disable `emitTelemetry()` calls silently |
| `RANBVAL_TELEMETRY_DEBUG=1` | Log telemetry POST failures to stderr |
| `RANBVAL_ENV` / `ENVIRONMENT` / `ENV` | Pick `.ranbval.{mode}` layer (default: `development`) |

## Wire format

Vault tokens use this shape:

```
ranbval . <salt 10-char> . <urlsafe-base64( IV ‖ ciphertext ‖ authTag )> . ahsan
```

Where:

* `IV` — first 12 bytes of the decoded payload
* `authTag` — last 16 bytes
* `ciphertext` — bytes in between
* Key — `PBKDF2-SHA256(password = projectSecret, salt = token.salt, iterations = 100_000, length = 32)`
* Cipher — AES-256-GCM, no AAD

## Links

* Website: <https://www.ranbval.com>
* Issues: <https://github.com/TariqDreamsTech/ranbval-sdk-node/issues>

## License

Apache-2.0
