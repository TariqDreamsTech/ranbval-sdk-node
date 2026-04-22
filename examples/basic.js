/**
 * Ranbval SDK (Node) — external test
 *
 * Run:
 *   RANBVAL_PROJECT_SECRET=<your_project_secret> node examples/basic.js
 *
 *   Or put RANBVAL_PROJECT_SECRET in .ranbval and just:
 *   node examples/basic.js
 *
 * Env flags (optional):
 *   RANBVAL_SKIP_REPO_CHECK=1            skip git-origin allowlist check
 *   RANBVAL_HOST=http://localhost:8016   override server (default: .ranbval value)
 */

'use strict';

const path = require('node:path');

// Use local SDK source (in-repo) — replace with `require('ranbval-sdk')` after npm install.
const SDK_SRC = path.resolve(__dirname, '..', 'src');
const {
  loadRanbval,
  getProjectKey,
  decryptKey,
  proxyRequest,
  ProxyError,
  emitTelemetry,
  saltFromRanbvalToken,
} = require(SDK_SRC);

(async () => {
  // ── 1. Load .ranbval config ────────────────────────────────────────────────
  console.log('\n── 1. loadRanbval()');
  const loaded = loadRanbval(null, { projectName: 'myapp' });
  const PROJECT_SECRET = String(process.env.RANBVAL_PROJECT_SECRET || '').trim();

  let token = '';
  try {
    token = getProjectKey('MY_API_KEY');
  } catch {
    token = process.env.MY_API_KEY || '';
  }
  console.log(`   loaded=${loaded}  token_prefix=${token.slice(0, 30)}…`);

  if (!PROJECT_SECRET) {
    console.log('ERROR: set RANBVAL_PROJECT_SECRET=<your_project_secret> before running');
    console.log('       (or add it to .ranbval)');
    process.exit(1);
  }

  // ── 2. decrypt_key — auto-discovers project secret from env var prefix ────
  console.log("\n── 2. decryptKey('MY_API_KEY')");
  try {
    const secret = decryptKey('MY_API_KEY');
    console.log(`   String(secret)  → ${String(secret)}`);          // [ranbval:secret]
    console.log(`   inspect(secret) → ${require('util').inspect(secret)}`); // SecretString(***)
    console.log(`   secret.length   → ${secret.length} chars`);
    console.log('   secret.use()    → use inside API call only, never log');
    // Example correct usage:
    // const client = new OpenAI({ apiKey: secret.use() });
  } catch (e) {
    if (e && e.code === 'EPERM') {
      console.log(`   BLOCKED (repo): ${e.message}`);
    } else {
      console.log(`   Decrypt failed: ${e.message}`);
    }
  }

  // ── 3. proxy_request — HTTP through Ranbval secure proxy ─────────────────
  console.log('\n── 3. proxyRequest()');
  const RANBVAL_API_KEY = (process.env.RANBVAL_API_KEY || '').trim();
  if (!RANBVAL_API_KEY) {
    console.log('   SKIPPED — set RANBVAL_API_KEY in .ranbval to test proxyRequest()');
  } else {
    try {
      const resp = await proxyRequest({
        token,
        targetUrl: 'https://httpbin.org/post',
        method: 'POST',
        injectAs: 'header:X-Test-Key',
        body: { hello: 'from ranbval proxy (node)' },
        modelUsed: 'proxy.test',
      });
      console.log(`   status : ${resp.status}  ok=${resp.ok}`);
      console.log(`   session: '${resp.session_name}'  project='${resp.project}'`);
      console.log(`   body.json.hello = '${resp.body && resp.body.json && resp.body.json.hello}'`);
    } catch (e) {
      if (e instanceof ProxyError) {
        console.log(`   ProxyError: ${e.message}`);
      } else {
        console.log(`   Error: ${e.message}`);
      }
    }
  }

  // ── 4. emit_telemetry ────────────────────────────────────────────────────
  const salt = saltFromRanbvalToken(token);
  console.log('\n── 4. emitTelemetry()');
  await emitTelemetry({
    clientSalt: salt,
    modelUsed: 'ranbval.sdk.test',
    promptTokens: 10,
    completionTokens: 5,
    eventKind: 'sdk.test',
  });

  console.log('\n── Done.\n');
})();
