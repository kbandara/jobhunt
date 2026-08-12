// WHY: the model's fit score is advice, not policy. A hard filter you cannot pass
// (citizenship, a degree you lacks, a years floor) makes a 72 meaningless, so any
// `blocking` unmet item pulls the score down to the skip band. The cap is never
// silent (D008): both numbers and the reason are stored and shown, because a
// tool that quietly rewrites its own output is one you stop trusting.

/** Tunable here and nowhere else. On the 0–100 scale the app stores and shows. */
export const CAP_SCORE = 29;

/** Verdict bands, read off the CAPPED score. */
export const VERDICT_BANDS = [
  { min: 75, verdict: 'strong' },
  { min: 50, verdict: 'viable' },
  { min: 30, verdict: 'stretch' },
  { min: 0, verdict: 'skip' },
];

/**
 * THE MODEL IS ASKED FOR 0–20, AND THE APP MULTIPLIES BY FIVE.
 *
 * Asked for a number out of 100 a model has a hundred choices, most of which
 * mean nothing to it, and it drifts downward — grading against an imagined
 * perfect applicant and landing everything in the forties. Out of 20 there are
 * twenty-one choices, each of which has to be argued for, and the judgement
 * comes out closer to what a person would say. The scale is the fix; the anchors
 * in the prompt are the other half of it.
 *
 * Multiplying by five rather than storing out of 20 keeps one number in one
 * scale everywhere else: the cap, the verdict bands, every score already on
 * disk, and the screen. Nothing downstream had to learn about this.
 */
export const MODEL_SCALE_MAX = 20;
export const SCALE_FACTOR = 5;

/**
 * The model's number, on the 0–100 scale the rest of the app uses.
 *
 * @param {number} value what the model answered, expected to be 0–20
 * @returns {number} 0–100
 */
export function fromModelScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;

  // A model that ignored the instruction and answered out of 100 anyway must not
  // have its 85 turned into a 100 — that would inflate every score to the top of
  // the range and the cap would be the only thing left doing any work. Anything
  // above the 0–20 ceiling is read as already being out of 100.
  if (number > MODEL_SCALE_MAX) return Math.min(100, Math.round(number));

  return Math.round(number) * SCALE_FACTOR;
}

export function verdictFor(score) {
  return VERDICT_BANDS.find((band) => score >= band.min)?.verdict ?? 'skip';
}

/**
 * @param {object} scoreResult score-deep output: { score, unmet: [{requirement, severity, note}] }
 *   `score` is the model's 0–20 answer; everything returned is 0–100.
 * @returns {{modelScore: number, cappedScore: number, capReason: string|null, verdict: string}}
 *   capReason is non-null whenever a blocking item exists — it names them, so the
 *   UI can always render "model said X → capped to Y because Z".
 */
export function applyCap(scoreResult = {}) {
  const modelScore = fromModelScale(scoreResult?.score ?? scoreResult?.modelScore);

  const unmet = Array.isArray(scoreResult?.unmet) ? scoreResult.unmet : [];
  const blockers = unmet.filter((item) => item?.severity === 'blocking');

  if (blockers.length === 0) {
    return { modelScore, cappedScore: modelScore, capReason: null, verdict: verdictFor(modelScore) };
  }

  // A blocking item with no wording still caps — the severity is the fact that
  // matters, and losing the cap because a label came back empty would be silent.
  const named = blockers
    .map((item) => String(item?.requirement ?? '').trim())
    .filter((text) => text !== '');
  const cappedScore = Math.min(modelScore, CAP_SCORE);

  return {
    modelScore,
    cappedScore,
    capReason: named.length > 0 ? named.join('; ') : 'a blocking requirement the model did not name',
    verdict: verdictFor(cappedScore),
  };
}

export default applyCap;
