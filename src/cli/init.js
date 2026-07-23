/**
 * `ranbval init` — scaffold a starter `.ranbval` and gitignore `.ranbval.local`.
 *
 * Mirrors ranbval_sdk.cli.init.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { color, TEMPLATE } = require('./_shared');

function handle(args) {
  const target = path.resolve(process.cwd(), '.ranbval');

  if (fs.existsSync(target) && !args.force) {
    console.log(color(`✗ ${path.basename(target)} already exists (use --force to overwrite).`, 'red'));
    return 1;
  }
  fs.writeFileSync(target, TEMPLATE, 'utf8');
  console.log(color(`✓ wrote ${path.basename(target)}`, 'green'));

  // The project secret goes in .ranbval.local, which is worthless to anyone unless it is kept out
  // of the repository — so the ignore entry is written at the same moment the file is suggested,
  // not left as a step for the reader to remember.
  const gitignore = path.resolve(process.cwd(), '.gitignore');
  const entry = '.ranbval.local';
  let lines = [];
  try {
    lines = fs.readFileSync(gitignore, 'utf8').split('\n');
  } catch {
    // No .gitignore yet — creating one is exactly the right outcome here.
  }
  if (!lines.some((l) => l.trim() === entry)) {
    const body = lines.length && lines[lines.length - 1].trim() !== '' ? '\n' : '';
    fs.appendFileSync(gitignore, `${body}${entry}\n`, 'utf8');
    console.log(color(`✓ added ${entry} to .gitignore`, 'green'));
  }
  return 0;
}

module.exports = { handle };
