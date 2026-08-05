/**
 * Load configuration from layered `.ranbval*` files (dotenv-style, Ranbval-specific).
 *
 * Plaintext keys stay readable in the file. `ranbval.*` tokens stay encoded on disk;
 * decryption still happens only inside the SDK at runtime (see `crypto.safeDecrypt`).
 *
 * Call `loadRanbval()` explicitly after importing the package (no import-time side effects).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { RanbvalConfigError } = require('../exceptions');

/**
 * Which mode-specific file to merge: `development` | `production` | custom.
 *
 * Order: explicit `mode` arg → `RANBVAL_ENV` → `ENVIRONMENT` → `ENV` → `development`.
 *
 * @param {string|null|undefined} [mode]
 * @returns {string}
 */
function resolveRanbvalMode(mode) {
  if (mode != null && String(mode).trim()) {
    return String(mode).trim().toLowerCase();
  }
  for (const key of ['RANBVAL_ENV', 'ENVIRONMENT', 'ENV']) {
    const v = process.env[key];
    if (v && String(v).trim()) return String(v).trim().toLowerCase();
  }
  return 'development';
}

function _stripInlineComment(value) {
  const v = String(value).trim();
  if (!v.includes('#')) return v;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      return v.slice(0, i).trim().replace(/\s+$/, '');
    }
  }
  return v;
}

function _parseRanbvalFile(filePath) {
  const out = {};
  // utf-8-sig equivalent — strip BOM if present.
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return out;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.toLowerCase().startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = _stripInlineComment(line.slice(eq + 1));
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if (first === last && (first === '"' || first === "'")) {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}

function _layerPaths(directory, mode) {
  const m = (mode || 'development').toLowerCase().trim() || 'development';
  return [
    path.join(directory, '.ranbval'),
    path.join(directory, `.ranbval.${m}`),
    path.join(directory, '.ranbval.local'),
    path.join(directory, `.ranbval.${m}.local`),
  ].filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

const _TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** True if the file has a `*_PROJECT_SECRET=` line — the root key that unseals everything. */
function _fileHoldsProjectSecret(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#') || !stripped.includes('=')) continue;
    const name = stripped.split('=', 1)[0].trim().toUpperCase();
    if (name === 'RANBVAL_PROJECT_SECRET' || name.endsWith('_PROJECT_SECRET')) return true;
  }
  return false;
}

/**
 * True if git would track this file — i.e. it is NOT ignored.
 *
 * `git check-ignore -q` is the source of truth: exit 0 = ignored (safe), 1 = not ignored
 * (committable), anything else (128 = not a repo, or git missing) = no commit to leak into.
 * execFileSync throws on any non-zero exit, so we read `err.status`.
 */
function _gitWouldCommit(filePath) {
  const { execFileSync } = require('node:child_process');
  try {
    execFileSync('git', ['check-ignore', '-q', filePath], {
      cwd: path.dirname(filePath),
      stdio: 'ignore',
      timeout: 5000,
    });
    return false; // exit 0 → ignored → safe
  } catch (err) {
    return err && err.status === 1; // 1 → not ignored → committable; else no risk
  }
}

/**
 * Refuse to run if a file holding the project secret could be committed to git.
 *
 * The project secret is the root key that unseals every ranbval.* token. If the file carrying it
 * is not git-ignored, the whole vault is one `git add` from a public repo — the exact leak Ranbval
 * exists to prevent. `.ranbval` itself is safe to commit (only sealed tokens live there); this
 * fires only on the file that actually holds the secret. Override with
 * RANBVAL_ALLOW_COMMITTABLE_SECRET=1.
 */
function _assertSecretNotCommittable(paths) {
  const override = (process.env.RANBVAL_ALLOW_COMMITTABLE_SECRET || '').trim().toLowerCase();
  if (_TRUTHY.has(override)) return;
  const exposed = paths.filter((p) => _fileHoldsProjectSecret(p) && _gitWouldCommit(p));
  if (exposed.length === 0) return;
  const names = [...new Set(exposed.map((p) => path.basename(p)))].join(', ');
  const first = path.basename(exposed[0]);
  const err = new Error(
    `${names} holds your project secret but is NOT git-ignored — one \`git add\` from leaking ` +
      `the key that unseals every token. Fix it before anything else:\n` +
      `    echo '${first}' >> .gitignore\n` +
      `(.ranbval itself is safe to commit — only sealed tokens live there; this guard is about ` +
      `the file with the secret.) To override: RANBVAL_ALLOW_COMMITTABLE_SECRET=1`,
  );
  err.code = 'secret_file_committable';
  throw err;
}

/**
 * Nearest directory (cwd → parents) that contains `.ranbval` or any `.ranbval.*` file.
 *
 * @param {string|null} [start]
 * @returns {string|null}
 */
function findRanbvalDirectory(start) {
  let cur = path.resolve(start || process.cwd());
  while (true) {
    if (_isFile(path.join(cur, '.ranbval'))) return cur;
    let entries = [];
    try { entries = fs.readdirSync(cur); } catch { entries = []; }
    if (entries.some((name) => name.startsWith('.ranbval.') && _isFile(path.join(cur, name)))) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function _isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Path to base `.ranbval` if present, else the first existing layer file in the config root.
 *
 * @param {string|null} [start]
 * @returns {string|null}
 */
function findRanbvalFile(start) {
  const root = findRanbvalDirectory(start);
  if (!root) return null;
  const base = path.join(root, '.ranbval');
  if (_isFile(base)) return base;
  const layers = _layerPaths(root, resolveRanbvalMode(null));
  return layers[0] || null;
}

function _normalizeProjectName(name) {
  return String(name)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Load `KEY=value` pairs into `process.env`.
 *
 * Same semantics as the Python SDK's `load_ranbval`:
 *   .ranbval → .ranbval.{mode} → .ranbval.local → .ranbval.{mode}.local
 *   (later files override earlier ones for the same key)
 *
 * @param {string|null} [pathArg]
 * @param {{mode?: string|null, start?: string|null, override?: boolean,
 *          projectSecret?: string|null, projectName?: string|null}} [opts]
 * @returns {boolean} true if at least one file was read.
 */
/** Conventional suffixes for a committed template — its *_PROJECT_SECRET line is a placeholder. */
const TEMPLATE_SUFFIXES = ['.example', '.sample', '.template', '.dist'];

/** True if the file holds a `*_PROJECT_SECRET=` line — the root key that unseals everything. */
function fileHoldsProjectSecret(file) {
  if (TEMPLATE_SUFFIXES.some((suf) => file.toLowerCase().endsWith(suf))) return false;
  let text;
  try {
    text = require('node:fs').readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  return text.split(/\r?\n/).some((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) return false;
    const name = t.split('=')[0].trim().toUpperCase();
    return name === 'RANBVAL_PROJECT_SECRET' || name.endsWith('_PROJECT_SECRET');
  });
}

/**
 * Warn when the file holding the project secret is readable by other users on the machine.
 *
 * The project secret is the one value that cannot be encrypted, so on a shared box or a build
 * agent the file mode is the only thing between another account and the whole vault. A default
 * umask produces 0644. `ssh` refuses a private key in that state; this warns, because 0644 is
 * what the OS produces rather than something the user did wrong. RANBVAL_STRICT_FILE_MODE=1
 * makes it an error, which is the right setting for CI and production images.
 *
 * POSIX only — Windows does not express access this way.
 */
function checkSecretFileModes(files) {
  if (process.platform === 'win32') return;
  const fs = require('node:fs');
  const path = require('node:path');
  const offenders = [];
  for (const f of files) {
    if (!fileHoldsProjectSecret(f)) continue;
    let mode;
    try {
      mode = fs.statSync(f).mode & 0o777;
    } catch {
      continue;
    }
    if (mode & 0o077) offenders.push([f, mode]);
  }
  if (!offenders.length) return;

  const detail = offenders.map(([f, m]) => `${path.basename(f)} is ${m.toString(8).padStart(4, '0')}`).join(', ');
  const fix = offenders.map(([f]) => `chmod 600 ${path.basename(f)}`).join('; ');
  const message =
    `${detail} — your project secret is readable by other users on this machine, and that key ` +
    `unseals every token in .ranbval. Fix it with:\n    ${fix}\n` +
    '(Set RANBVAL_STRICT_FILE_MODE=1 to make this an error instead of a warning.)';

  const strict = String(process.env.RANBVAL_STRICT_FILE_MODE || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(strict)) {
    throw new RanbvalConfigError(`Ranbval: ${message}`, { code: 'secret_file_world_readable' });
  }
  process.emitWarning(`Ranbval: ${message}`);
}

function loadRanbval(pathArg, opts = {}) {
  const {
    mode = null,
    environment = null,
    start = null,
    override = false,
    projectSecret = null,
    projectName = null,
    remote = false,
    apiKey = null,
    host = null,
    guardStdout = true,
  } = opts || {};

  // Raise the output guard during load, the same as the Python SDK. `SecretString.use()` also
  // raises it, so a caller who never comes through here is still covered; this path exists so it
  // is up before anything at all, and so an explicit refusal can be recorded.
  {
    const guards = require('../crypto/outputGuards');
    if (guardStdout) guards.installOutputGuards();
    else guards.setOptedOut(true);
  }

  // Shared tail: apply the merged {key: value} into process.env, then the project secret / name and
  // the output guards. Used by BOTH the local-file and remote paths so they behave identically.
  const applyMerged = (merged) => {
    for (const [key, value] of Object.entries(merged)) {
      if (override || process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }

    if (projectSecret != null) {
      const ps = String(projectSecret).trim();
      if (override || !process.env.RANBVAL_PROJECT_SECRET) {
        process.env.RANBVAL_PROJECT_SECRET = ps;
      }
    }

    if (projectName != null) {
      const prefix = _normalizeProjectName(projectName);
      if (override || !process.env.RANBVAL_PROJECT_NAME) {
        process.env.RANBVAL_PROJECT_NAME = String(projectName);
      }
      if (override || !process.env.RANBVAL_PROJECT_PREFIX) {
        process.env.RANBVAL_PROJECT_PREFIX = prefix;
      }
    }

    return true;
  };

  // ── Remote: fetch the env-set from the control plane. fetch() is async, so this path returns a
  //    Promise<boolean> — use `await loadRanbval({ remote: true, ... })`. ──
  if (remote) {
    // Lazily required so the local path pulls in nothing network-related.
    const { fetchEnvSet } = require('../remote/client');
    return fetchEnvSet({
      projectSecret,
      apiKey,
      environment: environment != null ? environment : mode,
      host,
    }).then((merged) => applyMerged(merged));
  }

  // ── Local files (synchronous). ──
  let merged = {};
  if (pathArg) {
    if (!_isFile(pathArg)) return false;
    _assertSecretNotCommittable([pathArg]);
    merged = _parseRanbvalFile(pathArg);
  } else {
    const root = findRanbvalDirectory(start);
    if (!root) return false;
    // `mode` is the older name; `environment` is preferred. mode wins if both are given, matching
    // the Python SDK.
    const m = resolveRanbvalMode(mode != null ? mode : environment);
    const layers = _layerPaths(root, m);
    checkSecretFileModes(layers);
    if (layers.length === 0) return false;
    // Before anything else: if a file holding the project secret is committable, stop.
    _assertSecretNotCommittable(layers);
    for (const lp of layers) {
      Object.assign(merged, _parseRanbvalFile(lp));
    }
  }

  return applyMerged(merged);
}

/**
 * Return the value of `envVar` after verifying it belongs to the loaded project.
 *
 * If `RANBVAL_PROJECT_PREFIX` is set (via `loadRanbval({ projectName })`), the
 * env var **must** start with that prefix — otherwise an Error is thrown so
 * cross-project mix-ups are caught immediately.
 *
 * @param {string} envVar
 * @returns {string}
 */
function getProjectKey(envVar) {
  const prefix = process.env.RANBVAL_PROJECT_PREFIX || '';
  if (prefix && !String(envVar).toUpperCase().startsWith(prefix + '_')) {
    const projectName = process.env.RANBVAL_PROJECT_NAME || prefix;
    throw new Error(
      `Key '${envVar}' does not belong to project '${projectName}' ` +
      `(expected prefix '${prefix}_'). ` +
      'Pass the correct projectName to loadRanbval() or use the right .ranbval file.',
    );
  }
  const value = process.env[envVar] || '';
  if (!value) {
    throw new Error(
      `Environment variable '${envVar}' is not set. ` +
      'Check your .ranbval file or loadRanbval() call.',
    );
  }
  return value;
}

module.exports = {
  // Underscored: internal, but the CLI's `check` needs to read a file without loading it into the
  // environment — the same split ranbval_sdk.cli.check makes on the Python side.
  _parseRanbvalFile,
  resolveRanbvalMode,
  findRanbvalDirectory,
  findRanbvalFile,
  loadRanbval,
  getProjectKey,
};
