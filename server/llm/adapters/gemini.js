// Why this module exists: the same job as adapters/anthropic.js, for Google's
// Gemini API — you moves here when the Anthropic credits run out, and that move
// must not touch a single call site. The interesting part is downConvert():
// Gemini's responseSchema accepts only a SUBSET of JSON Schema, so our pinned
// schemas have to be translated on the way out while still being validated in
// full on the way back. Everything reaches the network through the injected
// `fetchImpl`, so tests never touch it.
//
// !!! UNVERIFIED WIRE SHAPE !!! The build session could not reach
// https://ai.google.dev/api/generate-content (blocked by the sandbox network),
// so this file is written from the brief's recorded shape plus prior knowledge.
// Confirm with `npm run smoke` (GEMINI_API_KEY set) before trusting it for real
// work — the model IDs in registry.js are the most likely thing to be wrong.
import { llmError } from '../errors.js';
import { fetchWithTimeout, retryDelayMs, shouldRetry, MAX_RETRIES } from './http.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// JSON Schema keywords Gemini's responseSchema rejects or ignores. Dropping
// additionalProperties is safe here: it is enforced on the way back by ajv
// against the FULL schema, which is what actually protects us.
const KEYWORDS_GEMINI_REJECTS = ['$id', '$schema', 'additionalProperties'];

/**
 * Translate one of our pinned JSON Schemas into the subset Gemini accepts.
 *
 * Two conversions matter, and both appear in our pinned schemas:
 *   1. drop $id / $schema / additionalProperties
 *   2. {"type": ["string", "null"]}  ->  {"type": "string", "nullable": true}
 *
 * Exported so the conformance suite can test it directly — if this quietly
 * stopped converting nullables, Gemini would start rejecting our requests with
 * an obscure 400 and nothing else would explain why.
 */
export function downConvert(node) {
  if (Array.isArray(node)) return node.map(downConvert);
  if (node === null || typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (KEYWORDS_GEMINI_REJECTS.includes(key)) continue;

    if (key === 'type' && Array.isArray(value)) {
      const realTypes = value.filter((t) => t !== 'null');
      // Our schemas only ever use ["something", "null"], so the first non-null
      // type is the type. A union of two real types would need a rethink, and
      // this comment is where that conversation starts.
      out.type = realTypes[0] ?? 'string';
      if (value.includes('null')) out.nullable = true;
      continue;
    }

    if (key === 'properties') {
      const properties = {};
      for (const [name, sub] of Object.entries(value)) properties[name] = downConvert(sub);
      out.properties = properties;
      continue;
    }

    out[key] = downConvert(value);
  }
  return out;
}

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerValue(response, name) {
  try {
    return response.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

// Gemini stops for these reasons when it has decided not to answer. Only SAFETY
// is named in the brief; the others are the same family and are treated the
// same way — surfaced, never auto-retried.
const REFUSAL_FINISH_REASONS = ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'RECITATION', 'SPII'];

export function createGeminiAdapter({
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = realSleep,
  baseUrl = BASE_URL,
  // Called before each wait, so a thirty-second backoff is not a silent one.
  onRetry,
} = {}) {
  return {
    provider: 'gemini',

    /** One round-trip. Same return shape as the Anthropic adapter. */
    async complete({ task, model, maxTokens, timeoutMs, system, messages, schema }) {
      // timeoutMs rides in the context so fetchWithTimeout uses the registry's
      // per-task deadline rather than one global number that suits neither a
      // five-second parse nor a two-minute rewrite.
      const context = { provider: 'gemini', task, model, timeoutMs };

      const body = {
        contents: messages.map((m) => ({
          // Gemini calls the assistant "model"; everything else is "user".
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: downConvert(schema),
          // The registry's per-task token ceiling, so both providers stop at the
          // same place and truncation behaves the same way on each.
          maxOutputTokens: maxTokens,
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      // NOTE: `effort` is deliberately not sent. It is an Anthropic parameter;
      // Gemini's nearest equivalent is generationConfig.thinkingConfig, which
      // this session could not verify. Confirm at smoke time before adding it.

      const url = `${baseUrl}/${encodeURIComponent(model)}:generateContent`;
      const startedAt = Date.now();

      for (let attempt = 0; ; attempt += 1) {
        // fetchWithTimeout throws the typed network/timeout error itself.
        const response = await fetchWithTimeout(
          fetchImpl,
          url,
          {
            method: 'POST',
            headers: {
              'x-goog-api-key': apiKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          },
          context,
        );

        const rawBody = await readBody(response);

        if (!response.ok) {
          const status = response.status;
          // Google returns a plain 400 for a bad key, not a 401.
          const looksLikeBadKey = /API_KEY_INVALID|API key not valid|API key expired/i.test(rawBody);
          if (status === 401 || status === 403 || (status === 400 && looksLikeBadKey)) {
            throw llmError('auth', { ...context, status, details: rawBody.slice(0, 400) });
          }
          if (status === 404) {
            throw llmError('provider-error', {
              ...context,
              status,
              details: rawBody.slice(0, 400),
              message: `Gemini does not recognise the model "${model}". Google renames and retires model IDs regularly — check the current ID at https://ai.google.dev/gemini-api/docs/models and update server/llm/registry.js.`,
            });
          }
          const elapsedMs = Date.now() - startedAt;
          if (shouldRetry({ status, attempt, elapsedMs })) {
            const wait = retryDelayMs(attempt, headerValue(response, 'retry-after'));
            // Said out loud: a silent thirty-second pause is indistinguishable
            // from a hang, and this is the one place the app deliberately waits.
            onRetry?.({ provider: 'gemini', task, status, attempt: attempt + 1, of: MAX_RETRIES, waitMs: wait });
            await sleep(wait);
            continue;
          }
          throw llmError(status === 429 ? 'rate-limit' : 'provider-error', {
            ...context,
            status,
            attempts: attempt + 1,
            elapsedMs,
            details: rawBody.slice(0, 400),
          });
        }

        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch (cause) {
          throw llmError('provider-error', {
            ...context,
            status: response.status,
            cause,
            message:
              'Gemini replied with something that was not JSON at all. That usually means a proxy or network appliance interfered with the request.',
          });
        }

        const usage = {
          inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        };
        const usedModel = payload.modelVersion ?? model;

        // Blocked prompts come back with no candidate at all, just a reason.
        if (payload.promptFeedback?.blockReason) {
          throw llmError('refusal', { ...context, model: usedModel, usage });
        }

        const candidate = payload.candidates?.[0];
        const finishReason = candidate?.finishReason ?? null;

        // Checked before reading the text, for the same reason as Anthropic:
        // half-written JSON produces a misleading schema error.
        if (REFUSAL_FINISH_REASONS.includes(finishReason)) {
          throw llmError('refusal', { ...context, model: usedModel, usage });
        }
        if (finishReason === 'MAX_TOKENS') {
          throw llmError('truncated', { ...context, model: usedModel, usage });
        }

        const parts = candidate?.content?.parts ?? [];
        const text = parts
          .filter((part) => typeof part.text === 'string')
          .map((part) => part.text)
          .join('');
        if (!candidate || text === '') {
          throw llmError('provider-error', {
            ...context,
            model: usedModel,
            usage,
            message: 'Gemini returned a reply with no text in it, so there was nothing to read. Try again.',
          });
        }

        return { text, usage, model: usedModel, stopReason: finishReason };
      }
    },
  };
}

async function readBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
