# Changelog

All notable changes to `ranbval-sdk` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.13.0] - 2026-07-18

- **Commit-safety guard.** `loadRanbval()` refuses to run when a file holding the project secret is
  not git-ignored (`RanbvalConfigError` / `code: secret_file_committable`) — the root key must never
  be one `git add` from a public repo. Catches an un-ignored `.ranbval.local` and a secret line
  accidentally left in the committed `.ranbval`. Silent outside a git repo. Override with
  `RANBVAL_ALLOW_COMMITTABLE_SECRET=1`.

## [0.12.0] - 2026-07-17

Parity with the Python SDK's remote features.

- **`fetchEnvSet()` / `pushEnv()`** — pull a project's env-set from the control plane, and add
  `PUBLIC_` config, authenticated by the project secret (owner) or a `ranbval-dev-…` developer
  token. A developer can pull sealed `SECRET_`/`PROXY_` tokens and add `PUBLIC_` values, but cannot
  decrypt without the project secret; creating `SECRET_`/`PROXY_` keys stays owner-only.
- **`loadRanbval({ remote: true, environment, apiKey, host })`** — load config from the control
  plane instead of local files. The remote path is async (returns a `Promise`).
- **`environment`** option on `loadRanbval` selects the stage for local files too, not just remote
  (`mode` remains the older alias). Up to 10 named environments per project; each holds its own
  value for the same variable name, and only the requested stage is fetched.
- **`isPublic()` / `isSecret()` / `isProxy()` / `kindOf()` / `isExempt()`** — prefix classification
  helpers, matching `ranbval_sdk.config.manifest`.

## [0.11.0] - 2026-07-13

### Changed
- **Default API host moved to `https://api.secret.ranbval.com`** (was `https://api.ranbval.com`).
  The Ranbval Secret Manager now lives under the `secret.ranbval.com` namespace. Override with
  `RANBVAL_HOST` if needed.

## [Unreleased]

---

## [0.9.0] — 2024-12-01

### Changed
- Promoted to stable release. No breaking changes from `0.8.x`.
- Completed API documentation and README overhaul.
- Finalized `package.json` metadata for npm publication: `funding`, `exports`, and `homepage` fields added.

### Fixed
- Edge case where `loadRanbval` would throw instead of silently skipping a missing `.ranbval.{mode}` layer file.

---

## [0.8.2] — 2024-11-08

### Fixed
- Backward-compat parser for legacy 5-part token format now handles tokens that include a padding character in part 3.

## [0.8.1] — 2024-10-29

### Fixed
- `getProjectKey` returned `undefined` instead of throwing when no matching secret could be found in any layer.

## [0.8.0] — 2024-10-15

### Added
- `getProjectKey(projectName)` — resolves a project secret by name across all loaded env layers.
- Backward-compat parsing for the legacy 5-part vault token format used in projects created before `0.4.0`. Tokens in the old format are silently upgraded during decryption.

### Changed
- `loadRanbval` now normalizes project name casing before env var lookup (e.g. `MyApp` and `MYAPP` resolve to the same prefix).
- PBKDF2 iteration count increased to 210,000 (OWASP 2023 recommendation). Tokens encrypted with the old count are still readable; new tokens use the higher count.

---

## [0.7.1] — 2024-09-20

### Fixed
- Project name normalization stripped numeric characters, causing lookups to fail for names like `service2`.

## [0.7.0] — 2024-09-05

### Added
- `getProjectKey(projectName)` export (initial implementation, superseded in `0.8.0`).
- Project name normalization: leading/trailing whitespace and hyphens are stripped before env var prefix construction.

### Changed
- `findRanbvalDirectory` now walks up to the filesystem root rather than stopping at a fixed depth of 5 directories.

---

## [0.6.1] — 2024-08-14

### Fixed
- `SecretString[Symbol.dispose]` was not exported correctly; `using` declarations in TypeScript would not call `wipe()` at block exit.

## [0.6.0] — 2024-08-01

### Added
- `SecretString` now implements `[Symbol.dispose]`, enabling explicit resource management with `using` / `await using` in environments that support the TC39 proposal.
- TTL token support: vault tokens can carry an expiry timestamp; `safeDecrypt` throws if the token has expired at the time of decryption.
- `saltFromRanbvalToken(token)` — extract the non-reversible salt from a token without decrypting it (used by telemetry).

---

## [0.5.2] — 2024-07-10

### Fixed
- `assertRepoAllowedForDecryptAsync` would swallow network errors instead of re-throwing them, making misconfigured `RANBVAL_HOST` values hard to diagnose.

## [0.5.1] — 2024-06-28

### Fixed
- `normalizeGitRemoteUrl` failed to strip the `.git` suffix from SSH remote URLs using the `git@host:org/repo.git` form.

## [0.5.0] — 2024-06-15

### Added
- `assertRepoAllowedForDecrypt()` — synchronous repo allowlist check using `RANBVAL_ALLOWED_REPOS` (comma-separated, no network call).
- `assertRepoAllowedForDecryptAsync(opts)` — async variant that fetches the allowlist from the Ranbval API.
- `fetchRepoPolicy(opts)` — low-level helper to retrieve the raw policy object for a project.
- `normalizeGitRemoteUrl(url)` — normalizes SSH and HTTPS git remote URLs to a canonical `host/org/repo` form.
- `getGitRemoteOrigin()` — reads the `origin` remote from the current repo via a `git remote get-url` subprocess call.
- `RANBVAL_SKIP_REPO_CHECK=1` environment variable to bypass allowlist enforcement.

---

## [0.4.1] — 2024-05-22

### Fixed
- `buildSecureClient` did not forward extra constructor arguments when the SDK class constructor expected positional parameters rather than an options object.

## [0.4.0] — 2024-05-10

### Added
- `secureClient(SDKClass, opts)` — wraps an SDK instance so that the API key is decrypted and injected just-in-time on each method call.
- `buildSecureClient(SDKClass, envVarName, keyKwarg, methodPathToPatch?)` — returns a subclass with key injection baked in, suitable for export from a shared module.

---

## [0.3.2] — 2024-04-18

### Fixed
- Prefix discovery in `decryptKey` failed when the env var name contained more than two underscore-separated segments (e.g. `MYAPP_SERVICE_API_KEY`).

## [0.3.1] — 2024-04-05

### Fixed
- `resolveRanbvalMode` did not check `ENV` as a final fallback; only `RANBVAL_ENV` and `ENVIRONMENT` were consulted.

## [0.3.0] — 2024-03-22

### Added
- `decryptKey(envVar)` — high-level helper that reads a vault token from `process.env` and auto-discovers the matching project secret from the env var name prefix (e.g. `MYAPP_OPENAI_KEY` → `MYAPP_PROJECT_SECRET`).
- `RANBVAL_PROJECT_SECRET` environment variable as a global fallback when prefix-based discovery finds no matching project secret.

---

## [0.2.2] — 2024-03-01

### Fixed
- `proxyRequest` did not forward `Content-Type: application/json` automatically when a `body` object was provided, causing some APIs to reject the request.

## [0.2.1] — 2024-02-16

### Fixed
- `emitTelemetry` threw an unhandled promise rejection on DNS failures instead of silently swallowing the error as documented.

## [0.2.0] — 2024-02-05

### Added
- `proxyRequest(opts)` — sends a request through the Ranbval proxy, injecting a decrypted vault token as a bearer token, header, body field, or query parameter.
- `ProxyError` — error class thrown by `proxyRequest` on non-2xx responses; exposes `.status` and `.body`.
- `emitTelemetry(opts)` — fire-and-forget usage event emission. Respects `RANBVAL_TELEMETRY=0` to disable silently and `RANBVAL_TELEMETRY_DEBUG=1` to surface failures.

---

## [0.1.1] — 2024-01-20

### Fixed
- `loadRanbval` did not skip `.ranbval.{mode}` files when `mode` resolved to an empty string, causing an attempt to read a file literally named `.ranbval.`.

## [0.1.0] — 2024-01-10

### Added
- Initial release.
- `safeDecrypt(token, projectSecret)` — AES-256-GCM decryption of a vault token using a PBKDF2-derived key.
- `deriveKey(secret, salt)` — low-level PBKDF2-SHA256 key derivation.
- `SecretString` — wrapper that prevents accidental logging of plaintext secrets; exposes `.use()`, `.wipe()`, `.length`, and `.label`.
- `loadRanbval(path?, options?)` — loads `.ranbval` and layered variants (`.ranbval.{mode}`, `.ranbval.local`, `.ranbval.{mode}.local`) into `process.env`.
- `findRanbvalDirectory(start)` and `findRanbvalFile(start)` — walk parent directories to locate the nearest `.ranbval` file.
- `resolveRanbvalMode()` — resolves the active mode from `RANBVAL_ENV`, `ENVIRONMENT`, or `ENV`.
