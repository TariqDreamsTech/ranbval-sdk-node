/**
 * The `ranbval` command-line tool — scaffold, lint, and run with your `.ranbval` config.
 *
 *     ranbval init            create a starter .ranbval and gitignore .ranbval.local
 *     ranbval check           lint .ranbval: classification, competing loaders, value mismatches
 *     ranbval run -- CMD …    load .ranbval into the environment, then exec CMD
 *
 * Every command is offline — no network — and none ever prints a secret value. Each lives in its
 * own module; this file only routes to them. Dependency-free: a hand-rolled parser, no commander.
 *
 * Mirrors ranbval_sdk.cli.
 */

'use strict';

const check = require('./check');
const init = require('./init');
const run = require('./run');

const USAGE = `ranbval — Ranbval config CLI

Usage:
  ranbval init [--force]        create a starter .ranbval and gitignore .ranbval.local
  ranbval check                 lint .ranbval (classification, clashes, mismatches)
  ranbval run [--] <cmd> …      load .ranbval into the environment, then run a command
`;

/**
 * @param {string[]} [argv]  defaults to the real process arguments
 * @returns {Promise<number>} process exit code
 */
async function main(argv) {
  const args = argv || process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '-h' || cmd === '--help') {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }

  switch (cmd) {
    case 'init':
      return init.handle({ force: args.includes('--force') });

    case 'check':
      return check.handle();

    case 'run': {
      // Everything after `run` is the command, with an optional `--` separator that argparse-style
      // callers expect. Only the first `--` is a separator; later ones belong to the command.
      let rest = args.slice(1);
      if (rest[0] === '--') rest = rest.slice(1);
      return run.handle({ command: rest });
    }

    default:
      process.stderr.write(color(`Unknown command: ${cmd}\n\n`, 'red') + USAGE);
      return 2;
  }
}

const { color } = require('./_shared');

module.exports = { main, USAGE };
