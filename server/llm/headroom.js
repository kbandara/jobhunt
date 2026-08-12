// WHY: "the reply was cut off — raise MAX_TOKENS_GEMINI_GENERATE_CV in .env and
// restart" is a real explanation of a real failure, and it is still the wrong
// thing for the app to do. It knows exactly what went wrong, it knows exactly
// what would fix it, and it stopped to ask permission — mid-application, after
// you had already waited for the model, having saved nothing.
//
// A truncation is not an error condition to report. It is a measurement: the
// answer needed more room than it was given. The right response is to give it
// more room and ask again, and to say something only if that also fails.
//
// WHY IT IS BOUNDED. Retrying costs a whole second call, and on Gemini the
// model's own reasoning is charged against the same budget, so a task that
// genuinely cannot fit would double its bill on every attempt. Two growth steps
// is enough for every real case seen — a CV that overflows 32k finishes inside
// 64k — and past that the honest answer is that something else is wrong.

/** How much bigger each retry gets. Doubling, because +10% would take all day. */
export const GROWTH = 2;

/** How many times to grow before giving up. */
export const MAX_GROWTHS = 2;

/**
 * The hardest ceiling to ask any provider for.
 *
 * Providers reject a max_tokens above what the model supports, and that failure
 * is a 400 rather than a truncation — turning a recoverable problem into an
 * unrecoverable one. This is deliberately below every current model's limit;
 * override it with MAX_TOKENS_CEILING in .env if a model outgrows it.
 */
export const DEFAULT_CEILING = 131_072;

/**
 * The next ceiling to try after a truncation, or null when there is no room to
 * grow into.
 *
 * @param {number} current the ceiling that was not enough
 * @param {object} [options]
 * @param {number} [options.growths] how many times this call has already grown
 * @param {number} [options.ceiling] the hard cap
 * @returns {number|null} null means "stop, and report the truncation"
 */
export function nextCeiling(current, { growths = 0, ceiling = DEFAULT_CEILING } = {}) {
  if (!Number.isFinite(current) || current <= 0) return null;
  if (growths >= MAX_GROWTHS) return null;
  if (current >= ceiling) return null;
  return Math.min(current * GROWTH, ceiling);
}

/** The cap, from .env if it is set there and sane. */
export function configuredCeiling(env = process.env) {
  const raw = Number(env.MAX_TOKENS_CEILING);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CEILING;
}
