/**
 * Adaptive telemetry sampling — bound the send rate without ever dropping usage.
 *
 * Run:  node --test test/sampling.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { AdaptiveSampler } = require('../src/telemetry/sampling');

test('the first use of a key is sent immediately', () => {
  const sampler = new AdaptiveSampler(() => {});
  assert.equal(sampler.record('key-a'), true, 'first sight should be sent now');
});

test('repeats are folded into a counter, not sent', () => {
  const sampler = new AdaptiveSampler(() => {});
  sampler.record('key-a');                     // sent
  assert.equal(sampler.record('key-a'), false);
  assert.equal(sampler.record('key-a'), false);
  assert.deepEqual(sampler.pending(), { 'key-a': 2 });
});

test('flush emits one weighted event per active key', () => {
  const batches = [];
  const sampler = new AdaptiveSampler((items) => batches.push(items));
  sampler.record('key-a');           // first — sent by the caller, count starts at 0
  sampler.record('key-a');           // +1
  sampler.record('key-a');           // +1
  sampler.record('key-b');           // first
  sampler.record('key-b');           // +1
  sampler.flush();

  assert.equal(batches.length, 1);
  const byKey = Object.fromEntries(batches[0].map((i) => [i.key, i.count]));
  assert.deepEqual(byKey, { 'key-a': 2, 'key-b': 1 });
});

test('flush with nothing pending emits nothing', () => {
  const batches = [];
  const sampler = new AdaptiveSampler((items) => batches.push(items));
  sampler.record('key-a');   // first, count 0
  sampler.flush();           // nothing to aggregate yet
  assert.equal(batches.length, 0);
});

test('a throwing emit never propagates', () => {
  const sampler = new AdaptiveSampler(() => {
    throw new Error('network down');
  });
  sampler.record('key-a');
  sampler.record('key-a');
  assert.doesNotThrow(() => sampler.flush(), 'telemetry must not break the caller');
});

test('flush clears the buckets', () => {
  const sampler = new AdaptiveSampler(() => {});
  sampler.record('key-a');
  sampler.record('key-a');
  sampler.flush();
  assert.deepEqual(sampler.pending(), {});
});
