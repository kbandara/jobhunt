// WHY: the profile decides section order, length and what leads the CV, so a wrong
// profile produces a wrong document — this screen exists to make that a decision a
// human makes, not a guess the app acts on. Nothing generates until Confirm is
// pressed.
//
// It is also the front door, so it now says where it leads. The two things it
// does — read what you pasted, then agree what kind of role it is — are numbered
// against the same rail the job screen uses, because they are the first steps of
// the same job and used to look like a separate errand you happened to run first.
import { html, useState, useEffect } from '../vendor/ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { Thinking } from './thinking.js';
import { Notice, ErrorBanner } from './notice.js';
import { ChevronRight, Info, Check, Briefcase, Rocket } from './icons.js';

/**
 * The profile dropdown, used here and on the job screen. The list is fetched from
 * the server rather than written here, because profiles are files in
 * server/generate/profiles/ — adding one must not mean editing the client.
 *
 * The description used to live in a `title` attribute, which is invisible on a
 * touch screen and unreliable to a screen reader — so the one sentence that
 * explains the most consequential choice in the app was, in practice, hidden.
 * It is text now.
 */
export function ProfilePicker({ value, onChange, disabled = false, describe = true, id = 'profile' }) {
  const [profiles, setProfiles] = useState(null); // null = still asking the server

  useEffect(() => {
    api.profiles().then(setProfiles).catch(() => setProfiles([]));
  }, []);

  if (profiles === null) return html`<p class="muted small">Loading the list of profiles…</p>`;
  if (profiles.length === 0) {
    return html`<p class="muted small">Could not load the list of profiles. Is the server still running?</p>`;
  }

  const chosen = profiles.find((profile) => profile.id === value);
  return html`
    <label for=${id}>
      Profile
      <select
        id=${id}
        value=${value ?? ''}
        disabled=${disabled}
        onChange=${(e) => onChange(e.target.value)}
      >
        <option value="">Choose one…</option>
        ${profiles.map((profile) => html`<option value=${profile.id} key=${profile.id}>${profile.id}</option>`)}
      </select>
    </label>
    ${/* On the Add screen the description is the whole point of the step; beside
         a draft it is a paragraph you have already read, above the thing you came
         to look at. Same component, one prop. */ ''}
    ${describe
      ? html`<p class="muted small">
          ${chosen
            ? chosen.description
            : 'The profile decides the section order, the length, and what the CV leads with.'}
        </p>`
      : null}
  `;
}

/**
 * Two things can start an application, and they are not the same thing.
 *
 * An advertisement states its requirements; notes about a startup do not, and
 * anything the app calls a requirement there is something it inferred from what
 * you typed. Both go down the same pipeline — the notes are parsed into the same
 * shape — but the difference is carried on the job from this screen onwards, so
 * nothing downstream can present a guess as a stated fact.
 */
const SOURCES = [
  {
    id: 'pasted',
    label: 'A job advertisement',
    heading: 'Add a job',
    lede: 'Paste the whole advertisement — the duties, the essential criteria, all of it. More text means a better reading of what they actually want.',
    placeholder: 'Paste the job advertisement here…',
    action: 'Read it',
    working: 'Reading the advertisement',
  },
  {
    id: 'cold',
    label: 'A company to approach',
    heading: 'Approach a company',
    lede: 'Nobody is advertising. Write down everything you know about them — what they build, who is there, how you came across them, why you want to talk to them. Thin notes give a thin email, so anything that made you interested is worth typing.',
    placeholder:
      'e.g. Small Melbourne team building evaluation tooling for clinical AI. Met their\nresearch lead at a conference. Four engineers, no measurement person. Spun out of\na university lab last year. I want to talk to them because…',
    action: 'Read my notes',
    working: 'Reading your notes',
  },
];

export function AddJob() {
  const [source, setSource] = useState('pasted');
  const [rawText, setRawText] = useState('');
  const [job, setJob] = useState(null);
  const [profile, setProfile] = useState('');
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState(null);
  const [error, setError] = useState(null);

  const mode = SOURCES.find((s) => s.id === source) ?? SOURCES[0];

  const parse = async () => {
    setBusy(true);
    setStartedAt(Date.now());
    setError(null);
    try {
      const created = await api.createJob(rawText, source);
      // Two calls on purpose: the job is saved before the model is asked anything,
      // so a model failure never loses the text you pasted.
      const parsed = await api.parse(created.job.id);
      setJob(parsed.job);
      setProfile(parsed.job.profile?.guess ?? '');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setStartedAt(null);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await api.confirmProfile(job.id, profile);
      navigate(`/job/${job.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  /* --- Step two: agree what kind of role this is ------------------------- */

  if (job) {
    const cold = job.source === 'cold';
    return html`
      <section class="animate-blur-in-up stagger-1">
        <${AddSteps} at=${2} cold=${cold} />
        <h1>Check what it read</h1>
        <p class="muted">
          ${cold
            ? 'A model read your notes and worked out what the work would probably involve. None of this was advertised, so read it as a starting point rather than as facts about them.'
            : 'A model read the advertisement and pulled out the details below. Nothing here needs fixing — just check the CV profile is right, because it decides how the CV is built.'}
        </p>
        ${error ? html`<${ErrorBanner} error=${error} />` : null}

        <div class="panel glass animate-blur-in-up stagger-2">
          <h2>Which kind of role is this?</h2>
          <p class="muted small">
            The model guessed <strong>${job.profile?.guess}</strong> — ${job.profile?.guessReason}
          </p>
          ${job.profile?.guessFellBack
            ? html`<${Notice} kind="warning">
                It actually answered “${job.profile?.modelSaid}”, which is not one of the profiles on
                disk, so the guess was moved to <strong>general</strong>. Pick the right one below.
              <//>`
            : null}
          <${ProfilePicker} value=${profile} onChange=${setProfile} disabled=${busy} />
          <div class="doc-actions">
            <button class="button primary" disabled=${busy || !profile} onClick=${confirm}>
              ${busy
                ? html`<${Thinking} word="Saving" showTime=${false} />`
                : html`Confirm and open it <${ChevronRight} size="1.05em" />`}
            </button>
          </div>
        </div>

        <${ParsedPanel} parsed=${job.parsed} cold=${cold} />
      </section>
    `;
  }

  /* --- Step one: paste it ------------------------------------------------ */

  return html`
    <section class="animate-blur-in-up stagger-1">
      <${AddSteps} at=${1} cold=${source === 'cold'} />

      <div class="tabs" role="tablist" aria-label="What are you adding?">
        ${SOURCES.map(
          (s) => html`
            <button
              key=${s.id}
              type="button"
              role="tab"
              id=${`source-tab-${s.id}`}
              aria-selected=${source === s.id}
              aria-controls="source-panel"
              class="tab"
              onClick=${() => setSource(s.id)}
            >
              ${s.id === 'pasted' ? html`<${Briefcase} size="0.9em" style="margin-right: 4px; opacity: 0.8;" />` : html`<${Rocket} size="0.9em" style="margin-right: 4px; opacity: 0.8;" />`}
              ${s.label}
            </button>
          `,
        )}
      </div>

      <div role="tabpanel" id="source-panel" aria-labelledby=${`source-tab-${mode.id}`} class="panel glass animate-blur-in-up stagger-2">
        <h1>${mode.heading}</h1>
        <p class="muted">${mode.lede}</p>
        ${error ? html`<${ErrorBanner} error=${error} />` : null}
        <label class="visually-hidden" for="paste-box">${mode.heading}</label>
        <textarea
          id="paste-box"
          class="paste"
          rows="18"
          placeholder=${mode.placeholder}
          value=${rawText}
          onInput=${(e) => setRawText(e.target.value)}
        ></textarea>
        <div class="doc-actions">
          <button class="button primary" disabled=${busy || rawText.trim() === ''} onClick=${parse}>
            ${busy
              ? html`<${Thinking} word=${mode.working} since=${startedAt} />`
              : html`${mode.action} <${ChevronRight} size="1.05em" />`}
          </button>
          <span class="muted small">about one cent of model time</span>
        </div>
      </div>
    </section>
  `;
}

/**
 * The first two steps of the rail, before there is a job to draw the real one
 * against. Same shape and same vocabulary, so arriving on the job screen looks
 * like continuing rather than starting again.
 */
function AddSteps({ at, cold }) {
  const steps = [
    { n: 1, label: cold ? 'Your notes' : 'The advertisement' },
    { n: 2, label: 'Profile' },
    { n: 3, label: cold ? 'Approach' : 'Fit, draft, send' },
  ];
  return html`
    <nav class="rail" aria-label="Adding a job">
      <ol class="rail-track">
        ${steps.map(
          (step) => html`
            <li
              key=${step.n}
              class=${`rail-step ${step.n < at ? 'is-done' : step.n === at ? 'is-now is-current' : 'is-locked'}`}
            >
              <span class="rail-button" aria-current=${step.n === at ? 'step' : null}>
                <span class="rail-mark">${step.n < at ? html`<${Check} />` : step.n}</span>
                <span class="rail-text">
                  <span class="rail-label">${step.label}</span>
                </span>
              </span>
            </li>
          `,
        )}
      </ol>
    </nav>
  `;
}

export function ParsedPanel({ parsed, cold = false }) {
  if (!parsed) return null; // the panel above already says nothing has been read yet
  const must = (parsed.requirements ?? []).filter((r) => r.must_have);
  const nice = (parsed.requirements ?? []).filter((r) => !r.must_have);
  const location = [parsed.location?.city, parsed.location?.country].filter(Boolean).join(', ');

  // For a cold approach every requirement was inferred from your own notes, so
  // the headings say so. Calling them "Essential" would be the app quoting
  // itself back to you as though a company had written it.
  return html`
    <div class="panel" id="panel-read">
      <div class="panel-head">
        <h2>${parsed.role_title} — ${parsed.company}</h2>
      </div>
      ${cold
        ? html`<p class="inferred-note">
            <${Info} size="1.05em" />
            <span>Nobody advertised this. Everything below was worked out from your notes.</span>
          </p>`
        : null}
      <ul class="facts">
        <li><span>Where</span> <span>${location || 'not stated'} · ${parsed.work_arrangement}</span></li>
        ${cold
          ? null
          : html`<li><span>Closes</span> <span>${parsed.closing_date ?? 'not stated'}</span></li>
              <li>
                <span>Selection criteria</span>
                <span>
                  ${(parsed.selection_criteria ?? []).length} question${(parsed.selection_criteria ?? []).length === 1 ? '' : 's'}
                </span>
              </li>`}
      </ul>
      ${cold
        ? html`<h3>What the work would involve <span class="muted num">(${nice.length + must.length})</span></h3>
            <ul class="req-list">
              ${[...must, ...nice].map(
                (r, i) => html`<li key=${i}><span class="chip">${r.kind}</span> <span>${r.text}</span></li>`,
              )}
            </ul>`
        : html`<h3>Essential <span class="muted num">(${must.length})</span></h3>
            <ul class="req-list">
              ${must.map((r, i) => html`<li key=${i}><span class="chip">${r.kind}</span> <span>${r.text}</span></li>`)}
            </ul>
            ${nice.length > 0
              ? html`<h3>Desirable <span class="muted num">(${nice.length})</span></h3>
                  <ul class="req-list">
                    ${nice.map((r, i) => html`<li key=${i}><span class="chip">${r.kind}</span> <span>${r.text}</span></li>`)}
                  </ul>`
              : null}`}
    </div>
  `;
}
