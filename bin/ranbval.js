#!/usr/bin/env node
'use strict';

// The published package ships only dist/, so resolve the bundled CLI when it exists (installed
// package) and fall back to source when running from a checkout.
let cli;
try {
  cli = require('../dist/cli.js');
} catch {
  cli = require('../src/cli');
}

cli
  .main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
