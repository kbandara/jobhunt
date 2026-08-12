// WHY: every wait in this app used to look different — "Writing…", "Scoring…",
// "Loading the board…" — and none of them told you how long they had been
// waiting. That last part is the one that matters: a spinner that has been going
// for forty seconds looks exactly like one that has been going for four, which
// is how a slow model call becomes indistinguishable from a hang. It happened
// once already, and the fix then was a timeout; this is the other half.
//
// Its own module rather than a component inside job.js, because add.js and
// board.js need it too and job.js already imports from add.js — putting it in
// either would make an import cycle.
import { html, useState, useEffect } from '../vendor/ui.js';
import { Working } from './icons.js';

/**
 * The terminal's thinking indicator: a mark that turns, a word, and a clock.
 *
 * The mark used to be the character ✳ with its `content` swapped on a keyframe.
 * That worked, but it inherited the font's idea of size and baseline, so it sat
 * differently in a button than in a sentence and changed size outright whenever
 * the face fell back. It is drawn now (icons.js), and still animated in CSS
 * (`.thinking-mark-spin`, style.css) rather than here — so it costs no renders,
 * never drifts out of step with one, and holds still under `prefers-reduced-motion`.
 *
 * @param {object} props
 * @param {string} [props.word] what is happening — a verb, capitalised
 * @param {number|null} [props.since] Date.now() when the wait began. Omit for
 *   waits too short to be worth timing; passing it starts the clock.
 * @param {boolean} [props.showTime] set false to keep the glyph and word but
 *   drop the counter — used where something else on screen already times it.
 */
export function Thinking({ word = 'Thinking', since = null, showTime = true }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (since === null || !showTime) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since, showTime]);

  const seconds = since === null ? null : Math.max(0, Math.round((now - since) / 1000));

  return html`
    <span class="thinking">
      <${Working} />
      ${word ? html`<span class="thinking-word">${word}</span>` : null}
      ${showTime && seconds !== null ? html`<span class="thinking-time num">${seconds}s</span>` : null}
    </span>
  `;
}

export default Thinking;
