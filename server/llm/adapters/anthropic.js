// Why this module exists: it is the only place in the app that knows what
// Anthropic's HTTP API looks like. It turns our neutral request (model,
// messages, schema) into their wire format and their reply back into ours, so
// nothing above this file has to care which provider is configured. It never
// touches the network directly — it calls whatever `fetchImpl` it was handed,
// which is how tests run offline and how fixtures get recorded.
//
// The retry loop is written out longhand here rather than shared with the Gemini
// adapter on purpose: when a provider call misbehaves at 11pm, the whole story
// for that provider should be readable in one file.
import { llmError } from '../errors.js';
import { fetchWithTimeout, retryDelayMs, shouldRetry, MAX_RETRIES } from './http.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Verified against Anthropic's docs on 2026-08-02 (see docs/ARCHITECTURE.md). Do NOT
// add temperature / top_p / top_k / thinking budget to the request body: on
// Sonnet 5 and Opus 5 those return HTTP 400. Thinking is adaptive, and the cost
// dial is output_config.effort.
const API_VERSION = '2023-06-01';


function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How long to wait before retry number `attempt` (0-based). */
function headerValue(response, name) {
  try {
    return response.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

export function createAnthropicAdapter({
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = realSleep,
  endpoint = ENDPOINT,
  // Called before each wait, so a thirty-second backoff is not a silent one.
  onRetry,
} = {}) {
  return {
    provider: 'anthropic',

    /**
     * One round-trip. Returns { text, usage, model, stopReason }; the caller
     * parses and validates the JSON, because that logic is identical for both
     * providers and lives in ../index.js.
     */
    async complete({ task, model, maxTokens, timeoutMs, effort, system, messages, schema }) {
      // See the note in the Gemini adapter: the deadline is per task.
      const context = { provider: 'anthropic', task, model, timeoutMs };

      const body = {
        model,
        max_tokens: maxTokens,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        output_config: {
          // Structured output. The older top-level `output_format` is deprecated.
          format: { type: 'json_schema', schema },
          effort,
        },
      };
      if (system) body.system = system;
      const startedAt = Date.now();

      for (let attempt = 0; ; attempt += 1) {
        // fetchWithTimeout raises the typed error itself: 'network' when the
        // request never made it (DNS, TLS, offline), 'timeout' when the
        // provider accepted it and then never finished answering.
        const response = await fetchWithTimeout(
          fetchImpl,
          endpoint,
          {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': API_VERSION,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          },
          context,
        );

        const rawBody = await readBody(response);

        if (!response.ok) {
          const status = response.status;
          if (status === 401 || status === 403) {
            throw llmError('auth', { ...context, status, details: rawBody.slice(0, 400) });
          }
          const elapsedMs = Date.now() - startedAt;
          if (shouldRetry({ status, attempt, elapsedMs })) {
            const wait = retryDelayMs(attempt, headerValue(response, 'retry-after'));
            onRetry?.({ provider: 'anthropic', task, status, attempt: attempt + 1, of: MAX_RETRIES, waitMs: wait });
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
              'Anthropic replied with something that was not JSON at all. That usually means a proxy or network appliance interfered with the request.',
          });
        }

        const usage = {
          inputTokens: payload.usage?.input_tokens ?? 0,
          outputTokens: payload.usage?.output_tokens ?? 0,
        };
        const usedModel = payload.model ?? model;

        // stop_reason is checked BEFORE reading the content, because on a
        // refusal or a truncation the content is absent or half-written and
        // parsing it would produce a confusing schema error instead of the
        // real problem.
        if (payload.stop_reason === 'refusal') {
          throw llmError('refusal', { ...context, model: usedModel, usage });
        }
        if (payload.stop_reason === 'max_tokens') {
          throw llmError('truncated', { ...context, model: usedModel, usage });
        }

        const textBlock = payload.content?.find((block) => block.type === 'text');
        if (!textBlock || typeof textBlock.text !== 'string') {
          throw llmError('provider-error', {
            ...context,
            model: usedModel,
            usage,
            message:
              'Anthropic returned a reply with no text in it, so there was nothing to read. Try again.',
          });
        }

        return { text: textBlock.text, usage, model: usedModel, stopReason: payload.stop_reason ?? null };
      }
    },
  };
}

/** Read the body as text once. Error bodies are sometimes HTML, not JSON. */
async function readBody(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
