/**
 * The project secret must never be committable to git.
 *
 * The project secret is the root key that unseals every ranbval.* token. A committed `.ranbval` is
 * safe because it holds only sealed tokens — but if the file carrying the KEY is not git-ignored,
 * the vault is one `git add` from a public repo. loadRanbval refuses to run until it is ignored.
 *
 * Run:  node --test test/secretGuard.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { loadRanbval } = require('../src');

function makeRepo({ git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-guard-'));
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  }
  fs.writeFileSync(path.join(dir, '.ranbval'), 'SECRET_X=ranbval.abc123def4.blob.ahsan\n');
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('a secret file that is not git-ignored is refused', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.ranbval.local'), 'RANBVAL_PROJECT_SECRET=ranbval-proj-x\n');
  try {
    assert.throws(() => loadRanbval(null, { start: dir }), /git-ignored/);
  } finally {
    cleanup(dir);
  }
});

test('a git-ignored secret file loads fine', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.ranbval.local'), 'RANBVAL_PROJECT_SECRET=ranbval-proj-x\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.ranbval.local\n');
  try {
    assert.equal(loadRanbval(null, { start: dir }), true);
  } finally {
    cleanup(dir);
  }
});

test('a secret in the committed .ranbval is refused', () => {
  const dir = makeRepo();
  fs.writeFileSync(
    path.join(dir, '.ranbval'),
    'RANBVAL_PROJECT_SECRET=oops\nSECRET_X=ranbval.abc123def4.blob.ahsan\n',
  );
  try {
    assert.throws(() => loadRanbval(null, { start: dir }), /\.ranbval/);
  } finally {
    cleanup(dir);
  }
});

test('outside a git repo there is no commit risk', () => {
  const dir = makeRepo({ git: false });
  fs.writeFileSync(path.join(dir, '.ranbval.local'), 'RANBVAL_PROJECT_SECRET=ranbval-proj-x\n');
  try {
    assert.equal(loadRanbval(null, { start: dir }), true);
  } finally {
    cleanup(dir);
  }
});

test('RANBVAL_ALLOW_COMMITTABLE_SECRET=1 overrides the guard', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.ranbval.local'), 'RANBVAL_PROJECT_SECRET=ranbval-proj-x\n');
  process.env.RANBVAL_ALLOW_COMMITTABLE_SECRET = '1';
  try {
    assert.equal(loadRanbval(null, { start: dir }), true);
  } finally {
    delete process.env.RANBVAL_ALLOW_COMMITTABLE_SECRET;
    cleanup(dir);
  }
});
