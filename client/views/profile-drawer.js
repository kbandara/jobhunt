// WHY: the question you actually have while reading a draft is "what have I got
// that this leaves out?" — and until now answering it meant leaving the page for
// the Profile screen, or opening master-profile.md in a text editor. Both lose
// your place, and neither lets you look at the two side by side, which is the
// whole point of the comparison.
//
// So the profile gets a panel of its own, on the left, opposite the chat. Both
// can be open at once on purpose: the useful arrangement is your records on one
// side, the model on the other, and the draft between them.
//
// It is deliberately NOT an editor. Editing records has a screen already, with a
// form per kind and a validator behind it, and a second half-implemented editor
// that writes the same file is how the two drift apart. This reads, filters,
// and inserts a record's own words into the draft.
import { html, useState, useEffect, useMemo } from '../vendor/ui.js';
import { api } from '../api.js';
import { Thinking } from './thinking.js';
import { Portal } from './portal.js';
import { Close, Check, Plus } from './icons.js';

/** Kinds in the order a person thinks about them, not alphabetical. */
const KIND_ORDER = ['role', 'project', 'finding', 'publication', 'education', 'skill', 'award', 'service', 'other'];

const KIND_LABEL = {
  role: 'Roles',
  project: 'Projects',
  finding: 'Findings',
  publication: 'Publications',
  education: 'Education',
  skill: 'Skills',
  award: 'Awards',
  service: 'Service',
  other: 'Other',
};

/** What the draft is called, in the words you would use about it. */
const DOC_LABEL = { cv: 'CV', 'cover-letter': 'cover letter', criteria: 'answers', 'cold-email': 'email' };

/**
 * Your profile, beside the draft.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {string} props.markdown the draft as it stands in the editor, unsaved
 *   edits included — "is this record used" has to be about what you can see
 * @param {Function} [props.onInsert] called with a record's markdown
 * @param {boolean} [props.canInsert] false while the draft is not yours to change
 */
export function ProfileDrawer({ jobId, kind, open, onClose, markdown, onInsert, canInsert = true }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('all'); // all | missing | used
  const [expanded, setExpanded] = useState(() => new Set());

  // Loaded when it is first opened, and re-marked whenever the draft changes —
  // insert a record and it should stop reading as missing without a reload.
  // Debounced, because the draft changes on every keystroke and this is a round
  // trip; 400ms is below the point where the badge feels stale.
  useEffect(() => {
    if (!open) return undefined;
    let dropped = false;
    const timer = setTimeout(() => {
      api
        .draftRecords(jobId, kind, markdown)
        .then((data) => {
          if (dropped) return;
          setRecords(data.records ?? []);
          setError(null);
        })
        .catch((err) => {
          if (!dropped) setError(err);
        });
    }, records === null ? 0 : 400);
    return () => {
      dropped = true;
      clearTimeout(timer);
    };
  }, [open, jobId, kind, markdown]);

  // A different document is a different set of answers about what is used.
  useEffect(() => {
    setRecords(null);
    setExpanded(new Set());
  }, [jobId, kind]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      // Only when the panel itself has focus. The chat can be open at the same
      // time, and Escape there must close the chat, not this.
      if (event.key !== 'Escape') return;
      const inside = document.querySelector('.profile-drawer')?.contains(document.activeElement);
      if (inside || document.activeElement === document.body) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matching = (records ?? []).filter((record) => {
      if (show === 'missing' && record.used) return false;
      if (show === 'used' && !record.used) return false;
      if (needle === '') return true;
      return [record.id, record.title, record.org, record.body, ...(record.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
    const byKind = new Map();
    for (const record of matching) {
      const key = KIND_ORDER.includes(record.kind) ? record.kind : 'other';
      if (!byKind.has(key)) byKind.set(key, []);
      byKind.get(key).push(record);
    }
    return KIND_ORDER.filter((k) => byKind.has(k)).map((k) => [k, byKind.get(k)]);
  }, [records, needle, show]);

  const total = (records ?? []).length;
  const usedCount = (records ?? []).filter((r) => r.used).length;
  const label = DOC_LABEL[kind] ?? 'draft';

  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return html`
    <${Portal}>
    <aside
      class=${`profile-drawer ${open ? 'open' : ''}`}
      aria-label="Your profile, beside this draft"
      aria-hidden=${!open}
    >
      <header class="chat-head">
        <div class="chat-title">
          <span>
            <strong>Your profile</strong>
            <span class="chat-sub">
              ${records === null
                ? 'reading your records…'
                : `${usedCount} of ${total} record${total === 1 ? '' : 's'} are in this ${label}`}
            </span>
          </span>
        </div>
        <div class="chat-head-actions">
          <a class="link-button" href="#/profile">Edit</a>
          <button class="button ghost icon-only" onClick=${onClose} aria-label="Close your profile">
            <${Close} size="1.1em" />
          </button>
        </div>
      </header>

      <div class="profile-drawer-tools">
        <label class="visually-hidden" for="drawer-search">Search your records</label>
        <input
          id="drawer-search"
          class="record-search"
          type="search"
          placeholder="Search titles, organisations, tags, text…"
          value=${query}
          onInput=${(e) => setQuery(e.target.value)}
        />
        <div class="segmented" aria-label="Which records to show">
          ${[
            ['all', 'All', 'Every record in your profile.'],
            ['missing', 'Not used', `Records this ${label} does not mention.`],
            ['used', 'In it', `Records this ${label} already draws on.`],
          ].map(
            ([id, text, title]) => html`
              <button
                key=${id}
                class=${`segment ${show === id ? 'on' : ''}`}
                onClick=${() => setShow(id)}
                aria-pressed=${show === id}
                title=${title}
              >${text}</button>
            `,
          )}
        </div>
      </div>

      <div class="profile-drawer-body">
        ${error
          ? html`<div class="chat-error">${error.message}${error.hint ? html` ${error.hint}` : null}</div>`
          : null}
        ${records === null && !error
          ? html`<p class="muted small"><${Thinking} word="Reading your profile" showTime=${false} /></p>`
          : null}
        ${records !== null && groups.length === 0
          ? html`<p class="muted small">
              ${needle === ''
                ? show === 'missing'
                  ? `Every record in your profile is in this ${label}.`
                  : `Nothing in your profile is in this ${label} yet.`
                : html`Nothing matches “${query}”.`}
            </p>`
          : null}
        ${groups.map(
          ([groupKind, list]) => html`
            <section key=${groupKind} class="drawer-group">
              <h3>${KIND_LABEL[groupKind] ?? groupKind} <span class="drawer-count">${list.length}</span></h3>
              <ul class="drawer-records">
                ${list.map(
                  (record) => html`
                    <li key=${record.id} class=${`drawer-record ${record.used ? 'used' : ''}`}>
                      <button
                        class="drawer-record-head"
                        onClick=${() => toggle(record.id)}
                        aria-expanded=${expanded.has(record.id)}
                      >
                        <span class="drawer-mark" aria-hidden="true">
                          ${record.used ? html`<${Check} size="0.9em" />` : null}
                        </span>
                        <span class="drawer-what">
                          <span class="record-title">${record.title || record.id}</span>
                          ${record.org ? html`<span class="record-org">${record.org}</span>` : null}
                          <span class="drawer-meta">
                            <span class="record-id">${record.id}</span>
                            ${record.dates?.start
                              ? html`<span class="drawer-dates">
                                  ${record.dates.start}${record.dates.end ? ` – ${record.dates.end}` : ' – now'}
                                </span>`
                              : null}
                          </span>
                        </span>
                      </button>
                      ${expanded.has(record.id)
                        ? html`
                            <div class="drawer-record-body">
                              ${record.citation ? html`<p class="drawer-citation">${record.citation}</p>` : null}
                              <pre>${(record.body ?? '').trim() || '(no text in this record)'}</pre>
                              ${(record.tags ?? []).length > 0
                                ? html`<p class="drawer-tags">${record.tags.map((t) => html`<span key=${t} class="tag">${t}</span>`)}</p>`
                                : null}
                              ${onInsert
                                ? html`<button
                                    class="button small"
                                    disabled=${!canInsert}
                                    onClick=${() => onInsert(record.markdown ?? record.body ?? '')}
                                  ><${Plus} size="0.9em" /> Put it in the draft</button>`
                                : null}
                            </div>
                          `
                        : null}
                    </li>
                  `,
                )}
              </ul>
            </section>
          `,
        )}
      </div>

      <p class="chat-foot">
        <span class="drawer-legend"><${Check} size="0.85em" /> means this ${label} already mentions it.</span>
        ${' '}Matched on titles and organisations, so treat it as a prompt to look rather than proof.
        Inserting puts the record's own words at the end of the draft.
      </p>
    </aside>
    <//>
  `;
}

export default ProfileDrawer;
