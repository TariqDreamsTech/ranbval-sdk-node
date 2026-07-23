/**
 * `ranbval check` — lint `.ranbval`: classification, competing loaders, value mismatches.
 *
 * Reads the file; never loads it into the environment and never prints a value. A misclassified
 * variable is the failure this catches: a key marked PUBLIC_ is stored in plaintext, so finding out
 * at review time rather than after it ships is the whole point.
 *
 * Mirrors ranbval_sdk.cli.check.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { color } = require('./_shared');
const { findRanbvalDirectory, _parseRanbvalFile } = require('../config/loader');
const manifest = require('../config/manifest');

//: Loading config twice means the last one wins, silently. Worth naming when we see it.
const _COMPETING_LOADERS = { dotenv: 'dotenv', 'dotenv-flow': 'dotenv-flow', 'env-cmd': 'env-cmd' };

function handle() {
  const root = findRanbvalDirectory();
  if (!root) {
    console.log(color('✗ no .ranbval file found (run `ranbval init`).', 'red'));
    return 1;
  }

  const base = path.join(root, '.ranbval');
  let values = {};
  try {
    values = fs.existsSync(base) ? _parseRanbvalFile(base) : {};
  } catch (e) {
    console.log(color(`✗ ${e.message}`, 'red'));
    return 1;
  }

  const errors = [];
  const warnings = [];
  const counts = { public: 0, secret: 0, proxy: 0 };

  for (const name of Object.keys(values).sort()) {
    const value = values[name];
    const kind = manifest.kindOf(name);
    if (!kind) {
      if (manifest.isExempt(name)) continue;
      errors.push(`${name}: no class prefix (PUBLIC_/SECRET_/PROXY_)`);
      continue;
    }
    counts[kind] += 1;
    const isToken = String(value || '').startsWith('ranbval.');
    if (kind === 'public' && isToken) {
      warnings.push(`${name}: PUBLIC_ but value is an encrypted token — rename to SECRET_/PROXY_`);
    } else if ((kind === 'secret' || kind === 'proxy') && value && !isToken) {
      warnings.push(`${name}: ${kind.toUpperCase()}_ but value is plaintext (not a ranbval.* token)`);
    }
  }

  const competing = fs
    .readdirSync(root)
    .filter((f) => f.startsWith('.env') && fs.statSync(path.join(root, f)).isFile())
    .sort();
  if (competing.length) {
    errors.push(`competing env file(s) next to .ranbval: ${competing.join(', ')}`);
  }

  const loaded = Object.entries(_COMPETING_LOADERS)
    .filter(([mod]) => {
      try {
        return Boolean(require.cache[require.resolve(mod, { paths: [root] })]);
      } catch {
        return false;
      }
    })
    .map(([, pkg]) => pkg)
    .sort();
  if (loaded.length) {
    warnings.push(`non-Ranbval env loader loaded: ${loaded.join(', ')}`);
  }

  console.log(
    `${color('classified', 'dim')}: ` +
      `${counts.public} public, ${counts.secret} secret, ${counts.proxy} proxy`,
  );
  for (const w of warnings) console.log(color(`⚠ ${w}`, 'yellow'));
  for (const e of errors) console.log(color(`✗ ${e}`, 'red'));
  if (errors.length) {
    console.log(color(`\n${errors.length} error(s).`, 'red'));
    return 1;
  }
  console.log(color('\n✓ all variables classified.', 'green'));
  return 0;
}

module.exports = { handle };
