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
function loadRanbval(pathArg, opts = {}) {
  const {
    mode = null,
    start = null,
    override = false,
    projectSecret = null,
    projectName = null,
  } = opts || {};

  let merged = {};
  if (pathArg) {
    if (!_isFile(pathArg)) return false;
    merged = _parseRanbvalFile(pathArg);
  } else {
    const root = findRanbvalDirectory(start);
    if (!root) return false;
    const m = resolveRanbvalMode(mode);
    const layers = _layerPaths(root, m);
    if (layers.length === 0) return false;
    for (const lp of layers) {
      Object.assign(merged, _parseRanbvalFile(lp));
    }
  }

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
  resolveRanbvalMode,
  findRanbvalDirectory,
  findRanbvalFile,
  loadRanbval,
  getProjectKey,
};
