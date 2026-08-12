// WHY a separate file: this is the only logic behind the step rail, and it needs
// to be testable in Node — which steps.js is not, because it imports the browser
// build of Preact (same split as flags-grouping.js). Nothing here touches the DOM.
//
// The problem it solves: applying for one job is nine actions across three
// screens — paste, read, pick a profile, score, generate, edit, check, export,
// move the card — and the app never said so. Every screen was complete on its
// own and none of them said where you were in the thing you were actually
// doing, so the way you learned the order was by pressing something and finding
// out it was too early.
//
// The one rule worth stating: this recommends an order, it does not enforce one.
// Only reading is a genuine prerequisite — nothing can be scored or written
// before there is a parse to work from. Everything after that is reachable
// whenever you want it, because generating before scoring is a legitimate thing
// to do and the app has never blocked it. So a step is `locked` only when it
// truly cannot run; a step you have skipped past is `open`, not blocked. Dimming a
// reachable control teaches people the app is stricter than it is, and they stop
// trying things that would have worked.

/** Which documents count as "you have a draft" depends on how the job started. */
const DRAFT_KINDS = { pasted: ['cv', 'cover-letter', 'criteria'], cold: ['cv', 'cold-email'] };

/** Short enough to sit in a rail summary next to a version number. */
const SHORT_KIND = { cv: 'CV', 'cover-letter': 'Letter', criteria: 'Answers', 'cold-email': 'Email' };

/** Statuses that mean the application has left your hands. */
export const SENT = ['applied', 'interviewing', 'offer', 'rejected'];

/**
 * The version number of each document that exists, in the shape both callers
 * have. The board and the job route return the same job record, and both read
 * this one field, so a card and a rail can never disagree about what exists.
 */
function draftsOf(job) {
  const kinds = DRAFT_KINDS[job.source === 'cold' ? 'cold' : 'pasted'];
  return kinds
    .map((kind) => ({ kind, version: job.docs?.[kind]?.version ?? 0 }))
    .filter((d) => d.version > 0);
}

/**
 * The steps for one job, each with what it produced.
 *
 * @param {object} job the job record, as the board and the job route both return it
 * @returns {Array<{id: string, label: string, state: 'done'|'now'|'open'|'locked', summary: string|null}>}
 */
export function jobSteps(job) {
  const cold = job?.source === 'cold';
  const parsed = Boolean(job?.parsed);
  const drafts = draftsOf(job ?? {});
  const sent = SENT.includes(job?.status);
  const requirements = (job?.parsed?.requirements ?? []).length;

  const steps = [
    {
      id: 'read',
      label: 'Read',
      done: parsed,
      summary: !parsed
        ? null
        : cold
          ? 'your notes, read'
          : `${requirements} requirement${requirements === 1 ? '' : 's'}`,
    },
  ];

  // No fit step on a cold approach, and this is not an omission: a score
  // computed against requirements the app invented from your own notes would be
  // fiction with a decimal point on it. The rail simply has three steps there.
  if (!cold) {
    steps.push({
      id: 'fit',
      label: 'Fit',
      done: Boolean(job?.fit),
      // Both numbers, never just the capped one — the cap is shown, never applied
      // silently (D008), and that has to survive being summarised.
      summary: job?.fit
        ? `${job.fit.cappedScore}/100 · ${job.fit.verdict}${job.fit.capReason ? ' · capped' : ''}`
        : null,
    });
  }

  steps.push(
    {
      id: 'draft',
      label: 'Draft',
      done: drafts.length > 0,
      summary:
        drafts.length === 0
          ? null
          : drafts.map((d) => `${SHORT_KIND[d.kind] ?? d.kind} v${d.version}`).join(' · '),
    },
    {
      id: 'send',
      label: 'Send',
      done: sent,
      summary: sent ? job.status : null,
    },
  );

  return steps.map((step, i) => ({ ...step, state: stateOf(step, i, steps, parsed) }));
}

/**
 * done   — it produced something, and the summary says what.
 * locked — it genuinely cannot run yet. Only true before the parse.
 * now    — the first thing not done. One per rail, or the rail stops being a
 *          recommendation and becomes a list.
 * open   — reachable, not done, not the suggestion. Skipping the score to go
 *          straight to a draft is allowed, so it must not look forbidden.
 */
function stateOf(step, index, steps, parsed) {
  if (step.done) return 'done';
  if (!parsed && step.id !== 'read') return 'locked';
  return index === steps.findIndex((s) => !s.done) ? 'now' : 'open';
}

const VERB = { read: 'Read it', fit: 'Score it', draft: 'Write it', send: 'Send it' };

/**
 * What to do with this job next, for a board card. A card has room for one verb,
 * so this is the single most useful one — derived from the same step list, so a
 * card can never suggest something the job screen calls locked.
 */
export function nextAction(job) {
  const now = jobSteps(job).find((s) => s.state === 'now');
  return now ? { id: now.id, label: VERB[now.id] } : null;
}
