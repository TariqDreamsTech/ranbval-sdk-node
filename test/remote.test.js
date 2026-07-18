/**
 * Remote config + prefix classification — parity with the Python SDK.
 *
 * Network calls are exercised against a stub `fetch`, so this runs offline and deterministically.
 *
 * Run:  node --test test/remote.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isPublic, isSecret, isProxy, kindOf, isExempt, fetchEnvSet, pushEnv } = require('../src');

// ── classification ──────────────────────────────────────────────────────────

test('prefix classification matches the Python SDK', () => {
  assert.equal(isPublic('PUBLIC_DATABASE_URL'), true);
  assert.equal(isSecret('SECRET_OPENAI_KEY'), true);
  assert.equal(isProxy('PROXY_STRIPE_KEY'), true);

  assert.equal(isSecret('PUBLIC_X'), false);
  assert.equal(isProxy('SECRET_X'), false);

  assert.equal(kindOf('secret_lowercase_ok'), 'secret'); // case-insensitive
  assert.equal(kindOf('DATABASE_URL'), null); // unclassified

  assert.equal(isExempt('RANBVAL_PROJECT_SECRET'), true);
  assert.equal(isExempt('MYAPP_PROJECT_SECRET'), true);
  assert.equal(isExempt('SECRET_X'), false);
});

// ── remote fetch ─────────────────────────────────────────────────────────────

function withStubFetch(handler, run) {
  const original = global.fetch;
  global.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = original;
    });
}

const okJson = (obj) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(obj),
});

test('fetchEnvSet posts the credential + environment and shapes the response', async () => {
  let captured;
  await withStubFetch(
    async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return okJson({
        envs: [
          { name: 'SECRET_OPENAI_KEY', value: 'ranbval.abc.def.ahsan' },
          { name: 'PUBLIC_DATABASE_URL', value: 'postgres://prod' },
          { name: '', value: 'dropped' }, // nameless entries are ignored
        ],
      });
    },
    async () => {
      const envs = await fetchEnvSet({
        projectSecret: 'ranbval-proj-abc',
        environment: 'Production',
      });
      assert.match(captured.url, /\/api\/envs\/pull$/);
      assert.equal(captured.body.project_secret, 'ranbval-proj-abc');
      assert.equal(captured.body.environment, 'production'); // lowercased
      assert.deepEqual(envs, {
        SECRET_OPENAI_KEY: 'ranbval.abc.def.ahsan',
        PUBLIC_DATABASE_URL: 'postgres://prod',
      });
    },
  );
});

test('a developer token authenticates as api_key, not project_secret', async () => {
  let body;
  await withStubFetch(
    async (_url, init) => {
      body = JSON.parse(init.body);
      return okJson({ envs: [] });
    },
    async () => {
      await fetchEnvSet({ apiKey: 'ranbval-dev-xyz' });
      assert.equal(body.api_key, 'ranbval-dev-xyz');
      assert.equal(body.project_secret, undefined);
    },
  );
});

test('remote with no credential throws before any network call', async () => {
  let called = false;
  await withStubFetch(
    async () => {
      called = true;
      return okJson({ envs: [] });
    },
    async () => {
      await assert.rejects(() => fetchEnvSet({}), /projectSecret .* or apiKey/);
      assert.equal(called, false);
    },
  );
});

test('a 403 surfaces as an invalid-credential error', async () => {
  await withStubFetch(
    async () => ({ ok: false, status: 403, text: async () => '{}' }),
    async () => {
      await assert.rejects(
        () => fetchEnvSet({ projectSecret: 'wrong' }),
        /Invalid credential/,
      );
    },
  );
});

test('pushEnv posts name + value + credential to /envs/add', async () => {
  let captured;
  await withStubFetch(
    async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return okJson({ name: 'PUBLIC_FLAG', kind: 'public', added_by: 'dev' });
    },
    async () => {
      const res = await pushEnv('PUBLIC_FLAG', 'on', { apiKey: 'ranbval-dev-xyz', environment: 'staging' });
      assert.match(captured.url, /\/api\/envs\/add$/);
      assert.equal(captured.body.name, 'PUBLIC_FLAG');
      assert.equal(captured.body.value, 'on');
      assert.equal(captured.body.environment, 'staging');
      assert.equal(res.added_by, 'dev');
    },
  );
});
