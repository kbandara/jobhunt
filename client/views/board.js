// WHY: six fixed columns, click to move — no drag library, because a
// drag dependency is a maintenance cost for an interaction one person performs
// twice a week. Every move writes an event server-side, which is what eventually
// answers "how long until they replied".
//
// Two things changed once there was real data on it. Five of the six lanes are
// empty nearly all the time, and six equal boxes containing an em-dash was the
// board's loudest visual statement — so an empty lane is now a quiet header, and
// on a phone the empty ones fold into one line instead of six full-width rows of
// nothing. And a card now says what to do with it, because "which of these has
// been scored" was previously answered by noticing which badge was missing.
import { html, useState, useEffect } from '../vendor/ui.js';
import { api } from '../api.js';
import { Thinking } from './thinking.js';
import { ErrorBanner } from './notice.js';
import { nextAction } from './steps-model.js';
import { ArrowLeft, ArrowRight, ChevronRight, Plus, Check, Bin } from './icons.js';

/** What to call each document on a card. Short: it sits inside a badge. */
const LABEL_FOR = { cv: 'CV', 'cover-letter': 'letter', criteria: 'answers', 'cold-email': 'email' };

const COLUMN_LABEL = {
  wishlist: 'Wishlist',
  drafting: 'Drafting',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
};

/** True while the board is stacked, where an empty lane costs a whole screen. */
function useStacked() {
  const [stacked, setStacked] = useState(() => window.matchMedia('(max-width: 48rem)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 48rem)');
    const apply = () => setStacked(media.matches);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return stacked;
}

export function Board() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState({});
  const stacked = useStacked();

  const [binned, setBinned] = useState(0);

  const load = () => api.board().then(setState).catch(setError);
  useEffect(() => {
    load();
    // The bin's count, so the link can stay silent when there is nothing in it.
    // Failure is ignored on purpose: the board is perfectly readable without it.
    api.trash().then((data) => setBinned(data.trash.length)).catch(() => {});
  }, []);

  // What is being written, anywhere. Generations now outlive the screen that
  // started them, so this is where you see that three applications are being
  // drafted at once — without it the board would look idle while the machine
  // was busy, which is the whole point of the change undone.
  useEffect(() => {
    let stopped = false;
    let previous = 0;
    const poll = async () => {
      try {
        const data = await api.runs();
        if (stopped) return;
        const active = Object.values(data.runs).filter((r) => r.running).length;
        setRunning(data.runs);
        // Something finished: the board's counts and badges are now stale.
        if (previous > 0 && active < previous) load();
        previous = active;
      } catch {
        /* the board is still readable without this */
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (error) return html`<${ErrorBanner} error=${error} />`;
  if (!state) return html`<p class="muted"><${Thinking} word="Loading the board" showTime=${false} /></p>`;

  const move = async (job, status) => {
    // Optimistic: the card moves under the cursor, and the server's answer
    // replaces it a moment later. A round trip before anything visibly happens
    // made a two-click reorder feel broken.
    setState((current) => ({
      ...current,
      board: {
        ...current.board,
        [job.status]: current.board[job.status].filter((j) => j.id !== job.id),
        [status]: [...current.board[status], { ...job, status }],
      },
    }));
    try {
      await api.setStatus(job.id, status);
    } catch (err) {
      setError(err);
    }
    load();
  };

  const total = state.count ?? 0;

  if (total === 0) {
    return html`
      <section class="empty-state">
        <h1>Nothing on the board yet</h1>
        <p>
          Paste a job advertisement and this app will pull out the requirements, tell you honestly
          whether the role is worth your time, and draft a CV and cover letter you can edit and print.
        </p>
        <a href="#/add" class="button primary"><${Plus} size="1.05em" /> Add your first job</a>
      </section>
    `;
  }

  const occupied = state.statuses.filter((s) => state.board[s].length > 0);
  const empty = state.statuses.filter((s) => state.board[s].length === 0);
  // Stacked, an empty lane is a whole screen of nothing to scroll past. Wide,
  // the column position is information — a gap in the middle of the pipeline
  // says something — so every lane stays.
  const lanes = stacked ? occupied : state.statuses;

  return html`
    <section>
      <div class="page-head">
        <div>
          <h1>Board</h1>
          <p class="muted small">
            ${total} application${total === 1 ? '' : 's'} · the arrows on a card move it along
          </p>
        </div>
        <div class="row">
          ${binned > 0
            ? html`<a class="board-bin" href="#/trash">
                <${Bin} size="1em" /> Bin (<span class="num">${binned}</span>)
              </a>`
            : null}
          <a href="#/add" class="button"><${Plus} size="1.05em" /> Add job</a>
        </div>
      </div>

      <div class="board">
        ${lanes.map(
          (status) => html`
            <${Lane}
              key=${status}
              status=${status}
              jobs=${state.board[status]}
              statuses=${state.statuses}
              running=${running}
              onMove=${move}
              onChanged=${load}
            />
          `,
        )}
      </div>

      ${stacked && empty.length > 0
        ? html`<p class="lanes-empty-note">
            Nothing in ${listOf(empty.map((s) => COLUMN_LABEL[s] ?? s))}.
          </p>`
        : null}
    </section>
  `;
}

/** "Drafting, Applied and Offer" — an Oxford-comma-free list, read aloud. */
function listOf(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function Lane({ status, jobs, statuses, running, onMove, onChanged }) {
  return html`
    <section class=${`lane animate-blur-in-up stagger-2 ${jobs.length === 0 ? 'is-empty' : ''}`} data-status=${status}>
      <div class="lane-head">
        <span class="lane-dot" aria-hidden="true"></span>
        <h2>${COLUMN_LABEL[status] ?? status}</h2>
        <span class="lane-count num" aria-label=${`${jobs.length} in this column`}>${jobs.length}</span>
      </div>
      ${jobs.length === 0
        ? html`<p class="lane-empty">Empty</p>`
        : html`
            <ul class="cards">
              ${jobs.map(
                (job) => html`
                  <li key=${job.id}>
                    <${Card} job=${job} statuses=${statuses} running=${running} onMove=${onMove} onChanged=${onChanged} />
                  </li>
                `,
              )}
            </ul>
          `}
    </section>
  `;
}

function Card({ job, statuses, running, onMove, onChanged }) {
  // "cv" and "cover-letter" for this job, if either is being written right now.
  const writing = Object.entries(running ?? {})
    .filter(([key, run]) => run.running && key.startsWith(`${job.id}:`))
    .map(([key]) => key.split(':')[1]);
  const index = statuses.indexOf(job.status);
  const parsed = job.parsed ?? {};
  const profile = job.profile?.confirmed ?? job.profile?.guess;
  const next = nextAction(job);
  const company = parsed.company || 'Untitled job';
  const role = parsed.role_title || 'not read yet';

  return html`
    <article class="card glass animate-blur-in-up stagger-3">
      <a class="card-title" href=${`#/job/${job.id}`}>
        <span class="card-company">${company}</span>
        <span class="card-role">${role}</span>
      </a>

      <div class="card-meta">
        ${profile
          ? html`<span class="badge profile">${profile}${job.profile?.confirmed ? '' : ' · guessed'}</span>`
          : null}
        ${job.fit
          ? html`<span class=${`badge verdict verdict-${job.fit.verdict}`}>
              ${job.fit.verdict} · <span class="num">${job.fit.cappedScore}</span>
            </span>`
          : null}
        ${/* A cold approach has no score and never will, so the card says why rather
             than looking like one that has not been scored yet. */ ''}
        ${job.source === 'cold' ? html`<span class="badge cold">cold approach</span>` : null}
        ${writing.length > 0
          ? html`<span class="badge writing">
              <${Thinking} word=${writing.length === 1 ? `writing the ${LABEL_FOR[writing[0]] ?? writing[0]}` : `writing ${writing.length} drafts`} showTime=${false} />
            </span>`
          : null}
      </div>

      <div class="card-foot">
        ${next
          ? html`<a class="card-next" href=${`#/job/${job.id}`}>
              ${next.label} <${ChevronRight} size="0.9em" />
            </a>`
          : html`<span class="card-done"><${Check} size="0.9em" /> nothing left to do</span>`}
        <div class="card-move">
          <button
            type="button"
            disabled=${index <= 0}
            aria-label=${`Move ${company} back to ${COLUMN_LABEL[statuses[index - 1]] ?? 'the previous column'}`}
            onClick=${() => onMove(job, statuses[index - 1])}
          ><${ArrowLeft} size="1em" /></button>
          <button
            type="button"
            disabled=${index >= statuses.length - 1}
            aria-label=${`Move ${company} on to ${COLUMN_LABEL[statuses[index + 1]] ?? 'the next column'}`}
            onClick=${() => onMove(job, statuses[index + 1])}
          ><${ArrowRight} size="1em" /></button>
        </div>
      </div>
    </article>
  `;
}
