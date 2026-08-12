// WHY: everything this app does was, until now, gated behind four things you had
// to get right in a text editor before the first screen would do anything —
// install Node, copy .env.example, paste a key without quotes, and hand-write a
// markdown file in a format documented in a README. Every one of those is a
// place to give up, and none of them is the app.
//
// So they happen here instead, in order, with the state of each one read from
// the machine rather than remembered. The steps are not a wizard you are locked
// into: each is independently visitable, each says what it is for, and the whole
// screen stays reachable from the header afterwards.
import { html, useState, useEffect, useCallback } from '../vendor/ui.js';
import { api } from '../api.js';
import { Notice, ErrorBanner } from './notice.js';
import { Check, ArrowRight, Working, External, Plus, Read, Sparkles } from './icons.js';
import { ImportProfile } from './import-profile.js';

const PROVIDERS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    free: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    blurb:
      'Recommended. Sign in with a Google account, press Create API key, and copy it. ' +
      'The free tier is enough to run this app — no payment and no card needed.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    free: false,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    blurb:
      'Paid, at roughly 20c per application. Worth choosing if you already have credits; ' +
      'the writing is a little better on longer documents.',
  },
];

const STATUS_TONE = { ok: 'ok', warn: 'warn', fail: 'fail' };

export function Welcome({ meta, onChanged }) {
  const [checks, setChecks] = useState(null);
  const [error, setError] = useState(null);

  const refreshChecks = useCallback(() => {
    api
      // Not the .env or provider checks: they legitimately fail before step 2
      // has been done, and a red cross against something the next step is about
      // to fix reads as the app being broken.
      .doctor(['node', 'dependencies', 'data'])
      .then((result) => setChecks(result.checks))
      .catch(setError);
  }, []);

  useEffect(refreshChecks, [refreshChecks]);

  const steps = meta?.setup?.steps ?? {};
  const done = meta?.setup?.done ?? false;

  return html`
    <div class="welcome">
      <header class="welcome-hero animate-blur-in-up stagger-1">
        <h1>job_hunt</h1>
        <p class="lede">
          Welcome. Paste in a job advertisement and this app reads the requirements, estimates how
          well you match, and drafts a CV, a cover letter and answers to any questions the
          application asks — all from <strong>a profile you write yourself</strong>. The board keeps
          track of where each application got to.
        </p>
        <p class="lede-sub">
          There are four things to set up below, and it takes about ten minutes. Everything stays on
          this computer: your profile, your drafts and your API key never leave it. The only thing
          that goes anywhere is the text you send to the model, when you press a button that does
          that.
        </p>
      </header>

      <${ErrorBanner} error=${error} />

      ${done
        ? html`
            <${Notice} kind="info" live=${false}>
              <strong>You're all set up.</strong> ${' '}
              <a href="#/add">Add your first job</a>, or
              ${' '}<a href="#/board">go to the board</a>. The steps below stay here if you ever
              want to change something.
            <//>
          `
        : null}

      <${Step}
        n="1"
        className="animate-blur-in-up stagger-2 glass panel"
        title="Check your computer is ready"
        done=${checks !== null && checks.every((check) => check.status !== 'fail')}
        summary="Node 22 and five small packages. Usually already done."
      >
        <${MachineChecks} checks=${checks} onRetry=${refreshChecks} />
      <//>

      <${Step} n="2" className="animate-blur-in-up stagger-3 glass panel" title="Get an API key" done=${steps.key} summary="Free with Google Gemini. Takes two minutes.">
        <${KeyStep} meta=${meta} onSaved=${() => { onChanged(); refreshChecks(); }} />
      <//>

      <${Step} n="3" title="Add your contact details" done=${steps.contact} summary="Name, email, phone — these go at the top of every document.">
        <${ContactStep} onSaved=${onChanged} />
      <//>

      <${Step}
        n="4"
        title="Build your profile"
        done=${steps.profile}
        summary=${
          steps.profile
            ? `${meta?.evidenceCount ?? 0} records saved. Everything the app writes comes from these.`
            : 'A list of what you have done. The app needs this before it can write anything.'
        }
      >
        <${ProfileStep} meta=${meta} onChanged=${onChanged} />
      <//>

      <${Tour} />
    </div>
  `;
}

/**
 * One numbered step. Open until it is done, then closed — but a click always
 * wins and keeps winning, so a step you opened on purpose does not shut itself
 * the moment the thing it was about starts working.
 */
function Step({ n, title, summary, done, className = '', children }) {
  const [override, setOverride] = useState(null);
  const open = override ?? !done;
  const setOpen = (next) => setOverride(next);
  return html`
    <section class=${`setup-step ${done ? 'is-done' : ''} ${className}`}>
      <button type="button" class="setup-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
        <span class="setup-n">${done ? html`<${Check} size="1em" />` : n}</span>
        <span class="setup-title">
          <strong>${title}</strong>
          <span class="setup-summary">${summary}</span>
        </span>
      </button>
      ${open ? html`<div class="setup-body">${children}</div>` : null}
    </section>
  `;
}

function MachineChecks({ checks, onRetry }) {
  if (!checks) return html`<p class="muted"><${Working} /> Looking at this machine…</p>`;
  return html`
    <ul class="check-list">
      ${checks.map(
        (check) => html`
          <li key=${check.id} class=${`check ${STATUS_TONE[check.status] ?? ''}`}>
            <span class="check-mark">${check.status === 'ok' ? '✓' : check.status === 'warn' ? '!' : '×'}</span>
            <span class="check-text">
              <strong>${check.label}</strong> ${check.detail}
              ${check.fix ? html`<span class="hint">${check.fix}</span>` : null}
            </span>
          </li>
        `,
      )}
    </ul>
    <p class="muted">
      Anything with a <code>×</code> needs fixing before the app will work, and the line
      underneath tells you how.
      <button type="button" class="link-button" onClick=${onRetry}>Check again</button>
      once you've done it. You can also run <code>npm run doctor</code> in your terminal for a
      fuller check.
    </p>
  `;
}

function KeyStep({ meta, onSaved }) {
  const [provider, setProvider] = useState(meta?.provider ?? 'gemini');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(null);
  const [error, setError] = useState(null);

  const chosen = PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0];

  const save = async (thenTest) => {
    setBusy(true);
    setError(null);
    setTested(null);
    try {
      await api.saveProvider(provider, key);
      setKey('');
      onSaved();
      if (thenTest) setTested(await api.testKey());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <p>
      The app writes your documents using a language model, and you need your own key to reach one.
      That way you can see exactly what it costs, and nothing you write goes through anyone else's
      server.
    </p>

    <div class="provider-choice">
      ${PROVIDERS.map(
        (entry) => html`
          <label key=${entry.id} class=${`provider-card ${provider === entry.id ? 'chosen' : ''}`}>
            <input
              type="radio"
              name="provider"
              value=${entry.id}
              checked=${provider === entry.id}
              onChange=${() => setProvider(entry.id)}
            />
            <span class="provider-name">
              ${entry.name}
              ${entry.free ? html`<span class="pill free">free tier</span>` : html`<span class="pill">paid</span>`}
            </span>
            <span class="provider-blurb">${entry.blurb}</span>
          </label>
        `,
      )}
    </div>

    <p>
      <a class="button" href=${chosen.keyUrl} target="_blank" rel="noreferrer">
        Get a ${chosen.name} key <${External} size="0.95em" />
      </a>
    </p>

    <label class="field">
      <span class="field-label">Paste the key here</span>
      <input
        type="password"
        class="input"
        autocomplete="off"
        spellcheck="false"
        value=${key}
        placeholder=${meta?.keyPresent ? 'A key is already saved — paste a new one to replace it' : 'AIza…'}
        onInput=${(event) => setKey(event.target.value)}
      />
      <span class="field-hint">
        Saved to a file called <code>.env</code> in this folder, which git ignores. It's only ever
        sent to ${chosen.name}, and this screen won't show it back to you.
      </span>
    </label>

    <div class="row">
      <button type="button" class="button primary" disabled=${busy} onClick=${() => save(true)}>
        ${busy ? html`<${Working} />` : null} Save and test it
      </button>
      <button type="button" class="button" disabled=${busy} onClick=${() => save(false)}>
        Save without testing
      </button>
    </div>

    <${ErrorBanner} error=${error} />
    ${tested === null
      ? null
      : tested.ok
        ? html`<${Notice} kind="info"><strong>That key works.</strong> It answered on ${tested.model}.<//>`
        : html`
            <${Notice} kind="error">
              <strong>The key was saved, but the provider rejected it.</strong>
              <pre class="notice-detail">${tested.error}</pre>
            <//>
          `}
  `;
}

function ContactStep({ onSaved }) {
  const [meta, setMeta] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.profileMeta().then((result) => setMeta(result.meta)).catch(setError);
  }, []);

  if (!meta) return html`<p class="muted"><${Working} /> Loading…</p>`;

  const set = (field) => (event) => {
    setMeta({ ...meta, [field]: event.target.value });
    setSaved(false);
  };

  const save = async () => {
    try {
      await api.saveProfileMeta(meta);
      setSaved(true);
      setError(null);
      onSaved();
    } catch (err) {
      setError(err);
    }
  };

  return html`
    <p>
      These four go at the top of every CV and cover letter. The app copies them across exactly as
      you type them here — no model is involved, so your phone number can't come out wrong.
    </p>
    <div class="field-grid">
      <${Field} label="Full name" value=${meta.name} onInput=${set('name')} placeholder="Rosa Kimani" />
      <${Field} label="Email" value=${meta.email} onInput=${set('email')} type="email" placeholder="you@example.org" />
      <${Field} label="Phone" value=${meta.phone} onInput=${set('phone')} placeholder="+61 400 000 000" />
      <${Field} label="Where you are" value=${meta.city} onInput=${set('city')} placeholder="Melbourne, Australia" />
    </div>
    <div class="row">
      <button type="button" class="button primary" onClick=${save}>Save</button>
      ${saved ? html`<span class="saved-tick"><${Check} size="1em" /> Saved</span>` : null}
      <a class="link-button" href="#/settings">Add links, right to work and qualifications →</a>
    </div>
    <${ErrorBanner} error=${error} />
  `;
}

function ProfileStep({ meta, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);

  const load = async (source) => {
    setBusy(source);
    setError(null);
    try {
      setResult(await api.replaceProfile(source));
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return html`
    <p>
      Your <strong>profile</strong> is a list of everything you have done: education, jobs,
      projects, findings, publications, skills. Every CV the app writes is built from it, and
      anything not in here cannot appear on one. That is what stops the app inventing a job or a
      number on your behalf.
    </p>
    <p>
      You have ${meta?.evidenceCount ?? 0} records so far. Pick whichever way in suits you:
    </p>
    <div class="row wrap">
      <button type="button" class="button primary" onClick=${() => setImporting(true)}>
        <${Read} size="1em" /> Start from my CV
      </button>
      <a class="button" href="#/profile"><${Plus} size="1em" /> Write it by hand</a>
      <button type="button" class="button" disabled=${busy !== null} onClick=${() => load('example')}>
        ${busy === 'example' ? html`<${Working} />` : null} Load a worked example
      </button>
    </div>
    <p class="field-hint">
      <strong>Start from my CV</strong> is the quickest. Upload a PDF — a LinkedIn
      <em>Save to PDF</em> export works well — or paste the text in. It comes back as a list of
      records for you to check, and nothing is saved until you tick it.
    </p>
    <p class="field-hint">
      <strong>Load a worked example</strong> fills your profile with 21 records belonging to a
      made-up ecologist called Rosa Kimani. It is there so you can try the whole app — read an ad,
      score it, generate a CV — before typing anything about yourself. Your own profile is backed
      up first, so nothing is lost.
    </p>
    ${result
      ? html`
          <${Notice} kind="info">
            <strong>Loaded ${result.count} records.</strong>
            ${result.backedUpTo ? html` Your previous profile was saved to <code>${result.backedUpTo}</code>.` : null}
          <//>
        `
      : null}
    <${ErrorBanner} error=${error} />
    ${importing
      ? html`
          <${ImportProfile}
            onClose=${() => setImporting(false)}
            onImported=${() => onChanged()}
          />
        `
      : null}
  `;
}

export function Field({ label, hint, type = 'text', ...rest }) {
  return html`
    <label class="field">
      <span class="field-label">${label}</span>
      <input type=${type} class="input" ...${rest} />
      ${hint ? html`<span class="field-hint">${hint}</span>` : null}
    </label>
  `;
}

/**
 * What actually happens once you are set up. Deliberately six sentences rather
 * than a modal that walks you round the interface pointing at things: the thing
 * people need is a map of the sequence, and the screens themselves say what
 * each button does.
 */
function Tour() {
  const steps = [
    ['Add a job', 'Paste in the advertisement. There is a second tab for companies that are not advertising, which gets you a cold email instead.'],
    ['It reads the ad', 'Requirements, location, whether it is onsite or remote, any questions the application asks, and a suggestion for which CV profile to use.'],
    ['Worth applying?', 'An estimate of how a recruiter would react to your profile, and why. Anything you cannot pass — a required degree, a citizenship rule — lowers the score, and the screen says which.'],
    ['Generate', 'A CV, a cover letter, and answers to the application\'s questions. One tab each, and you can start several jobs at once.'],
    ['Check the flags', 'The app reads the draft back and points out anything it cannot support — a bullet with no source, or a number that is not in your profile. That check is ordinary code, not another model.'],
    ['Get a recruiter\'s read', 'A model plays the person screening this role and reads the draft you are about to send. It says what would make them hesitate, and which of your records this application is not using.'],
    ['Edit and export', 'Your edits are saved as new versions, never over the top. Export a PDF, a .tex file, or print straight from the browser.'],
  ];
  return html`
    <section class="tour">
      <h2>How you'll use it</h2>
      <ol class="tour-list">
        ${steps.map(
          ([title, body], index) => html`
            <li key=${title}>
              <span class="tour-n">${index + 1}</span>
              ${/* No full stop when the title is already a question — "Worth applying?." */ ''}
              <div><strong>${/[?!.]$/.test(title) ? title : `${title}.`}</strong> ${body}</div>
            </li>
          `,
        )}
      </ol>
      <p>
        <a class="button primary" href="#/add">Add your first job <${ArrowRight} size="1em" /></a>
      </p>
    </section>
  `;
}

export default Welcome;
