// Why these tests exist: the MODEL_* overrides are what let Kav correct a
// retired model ID from .env instead of editing registry.js, which is what
// keeps `git pull` conflict-free. If they silently stopped working you would
// edit the tracked file again and be back to merge conflicts.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { configFor, modelsInUse, TASKS } from './registry.js';

const TOUCHED = ['MODEL_GEMINI', 'MODEL_GEMINI_GENERATE_CV', 'MODEL_ANTHROPIC',
  'MAX_TOKENS_GEMINI', 'MAX_TOKENS_GEMINI_GENERATE_CV',
  'LLM_TIMEOUT_MS', 'TIMEOUT_MS_GEMINI_REVISE_DOC'];
afterEach(() => {
  for (const name of TOUCHED) delete process.env[name];
});

test('with no override, the registry table wins', () => {
  assert.equal(configFor('parse-jd', 'gemini').model, 'gemini-3.5-flash');
  assert.equal(configFor('generate-cv', 'anthropic').model, 'claude-opus-5');
});

test('MODEL_GEMINI overrides every Gemini task and nothing else', () => {
  process.env.MODEL_GEMINI = 'gemini-9-test';
  assert.equal(configFor('parse-jd', 'gemini').model, 'gemini-9-test');
  assert.equal(configFor('generate-cv', 'gemini').model, 'gemini-9-test');
  // The other provider is untouched.
  assert.equal(configFor('generate-cv', 'anthropic').model, 'claude-opus-5');
});

test('a per-task override beats the blanket one', () => {
  process.env.MODEL_GEMINI = 'gemini-blanket';
  process.env.MODEL_GEMINI_GENERATE_CV = 'gemini-just-for-cv';
  assert.equal(configFor('generate-cv', 'gemini').model, 'gemini-just-for-cv');
  assert.equal(configFor('parse-jd', 'gemini').model, 'gemini-blanket');
});

test('a model override leaves maxTokens and effort alone', () => {
  process.env.MODEL_GEMINI = 'gemini-9-test';
  const config = configFor('generate-cv', 'gemini');
  // Generation needs room for the document AND the model's own reasoning, which
  // on Gemini is charged against the same budget. 8192 truncated a real CV.
  assert.equal(config.maxTokens, 32768);
  assert.equal(config.effort, 'high');
});

test('MAX_TOKENS_* raises the ceiling without touching the model', () => {
  process.env.MAX_TOKENS_GEMINI_GENERATE_CV = '65536';
  const cv = configFor('generate-cv', 'gemini');
  assert.equal(cv.maxTokens, 65536);
  assert.equal(cv.model, 'gemini-3.5-flash'); // untouched
  // Scoped to the one task, like the model overrides.
  assert.equal(configFor('parse-jd', 'gemini').maxTokens, 4096);
});

test('a blanket MAX_TOKENS applies to every task on that provider only', () => {
  process.env.MAX_TOKENS_GEMINI = '16000';
  assert.equal(configFor('parse-jd', 'gemini').maxTokens, 16000);
  assert.equal(configFor('generate-cv', 'gemini').maxTokens, 16000);
  assert.equal(configFor('generate-cv', 'anthropic').maxTokens, 32768);
});

test('a nonsense MAX_TOKENS is ignored rather than sending garbage upstream', () => {
  for (const bad of ['', 'lots', '0', '-5']) {
    process.env.MAX_TOKENS_GEMINI = bad;
    assert.equal(configFor('generate-cv', 'gemini').maxTokens, 32768, `for ${JSON.stringify(bad)}`);
  }
});

test('an empty override is ignored rather than blanking the model', () => {
  process.env.MODEL_GEMINI = '';
  assert.equal(configFor('parse-jd', 'gemini').model, 'gemini-3.5-flash');
});

test('modelsInUse reports the overridden model, so `npm run models` checks the real one', () => {
  process.env.MODEL_GEMINI = 'gemini-9-test';
  const inUse = modelsInUse('gemini');
  assert.deepEqual([...inUse.keys()], ['gemini-9-test']);
  assert.ok(inUse.get('gemini-9-test').includes('generate-cv'));
});

// --- per-task timeouts ------------------------------------------------------
//
// Why: one global 180s deadline was wrong in both directions. It made a parse
// that should take five seconds wait three minutes before giving up, and it was
// not enough for revise-doc, which returns a whole rewritten CV — that is the
// call that actually timed out on Gemini.

test('every task carries a timeout, so none falls back to a global guess', () => {
  for (const task of TASKS) {
    for (const provider of ['anthropic', 'gemini']) {
      const { timeoutMs } = configFor(task, provider);
      assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, `${task}/${provider} has no timeout`);
    }
  }
});

test('writing a document is given more time than reading an advertisement', () => {
  const parse = configFor('parse-jd', 'gemini').timeoutMs;
  for (const task of ['generate-cv', 'generate-cover-letter', 'revise-doc']) {
    assert.ok(configFor(task, 'gemini').timeoutMs > parse, `${task} should outlast a parse`);
  }
});

test('revise-doc is timed like a generation, because it returns the whole document', () => {
  assert.equal(configFor('revise-doc', 'gemini').timeoutMs, configFor('generate-cv', 'gemini').timeoutMs);
});

test('LLM_TIMEOUT_MS overrides every task, which is what the error message promises', () => {
  process.env.LLM_TIMEOUT_MS = '600000';
  assert.equal(configFor('parse-jd', 'gemini').timeoutMs, 600_000);
  assert.equal(configFor('revise-doc', 'anthropic').timeoutMs, 600_000);
});

test('a per-task timeout override adjusts one task on one provider', () => {
  process.env.TIMEOUT_MS_GEMINI_REVISE_DOC = '900000';
  assert.equal(configFor('revise-doc', 'gemini').timeoutMs, 900_000);
  assert.equal(configFor('revise-doc', 'anthropic').timeoutMs, 420_000, 'the other provider is untouched');
  assert.equal(configFor('generate-cv', 'gemini').timeoutMs, 420_000, 'and the other tasks are');
});

test('the blanket override beats the per-task one', () => {
  process.env.LLM_TIMEOUT_MS = '600000';
  process.env.TIMEOUT_MS_GEMINI_REVISE_DOC = '900000';
  assert.equal(configFor('revise-doc', 'gemini').timeoutMs, 600_000);
});

test('a nonsense timeout is ignored rather than disabling the deadline', () => {
  for (const bad of ['', 'ages', '0', '-1']) {
    process.env.LLM_TIMEOUT_MS = bad;
    assert.equal(configFor('revise-doc', 'gemini').timeoutMs, 420_000, `for ${JSON.stringify(bad)}`);
  }
});
