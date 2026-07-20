/**
 * What the SDK knows about the customer's plan — and what it deliberately does not do with it.
 *
 * The design constraint worth restating: this SDK runs on the customer's machine. Any limit it
 * checked locally is a limit they could delete, so nothing here refuses a call. The server
 * enforces; this code only makes the server's answer legible.
 *
 * Run:  node --test test/planAwareness.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { planStatus, proxyRequest, PlanLimitError, ProxyError } = require('../src');

function stubFetch(status, body) {
  const original = global.fetch;
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
  return () => { global.fetch = original; };
}

test('a spent allowance raises a plan error, not a proxy error', async () => {
  const restore = stubFetch(429, {
    detail: {
      error: 'request_limit_reached',
      message: 'You have used all 1,000 proxy requests included in your plan this month.',
      used: 1001,
      limit: 1000,
      period: '2026-07',
    },
  });
  try {
    await assert.rejects(
      () => proxyRequest({
        token: 'tok', targetUrl: 'https://api.example.com/v1',
        body: { model: 'x' }, apiKey: 'rk_test', projectSecret: 'ps_test',
      }),
      (err) => {
        assert.ok(err instanceof PlanLimitError, 'should be a PlanLimitError');
        assert.equal(err.used, 1001);
        assert.equal(err.limit, 1000);
        assert.equal(err.period, '2026-07');
        assert.equal(err.kind, 'requests');
        assert.equal(err.code, 'request_limit_reached');
        // The developer sees the server's sentence, not a stringified object.
        assert.match(err.message, /1,000 proxy requests/);
        assert.ok(!err.message.includes('{'));
        return true;
      },
    );
  } finally { restore(); }
});

test('other proxy failures stay proxy errors', async () => {
  const restore = stubFetch(500, { detail: 'upstream exploded' });
  try {
    await assert.rejects(
      () => proxyRequest({
        token: 'tok', targetUrl: 'https://api.example.com/v1',
        body: { model: 'x' }, apiKey: 'rk_test', projectSecret: 'ps_test',
      }),
      (err) => err instanceof ProxyError && !(err instanceof PlanLimitError),
    );
  } finally { restore(); }
});

test('planStatus reports usage against the plan', async () => {
  const restore = stubFetch(200, {
    plan: 'free',
    plan_name: 'Free',
    has_active_subscription: false,
    limits: { projects: 1, secrets: 5, requests_month: 1000 },
    usage: { projects: 1, secrets: 3, requests_month: 412, requests_remaining: 588, period: '2026-07' },
  });
  try {
    const status = await planStatus({ projectSecret: 'ps_test' });
    assert.equal(status.plan, 'free');
    assert.equal(status.limits.requests_month, 1000);
    assert.equal(status.usage.requests_remaining, 588);
  } finally { restore(); }
});

test('being at the cap does not stop the SDK from trying — the server decides', async () => {
  let attempted = 0;
  const original = global.fetch;
  global.fetch = async () => {
    attempted += 1;
    return { ok: false, status: 500, text: async () => JSON.stringify({ detail: 'upstream' }) };
  };
  try {
    await assert.rejects(() => proxyRequest({
      token: 'tok', targetUrl: 'https://api.example.com/v1',
      body: { model: 'x' }, apiKey: 'rk_test', projectSecret: 'ps_test',
    }));
    assert.equal(attempted, 1, 'the call is made, not short-circuited locally');
  } finally { global.fetch = original; }
});
