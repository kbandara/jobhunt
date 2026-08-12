// Why these tests exist: the growth has to be bounded and it has to stop at a
// number providers will accept. Unbounded, a task that genuinely cannot fit
// doubles its bill on every attempt; past a model's real limit, the provider
// answers 400 and a recoverable problem becomes an unrecoverable one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCeiling, configuredCeiling, GROWTH, MAX_GROWTHS, DEFAULT_CEILING } from './headroom.js';

test('the next try gets double the room', () => {
  assert.equal(nextCeiling(32_768), 32_768 * GROWTH);
});

test('growth stops after a bounded number of tries', () => {
  assert.equal(nextCeiling(32_768, { growths: MAX_GROWTHS - 1 }), 65_536);
  assert.equal(nextCeiling(32_768, { growths: MAX_GROWTHS }), null);
});

test('the hard cap is never exceeded, only reached', () => {
  const near = DEFAULT_CEILING - 1;
  assert.equal(nextCeiling(near), DEFAULT_CEILING);
  assert.equal(nextCeiling(DEFAULT_CEILING), null, 'at the cap there is nowhere to grow');
});

test('a nonsense current ceiling grows into nothing rather than NaN', () => {
  for (const value of [0, -1, NaN, undefined, null, 'lots']) {
    assert.equal(nextCeiling(value), null);
  }
});

test('the cap can be raised from .env, and nonsense there is ignored', () => {
  assert.equal(configuredCeiling({ MAX_TOKENS_CEILING: '262144' }), 262_144);
  for (const bad of ['', 'plenty', '-5', '0', undefined]) {
    assert.equal(configuredCeiling({ MAX_TOKENS_CEILING: bad }), DEFAULT_CEILING);
  }
});

test('a raised cap actually lets it grow further', () => {
  assert.equal(nextCeiling(DEFAULT_CEILING, { ceiling: 262_144 }), 262_144);
});
