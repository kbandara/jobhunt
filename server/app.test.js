// WHY: this is the gate for Phase 3 — one application pack, end to end, with no
// network and no keys. The model is stubbed; everything else is the real thing,
// including the real profile and the real validator, so a generated draft that
// would fail validation in production fails here first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp, parseSystemPrompt, scoreSystemPrompt, normaliseOverqualification } from './index.js';
import { readJson, readJsonl } from './store.js';
import { exampleEvidence, exampleMeta } from './examples.js';
import { profileIds } from './generate/profiles/index.js';
import { selectEvidence } from './generate/select-evidence.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = 'industry-research'; // not a translating profile, so R6 terminology warnings stay out of the way
const profileConfig = readJson(path.join(HERE, 'generate', 'profiles', `${PROFILE}.json`));
const evidence = exampleEvidence();
const profileMeta = exampleMeta();

const RAW_AD = `Research Engineer, Model Evaluations — Acme Alignment
Sydney, hybrid. We build evaluations for frontier language models.
You will design measurement instruments, run experiments and write up findings.
Essential: strong statistics, Python, experience designing evaluations.
Desirable: psychometrics, item response theory.`;

const JD_JSON = {
  role_title: 'Research Engineer, Model Evaluations',
  company: 'Acme Alignment',
  location: { country: 'AU', city: 'Sydney' },
  work_arrangement: 'hybrid',
  timezone: null,
  seniority: 'mid',
  closing_date: '2026-08-20',
  requirements: [
    { text: 'Strong applied statistics', kind: 'skill', must_have: true },
    { text: 'Python', kind: 'skill', must_have: true },
    { text: 'Experience designing evaluations of language models', kind: 'experience', must_have: true },
    { text: 'Psychometrics and item response theory', kind: 'skill', must_have: false },
  ],
  skills: ['statistics', 'python', 'evaluation', 'psychometrics'],
  responsibilities: ['Design evaluations', 'Analyse results', 'Write up findings'],
  selection_criteria: [],
  profile_guess: PROFILE,
  profile_guess_reason: 'The role is model evaluation work at an AI lab.',
};

const SCORE_JSON = {
  score: 72,
  summary: 'Good methodological fit, but the ad names a hard filter the applicant cannot pass.',
  matched: [
    { requirement: 'Strong applied statistics', evidence_ids: ['skill-bayesian'] },
    { requirement: 'Experience designing evaluations', evidence_ids: ['project-eval-platform'] },
  ],
  unmet: [
    { requirement: 'Requires an awarded PhD at time of application', severity: 'blocking', note: 'His thesis is not submitted.' },
    { requirement: 'Five years of industry engineering', severity: 'significant' },
  ],
};

// The ids the deterministic selector will actually offer for this job and profile.
// Citing computed ids rather than hard-coded ones keeps this test honest if the
// profile changes: the fixture always cites evidence that was genuinely offered.
const { offeredIds } = selectEvidence({ evidence, jdJson: JD_JSON, profile: PROFILE, profileConfig });
const [ID_A, ID_B, ID_C] = offeredIds;

const cvArtifact = () => ({
  summary: {
    text: 'Computational scientist moving into model evaluation, with a measurement background.',
    evidence_ids: [ID_A],
  },
  sections: [
    {
      heading: 'Evaluation',
      entries: [
        {
          title: 'LLM evaluation platform',
          org: 'independent research',
          dates: 'September 2025 – present',
          bullets: [
            { text: 'Designed evaluations that separate discrimination from response bias.', evidence_ids: [ID_A] },
            { text: 'Built the measurement pipeline and the analysis that reads it.', evidence_ids: [ID_A, ID_B] },
          ],
        },
      ],
    },
    {
      heading: 'Experience',
      entries: [
        {
          title: 'Researcher',
          org: 'University of Melbourne',
          dates: 'May 2022 – present',
          bullets: [{ text: 'Ran experiments and wrote up findings for peer review.', evidence_ids: [ID_C] }],
        },
      ],
    },
  ],
  gaps: [{ evidence_id: ID_B, wanted: 'a quantified outcome for this record' }],
  changes_made: ['Led with the evaluation work rather than the teaching.'],
});

const coverLetterArtifact = () => ({
  paragraphs: [
    { text: 'I am writing about the Research Engineer, Model Evaluations role.', evidence_ids: [] },
    { text: 'I build evaluations that treat benchmarks as measurement instruments.', evidence_ids: [ID_A] },
  ],
  gaps: [],
  changes_made: [],
});

const coldEmailArtifact = () => ({
  subject: 'Evaluation infrastructure - quick question',
  paragraphs: [
    { text: 'You are building measurement tooling for clinical models with four engineers.', evidence_ids: [] },
    { text: 'I built an evaluation platform that separates discrimination from response bias.', evidence_ids: [ID_A] },
    { text: 'Worth twenty minutes to see whether that is useful to you?', evidence_ids: [] },
  ],
  gaps: [],
  changes_made: [],
});

const criteriaArtifact = () => ({
  answers: [
    {
      criterion: 'Describe your experience designing evaluations. (300 words max)',
      paragraphs: [
        { text: 'I built an evaluation platform used by a five-person review team.', evidence_ids: [ID_A] },
        { text: 'The design treated each benchmark as a measurement instrument.', evidence_ids: [ID_A] },
      ],
    },
    {
      criterion: 'Tell us about working in a multidisciplinary team.',
      paragraphs: [{ text: 'I taught computational neuroscience to a mixed cohort.', evidence_ids: [ID_B] }],
    },
  ],
  gaps: [],
  changes_made: [],
});

/** One model reply in the shape the LLM layer returns, whatever the task. */
const reply = (data) => ({
  data,
  usage: { inputTokens: 1000, outputTokens: 500 },
  costCents: 4.2,
  model: 'stub-model',
  provider: 'stub',
});

/** The stub stands in for the whole LLM layer: no network, no key, same shape. */
function stubLlm(calls) {
  return async ({ task }) => {
    calls.push(task);
    const data = {
      'parse-jd': JD_JSON,
      'score-deep': SCORE_JSON,
      'generate-cv': cvArtifact(),
      'generate-cover-letter': coverLetterArtifact(),
      'generate-criteria': criteriaArtifact(),
      'generate-cold-email': coldEmailArtifact(),
    }[task];
    if (!data) throw new Error(`stub has no fixture for task "${task}"`);
    return reply(data);
  };
}

/**
 * Start a generation and wait for it to finish, the way the browser does.
 *
 * Generation returns 202 the moment the work is under way — that is what lets
 * you start a CV for one job and move to the next — so a test that wants the
 * result has to poll the run, exactly as the screen does. Returns the finished
 * progress record plus the document that came out of it.
 */
async function generateAndWait(app, jobId, kind, { timeoutMs = 15_000, start = true } = {}) {
  const started = start ? await app.call('POST', `/api/jobs/${jobId}/generate/${kind}`) : { status: 202 };
  if (started.status !== 202) return { started, progress: null, doc: null };

  const deadline = Date.now() + timeoutMs;
  let progress = null;
  while (Date.now() < deadline) {
    const poll = await app.call('GET', `/api/jobs/${jobId}/generate/${kind}/progress`);
    progress = poll.body.progress;
    if (progress && !progress.running) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const job = await app.call('GET', `/api/jobs/${jobId}`);
  return { started, progress, doc: job.body.docs[kind], job: job.body.job };
}

/**
 * The same stub, but each call takes a moment — so a test can look at the app
 * while a run is genuinely still in flight rather than racing it.
 */
function slowModel(delayMs) {
  const inner = stubLlm([]);
  return async (options) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return inner(options);
  };
}

/** Wait for a run to finish, whoever started it. */
async function waitForRun(app, jobId, kind, { timeoutMs = 15_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = await app.call('GET', `/api/jobs/${jobId}/generate/${kind}/progress`);
    if (!poll.body.progress?.running) return poll.body.progress;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run ${jobId}:${kind} never finished`);
}

/** App on an ephemeral 127.0.0.1 port, temp data dir, torn down by the caller. */
async function startApp({ llmComplete } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-test-'));
  const calls = [];
  const app = createApp({ llmComplete: llmComplete ?? stubLlm(calls), dataDir, evidence, profileMeta });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const isJson = (res.headers.get('content-type') ?? '').includes('json');
    return { status: res.status, body: isJson ? JSON.parse(text) : text, res };
  };

  return {
    base,
    dataDir,
    calls,
    call,
    stop: () =>
      new Promise((resolve) => {
        server.close(resolve);
        fs.rmSync(dataDir, { recursive: true, force: true });
      }),
  };
}

test('the selector offers enough evidence for the fixture to cite', () => {
  assert.ok(offeredIds.length >= 3, `expected at least 3 offered records, got ${offeredIds.length}`);
  assert.ok([ID_A, ID_B, ID_C].every((id) => typeof id === 'string' && id.length > 0));
});

test('paste an ad, walk it to a printable pack', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  // --- create ---------------------------------------------------------------
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  assert.equal(created.status, 201);
  const jobId = created.body.job.id;
  assert.match(jobId, /^j_\d+/);
  assert.equal(created.body.job.status, 'wishlist');
  assert.equal(created.body.job.profile.confirmed, null);

  // --- the one gate that remains: there must be an advertisement to work from -
  const early = await app.call('POST', `/api/jobs/${jobId}/generate/cv`);
  assert.equal(early.status, 409, 'generation must be refused before the ad has been parsed');
  assert.equal(early.body.type, 'needs-parse');
  assert.match(early.body.error, /has not been parsed yet/);

  const earlyScore = await app.call('POST', `/api/jobs/${jobId}/score`);
  assert.equal(earlyScore.status, 409, 'scoring must be refused before the ad has been parsed');
  assert.equal(earlyScore.body.type, 'needs-parse');

  // --- parse ----------------------------------------------------------------
  const parsed = await app.call('POST', `/api/jobs/${jobId}/parse`);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.body.job.parsed.company, 'Acme Alignment');
  assert.equal(parsed.body.job.profile.guess, PROFILE);
  assert.equal(parsed.body.job.closingDate, '2026-08-20');
  // The app accepts its own guess so nothing is blocked on a click — and records
  // that it was the app's judgement, not yours. That distinction is the audit trail.
  assert.equal(parsed.body.job.profile.confirmed, PROFILE);
  assert.equal(parsed.body.job.profile.confirmedBy, 'auto');

  // --- your override, which is what makes the guess safe to accept ------------
  const confirmed = await app.call('POST', `/api/jobs/${jobId}/profile`, { profile: PROFILE });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.job.profile.confirmed, PROFILE);
  assert.equal(confirmed.body.job.profile.confirmedBy, 'human', 'choosing a profile by hand is recorded as yours');
  assert.equal(confirmed.body.job.profile.guess, PROFILE, 'the guess is kept alongside the choice');

  // --- score, with the cap shown not hidden ---------------------------------
  const scored = await app.call('POST', `/api/jobs/${jobId}/score`);
  assert.equal(scored.status, 200);
  assert.deepEqual(
    {
      modelScore: scored.body.fit.modelScore,
      cappedScore: scored.body.fit.cappedScore,
      capReason: scored.body.fit.capReason,
      verdict: scored.body.fit.verdict,
    },
    {
      modelScore: 72,
      cappedScore: 29,
      capReason: 'Requires an awarded PhD at time of application',
      verdict: 'skip',
    },
  );
  assert.equal(scored.body.fit.unmet.length, 2);
  const storedJob = readJson(path.join(app.dataDir, 'jobs', `${jobId}.json`));
  assert.equal(storedJob.fit.cappedScore, 29);

  // --- generate the CV ------------------------------------------------------
  const cvRun = await generateAndWait(app, jobId, 'cv');
  assert.equal(cvRun.started.status, 202, 'generation starts and returns at once');
  assert.equal(cvRun.progress.outcome, 'ok', cvRun.progress.error ?? '');
  const cv = { body: { ...cvRun.doc.versions.at(-1), markdown: cvRun.doc.markdown, version: cvRun.doc.versions.length } };
  assert.equal(cv.body.version, 1);

  const CONTACT_LINES = [
    'Rosa Kimani',
    'Riverina, Australia · Australian citizen', // AU + hybrid, from workrights.js
  ];
  for (const line of CONTACT_LINES) {
    assert.ok(cv.body.markdown.includes(line), `contact line missing from the CV: ${line}`);
  }
  assert.ok(Array.isArray(cv.body.flags.errors), 'flags.errors must always be an array');
  assert.ok(Array.isArray(cv.body.flags.warnings));
  assert.deepEqual(
    cv.body.flags.errors,
    [],
    `the fixture must pass the real validator in strict mode: ${JSON.stringify(cv.body.flags.errors)}`,
  );
  assert.equal(cv.body.gaps.length, 1);
  assert.ok(cv.body.markdown.startsWith('# Rosa Kimani'));

  const meta = readJson(path.join(app.dataDir, 'apps', jobId, 'meta.json'));
  assert.equal(meta.docs.cv.versions.length, 1);
  assert.equal(meta.docs.cv.versions[0].v, 1);
  assert.equal(meta.docs.cv.versions[0].editedByUser, false);
  assert.ok(meta.docs.cv.versions[0].offeredIds.includes(ID_A));
  const v1Text = fs.readFileSync(path.join(app.dataDir, 'apps', jobId, 'cv.v1.md'), 'utf8');
  assert.equal(v1Text, cv.body.markdown);

  // --- generate again: a new version, never an overwrite --------------------
  const cvAgain = await generateAndWait(app, jobId, 'cv');
  assert.equal(cvAgain.progress.outcome, 'ok');
  assert.equal(cvAgain.doc.versions.length, 2);
  const metaAfter = readJson(path.join(app.dataDir, 'apps', jobId, 'meta.json'));
  assert.equal(metaAfter.docs.cv.versions.length, 2);
  assert.deepEqual(
    metaAfter.docs.cv.versions.map((v) => v.v),
    [1, 2],
  );
  assert.ok(fs.existsSync(path.join(app.dataDir, 'apps', jobId, 'cv.v1.md')), 'v1 must survive a regenerate');
  assert.ok(fs.existsSync(path.join(app.dataDir, 'apps', jobId, 'cv.v2.md')));

  // --- the cover letter is an independent call ------------------------------
  const letter = await generateAndWait(app, jobId, 'cover-letter');
  assert.equal(letter.progress.outcome, 'ok');
  assert.equal(letter.doc.versions.length, 1, 'each kind versions on its own');
  assert.ok(letter.doc.markdown.includes('Re: Research Engineer, Model Evaluations, Acme Alignment'));

  // --- your edit wins, and is re-checked in advisory mode --------------------
  const edited = `${cv.body.markdown}\n- Cut costs by 4173 percent last quarter.\n`;
  const saved = await app.call('PUT', `/api/jobs/${jobId}/docs/cv`, { markdown: edited });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 3, 'an edit is the next version of the same document');
  assert.equal(saved.body.editedByUser, true);
  assert.equal(saved.body.flags.errors.length, 0, 'advisory mode never produces errors');
  assert.ok(saved.body.flags.warnings.length > 0, 'the invented figure must be flagged');
  assert.ok(
    saved.body.flags.warnings.some((w) => w.rule === 'R8' && w.message.includes('4173')),
    `expected an advisory warning about 4173: ${JSON.stringify(saved.body.flags.warnings)}`,
  );

  const metaEdited = readJson(path.join(app.dataDir, 'apps', jobId, 'meta.json'));
  assert.equal(metaEdited.docs.cv.versions[2].editedByUser, true);
  assert.equal(fs.readFileSync(path.join(app.dataDir, 'apps', jobId, 'cv.md'), 'utf8'), edited);

  // --- the print view -------------------------------------------------------
  const printed = await app.call('GET', `/print/${jobId}/cv`);
  assert.equal(printed.status, 200);
  assert.match(printed.res.headers.get('content-type') ?? '', /text\/html/);
  assert.ok(printed.body.includes('Riverina, Australia · Australian citizen'), 'the work-rights line must print');
  assert.ok(printed.body.includes('href="/print/print.css"'));
  assert.ok(printed.body.includes('Rosa-Kimani-CV-Acme-Alignment.pdf'));
  assert.ok(!/<table/i.test(printed.body), 'single column: no tables anywhere (defect #5)');
  assert.ok(!/column-count|<div class="col/i.test(printed.body));

  // --- the board ------------------------------------------------------------
  const moved = await app.call('PATCH', `/api/jobs/${jobId}/status`, { status: 'applied' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.job.status, 'applied');

  const board = await app.call('GET', '/api/board');
  assert.equal(board.status, 200);
  assert.deepEqual(board.body.statuses, ['wishlist', 'drafting', 'applied', 'interviewing', 'offer', 'rejected']);
  assert.equal(board.body.board.applied.length, 1);
  assert.equal(board.body.board.wishlist.length, 0);

  // --- the whole history, in order -----------------------------------------
  const events = readJsonl(path.join(app.dataDir, 'events.jsonl'));
  const types = events.map((e) => e.type);
  assert.deepEqual(types, [
    'created',
    'parsed',
    'profile-confirmed',
    'scored',
    'doc-generated',
    'doc-generated',
    'doc-generated',
    'doc-saved',
    'status-change',
  ]);
  assert.ok(events.every((e) => e.jobId === jobId && typeof e.ts === 'string'));
  assert.equal(events.at(-1).from, 'wishlist');
  assert.equal(events.at(-1).to, 'applied');

  // --- reading it all back --------------------------------------------------
  const readBack = await app.call('GET', `/api/jobs/${jobId}`);
  assert.equal(readBack.status, 200);
  assert.equal(readBack.body.job.status, 'applied');
  assert.equal(readBack.body.docs.cv.versions.length, 3);
  assert.equal(readBack.body.docs.cv.markdown, edited);
  assert.equal(readBack.body.docs['cover-letter'].versions.length, 1);

  assert.deepEqual(app.calls, [
    'parse-jd',
    'score-deep',
    'generate-cv',
    'generate-cv',
    'generate-cover-letter',
  ]);
});

test('unknown jobs, profiles and document kinds fail with a readable message', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const missing = await app.call('GET', '/api/jobs/j_nope');
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /No job with id/);

  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const jobId = created.body.job.id;

  const badProfile = await app.call('POST', `/api/jobs/${jobId}/profile`, { profile: 'astronaut' });
  assert.equal(badProfile.status, 400);
  assert.match(badProfile.body.error, /research/);

  const empty = await app.call('POST', '/api/jobs', { rawText: '   ' });
  assert.equal(empty.status, 400);

  await app.call('POST', `/api/jobs/${jobId}/parse`);
  await app.call('POST', `/api/jobs/${jobId}/profile`, { profile: PROFILE });
  const badKind = await app.call('POST', `/api/jobs/${jobId}/generate/manifesto`);
  assert.equal(badKind.status, 404);

  const badStatus = await app.call('PATCH', `/api/jobs/${jobId}/status`, { status: 'winning' });
  assert.equal(badStatus.status, 400);

  const noDoc = await app.call('GET', `/print/${jobId}/cv`);
  assert.equal(noDoc.status, 404);
});

test('a model failure is reported in plain language with a hint', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-test-'));
  const { llmError } = await import('./llm/errors.js');
  const app = createApp({
    dataDir,
    evidence,
    profileMeta,
    llmComplete: async () => {
      throw llmError('auth', { provider: 'anthropic', task: 'parse-jd' });
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const created = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawText: RAW_AD }),
  }).then((r) => r.json());

  const res = await fetch(`${base}/api/jobs/${created.job.id}/parse`, { method: 'POST' });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.type, 'auth');
  assert.match(body.error, /API key/);
  assert.match(body.hint, /\.env/);
});

test('the usage and meta screens work with no ledger and no key', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const usage = await app.call('GET', '/api/usage');
  assert.equal(usage.status, 200);
  assert.equal(usage.body.totalCents, 0);
  assert.deepEqual(usage.body.byTask, {});

  const meta = await app.call('GET', '/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.body.evidenceCount, evidence.length);
  assert.ok(Array.isArray(meta.body.needsAttention));
  // The profiles come from the files in server/generate/profiles/, so this asserts the
  // registry's list rather than a copy of it — adding a profile is a new file only.
  assert.deepEqual(meta.body.profiles, profileIds());
  for (const id of ['industry-research', 'research', 'public-sector', 'industry', 'general']) {
    assert.ok(meta.body.profiles.includes(id), `${id} is missing from /api/meta`);
  }
});

test('the parse prompt offers the model the profiles that actually exist, with descriptions', () => {
  const prompt = parseSystemPrompt();
  for (const profile of ['industry-research', 'research', 'public-sector', 'industry', 'teaching', 'research', 'industry-research', 'general']) {
    assert.ok(prompt.includes(`- ${profile}: `), `${profile} is not offered to the model`);
  }
  assert.match(prompt, /technical_register/);
  assert.match(prompt, /domain_vocabulary/);
  assert.ok(!prompt.includes('astrophysics'));
});

test('generation runs the ad-driven rules: R9 sees the parsed job', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const jobId = created.body.job.id;
  await app.call('POST', `/api/jobs/${jobId}/parse`, {});
  await app.call('POST', `/api/jobs/${jobId}/profile`, { profile: PROFILE });
  const cv = { body: (await generateAndWait(app, jobId, 'cv')).doc.versions.at(-1) };

  // The ad marks Python essential and the drafted CV never says the word, which
  // is exactly the silent filter R9 exists to surface. Warning, never an error.
  const r9 = cv.body.flags.warnings.filter((w) => w.rule === 'R9');
  assert.ok(r9.length > 0, `expected an R9 warning, got ${JSON.stringify(cv.body.flags.warnings)}`);
  assert.ok(r9.some((w) => /Python/i.test(w.message)), JSON.stringify(r9));
  assert.deepEqual(cv.body.flags.errors.filter((e) => e.rule === 'R9'), []);
});

test('GET /api/profiles gives the client every profile with its description', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const res = await app.call('GET', '/api/profiles');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((profile) => profile.id), profileIds());
  for (const profile of res.body) {
    assert.equal(typeof profile.description, 'string');
    assert.ok(profile.description.length > 0, `${profile.id} has no description`);
  }
});

test('a profile guess the model invented falls back to general, and says so', async (t) => {
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task !== 'parse-jd') throw new Error(`unexpected task ${task}`);
      return reply({ ...JD_JSON, profile_guess: 'astrophysics', profile_guess_reason: 'It mentions telescopes.' });
    },
  });
  t.after(() => app.stop());

  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const parsed = await app.call('POST', `/api/jobs/${created.body.job.id}/parse`, {});

  assert.equal(parsed.body.job.profile.guess, 'general', 'an unknown profile id lands in the catch-all');
  assert.equal(parsed.body.job.profile.guessFellBack, true);
  assert.equal(parsed.body.job.profile.modelSaid, 'astrophysics', 'what the model actually said is kept');
  assert.equal(parsed.body.job.profile.confirmed, 'general', 'the fallback is accepted so nothing is blocked');
  assert.equal(parsed.body.job.profile.confirmedBy, 'auto', 'but a fallback is still not your choice');
});

test('after a parse, generation and scoring no longer wait for a profile to be clicked', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const jobId = created.body.job.id;
  await app.call('POST', `/api/jobs/${jobId}/parse`);

  // No POST /profile anywhere in this test: the guess the app accepted is enough.
  const cvRun2 = await generateAndWait(app, jobId, 'cv');
  const cv = { status: cvRun2.progress?.outcome === 'ok' ? 200 : 500, body: { version: cvRun2.doc?.versions.length ?? 0 } };
  assert.equal(cv.status, 200, `generation must proceed on the accepted guess: ${JSON.stringify(cv.body)}`);
  assert.equal(cv.body.version, 1);

  const scored = await app.call('POST', `/api/jobs/${jobId}/score`);
  assert.equal(scored.status, 200);

  const job = readJson(path.join(app.dataDir, 'jobs', `${jobId}.json`));
  assert.equal(job.profile.confirmedBy, 'auto', 'nothing here was your decision, and the record says so');

  // Changing it afterwards is a human decision, and re-parsing must not undo it.
  await app.call('POST', `/api/jobs/${jobId}/profile`, { profile: 'research' });
  await app.call('POST', `/api/jobs/${jobId}/parse`);
  const afterReparse = readJson(path.join(app.dataDir, 'jobs', `${jobId}.json`));
  assert.equal(afterReparse.profile.confirmed, 'research', 'a re-parse must not overwrite a profile you chose');
  assert.equal(afterReparse.profile.confirmedBy, 'human');
  assert.equal(afterReparse.profile.guess, PROFILE, 'the fresh guess is still recorded next to your choice');
});

// --- the scoring prompt and the overqualification signal ---------------------
//
// The first version of this prompt said "look for reasons not to apply before
// you look for reasons to", and the scores came back uniformly negative. These
// guard the reframing: the prompt has to describe a recruiter reading an
// application, with anchors that stop a 0-100 scale drifting low, and it must
// not reintroduce an instruction to argue against applying.

test('the scoring prompt puts the model in the recruiter chair, not the sceptic chair', () => {
  assert.match(scoreSystemPrompt(), /recruiter screening applications/i);
  assert.doesNotMatch(scoreSystemPrompt(), /reasons\s+not to apply before/i, 'the instruction that caused the negativity');
  assert.match(scoreSystemPrompt(), /do not round up out of kindness/i, 'it must not overcorrect into flattery');
  // Both calibration failures are guarded against, but the wording follows what
  // the person said about themselves: telling a model somebody is changing field
  // when they are not is its own kind of miscalibration.
  assert.match(scoreSystemPrompt(), /not its distance from an imagined perfect/i);
  assert.match(
    scoreSystemPrompt({ careerTransition: true }),
    /changing field/i,
    'it must know why a transitioner looks imperfect on paper',
  );
});

test('the prompt asks for a score out of 20, not out of 100', () => {
  // Asked for a number out of a hundred, a model drifts into the low forties for
  // everything — most of the hundred choices mean nothing to it. Out of 20 each
  // step has to be argued for. server/score/cap.js multiplies by five.
  const prompt = scoreSystemPrompt();
  assert.match(prompt, /OUT OF 20/);
  assert.match(prompt, /Not out of 100/);
});

test('the score scale is anchored, because an unanchored scale drifts low', () => {
  // These four are VERDICT_BANDS / SCALE_FACTOR. cap.test.js pins that
  // relationship; this pins that the prompt actually states them.
  for (const band of ['15-20', '10-14', '6-9', '0-5']) {
    assert.ok(scoreSystemPrompt().includes(band), `no anchor for ${band}`);
  }
});

test('the prompt reserves "blocking" for hard filters, since it drives the cap', () => {
  assert.match(scoreSystemPrompt(), /ONLY when it is a hard filter/);
  assert.match(scoreSystemPrompt(), /do not reach for it because a gap is large/i);
});

test('the prompt asks about overqualification as work level, not credential height', () => {
  assert.match(scoreSystemPrompt(), /too senior/i);
  assert.match(scoreSystemPrompt(), /level\s+of the WORK/, 'the line wraps in the prompt array');
});

test('a missing overqualification field becomes "none" rather than a claim on screen', () => {
  assert.deepEqual(normaliseOverqualification(undefined), { level: 'none', note: '' });
  assert.deepEqual(normaliseOverqualification({}), { level: 'none', note: '' });
  assert.deepEqual(normaliseOverqualification({ level: 'extremely' }), { level: 'none', note: '' });
});

test('a "none" verdict never carries a note, so nothing can render half a warning', () => {
  assert.deepEqual(
    normaliseOverqualification({ level: 'none', note: 'this one is fine actually' }),
    { level: 'none', note: '' },
  );
});

test('a real overqualification signal survives intact', () => {
  assert.deepEqual(
    normaliseOverqualification({ level: 'clearly', note: '  the work is a level below this  ' }),
    { level: 'clearly', note: 'the work is a level below this' },
  );
});

test('scoring stores the overqualification signal on the job', async (t) => {
  const app = await startApp({
    llmComplete: async ({ task }) => {
      const data = {
        'parse-jd': JD_JSON,
        'score-deep': { ...SCORE_JSON, overqualification: { level: 'somewhat', note: 'a graduate-level post' } },
      }[task];
      if (!data) throw new Error(`no fixture for ${task}`);
      return { data, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 1, model: 'test' };
    },
  });
  t.after(() => app.stop());

  const created = await app.call('POST', '/api/jobs', { rawText: 'A job advertisement.' });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  const scored = await app.call('POST', `/api/jobs/${id}/score`);

  assert.equal(scored.status, 200);
  assert.deepEqual(scored.body.fit.overqualification, { level: 'somewhat', note: 'a graduate-level post' });
  // And it did not quietly become a cap: the cap reason is still the hard filter.
  assert.match(scored.body.fit.capReason, /awarded PhD/);
});

// --- the server must survive whatever a route throws -------------------------
//
// Why: the reported symptom was the browser saying it could not reach the
// server, with nothing in the terminal — which is what a crashed process looks
// like from the outside. A model call that fails is the most likely thing to be
// mid-flight when that happens, so these check the process is still answering
// afterwards, not merely that the response was a sensible error.

const throwing = (make) => async ({ task }) => {
  if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
  throw make();
};

async function jobReadyFor(app) {
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  return id;
}

for (const [label, make] of [
  ['a plain Error', () => new Error('the model fell over')],
  ['a string', () => 'nope'],
  ['null', () => null],
  ['an object with no message', () => ({ weird: true })],
]) {
  test(`a revise call that rejects with ${label} is an error response, not a dead server`, async (t) => {
    const app = await startApp({ llmComplete: throwing(make) });
    t.after(() => app.stop());

    const id = await jobReadyFor(app);
    await app.call('PUT', `/api/jobs/${id}/docs/cv`, { markdown: '# Rosa Kimani\n\n## Summary\n\nText.' });

    const revised = await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'tighten it' });
    assert.ok(revised.status >= 400, `expected an error status, got ${revised.status}`);
    assert.ok(revised.body.error, 'and a message to show');

    // The point of the test: the process is still there.
    const after = await app.call('GET', '/api/meta');
    assert.equal(after.status, 200, 'the server stopped answering after the failure');
  });
}

test('a generate that fails leaves the progress record saying where it stopped', async (t) => {
  // The request returns 202 before the work is done, so the run record is the
  // ONLY place a failure can be reported. If it went missing here, a generation
  // that fell over would look identical to one still thinking.
  const app = await startApp({ llmComplete: throwing(() => new Error('the model fell over')) });
  t.after(() => app.stop());

  const id = await jobReadyFor(app);
  const { started, progress } = await generateAndWait(app, id, 'cv');
  assert.equal(started.status, 202, 'starting always succeeds; the work is what failed');

  assert.equal(progress.outcome, 'failed');
  assert.equal(progress.step, 'writing', 'it says which step, not just that it failed');
  assert.match(progress.error, /fell over/, 'and carries the reason, because nothing else is listening');
});

test('a second generation of the same document is refused while the first is running', async (t) => {
  // Both would save, and the loser's version would sit in the history looking
  // like a draft you had asked for.
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return reply(cvArtifact());
    },
  });
  t.after(() => app.stop());

  const id = await jobReadyFor(app);
  const first = await app.call('POST', `/api/jobs/${id}/generate/cv`);
  assert.equal(first.status, 202);

  const second = await app.call('POST', `/api/jobs/${id}/generate/cv`);
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already being written/i);
});

test('two different applications generate at the same time', async (t) => {
  // The whole point of returning early. Applying for three jobs used to mean
  // doing them strictly one after another because the screen was held open.
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return reply(cvArtifact());
    },
  });
  t.after(() => app.stop());

  const a = await jobReadyFor(app);
  const b = await jobReadyFor(app);

  const startedAt = Date.now();
  await app.call('POST', `/api/jobs/${a}/generate/cv`);
  await app.call('POST', `/api/jobs/${b}/generate/cv`);
  assert.ok(Date.now() - startedAt < 200, 'starting both must not wait for either');

  const runs = await app.call('GET', '/api/runs');
  assert.equal(Object.keys(runs.body.runs).length, 2, 'both are in flight at once');

  for (const id of [a, b]) {
    const { progress } = await generateAndWait(app, id, 'cv', { start: false });
    assert.equal(progress.outcome, 'ok');
  }
});

test('the runs list is what the board reads, and it empties when they finish', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);

  const before = await app.call('GET', '/api/runs');
  assert.deepEqual(before.body.runs, {});

  await generateAndWait(app, id, 'cv');
  const after = await app.call('GET', '/api/runs');
  assert.equal(after.body.runs[`${id}:cv`].running, false, 'a finished run lingers briefly, marked finished');
});

test('/api/meta identifies the process, so a restart is detectable from the page', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const meta = await app.call('GET', '/api/meta');
  assert.match(meta.body.startedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('an unknown API route says the server may be older than the page', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const gone = await app.call('POST', '/api/jobs/j_1/docs/cv/no-such-thing');
  assert.equal(gone.status, 404);
  assert.equal(gone.body.stale, true);
  assert.match(gone.body.error, /npm start/, 'it names the fix, not just the fault');
});

// --- the conversation --------------------------------------------------------

async function chatReady(app) {
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, { markdown: '# Rosa Kimani\n\n## Summary\n\nText.' });
  return id;
}

const answering = (data) => async ({ task }) => {
  if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
  return { data, usage: { inputTokens: 10, outputTokens: 5 }, costCents: 2, model: 'stub' };
};

test('a new document has an empty conversation', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  const chat = await app.call('GET', `/api/jobs/${id}/docs/cv/chat`);
  assert.deepEqual(chat.body.turns, []);
});

test('asking records both sides, in order', async (t) => {
  const app = await startApp({ llmComplete: answering({ reply: 'Because the ad opens with it.', revised: false }) });
  t.after(() => app.stop());

  const id = await chatReady(app);
  const asked = await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'why that order?' });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.turns.length, 2);

  const chat = await app.call('GET', `/api/jobs/${id}/docs/cv/chat`);
  assert.deepEqual(chat.body.turns.map((t) => t.role), ['you', 'model']);
  assert.equal(chat.body.turns[0].text, 'why that order?');
  assert.match(chat.body.turns[1].text, /Because the ad opens/);
});

test('the earlier exchange is sent on the next question — this is what makes a follow-up work', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      seen.push(messages[0].content);
      return { data: { reply: 'Done.', revised: false }, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 1, model: 'stub' };
    },
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'make it shorter' });
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'no, shorter' });

  assert.doesNotMatch(seen[0], /Earlier in this conversation/, 'nothing to recall on the first turn');
  assert.match(seen[1], /Earlier in this conversation/);
  assert.match(seen[1], /He asked: make it shorter/);
  assert.match(seen[1], /You said: Done\./);
});

test('the current question is not fed back to itself as history', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      seen.push(messages[0].content);
      return { data: { reply: 'ok', revised: false }, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
    },
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'only once please' });
  assert.equal((seen[0].match(/only once please/g) ?? []).length, 1);
});

test('a question survives a model failure, so it is not lost with the answer', async (t) => {
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      throw new Error('the model fell over');
    },
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  const failed = await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'tighten it' });
  assert.ok(failed.status >= 400);

  const chat = await app.call('GET', `/api/jobs/${id}/docs/cv/chat`);
  assert.equal(chat.body.turns[0].text, 'tighten it', 'the question is still there');
  assert.equal(chat.body.turns[1].failed, true, 'and the failure is recorded, not silent');
});

test('a rewrite is recorded on the turn that made it', async (t) => {
  const rewritten = '# Rosa Kimani\n\n## Summary\n\nShorter text.';
  const app = await startApp({
    llmComplete: answering({ reply: 'Tightened.', revised: true, markdown: rewritten, changes_made: ['cut a sentence'] }),
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'shorter', mode: 'edit' });

  const chat = await app.call('GET', `/api/jobs/${id}/docs/cv/chat`);
  const answer = chat.body.turns[1];
  assert.equal(answer.revised, true);
  assert.ok(answer.version > 1, 'and names the version it wrote');
  assert.deepEqual(answer.changes_made, ['cut a sentence']);
});

// --- Ask or Edit --------------------------------------------------------------
//
// Why: the chat used to rewrite the whole document whenever the model decided
// your question had been an instruction. "Why does this bullet say that?" came
// back as a new version of the CV. The mode is a promise about what a message
// can do, so it is checked here at the route as well as in revise.js — a default
// that goes the wrong way costs somebody the draft they spent an hour on.

test('a message with no mode cannot rewrite the document', async (t) => {
  const rewritten = '# Rosa Kimani\n\n## Summary\n\nRewritten without being asked.';
  const app = await startApp({ llmComplete: answering({ reply: 'I have rewritten it.', revised: true, markdown: rewritten }) });
  t.after(() => app.stop());

  const id = await chatReady(app);
  const before = (await app.call('GET', `/api/jobs/${id}`)).body.docs.cv.markdown;
  const out = await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'why that order?' });

  assert.equal(out.body.revised, false);
  assert.equal(out.body.markdown, null);
  assert.equal(out.body.proposal, rewritten, 'it is offered instead of applied');
  assert.match(out.body.note, /has not changed/, 'and it says so, rather than dropping it silently');

  const after = (await app.call('GET', `/api/jobs/${id}`)).body.docs.cv;
  assert.equal(after.markdown, before, 'the draft is untouched');
  assert.equal(after.versions.length, 1, 'and no version was written');
});

test('the offered version survives a reload, on the turn that made it', async (t) => {
  const rewritten = '# Rosa Kimani\n\n## Summary\n\nOffered, not applied.';
  const app = await startApp({ llmComplete: answering({ reply: 'I have updated the summary.', revised: true, markdown: rewritten }) });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'why that order?' });

  const chat = await app.call('GET', `/api/jobs/${id}/docs/cv/chat`);
  assert.equal(chat.body.turns[1].proposal, rewritten, 'closing the panel must not lose the offer');
});

test('an offered version has its evidence ids stripped, exactly like an applied one', async (t) => {
  // Why: the only difference between the two is a click, so the text you read
  // has to be the text you get. A model asked to respect citations has more than
  // once decided that means printing them.
  const withIds = '# Rosa Kimani\n\n## Summary\n\nA researcher. [edu-phd]';
  const app = await startApp({ llmComplete: answering({ reply: 'Like so.', revised: true, markdown: withIds }) });
  t.after(() => app.stop());

  const id = await chatReady(app);
  const out = await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'what does this claim?' });
  assert.doesNotMatch(out.body.proposal, /\[edu-phd\]/);
});

// --- your profile, marked against the draft ----------------------------------

test('every record comes back marked used or not against the draft on screen', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);

  const out = await app.call('POST', `/api/jobs/${id}/docs/cv/records`, {
    markdown: '# Rosa Kimani\n\n### Research Assistant — Riverina University\n\n- Ran a field season.',
  });
  assert.equal(out.status, 200);
  assert.ok(out.body.records.length > 0, 'the whole profile, not a shortlist');
  const used = out.body.records.filter((r) => r.used);
  assert.ok(used.length > 0, 'the role named in the draft is marked used');
  assert.ok(used.every((r) => r.title || r.org), 'and it is a real record, not an empty match');
  assert.equal(out.body.usedCount, used.length);
});

test('it reads the unsaved draft, not the one on disk', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);

  const saved = await app.call('POST', `/api/jobs/${id}/docs/cv/records`, {});
  const typed = await app.call('POST', `/api/jobs/${id}/docs/cv/records`, {
    markdown: '### Sessional Tutor — Riverina University',
  });
  assert.notDeepEqual(
    saved.body.records.filter((r) => r.used).map((r) => r.id),
    typed.body.records.filter((r) => r.used).map((r) => r.id),
    'what you are looking at is what gets checked',
  );
});

test('each record carries its own words, ready to insert', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  const out = await app.call('POST', `/api/jobs/${id}/docs/cv/records`, {});
  const record = out.body.records[0];
  assert.match(record.markdown, /^### /, 'the record as master-profile.md writes it, heading and all');
});

test('an unknown document kind is refused here too', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  assert.equal((await app.call('POST', `/api/jobs/${id}/docs/nope/records`, {})).status, 404);
});

test('/api/meta says this server understands the two modes', async (t) => {
  // A page that does not see this is talking to a server started before the last
  // pull, which would rewrite a draft to answer a question.
  const app = await startApp();
  t.after(() => app.stop());
  assert.equal((await app.call('GET', '/api/meta')).body.chatModes, true);
});

test('an unrecognised mode is treated as Ask, not as Edit', async (t) => {
  const rewritten = '# Rosa Kimani\n\n## Summary\n\nRewritten from a typo.';
  const app = await startApp({ llmComplete: answering({ reply: 'Done.', revised: true, markdown: rewritten }) });
  t.after(() => app.stop());

  const id = await chatReady(app);
  const out = await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'shorter', mode: 'EDIT ' });
  assert.equal(out.body.revised, false, 'anything that is not exactly "edit" is a question');
});

test('the mode and the quoted passage are kept on the turn that used them', async (t) => {
  const sent = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      sent.push(messages[0].content);
      return { data: { reply: 'It claims the analysis was yours.', revised: false }, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
    },
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, {
    instruction: 'what does this claim?',
    mode: 'ask',
    quote: 'Led the evaluation of a national programme.',
  });

  assert.match(sent[0], /> Led the evaluation of a national programme\./, 'the model is shown the passage');
  assert.match(sent[0], /## Mode: ASK/, 'and told it may not rewrite anything');

  const chat = await app.call('GET', `/api/jobs/${id}/docs/cv/chat`);
  assert.equal(chat.body.turns[0].mode, 'ask');
  assert.equal(chat.body.turns[0].quote, 'Led the evaluation of a national programme.');
});

test('clearing the conversation keeps every document version it produced', async (t) => {
  const rewritten = '# Rosa Kimani\n\n## Summary\n\nRewritten by the model.';
  const app = await startApp({ llmComplete: answering({ reply: 'Done.', revised: true, markdown: rewritten }) });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'rewrite it', mode: 'edit' });

  const cleared = await app.call('DELETE', `/api/jobs/${id}/docs/cv/chat`);
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.turns, []);

  const job = await app.call('GET', `/api/jobs/${id}`);
  assert.match(job.body.docs.cv.markdown, /Rewritten by the model/);
  assert.ok(job.body.docs.cv.versions.length >= 2, 'the history is intact');
});

test('the CV and cover letter conversations do not mix', async (t) => {
  const app = await startApp({ llmComplete: answering({ reply: 'ok', revised: false }) });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('PUT', `/api/jobs/${id}/docs/cover-letter`, { markdown: 'Dear team,\n\nHello.' });
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'about the cv' });

  const letter = await app.call('GET', `/api/jobs/${id}/docs/cover-letter/chat`);
  assert.deepEqual(letter.body.turns, []);
});

test('an unknown document kind is refused on both chat routes', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  assert.equal((await app.call('GET', `/api/jobs/${id}/docs/nope/chat`)).status, 404);
  assert.equal((await app.call('DELETE', `/api/jobs/${id}/docs/nope/chat`)).status, 404);
});

// --- the chat must see the whole profile -------------------------------------
//
// Why: asked to add a research-assistant role, the model answered "there are no
// evidence records in your master profile for Newcastle University" — about a
// record sitting in that file. It had been shown only the ranked, capped subset
// generation uses, and reported the limit of its view as a fact about the person's life.

test('revise is given every evidence record, not the generation subset', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      seen.push(messages[0].content);
      return { data: { reply: 'ok', revised: false }, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
    },
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'add my tutoring role' });

  const sent = seen[0];
  for (const record of evidence) {
    assert.ok(sent.includes(`### ${record.id}`), `${record.id} was withheld from the chat`);
  }
});

test('the record the model denied existed is among them', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      seen.push(messages[0].content);
      return { data: { reply: 'ok', revised: false }, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
    },
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'add my tutoring role' });
  assert.match(seen[0], /### role-tutor/);
  assert.match(seen[0], /Riverina University/);
});

test('the chat is told the list is complete, so "not here" is a safe thing to say', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      seen.push(messages[0].content);
      return { data: { reply: 'ok', revised: false }, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
    },
  });
  t.after(() => app.stop());

  const id = await chatReady(app);
  await app.call('POST', `/api/jobs/${id}/docs/cv/revise`, { instruction: 'anything' });
  assert.match(seen[0], /COMPLETE profile, not a shortlist/);
  assert.match(seen[0], /\[relevant\]/, 'and still marks what the selector ranked highly');
});

test('generation is still given the ranked subset, not everything', async (t) => {
  // The two calls want different things: composing needs focus, editing needs
  // reach. Widening revise must not quietly widen generation.
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return { data: JD_JSON, usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
      seen.push(messages[0].content);
      return { data: cvArtifact(), usage: { inputTokens: 1, outputTokens: 1 }, costCents: 0, model: 'stub' };
    },
  });
  t.after(() => app.stop());

  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('POST', `/api/jobs/${id}/generate/cv`);

  const offered = (seen[0].match(/^### /gm) ?? []).length;
  assert.ok(offered < evidence.length, `generation saw all ${offered} records; it should see a selection`);
});

// --- reading the history -------------------------------------------------------
//
// Every save has always kept the version before it. Until there was a way to
// read one from the app, that was a property of the data directory rather than
// a feature: pressing "Generate again" and preferring what it replaced meant
// going to look for a file.

test('an earlier version can be read back, exactly as it was saved', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, { markdown: '# Rosa Kimani\n\n## Summary\n\nSecond.' });

  const first = await app.call('GET', `/api/jobs/${id}/docs/cv/versions/1`);
  assert.equal(first.status, 200);
  assert.equal(first.body.v, 1);
  assert.match(first.body.markdown, /Text\./, 'v1 must still say what v1 said');

  const second = await app.call('GET', `/api/jobs/${id}/docs/cv/versions/2`);
  assert.match(second.body.markdown, /Second\./);
});

test('a version that does not exist says so rather than returning an empty document', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  const missing = await app.call('GET', `/api/jobs/${id}/docs/cv/versions/99`);
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /version 99/);
});

test('a nonsense version number is refused, not read as a path', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  for (const v of ['0', '-1', 'x', '..%2F..%2Fmeta']) {
    const res = await app.call('GET', `/api/jobs/${id}/docs/cv/versions/${v}`);
    assert.equal(res.status, 404, `version "${v}" must not resolve`);
  }
});

// --- ticking a publication changes the document --------------------------------

test('ticking a publication does not touch the saved draft', async (t) => {
  // The bug this replaces cost real work. Ticking used to rewrite the CV from
  // the last SAVED text and store it as a new version — so anyone mid-edit lost
  // whatever was in the editor, silently, at the moment they ticked a box.
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  const original = '# Rosa Kimani\n\n## Publications\n\n- Nothing yet.\n\n## Education\n\n- A degree.';
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, { markdown: original });

  const available = await app.call('GET', `/api/jobs/${id}/publications`);
  const ticked = await app.call('PUT', `/api/jobs/${id}/publications`, {
    selected: [available.body.publications[0].id],
  });
  assert.equal(ticked.status, 200);

  const now = await app.call('GET', `/api/jobs/${id}`);
  assert.equal(now.body.docs.cv.markdown, original, 'the saved draft must be byte-identical');
  assert.equal(now.body.docs.cv.versions.length, 1, 'and no version may have been added');
});

test('the ticked publications appear on the way out, in the export', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, {
    markdown: '# Rosa Kimani\n\n## Publications\n\n- Nothing yet.\n\n## Education\n\n- A degree.',
  });

  const available = await app.call('GET', `/api/jobs/${id}/publications`);
  const chosen = available.body.publications[0];
  await app.call('PUT', `/api/jobs/${id}/publications`, { selected: [chosen.id] });

  const printed = await app.call('GET', `/print/${id}/cv`);
  assert.equal(printed.status, 200);
  assert.doesNotMatch(printed.body, /Nothing yet/, 'the old list is replaced at render time');
  assert.match(printed.body, /Education/, 'and nothing else moves');

  const tex = await app.call('GET', `/api/jobs/${id}/docs/cv/latex`);
  assert.doesNotMatch(tex.body, /Nothing yet/);
});

test('unticking everything removes them from the export too', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, {
    markdown: '# Rosa Kimani\n\n## Publications\n\n- Nothing yet.\n\n## Education\n\n- A degree.',
  });
  await app.call('PUT', `/api/jobs/${id}/publications`, { selected: [] });

  const printed = await app.call('GET', `/print/${id}/cv`);
  assert.doesNotMatch(printed.body, /Nothing yet/);
  assert.match(printed.body, /Education/);
});

test('a cover letter is exported exactly as saved — publications are a CV thing', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/docs/cover-letter`, {
    markdown: '# Rosa Kimani\n\n## Publications\n\n- A line that is not a citation.',
  });
  const available = await app.call('GET', `/api/jobs/${id}/publications`);
  await app.call('PUT', `/api/jobs/${id}/publications`, { selected: [available.body.publications[0].id] });

  const printed = await app.call('GET', `/print/${id}/cover-letter`);
  assert.match(printed.body, /A line that is not a citation/);
});

test('a tick before anything is generated is not an error', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);

  const available = await app.call('GET', `/api/jobs/${id}/publications`);
  const ticked = await app.call('PUT', `/api/jobs/${id}/publications`, {
    selected: [available.body.publications[0].id],
  });
  assert.equal(ticked.status, 200);
  assert.equal(ticked.body.chosenBy, 'human');
});

test('evidence ids a model wrote into the text never survive a save', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await chatReady(app);
  const saved = await app.call('PUT', `/api/jobs/${id}/docs/cv`, {
    markdown: '# Rosa Kimani\n\n## Experience\n\n- Ran the experiments (edu-phd).',
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.strippedIds, ['edu-phd']);

  const now = await app.call('GET', `/api/jobs/${id}`);
  assert.doesNotMatch(now.body.docs.cv.markdown, /edu-phd/);
  assert.match(now.body.docs.cv.markdown, /Ran the experiments\./);
});

// --- selection criteria and application questions -------------------------------
//
// The third thing every application asks for, and the one the app had no answer
// to: eight boxes wanting 300 words each, behind a login, where the day goes.

test('pasted questions are split, and their word limits read out of them', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);

  const saved = await app.call('PUT', `/api/jobs/${id}/questions`, {
    text: '1. Describe your experience designing evaluations. (300 words max)\n\n2. Tell us about working in a multidisciplinary team.',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.source, 'you');
  assert.equal(saved.body.questions.length, 2);
  assert.equal(saved.body.questions[0].wordLimit, 300);
  assert.equal(saved.body.questions[1].wordLimit, null);
  assert.match(saved.body.questions[0].question, /^Describe/, 'the numbering is formatting, not content');
});

test('generating answers produces one heading per question, in order', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/questions`, {
    text: 'Describe your experience designing evaluations. (300 words max)\n\nTell us about working in a multidisciplinary team.',
  });

  const answers = await generateAndWait(app, id, 'criteria');
  assert.equal(answers.progress.outcome, 'ok', answers.progress.error ?? '');
  const headings = [...answers.doc.markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  assert.equal(headings.length, 2);
  assert.match(headings[0], /^Describe your experience/);
  assert.match(headings[1], /^Tell us about working/);
  assert.match(answers.doc.markdown, /five-person review team/, 'the answer itself must be in the document');
});

test('generating with no questions is refused before a model is paid', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);

  const before = app.calls.length;
  const refused = await app.call('POST', `/api/jobs/${id}/generate/criteria`);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /paste them in/i);
  assert.equal(app.calls.length, before, 'no model call may be made for a document with nothing to say');
});

test('the model is told each question and its limit, in words', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      seen.push(messages[0].content);
      return reply(criteriaArtifact());
    },
  });
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/questions`, { text: 'A question about teamwork (250 words max)' });
  await app.call('POST', `/api/jobs/${id}/generate/criteria`);

  assert.match(seen[0], /A question about teamwork/);
  assert.match(seen[0], /Limit: 250 words/, 'a limit stated as prose is followed; one stated as JSON metadata is not');
});

test('the answers are counted against their limits, from the saved text', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/questions`, { text: 'A question (25 words max)\n\nAnother question' });
  await app.call('PUT', `/api/jobs/${id}/docs/criteria`, {
    markdown: `## A question\n\n${'word '.repeat(30).trim()}\n\n## Another question\n\n${'word '.repeat(400).trim()}`,
  });

  const { body } = await app.call('GET', `/api/jobs/${id}/questions`);
  assert.equal(body.counts[0].words, 30);
  assert.equal(body.counts[0].over, true, 'an answer a portal would truncate must say so');
  assert.equal(body.counts[1].words, 400);
  assert.equal(body.counts[1].over, false, 'no limit means it can never be over');
});

test('the advertisement supplies the questions until you paste your own', async (t) => {
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task !== 'parse-jd') throw new Error(`unexpected task ${task}`);
      return reply({ ...JD_JSON, selection_criteria: [{ question: 'From the ad', word_limit: 400 }] });
    },
  });
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);

  const fromAd = await app.call('GET', `/api/jobs/${id}/questions`);
  assert.equal(fromAd.body.source, 'advertisement');
  assert.equal(fromAd.body.questions[0].wordLimit, 400);

  const mine = await app.call('PUT', `/api/jobs/${id}/questions`, { text: 'From the portal' });
  assert.equal(mine.body.source, 'you');
  assert.equal(mine.body.questions.length, 1, 'your paste replaces the ad, it does not merge with it');
});

test('an edited answer sheet is re-checked in advisory mode like any other document', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);

  const saved = await app.call('PUT', `/api/jobs/${id}/docs/criteria`, {
    markdown: '## A question\n\nI cut costs by 4173 percent last quarter.',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.flags.errors.length, 0);
  assert.ok(
    saved.body.flags.warnings.some((w) => w.message.includes('4173')),
    'an invented figure in an answer is the same problem as one on a CV',
  );
});

test('answers export as prose, not as a bullet list', async (t) => {
  // A criteria heading like "Demonstrated experience leading teams" would
  // otherwise match the CV's "experience" slot and be typeset as bullets.
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await app.call('PUT', `/api/jobs/${id}/docs/criteria`, {
    markdown: '## Demonstrated experience leading teams\n\nI led the review team for two years.',
  });

  const tex = await app.call('GET', `/api/jobs/${id}/docs/criteria/latex`);
  assert.equal(tex.status, 200);
  assert.match(tex.body, /I led the review team for two years\./);
  assert.doesNotMatch(tex.body, /\\begin\{itemize\}/, 'an answer is prose; a bullet list is a CV');
});

// --- approaching a company that is not advertising -------------------------------
//
// The whole risk here is one confusion: an advertisement STATES its
// requirements, and notes about a startup do not. Every requirement on a cold
// job was inferred by the app from your own text, and the moment that can pass
// for something a company said, the app is lying to you with a straight face.

const COLD_NOTES = `Small Melbourne team building evaluation tooling for clinical AI.
Four engineers, no measurement person. Spun out of a university lab last year.
Met their research lead at a conference.`;

const COLD_PARSE = {
  ...JD_JSON,
  company: 'Vector Clinical',
  role_title: 'Research Engineer',
  closing_date: null,
  selection_criteria: [],
  requirements: [
    { text: 'Designing measurement for model behaviour', kind: 'experience', must_have: false },
    { text: 'Python', kind: 'skill', must_have: false },
  ],
};

async function coldJob(app) {
  const created = await app.call('POST', '/api/jobs', { rawText: COLD_NOTES, source: 'cold' });
  await app.call('POST', `/api/jobs/${created.body.job.id}/parse`);
  return created.body.job.id;
}

const coldStub = async ({ task }) => {
  if (task === 'parse-jd') return reply(COLD_PARSE);
  if (task === 'generate-cold-email') return reply(coldEmailArtifact());
  if (task === 'generate-cv') return reply(cvArtifact());
  throw new Error(`unexpected task ${task}`);
};

test('a cold approach is recorded as one, and stays one', async (t) => {
  const app = await startApp({ llmComplete: coldStub });
  t.after(() => app.stop());
  const id = await coldJob(app);
  const { body } = await app.call('GET', `/api/jobs/${id}`);
  assert.equal(body.job.source, 'cold');
  assert.equal(body.job.rawAd, COLD_NOTES, 'your notes are kept verbatim — the email can only be as specific as they are');
});

test('the notes are read with a different prompt from an advertisement', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, system, messages }) => {
      seen.push({ task, system, user: messages[0].content });
      return reply(COLD_PARSE);
    },
  });
  t.after(() => app.stop());
  await coldJob(app);

  assert.match(seen[0].system, /no job\s+advertisement and no open role/i);
  assert.match(seen[0].system, /must_have:\s*false/, 'nothing inferred may become a hard filter');
  assert.match(seen[0].user, /Notes about a company/);
});

test('a cold approach cannot be scored, and says why', async (t) => {
  const app = await startApp({ llmComplete: coldStub });
  t.after(() => app.stop());
  const id = await coldJob(app);

  const refused = await app.call('POST', `/api/jobs/${id}/score`);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /nothing to score this against/i);
  assert.match(refused.body.error, /made up/i, 'the reason has to name the problem, not just decline');
});

test('the email is laid out to be pasted into a mail client', async (t) => {
  const app = await startApp({ llmComplete: coldStub });
  t.after(() => app.stop());
  const id = await coldJob(app);

  const email = await generateAndWait(app, id, 'cold-email');
  assert.equal(email.progress.outcome, 'ok', email.progress.error ?? '');
  const md = email.doc.markdown;

  assert.match(md, /\*\*Subject:\*\* Evaluation infrastructure/, 'an unlabelled first line gets pasted into the body');
  assert.match(md, /Hi Vector Clinical team,/, 'the greeting is written in code, not by the model');
  assert.match(md, /Best,/);
  assert.doesNotMatch(md.split('Best,')[0], /^# /m, 'contact details belong in the sign-off, not as a letterhead');
});

test('an email is short — the length rule is in the prompt the model actually gets', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return reply(COLD_PARSE);
      seen.push(messages[0].content);
      return reply(coldEmailArtifact());
    },
  });
  t.after(() => app.stop());
  const id = await coldJob(app);
  await app.call('POST', `/api/jobs/${id}/generate/cold-email`);

  assert.match(seen[0], /120-180 words/);
  assert.match(seen[0], /must come from the notes below/i, 'inventing a detail about a small company is the one unsurvivable mistake');
});

test('a figure invented in the subject line is still flagged', async (t) => {
  // The subject is the one line everybody reads, and it was the obvious place
  // for a number with no record behind it to slip through unchecked.
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return reply(COLD_PARSE);
      return reply({ ...coldEmailArtifact(), subject: 'I cut evaluation time by 4173 percent' });
    },
  });
  t.after(() => app.stop());
  const id = await coldJob(app);

  const email = await generateAndWait(app, id, 'cold-email');
  const flags = email.doc.versions.at(-1).flags;
  const all = [...flags.errors, ...flags.warnings];
  const caught = all.some((f) => f.ref === 'cold-email.subject' && JSON.stringify(f).includes('4173'));
  assert.ok(caught, `expected the subject line to be flagged: ${JSON.stringify(all)}`);
});

test('a CV for a cold approach is generated the same way as any other', async (t) => {
  // The point of parsing notes into the advertisement shape: everything
  // downstream keeps working without knowing where the shape came from.
  const app = await startApp({ llmComplete: coldStub });
  t.after(() => app.stop());
  const id = await coldJob(app);

  const cv = await generateAndWait(app, id, 'cv');
  assert.equal(cv.progress.outcome, 'ok', cv.progress.error ?? '');
  assert.match(cv.doc.markdown, /## /, 'a real CV, not an empty shell');
});

test('an ordinary job is unaffected — it still scores, and reads the advertisement prompt', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: RAW_AD });
  const id = created.body.job.id;
  assert.equal(created.body.job.source, 'pasted');
  await app.call('POST', `/api/jobs/${id}/parse`);
  const scored = await app.call('POST', `/api/jobs/${id}/score`);
  assert.equal(scored.status, 200);
});

test('creating a cold approach with nothing written says what to write', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const empty = await app.call('POST', '/api/jobs', { rawText: '  ', source: 'cold' });
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /what you know about the company/i);
});

// --- editing the profile while the app runs -------------------------------------
//
// This is the main loop, not an edge case: the flags panel asks for a number, you
// opens master-profile.md, adds it, presses Generate — and used to get the same
// draft back, because the records were parsed once at startup and nothing ever
// looked again. There was no error and no warning; the file plainly said what you
// had just typed.

/** An app whose profile is a real file in a temp directory, so it can be edited. */
async function appWithEditableProfile(t, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-profile-'));
  const file = path.join(dir, 'master-profile.md');
  fs.writeFileSync(file, contents, 'utf8');

  const { watchFile } = await import('./profile/live.js');
  const { loadEvidence: load } = await import('./profile/parse.js');
  const watcher = watchFile({ file, load: (f) => load(f) });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { file, watcher };
}

const RECORD = (id, title) => `### ${title}
id: ${id}
dates: 2020-01 .. 2021-06
tags: statistics
profiles: research

Did a thing with statistics.
`;

test('an edit to master-profile.md is picked up without a restart', async (t) => {
  const { file, watcher } = await appWithEditableProfile(t, `## Roles\n\n${RECORD('role-a', 'A role')}`);
  assert.equal(watcher.read().value.length, 1);

  fs.writeFileSync(file, `## Roles\n\n${RECORD('role-a', 'A role')}\n${RECORD('role-tutor', 'Research Assistant')}`, 'utf8');
  const after = watcher.read();
  assert.equal(after.value.length, 2, 'the record you just added must be there');
  assert.ok(after.value.some((r) => r.id === 'role-tutor'));
  assert.equal(after.error, null);
});

test('a half-finished edit never replaces the profile that worked', async (t) => {
  const { file, watcher } = await appWithEditableProfile(t, `## Roles\n\n${RECORD('role-a', 'A role')}`);
  watcher.read();

  // Missing the required metadata — exactly what a file looks like mid-edit.
  fs.writeFileSync(file, '## Roles\n\n### Half typed\nid: role-b\n', 'utf8');
  const broken = watcher.read();
  assert.equal(broken.value.length, 1, 'the CV must not silently lose records');
  assert.match(broken.error, /line \d+/, 'and it must say which line');

  fs.writeFileSync(file, `## Roles\n\n${RECORD('role-a', 'A role')}\n${RECORD('role-b', 'B role')}`, 'utf8');
  const fixed = watcher.read();
  assert.equal(fixed.error, null);
  assert.equal(fixed.value.length, 2);
});

test('a profile problem is reported on /api/meta, not left to be guessed at', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { body } = await app.call('GET', '/api/meta');
  assert.ok('profileError' in body, 'the page needs a way to know');
  assert.equal(body.profileError, null, 'the real profile parses');
  assert.ok(body.evidenceCount > 0);
});

// --- deleting an application ------------------------------------------------------

test('deleting removes the job and every draft under it', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  assert.ok(fs.existsSync(path.join(app.dataDir, 'apps', id, 'cv.v1.md')));

  const gone = await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  assert.equal(gone.status, 200);
  assert.ok(gone.body.files > 1, 'the drafts count too, not just the record');

  assert.ok(!fs.existsSync(path.join(app.dataDir, 'jobs', `${id}.json`)));
  assert.ok(!fs.existsSync(path.join(app.dataDir, 'apps', id)));
  assert.equal((await app.call('GET', `/api/jobs/${id}`)).status, 404);
});

test('deleting needs the id confirmed, so a stale link cannot do it', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);

  assert.equal((await app.call('DELETE', `/api/jobs/${id}`)).status, 400);
  assert.equal((await app.call('DELETE', `/api/jobs/${id}`, { confirm: 'j_something_else' })).status, 400);
  assert.equal((await app.call('GET', `/api/jobs/${id}`)).status, 200, 'and the job is still there');
});

test('deleting is refused while something is being written for it', async (t) => {
  // The run would carry on and its save would recreate the folder just removed.
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return reply(cvArtifact());
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await app.call('POST', `/api/jobs/${id}/generate/cv`);

  const refused = await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /being written/i);
  await generateAndWait(app, id, 'cv', { start: false });
});

test('the deletion is on the event log, which is not deleted', async (t) => {
  // "How long until they replied" is answered across the whole history, and
  // that history outlives any one application.
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });

  const events = readJsonl(path.join(app.dataDir, 'events.jsonl'));
  assert.ok(events.some((e) => e.jobId === id && e.type === 'deleted'));
  assert.ok(events.some((e) => e.jobId === id && e.type === 'created'), 'the earlier lines survive too');
});

// --- notes that reach generation ---------------------------------------------------

test('notes are saved and given back', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);

  const saved = await app.call('PUT', `/api/jobs/${id}/notes`, { notes: 'Mention my E-3 eligibility.' });
  assert.equal(saved.status, 200);
  assert.equal((await app.call('GET', `/api/jobs/${id}`)).body.job.notes, 'Mention my E-3 eligibility.');
});

test('what you wrote reaches the model, at the top of the brief', async (t) => {
  // First because a model reading a long prompt weights the top of it, and this
  // is the only part of the brief you wrote yourself.
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      seen.push(messages[0].content);
      return reply(cvArtifact());
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await app.call('PUT', `/api/jobs/${id}/notes`, { notes: 'Mention my E-3 eligibility in the header.' });
  await generateAndWait(app, id, 'cv');

  assert.match(seen[0], /Mention my E-3 eligibility in the header\./);
  assert.ok(
    seen[0].indexOf('E-3 eligibility') < seen[0].indexOf('## The job'),
    'your own instruction must come before the advertisement',
  );
  assert.match(seen[0], /cannot do is license a claim/i, 'and it must not be able to make something true');
});

test('no notes means no section, rather than an empty heading', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      seen.push(messages[0].content);
      return reply(cvArtifact());
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  assert.doesNotMatch(seen[0], /What the applicant asked for on this application/);
});

test('a note longer than the cap is trimmed rather than refused', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  const saved = await app.call('PUT', `/api/jobs/${id}/notes`, { notes: 'x'.repeat(9000) });
  assert.equal(saved.status, 200);
  assert.ok(saved.body.notes.length <= 4000);
});

// --- the records, for when the model chose wrongly ---------------------------------

test('every record is offered as markdown you can paste in', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { body } = await app.call('GET', '/api/evidence');

  assert.equal(body.records.length, evidence.length);
  const one = body.records.find((r) => r.markdown.trim() !== '');
  assert.match(one.markdown, /^### /, 'it goes into a draft, so it is a heading and prose');
  assert.ok(one.id && 'kind' in one && 'tags' in one, 'searchable by the things you would search by');
});

test('the record is the record’s own words, not a summary of them', async (t) => {
  // The premise of this feature is that a judgement about this record was
  // already made wrongly once. Rewriting it here would be the same judgement.
  const app = await startApp();
  t.after(() => app.stop());
  const { body } = await app.call('GET', '/api/evidence');
  const record = evidence.find((r) => String(r.body ?? '').trim() !== '');
  const offered = body.records.find((r) => r.id === record.id);
  assert.ok(offered.markdown.includes(record.body.trim().split('\n')[0]));
});

// --- the skills section answers the list it was given -------------------------------

test('the advertisement’s skill list is given to the CV, in its own order', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      seen.push(messages[0].content);
      return reply(cvArtifact());
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');

  assert.match(seen[0], /The skills this advertisement lists/);
  for (const [i, skill] of JD_JSON.skills.entries()) {
    assert.match(seen[0], new RegExp(`${i + 1}\\. ${skill}`), `skill ${skill} missing or out of order`);
  }
  assert.match(seen[0], /LEFT OUT/, 'a skill with nothing behind it must not be softened into a claim');
});

test('a cover letter is not given the skills rule — it has no skills section', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      seen.push(messages[0].content);
      return reply(coverLetterArtifact());
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cover-letter');
  assert.doesNotMatch(seen[0], /The skills this advertisement lists/);
});

// --- the advertisement's words, back on the screen ------------------------------
//
// The panel that shows them hides itself when the server says there is nothing
// to measure. That guard is right, and it is also how the whole feature once
// vanished: the response that carried the coverage numbers was the one response
// that forgot to say the panel was available, so it appeared only before there
// was a document and never again. Hence a test for the SHAPE, not just the maths.

test('the keyword panel is told it is available on every answer that has keywords', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);

  const before = await app.call('GET', `/api/jobs/${id}/docs/cv/keywords`);
  assert.equal(before.body.available, true, 'available before anything is generated');
  assert.equal(before.body.score, null, 'and no score, because there is nothing to score');
  assert.ok(before.body.keywords.length > 0);

  await generateAndWait(app, id, 'cv');

  const after = await app.call('GET', `/api/jobs/${id}/docs/cv/keywords`);
  assert.equal(after.body.available, true, 'and still available once there is a document');
  assert.equal(typeof after.body.score, 'number');
  assert.ok(Array.isArray(after.body.covered) && Array.isArray(after.body.missing));
  assert.equal(
    after.body.covered.length + after.body.missing.length,
    after.body.keywords.length,
    'every keyword is either used or not; none may go missing between the two lists',
  );
  for (const keyword of after.body.keywords) {
    assert.ok(
      keyword.term && typeof keyword.weight === 'number' && Array.isArray(keyword.sources) && keyword.sources.length > 0,
      `${JSON.stringify(keyword)} is missing a field the panel renders`,
    );
  }

  // Heaviest first, because the panel prints them in the order it is given and
  // a missing must-have buried under four nice-to-haves is a missing must-have
  // nobody sees.
  const weights = after.body.keywords.map((k) => k.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => b - a), 'keywords must arrive ordered by weight');
});

test('a cold approach reports no keywords rather than measuring the app against itself', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: COLD_NOTES, source: 'cold' });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);

  const body = (await app.call('GET', `/api/jobs/${id}/docs/cold-email/keywords`)).body;
  assert.equal(body.available, false, 'nobody advertised anything, so there is nothing to match');
  assert.deepEqual(body.keywords, []);
});

// --- the bin -------------------------------------------------------------------
//
// Delete used to be permanent behind a two-click confirmation. A confirmation is
// a speed bump, not a safety net, and what was on the other side of it was a day
// of writing. These tests exist to make sure the undo genuinely works — a bin
// that loses the drafts is worse than no bin, because it looks safe.

test('deleting moves an application to the bin instead of destroying it', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');

  const before = (await app.call('GET', `/api/jobs/${id}`)).body.docs.cv.markdown;
  assert.ok(before.length > 0, 'there is a draft to lose');

  const deleted = await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.ok(deleted.body.files > 0, 'it says how many files went with it');

  // Off the board...
  assert.equal((await app.call('GET', `/api/jobs/${id}`)).status, 404);
  const board = await app.call('GET', '/api/board');
  assert.ok(!Object.values(board.body.board).flat().some((job) => job.id === id));

  // ...but in the bin, with the draft count still attached.
  const trash = await app.call('GET', '/api/trash');
  assert.equal(trash.body.trash.length, 1);
  assert.equal(trash.body.trash[0].id, id);
  assert.ok(trash.body.trash[0].deletedAt, 'stamped, so the bin can be ordered');
  assert.ok(trash.body.trash[0].files > 0);
});

test('restoring brings back the job AND every draft, byte for byte', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, { markdown: '# Mine\n\nAn edit I would hate to lose.' });

  const before = await app.call('GET', `/api/jobs/${id}`);
  const beforeDoc = before.body.docs.cv;

  await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  const restored = await app.call('POST', `/api/trash/${id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.restored, true);

  const after = await app.call('GET', `/api/jobs/${id}`);
  assert.equal(after.status, 200);
  assert.equal(after.body.job.status, before.body.job.status, 'back in the lane it was in');
  assert.equal(after.body.docs.cv.markdown, beforeDoc.markdown, 'the edit survived');
  assert.equal(
    after.body.docs.cv.versions.length,
    beforeDoc.versions.length,
    'and so did every earlier version',
  );
  assert.ok(!('deletedAt' in after.body.job), 'a restored job must not still look binned');
  assert.deepEqual((await app.call('GET', '/api/trash')).body.trash, [], 'and it left the bin');
});

test('a delete needs the id in the body, so a stale link cannot bin anything', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);

  assert.equal((await app.call('DELETE', `/api/jobs/${id}`, {})).status, 400);
  assert.equal((await app.call('DELETE', `/api/jobs/${id}`, { confirm: 'wrong' })).status, 400);
  assert.equal((await app.call('GET', `/api/jobs/${id}`)).status, 200, 'still there');
});

test('permanent deletion happens only from the bin, and only with the id', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });

  assert.equal((await app.call('DELETE', `/api/trash/${id}`, {})).status, 400, 'no confirm, no purge');
  assert.equal((await app.call('GET', '/api/trash')).body.trash.length, 1, 'still recoverable');

  const purged = await app.call('DELETE', `/api/trash/${id}`, { confirm: id });
  assert.equal(purged.status, 200);
  assert.ok(purged.body.files > 0);
  assert.deepEqual((await app.call('GET', '/api/trash')).body.trash, []);
  assert.equal((await app.call('POST', `/api/trash/${id}/restore`)).status, 404, 'gone for good');
});

test('emptying the bin is confirmed by its count, not by a word', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  for (let i = 0; i < 3; i += 1) {
    const id = await jobReadyFor(app);
    await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  }
  assert.equal((await app.call('GET', '/api/trash')).body.trash.length, 3);

  // A page that was showing two cannot empty a bin that now holds three.
  assert.equal((await app.call('DELETE', '/api/trash', { confirm: 2 })).status, 400);
  assert.equal((await app.call('GET', '/api/trash')).body.trash.length, 3, 'nothing was touched');

  const emptied = await app.call('DELETE', '/api/trash', { confirm: 3 });
  assert.equal(emptied.status, 200);
  assert.equal(emptied.body.purged, 3);
  assert.deepEqual((await app.call('GET', '/api/trash')).body.trash, []);
});

test('the bin is ordered by when things were binned, newest first', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const id = await jobReadyFor(app);
    ids.push(id);
    await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
    await new Promise((resolve) => setTimeout(resolve, 5)); // distinct timestamps
  }
  const order = (await app.call('GET', '/api/trash')).body.trash.map((job) => job.id);
  assert.deepEqual(order, [...ids].reverse());
});

test('restoring something that is not in the bin says so rather than 500ing', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const missing = await app.call('POST', '/api/trash/j_does_not_exist/restore');
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /not in the bin/i);
});

test('a job being written cannot be binned out from under the run', async (t) => {
  // The save at the end of a run would recreate the folder the delete just moved
  // away, leaving half an application in each place.
  const app = await startApp({ llmComplete: slowModel(600) });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await app.call('POST', `/api/jobs/${id}/generate/cv`);

  const refused = await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /being written/i);

  await waitForRun(app, id, 'cv');
  assert.equal((await app.call('DELETE', `/api/jobs/${id}`, { confirm: id })).status, 200);
});

test('the log keeps a line for the delete, the restore and the purge', async (t) => {
  // The whole history outlives any one application, so "how long until they
  // replied" is still answerable after something is thrown away.
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  await app.call('POST', `/api/trash/${id}/restore`);
  await app.call('DELETE', `/api/jobs/${id}`, { confirm: id });
  await app.call('DELETE', `/api/trash/${id}`, { confirm: id });

  const lines = fs
    .readFileSync(path.join(app.dataDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.jobId === id)
    .map((event) => event.type);

  for (const type of ['deleted', 'restored', 'purged']) {
    assert.ok(lines.includes(type), `no ${type} line`);
  }
});

// --- a recruiter's read of the draft ---------------------------------------------
//
// The fit score reads your profile. This reads the document, which is the thing
// that actually gets sent, and it is the only feature that hands a model your
// draft and asks what to change. recruiter.test.js pins the checks; these pin
// that the route wires the right things into them.

const reviewReply = (over = {}) => ({
  verdict: 'maybe',
  first_impression: 'Competent, but the evaluation work is buried.',
  strengths: ['The dates are concrete.'],
  concerns: [{ concern: 'Evaluation work is not visible early.', fix: 'Lead with it.' }],
  keywords_to_work_in: [],
  records_to_add: [],
  ...over,
});

test('a review reads the SAVED draft, not the profile and not the editor', async (t) => {
  const seen = [];
  const app = await startApp({
    llmComplete: async ({ task, messages }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      if (task === 'generate-cv') return reply(cvArtifact());
      seen.push(messages[0].content);
      return reply(reviewReply());
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, { markdown: '# Saved\n\nA line that is definitely in the saved draft.' });

  const res = await app.call('POST', `/api/jobs/${id}/docs/cv/review`);
  assert.equal(res.status, 200);
  assert.match(seen[0], /definitely in the saved draft/, 'the saved text reached the model');
  assert.match(seen[0], /The advertisement you are screening against/);
  assert.equal(res.body.review.verdict, 'maybe');
  assert.equal(res.body.review.firstImpression, 'Competent, but the evaluation work is buried.');
});

test('a review is refused before there is a document to review', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  const early = await app.call('POST', `/api/jobs/${id}/docs/cv/review`);
  assert.equal(early.status, 409);
  assert.match(early.body.error, /no cv to review/i);
});

test('a review is refused on a cold approach, which has no advertisement', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const created = await app.call('POST', '/api/jobs', { rawText: COLD_NOTES, source: 'cold' });
  const id = created.body.job.id;
  await app.call('POST', `/api/jobs/${id}/parse`);
  await generateAndWait(app, id, 'cold-email');

  const refused = await app.call('POST', `/api/jobs/${id}/docs/cold-email/review`);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Nobody advertised this role/);
});

test('an invented record id never reaches the screen', async (t) => {
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      if (task === 'generate-cv') return reply(cvArtifact());
      return reply(
        reviewReply({
          records_to_add: [
            { record_id: 'role-that-does-not-exist', why: 'It would help' },
            { record_id: offeredIds[0], why: 'A real one' },
          ],
        }),
      );
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');

  const { body } = await app.call('POST', `/api/jobs/${id}/docs/cv/review`);
  const ids = body.review.records.map((r) => r.id);
  assert.ok(!ids.includes('role-that-does-not-exist'), 'the invented id is gone');

  // Dropped rather than hidden, and named — a rejection you cannot see is a
  // suggestion the app decided about on your behalf.
  const invented = body.review.dropped.find((item) => item.term === 'role-that-does-not-exist');
  assert.ok(invented, 'the invented id is reported');
  assert.match(invented.reason, /no record with that id/);

  // The other one is a real record the generated CV already cites, so it is
  // dropped too — as noise, for a different and correct reason.
  const real = body.review.dropped.find((item) => item.term === offeredIds[0]);
  if (real) assert.match(real.reason, /already cites it/);
});

test('a review is stored, and marked stale once the draft moves on', async (t) => {
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      if (task === 'generate-cv') return reply(cvArtifact());
      return reply(reviewReply());
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  await app.call('POST', `/api/jobs/${id}/docs/cv/review`);

  const fresh = await app.call('GET', `/api/jobs/${id}/docs/cv/review`);
  assert.equal(fresh.body.stale, false);
  assert.equal(fresh.body.review.verdict, 'maybe');

  // Saving a new version must not leave the old verdict looking current.
  await app.call('PUT', `/api/jobs/${id}/docs/cv`, { markdown: '# Different now' });
  const after = await app.call('GET', `/api/jobs/${id}/docs/cv/review`);
  assert.equal(after.body.stale, true, 'a verdict about an older draft is stale, not current');
  assert.ok(after.body.review, 'but it is still shown, since knowing it was about v1 is useful');
});

test('with no review yet the route says so rather than 404ing', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  const none = await app.call('GET', `/api/jobs/${id}/docs/cv/review`);
  assert.equal(none.status, 200);
  assert.equal(none.body.review, null);
  assert.equal(none.body.stale, false);
});

test('the review is logged with its verdict and what it cost', async (t) => {
  const app = await startApp({
    llmComplete: async ({ task }) => {
      if (task === 'parse-jd') return reply(JD_JSON);
      if (task === 'generate-cv') return reply(cvArtifact());
      return reply(reviewReply({ verdict: 'pass' }));
    },
  });
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  await app.call('POST', `/api/jobs/${id}/docs/cv/review`);

  const events = fs
    .readFileSync(path.join(app.dataDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === 'reviewed');
  assert.equal(events.length, 1);
  assert.equal(events[0].verdict, 'pass');
  assert.equal(events[0].kind, 'cv');
});

// --- every GET route answers something ------------------------------------------
//
// Why this exists: `/api/profile/records` shipped returning a 500 for days. The
// route called surnameFrom(), an import that had been removed during a refactor
// while the call site stayed. The whole Profile screen was dead, and 831 tests
// passed — because no test had ever asked that route for anything.
//
// So this walks every GET the app declares and fails on a 500. It asserts almost
// nothing about the bodies; other tests do that. Its whole job is that no route
// can be dead while the suite is green.

test('no GET route answers with a server error', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  // Real ids, so the routes that take parameters get something to work with.
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');
  // /api/profiles answers with a bare array, not an object with a key.
  const listed = (await app.call('GET', '/api/profiles')).body;
  const profileId = (Array.isArray(listed) ? listed[0]?.id : null) ?? 'research';

  const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
  const declared = [...source.matchAll(/app\.get\(\s*\n?\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(declared.length >= 20, `expected to find the GET routes, found ${declared.length}`);

  const filled = (route) =>
    route
      .replace(':jobId', id)
      .replace(':id', route.startsWith('/api/profiles/') ? profileId : id)
      .replace(':kind', 'cv')
      .replace(':v', '1');

  const failures = [];
  for (const route of declared) {
    const url = filled(route);
    const res = await app.call('GET', url);
    // 4xx is a fine answer. So is 501, which the PDF route returns on purpose when
    // no LaTeX engine is installed — the app genuinely cannot do it, and it says
    // so with the install command. Anything else in the 500s means the route
    // threw, which is what this test is for.
    if (res.status >= 500 && res.status !== 501) {
      failures.push(`${route} -> ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    }
  }

  assert.deepEqual(failures, [], `these routes threw:\n${failures.join('\n')}`);
});

test('the PDF route explains itself rather than throwing when LaTeX is absent', async (t) => {
  // The one 5xx the sweep above allows, so it is pinned here rather than being a
  // hole somebody could widen later.
  const app = await startApp();
  t.after(() => app.stop());
  const id = await jobReadyFor(app);
  await generateAndWait(app, id, 'cv');

  const res = await app.call('GET', `/api/jobs/${id}/docs/cv/pdf`);
  if (res.status === 200) return; // a machine with LaTeX installed; nothing to check
  assert.equal(res.status, 501, 'not implemented here, rather than a crash');
  assert.match(res.body.error, /No LaTeX engine found/);
  assert.match(res.body.error, /install/i, 'and it says how to fix it');
});

test('the records route renders publication citations, which is what it is for', async (t) => {
  // The specific thing that was broken: it needs the surname to work out first
  // authorship, and it was reaching for a function that no longer existed.
  const app = await startApp();
  t.after(() => app.stop());

  const res = await app.call('GET', '/api/profile/records');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.records) && res.body.records.length > 0);

  const publications = res.body.records.filter((record) => record.kind === 'publication');
  assert.ok(publications.length > 0, 'the example profile has publications to render');
  for (const publication of publications) {
    assert.ok(publication.citation, `${publication.id} has no citation`);
    assert.equal(typeof publication.citation.apa, 'string');
  }
});

test('a refused profile save says which lines are wrong, not just that it failed', async (t) => {
  // Both the error middleware and client/api.js used to drop `problems`, so a
  // refused save said "this would not parse" and nothing else. True, and useless:
  // the list of bad lines is the entire reason to refuse instead of saving.
  const app = await startApp();
  t.after(() => app.stop());

  const broken = '# Profile\n\n## Education\n\n### A record with no id\n\nSome body text.\n';
  const res = await app.call('PUT', '/api/profile/raw', { text: broken });

  assert.equal(res.status, 400);
  assert.ok(Array.isArray(res.body.problems), 'the problems reach the client');
  assert.ok(res.body.problems.length > 0);
  for (const problem of res.body.problems) {
    assert.match(problem, /^line \d+:/, `"${problem}" must name a line, so the UI can jump to it`);
  }

  // And nothing was written.
  const onDisk = await app.call('GET', '/api/profile/raw');
  assert.doesNotMatch(onDisk.body.text, /A record with no id/);
});

test('force saves a file that does not parse, and says the app keeps the last good one', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const before = (await app.call('GET', '/api/profile/raw')).body.text;

  const broken = '# Profile\n\n## Education\n\n### A record with no id\n\nSome body text.\n';
  const forced = await app.call('PUT', '/api/profile/raw', { text: broken, force: true });
  assert.equal(forced.status, 200);

  const onDisk = await app.call('GET', '/api/profile/raw');
  assert.match(onDisk.body.text, /A record with no id/, 'the file on disk is what was typed');
  assert.notEqual(onDisk.body.text, before);

  // The app carries on with the last version that parsed, so a half-finished
  // edit does not take generation down with it.
  const meta = await app.call('GET', '/api/meta');
  assert.ok(meta.body.evidenceCount > 0, 'still working from the last good parse');
});
