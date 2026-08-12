// WHY: the rail that draws what steps-model.js works out. It is the one thing on
// the job screen that says where you are, and it replaced four paragraph-length
// empty states that used to say it in prose — a step whose result is on its own
// face does not need a paragraph underneath explaining that it has not run.
import { html } from '../vendor/ui.js';
import { Read, Fit, Draft, Send, Check, Lock } from './icons.js';
import { jobSteps, nextAction } from './steps-model.js';

export { jobSteps, nextAction };

const ICON = { read: Read, fit: Fit, draft: Draft, send: Send };

/** What a step that has produced nothing yet says about itself, in three words. */
const PLACEHOLDER = { locked: 'after reading', now: 'do this next', open: 'when you want' };

/**
 * The rail. A row on a wide screen, a column on a narrow one — the same markup
 * either way, because a step is an icon, a label and a result whichever
 * direction the row runs.
 *
 * Steps are buttons, not links: they move the page to a panel that is already on
 * it. A locked one is really disabled, so it cannot be tabbed to and does not
 * need to explain itself — pressing it could only reveal an empty panel.
 */
export function StepRail({ steps, current, onGo }) {
  return html`
    <nav class="rail" aria-label="Where you are in this application">
      <ol class="rail-track">
        ${steps.map(
          (step) => html`
            <li key=${step.id} class=${`rail-step is-${step.state} ${current === step.id ? 'is-current' : ''}`}>
              <button
                class="rail-button"
                type="button"
                disabled=${step.state === 'locked'}
                aria-current=${current === step.id ? 'step' : null}
                onClick=${() => onGo?.(step.id)}
              >
                <span class="rail-mark">
                  ${step.state === 'done'
                    ? html`<${Check} />`
                    : step.state === 'locked'
                      ? html`<${Lock} />`
                      : html`<${ICON[step.id]} />`}
                </span>
                <span class="rail-text">
                  <span class="rail-label">${step.label}</span>
                  <span class="rail-summary">${step.summary ?? PLACEHOLDER[step.state]}</span>
                </span>
              </button>
            </li>
          `,
        )}
      </ol>
    </nav>
  `;
}

export default StepRail;
