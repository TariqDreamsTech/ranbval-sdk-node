/**
 * Shared rendering for the `ranbval` CLI: terminal colours and the `.ranbval` template.
 *
 * Mirrors ranbval_sdk.cli._shared.
 */

'use strict';

const _ANSI = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m' };
const _RESET = '\x1b[0m';

/** Wrap text in an ANSI colour when stdout is a TTY, else return it plain (so pipes stay clean). */
function color(text, kind) {
  const code = _ANSI[kind] || '';
  return code && process.stdout.isTTY ? `${code}${text}${_RESET}` : text;
}

const TEMPLATE = `# .ranbval — Ranbval configuration. Every variable must start with a class prefix:
#   PUBLIC_  plaintext config (public() reads it)
#   SECRET_  encrypted; decryptKey("SECRET_…").use() reveals it locally
#   PROXY_   encrypted; plaintext never on the client — proxyRequest() sends it through the proxy
# RANBVAL_* and *_PROJECT_SECRET are exempt (infrastructure).

# Keep the project secret in .ranbval.local (git-ignored), not here.
# RANBVAL_PROJECT_SECRET=ranbval-proj-xxxx

PUBLIC_APP_NAME=my-app
# SECRET_OPENAI_KEY=ranbval.xxxx.blob.ahsan     # paste a token from the Ranbval dashboard
# PROXY_STRIPE_KEY=ranbval.yyyy.blob.ahsan
`;

module.exports = { color, TEMPLATE };
