// WHY THIS EXISTS: every problem this app has actually caused was found the same
// way — mid-task, by hitting it. A stale model ID surfaced as a 404 during a
// generation; a missing LaTeX package surfaced as a failed export after the CV
// was already written; a server left running from before a `git pull` surfaced
// as a button that did nothing. Each cost an afternoon, and every one of them
// was knowable in advance.
//
// So: one command that checks everything at once, before anything is at stake.
// It runs every check even when an early one fails, because the point is a
// complete list rather than the first thing to go wrong. Nothing here throws —
// a check that breaks reports itself as a failure and the rest carry on.
//
//   npm run doctor
//
// Exit code 0 when nothing FAILED (warnings are fine — they mean something
// works in a reduced way, like no LaTeX meaning no typeset PDF).
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJson, readText } from './store.js';
import { userPaths, DEFAULT_DATA_DIR, blankProfileMeta } from './user-data.js';
import { parseProfile } from './profile/parse.js';
import { citations, apa, surnameFrom } from './profile/citation.js';
import { loadProfiles } from './generate/profiles/index.js';
import { contactBlock } from './generate/workrights.js';
import { renderLatex } from './generate/latex.js';
import { compilePdf, installHint } from './generate/pdf.js';
import { PROVIDERS, TASKS, resolveProvider, modelsInUse } from './llm/registry.js';
import { LISTERS } from './llm/models.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const ATSCV_STY = path.join(HERE, 'generate', 'latex', 'atscv.sty');

/** The lowest Node this app is written against. */
export const MIN_NODE_MAJOR = 22;

export const OK = 'ok';
export const WARN = 'warn';
export const FAIL = 'fail';

const ok = (label, detail) => ({ label, status: OK, detail });
const warn = (label, detail, fix) => ({ label, status: WARN, detail, fix });
const fail = (label, detail, fix) => ({ label, status: FAIL, detail, fix });

// --- the checks --------------------------------------------------------------
//
// Each takes an options bag and returns one result. They are ordered by what
// breaks first: nothing below matters if Node is wrong.

export function checkNode({ version = process.version } = {}) {
  const major = Number(/^v(\d+)/.exec(version)?.[1] ?? 0);
  if (major >= MIN_NODE_MAJOR) return ok('Node', `${version}`);
  return fail(
    'Node',
    `${version} — this app needs v${MIN_NODE_MAJOR} or newer.`,
    `Install the LTS from https://nodejs.org, then close and reopen this terminal.`,
  );
}

export function checkDependencies({ root = REPO_ROOT } = {}) {
  const pkg = readJson(path.join(root, 'package.json'), {});
  const wanted = Object.keys(pkg.dependencies ?? {});
  const missing = wanted.filter((name) => !fs.existsSync(path.join(root, 'node_modules', name)));

  if (wanted.length === 0) return fail('Dependencies', 'package.json lists none — is this the right folder?');
  if (missing.length === 0) return ok('Dependencies', `${wanted.length} installed`);
  return fail('Dependencies', `missing: ${missing.join(', ')}`, 'Run: npm install');
}

/**
 * The `.env` file, including the byte-order mark trap.
 *
 * A BOM makes the first line's name read as "﻿LLM_PROVIDER", so that
 * setting silently does nothing — and PowerShell's `Set-Content -Encoding utf8`
 * writes one by default. The server strips it defensively; this says so out
 * loud, because a file that works only because something defends against it is
 * worth knowing about.
 */
export function checkEnvFile({ root = REPO_ROOT } = {}) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) {
    return fail(
      '.env file',
      'not found',
      'Copy .env.example to .env and paste your API key into it. In PowerShell: Copy-Item .env.example .env',
    );
  }
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) {
    return warn(
      '.env file',
      'starts with a byte-order mark (a Windows text-editor habit)',
      'The app works around it, but to be rid of it save the file as "UTF-8" rather than "UTF-8 with BOM".',
    );
  }
  return ok('.env file', `${raw.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).length} settings`);
}

export function checkProvider({ env = process.env } = {}) {
  let provider;
  try {
    provider = resolveProvider();
  } catch (err) {
    return fail('Provider', err.message, 'Set LLM_PROVIDER in .env to "gemini" or "anthropic".');
  }
  const variable = PROVIDERS[provider].apiKeyEnvVar;
  if (!env[variable]) {
    return fail(
      'API key',
      `LLM_PROVIDER is "${provider}" but ${variable} is not set`,
      `Add ${variable}=your-key to .env. A Gemini key is free: https://aistudio.google.com/apikey`,
    );
  }
  return ok('Provider', `${provider}, ${variable} present`);
}

/**
 * Whether the models the registry asks for actually exist for this key.
 *
 * This is the check most likely to save an afternoon: providers rename and
 * retire model IDs on their own schedule, and a dead one fails as a confusing
 * 404 in the middle of a generation.
 */
export async function checkModels({ env = process.env, fetchImpl = fetch, listers = LISTERS } = {}) {
  let provider;
  try {
    provider = resolveProvider();
  } catch {
    return warn('Models', 'skipped — no valid provider', 'Fix the provider check above first.');
  }
  const apiKey = env[PROVIDERS[provider].apiKeyEnvVar];
  if (!apiKey) return warn('Models', 'skipped — no API key to ask with');

  let available;
  try {
    available = await listers[provider](apiKey, fetchImpl);
  } catch (err) {
    // "Your key is wrong" and "we could not reach them" look the same from
    // here and are not remotely the same problem: one is fatal and yours to
    // fix, the other is probably just no wifi.
    if (isBadKey(err)) {
      return fail(
        'API key',
        `${provider} rejected it: ${oneLine(providerMessage(err))}`,
        `Check ${PROVIDERS[provider].apiKeyEnvVar} in .env — it may be mistyped, expired, or from a different provider. ` +
          'A fresh Gemini key is free: https://aistudio.google.com/apikey',
      );
    }
    return warn(
      'Models',
      `could not ask ${provider}: ${oneLine(err.message)}`,
      'If you are offline this is expected — everything except the model calls still works. Otherwise check your connection.',
    );
  }

  const inUse = modelsInUse(provider);
  const missing = [...inUse.keys()].filter((model) => !available.includes(model));
  if (missing.length === 0) return ok('Models', `all ${inUse.size} reachable on ${provider}`);

  const suggestions = available.slice(0, 6).join(', ');
  return fail(
    'Models',
    `${provider} does not offer: ${missing.join(', ')} (used by ${missing.flatMap((m) => inUse.get(m)).join(', ')})`,
    `Put a working one in .env, e.g. MODEL_${provider.toUpperCase()}=${available[0] ?? 'a-real-model'}. ` +
      `Your key can reach: ${suggestions}${available.length > 6 ? `, and ${available.length - 6} more` : ''}.`,
  );
}

/**
 * Did the provider reject the key, as opposed to being unreachable?
 *
 * Google answers a bad key with a plain 400 rather than a 401, so the status
 * alone is not enough — the body has to be read.
 */
function isBadKey(err) {
  if (err?.status === 401 || err?.status === 403) return true;
  return /API[_ ]KEY|api key|unauthenticated|invalid.*credential/i.test(String(err?.body ?? err?.message ?? ''));
}

/** The human sentence out of a provider's error body, whatever shape it is in. */
function providerMessage(err) {
  try {
    const parsed = JSON.parse(err.body);
    return parsed?.error?.message ?? parsed?.message ?? err.message;
  } catch {
    return err?.body || err?.message || 'no detail given';
  }
}

/** One line, bounded — a report where one row is a page of JSON is unreadable. */
function oneLine(text, limit = 150) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function checkMasterProfile({ dataDir = DEFAULT_DATA_DIR } = {}) {
  const { masterProfile, profileMeta } = userPaths(dataDir);
  if (!fs.existsSync(masterProfile)) {
    return warn(
      'Master profile',
      'not created yet',
      'Start the app with `npm start` and it will walk you through building one.',
    );
  }
  const meta = readJson(profileMeta, null);
  let parsed;
  try {
    parsed = parseProfile(readText(masterProfile), { allowedTags: meta?.evidenceTags ?? null });
  } catch (err) {
    return fail('Master profile', `could not be read: ${err.message}`);
  }
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    return fail(
      'Master profile',
      `${parsed.errors.length} problem${parsed.errors.length === 1 ? '' : 's'}; the first is on line ${first.line}: ${first.message}`,
      'Open data/profile/master-profile.md at that line. Nothing generates until it parses.',
    );
  }
  if (parsed.records.length === 0) {
    return warn(
      'Master profile',
      'no records yet',
      'Open the app and add some — nothing can be written about you until there is something in it.',
    );
  }
  const gaps = parsed.records.filter((r) => r.isGap).length;
  const detail = `${parsed.records.length} records, no errors${gaps ? `, ${gaps} marked FILL:` : ''}`;
  return ok('Master profile', detail);
}

export function checkContactDetails({ dataDir = DEFAULT_DATA_DIR } = {}) {
  const meta = readJson(userPaths(dataDir).profileMeta, null);
  if (!meta) return warn('Contact details', 'not filled in yet', 'The app asks for these on first run.');

  const contact = contactBlock(meta, {});
  if (contact.needsAttention.length > 0) {
    return warn(
      'Contact details',
      `still missing: ${contact.needsAttention.join(', ')}`,
      'Fill them in under Settings. Documents generate either way, but they will print "FILL-ME" on the page.',
    );
  }
  return ok('Contact details', 'complete');
}

export function checkCvProfiles() {
  try {
    const profiles = loadProfiles({ reload: true });
    return ok('CV profiles', `${profiles.size ?? Object.keys(profiles).length} loaded`);
  } catch (err) {
    return fail('CV profiles', err.message, 'The message names the file and the key. Fix that file and run this again.');
  }
}

/**
 * Publications, because a citation that fails to parse is silent: it renders
 * as something half-right rather than as an error.
 */
export function checkPublications({ dataDir = DEFAULT_DATA_DIR } = {}) {
  const { masterProfile, profileMeta } = userPaths(dataDir);
  const meta = readJson(profileMeta, blankProfileMeta());
  let parsed;
  try {
    parsed = parseProfile(readText(masterProfile), { allowedTags: meta?.evidenceTags ?? null });
  } catch (err) {
    return warn('Publications', `skipped — the master profile did not parse (${err.message})`);
  }
  const list = citations(parsed.records, { surname: surnameFrom(meta) });
  if (list.length === 0) return warn('Publications', 'none in the profile yet');

  const broken = list.filter((c) => c.problems.length > 0);
  if (broken.length > 0) {
    return warn(
      'Publications',
      `${broken.length} of ${list.length} could not be read cleanly — first: ${broken[0].id} (${broken[0].problems[0]})`,
      'Open that record in the app under Profile → Publications. It will still appear, but check the citation before you send it.',
    );
  }
  // Rendering each one proves the whole path, not just the parse.
  for (const citation of list) apa(citation);
  return ok('Publications', `${list.length} parse and render as APA`);
}

export function checkDataDirectory({ dataDir = DEFAULT_DATA_DIR } = {}) {
  const dir = dataDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.doctor-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (err) {
    return fail('Data folder', `data/ is not writable: ${err.message}`, 'Check the folder permissions, or that it is not inside a synced folder that is locked.');
  }
  const jobs = fs.existsSync(path.join(dir, 'jobs')) ? fs.readdirSync(path.join(dir, 'jobs')).filter((f) => f.endsWith('.json')).length : 0;
  return ok('Data folder', jobs === 0 ? 'writable, no jobs yet' : `writable, ${jobs} job${jobs === 1 ? '' : 's'} saved`);
}

/**
 * Is the port free — or is a server already running on it?
 *
 * Both answers are useful and neither is a failure. "Already in use" is how you
 * find the stale process left over from before a `git pull`, which produced one
 * of the most confusing bugs in this app's history.
 */
export function checkPort({ port = Number(process.env.PORT ?? 4477) } = {}) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(
          warn(
            'Port',
            `${port} is already in use — the app is probably running in another terminal`,
            'That is fine if it is the version you just pulled. If you have updated the code since starting it, stop it with Ctrl+C and run npm start again.',
          ),
        );
        return;
      }
      resolve(warn('Port', `${port} could not be tested: ${err.message}`));
    });
    server.once('listening', () => server.close(() => resolve(ok('Port', `${port} is free`))));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * LaTeX — and not just "is pdflatex on PATH".
 *
 * The failure that actually happened was an engine that existed and could not
 * compile this document, because atscv.sty needs titlesec and enumitem and the
 * obvious install did not include them. So this renders a real document through
 * the real exporter and compiles it. Anything less would have passed while the
 * export was broken.
 */
export async function checkLatex({ tmpDir = os.tmpdir() } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'jobhunt-doctor-'));
  try {
    fs.writeFileSync(path.join(dir, 'probe.tex'), probeDocument());
    fs.copyFileSync(ATSCV_STY, path.join(dir, 'atscv.sty'));

    const result = await compilePdf({ dir, name: 'probe' });
    if (result.ok) return ok('LaTeX', `${result.engine} compiled a test document`);

    if (result.reason === 'no-engine') {
      return warn(
        'LaTeX',
        'no engine found — the PDF button will not work',
        `${installHint()} Everything else works without it: use the .tex button with overleaf.com, or Open print view then Ctrl+P.`,
      );
    }
    return fail(
      'LaTeX',
      `${result.engine ?? 'the engine'} could not compile a test document:\n      ${String(result.detail ?? '').split('\n').join('\n      ')}`,
      'Usually a missing package. The error above names it; install it and run this again.',
    );
  } catch (err) {
    return warn('LaTeX', `could not be tested: ${err.message}`);
  } finally {
    // maxRetries because this has just run a LaTeX engine: on Windows a process
    // can still hold its working directory for a moment after it exits, and
    // rmdir answers EBUSY until the OS lets go. Wrapped as well, because a
    // temp folder that outlives the check is not worth turning a passing
    // diagnostic into a crash.
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* the OS will clear its own temp directory eventually */
    }
  }
}

/** A real document, through the real renderer — see checkLatex. */
function probeDocument() {
  return renderLatex({
    artifact: {
      summary: { text: 'A one-line summary, to prove the class file loads.', evidence_ids: [] },
      sections: [
        {
          heading: 'Experience',
          entries: [
            {
              title: 'A role',
              org: 'An organisation',
              dates: 'January 2020 – present',
              bullets: [{ text: 'A bullet with a figure: 100 per cell, & an ampersand.', evidence_ids: [] }],
            },
          ],
        },
      ],
    },
    artifactKind: 'cv',
    contact: { lines: ['Test Document', 'test@example.com'], links: [] },
    profile: 'general',
    profileConfig: { sections: [{ id: 'summary' }, { id: 'experience' }] },
    jobMeta: { company: 'A Company', roleTitle: 'A Role' },
    profileMeta: { name: 'Test Document' },
  });
}

// --- running and reporting ----------------------------------------------------

/** Every check, in order. Exported so a test can run them individually. */
export const CHECKS = [
  { id: 'node', run: checkNode },
  { id: 'dependencies', run: checkDependencies },
  { id: 'env', run: checkEnvFile },
  { id: 'provider', run: checkProvider },
  { id: 'models', run: checkModels },
  { id: 'master-profile', run: checkMasterProfile },
  { id: 'contact', run: checkContactDetails },
  { id: 'cv-profiles', run: checkCvProfiles },
  { id: 'publications', run: checkPublications },
  { id: 'data', run: checkDataDirectory },
  { id: 'port', run: checkPort },
  { id: 'latex', run: checkLatex },
];

/**
 * Run everything. Never throws, and never stops early: a complete list is the
 * whole point, and a check that crashes is itself a finding.
 */
export async function runChecks(options = {}) {
  const results = [];
  for (const check of CHECKS) {
    try {
      results.push({ id: check.id, ...(await check.run(options)) });
    } catch (err) {
      results.push({
        id: check.id,
        label: check.id,
        status: FAIL,
        detail: `the check itself failed: ${err?.message ?? err}`,
      });
    }
  }
  return results;
}

const MARK = { [OK]: '  ok  ', [WARN]: ' warn ', [FAIL]: ' FAIL ' };

/**
 * The report. Plain ASCII on purpose — this is read in PowerShell as often as
 * anywhere else, and a box-drawing character that renders as mojibake makes the
 * output look broken when it is not.
 */
export function formatReport(results) {
  const width = Math.max(...results.map((r) => (r.label ?? r.id).length));
  const lines = ['', 'job_hunt doctor', ''];

  for (const result of results) {
    lines.push(`[${MARK[result.status]}] ${(result.label ?? result.id).padEnd(width)}  ${result.detail ?? ''}`);
    if (result.fix) lines.push(`${' '.repeat(width + 11)}→ ${result.fix}`);
  }

  const failed = results.filter((r) => r.status === FAIL);
  const warned = results.filter((r) => r.status === WARN);

  lines.push('');
  if (failed.length > 0) {
    lines.push(`${failed.length} thing${failed.length === 1 ? '' : 's'} will stop the app working: ${failed.map((r) => r.label ?? r.id).join(', ')}.`);
    lines.push('Fix those and run `npm run doctor` again.');
  } else if (warned.length > 0) {
    lines.push(`Ready to run. ${warned.length} thing${warned.length === 1 ? '' : 's'} worth a look, but nothing blocking.`);
    lines.push('Start it with `npm start`.');
  } else {
    lines.push('Everything checks out. Start it with `npm start`.');
  }
  lines.push('');
  return lines.join('\n');
}

/** True when nothing failed. Warnings do not fail the run — they are advice. */
export function isHealthy(results) {
  return results.every((r) => r.status !== FAIL);
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    /* no .env — checkEnvFile reports that properly a moment from now */
  }
  const results = await runChecks();
  // eslint-disable-next-line no-console
  console.log(formatReport(results));
  process.exitCode = isHealthy(results) ? 0 : 1;
}

// Only when run directly, never on import — the tests import this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
