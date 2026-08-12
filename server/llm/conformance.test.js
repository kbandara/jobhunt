// Why this file exists: it is the whole point of the LLM phase. The same
// battery of tasks runs against BOTH providers from recorded fixtures, and
// asserts they are indistinguishable from above — same result keys, same
// validated data shape, same typed errors for refusals, truncations, rate
// limits and schema mismatches. If Anthropic and Gemini ever disagree about a
// response shape, that is a red test on your laptop, not a surprise in the
// middle of writing a job application.
//
// No test in here touches the network. The adapters only reach the outside
// world through the injected `fetchImpl`, and every test injects a stub, so the
// suite passes with no API keys set anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv';
import { readJson, readJsonl } from '../store.js';
import { complete, loadPinnedSchema } from './index.js';
import { LlmError } from './errors.js';
import { configFor } from './registry.js';
import { costCents } from './pricing.js';
import { totals } from './ledger.js';
import { downConvert } from './adapters/gemini.js';
import { MAX_RETRIES } from './adapters/http.js';

const Ajv = AjvModule.default ?? AjvModule;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const PROVIDERS = ['anthropic', 'gemini'];
const BATTERY = ['parse-jd', 'score-batch', 'generate-cv'];

// ---------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------

function fixture(provider, task) {
  return readJson(path.join(HERE, 'fixtures', provider, `${task}.json`));
}

/** A stand-in for the Response object fetch would return. */
function stubResponse(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
  };
}

/** The output ceiling a recorded request asked for, however that provider spells it. */
function askedFor(provider, call) {
  return provider === 'anthropic' ? call.body.max_tokens : call.body.generationConfig.maxOutputTokens;
}

/**
 * A fetch stub that serves a queue of responses and records every request it
 * was given, so tests can inspect what we actually sent on the wire.
 */
function queueFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body), headers: init.headers });
    if (calls.length > responses.length) {
      throw new Error(`fetch called ${calls.length} times but only ${responses.length} responses were queued`);
    }
    return responses[calls.length - 1];
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** A provider reply carrying `payload` as its JSON text, in that provider's shape. */
function replyWith(provider, payload, { model = 'test-model', stop = null } = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (provider === 'anthropic') {
    return stubResponse(200, {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: stop ?? 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  }
  return stubResponse(200, {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: stop ?? 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
    modelVersion: model,
  });
}

/** A reply that stopped for a reason, with no usable content. */
function stoppedReply(provider, reason) {
  if (provider === 'anthropic') {
    return stubResponse(200, {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text: '{"partial":' }],
      stop_reason: reason === 'refusal' ? 'refusal' : 'max_tokens',
      usage: { input_tokens: 700, output_tokens: 9 },
    });
  }
  return stubResponse(200, {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: '{"partial":' }] },
        finishReason: reason === 'refusal' ? 'SAFETY' : 'MAX_TOKENS',
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 9, totalTokenCount: 709 },
    modelVersion: 'test-model',
  });
}

function tempLedger() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-llm-')), 'ledger.jsonl');
}

const MESSAGES = [{ role: 'user', content: 'Here is a job ad. Parse it.' }];

/** Standard call options: never reads env, never reaches the network. */
function callOptions(provider, fetchImpl, extra = {}) {
  return {
    messages: MESSAGES,
    provider,
    apiKey: 'test-key-not-a-real-key',
    fetchImpl,
    sleep: async () => {}, // retry backoff without the wait
    ledgerFile: tempLedger(),
    ...extra,
  };
}

/**
 * Compare two results' structure, ignoring values.
 *
 * `null` and empty arrays match anything: a nullable field one provider filled
 * in and the other left null is a legitimate difference, not a broken adapter.
 * Everything else must line up — especially object key sets, which is where a
 * provider quietly dropping a field would show up.
 */
function assertSameShape(a, b, where = 'data') {
  if (a === null || b === null) return;
  if (Array.isArray(a) || Array.isArray(b)) {
    assert.ok(Array.isArray(a) && Array.isArray(b), `${where}: one provider returned an array and the other did not`);
    if (a.length === 0 || b.length === 0) return;
    assertSameShape(a[0], b[0], `${where}[0]`);
    return;
  }
  if (typeof a === 'object' || typeof b === 'object') {
    assert.ok(typeof a === 'object' && typeof b === 'object', `${where}: one provider returned an object and the other did not`);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${where}: providers disagree about which keys exist`);
    for (const key of Object.keys(a)) assertSameShape(a[key], b[key], `${where}.${key}`);
    return;
  }
  assert.equal(typeof a, typeof b, `${where}: providers disagree about the type`);
}

// ---------------------------------------------------------------------------
// The battery: every task, every provider, from fixtures
// ---------------------------------------------------------------------------

for (const provider of PROVIDERS) {
  for (const task of BATTERY) {
    test(`${provider}/${task}: returns data that validates against the pinned schema`, async () => {
      const fx = fixture(provider, task);
      const fetchImpl = queueFetch([stubResponse(fx.status, fx.body)]);
      const result = await complete(callOptions(provider, fetchImpl, { task }));

      // Validated here independently of index.js, against the pinned file.
      const validate = new Ajv({ allErrors: true, strict: false }).compile(loadPinnedSchema(task));
      const valid = validate(result.data);
      assert.ok(valid, `data did not match schemas/${task}.json: ${JSON.stringify(validate.errors)}`);

      assert.equal(result.provider, provider);
      assert.ok(typeof result.model === 'string' && result.model.length > 0, 'model should be reported');
      assert.ok(Number.isInteger(result.usage.inputTokens) && result.usage.inputTokens > 0, 'input tokens missing');
      assert.ok(Number.isInteger(result.usage.outputTokens) && result.usage.outputTokens > 0, 'output tokens missing');
      assert.ok(result.costCents >= 0, 'cost should never be negative');
      assert.equal(fetchImpl.calls.length, 1, 'a clean call should be exactly one round-trip');
    });
  }
}

for (const task of BATTERY) {
  test(`${task}: both providers return an identical result shape`, async () => {
    const results = {};
    for (const provider of PROVIDERS) {
      const fx = fixture(provider, task);
      results[provider] = await complete(
        callOptions(provider, queueFetch([stubResponse(fx.status, fx.body)]), { task }),
      );
    }

    assert.deepEqual(
      Object.keys(results.anthropic).sort(),
      Object.keys(results.gemini).sort(),
      'llm.complete must return the same top-level keys for every provider',
    );
    assert.deepEqual(Object.keys(results.anthropic.usage).sort(), ['inputTokens', 'outputTokens']);
    assert.deepEqual(Object.keys(results.gemini.usage).sort(), ['inputTokens', 'outputTokens']);
    assertSameShape(results.anthropic.data, results.gemini.data);
  });
}

// ---------------------------------------------------------------------------
// What we put on the wire
// ---------------------------------------------------------------------------

test('anthropic request: structured output, effort, and none of the parameters that 400', async () => {
  const fx = fixture('anthropic', 'parse-jd');
  const fetchImpl = queueFetch([stubResponse(fx.status, fx.body)]);
  await complete(callOptions('anthropic', fetchImpl, { task: 'parse-jd', system: 'You parse job ads.' }));

  const { url, body, headers } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.ok(headers['x-api-key'], 'key goes in the x-api-key header');
  assert.equal(body.model, configFor('parse-jd', 'anthropic').model);
  assert.equal(body.max_tokens, configFor('parse-jd', 'anthropic').maxTokens);
  assert.equal(body.system, 'You parse job ads.');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema.$id, 'parse-jd');
  assert.equal(body.output_config.effort, 'low'); // the registry default for this task

  // These 400 on Sonnet 5 / Opus 5 — see docs/ARCHITECTURE.md.
  for (const banned of ['temperature', 'top_p', 'top_k', 'thinking', 'budget_tokens']) {
    assert.equal(banned in body, false, `${banned} must never be sent`);
  }
});

test('gemini request: JSON mime type plus a down-converted schema', async () => {
  const fx = fixture('gemini', 'parse-jd');
  const fetchImpl = queueFetch([stubResponse(fx.status, fx.body)]);
  await complete(callOptions('gemini', fetchImpl, { task: 'parse-jd', system: 'You parse job ads.' }));

  const { url, body, headers } = fetchImpl.calls[0];
  assert.ok(url.endsWith(`/${configFor('parse-jd', 'gemini').model}:generateContent`), url);
  assert.ok(headers['x-goog-api-key'], 'key goes in the x-goog-api-key header');
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'You parse job ads.' }] });
  assert.deepEqual(body.contents[0], { role: 'user', parts: [{ text: MESSAGES[0].content }] });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');

  const sent = body.generationConfig.responseSchema;
  assert.equal('$id' in sent, false, 'Gemini rejects $id');
  assert.equal('additionalProperties' in sent, false, 'Gemini rejects additionalProperties');
  // The nullable conversion, on a real field of the real schema.
  assert.deepEqual(sent.properties.timezone, {
    type: 'string',
    nullable: true,
    description: 'IANA timezone if the ad names one, else null',
  });
  assert.deepEqual(sent.properties.location.properties.city, { type: 'string', nullable: true });
});

test('effort can be overridden per call', async () => {
  const fx = fixture('anthropic', 'parse-jd');
  const fetchImpl = queueFetch([stubResponse(fx.status, fx.body)]);
  await complete(callOptions('anthropic', fetchImpl, { task: 'parse-jd', effort: 'high' }));
  assert.equal(fetchImpl.calls[0].body.output_config.effort, 'high');
});

test('downConvert strips what Gemini rejects and converts nullable types, recursively', () => {
  const converted = downConvert({
    $id: 'x',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['a'],
    properties: {
      a: { type: ['string', 'null'] },
      n: { type: ['integer', 'null'] },
      list: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: { deep: { type: ['string', 'null'] } } },
      },
      kind: { type: 'string', enum: ['one', 'two'] },
    },
  });

  assert.deepEqual(converted, {
    type: 'object',
    required: ['a'],
    properties: {
      a: { type: 'string', nullable: true },
      n: { type: 'integer', nullable: true },
      list: { type: 'array', items: { type: 'object', properties: { deep: { type: 'string', nullable: true } } } },
      kind: { type: 'string', enum: ['one', 'two'] },
    },
  });
});

// ---------------------------------------------------------------------------
// Failure modes — identical on both providers
// ---------------------------------------------------------------------------

for (const provider of PROVIDERS) {
  test(`${provider}: a schema mismatch triggers exactly one repair retry, then succeeds`, async () => {
    const fx = fixture(provider, 'parse-jd');
    const fetchImpl = queueFetch([
      replyWith(provider, { role_title: 42 }), // wrong type, and missing required fields
      stubResponse(fx.status, fx.body),
    ]);
    const result = await complete(callOptions(provider, fetchImpl, { task: 'parse-jd' }));

    assert.equal(fetchImpl.calls.length, 2, 'exactly one repair retry');
    assert.equal(result.data.role_title, 'Research Engineer, Model Evaluations');

    // The repair turn must carry the validation errors back to the model.
    const repair = fetchImpl.calls[1].body;
    const sentText = JSON.stringify(repair);
    assert.match(sentText, /did not match the required schema/);
    assert.match(sentText, /role_title/);
  });

  test(`${provider}: a second schema mismatch throws a typed error and stops`, async () => {
    const ledgerFile = tempLedger();
    const fetchImpl = queueFetch([replyWith(provider, { role_title: 42 }), replyWith(provider, { nope: true })]);

    await assert.rejects(
      () => complete(callOptions(provider, fetchImpl, { task: 'parse-jd', ledgerFile })),
      (err) => {
        assert.ok(err instanceof LlmError);
        assert.equal(err.type, 'schema-mismatch');
        assert.match(err.message, /did not fit the format/);
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 2, 'one repair attempt only — never a third call');

    const lines = readJsonl(ledgerFile);
    assert.equal(lines.length, 2, 'both billed attempts are on the ledger');
    assert.deepEqual(lines.map((l) => l.ok), [false, false]);
    assert.deepEqual(lines.map((l) => l.errorType), ['schema-mismatch', 'schema-mismatch']);
  });

  test(`${provider}: a refusal surfaces as a refusal and is never retried`, async () => {
    const ledgerFile = tempLedger();
    const fetchImpl = queueFetch([stoppedReply(provider, 'refusal')]);

    await assert.rejects(
      () => complete(callOptions(provider, fetchImpl, { task: 'parse-jd', ledgerFile })),
      (err) => {
        assert.equal(err.type, 'refusal');
        assert.match(err.message, /declined/);
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 1, 'a refusal is never auto-retried');

    // It still burnt tokens, so it is still on the ledger with a cost.
    const [line] = readJsonl(ledgerFile);
    assert.equal(line.ok, false);
    assert.equal(line.errorType, 'refusal');
    assert.equal(line.inputTokens, 700);
    assert.equal(line.outputTokens, 9);
  });

  test(`${provider}: running out of room is retried with more of it`, async () => {
    // Truncation is a measurement, not a verdict: the answer needed more room
    // than it was given. The app doubles the ceiling and asks again rather than
    // stopping to tell you to edit .env — see server/llm/headroom.js.
    const fx = fixture(provider, 'parse-jd');
    const fetchImpl = queueFetch([stoppedReply(provider, 'truncated'), stubResponse(fx.status, fx.body)]);
    const result = await complete(callOptions(provider, fetchImpl, { task: 'parse-jd' }));

    assert.ok(result.data, 'the second, roomier call should have succeeded');
    assert.equal(fetchImpl.calls.length, 2);
    assert.ok(
      askedFor(provider, fetchImpl.calls[1]) > askedFor(provider, fetchImpl.calls[0]),
      'the retry must actually ask for more room, or it is just a repeat',
    );
  });

  test(`${provider}: still truncated after growing says so, and does not blame .env`, async () => {
    const fetchImpl = queueFetch(Array.from({ length: 3 }, () => stoppedReply(provider, 'truncated')));
    await assert.rejects(
      () => complete(callOptions(provider, fetchImpl, { task: 'parse-jd' })),
      (err) => {
        assert.equal(err.type, 'truncated');
        assert.match(err.message, /cut off/);
        assert.match(err.message, /already doubled/, 'it must not suggest a fix it has already applied');
        return true;
      },
    );
    // One original plus two growths — bounded, because each one costs a call.
    assert.equal(fetchImpl.calls.length, 3);
  });

  test(`${provider}: a 429 is retried with backoff and then succeeds`, async () => {
    const fx = fixture(provider, 'parse-jd');
    const fetchImpl = queueFetch([
      stubResponse(429, { error: 'slow down' }, { 'retry-after': '1' }),
      stubResponse(429, { error: 'slow down' }),
      stubResponse(fx.status, fx.body),
    ]);
    const waits = [];

    const result = await complete(
      callOptions(provider, fetchImpl, {
        task: 'parse-jd',
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
    );

    assert.equal(fetchImpl.calls.length, 3);
    assert.equal(waits.length, 2, 'it waited between attempts');
    assert.equal(waits[0], 1000, 'honours retry-after (1 second)');
    assert.ok(result.data.role_title, 'the retried call produced usable data');
  });

  test(`${provider}: a 429 that never clears gives up after the full retry budget`, async () => {
    const tooMany = Array.from({ length: MAX_RETRIES + 2 }, () => stubResponse(429, { error: 'slow down' }));
    const fetchImpl = queueFetch(tooMany);

    await assert.rejects(
      () => complete(callOptions(provider, fetchImpl, { task: 'parse-jd' })),
      (err) => {
        assert.equal(err.type, 'rate-limit');
        assert.equal(err.attempts, MAX_RETRIES + 1, 'and reports how many times it tried');
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, MAX_RETRIES + 1, 'first attempt plus every retry');
  });

  // Why this matters enough to pin: a Gemini 503 means "this model is
  // overloaded", and free-tier flash models stay overloaded for minutes. The
  // old policy gave up after about seven seconds — long before the thing it was
  // waiting for could clear.
  test(`${provider}: a 503 is retried, not surfaced on the first try`, async () => {
    const fx = fixture(provider, 'parse-jd');
    const overloaded = { error: { message: 'The model is overloaded. Please try again later.' } };
    const fetchImpl = queueFetch([
      stubResponse(503, overloaded),
      stubResponse(503, overloaded),
      stubResponse(fx.status, fx.body),
    ]);

    const result = await complete(callOptions(provider, fetchImpl, { task: 'parse-jd' }));
    assert.equal(fetchImpl.calls.length, 3, 'it rode out the overload');
    assert.ok(result.data.role_title);
  });

  test(`${provider}: backoff grows, so a long outage is not hammered`, async () => {
    const waits = [];
    const fetchImpl = queueFetch(Array.from({ length: MAX_RETRIES + 1 }, () => stubResponse(503, { error: 'busy' })));
    await assert.rejects(() =>
      complete(callOptions(provider, fetchImpl, { task: 'parse-jd', sleep: async (ms) => waits.push(ms) })),
    );
    assert.equal(waits.length, MAX_RETRIES);
    // Jittered, so not exactly doubling — but each window is above the last.
    assert.ok(waits[waits.length - 1] > waits[0] * 2, `waits were ${waits.join(', ')}`);
    assert.ok(
      waits.reduce((a, b) => a + b, 0) > 10_000,
      'the whole sequence should span tens of seconds, not a handful',
    );
  });

  test(`${provider}: a rejected fetch is reported as a network problem`, async () => {
    const fetchImpl = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    await assert.rejects(
      () => complete(callOptions(provider, fetchImpl, { task: 'parse-jd' })),
      (err) => {
        assert.equal(err.type, 'network');
        assert.match(err.message, /internet connection/);
        return true;
      },
    );
  });

  test(`${provider}: a rejected key is reported as an auth problem, in plain English`, async () => {
    const body = provider === 'anthropic' ? { error: 'unauthorized' } : { error: { message: 'API_KEY_INVALID' } };
    const status = provider === 'anthropic' ? 401 : 400;
    const fetchImpl = queueFetch([stubResponse(status, body)]);

    await assert.rejects(
      () => complete(callOptions(provider, fetchImpl, { task: 'parse-jd' })),
      (err) => {
        assert.equal(err.type, 'auth');
        assert.match(err.message, provider === 'anthropic' ? /ANTHROPIC_API_KEY/ : /GEMINI_API_KEY/);
        return true;
      },
    );
    assert.equal(fetchImpl.calls.length, 1, 'a bad key is not worth retrying');
  });
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

test('every successful call writes exactly one ledger line, with counts and cents only', async () => {
  const ledgerFile = tempLedger();
  const fx = fixture('anthropic', 'generate-cv');
  const fetchImpl = queueFetch([stubResponse(fx.status, fx.body)]);

  const result = await complete(callOptions('anthropic', fetchImpl, { task: 'generate-cv', ledgerFile }));
  const lines = readJsonl(ledgerFile);

  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.deepEqual(Object.keys(line).sort(), [
    'costCents',
    'inputTokens',
    'model',
    'ok',
    'outputTokens',
    'provider',
    'task',
    'ts',
  ]);
  assert.equal(line.task, 'generate-cv');
  assert.equal(line.provider, 'anthropic');
  assert.equal(line.ok, true);
  assert.equal(line.inputTokens, result.usage.inputTokens);
  assert.equal(line.costCents, result.costCents);
  assert.equal(line.costCents, costCents('claude-opus-5', result.usage));
  assert.ok(line.costCents > 0, 'an Opus call is not free');
  assert.ok(!JSON.stringify(line).includes('Research Engineer'), 'the ledger must never hold message content');
});

test('a dated model snapshot is still costed at its alias price, never as free', async () => {
  // Anthropic can answer a request for "claude-sonnet-5" with the dated build
  // it actually ran. That string has no row in pricing.js, and the call must
  // not therefore be recorded as costing nothing.
  const payload = JSON.parse(fixture('anthropic', 'parse-jd').body.content[0].text);
  const fetchImpl = queueFetch([replyWith('anthropic', payload, { model: 'claude-sonnet-5-20260814' })]);

  const result = await complete(callOptions('anthropic', fetchImpl, { task: 'parse-jd' }));

  assert.equal(result.model, 'claude-sonnet-5-20260814', 'report the model the provider actually ran');
  assert.equal(result.costCents, costCents('claude-sonnet-5', result.usage));
  assert.ok(result.costCents > 0, 'a real call must never be recorded as free');
});

test('totals() adds up the ledger and breaks it down by task', async () => {
  const ledgerFile = tempLedger();
  for (const task of ['parse-jd', 'parse-jd', 'generate-cv']) {
    const fx = fixture('anthropic', task);
    await complete(
      callOptions('anthropic', queueFetch([stubResponse(fx.status, fx.body)]), { task, ledgerFile }),
    );
  }

  const summary = totals(ledgerFile);
  assert.equal(summary.byTask['parse-jd'].calls, 2);
  assert.equal(summary.byTask['generate-cv'].calls, 1);
  assert.equal(summary.byTask['parse-jd'].failed, 0);
  const expected =
    2 * costCents('claude-sonnet-5', { inputTokens: 1240, outputTokens: 310 }) +
    costCents('claude-opus-5', { inputTokens: 9120, outputTokens: 742 });
  assert.equal(summary.totalCents, Math.round(expected * 10_000) / 10_000);
  assert.equal(totals(path.join(os.tmpdir(), 'jobhunt-no-such-ledger.jsonl')).totalCents, 0);
});

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

test('a missing API key fails immediately, before any request is made', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    let called = false;
    await assert.rejects(
      () =>
        complete({
          task: 'parse-jd',
          messages: MESSAGES,
          provider: 'anthropic',
          ledgerFile: tempLedger(),
          fetchImpl: async () => {
            called = true;
          },
        }),
      (err) => {
        assert.equal(err.type, 'auth');
        assert.match(err.message, /ANTHROPIC_API_KEY/);
        return true;
      },
    );
    assert.equal(called, false, 'nothing should be sent without a key');
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('an unknown task name fails with a message naming the known tasks', async () => {
  await assert.rejects(
    () => complete(callOptions('anthropic', queueFetch([]), { task: 'not-a-task' })),
    /Unknown LLM task "not-a-task"/,
  );
});

test('a reply wrapped in a markdown fence is still read, without spending a repair call', async () => {
  const fx = fixture('anthropic', 'score-batch');
  const payload = JSON.parse(fx.body.content[0].text);
  const fetchImpl = queueFetch([replyWith('anthropic', '```json\n' + JSON.stringify(payload) + '\n```')]);

  const result = await complete(callOptions('anthropic', fetchImpl, { task: 'score-batch' }));
  assert.equal(fetchImpl.calls.length, 1, 'no repair round-trip should be needed');
  assert.equal(result.data.scores.length, payload.scores.length);
});

test('an explicit schema overrides the pinned one', async () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  };
  const fetchImpl = queueFetch([replyWith('anthropic', { ok: true })]);
  const result = await complete(callOptions('anthropic', fetchImpl, { task: 'score-batch', schema }));

  assert.deepEqual(result.data, { ok: true });
  assert.deepEqual(fetchImpl.calls[0].body.output_config.format.schema, schema);
});
