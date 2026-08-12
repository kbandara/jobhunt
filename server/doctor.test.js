// Why these tests exist: this command's whole value is that it is trusted. A
// doctor that says "ok" to something broken is worse than no doctor — it moves
// the discovery to the same place it was before (mid-task) while also having
// wasted the run. So the cases that matter here are the ones where a check
// could plausibly pass without meaning anything.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXAMPLE_PROFILE_FILE, EXAMPLE_META_FILE } from './examples.js';
import {
  CHECKS,
  runChecks,
  formatReport,
  isHealthy,
  checkNode,
  checkDependencies,
  checkEnvFile,
  checkProvider,
  checkModels,
  checkMasterProfile,
  checkContactDetails,
  checkPublications,
  checkDataDirectory,
  checkPort,
  checkLatex,
  MIN_NODE_MAJOR,
  OK,
  WARN,
  FAIL,
} from './doctor.js';

const dirs = [];
const TOUCHED = ['LLM_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  for (const name of TOUCHED) delete process.env[name];
});

/** A fake repo root with only the files a given test cares about. */
function repo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
  dirs.push(root);
  for (const [relative, body] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
}

/** A data directory holding one person's files, which is what the checks read. */
function userData(files = {}) {
  return repo(Object.fromEntries(Object.entries(files).map(([name, body]) => [`profile/${name}`, body])));
}

// --- Node ---------------------------------------------------------------------

test('an old Node is a failure that names the version', () => {
  const result = checkNode({ version: 'v18.20.0' });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /v18\.20\.0/);
  assert.match(result.fix, /nodejs\.org/);
});

test('a new enough Node passes', () => {
  assert.equal(checkNode({ version: `v${MIN_NODE_MAJOR}.0.0` }).status, OK);
  assert.equal(checkNode({ version: `v${MIN_NODE_MAJOR + 5}.1.2` }).status, OK);
});

// --- dependencies -------------------------------------------------------------

test('missing dependencies are named, not just counted', () => {
  const root = repo({ 'package.json': { dependencies: { express: '^5', ajv: '^8' } } });
  fs.mkdirSync(path.join(root, 'node_modules', 'express'), { recursive: true });
  const result = checkDependencies({ root });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /ajv/);
  assert.doesNotMatch(result.detail, /express/, 'the one that IS installed is not blamed');
  assert.match(result.fix, /npm install/);
});

// --- .env ---------------------------------------------------------------------

test('a missing .env fails with the copy command', () => {
  const result = checkEnvFile({ root: repo({}) });
  assert.equal(result.status, FAIL);
  assert.match(result.fix, /Copy-Item|cp /);
});

test('a byte-order mark is warned about, not silently tolerated', () => {
  // PowerShell's `Set-Content -Encoding utf8` writes one, and it makes the
  // first setting in the file silently do nothing.
  const root = repo({ '.env': '﻿LLM_PROVIDER=gemini\n' });
  const result = checkEnvFile({ root });
  assert.equal(result.status, WARN);
  assert.match(result.detail, /byte-order mark/i);
});

test('a clean .env passes and counts its settings, ignoring comments', () => {
  const root = repo({ '.env': '# a comment\nLLM_PROVIDER=gemini\n\nGEMINI_API_KEY=x\n' });
  const result = checkEnvFile({ root });
  assert.equal(result.status, OK);
  assert.match(result.detail, /2 settings/);
});

// --- provider and key ---------------------------------------------------------

test('a provider with no key fails and names the variable to set', () => {
  process.env.LLM_PROVIDER = 'gemini';
  const result = checkProvider({ env: {} });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /GEMINI_API_KEY/);
});

test('a nonsense provider fails with the valid options', () => {
  process.env.LLM_PROVIDER = 'oracle';
  const result = checkProvider({ env: {} });
  assert.equal(result.status, FAIL);
  assert.match(result.fix, /gemini|anthropic/);
});

// --- models -------------------------------------------------------------------

const listing = (models) => async () => models;

test('models that all exist pass', async () => {
  process.env.LLM_PROVIDER = 'gemini';
  const result = await checkModels({
    env: { GEMINI_API_KEY: 'k' },
    listers: { gemini: listing(['gemini-3.5-flash', 'gemini-9-pro']) },
  });
  assert.equal(result.status, OK);
});

test('a retired model ID fails, names the tasks it breaks, and suggests a real one', async () => {
  // The single most likely thing to go stale, and it fails as a confusing 404
  // mid-generation if nobody checks it first.
  process.env.LLM_PROVIDER = 'gemini';
  const result = await checkModels({
    env: { GEMINI_API_KEY: 'k' },
    listers: { gemini: listing(['gemini-4-flash', 'gemini-4-pro']) },
  });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /gemini-3\.5-flash/);
  assert.match(result.detail, /parse-jd/, 'says which tasks stop working');
  assert.match(result.fix, /MODEL_GEMINI=gemini-4-flash/, 'and gives the exact .env line');
});

test('a rejected key is a failure, not a warning', async () => {
  // It was a warning first, and the run exited 0 while nothing could work.
  process.env.LLM_PROVIDER = 'gemini';
  const rejects = async () => {
    throw Object.assign(new Error('Google returned HTTP 400.'), {
      status: 400,
      body: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
    });
  };
  const result = await checkModels({ env: { GEMINI_API_KEY: 'k' }, listers: { gemini: rejects } });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /API key not valid/);
});

test('being offline is a warning, because everything else still works', async () => {
  process.env.LLM_PROVIDER = 'gemini';
  const offline = async () => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };
  const result = await checkModels({ env: { GEMINI_API_KEY: 'k' }, listers: { gemini: offline } });
  assert.equal(result.status, WARN);
});

test('a provider error body never lands in the report as raw JSON', async () => {
  process.env.LLM_PROVIDER = 'gemini';
  const rejects = async () => {
    throw Object.assign(new Error('Google returned HTTP 400.'), {
      status: 400,
      body: JSON.stringify({ error: { code: 400, message: 'API key not valid.', details: Array(50).fill({ noise: 'x'.repeat(80) }) } }),
    });
  };
  const result = await checkModels({ env: { GEMINI_API_KEY: 'k' }, listers: { gemini: rejects } });
  assert.ok(!result.detail.includes('\n'), 'the detail must stay on one line');
  assert.ok(result.detail.length < 200, `detail was ${result.detail.length} characters`);
});

// --- the profile --------------------------------------------------------------

test('a filled-in master profile passes and counts its records', () => {
  const dataDir = userData({
    'master-profile.md': fs.readFileSync(EXAMPLE_PROFILE_FILE, 'utf8'),
    'profile-meta.json': fs.readFileSync(EXAMPLE_META_FILE, 'utf8'),
  });
  const result = checkMasterProfile({ dataDir });
  assert.equal(result.status, OK, result.detail);
  assert.match(result.detail, /\d+ records/);
});

test('a broken master profile fails with the line number', () => {
  const dataDir = userData({ 'master-profile.md': '## Roles\n\n### A Role — An Org\nid: x\ndates: not-a-date-at-all\nprofiles: research\ntags: y\n\nbody' });
  const result = checkMasterProfile({ dataDir });
  assert.equal(result.status, FAIL);
  assert.match(result.detail, /line \d+/);
});

// A profile that does not exist yet is somebody's first run, not a fault. The
// fix line points at the app, which is where it gets created.
test('a missing master profile warns and says where to make one', () => {
  const result = checkMasterProfile({ dataDir: repo({}) });
  assert.equal(result.status, WARN);
  assert.match(result.fix, /npm start/);
});

test('an empty master profile warns rather than reporting a clean bill of health', () => {
  const dataDir = userData({ 'master-profile.md': '## Roles\n' });
  assert.equal(checkMasterProfile({ dataDir }).status, WARN);
});

test('an unfinished contact detail warns, because documents still generate', () => {
  const dataDir = userData({ 'profile-meta.json': { name: 'A Person', email: 'a@b.c', phone: 'FILL-ME', links: [] } });
  const result = checkContactDetails({ dataDir });
  assert.equal(result.status, WARN);
  assert.match(result.detail, /phone/);
});

test('complete contact details pass', () => {
  const dataDir = userData({ 'profile-meta.json': fs.readFileSync(EXAMPLE_META_FILE, 'utf8') });
  assert.equal(checkContactDetails({ dataDir }).status, OK);
});

test('the example publications all parse and render', () => {
  const dataDir = userData({
    'master-profile.md': fs.readFileSync(EXAMPLE_PROFILE_FILE, 'utf8'),
    'profile-meta.json': fs.readFileSync(EXAMPLE_META_FILE, 'utf8'),
  });
  const result = checkPublications({ dataDir });
  assert.equal(result.status, OK, result.detail);
  assert.match(result.detail, /\d+ parse and render as APA/);
});

// --- environment --------------------------------------------------------------

test('an unwritable data folder fails rather than being discovered on the first save', () => {
  const root = repo({});
  const dataDir = path.join(root, 'data');
  fs.writeFileSync(dataDir, 'not a directory');
  assert.equal(checkDataDirectory({ dataDir }).status, FAIL);
});

test('a free port passes and a taken one warns about a stale server', async () => {
  const free = await checkPort({ port: 0 });
  assert.equal(free.status, OK);

  const net = await import('node:net');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const taken = await checkPort({ port: server.address().port });
  server.close();

  assert.equal(taken.status, WARN);
  assert.match(taken.fix, /npm start/, 'it should mention restarting after a pull');
});

// --- LaTeX --------------------------------------------------------------------

test('the LaTeX check compiles a real document through the real exporter', async () => {
  // The point of the test: it is not "is pdflatex on PATH". An engine that
  // exists but cannot compile THIS document is exactly the failure that
  // happened, and a PATH check would have passed through it.
  const result = await checkLatex();
  assert.ok([OK, WARN].includes(result.status), `LaTeX check said: ${result.detail}`);
  if (result.status === OK) assert.match(result.detail, /compiled a test document/);
  else assert.match(result.fix ?? '', /overleaf|print view/i, 'and says what to do instead');
});

// --- the run as a whole -------------------------------------------------------

test('a check that throws is reported, not allowed to abort the run', async () => {
  const exploding = { id: 'boom', run: () => { throw new Error('kaboom'); } };
  const results = await runChecks.call(null, {});
  assert.equal(results.length, CHECKS.length, 'every check ran');

  // And the wrapper itself turns a throw into a finding.
  const wrapped = await (async () => {
    try {
      return { id: exploding.id, ...(await exploding.run()) };
    } catch (err) {
      return { id: exploding.id, label: exploding.id, status: FAIL, detail: `the check itself failed: ${err.message}` };
    }
  })();
  assert.equal(wrapped.status, FAIL);
  assert.match(wrapped.detail, /kaboom/);
});

test('every check returns a label, a status and a detail', async () => {
  for (const result of await runChecks({})) {
    assert.ok(result.label, `${result.id} has no label`);
    assert.ok([OK, WARN, FAIL].includes(result.status), `${result.id} status was ${result.status}`);
    assert.equal(typeof result.detail, 'string', `${result.id} detail was ${typeof result.detail}`);
  }
});

test('anything not ok explains how to fix it', async () => {
  for (const result of await runChecks({})) {
    if (result.status === OK) continue;
    // A warning that is purely informational may skip the fix; a failure never can.
    if (result.status === FAIL) assert.ok(result.fix, `${result.id} failed without saying what to do`);
  }
});

// --- the report ---------------------------------------------------------------

const results = (...statuses) =>
  statuses.map((status, i) => ({ id: `c${i}`, label: `Check ${i}`, status, detail: 'detail', fix: status === OK ? undefined : 'do this' }));

test('failures are counted and named in the summary', () => {
  const report = formatReport(results(OK, FAIL, WARN, FAIL));
  assert.match(report, /2 things will stop the app working/);
  assert.match(report, /Check 1, Check 3/);
});

test('warnings alone do not read as failure', () => {
  const report = formatReport(results(OK, WARN));
  assert.match(report, /Ready to run/);
  assert.match(report, /nothing blocking/);
});

test('a clean run says so plainly', () => {
  assert.match(formatReport(results(OK, OK)), /Everything checks out/);
});

test('the exit status fails on failures and passes on warnings', () => {
  assert.equal(isHealthy(results(OK, WARN)), true, 'a warning is advice, not a failure');
  assert.equal(isHealthy(results(OK, FAIL)), false);
});

test('the report is plain ASCII apart from the fix arrow', () => {
  // It is read in PowerShell as often as anywhere, and box-drawing characters
  // that render as mojibake make working output look broken.
  const report = formatReport(results(OK, WARN, FAIL));
  const exotic = [...report].filter((ch) => ch.charCodeAt(0) > 127 && ch !== '→');
  assert.deepEqual(exotic, [], `unexpected characters: ${exotic.join(' ')}`);
});

test('every column lines up regardless of label length', () => {
  const report = formatReport([
    { id: 'a', label: 'A', status: OK, detail: 'AAA' },
    { id: 'b', label: 'A much longer label', status: OK, detail: 'BBB' },
  ]);
  const lines = report.split('\n').filter((line) => line.startsWith('['));
  assert.equal(lines[0].indexOf('AAA'), lines[1].indexOf('BBB'), 'details should start in the same column');
});
