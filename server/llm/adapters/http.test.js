// WHY: the first real CV generation hung forever with nothing on screen,
// because fetch has no timeout of its own. These pin the deadline and, just as
// importantly, that a stalled call is reported as a timeout rather than as a
// network failure — the two need different advice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, configuredTimeoutMs, DEFAULT_TIMEOUT_MS } from './http.js';

test('a provider that never answers becomes a timeout error, not a hang', async () => {
  // Never resolves on its own; only the abort signal ends it.
  const stalls = (url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });

  const err = await fetchWithTimeout(stalls, 'https://example.test', {}, { timeoutMs: 25 })
    .then(() => null, (e) => e);

  assert.ok(err, 'should have rejected');
  assert.equal(err.type, 'timeout');
  assert.match(err.message, /seconds/);
  assert.match(err.message, /LLM_TIMEOUT_MS/); // tells you the knob
});

test('a genuine connection failure is still reported as network, not timeout', async () => {
  const offline = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
  const err = await fetchWithTimeout(offline, 'https://example.test', {}, { timeoutMs: 5000 })
    .then(() => null, (e) => e);
  assert.equal(err.type, 'network');
});

test('a fast answer passes straight through and the timer is cleared', async () => {
  const quick = async () => ({ ok: true, status: 200 });
  const res = await fetchWithTimeout(quick, 'https://example.test', {}, { timeoutMs: 5000 });
  assert.equal(res.ok, true);
  // If the timer leaked, node:test would hang here waiting for it.
});

test('the deadline is configurable from .env and falls back sanely', () => {
  const saved = process.env.LLM_TIMEOUT_MS;
  try {
    delete process.env.LLM_TIMEOUT_MS;
    assert.equal(configuredTimeoutMs(), DEFAULT_TIMEOUT_MS);
    process.env.LLM_TIMEOUT_MS = '5000';
    assert.equal(configuredTimeoutMs(), 5000);
    process.env.LLM_TIMEOUT_MS = 'not a number';
    assert.equal(configuredTimeoutMs(), DEFAULT_TIMEOUT_MS);
    process.env.LLM_TIMEOUT_MS = '-1';
    assert.equal(configuredTimeoutMs(), DEFAULT_TIMEOUT_MS);
  } finally {
    if (saved === undefined) delete process.env.LLM_TIMEOUT_MS;
    else process.env.LLM_TIMEOUT_MS = saved;
  }
});
