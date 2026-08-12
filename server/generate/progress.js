// WHY: generating a CV is one long model call wrapped in several short code
// steps, and from the browser it looks like a button that does nothing for
// forty seconds. This is the smallest honest way to say what is happening: the
// generator reports the step it has actually reached, and the screen shows that.
//
// Deliberately NOT a percentage. The writing step is 90% of the wall clock and
// its length is unknowable in advance, so any bar would be a lie that speeds up
// and stalls. Steps are things that really happened, in the order they happened.
//
// State lives in memory on purpose. It is worth nothing after a restart — a run
// that was interrupted is not resumable — and writing it to disk would put a
// file write in the middle of every step it is trying to time.

/** The steps a generation goes through, in order, with what to say about each. */
export const STEPS = [
  { id: 'selecting', label: 'Choosing which of your records fit' },
  { id: 'briefing', label: 'Briefing the model' },
  { id: 'writing', label: 'Writing the draft' },
  { id: 'checking', label: 'Checking every number and citation' },
  { id: 'saving', label: 'Saving' },
];

const STEP_IDS = STEPS.map((step) => step.id);

/**
 * How long a finished run stays readable. Long enough for the client's next
 * poll to see how it ended, short enough that it cannot be mistaken for a run
 * happening now. "Fleeting" is the requirement; this is the number behind it.
 */
export const KEEP_FINISHED_MS = 30_000;

/**
 * One registry per app, not one per process.
 *
 * It was a module-level Map, which is the same thing while one server runs — but
 * it made "what is in flight" a global, and two apps in one process (which is
 * every test file) could see each other's runs. State an app owns belongs to the
 * app; `createRuns()` is what createApp holds.
 */
export function createRuns() {
  const runs = new Map();
  return {
    start: (key, options) => startRun(key, options, runs),
    report: (key, step, detail, options) => reportStep(key, step, detail, options, runs),
    finish: (key, options) => finishRun(key, options, runs),
    read: (key, options) => readRun(key, options, runs),
    isRunning: (key, options) => isRunning(key, options, runs),
    list: (options) => listRuns(options, runs),
    reset: () => runs.clear(),
  };
}

/** The process-wide registry, for callers that have not been given one. */
const runs = new Map();

/** One key per document, so a CV and a cover letter can generate independently. */
export function runKey(jobId, kind) {
  return `${jobId}:${kind}`;
}

/**
 * Begin a run, discarding any previous one under the same key.
 * @returns {(step: string, detail?: string) => void} the reporter to pass along
 */
export function startRun(key, { now = Date.now } = {}, store = runs) {
  store.set(key, {
    startedAt: now(),
    finishedAt: null,
    step: null,
    stepStartedAt: null,
    detail: null,
    done: [],
    outcome: null,
    error: null,
  });
  return (step, detail) => reportStep(key, step, detail, { now }, store);
}

/**
 * Record that a run has reached a step. Unknown step ids are ignored rather
 * than thrown: a mistyped step name must never be able to fail a generation
 * that is otherwise working.
 */
export function reportStep(key, step, detail = null, { now = Date.now } = {}, store = runs) {
  const run = store.get(key);
  if (!run || run.finishedAt !== null) return;
  if (!STEP_IDS.includes(step)) return;

  if (run.step && run.step !== step && !run.done.includes(run.step)) run.done.push(run.step);
  run.step = step;
  run.stepStartedAt = now();
  run.detail = detail;
}

/**
 * End a run. `outcome` is 'ok' or 'failed'; on failure `error` is the message
 * already shown to you elsewhere, repeated here so a poll that lands after the
 * request has returned still explains itself rather than going blank.
 */
export function finishRun(key, { outcome = 'ok', error = null, now = Date.now } = {}, store = runs) {
  const run = store.get(key);
  if (!run) return;
  if (run.step && !run.done.includes(run.step)) run.done.push(run.step);
  run.finishedAt = now();
  run.outcome = outcome;
  run.error = error;
  if (outcome === 'ok') run.step = null;
}

/**
 * What the client should draw, or null when there is nothing to say. Also the
 * point where expired runs are dropped — there is no timer anywhere in this
 * module, because a timer that outlives a request is a leak waiting to happen.
 */
export function readRun(key, { now = Date.now } = {}, store = runs) {
  const run = store.get(key);
  if (!run) return null;

  const at = now();
  if (run.finishedAt !== null && at - run.finishedAt > KEEP_FINISHED_MS) {
    store.delete(key);
    return null;
  }

  return {
    running: run.finishedAt === null,
    outcome: run.outcome,
    error: run.error,
    step: run.step,
    label: STEPS.find((s) => s.id === run.step)?.label ?? null,
    detail: run.detail,
    done: [...run.done],
    stepIndex: run.step ? STEP_IDS.indexOf(run.step) : STEPS.length,
    stepCount: STEPS.length,
    elapsedMs: (run.finishedAt ?? at) - run.startedAt,
    stepElapsedMs: run.stepStartedAt === null ? 0 : at - run.stepStartedAt,
  };
}

/**
 * Is something already writing this document?
 *
 * Asked before a run is started. Two generations of the same document racing
 * would both save, and the loser's version would sit in the history looking
 * like a draft you asked for.
 */
export function isRunning(key, options, store = runs) {
  return readRun(key, options, store)?.running === true;
}

/**
 * Every run the server currently knows about, keyed as `jobId:kind`.
 *
 * This is what makes working on several applications at once possible to SEE.
 * A generation now continues after you navigate away — the request returns as
 * soon as the work is started — so without a list of what is in flight the only
 * evidence that anything is happening would be the screen you just left.
 */
export function listRuns(options, store = runs) {
  const out = {};
  for (const key of [...store.keys()]) {
    const run = readRun(key, options, store); // also expires the stale ones
    if (run) out[key] = run;
  }
  return out;
}

/** Test seam: forget everything. Never called by the app. */
export function resetRuns() {
  runs.clear();
}
