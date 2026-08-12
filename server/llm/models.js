// Why this script exists: model IDs are the one part of this app that goes stale
// on someone else's schedule. Providers rename and retire them, and a dead ID
// fails as a confusing 404 mid-generation. This asks each provider what your key
// can actually reach, then diffs that against registry.js and tells you exactly
// which line to edit. Run it before the first real call, and any time a task
// starts failing with "model not found".
//
// Usage:  npm run models
// Reads ANTHROPIC_API_KEY / GEMINI_API_KEY from the environment. Never prints them.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, modelsInUse } from './registry.js';

// Node reads .env itself since v21; no dependency needed. Missing file is fine —
// the keys may already be in the environment.
try {
  process.loadEnvFile();
} catch {
  /* no .env; fall back to whatever is already in the environment */
}

/** Ask Anthropic which models this key can use. Exported for `npm run doctor`. */
export async function listAnthropic(apiKey, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  });
  if (!res.ok) {
    // Structured, because callers need to tell "your key is wrong" (fatal) from
    // "we could not reach them" (probably just offline).
    throw Object.assign(new Error(`Anthropic returned HTTP ${res.status}.`), {
      status: res.status,
      body: await res.text(),
    });
  }
  const body = await res.json();
  return (body.data ?? []).map((m) => m.id);
}

/** Ask Google which models this key can use, keeping only ones we can call. */
export async function listGemini(apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    { headers: { 'x-goog-api-key': apiKey } },
  );
  if (!res.ok) {
    throw Object.assign(new Error(`Google returned HTTP ${res.status}.`), {
      status: res.status,
      body: await res.text(),
    });
  }
  const body = await res.json();
  return (body.models ?? [])
    // The list includes embedding and vision-only models we can't send a chat to.
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    // Google returns "models/gemini-x"; registry.js stores the bare id.
    .map((m) => String(m.name).replace(/^models\//, ''));
}

export const LISTERS = { anthropic: listAnthropic, gemini: listGemini };

async function reportProvider(provider) {
  const envVar = PROVIDERS[provider].apiKeyEnvVar;
  const apiKey = process.env[envVar];
  const wanted = modelsInUse(provider); // Map of model id -> [task names]

  console.log(`\n=== ${provider} ===`);
  if (!apiKey) {
    console.log(`  No ${envVar} set, so nothing to check. Skipping.`);
    console.log(`  registry.js currently asks for: ${[...wanted.keys()].join(', ')}`);
    return true;
  }

  let available;
  try {
    available = await LISTERS[provider](apiKey);
  } catch (err) {
    console.log(`  Could not list models: ${err.message}`);
    return false;
  }

  console.log(`  Your key can reach ${available.length} models. registry.js asks for:`);
  let allFound = true;
  for (const [model, tasks] of wanted) {
    const ok = available.includes(model);
    if (!ok) allFound = false;
    console.log(`    ${ok ? 'OK     ' : 'MISSING'}  ${model}   (used by: ${tasks.join(', ')})`);
  }

  if (allFound) {
    console.log('  Every model in the registry exists. Nothing to change.');
    return true;
  }

  console.log('\n  A MISSING model above means that task will fail with a 404.');
  console.log('  Pick a replacement from the list below and edit the matching line');
  console.log('  in server/llm/registry.js. Nothing else in the app needs to change.\n');
  for (const id of available.sort()) console.log(`    ${id}`);
  return false;
}

async function main() {
  console.log('Checking which models your API keys can actually reach.');
  const results = [];
  for (const provider of Object.keys(PROVIDERS)) {
    results.push(await reportProvider(provider));
  }
  const ok = results.every(Boolean);
  console.log(ok ? '\nAll good.\n' : '\nSomething above needs your attention.\n');
  process.exit(ok ? 0 : 1);
}

// Only when run directly. `npm run doctor` imports the listers above, and an
// unconditional main() here meant importing this file printed a whole report
// and exited the process before the caller had done anything.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(`\nUnexpected failure: ${err.message}\n`);
    process.exit(1);
  });
}
