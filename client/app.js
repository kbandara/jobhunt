// WHY: the shell — hash routing, the header, and the two things that must be
// visible on every screen: what this has cost so far, and whether the contact
// details still say FILL-ME (a document generated with FILL-ME in it is not
// sendable). Every view is a plain function component; there is no state library
// and there is not going to be one.
import { html, render, useState, useEffect, useCallback } from './vendor/ui.js';
import { api, centsToDollars } from './api.js';
import { parseHash, navigate } from './router.js';
import { Board } from './views/board.js';
import { AddJob } from './views/add.js';
import { JobView } from './views/job.js';
import { Welcome } from './views/welcome.js';
import { Trash } from './views/trash.js';
import { ProfileEditor } from './views/profile-editor.js';
import { Settings } from './views/settings.js';
import { CvProfiles, CvProfileEditor } from './views/cv-profiles.js';
import { Notice } from './views/notice.js';
import { Sun, Moon, Auto, Plus, Refresh, Sparkles } from './views/icons.js';

function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/**
 * Auto / Light / Dark. "Auto" follows the operating system and keeps following
 * it if you change that setting while the page is open. The choice is resolved
 * to a data-theme attribute on <html>, which is the only thing the stylesheet
 * reads — see the script in index.html that does the same before first paint.
 *
 * Three icons rather than three words. "Auto Light Dark" was 150px of a header
 * that has to fit on a 390px screen, for a setting nobody changes twice — and
 * it was what pushed the header past the viewport and clipped every page behind
 * it. Each button still carries its label for anyone not reading the icon.
 */
function ThemeToggle() {
  const [choice, setChoice] = useState(
    () => document.documentElement.dataset.themeChoice || 'auto',
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'auto' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.themeChoice = choice;
    };
    apply();
    try {
      localStorage.setItem('jobhunt-theme', choice);
    } catch (err) {
      /* private browsing — the choice just will not survive a reload */
    }
    // Only relevant on "auto", but harmless to keep attached either way.
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);

  const options = [
    ['auto', 'Match the operating system', Auto],
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon],
  ];

  return html`
    <div class="theme-toggle" role="group" aria-label="Colour theme">
      ${options.map(
        ([value, label, Mark]) => html`
          <button
            key=${value}
            type="button"
            class=${value === choice ? 'active' : ''}
            title=${label}
            aria-label=${label}
            aria-pressed=${value === choice}
            onClick=${() => setChoice(value)}
          ><${Mark} size="1.05em" /></button>
        `,
      )}
    </div>
  `;
}

function Header({ meta, usage, route }) {
  const total = usage ? centsToDollars(usage.totalCents) : '—';
  const here = route[0];
  const link = (path, label, match) => html`
    <a href=${`#/${path}`} class=${here === match ? 'nav-link active' : 'nav-link'} aria-current=${here === match ? 'page' : null}>
      ${label}
    </a>
  `;
  return html`
    <header class="app-header glass">
      <div class="brand">
        <a href="#/board" class="brand-name">
          job_hunt
        </a>
        <span class="brand-meta">
          ${meta?.evidenceCount ?? '—'} record${meta?.evidenceCount === 1 ? '' : 's'} ·
          ${' '}${meta?.provider ?? 'no provider'}
        </span>
      </div>
      <nav aria-label="Main">
        <div class="nav-links">
          ${link('board', 'Board', 'board')}
          ${link('profile', 'Profile', 'profile')}
          ${link('profiles', 'CV profiles', 'profiles')}
          ${link('settings', 'Settings', 'settings')}
        </div>
        <${SpendPill} total=${total} />
        <${ThemeToggle} />
        <a href="#/add" class="button primary">
          <${Plus} size="1.05em" />
          Add job
        </a>
      </nav>
    </header>
  `;
}

/**
 * What this has cost. It re-reads on click rather than only on navigation,
 * because the number people distrust is the one they cannot refresh.
 */
function SpendPill({ total }) {
  const [spinning, setSpinning] = useState(false);
  return html`
    <button
      type="button"
      class="cost-pill"
      aria-label=${`Model spend so far: ${total}. Re-read it from the server.`}
      onClick=${() => {
        setSpinning(true);
        window.dispatchEvent(new CustomEvent('jobhunt:refresh'));
        setTimeout(() => setSpinning(false), 600);
      }}
    >
      <${Refresh} size="0.95em" />
      <strong class="num">${total}</strong>
      ${spinning ? html`<span class="visually-hidden">refreshing</span>` : null}
    </button>
  `;
}

function FillMeNotice({ fields, setupDone }) {
  // Nothing to nag about before setup: the welcome screen is already asking for
  // exactly these, and a warning above it would be the same sentence twice.
  if (!setupDone || !fields || fields.length === 0) return null;
  return html`
    <${Notice} kind="warning">
      <strong>Your contact details are incomplete.</strong>
      ${' '}Still missing: <strong>${fields.join(', ')}</strong>. Documents will still generate, but
      they will print the words “FILL-ME” where those details belong.
      ${' '}<a href="#/settings">Fill them in</a>.
    <//>
  `;
}

/**
 * master-profile.md is watched and re-read while the app runs, so an edit takes
 * effect on the next click. The one case that needs saying out loud is when it
 * does not parse: the app keeps using the last version that did, which is the
 * right behaviour and exactly the sort of thing to be silent about by accident.
 * You would add a record, see nothing change, and have no way to find out why.
 */
function ProfileErrorNotice({ meta }) {
  if (!meta?.profileError) return null;
  return html`
    <${Notice} kind="error">
      <strong>Your master profile has a problem, so your edits are not being used.</strong>
      Everything below is still running on the last version that parsed. Fix the line named here —
      the <a href="#/profile">markdown tab of the profile editor</a> is the place to do it — and it
      is picked up on your next click, with nothing to restart.
      <pre class="notice-detail">${meta.profileError}</pre>
    <//>
  `;
}

function KeyNotice({ meta, setupDone }) {
  if (!meta || meta.keyPresent || !setupDone) return null;
  return html`
    <${Notice} kind="warning">
      <strong>No API key found.</strong> The board and the editor work without one. Reading, scoring
      and writing call a language model, so they will fail until you
      ${' '}<a href="#/settings">add a key</a>. Gemini's free tier costs nothing.
    <//>
  `;
}

/**
 * The two ways the process behind this page stops being the one it was built
 * against, both of which used to surface as an unexplained failure on whatever
 * button happened to be pressed next.
 *
 * `down` — nothing is answering. Said once, at the top, rather than as a
 * mystery on each button.
 * `restarted` — something IS answering, but it is a different process than the
 * one this page loaded against. Usually `git pull` then a restart, which can
 * leave a page holding a client the running server has no routes for.
 */
function ServerNotice({ state, onRetry }) {
  if (state === 'down') {
    return html`
      <${Notice} kind="error">
        <strong>The server is not answering.</strong> Look at the terminal window where you ran
        <code>npm start</code>. If it has stopped, or shows an error, start it again and then
        ${' '}<button class="link-button" onClick=${onRetry}>check again</button>.
      <//>
    `;
  }
  if (state === 'restarted') {
    return html`
      <${Notice} kind="warning">
        <strong>The server has restarted since this page was opened.</strong> Reload the page so it
        matches — otherwise some things may fail for no visible reason.
        ${' '}<button class="link-button" onClick=${() => window.location.reload()}>Reload now</button>
      <//>
    `;
  }
  return null;
}

function App() {
  const route = useRoute();
  const [meta, setMeta] = useState(null);
  const [usage, setUsage] = useState(null);
  const [server, setServer] = useState(null); // null = fine, 'down', 'restarted'
  const [seenStartedAt, setSeenStartedAt] = useState(null);

  const refresh = useCallback(() => {
    api
      .meta()
      .then((next) => {
        setMeta(next);
        // The first startedAt this page ever saw is the process it was built
        // against. Kept in the updater rather than read from state, so a burst
        // of refreshes cannot race and record the second answer as the first.
        setSeenStartedAt((first) => {
          if (first && next.startedAt && next.startedAt !== first) setServer('restarted');
          else setServer((current) => (current === 'down' ? null : current));
          return first ?? next.startedAt ?? null;
        });
      })
      .catch((err) => setServer(err.type === 'unreachable' ? 'down' : null));
    api.usage().then(setUsage).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);
  // Cost changes whenever a model call happens, which is whenever the route
  // changes or a view says so — cheap to re-read, confusing when stale.
  useEffect(refresh, [route.join('/')]);

  // The spend pill lives in the header and the thing it refreshes lives here.
  useEffect(() => {
    window.addEventListener('jobhunt:refresh', refresh);
    return () => window.removeEventListener('jobhunt:refresh', refresh);
  }, [refresh]);

  // Somebody who has not set up yet lands on the welcome screen rather than on an
  // empty board, because an empty board answers none of the questions they have.
  // It is a redirect rather than a different render so the URL matches what is on
  // screen, and so every other route stays reachable if they want to look around.
  const setupDone = meta?.setup?.done ?? true;
  useEffect(() => {
    if (meta && !setupDone && route[0] === 'board') navigate('/welcome');
  }, [meta, setupDone, route.join('/')]);

  let view;
  if (route[0] === 'welcome') view = html`<${Welcome} meta=${meta} onChanged=${refresh} />`;
  else if (route[0] === 'add') view = html`<${AddJob} onCost=${refresh} />`;
  else if (route[0] === 'job' && route[1]) view = html`<${JobView} jobId=${route[1]} onCost=${refresh} />`;
  else if (route[0] === 'profile') view = html`<${ProfileEditor} onChanged=${refresh} />`;
  else if (route[0] === 'profiles' && route[1]) view = html`<${CvProfileEditor} id=${route[1]} onChanged=${refresh} />`;
  else if (route[0] === 'profiles') view = html`<${CvProfiles} onChanged=${refresh} />`;
  else if (route[0] === 'settings') view = html`<${Settings} meta=${meta} onChanged=${refresh} />`;
  else if (route[0] === 'trash') view = html`<${Trash} onChanged=${refresh} />`;
  else view = html`<${Board} />`;

  return html`
    <a class="skip-link" href="#main">Skip to the page</a>
    <${Header} meta=${meta} usage=${usage} route=${route} />
    <main class="page animate-blur-in-up" id="main" tabindex="-1">
      <${ServerNotice} state=${server} onRetry=${refresh} />
      <${ProfileErrorNotice} meta=${meta} />
      <${KeyNotice} meta=${meta} setupDone=${setupDone} />
      <${FillMeNotice} fields=${meta?.needsAttention} setupDone=${setupDone} />
      ${view}
    </main>
  `;
}

// The placeholder text is cleared first: render() diffs against whatever is
// already in the container, so leaving it there strands "Loading…" on the page.
const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
