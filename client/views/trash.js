// WHY: Delete used to be permanent, behind a two-click confirmation. That was
// the wrong shape for the risk. Confirmations get clicked — they are a speed bump,
// not a safety net — and the thing on the other side was a day of writing, in an
// app whose whole purpose is not losing your work.
//
// So Delete moves an application here, and this screen is where it can come back.
// Permanent deletion still exists and still needs confirming, but it lives here,
// on a page you had to go to on purpose, rather than one click away from a draft.
import { html, useState, useEffect } from '../vendor/ui.js';
import { api } from '../api.js';
import { Notice, ErrorBanner } from './notice.js';
import { Bin, Restore, Working, ArrowLeft } from './icons.js';

/** "3 days ago" — a bin is read for how long ago, not for the exact minute. */
function ago(iso) {
  const then = Date.parse(iso ?? '');
  if (!Number.isFinite(then)) return 'at some point';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function Trash({ onChanged }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [emptying, setEmptying] = useState(false);
  const [message, setMessage] = useState(null);

  const load = () =>
    api
      .trash()
      .then((data) => setState(data.trash))
      .catch(setError);

  useEffect(() => {
    load();
  }, []);

  const act = async (id, what) => {
    setBusy(id);
    setError(null);
    setMessage(null);
    try {
      if (what === 'restore') {
        const { job } = await api.restoreJob(id);
        const where = job?.parsed?.company ? ` — ${job.parsed.company}` : '';
        setMessage(`Put back on the board${where}.`);
      } else {
        await api.purgeJob(id);
        setMessage('Deleted for good.');
      }
      await load();
      onChanged?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const empty = async () => {
    setBusy('all');
    setError(null);
    try {
      // The count is the confirmation, so a page left open while something else
      // was binned cannot empty more than it was showing.
      await api.emptyTrash(state.length);
      setMessage('The bin is empty.');
      setEmptying(false);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err);
      setEmptying(false);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (error && state === null) return html`<${ErrorBanner} error=${error} />`;
  if (state === null) {
    return html`<p class="muted"><${Working} /> Opening the bin…</p>`;
  }

  return html`
    <div class="trash-page">
      <a class="backlink" href="#/board"><${ArrowLeft} size="1em" /> Board</a>
      <h1>The bin</h1>

      ${state.length === 0
        ? html`
            <p class="muted">
              Nothing in here. Applications you delete are kept in this bin, so a
              delete you did not mean can always be undone.
            </p>
          `
        : html`
            <p class="muted">
              These are off the board but nothing has been thrown away. Restore
              puts an application back where it was, with every draft and version
              it had.
            </p>

            ${message ? html`<${Notice} kind="info">${message}<//>` : null}
            <${ErrorBanner} error=${error} />

            <ul class="trash-list">
              ${state.map(
                (job) => html`
                  <li key=${job.id} class="trash-row glass">
                    <div class="trash-what">
                      <strong>${job.parsed?.company || 'Untitled application'}</strong>
                      <span class="muted">${job.parsed?.role_title || 'never read'}</span>
                      <span class="trash-meta">
                        deleted ${ago(job.deletedAt)}
                        ${job.files > 0
                          ? html` · <span class="num">${job.files}</span> file${job.files === 1 ? '' : 's'} kept`
                          : ' · nothing was written for it'}
                        ${job.status ? html` · was in ${job.status}` : null}
                      </span>
                    </div>
                    <div class="trash-actions">
                      <button
                        type="button"
                        class="button primary"
                        disabled=${busy !== null}
                        onClick=${() => act(job.id, 'restore')}
                      >
                        ${busy === job.id ? html`<${Working} />` : html`<${Restore} size="1em" />`}
                        Restore
                      </button>
                      <${PurgeOne} job=${job} busy=${busy} onPurge=${() => act(job.id, 'purge')} />
                    </div>
                  </li>
                `,
              )}
            </ul>

            <div class="trash-foot">
              ${emptying
                ? html`
                    <div class="delete-job armed">
                      <span class="delete-what">
                        Delete all <span class="num">${state.length}</span> permanently? This one
                        cannot be undone.
                      </span>
                      <button type="button" class="button danger" disabled=${busy !== null} onClick=${empty}>
                        ${busy === 'all' ? html`<${Working} />` : null} Yes, delete them
                      </button>
                      <button type="button" class="link-button" onClick=${() => setEmptying(false)}>
                        Keep them
                      </button>
                    </div>
                  `
                : html`
                    <button type="button" class="link-button danger" onClick=${() => setEmptying(true)}>
                      <${Bin} size="1em" /> Empty the bin
                    </button>
                  `}
            </div>
          `}
    </div>
  `;
}

/**
 * Permanent deletion of one application, armed before it fires.
 *
 * Still two steps even here. This is the one action in the app that destroys
 * something, and the bin is exactly where somebody is clicking quickly.
 */
function PurgeOne({ job, busy, onPurge }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    // Disarms itself, so a confirmation left on screen does not get clicked a
    // minute later by somebody who has forgotten what it was for.
    const timer = setTimeout(() => setArmed(false), 8000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return html`
      <button type="button" class="link-button danger" disabled=${busy !== null} onClick=${() => setArmed(true)}>
        Delete for good
      </button>
    `;
  }

  return html`
    <span class="delete-job armed">
      <span class="delete-what">Permanently?</span>
      <button type="button" class="button danger" disabled=${busy !== null} onClick=${onPurge}>
        ${busy === job.id ? html`<${Working} />` : null} Delete
      </button>
      <button type="button" class="link-button" onClick=${() => setArmed(false)}>Cancel</button>
    </span>
  `;
}

export default Trash;
