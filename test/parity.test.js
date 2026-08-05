/**
 * Parity with the Python SDK for the controls added in its 3.7.0–4.2.0 line.
 *
 * Each of these was missing here while the README claimed "full parity on the same .ranbval
 * format". The output guard was the starkest: it existed, was documented, and blocked nothing —
 * measured at 0 of 9 spellings before this work.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const R = require('../src/index.js');
const guards = require('../src/crypto/outputGuards');
const reveal = require('../src/config/reveal');
const { assertSafeUrl } = require('../src/_internal/transport');
const { SecretString } = require('../src/crypto/secretString');

const SECRET = 'sk-live-a-long-enough-secret-value';

function fresh() {
  guards.uninstallOutputGuards();
  guards.setOptedOut(false);
  reveal.clearRevealRequirements();
}

test('output guard: installs itself at the first reveal', () => {
  fresh();
  assert.equal(guards._state().installed, false);
  new SecretString(SECRET, 'T').use();
  assert.equal(guards._state().installed, true);
  fresh();
});

test('output guard: the value that triggered the install is itself registered', () => {
  // Otherwise the very first secret — the one most likely to be logged while debugging — would
  // be the one value the guard could not recognise.
  fresh();
  const v = new SecretString(SECRET, 'T').use();
  assert.throws(() => console.log(`${v}`), { name: 'PermissionError' });
  fresh();
});

test('output guard: every interpolation path is blocked', () => {
  fresh();
  const v = new SecretString(SECRET, 'T').use();
  const paths = [
    () => console.log(v),
    () => console.log(`${v}`),
    () => console.log('k=' + v),
    () => console.error(`${v}`),
    () => console.warn(`${v}`),
    () => console.log(String(v)),
    () => console.log({ key: `${v}` }),
    () => process.stdout.write(`${v}`),
    () => process.stderr.write(`${v}`),
  ];
  for (const p of paths) assert.throws(p, { name: 'PermissionError' });
  fresh();
});

test('output guard: ordinary output and header building still work', () => {
  fresh();
  const v = new SecretString(SECRET, 'T').use();
  assert.doesNotThrow(() => console.log('nothing secret here'));
  assert.equal(`Bearer ${v}`.length, 'Bearer '.length + SECRET.length);
  fresh();
});

test('output guard: an explicit opt-out is not undone by the next decrypt', () => {
  fresh();
  guards.setOptedOut(true);
  new SecretString(SECRET, 'T').use();
  assert.equal(guards._state().installed, false);
  fresh();
});

test('output guard: uninstalling counts as opting out', () => {
  fresh();
  new SecretString(SECRET, 'T').use();
  assert.equal(guards._state().installed, true);
  guards.uninstallOutputGuards();
  new SecretString(SECRET, 'T').use();
  assert.equal(guards._state().installed, false, 'must not silently reinstall');
  fresh();
});

test('enforcementScope restores the previous setting, including on throw', () => {
  assert.equal(R.isEnforced(), true);
  R.enforcementScope(false, () => assert.equal(R.isEnforced(), false));
  assert.equal(R.isEnforced(), true);

  assert.throws(() => R.enforcementScope(false, () => { throw new Error('boom'); }), /boom/);
  assert.equal(R.isEnforced(), true, 'restored even when the callback throws');
});

test('reveal scope: .use() is refused outside an approved block', () => {
  fresh();
  reveal.requireRevealScope('DB');
  const s = new SecretString(SECRET, 'DB');
  assert.throws(() => s.use(), { code: 'reveal_out_of_scope' });
  assert.doesNotThrow(() => reveal.revealScope('DB', () => s.use()));
  fresh();
});

test('transport: only http(s) URLs are opened', () => {
  // Node's fetch already refuses file: and ftp:, but it accepts data: — and the host comes from
  // configuration, so a data: URL would let whoever set it choose the response.
  for (const ok of ['https://x.example/a', 'http://127.0.0.1:8000/a']) {
    assert.equal(assertSafeUrl(ok), ok);
  }
  for (const bad of ['data:application/json,{}', 'file:///etc/passwd', 'ftp://x/']) {
    assert.throws(() => assertSafeUrl(bad), { code: 'disallowed_url_scheme' });
  }
});

test('repo allowlist has no client-side skip', () => {
  // The flag used to short-circuit both paths, and the sync path returned early besides — so
  // safeDecrypt performed no check at all. Asserted here so it cannot come back quietly.
  const src = require('node:fs').readFileSync(require.resolve('../src/policy/repo.js'), 'utf8');
  const active = src
    .split('\n')
    .filter((l) => l.includes('SKIP_REPO_CHECK') && !l.trim().startsWith('*'));
  assert.deepEqual(active, [], 'no live reference to a skip flag');
});
