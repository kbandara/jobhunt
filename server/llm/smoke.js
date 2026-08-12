// Why this file exists: the test suite proves the code is consistent with
// itself, and proves nothing at all about whether a key works or a model ID is
// still real. This script is the opposite: real keys, real calls, real money —
// run by hand, never by `npm test`. It is the only thing that can confirm the
// Gemini model IDs in registry.js, which were written without access to
// Google's docs and are marked UNVERIFIED there.
//
// Run:  npm run smoke        (needs ANTHROPIC_API_KEY and/or GEMINI_API_KEY in .env)
// Cost: a few thousandths of a cent — each call sends about twenty tokens.
import { complete } from './index.js';
import { PROVIDERS, TASKS, configFor } from './registry.js';
import { isPricedModel } from './pricing.js';

// Node reads .env itself since v21; no dependency needed. Missing file is fine —
// the keys may already be in the environment.
try {
  process.loadEnvFile();
} catch {
  /* no .env; fall back to whatever is already in the environment */
}

// The smallest structured request that still proves structured output works.
const TINY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
};

const TINY_MESSAGES = [{ role: 'user', content: 'Reply with {"ok": true} and nothing else.' }];

/**
 * Every distinct model this provider is configured to use, with one task that
 * uses it. All of them get called: a key that works on the cheap model can
 * still be barred from the expensive one, and a model ID can be retired on its
 * own. This is the check that catches both.
 */
function modelsToCheck(provider) {
  const seen = new Map(); // model -> representative task
  for (const task of TASKS) {
    const { model } = configFor(task, provider);
    if (!seen.has(model)) seen.set(model, task);
  }
  return [...seen.entries()].map(([model, task]) => ({ model, task }));
}

function pad(text, width) {
  return String(text).padEnd(width);
}

async function smokeProvider(provider) {
  const envVar = PROVIDERS[provider].apiKeyEnvVar;
  console.log(`\n${provider}`);

  if (!process.env[envVar]) {
    console.log(`  SKIPPED — no ${envVar} in .env`);
    return { ran: 0, failed: 0 };
  }

  let ran = 0;
  let failed = 0;
  for (const { model, task } of modelsToCheck(provider)) {
    ran += 1;
    try {
      const result = await complete({
        task,
        schema: TINY_SCHEMA,
        messages: TINY_MESSAGES,
        system: 'You reply only with JSON matching the schema.',
        provider,
        effort: 'low',
      });
      const priced = isPricedModel(result.model) ? '' : '  (no price on file for this model)';
      console.log(
        `  PASS  ${pad(model, 20)} answered ${JSON.stringify(result.data)}  ` +
          `in ${result.usage.inputTokens} / out ${result.usage.outputTokens} tokens  ` +
          `${result.costCents.toFixed(4)}c${priced}`,
      );
      if (result.model !== model) {
        console.log(`        note: the provider reported the model as "${result.model}"`);
      }
    } catch (err) {
      failed += 1;
      console.log(`  FAIL  ${pad(model, 20)} [${err.type ?? 'error'}] ${err.message}`);
    }
  }
  return { ran, failed };
}

async function main() {
  console.log('Live smoke test. This makes real API calls and spends a tiny amount of real money.');
  console.log('It never sends anything from profile/ — just "reply with ok: true".');

  let ran = 0;
  let failed = 0;
  for (const provider of Object.keys(PROVIDERS)) {
    const result = await smokeProvider(provider);
    ran += result.ran;
    failed += result.failed;
  }

  console.log('');
  if (ran === 0) {
    console.log('Nothing ran: no API keys found. Copy .env.example to .env and paste a key in.');
    process.exitCode = 1;
    return;
  }
  console.log(failed === 0 ? `PASS — ${ran} calls, all good.` : `FAIL — ${failed} of ${ran} calls failed (see above).`);
  if (failed > 0) process.exitCode = 1;
}

await main();
