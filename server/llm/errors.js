// Why this module exists: when a model call fails, you needs to know what to DO
// about it, not what HTTP status came back. Every failure in the LLM layer is
// raised as one LlmError with a `type` the UI can branch on and a message
// written in plain English for someone who is not a web engineer.
// Adding a new failure mode means adding a type here, not a new error class.

/** The complete list. Nothing outside this set is ever thrown by the LLM layer. */
export const LLM_ERROR_TYPES = [
  'auth', // the API key is missing, wrong, or not allowed to use this model
  'rate-limit', // provider said "too many requests", and our retries ran out
  'network', // we could not reach the provider at all
  'timeout', // the provider accepted the request and then never finished answering
  'schema-mismatch', // the model's JSON did not match the schema, twice
  'refusal', // the model declined to answer — never retried automatically
  'truncated', // the reply hit the length limit and stopped mid-way
  'provider-error', // the provider had a problem on their end (5xx, bad body)
];

// Mirrors the env var names in registry.js. Two strings are duplicated here on
// purpose so this module imports nothing and can never cause a circular import.
const API_KEY_ENV_VAR = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

const PROVIDER_LABEL = { anthropic: 'Anthropic', gemini: 'Gemini' };

function label(provider) {
  return PROVIDER_LABEL[provider] ?? provider ?? 'The model provider';
}

/**
 * The one error type this layer throws.
 *
 * Extra context (provider, model, task, status, usage) rides along so the
 * ledger can still record what a failed call cost and so the UI can say which
 * step broke, but the `message` alone is meant to be showable to you as-is.
 */
export class LlmError extends Error {
  constructor(type, message, context = {}) {
    super(message);
    if (!LLM_ERROR_TYPES.includes(type)) {
      // A typo in a type string would silently create an error the UI cannot
      // handle, so fail loudly right here instead.
      throw new Error(`Unknown LlmError type "${type}". Allowed: ${LLM_ERROR_TYPES.join(', ')}`);
    }
    this.name = 'LlmError';
    this.type = type;
    this.provider = context.provider ?? null;
    this.model = context.model ?? null;
    this.task = context.task ?? null;
    this.status = context.status ?? null;
    // Tokens the failed call still consumed, when the provider told us. The
    // ledger uses this so a refusal or a truncated reply is not free in the
    // running total when it was not free on the bill.
    this.usage = context.usage ?? null;
    this.details = context.details ?? null;
    // How hard it tried before giving up. Carried so the message can say so:
    // "we retried" is not believable without a number, and the number is the
    // difference between "wait a moment" and "something is properly wrong".
    this.attempts = context.attempts ?? null;
    this.elapsedMs = context.elapsedMs ?? null;
    if (context.cause !== undefined) this.cause = context.cause;
  }
}

/** The plain-language message for each failure type. */
function plainMessage(type, context) {
  const who = label(context.provider);
  const envVar = API_KEY_ENV_VAR[context.provider] ?? 'the API key';
  switch (type) {
    case 'auth':
      return `${who} rejected the API key — check ${envVar} in .env (no quotes, no trailing spaces).`;
    case 'rate-limit':
      return `${who} is asking us to slow down (too many requests). We waited and retried, and it kept saying no. Give it a minute and try again.`;
    case 'network':
      return `Could not reach ${who} — check your internet connection, then try again.`;
    case 'timeout':
      // This used to say "lower its effort or maxTokens in
      // server/llm/registry.js", which contradicted the one rule that keeps
      // `git pull` conflict-free: model settings go in .env, never in the
      // tracked table. Advice you are told not to follow is worse than none.
      return `${who} took longer than ${Math.round((context.timeoutMs ?? 0) / 1000)} seconds to answer and the request was given up on, so nothing was charged for a reply you never got. Try again — most timeouts are the provider being briefly slow. If this step keeps timing out, give it longer by adding LLM_TIMEOUT_MS=600000 to .env (that is ten minutes, and it applies to every step), then restart the server.`;
    case 'schema-mismatch':
      return `${who} replied with JSON that did not fit the format this step needs, and the one repair attempt did not fix it. Try again; if it keeps happening, the prompt or the schema for this task needs a look.`;
    case 'refusal':
      return `${who} declined to answer this request, so nothing was retried. Check the pasted text for anything that might have tripped a safety filter, then try again.`;
    case 'truncated': {
      // Reaching this means the ceiling was ALREADY raised and tried again —
      // server/llm/headroom.js doubles it up to twice before anything is
      // reported. So this must not suggest raising it as though nobody had.
      const ceiling = context.maxTokens ? ` even at ${context.maxTokens} tokens` : '';
      return context.grown
        ? `The reply was cut off before it finished${ceiling}, after the app had already doubled the room and tried again. Something is wrong beyond length — usually a prompt asking for far more than it means to. Nothing was saved, and nothing you can put in .env will fix this one. If it is a CV, generating it with fewer publications ticked is the quickest thing to try.`
        : `The reply was cut off before it finished — it ran out of room${ceiling}. On Gemini the model's own reasoning is charged against the same budget as the answer, so a long document can hit the ceiling mid-sentence. Nothing was saved. Try again; if it keeps happening, add MAX_TOKENS_CEILING=262144 to .env and restart to let the app grow further on its own.`;
    }
    case 'provider-error':
      return providerErrorMessage(who, context);
    default:
      return `${who} call failed.`;
  }
}

/**
 * Build an LlmError with the standard plain-language message for its type.
 * Pass `message` in the context to override the wording for a special case.
 */
/**
 * A 503 is not a generic server fault, and saying so is the difference between
 * useful and not.
 *
 * Both providers use it to mean the same thing: this MODEL has no capacity
 * right now. Nothing is wrong with the key, the request or the document, and
 * "wait a few minutes" is only one of the answers — the other is to use a model
 * that is not currently swamped, which free-tier flash models routinely are.
 */
function providerErrorMessage(who, context = {}) {
  const overloaded =
    context.status === 503 ||
    context.status === 529 ||
    /overloaded|UNAVAILABLE|try again later/i.test(String(context.details ?? ''));

  const seconds = Math.max(1, Math.round((context.elapsedMs ?? 0) / 1000));
  const tried = context.attempts > 1
    ? ` It was tried ${context.attempts} times over about ${seconds} second${seconds === 1 ? '' : 's'}.`
    : '';

  if (overloaded) {
    return (
      `${who} has no capacity for this model at the moment (HTTP ${context.status ?? 503} — "overloaded").` +
      `${tried} Nothing is wrong with your key, your request or your document.` +
      ' Wait a few minutes and try again. If it keeps happening, the free flash models get busy at peak times:' +
      ' run `npm run models` to see what else your key can reach, and put one in .env as MODEL_GEMINI=…' +
      ' — or switch provider with LLM_PROVIDER.'
    );
  }

  return (
    `${who} had a problem on their end${context.status ? ` (HTTP ${context.status})` : ''}.` +
    `${tried} That is theirs to fix, not yours. Wait a few minutes and try again.`
  );
}

export function llmError(type, context = {}) {
  return new LlmError(type, context.message ?? plainMessage(type, context), context);
}
