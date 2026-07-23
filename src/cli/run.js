/**
 * `ranbval run -- CMD …` — load `.ranbval` into the environment, then exec CMD.
 *
 * Secrets live only in this process and the child it spawns; nothing is written to disk and no
 * value is printed. This is the "no code change" adoption path: put PUBLIC_/SECRET_ names in
 * `.ranbval` and prefix the existing start command with `ranbval run --`.
 *
 * Mirrors ranbval_sdk.cli.run.
 */

'use strict';

const { spawn } = require('child_process');
const { color } = require('./_shared');
const { loadRanbval } = require('../config/loader');

function handle(args) {
  const command = args.command || [];
  if (!command.length) {
    console.log(color('✗ nothing to run. Usage: ranbval run -- <command> [args…]', 'red'));
    return 1;
  }

  try {
    // Populates process.env for the child. SECRET_/PROXY_ values remain encrypted tokens here —
    // this does not decrypt them; the child's own decryptKey() call does, at the point of use.
    loadRanbval();
  } catch (e) {
    console.log(color(`✗ could not load .ranbval: ${e.message}`, 'red'));
    return 1;
  }

  // The child inherits this process's environment, so it sees everything loadRanbval() set. stdio
  // is inherited so the wrapper is transparent — the command behaves as if run directly.
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: process.env });

  // Return the child's own exit status: a CI step wrapped in `ranbval run --` must still fail when
  // the wrapped command fails, and a signal is reported the way a shell reports it (128 + signum).
  return new Promise((resolve) => {
    child.on('error', (err) => {
      console.log(color(`✗ could not start ${command[0]}: ${err.message}`, 'red'));
      resolve(127);
    });
    child.on('exit', (code, signal) => {
      resolve(signal ? 128 + (require('os').constants.signals[signal] || 0) : code ?? 0);
    });
  });
}

module.exports = { handle };
