// WHY: a CV profile is the shape of a document — what order the sections run in,
// what leads the page, how long it runs, what happens to publications. There are
// six shipped, they are files, and until now the only way to change one was to
// find it in the repo and edit JSON. That is fine for the person who wrote the
// JSON and opaque to everybody else, and it matters more than it sounds: the
// profile is the single biggest decision in how a CV comes out.
//
// The model can still draft one from a description. What is new is being able to
// read what a profile actually does, and change it, without leaving the app.
import { html, useState, useEffect, useCallback } from '../vendor/ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { Notice, ErrorBanner } from './notice.js';
import { Plus, Close, Check, Working, ArrowUp, ArrowLeft } from './icons.js';

const PUBLICATION_POLICIES = [
  ['omit', 'None at all'],
  ['brief', 'A few, one line each'],
  ['selected', 'A selected list'],
  ['all', 'Everything, in full'],
];

export function CvProfiles({ onChanged }) {
  const [profiles, setProfiles] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => { api.profiles().then(setProfiles).catch(setError); }, []);
  useEffect(load, [load]);

  if (!profiles) return html`<p class="muted"><${Working} /> Loading…</p>`;

  return html`
    <div class="cv-profiles">
      <header class="page-head">
        <div>
          <h1>CV profiles</h1>
          <p class="muted">
            A profile decides the <em>shape</em> of a document, never its content. The words always
            come from your records and the advertisement being answered.
          </p>
        </div>
        <button type="button" class="button primary" onClick=${() => setDrafting(true)}>
          <${Plus} size="1em" /> New profile
        </button>
      </header>

      <${ErrorBanner} error=${error} />

      <ul class="profile-cards">
        ${profiles.map((profile) => html`
          <li key=${profile.id} class="profile-card">
            <a href=${`#/profiles/${profile.id}`}>
              <strong>${profile.id}</strong>
              <span>${profile.description}</span>
            </a>
          </li>
        `)}
      </ul>

      ${drafting ? html`<${DraftProfile} onClose=${() => setDrafting(false)} onCreated=${() => { setDrafting(false); load(); onChanged?.(); }} />` : null}
    </div>
  `;
}

/**
 * Draft, read, then decide. Nothing is written until the second click, because a
 * profile is two files on your disk and a file you did not ask for is worse than
 * an extra click.
 */
function DraftProfile({ onClose, onCreated }) {
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return html`
    <div class="modal-backdrop" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="New CV profile">
        <header class="modal-head">
          <h2>A new CV profile</h2>
          <button type="button" class="icon-button" onClick=${onClose} aria-label="Close"><${Close} size="1.1em" /></button>
        </header>
        <div class="modal-body">
          ${draft === null
            ? html`
                <label class="field">
                  <span class="field-label">What kind of role is this for?</span>
                  <textarea
                    class="input"
                    rows="4"
                    placeholder="Science communication and public engagement roles — museums, science media, outreach programmes. The reader is not a specialist."
                    value=${description}
                    onInput=${(e) => setDescription(e.target.value)}
                  ></textarea>
                  <span class="field-hint">
                    Describe the class of role, not one job. A profile written around a single
                    advertisement stops being a shape and starts being a document.
                  </span>
                </label>
                <button
                  type="button"
                  class="button primary"
                  disabled=${busy || description.trim() === ''}
                  onClick=${() => run(async () => setDraft(await api.draftCvProfile(description)))}
                >${busy ? html`<${Working} />` : null} Draft it</button>
              `
            : html`
                <${Notice} kind="info" live=${false}>
                  Nothing has been written yet. Read it, then decide.
                <//>
                <h3>${draft.config.id}</h3>
                <p>${draft.config.description}</p>
                <p class="muted">
                  Sections: ${(draft.config.sections ?? []).map((s) => s.id ?? s).join(' → ')}<br />
                  Register: ${draft.config.register} · Publications: ${draft.config.publications?.policy}
                </p>
                <details><summary>The prompt it would use</summary><pre class="notice-detail">${draft.promptMarkdown}</pre></details>
                <div class="row">
                  <button type="button" class="button primary" disabled=${busy} onClick=${() => run(async () => {
                    await api.createCvProfile(draft.config, draft.promptMarkdown);
                    onCreated();
                  })}>Save this profile</button>
                  <button type="button" class="button" onClick=${() => setDraft(null)}>Start again</button>
                </div>
              `}
          <${ErrorBanner} error=${error} />
        </div>
      </div>
    </div>
  `;
}

/** One profile, editable. */
export function CvProfileEditor({ id, onChanged }) {
  const [state, setState] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { api.cvProfile(id).then(setState).catch(setError); }, [id]);

  if (!state) return html`<${ErrorBanner} error=${error} />`;

  const { profile, prompt, sections, registers, evidenceTags } = state;
  const set = (field, value) => { setState({ ...state, profile: { ...profile, [field]: value } }); setSaved(false); };

  const moveSection = (index, by) => {
    const next = [...profile.sections];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set('sections', next);
  };

  const save = async () => {
    try {
      await api.saveCvProfile(id, profile, state.prompt);
      setSaved(true);
      setError(null);
      onChanged?.();
    } catch (err) {
      setError(err);
    }
  };

  const unusedSections = sections.filter((section) => !profile.sections.some((chosen) => chosen.id === section.id));

  return html`
    <div class="cv-profile-editor">
      <header class="page-head">
        <div>
          <p><a class="link-button" href="#/profiles"><${ArrowLeft} size="0.9em" /> All profiles</a></p>
          <h1>${profile.id}</h1>
        </div>
        <div class="row">
          ${saved ? html`<span class="saved-tick"><${Check} size="1em" /> Saved</span>` : null}
          <button type="button" class="button primary" onClick=${save}>Save</button>
        </div>
      </header>

      <${ErrorBanner} error=${error} />

      <section class="settings-block">
        <label class="field">
          <span class="field-label">Description</span>
          <textarea class="input" rows="2" value=${profile.description} onInput=${(e) => set('description', e.target.value)}></textarea>
          <span class="field-hint">
            Does double duty: it is what you read in the picker, and what a model reads when
            guessing which profile a new advertisement belongs to.
          </span>
        </label>

        <div class="field-grid">
          <label class="field">
            <span class="field-label">Who is reading it</span>
            <select class="input" value=${profile.register} onChange=${(e) => set('register', e.target.value)}>
              ${registers.map((r) => html`<option key=${r} value=${r}>${r}</option>`)}
            </select>
            <span class="field-hint">Decides how much specialist vocabulary survives.</span>
          </label>
          <label class="field">
            <span class="field-label">Rough length in pages</span>
            <input
              class="input"
              type="number"
              min="1"
              value=${profile.lengthPages ?? ''}
              placeholder="no target"
              onInput=${(e) => set('lengthPages', e.target.value === '' ? null : Number(e.target.value))}
            />
            <span class="field-hint">A guide, not a limit. Nothing the ad asked for is dropped to hit it.</span>
          </label>
          <label class="field">
            <span class="field-label">Publications</span>
            <select
              class="input"
              value=${profile.publications?.policy}
              onChange=${(e) => set('publications', { ...profile.publications, policy: e.target.value })}
            >
              ${PUBLICATION_POLICIES.map(([value, label]) => html`<option key=${value} value=${value}>${label}</option>`)}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Name of the technical section</span>
            <input class="input" value=${profile.techSectionName ?? ''} onInput=${(e) => set('techSectionName', e.target.value)} />
          </label>
        </div>
      </section>

      <section class="settings-block">
        <h2>Section order</h2>
        <p class="muted">Top to bottom is the order the CV runs in.</p>
        <ol class="section-order">
          ${profile.sections.map((section, index) => html`
            <li key=${section.id}>
              <span>${sections.find((entry) => entry.id === section.id)?.heading ?? section.id}</span>
              <code>${section.id}</code>
              <span class="row">
                <button type="button" class="icon-button" aria-label="Move up" disabled=${index === 0} onClick=${() => moveSection(index, -1)}>
                  <${ArrowUp} size="0.9em" />
                </button>
                <button type="button" class="icon-button rotated" aria-label="Move down" disabled=${index === profile.sections.length - 1} onClick=${() => moveSection(index, 1)}>
                  <${ArrowUp} size="0.9em" />
                </button>
                <button type="button" class="icon-button" aria-label="Remove" onClick=${() => set('sections', profile.sections.filter((_, i) => i !== index))}>
                  <${Close} size="0.9em" />
                </button>
              </span>
            </li>
          `)}
        </ol>
        ${unusedSections.length > 0
          ? html`
              <div class="row wrap">
                ${unusedSections.map((section) => html`
                  <button key=${section.id} type="button" class="button small" onClick=${() => set('sections', [...profile.sections, { id: section.id }])}>
                    <${Plus} size="0.85em" /> ${section.heading}
                  </button>
                `)}
              </div>
            `
          : null}
      </section>

      <section class="settings-block">
        <h2>Which records it may draw on</h2>
        <p class="muted">
          <code>*</code> means every record, whatever it is tagged with — which is how the shipped
          profiles work. Narrow it only when a profile should deliberately leave part of your
          record out.
        </p>
        <div class="tag-picker">
          ${['*', ...evidenceTags].map((tag) => html`
            <label key=${tag} class=${(profile.evidenceProfiles ?? []).includes(tag) ? 'tag-choice chosen' : 'tag-choice'}>
              <input
                type="checkbox"
                checked=${(profile.evidenceProfiles ?? []).includes(tag)}
                onChange=${() => {
                  const has = (profile.evidenceProfiles ?? []).includes(tag);
                  set('evidenceProfiles', has
                    ? profile.evidenceProfiles.filter((entry) => entry !== tag)
                    : [...(profile.evidenceProfiles ?? []), tag]);
                }}
              />
              ${tag === '*' ? 'everything' : tag}
            </label>
          `)}
        </div>
      </section>

      <section class="settings-block">
        <h2>The prompt</h2>
        <p class="muted">
          Given verbatim to the model that writes the document. Plain English — edit it if the
          tone is off, or if there is something this shape always needs said.
        </p>
        <textarea
          class="raw-editor"
          value=${state.prompt}
          onInput=${(e) => { setState({ ...state, prompt: e.target.value }); setSaved(false); }}
        ></textarea>
      </section>

      <section class="settings-block danger-zone">
        ${confirming
          ? html`
              <p>
                Delete <strong>${profile.id}</strong>? Jobs already assigned to it will fall back to
                the catch-all profile.
                <button type="button" class="link-button danger" onClick=${async () => {
                  try { await api.deleteCvProfile(id); onChanged?.(); navigate('/profiles'); } catch (err) { setError(err); }
                }}>Yes, delete it</button>
                <button type="button" class="link-button" onClick=${() => setConfirming(false)}>Cancel</button>
              </p>
            `
          : html`<button type="button" class="link-button danger" onClick=${() => setConfirming(true)}>Delete this profile</button>`}
      </section>
    </div>
  `;
}

export default CvProfiles;
