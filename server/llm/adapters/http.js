// WHY: fetch has no timeout of its own. Without one, a provider that accepts a
// request and then stalls leaves the browser button spinning forever with
// nothing to report — which is exactly what happened the first time a real CV
// was generated. Every provider call goes through here so that cannot recur.
import { llmError } from '../errors.js';

/** Long enough for a slow generation, short enough that you notice. */
export const DEFAULT_TIMEOUT_MS = 180_000;

// --- retrying -----------------------------------------------------------------
//
// Both adapters retry the same statuses for the same reasons, and both used to
// carry their own copy of the policy: three retries at 1s, 2s, 4s. That is about
// seven seconds of patience, which is fine for a blip and useless against what
// actually happens — a Gemini 503 means "this model is overloaded right now",
// and free-tier flash models are overloaded for minutes at a time at peak. It
// gave up long before the condition it was retrying could clear.

/** Retries AFTER the first attempt. 1s, 2s, 4s, 8s, 16s — about half a minute. */
export const MAX_RETRIES = 5;

export const BASE_BACKOFF_MS = 1000;

/**
 * Ceiling on the whole retry sequence.
 *
 * Needed because the deadline in fetchWithTimeout is per attempt, not per call:
 * without this, six attempts against a provider that accepts and then stalls
 * could take six times the task timeout, and you would be watching a spinner for
 * the better part of an hour.
 */
export const RETRY_BUDGET_MS = 90_000;

/**
 * How long to wait before attempt N+1.
 *
 * `retry-after` wins when the provider sends one — it knows more than we do.
 * Otherwise exponential, with jitter: a fixed schedule has every retry land at
 * the same moment as everyone else's, which is exactly when a server shedding
 * load is least able to answer.
 *
 * @param {number} attempt zero-based
 * @param {string|null} retryAfterHeader seconds, as the provider sent it
 * @param {Function} [random] injected so tests are deterministic
 */
export function retryDelayMs(attempt, retryAfterHeader, random = Math.random) {
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  const base = Math.min(BASE_BACKOFF_MS * 2 ** attempt, 30_000);
  // Full jitter over the top half of the window: still grows, never synchronised.
  return Math.round(base * (0.5 + random() * 0.5));
}

/**
 * Is another attempt worth making?
 *
 * @param {object} options
 * @param {number} options.status the HTTP status just received
 * @param {number} options.attempt zero-based, the one that just failed
 * @param {number} options.elapsedMs since the first attempt began
 */
export function shouldRetry({ status, attempt, elapsedMs = 0 }) {
  const worthRetrying = status === 429 || status === 529 || status >= 500;
  return worthRetrying && attempt < MAX_RETRIES && elapsedMs < RETRY_BUDGET_MS;
}

export function configuredTimeoutMs() {
  const raw = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * One provider request, with a deadline.
 * Distinguishes "we ran out of patience" from "the network broke", because the
 * two need different advice: retry vs check your connection.
 *
 * @param {Function} fetchImpl injected so tests never touch the network
 * @param {object} context provider/task/model, for the error message
 */
export async function fetchWithTimeout(fetchImpl, url, options, context = {}) {
  const timeoutMs = context.timeoutMs ?? configuredTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (cause) {
    // A stub fetch in a test may ignore the signal entirely; only treat this as
    // a timeout when the abort actually fired.
    if (controller.signal.aborted) {
      throw llmError('timeout', { ...context, timeoutMs, cause });
    }
    throw llmError('network', { ...context, cause });
  } finally {
    clearTimeout(timer);
  }
}
