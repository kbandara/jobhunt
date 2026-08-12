// Why these tests exist: the rail's whole value is that it is trustworthy about
// what is blocked. If it dims something reachable, you stop trying things that
// would have worked; if it offers something impossible, you pay for a click that
// only fails. Both failures are silent, so they get tests rather than a look.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jobSteps, nextAction } from '../../client/views/steps-model.js';

/** A job in the shape /api/board and /api/jobs/:id both return. */
const job = (over = {}) => ({
  id: 'j_1',
  source: 'pasted',
  status: 'wishlist',
  parsed: null,
  fit: null,
  docs: {},
  ...over,
});

const parsed = (requirements = 3) => ({
  role_title: 'Research Coordinator',
  company: 'AXION',
  requirements: Array.from({ length: requirements }, (_, i) => ({ text: `r${i}`, must_have: true })),
});

const byId = (steps) => Object.fromEntries(steps.map((s) => [s.id, s]));

test('before the parse, reading is the only thing that can run', () => {
  const steps = byId(jobSteps(job()));
  assert.equal(steps.read.state, 'now');
  assert.equal(steps.fit.state, 'locked');
  assert.equal(steps.draft.state, 'locked');
  assert.equal(steps.send.state, 'locked');
});

test('exactly one step is the suggestion, at every stage', () => {
  const stages = [
    job(),
    job({ parsed: parsed() }),
    job({ parsed: parsed(), fit: { cappedScore: 70, verdict: 'viable' } }),
    job({ parsed: parsed(), fit: { cappedScore: 70, verdict: 'viable' }, docs: { cv: { version: 3 } } }),
  ];
  for (const [i, j] of stages.entries()) {
    const now = jobSteps(j).filter((s) => s.state === 'now');
    assert.equal(now.length, 1, `stage ${i} offered ${now.length} next steps, not 1`);
  }
});

test('a skipped score leaves the draft done, not blocked — generating before scoring is allowed', () => {
  const steps = byId(jobSteps(job({ parsed: parsed(), docs: { cv: { version: 2 } } })));
  assert.equal(steps.draft.state, 'done');
  assert.equal(steps.draft.summary, 'CV v2');
  // Still suggested, because it is still worth doing — but never called locked.
  assert.equal(steps.fit.state, 'now');
});

test('a step you have passed over is open, never locked', () => {
  // Read done, nothing else. Fit is the suggestion; draft and send are simply
  // not done — dimming them as unreachable would be a lie.
  const steps = byId(jobSteps(job({ parsed: parsed() })));
  assert.equal(steps.fit.state, 'now');
  assert.equal(steps.draft.state, 'open');
  assert.equal(steps.send.state, 'open');
});

test('a cold approach has no fit step at all', () => {
  const steps = jobSteps(job({ source: 'cold', parsed: parsed(0) }));
  assert.deepEqual(steps.map((s) => s.id), ['read', 'draft', 'send']);
  assert.equal(steps[0].summary, 'your notes, read');
});

test('a cold approach offers the email, not a cover letter', () => {
  const cold = byId(jobSteps(job({ source: 'cold', parsed: parsed(0), docs: { 'cold-email': { version: 1 } } })));
  assert.equal(cold.draft.summary, 'Email v1');
  // The same doc key on an advertised job is not one of its documents, so that
  // job still has nothing drafted. (Its suggestion is Fit, which comes first.)
  const ad = byId(jobSteps(job({ parsed: parsed(), docs: { 'cold-email': { version: 1 } } })));
  assert.notEqual(ad.draft.state, 'done');
  assert.equal(ad.draft.summary, null);
});

test('the summary counts requirements, and gets the singular right', () => {
  assert.equal(byId(jobSteps(job({ parsed: parsed(1) }))).read.summary, '1 requirement');
  assert.equal(byId(jobSteps(job({ parsed: parsed(8) }))).read.summary, '8 requirements');
});

test('a capped score says so — the cap is shown, never applied silently', () => {
  const capped = job({
    parsed: parsed(),
    fit: { cappedScore: 29, modelScore: 61, verdict: 'skip', capReason: 'a required degree the applicant lacks' },
  });
  assert.equal(byId(jobSteps(capped)).fit.summary, '29/100 · skip · capped');

  const plain = job({ parsed: parsed(), fit: { cappedScore: 70, verdict: 'viable', capReason: null } });
  assert.equal(byId(jobSteps(plain)).fit.summary, '70/100 · viable');
});

test('several documents are listed with their versions, newest count first', () => {
  const steps = byId(jobSteps(job({ parsed: parsed(), docs: { cv: { version: 17 }, 'cover-letter': { version: 1 } } })));
  assert.equal(steps.draft.summary, 'CV v17 · Letter v1');
});

test('a version of 0 is not a document', () => {
  const steps = byId(jobSteps(job({ parsed: parsed(), docs: { cv: { version: 0 } } })));
  assert.equal(steps.draft.state, 'open');
  assert.equal(steps.draft.summary, null);
});

test('sending is done once the card has left the wishlist', () => {
  for (const status of ['applied', 'interviewing', 'offer', 'rejected']) {
    const steps = byId(jobSteps(job({ parsed: parsed(), status })));
    assert.equal(steps.send.state, 'done', `${status} should count as sent`);
    assert.equal(steps.send.summary, status);
  }
  for (const status of ['wishlist', 'drafting']) {
    assert.notEqual(byId(jobSteps(job({ parsed: parsed(), status }))).send.state, 'done');
  }
});

test('nextAction names the one verb a board card has room for', () => {
  assert.equal(nextAction(job()).label, 'Read it');
  assert.equal(nextAction(job({ parsed: parsed() })).label, 'Score it');
  assert.equal(nextAction(job({ parsed: parsed(), fit: { cappedScore: 70, verdict: 'viable' } })).label, 'Write it');
  assert.equal(
    nextAction(job({ parsed: parsed(), fit: { cappedScore: 70, verdict: 'viable' }, docs: { cv: { version: 1 } } })).label,
    'Send it',
  );
});

test('a finished application asks for nothing', () => {
  const done = job({
    parsed: parsed(),
    status: 'applied',
    fit: { cappedScore: 70, verdict: 'viable' },
    docs: { cv: { version: 1 }, 'cover-letter': { version: 1 }, criteria: { version: 1 } },
  });
  assert.equal(nextAction(done), null);
  assert.ok(jobSteps(done).every((s) => s.state === 'done'));
});

test('a job record with nothing on it does not throw', () => {
  assert.equal(jobSteps({}).length, 4);
  assert.equal(jobSteps({})[0].state, 'now');
});
