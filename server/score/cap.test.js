// WHY: the cap is the one place policy overrides the model, so every band edge
// and the cap itself are pinned here. If someone tunes CAP_SCORE, these tests say
// out loud what else moves with it.
//
// THE MODEL ANSWERS OUT OF 20. applyCap multiplies by five, so every `score:`
// below is a 0-20 value and everything asserted is 0-100. That indirection is
// worth the confusion it costs: asked for a number out of a hundred, a model
// drifts into the low forties for everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCap, verdictFor, fromModelScale, CAP_SCORE, MODEL_SCALE_MAX, SCALE_FACTOR, VERDICT_BANDS } from './cap.js';

const unmet = (severity, requirement) => ({ requirement, severity });

// --- the scale ---------------------------------------------------------------

test('the model scale is multiplied by five, end to end', () => {
  assert.equal(fromModelScale(20), 100);
  assert.equal(fromModelScale(16), 80);
  assert.equal(fromModelScale(10), 50);
  assert.equal(fromModelScale(1), 5);
  assert.equal(fromModelScale(0), 0);
});

test('a model that answers out of 100 anyway is not inflated to the top', () => {
  // The failure this prevents: 85 read as 85/20, clamped to 20, multiplied to
  // 100. Every score would land at the ceiling and the cap would be the only
  // thing still doing any work.
  assert.equal(fromModelScale(85), 85, 'read as already out of 100');
  assert.equal(fromModelScale(42), 42);
  assert.equal(fromModelScale(21), 21, 'one past the ceiling is already a 0-100 answer');
  assert.equal(fromModelScale(MODEL_SCALE_MAX), 100, 'but the ceiling itself is still out of 20');
});

test('junk is not trusted, on either scale', () => {
  assert.equal(fromModelScale(999), 100, 'clamped');
  assert.equal(fromModelScale(-4), 0);
  assert.equal(fromModelScale(null), 0);
  assert.equal(fromModelScale(undefined), 0);
  assert.equal(fromModelScale('nonsense'), 0);
  assert.equal(fromModelScale(12.4), 60, 'rounded, then scaled');
});

// --- the bands and the cap ---------------------------------------------------

test('verdict bands are read off the 0-100 score', () => {
  assert.equal(verdictFor(100), 'strong');
  assert.equal(verdictFor(75), 'strong');
  assert.equal(verdictFor(74), 'viable');
  assert.equal(verdictFor(50), 'viable');
  assert.equal(verdictFor(49), 'stretch');
  assert.equal(verdictFor(30), 'stretch');
  assert.equal(verdictFor(29), 'skip');
  assert.equal(verdictFor(0), 'skip');
});

test('no blocking item: the score passes through untouched, capReason null', () => {
  const result = applyCap({
    score: 16,
    unmet: [unmet('significant', 'no production Kubernetes'), unmet('minor', 'no Scala')],
  });
  assert.deepEqual(result, {
    modelScore: 80,
    cappedScore: 80,
    capReason: null,
    verdict: 'strong',
  });
});

test('every band is reachable from a 0-20 answer', () => {
  assert.equal(applyCap({ score: 18, unmet: [] }).verdict, 'strong', '18 -> 90');
  assert.equal(applyCap({ score: 12, unmet: [] }).verdict, 'viable', '12 -> 60');
  assert.equal(applyCap({ score: 7, unmet: [] }).verdict, 'stretch', '7 -> 35');
  assert.equal(applyCap({ score: 2, unmet: [] }).verdict, 'skip', '2 -> 10');
});

test('each band named in the prompt lands in the verdict it promises', () => {
  // The prompt tells the model that 15-20, 10-14, 6-9 and 0-5 mean four specific
  // things. Those boundaries are VERDICT_BANDS divided by five, and this is what
  // keeps the two from drifting apart — an earlier version of the prompt had five
  // bands against four verdicts, so a 4 described as "a stretch" was scored skip.
  for (const score of [15, 17, 20]) assert.equal(applyCap({ score, unmet: [] }).verdict, 'strong', String(score));
  for (const score of [10, 12, 14]) assert.equal(applyCap({ score, unmet: [] }).verdict, 'viable', String(score));
  for (const score of [6, 8, 9]) assert.equal(applyCap({ score, unmet: [] }).verdict, 'stretch', String(score));
  for (const score of [0, 3, 5]) assert.equal(applyCap({ score, unmet: [] }).verdict, 'skip', String(score));
});

test('the prompt bands are derived from VERDICT_BANDS, not written twice', () => {
  // If somebody tunes a verdict threshold, the prompt in server/index.js has to
  // move with it. This fails when they diverge, naming the number to change.
  const boundaries = VERDICT_BANDS.map((band) => band.min / SCALE_FACTOR);
  assert.deepEqual(boundaries, [15, 10, 6, 0], 'the prompt says 15-20, 10-14, 6-9 and 0-5');
  for (const boundary of boundaries) {
    assert.ok(Number.isInteger(boundary), `${boundary} must be a whole number on a 0-20 scale`);
  }
});

test('one blocking item drops a strong score to the skip band and says why', () => {
  const result = applyCap({
    score: 14,
    unmet: [unmet('blocking', 'requires US citizenship'), unmet('minor', 'no Rust')],
  });
  assert.equal(result.modelScore, 70);
  assert.equal(result.cappedScore, CAP_SCORE);
  assert.equal(result.cappedScore, 29);
  assert.equal(result.capReason, 'requires US citizenship');
  assert.equal(result.verdict, 'skip');
});

test('multiple blocking items are all named in the reason', () => {
  const result = applyCap({
    score: 19,
    unmet: [
      unmet('blocking', 'requires an awarded PhD'),
      unmet('significant', 'no NLP publications'),
      unmet('blocking', 'requires 10 years post-qualification experience'),
    ],
  });
  assert.equal(result.cappedScore, 29);
  assert.equal(
    result.capReason,
    'requires an awarded PhD; requires 10 years post-qualification experience',
  );
  assert.equal(result.verdict, 'skip');
});

test('a score already below the cap is not raised to it', () => {
  const result = applyCap({ score: 2, unmet: [unmet('blocking', 'requires TS/SCI clearance')] });
  assert.equal(result.modelScore, 10, '2 out of 20');
  assert.equal(result.cappedScore, 10, 'below the cap already, so the cap does not touch it');
  assert.equal(result.capReason, 'requires TS/SCI clearance');
  assert.equal(result.verdict, 'skip');
});

test('a blocking item with no wording still caps, and says so', () => {
  const result = applyCap({ score: 18, unmet: [{ severity: 'blocking' }] });
  assert.equal(result.cappedScore, 29);
  assert.match(result.capReason, /did not name/);
});

test('applyCap survives a reply with no score at all', () => {
  assert.equal(applyCap({}).modelScore, 0);
  assert.equal(applyCap().verdict, 'skip');
  assert.equal(applyCap({ unmet: [] }).cappedScore, 0);
});

// --- overqualification ------------------------------------------------------
//
// Why these are here: overqualification is a fit signal worth having, and the
// tempting shortcut is to route it through the same cap as a blocking
// requirement. That would be wrong. A hard filter genuinely ends an
// application; being too senior is a judgement a recruiter might make and you
// might reasonably ignore. Folding them together would let a debatable opinion
// silently push a score into the skip band with "blocking" as the stated
// reason, which is exactly the quiet rewriting D008 exists to prevent.

test('being overqualified never caps the score', () => {
  const result = applyCap({
    score: 16,
    unmet: [{ requirement: 'Five years in industry', severity: 'significant' }],
    overqualification: { level: 'clearly', note: 'the work is well below this level' },
  });
  assert.equal(result.cappedScore, 80);
  assert.equal(result.capReason, null);
  assert.equal(result.verdict, 'strong');
});

test('a real blocking item still caps, alongside an overqualification signal', () => {
  const result = applyCap({
    score: 16,
    unmet: [{ requirement: 'US citizenship', severity: 'blocking' }],
    overqualification: { level: 'clearly' },
  });
  assert.equal(result.cappedScore, CAP_SCORE);
  assert.match(result.capReason, /US citizenship/, 'the cap names the filter, not the seniority');
});

test('applyCap ignores the signal entirely — it is carried, not consumed', () => {
  const withSignal = applyCap({ score: 12, unmet: [], overqualification: { level: 'clearly' } });
  const without = applyCap({ score: 12, unmet: [] });
  assert.deepEqual(withSignal, without);
});
