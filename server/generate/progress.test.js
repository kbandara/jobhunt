// Why these tests exist: this module's only job is to be honest about where a
// generation got to. The failure modes that matter are all quiet ones — a run
// that reports a step it never reached, a finished run that keeps claiming to
// be running, or a map that grows forever because nothing ever deletes.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS,
  KEEP_FINISHED_MS,
  runKey,
  startRun,
  reportStep,
  finishRun,
  readRun,
  resetRuns,
} from './progress.js';

beforeEach(resetRuns);

/** A clock we control, so no test ever depends on how fast the machine is. */
function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
}

test('an unknown key reports nothing rather than an empty run', () => {
  assert.equal(readRun('nobody:cv'), null);
});

test('a run reports the step it has reached, and counts it as running', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('selecting');
  const run = readRun('j1:cv', c);
  assert.equal(run.running, true);
  assert.equal(run.step, 'selecting');
  assert.equal(run.label, STEPS[0].label);
  assert.equal(run.stepIndex, 0);
  assert.equal(run.stepCount, STEPS.length);
});

test('steps accumulate in the order they happened', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('selecting');
  report('briefing');
  report('writing');
  assert.deepEqual(readRun('j1:cv', c).done, ['selecting', 'briefing']);
  assert.equal(readRun('j1:cv', c).step, 'writing');
});

test('a mistyped step is ignored, never thrown — it must not fail a generation', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('selecting');
  assert.doesNotThrow(() => report('summonining-a-daemon'));
  assert.equal(readRun('j1:cv', c).step, 'selecting');
});

test('elapsed time comes from the clock, per run and per step', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('selecting');
  c.tick(500);
  report('writing');
  c.tick(2_000);
  const run = readRun('j1:cv', c);
  assert.equal(run.elapsedMs, 2_500);
  assert.equal(run.stepElapsedMs, 2_000);
});

test('a finished run stops claiming to be running and keeps its last step', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('writing');
  finishRun('j1:cv', { ...c });
  const run = readRun('j1:cv', c);
  assert.equal(run.running, false);
  assert.equal(run.outcome, 'ok');
  assert.ok(run.done.includes('writing'), 'the step it was on counts as done');
});

test('a failed run keeps the message, so a late poll still explains itself', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('writing');
  finishRun('j1:cv', { outcome: 'failed', error: 'the model stopped early', ...c });
  const run = readRun('j1:cv', c);
  assert.equal(run.running, false);
  assert.equal(run.outcome, 'failed');
  assert.equal(run.error, 'the model stopped early');
  assert.equal(run.step, 'writing', 'a failure says WHERE it failed');
});

test('reporting a step after the run finished changes nothing', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('writing');
  finishRun('j1:cv', { ...c });
  report('checking');
  const run = readRun('j1:cv', c);
  assert.equal(run.running, false, 'a late report must not revive a finished run');
  assert.deepEqual(run.done, ['writing'], 'and must not append a step that never ran');
});

test('a successful run ends on no step at all — nothing is still in progress', () => {
  const c = clock();
  startRun('j1:cv', c)('saving');
  finishRun('j1:cv', { ...c });
  const run = readRun('j1:cv', c);
  assert.equal(run.step, null);
  assert.equal(run.stepIndex, STEPS.length, 'which reads as "past the last step"');
});

test('a finished run is forgotten once it is stale — the map cannot grow forever', () => {
  const c = clock();
  startRun('j1:cv', c);
  finishRun('j1:cv', { ...c });
  c.tick(KEEP_FINISHED_MS - 1);
  assert.ok(readRun('j1:cv', c), 'still readable just before the cutoff');
  c.tick(2);
  assert.equal(readRun('j1:cv', c), null);
  assert.equal(readRun('j1:cv', c), null, 'and stays gone');
});

test('a running run is never dropped, however long it takes', () => {
  const c = clock();
  const report = startRun('j1:cv', c);
  report('writing');
  c.tick(KEEP_FINISHED_MS * 10);
  assert.equal(readRun('j1:cv', c).running, true);
});

test('a CV and a cover letter are tracked separately', () => {
  const c = clock();
  startRun(runKey('j1', 'cv'), c)('selecting');
  startRun(runKey('j1', 'cover-letter'), c)('writing');
  assert.equal(readRun(runKey('j1', 'cv'), c).step, 'selecting');
  assert.equal(readRun(runKey('j1', 'cover-letter'), c).step, 'writing');
});

test('starting again discards the previous run rather than appending to it', () => {
  const c = clock();
  startRun('j1:cv', c)('writing');
  finishRun('j1:cv', { outcome: 'failed', error: 'nope', ...c });
  startRun('j1:cv', c)('selecting');
  const run = readRun('j1:cv', c);
  assert.equal(run.running, true);
  assert.equal(run.outcome, null);
  assert.deepEqual(run.done, []);
});

test('reporting against a key that was never started does nothing', () => {
  assert.doesNotThrow(() => reportStep('ghost:cv', 'writing'));
  assert.equal(readRun('ghost:cv'), null);
});
