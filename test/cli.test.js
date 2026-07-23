/**
 * The `ranbval` CLI — init, check, run.
 *
 * Each command is driven through cli.main() in a throwaway temp directory, so nothing touches the
 * developer's own files. `run` is exercised by spawning a tiny node child, the same path it uses in
 * production.
 *
 * Run:  node --test test/cli.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = require('../src/cli');

/** Run `fn` with the process cwd moved to a fresh temp dir, restored afterwards. */
function inTempDir(fn) {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ranbval-cli-'));
  process.chdir(dir);
  return Promise.resolve(fn(dir)).finally(() => {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Capture stdout for the duration of `fn`. */
function capture(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = (chunk) => {
    out += chunk;
    return true;
  };
  return Promise.resolve(fn()).then((r) => {
    process.stdout.write = orig;
    return { result: r, out };
  }, (e) => {
    process.stdout.write = orig;
    throw e;
  });
}

test('init writes a .ranbval and gitignores .ranbval.local', () =>
  inTempDir(async () => {
    const code = await cli.main(['init']);
    assert.equal(code, 0);
    assert.ok(fs.existsSync('.ranbval'));
    assert.match(fs.readFileSync('.gitignore', 'utf8'), /\.ranbval\.local/);
  }));

test('init refuses to clobber an existing file without --force', () =>
  inTempDir(async () => {
    await cli.main(['init']);
    fs.writeFileSync('.ranbval', 'PUBLIC_MINE=keep');
    const code = await cli.main(['init']);
    assert.equal(code, 1);
    assert.equal(fs.readFileSync('.ranbval', 'utf8'), 'PUBLIC_MINE=keep', 'must not overwrite');
  }));

test('init --force overwrites', () =>
  inTempDir(async () => {
    fs.writeFileSync('.ranbval', 'PUBLIC_OLD=x');
    const code = await cli.main(['init', '--force']);
    assert.equal(code, 0);
    assert.match(fs.readFileSync('.ranbval', 'utf8'), /class prefix/);
  }));

test('check passes a well-classified file', () =>
  inTempDir(async () => {
    fs.writeFileSync('.ranbval', 'PUBLIC_APP=hi\nSECRET_KEY=ranbval.a.b.c\n');
    const { result, out } = await capture(() => cli.main(['check']));
    assert.equal(result, 0);
    assert.match(out, /1 public, 1 secret/);
  }));

test('check fails an unclassified variable', () =>
  inTempDir(async () => {
    fs.writeFileSync('.ranbval', 'NO_PREFIX=oops\n');
    const { result, out } = await capture(() => cli.main(['check']));
    assert.equal(result, 1);
    assert.match(out, /no class prefix/);
  }));

test('check warns when a SECRET_ holds plaintext', () =>
  inTempDir(async () => {
    fs.writeFileSync('.ranbval', 'SECRET_KEY=this-is-not-a-token\n');
    const { out } = await capture(() => cli.main(['check']));
    assert.match(out, /plaintext/);
  }));

test('run loads .ranbval into the child environment', () =>
  inTempDir(async () => {
    fs.writeFileSync('.ranbval', 'PUBLIC_GREETING=hello-child\n');
    const code = await cli.main([
      'run', '--', process.execPath, '-e',
      'process.exit(process.env.PUBLIC_GREETING === "hello-child" ? 0 : 3)',
    ]);
    assert.equal(code, 0, 'the child should see PUBLIC_GREETING from .ranbval');
  }));

test('run returns the child exit code', () =>
  inTempDir(async () => {
    fs.writeFileSync('.ranbval', 'PUBLIC_X=1\n');
    const code = await cli.main(['run', '--', process.execPath, '-e', 'process.exit(7)']);
    assert.equal(code, 7);
  }));

test('run with no command is an error', () =>
  inTempDir(async () => {
    fs.writeFileSync('.ranbval', 'PUBLIC_X=1\n');
    const code = await cli.main(['run']);
    assert.equal(code, 1);
  }));
