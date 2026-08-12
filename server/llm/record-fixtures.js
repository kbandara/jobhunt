// Why this file exists: the fixtures the conformance suite replays start out
// hand-written, which means they are a guess about what each provider really
// sends. This script replaces that guess with the real thing — one live call
// per task per provider, saved verbatim. Run by hand, never by `npm test`.
//
// Run:  npm run record-fixtures      (records for whichever keys are in .env)
// Cost: roughly 15-25 cents on Anthropic, free on Gemini's free tier.
//
// Everything it sends is invented: a made-up job ad and made-up evidence
// records. Nothing from profile/, nothing about you — so the recordings stay
// safe to commit even though this repo is private.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson } from '../store.js';
import { complete } from './index.js';
import { PROVIDERS } from './registry.js';

try {
  process.loadEnvFile();
} catch {
  /* no .env; fall back to whatever is already in the environment */
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FAKE_AD = [
  'Research Engineer, Model Evaluations — Example Labs, London (hybrid).',
  'You will design behavioural evaluations of language models and report what',
  'they actually show. Requirements: experience designing and running',
  'evaluations, strong Python, and the right to work in the UK.',
  'Applications close 15 September 2026.',
].join('\n');

const FAKE_EVIDENCE = [
  'eval-platform: Built an LLM evaluation platform: a 13-construct behavioural',
  'battery, 20 experiments, 6 Bayesian models each gated on parameter recovery,',
  '16 findings.',
  'edu-phd: PhD in progress, expected submission October 2026. Not submitted,',
  'not awarded.',
  'method-bayes: Bayesian hierarchical modelling in Stan and R.',
].join('\n');

// One entry per fixture we keep. Keep this list in step with BATTERY in
// conformance.test.js.
const BATTERY = [
  {
    task: 'parse-jd',
    system: 'You extract structured facts from job ads. Reply only with JSON matching the schema.',
    messages: [{ role: 'user', content: `Parse this job ad.\n\n${FAKE_AD}` }],
  },
  {
    task: 'score-batch',
    system:
      'You score how well job titles fit a candidate who does statistics, Bayesian modelling and LLM evaluation. Look for reasons not to apply. Reply only with JSON matching the schema.',
    messages: [
      {
        role: 'user',
        content:
          'Score these titles by index:\n0. Research Engineer, Model Evaluations\n1. Country Lead, Data Center Security\n2. Senior Statistician, Health Analytics',
      },
    ],
  },
  {
    task: 'generate-cv',
    system:
      'You draft CV content as structured data. Every bullet must cite the evidence ids it drew on, and must not state anything the evidence does not support. Reply only with JSON matching the schema.',
    messages: [
      {
        role: 'user',
        content: `Draft CV sections for this ad using only these evidence records.\n\nAD:\n${FAKE_AD}\n\nEVIDENCE:\n${FAKE_EVIDENCE}`,
      },
    ],
  },
];

/**
 * Wraps real fetch so we keep a copy of exactly what came back, then hands the
 * adapter a stand-in that can still be read normally. The adapter reads the
 * body once; so do we, which is why the body is buffered here.
 */
function recordingFetch(capture) {
  return async (url, init) => {
    const response = await globalThis.fetch(url, init);
    const text = await response.text();
    capture.status = response.status;
    capture.text = text;
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      text: async () => text,
    };
  };
}

async function recordProvider(provider, tally) {
  const envVar = PROVIDERS[provider].apiKeyEnvVar;
  console.log(`\n${provider}`);
  if (!process.env[envVar]) {
    console.log(`  SKIPPED — no ${envVar} in .env (existing fixtures left alone)`);
    return;
  }

  for (const item of BATTERY) {
    const capture = {};
    try {
      const result = await complete({
        task: item.task,
        system: item.system,
        messages: item.messages,
        provider,
        fetchImpl: recordingFetch(capture),
      });

      const file = path.join(HERE, 'fixtures', provider, `${item.task}.json`);
      writeJson(file, {
        synthetic: false,
        note: `Recorded live from ${provider} by record-fixtures.js. Prompts are invented; no personal data.`,
        recordedAt: new Date().toISOString(),
        provider,
        task: item.task,
        status: capture.status,
        body: JSON.parse(capture.text),
      });
      tally.saved += 1;
      console.log(
        `  saved  ${item.task}  (${result.usage.inputTokens} in / ${result.usage.outputTokens} out, ${result.costCents.toFixed(4)}c)`,
      );
    } catch (err) {
      tally.failed += 1;
      console.log(`  FAILED ${item.task}: [${err.type ?? 'error'}] ${err.message}`);
      console.log('         fixture left as it was.');
    }
  }
}

async function main() {
  console.log('Recording live fixtures. This makes real API calls and spends real money.');
  console.log('Prompts are invented job ads and invented evidence — nothing personal is sent or saved.');

  const tally = { saved: 0, failed: 0 };
  for (const provider of Object.keys(PROVIDERS)) await recordProvider(provider, tally);

  console.log('');
  if (tally.saved === 0 && tally.failed === 0) {
    console.log('Nothing was recorded: no API keys found. The synthetic fixtures are untouched.');
    console.log('Copy .env.example to .env, paste a key in, and run this again.');
    process.exitCode = 1;
    return;
  }
  console.log(
    tally.failed === 0
      ? `Done — ${tally.saved} fixtures saved. Now run \`npm test\`: the conformance suite replays exactly what was just recorded.`
      : `Done — ${tally.saved} saved, ${tally.failed} failed (see above). Run \`npm test\` to check what did get recorded.`,
  );
  if (tally.failed > 0) process.exitCode = 1;
}

await main();
