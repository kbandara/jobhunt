// Why this module exists: the credit pot is small and finite, so every call has
// to be costed the moment it happens — a running total nobody maintains is a
// total nobody trusts. Prices live in exactly one table here; the ledger and the
// UI both read cost from this file, so a price change is a one-line edit.
//
// Units: CENTS (US) per MILLION tokens. Not dollars, not per-token — those two
// conversions are where cost code usually gets a factor of 1000 wrong.

export const PRICES = {
  // Anthropic list prices as verified 2026-08-02 (see docs/ARCHITECTURE.md).
  // NOTE on claude-sonnet-5: introductory pricing of $2/$10 per Mtok runs
  // through 2026-08-31. This table deliberately stores the STANDARD $3/$15
  // rate, so during the promo the app over-estimates rather than under-
  // estimates. Every cost in this app is an ESTIMATE — the provider's own
  // dashboard is the authority on what was actually billed.
  'claude-sonnet-5': { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
  'claude-haiku-4-5': { inputCentsPerMillion: 100, outputCentsPerMillion: 500 },
  'claude-opus-5': { inputCentsPerMillion: 500, outputCentsPerMillion: 2500 },

  // Gemini: zero because the recommended setup is the free AI Studio tier, where these
  // calls cost nothing. UNVERIFIED — the model IDs themselves still need
  // confirming (see registry.js). When you move to a paid Gemini plan, fill in
  // the real per-Mtok cents here and the ledger starts costing Gemini calls
  // with no other change anywhere.
  'gemini-3.5-flash': { inputCentsPerMillion: 0, outputCentsPerMillion: 0 },
  'gemini-3.6-flash': { inputCentsPerMillion: 0, outputCentsPerMillion: 0 },
  'gemini-3.5-flash-lite': { inputCentsPerMillion: 0, outputCentsPerMillion: 0 },
};

/**
 * Estimated cost of one call, in cents.
 *
 * An unknown model costs 0 rather than throwing: a call that already succeeded
 * must still get a ledger line, and a missing price row should never be the
 * thing that breaks a document generation. Unknown models show as free, which
 * is visibly wrong in the UI and therefore gets noticed.
 */
export function costCents(model, usage = {}) {
  const price = PRICES[model];
  if (!price) return 0;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cents =
    (inputTokens / 1_000_000) * price.inputCentsPerMillion +
    (outputTokens / 1_000_000) * price.outputCentsPerMillion;
  // Four decimal places of a cent: enough that a batch of cheap calls does not
  // round away to zero, few enough that the ledger stays readable.
  return Math.round(cents * 10_000) / 10_000;
}

/** True when we have a real price row for this model (used by smoke output). */
export function isPricedModel(model) {
  return Object.prototype.hasOwnProperty.call(PRICES, model);
}
