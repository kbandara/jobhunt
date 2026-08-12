// Why this module exists: no call site in this app may ever name a model. Call
// sites name a TASK ("parse-jd"), and this table turns that plus the configured
// provider into a concrete model, token ceiling and effort level. Swapping
// Anthropic for Gemini is then an .env change, and a model ID drifting is a
// one-line edit here instead of a search across the codebase.

/** Providers this app can talk to, and where each one's key comes from. */
export const PROVIDERS = {
  anthropic: { apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
  gemini: { apiKeyEnvVar: 'GEMINI_API_KEY' },
};

// Gemini, because it is the one with a free tier: somebody trying this app for
// the first time should not have to buy credits to find out whether they want
// it. Overridden by LLM_PROVIDER in .env, which the setup screen writes.
export const DEFAULT_PROVIDER = 'gemini';

// Anthropic's cost dial. Higher effort = more internal reasoning = more output
// tokens = more money. Gemini has no equivalent parameter today, so effort is
// carried through the registry for both providers but only sent to Anthropic.
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

// ---------------------------------------------------------------------------
// The table. Rows are tasks; columns are providers.
//
// Anthropic mapping and effort defaults are VERIFIED (2026-08-02).
//
// !!! GEMINI MODEL IDs ARE UNVERIFIED — CHECK THEM FIRST !!!
// No build session could reach Google's docs (the sandbox blocks them), so
// these are best-effort. Search results in August 2026 indicate the 2.x line is
// retired and current IDs are a 3.x series, so every row below uses
// "gemini-3.5-flash": one string to correct if it is wrong, and a flash-tier
// model keeps you inside the free tier.
//
// BEFORE THE FIRST REAL GEMINI CALL, RUN:
//     npm run models
// with GEMINI_API_KEY set. It asks Google what your key can actually reach and
// prints "MISSING" against anything here that no longer exists, followed by the
// real list. Edit the strings below to match; nothing else in the app changes.
//
// Generation quality note: parse/score are cheap and fine on flash. If
// `npm run models` shows a stronger (pro-tier) model your key can reach,
// consider putting the three generate-* rows on it — the CV is the call whose
// quality matters most. Check Google's free-tier limits before you do.
// ---------------------------------------------------------------------------
//
// TIMEOUTS ARE PER TASK. One number for everything was wrong in both
// directions: 180 seconds is a long time to wait for a parse that should take
// five, and not long enough for a task that writes a whole CV — the revise box
// timed out on Gemini doing exactly that. Reading a job ad should fail fast;
// writing a document should be given room.
const REGISTRY = {
  'parse-jd': {
    anthropic: { model: 'claude-sonnet-5', maxTokens: 4096, effort: 'low', timeoutMs: 120_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 4096, effort: 'low', timeoutMs: 120_000 },
  },
  'score-batch': {
    anthropic: { model: 'claude-haiku-4-5', maxTokens: 4096, effort: 'low', timeoutMs: 120_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 4096, effort: 'low', timeoutMs: 120_000 },
  },
  'score-deep': {
    anthropic: { model: 'claude-sonnet-5', maxTokens: 4096, effort: 'medium', timeoutMs: 180_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 4096, effort: 'medium', timeoutMs: 180_000 },
  },
  // Reads the finished draft rather than the profile, so it is a short read of a
  // long document — the same class of task as score-deep, not as generation.
  'review-cv': {
    anthropic: { model: 'claude-sonnet-5', maxTokens: 8192, effort: 'medium', timeoutMs: 180_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 8192, effort: 'medium', timeoutMs: 180_000 },
  },
  'generate-cv': {
    anthropic: { model: 'claude-opus-5', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
  },
  'generate-cover-letter': {
    anthropic: { model: 'claude-opus-5', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
  },
  'generate-criteria': {
    anthropic: { model: 'claude-opus-5', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
  },
  // A cold email is 150 words, so the ceiling is small — but the thinking behind
  // it is not. Choosing the one thing worth saying to a company that never asked
  // is the hardest judgement in the app, and a cheaper model spends the budget
  // on enthusiasm.
  'generate-cold-email': {
    anthropic: { model: 'claude-opus-5', maxTokens: 8192, effort: 'high', timeoutMs: 240_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 8192, effort: 'high', timeoutMs: 240_000 },
  },
  // Drafting a CV profile is a writing task like the generate-* rows above — it
  // has to produce a prompt file in the house voice — but its output is one
  // config plus a page of prose, so the ceiling is a fraction of theirs.
  'draft-profile': {
    anthropic: { model: 'claude-opus-5', maxTokens: 8192, effort: 'high', timeoutMs: 180_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 8192, effort: 'high', timeoutMs: 180_000 },
  },
  // Answering a question about a draft, and rewriting it on request. Sized and
  // timed like the generate-* rows because a revision returns the WHOLE
  // document, not a patch — the reply is a few sentences and the rest is the CV
  // over again. Treating it as a quick chat reply is what made it time out.
  'revise-doc': {
    anthropic: { model: 'claude-opus-5', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
  },
  // Reading a whole CV and turning it into records. The input is a long
  // document and the output is a structured entry per thing in it, so both
  // ceilings are generous — and the deadline is, because this runs once and
  // getting it complete matters far more than getting it quickly.
  'import-profile': {
    anthropic: { model: 'claude-opus-5', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
  },
  // Tightening the wording of records that already exist. Sized like a
  // generation because it returns every rewritten record in full, and there can
  // be forty of them.
  'polish-profile': {
    anthropic: { model: 'claude-opus-5', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
    gemini: { model: 'gemini-3.5-flash', maxTokens: 32768, effort: 'high', timeoutMs: 420_000 },
  },
};

/** Every task name the LLM layer knows about. */
export const TASKS = Object.keys(REGISTRY);

/**
 * Model names can be overridden from .env, so correcting a retired model ID
 * never means editing this file. That matters because this file is code that
 * gets updated, while .env is yours alone and is never in git — so an override
 * here survives every `git pull` without a merge conflict.
 *
 *   MODEL_GEMINI=gemini-3.6-flash              every Gemini task
 *   MODEL_GEMINI_GENERATE_CV=gemini-3.6-pro    just that one task (wins)
 *
 * Task names become upper case with underscores: generate-cv -> GENERATE_CV.
 */
function envOverride(prefix, task, provider) {
  const suffix = task.toUpperCase().replace(/-/g, '_');
  const scope = provider.toUpperCase();
  return (
    process.env[`${prefix}_${scope}_${suffix}`] || process.env[`${prefix}_${scope}`] || null
  );
}

/**
 * Output ceiling, overridable from .env as MAX_TOKENS_GEMINI or
 * MAX_TOKENS_GEMINI_GENERATE_CV. Raise this when a step fails as "truncated":
 * on Gemini the model's internal reasoning is charged against this same budget,
 * so a long document can run out of room before it has finished writing.
 */
function maxTokensOverride(task, provider) {
  const raw = envOverride('MAX_TOKENS', task, provider);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function modelOverride(task, provider) {
  const suffix = task.toUpperCase().replace(/-/g, '_');
  const scope = provider.toUpperCase();
  return process.env[`MODEL_${scope}_${suffix}`] || process.env[`MODEL_${scope}`] || null;
}

/**
 * How long to wait for this task, in milliseconds.
 *
 * `LLM_TIMEOUT_MS` is the blunt instrument and wins over everything, because it
 * is what the timeout message tells you to reach for and that advice has to be
 * true. Below it, `TIMEOUT_MS_GEMINI_REVISE_DOC` and friends adjust one task on
 * one provider, and the table's own value is the default.
 */
function timeoutOverride(task, provider) {
  const blanket = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isFinite(blanket) && blanket > 0) return blanket;
  const scoped = Number(envOverride('TIMEOUT_MS', task, provider));
  return Number.isFinite(scoped) && scoped > 0 ? scoped : null;
}

/**
 * Look up the model config for one task on one provider.
 * Throws a descriptive plain Error (not an LlmError) because a bad task name is
 * a programming mistake in this repo, not something the provider did.
 */
export function configFor(task, provider) {
  const row = REGISTRY[task];
  if (!row) {
    throw new Error(`Unknown LLM task "${task}". Known tasks: ${TASKS.join(', ')}`);
  }
  const config = row[provider];
  if (!config) {
    throw new Error(
      `Task "${task}" has no model configured for provider "${provider}". Known providers: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  const model = modelOverride(task, provider);
  const maxTokens = maxTokensOverride(task, provider);
  const timeoutMs = timeoutOverride(task, provider);
  return {
    ...config,
    ...(model ? { model } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
}

/**
 * Every model this registry asks for on one provider, mapped to the tasks that
 * use it. `npm run models` diffs this against what the provider says your key
 * can reach, which is how a retired model ID gets caught before it 404s
 * mid-generation.
 */
export function modelsInUse(provider) {
  const inUse = new Map();
  for (const task of TASKS) {
    if (!REGISTRY[task][provider]) continue;
    // configFor, not the raw table, so a MODEL_* override in .env is what gets
    // checked — otherwise this would verify a model you are not using.
    const { model } = configFor(task, provider);
    if (!inUse.has(model)) inUse.set(model, []);
    inUse.get(model).push(task);
  }
  return inUse;
}

/**
 * Which provider to use: an explicit argument beats LLM_PROVIDER in .env, which
 * beats the default. Validated here so a typo in .env fails with a clear
 * message instead of a confusing 404 from some provider.
 */
export function resolveProvider(explicit) {
  const provider = explicit ?? process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER;
  if (!PROVIDERS[provider]) {
    throw new Error(
      `LLM_PROVIDER is "${provider}", which is not a provider this app knows. Use one of: ${Object.keys(PROVIDERS).join(', ')}`,
    );
  }
  return provider;
}
