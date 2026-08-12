// WHY: there were five hand-written banner shapes across three files — the
// server one, the profile one, the key one, the FILL-ME one and the error one —
// and they had drifted. Some had a bold first sentence, some did not; the
// action inside one was a link and inside another a button; and severity was
// carried only by a background tint, which is the one channel a person with a
// colour vision deficiency does not get.
//
// One component now, with a drawn icon that names the severity independently of
// the tint, and a live region so a warning that appears while you are looking
// somewhere else is actually announced. That last part was the real bug: the
// "server is not answering" notice was reaching nobody using a screen reader.
import { html } from '../vendor/ui.js';
import { Alert, Stop, Info } from './icons.js';

const MARK = { warning: Alert, error: Stop, info: Info };

/**
 * @param {object} props
 * @param {'info'|'warning'|'error'} [props.kind]
 * @param {boolean} [props.live] announce it when it appears. True for anything
 *   that shows up in response to something going wrong rather than sitting on
 *   the page from the start.
 */
export function Notice({ kind = 'info', live = true, children }) {
  const Mark = MARK[kind] ?? Info;
  return html`
    <div
      class=${`notice ${kind}`}
      role=${live ? (kind === 'error' ? 'alert' : 'status') : null}
    >
      <span class="notice-icon"><${Mark} size="1.1em" /></span>
      <div class="notice-body">${children}</div>
    </div>
  `;
}

/**
 * A failed request. The server always answers with a plain-language `error` and
 * often a `hint`; both are shown verbatim rather than reworded here, because the
 * server is the one that knows what went wrong.
 */
export function ErrorBanner({ error }) {
  if (!error) return null;
  return html`
    <${Notice} kind="error">
      <strong>${error.message}</strong>
      ${error.hint ? html`<div class="hint">${error.hint}</div>` : null}
    <//>
  `;
}

export default Notice;
