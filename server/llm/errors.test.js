// Why these tests exist: these strings are the entire interface when something
// fails. Nobody is reading a stack trace — they are reading one sentence in a
// browser, deciding whether the fault is theirs, and deciding what to do next. A
// message that gets any of those three wrong costs an hour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { llmError, LlmError, LLM_ERROR_TYPES } from './errors.js';

test('every error type produces a message that is a real sentence', () => {
  for (const type of LLM_ERROR_TYPES) {
    const message = llmError(type, { provider: 'gemini', task: 'parse-jd', status: 500 }).message;
    assert.ok(message.length > 20, `${type} produced "${message}"`);
    assert.match(message, /[.!]$/, `${type} does not end in a full stop`);
  }
});

test('an unknown type fails loudly rather than shipping a broken error', () => {
  assert.throws(() => new LlmError('invented', 'x'), /Unknown LlmError type/);
});

// --- what a 503 says ---------------------------------------------------------
//
// Why this is worth pinning: the first version said "had a problem on their end.
// We retried and it kept failing. Wait a few minutes and try again." Every part
// of that was true and none of it was useful — it did not say what the problem
// was, how hard it had actually tried, or what to do if waiting did not help.

const overloaded = (extra = {}) =>
  llmError('provider-error', {
    provider: 'gemini', task: 'revise-doc', model: 'gemini-3.5-flash',
    status: 503, attempts: 6, elapsedMs: 24_000,
    details: '{"error":{"code":503,"message":"The model is overloaded. Please try again later.","status":"UNAVAILABLE"}}',
    ...extra,
  }).message;

test('a 503 says the model is overloaded, not that something went wrong', () => {
  assert.match(overloaded(), /no capacity|overloaded/i);
});

test('a 503 rules out the things you would otherwise suspect', () => {
  // The natural reading of "there was a problem" is "I did something wrong",
  // and the next hour goes on checking a key that was fine.
  assert.match(overloaded(), /Nothing is wrong with your key/i);
});

test('a 503 says how hard it tried, because "we retried" alone is not believable', () => {
  const message = overloaded();
  assert.match(message, /tried 6 times/);
  assert.match(message, /about 24 seconds/);
});

test('one second is not "1 seconds"', () => {
  assert.match(overloaded({ elapsedMs: 900 }), /about 1 second\./);
});

test('a 503 offers a way out other than waiting', () => {
  const message = overloaded();
  assert.match(message, /npm run models/, 'how to find a model that is not busy');
  assert.match(message, /MODEL_GEMINI/, 'and where to put it');
  assert.match(message, /LLM_PROVIDER/, 'or leave the provider entirely');
});

test('Anthropic 529 is treated as the same condition', () => {
  const message = llmError('provider-error', {
    provider: 'anthropic', task: 'generate-cv', status: 529, attempts: 4, elapsedMs: 12_000,
  }).message;
  assert.match(message, /no capacity|overloaded/i);
});

test('an overloaded body is recognised even when the status is not the usual one', () => {
  const message = llmError('provider-error', {
    provider: 'gemini', task: 'parse-jd', status: 500,
    details: 'The model is overloaded. Please try again later.',
  }).message;
  assert.match(message, /no capacity|overloaded/i);
});

test('an ordinary 500 does not claim to know it is an overload', () => {
  const message = llmError('provider-error', {
    provider: 'gemini', task: 'parse-jd', status: 500, attempts: 2, elapsedMs: 3000,
    details: 'internal error',
  }).message;
  assert.doesNotMatch(message, /overloaded/i);
  assert.match(message, /HTTP 500/);
  assert.match(message, /theirs to fix, not yours/);
});

test('a single-attempt failure does not claim to have retried', () => {
  const message = llmError('provider-error', {
    provider: 'gemini', task: 'parse-jd', status: 500, attempts: 1, elapsedMs: 200,
  }).message;
  assert.doesNotMatch(message, /tried \d+ times/);
});

test('the timeout message points at .env, never at the tracked registry', () => {
  // Editing registry.js is the one thing that breaks `git pull` safety, and the
  // message used to recommend it.
  const message = llmError('timeout', { provider: 'gemini', task: 'revise-doc', timeoutMs: 420_000 }).message;
  assert.doesNotMatch(message, /registry\.js/);
  assert.match(message, /LLM_TIMEOUT_MS/);
});
