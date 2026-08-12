// Why this module exists: this is the ONLY way the rest of the app talks to a
// language model. Call sites name a task ("parse-jd"), not a model or a
// provider, and get back data that has already been parsed, validated against
// the task's pinned schema, and costed into the ledger. Everything provider-
// specific — URLs, headers, refusal codes, schema dialects — stops at the
// adapters below this file.
//
// The one piece of policy that lives here: if the model's JSON does not match
// the schema, we send the validation errors back once and ask for a fix. Once.
// A model that cannot produce the right shape twice will not produce it on the
// fifth try either, and every retry is real money.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv';
import { readJson } from '../store.js';
import { log } from '../log.js';
import { llmError, LlmError } from './errors.js';
import { configFor, resolveProvider, PROVIDERS, EFFORT_LEVELS } from './registry.js';
import { nextCeiling, configuredCeiling } from './headroom.js';
import { costCents, isPricedModel } from './pricing.js';
import { recordCall, defaultLedgerFile } from './ledger.js';
import { createAnthropicAdapter } from './adapters/anthropic.js';
import { createGeminiAdapter } from './adapters/gemini.js';

const Ajv = AjvModule.default ?? AjvModule; // ajv ships CommonJS; this works either way
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(HERE, 'schemas');

const schemaCache = new Map(); // task name -> schema object
const validatorCache = new Map(); // schema object -> compiled ajv validator

/**
 * The pinned schema for a task, e.g. schemas/parse-jd.json. Loaded once and
 * kept, because these files never change while the server is running.
 */
export function loadPinnedSchema(task) {
  if (schemaCache.has(task)) return schemaCache.get(task);
  const file = path.join(SCHEMA_DIR, `${task}.json`);
  const schema = readJson(file, null);
  if (!schema) {
    throw new Error(
      `No pinned schema found at server/llm/schemas/${task}.json. Either add it, or pass { schema } to llm.complete for this task.`,
    );
  }
  schemaCache.set(task, schema);
  return schema;
}

/**
 * Compile a schema with ajv, once per schema object.
 * Each schema gets its OWN Ajv instance: our schemas carry an "$id", and one
 * shared instance throws "schema with this id already exists" the moment two
 * schemas share one. Instances are cheap; that failure mode is not.
 */
function validatorFor(schema) {
  if (validatorCache.has(schema)) return validatorCache.get(schema);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  validatorCache.set(schema, validate);
  return validate;
}

/** ajv errors as short lines a model (and a human) can act on. */
function describeErrors(errors = []) {
  return errors.map((err) => `${err.instancePath || '(root)'} ${err.message}`);
}

/**
 * Pull the JSON out of a reply. With structured output switched on, the reply
 * IS the JSON — but if a model ever wraps it in a ```json fence, stripping that
 * here saves a repair round-trip, and a repair round-trip on Opus costs real
 * cents.
 */
function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

/** The follow-up message asking for a corrected reply. Sent at most once. */
function repairRequest(problems) {
  return [
    'The JSON in your previous reply did not match the required schema.',
    '',
    'Problems found:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Reply again with the corrected JSON only — same content, fixed so it matches the schema exactly. No explanation and no markdown fences.',
  ].join('\n');
}

/**
 * The default retry announcement.
 *
 * A 503 from either provider means "this model has no capacity right now", and
 * riding that out takes tens of seconds. Without this line the terminal shows
 * "asking the model…" and then nothing at all for half a minute, which reads
 * exactly like the hang that the timeouts exist to rule out.
 */
function announceRetry({ provider, task, status, attempt, of, waitMs }) {
  const why = status === 503 || status === 529 ? 'overloaded' : status === 429 ? 'rate limited' : `HTTP ${status}`;
  log(
    `  [${task}] ${provider} is ${why} — waiting ${(waitMs / 1000).toFixed(1)}s, then retrying (${attempt} of ${of})`,
  );
}

function buildAdapter(provider, { apiKey, fetchImpl, sleep, onRetry }) {
  const options = { apiKey, fetchImpl, sleep, onRetry };
  if (provider === 'anthropic') return createAnthropicAdapter(options);
  if (provider === 'gemini') return createGeminiAdapter(options);
  throw new Error(`No adapter for provider "${provider}".`);
}

/**
 * Run one model call.
 *
 * Required:
 *   task      logical task name from registry.js, e.g. 'parse-jd'
 *   messages  [{ role: 'user' | 'assistant', content: '...' }]
 * Optional:
 *   schema    JSON Schema the reply must satisfy (default: the task's pinned schema)
 *   system    system prompt string
 *   effort    'low' | 'medium' | 'high' | 'xhigh' | 'max' (default: registry's)
 *
 *   onRetry   called before each backoff wait, so a thirty-second pause is
 *             announced rather than silent. Defaults to a terminal line.
 *
 * Test and tooling seams (not used by app code):
 *   provider, apiKey, fetchImpl, sleep, ledgerFile
 *
 * Returns { data, usage: { inputTokens, outputTokens }, costCents, model, provider }
 * — the same keys for every provider and every task. Throws LlmError.
 */
export async function complete({
  task,
  schema,
  messages,
  system,
  effort,
  provider: providerOverride,
  apiKey: apiKeyOverride,
  fetchImpl,
  sleep,
  onRetry = announceRetry,
  ledgerFile = defaultLedgerFile(),
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error(`llm.complete needs a non-empty messages array (task "${task}").`);
  }
  for (const message of messages) {
    if (!message || typeof message.content !== 'string' || !message.role) {
      throw new Error(`Every message needs a role and string content (task "${task}").`);
    }
  }

  const provider = resolveProvider(providerOverride);
  const config = configFor(task, provider);
  const chosenEffort = effort ?? config.effort;
  if (!EFFORT_LEVELS.includes(chosenEffort)) {
    throw new Error(`Unknown effort "${chosenEffort}". Use one of: ${EFFORT_LEVELS.join(', ')}`);
  }

  const activeSchema = schema ?? loadPinnedSchema(task);
  const validate = validatorFor(activeSchema);

  const apiKey = apiKeyOverride ?? process.env[PROVIDERS[provider].apiKeyEnvVar];
  if (!apiKey) {
    // Nothing was sent, so nothing is written to the ledger: it records spend,
    // and this call did not spend anything.
    throw llmError('auth', {
      provider,
      task,
      model: config.model,
      message: `No ${PROVIDERS[provider].apiKeyEnvVar} found. Copy .env.example to .env and paste your ${provider} key into it.`,
    });
  }

  const adapter = buildAdapter(provider, { apiKey, fetchImpl, sleep, onRetry });

  // Which model name to look the price up under. Providers sometimes answer an
  // alias like "claude-sonnet-5" with the dated snapshot it actually ran
  // ("claude-sonnet-5-20260814"), which is not a row in pricing.js. Falling back
  // to the model we ASKED for keeps the cost right; without this, those calls
  // would quietly log as free, and a money log that under-reports is worse than
  // no money log at all.
  const priceUnder = (reportedModel) =>
    reportedModel && isPricedModel(reportedModel) ? reportedModel : config.model;

  // One ledger line per round-trip to the provider, success or failure — a
  // repaired call therefore writes two, because it was billed twice.
  const logCall = (fields) =>
    recordCall(
      {
        task,
        provider,
        model: fields.model ?? config.model, // what the provider says it ran
        inputTokens: fields.usage?.inputTokens ?? 0,
        outputTokens: fields.usage?.outputTokens ?? 0,
        costCents: costCents(priceUnder(fields.model), fields.usage ?? {}),
        ok: fields.ok,
        errorType: fields.errorType,
      },
      ledgerFile,
    );

  let conversation = messages;
  let problems = [];

  // A truncation is a measurement, not a verdict: the answer needed more room
  // than it was given. So the ceiling grows and the call is repeated, up to
  // twice — see headroom.js for why it is bounded. This is separate from the
  // attempt counter below, because running out of room is not a failed attempt
  // at the shape; it is the same attempt, interrupted.
  let maxTokens = config.maxTokens;
  let growths = 0;

  // Attempt 0 is the real call; attempt 1 is the single repair retry.
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    let reply;
    try {
      reply = await adapter.complete({
        task,
        model: config.model,
        maxTokens,
        timeoutMs: config.timeoutMs,
        effort: chosenEffort,
        system,
        messages: conversation,
        schema: activeSchema,
      });
    } catch (err) {
      if (err instanceof LlmError) {
        // Refusals and truncations still burnt tokens; record what they cost.
        logCall({ ok: false, errorType: err.type, model: err.model, usage: err.usage });

        if (err.type === 'truncated') {
          const bigger = nextCeiling(maxTokens, { growths, ceiling: configuredCeiling() });
          if (bigger !== null) {
            onRetry?.({ task, provider, attempt: growths + 1, reason: `ran out of room at ${maxTokens} tokens — retrying with ${bigger}` });
            maxTokens = bigger;
            growths += 1;
            attempt -= 1; // this was not an attempt at the shape, so it does not cost one
            continue;
          }
          // Out of room to grow into. The message says what was actually tried,
          // because "raise the ceiling" is not advice when it already has been.
          throw llmError('truncated', {
            provider,
            task,
            model: err.model,
            usage: err.usage,
            maxTokens,
            grown: growths > 0,
          });
        }
      }
      throw err;
    }

    let data;
    try {
      data = JSON.parse(extractJson(reply.text));
      problems = validate(data) ? [] : describeErrors(validate.errors);
    } catch (err) {
      data = undefined;
      problems = [`the reply was not valid JSON (${err.message})`];
    }

    if (problems.length === 0) {
      logCall({ ok: true, model: reply.model, usage: reply.usage });
      return {
        data,
        usage: reply.usage,
        costCents: costCents(priceUnder(reply.model), reply.usage),
        model: reply.model,
        provider,
      };
    }

    logCall({ ok: false, errorType: 'schema-mismatch', model: reply.model, usage: reply.usage });

    if (attempt === 1) {
      throw llmError('schema-mismatch', {
        provider,
        task,
        model: reply.model,
        usage: reply.usage,
        details: problems,
      });
    }

    // Ask once for a fix. The bad reply goes back as the assistant turn it was,
    // then the errors as a user turn — both providers accept that ordering,
    // and it reads to the model as an ordinary correction.
    conversation = [
      ...messages,
      { role: 'assistant', content: reply.text },
      { role: 'user', content: repairRequest(problems) },
    ];
  }

  // Unreachable: the loop either returns or throws.
  throw llmError('provider-error', { provider, task, model: config.model });
}

/** Call sites use `llm.complete(...)`. */
export const llm = { complete };
export default llm;
