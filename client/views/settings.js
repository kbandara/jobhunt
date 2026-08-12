// WHY: everything on this screen used to be a JSON file you edited by hand and a
// server you then restarted. Two of them are load-bearing in a way that is not
// obvious from looking at them, and both are here with the reason attached:
//
// - The QUALIFICATIONS block is the honesty checker's ground truth. A degree
//   recorded as `awarded: false` cannot be claimed by a generated document —
//   the check reads the boolean, never the prose of your profile, which is the
//   whole reason the sentence "has NOT been submitted" can no longer be read by
//   a model as permission to write "submitted".
// - The WORK RIGHTS lines are assembled in code and then checked byte-for-byte
//   against the finished document. A model is never asked to phrase them.
import { html, useState, useEffect } from '../vendor/ui.js';
import { api } from '../api.js';
import { Notice, ErrorBanner } from './notice.js';
import { Plus, Close, Check, Working } from './icons.js';
import { Field } from './welcome.js';

const LINK_KINDS = ['github', 'linkedin', 'scholar', 'orcid', 'website'];
const CAREER_LEVELS = [
  ['', 'Not stated'],
  ['early-career', 'Early career'],
  ['mid-career', 'Mid career'],
  ['senior', 'Senior'],
];

export function Settings({ meta: appMeta, onChanged }) {
  const [meta, setMeta] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.profileMeta().then((result) => setMeta(normalise(result.meta))).catch(setError);
  }, []);

  if (!meta) return html`<p class="muted"><${Working} /> Loading…</p>`;

  const set = (field, value) => { setMeta({ ...meta, [field]: value }); setSaved(false); };
  const setIn = (field, key, value) => set(field, { ...meta[field], [key]: value });

  const save = async () => {
    try {
      await api.saveProfileMeta(meta);
      setSaved(true);
      setError(null);
      onChanged?.();
    } catch (err) {
      setError(err);
    }
  };

  return html`
    <div class="settings">
      <header class="page-head">
        <div>
          <h1>Settings</h1>
          <p class="muted">
            Facts about you that the app uses as code and never asks a model for. Stored in
            <code>data/profile/profile-meta.json</code>.
          </p>
        </div>
        <div class="row">
          ${saved ? html`<span class="saved-tick"><${Check} size="1em" /> Saved</span>` : null}
          <button type="button" class="button primary" onClick=${save}>Save</button>
        </div>
      </header>

      <${ErrorBanner} error=${error} />

      <section class="settings-block">
        <h2>Contact details</h2>
        <p class="muted">Assembled into the block at the top of every document.</p>
        <div class="field-grid">
          <${Field} label="Full name" value=${meta.name} onInput=${(e) => set('name', e.target.value)} />
          <${Field} label="Preferred name" value=${meta.preferred} onInput=${(e) => set('preferred', e.target.value)} />
          <${Field} label="Email" type="email" value=${meta.email} onInput=${(e) => set('email', e.target.value)} />
          <${Field} label="Phone" value=${meta.phone} onInput=${(e) => set('phone', e.target.value)} />
          <${Field} label="Where you are" value=${meta.city} onInput=${(e) => set('city', e.target.value)} />
          <${Field}
            label="Surname, if it is not the last word of your name"
            value=${meta.surname ?? ''}
            onInput=${(e) => set('surname', e.target.value)}
            hint="Used to spot which papers you are first author on."
          />
        </div>
      </section>

      <section class="settings-block">
        <h2>Links</h2>
        <p class="muted">
          The label is what prints, so it has to be something that works if somebody types it off a
          printed page. A prettier label that 404s is worse than a long one that resolves.
        </p>
        <${LinkEditor} links=${meta.links} onChange=${(links) => set('links', links)} />
      </section>

      <section class="settings-block">
        <h2>Work rights</h2>
        <p class="muted">
          The location line under your contact details. Every part is optional — leave it all blank
          and the line is just your city; leave the city blank too and there is no line at all. It
          is written in code and then checked against the finished document, so it can never be
          paraphrased into something you did not say.
        </p>
        <div class="field-grid">
          <${Field}
            label="Citizenship"
            value=${meta.citizenship}
            onInput=${(e) => set('citizenship', e.target.value)}
            hint='e.g. "Australian" — becomes "Australian citizen" unless you write the whole phrase below.'
          />
          <${Field}
            label="How to state it"
            value=${meta.workRights.statement}
            onInput=${(e) => setIn('workRights', 'statement', e.target.value)}
            hint='Overrides the line above. For anything that is not plain citizenship: "EU citizen, UK settled status".'
          />
          <${Field}
            label="Your country code"
            value=${meta.workRights.homeCountry ?? ''}
            onInput=${(e) => setIn('workRights', 'homeCountry', e.target.value.toUpperCase())}
            hint="Two letters, e.g. AU. A job in this country gets no relocation clause."
          />
          <${Field}
            label="If the job is elsewhere"
            value=${meta.workRights.relocation}
            onInput=${(e) => setIn('workRights', 'relocation', e.target.value)}
            hint='e.g. "open to relocation". Blank to say nothing.'
          />
          <${Field}
            label="If the job is remote"
            value=${meta.workRights.remote ?? meta.workRights.remoteNote ?? ''}
            onInput=${(e) => setIn('workRights', 'remote', e.target.value)}
            hint='e.g. "no sponsorship required for remote engagement". No visa question arises, so nothing about relocation is said.'
          />
        </div>
        <${CountryRights} byCountry=${meta.workRights.byCountry ?? {}} onChange=${(next) => setIn('workRights', 'byCountry', next)} />
        <label class="field checkbox">
          <input
            type="checkbox"
            checked=${meta.timezoneOverlapClaims === true}
            onChange=${(e) => set('timezoneOverlapClaims', e.target.checked)}
          />
          <span>
            Let documents claim working-hours overlap with the employer's timezone
            <span class="field-hint">Off by default: if you would relocate, advertising your current hours anchors the reader in the wrong place.</span>
          </span>
        </label>
      </section>

      <section class="settings-block">
        <h2>Qualifications</h2>
        <p class="muted">
          <strong>This is the honesty checker's ground truth.</strong> A qualification recorded here
          as not awarded cannot be claimed by any generated document — the check reads these
          boxes, not the words in your profile. If your degree is in progress, record it here and
          the rest takes care of itself.
        </p>
        <${Qualifications} value=${meta.qualifications} onChange=${(next) => set('qualifications', next)} />
      </section>

      <section class="settings-block">
        <h2>How to pitch you</h2>
        <div class="field-grid">
          <label class="field">
            <span class="field-label">Career level</span>
            <select class="input" value=${meta.careerLevel ?? ''} onChange=${(e) => set('careerLevel', e.target.value)}>
              ${CAREER_LEVELS.map(([value, label]) => html`<option key=${value} value=${value}>${label}</option>`)}
            </select>
            <span class="field-hint">Stops a model calling you a student, or an executive.</span>
          </label>
          <${Field}
            label="One-line description of you"
            value=${meta.headline ?? ''}
            onInput=${(e) => set('headline', e.target.value)}
            hint='e.g. "freshwater ecologist finishing a PhD". Used when a model needs to know who it is writing for.'
          />
        </div>
        <label class="field checkbox">
          <input type="checkbox" checked=${meta.careerTransition === true} onChange=${(e) => set('careerTransition', e.target.checked)} />
          <span>
            I am changing field
            <span class="field-hint">Tells the scorer not to charge you twice for looking imperfect against an ad written for somebody already doing the job.</span>
          </span>
        </label>
        <label class="field">
          <span class="field-label">Anything else the writer should know</span>
          <textarea class="input" rows="3" value=${meta.positioning ?? ''} onInput=${(e) => set('positioning', e.target.value)}></textarea>
        </label>
      </section>

      <section class="settings-block">
        <h2>Evidence tags</h2>
        <p class="muted">
          Your own vocabulary for what a record is evidence <em>for</em>. Records tag themselves
          with these; a CV profile says which it may draw from.
        </p>
        <${TagEditor} tags=${meta.evidenceTags ?? []} inUse=${appMeta?.evidenceTags ?? []} onChange=${(next) => set('evidenceTags', next)} />
      </section>

      <${IntegrityBlock} />

      <${ProviderBlock} meta=${appMeta} onChanged=${onChanged} />

      <div class="row save-row">
        <button type="button" class="button primary" onClick=${save}>Save settings</button>
        ${saved ? html`<span class="saved-tick"><${Check} size="1em" /> Saved</span>` : null}
      </div>
    </div>
  `;
}

function normalise(meta) {
  return {
    links: [],
    qualifications: {},
    evidenceTags: [],
    ...meta,
    workRights: {
      home: '',
      statement: '',
      relocation: '',
      remote: '',
      homeCountry: '',
      byCountry: {},
      ...(meta?.workRights ?? {}),
    },
  };
}

function LinkEditor({ links, onChange }) {
  const set = (index, field, value) =>
    onChange(links.map((link, i) => (i === index ? { ...link, [field]: value } : link)));
  return html`
    <ul class="link-list">
      ${links.map((link, index) => html`
        <li key=${index} class="link-row">
          <select class="input narrow" value=${link.kind} onChange=${(e) => set(index, 'kind', e.target.value)}>
            ${LINK_KINDS.map((kind) => html`<option key=${kind} value=${kind}>${kind}</option>`)}
          </select>
          <input class="input" placeholder="github.com/you" value=${link.label ?? ''} onInput=${(e) => set(index, 'label', e.target.value)} />
          <input class="input" placeholder="https://github.com/you" value=${link.url ?? ''} onInput=${(e) => set(index, 'url', e.target.value)} />
          <button type="button" class="icon-button" aria-label="Remove" onClick=${() => onChange(links.filter((_, i) => i !== index))}>
            <${Close} size="1em" />
          </button>
        </li>
      `)}
    </ul>
    <button type="button" class="link-button" onClick=${() => onChange([...links, { kind: 'website', label: '', url: '' }])}>
      <${Plus} size="0.9em" /> Add a link
    </button>
  `;
}

/**
 * The per-country table, and the highest-stakes control on this screen.
 *
 * WHY IT IS WORTH THE ROOM: an employer advertising in the US reads "open to
 * relocation" as "will need sponsorship" and stops. An Australian applying there
 * is eligible for the E-3, which is not an H-1B, has no lottery, and costs them a
 * one-page filing. That sentence in the header is the difference between being
 * read and being filtered — and it can only be said if the table holds a
 * different line per country.
 *
 * The warning is not boilerplate. Every phrase here prints verbatim as your own
 * claim about your right to work somewhere, the schemes have age limits and
 * change, and the app checks none of it.
 */
function CountryRights({ byCountry, onChange }) {
  const entries = Object.entries(byCountry).filter(([code]) => !code.startsWith('_'));

  const setEntry = (code, field, value) =>
    onChange({ ...byCountry, [code]: { ...normaliseEntry(byCountry[code]), [field]: value } });

  const rename = (from, to) =>
    onChange(
      Object.fromEntries(
        entries.map(([code, entry]) => (code === from ? [to.toUpperCase(), entry] : [code, entry])),
      ),
    );

  return html`
    <div class="country-rights">
      <span class="field-label">The visa route, per country</span>
      <${Notice} kind="warning" live=${false}>
        <strong>Read every line here before you send anything.</strong> Each one prints on your CV
        word for word, as your own statement about your right to work somewhere. Schemes have age
        limits, they change, and this app checks none of them — so delete any route you are not
        actually eligible for and willing to use. A country with no entry gets your general
        relocation phrase, which is the safe default.
      <//>

      <ul class="link-list">
        ${entries.map(([code, raw]) => {
          const entry = normaliseEntry(raw);
          return html`
            <li key=${code} class="country-row">
              <div class="row wrap">
                <input
                  class="input narrow"
                  placeholder="US"
                  maxlength="2"
                  value=${code}
                  onChange=${(e) => rename(code, e.target.value)}
                />
                <button type="button" class="icon-button" aria-label=${`Remove ${code}`} onClick=${() => {
                  const next = { ...byCountry };
                  delete next[code];
                  onChange(next);
                }}><${Close} size="1em" /></button>
              </div>
              <${Field}
                label="Visa route"
                value=${entry.visa}
                placeholder="eligible for the E-3 visa (no lottery; the employer files a one-page LCA)"
                onInput=${(e) => setEntry(code, 'visa', e.target.value)}
                hint="Appended after your citizenship. Leave blank for the country you already live in."
              />
              <${Field}
                label="Instead of your usual relocation phrase"
                value=${entry.relocation}
                placeholder="relocating to London"
                onInput=${(e) => setEntry(code, 'relocation', e.target.value)}
              />
              <${Field}
                label="Or replace the whole line"
                value=${entry.line}
                onInput=${(e) => setEntry(code, 'line', e.target.value)}
                hint="An escape hatch, for when the wording above comes out awkwardly. Printed exactly as typed."
              />
            </li>
          `;
        })}
      </ul>
      <${AddCountry} existing=${entries.map(([code]) => code)} onAdd=${(code) => onChange({ ...byCountry, [code]: {} })} />
    </div>
  `;
}

/** An older profile wrote a plain string here; both shapes are read. */
function normaliseEntry(entry) {
  if (typeof entry === 'string') return { visa: entry, relocation: '', line: '' };
  return { visa: '', relocation: '', line: '', ...(entry ?? {}) };
}

function AddCountry({ existing, onAdd }) {
  const [code, setCode] = useState('');
  const clean = code.trim().toUpperCase();
  return html`
    <div class="row">
      <input class="input narrow" placeholder="US" maxlength="2" value=${code} onInput=${(e) => setCode(e.target.value)} />
      <button
        type="button"
        class="button"
        disabled=${clean.length !== 2 || existing.includes(clean)}
        onClick=${() => { onAdd(clean); setCode(''); }}
      ><${Plus} size="0.9em" /> Add a country</button>
    </div>
  `;
}

function Qualifications({ value, onChange }) {
  const entries = Object.entries(value ?? {});
  const set = (key, field, next) => onChange({ ...value, [key]: { ...value[key], [field]: next } });

  return html`
    <div class="qualifications">
      ${entries.length === 0 ? html`<p class="muted empty">None recorded. Add one if a degree of yours is still in progress.</p>` : null}
      ${entries.map(([key, entry]) => html`
        <div key=${key} class="qualification">
          <div class="field-grid">
            <${Field} label="Key" value=${key} readonly hint='Use "phd" for a doctorate — it also blocks the title "Dr".' />
            <${Field} label="What it is called" value=${entry.label ?? ''} onInput=${(e) => set(key, 'label', e.target.value)} placeholder="PhD" />
            <${Field}
              label="Expected submission"
              value=${entry.expectedSubmission ?? ''}
              onInput=${(e) => set(key, 'expectedSubmission', e.target.value)}
              placeholder="2027-03"
            />
          </div>
          <div class="row wrap">
            <label class="field checkbox inline">
              <input type="checkbox" checked=${entry.submitted === true} onChange=${(e) => set(key, 'submitted', e.target.checked)} />
              <span>Submitted</span>
            </label>
            <label class="field checkbox inline">
              <input type="checkbox" checked=${entry.awarded === true} onChange=${(e) => set(key, 'awarded', e.target.checked)} />
              <span>Awarded</span>
            </label>
            <button type="button" class="link-button danger" onClick=${() => {
              const next = { ...value };
              delete next[key];
              onChange(next);
            }}>Remove</button>
          </div>
          <label class="field">
            <span class="field-label">The only ways it may be written</span>
            <input
              class="input"
              value=${(entry.allowedForms ?? []).join(' | ')}
              placeholder="PhD candidate | PhD, expected submission March 2027"
              onInput=${(e) => set(key, 'allowedForms', e.target.value.split('|').map((form) => form.trim()).filter(Boolean))}
            />
            <span class="field-hint">Separated by |. These are offered to the model as the permitted wording, and named in the error when it strays.</span>
          </label>
        </div>
      `)}
      <${AddQualification} existing=${entries.map(([key]) => key)} onAdd=${(key) => onChange({
        ...value,
        [key]: { label: key === 'phd' ? 'PhD' : key, status: 'in_progress', submitted: false, awarded: false, allowedForms: [] },
      })} />
    </div>
  `;
}

function AddQualification({ existing, onAdd }) {
  const [key, setKey] = useState('');
  const clean = key.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return html`
    <div class="row">
      <input class="input narrow" placeholder="phd" value=${key} onInput=${(e) => setKey(e.target.value)} />
      <button
        type="button"
        class="button"
        disabled=${clean === '' || existing.includes(clean)}
        onClick=${() => { onAdd(clean); setKey(''); }}
      ><${Plus} size="0.9em" /> Add a qualification</button>
    </div>
  `;
}

function TagEditor({ tags, inUse, onChange }) {
  const [adding, setAdding] = useState('');
  const orphaned = inUse.filter((tag) => !tags.includes(tag));
  return html`
    <div class="tag-picker editable">
      ${tags.map((tag) => html`
        <span key=${tag} class="tag-choice chosen">
          ${tag}
          <button type="button" class="icon-button tiny" aria-label=${`Remove ${tag}`} onClick=${() => onChange(tags.filter((entry) => entry !== tag))}>
            <${Close} size="0.8em" />
          </button>
        </span>
      `)}
    </div>
    <div class="row">
      <input class="input narrow" placeholder="consulting" value=${adding} onInput=${(e) => setAdding(e.target.value)} />
      <button type="button" class="button" disabled=${adding.trim() === ''} onClick=${() => { onChange([...tags, adding.trim()]); setAdding(''); }}>
        <${Plus} size="0.9em" /> Add
      </button>
    </div>
    ${orphaned.length > 0
      ? html`
          <${Notice} kind="warning">
            Some records use tags that are not on this list: ${orphaned.join(', ')}. They still
            work, but adding them here means the app can catch a typo in one.
          <//>
        `
      : null}
  `;
}

/**
 * The constraints that cannot be derived. The derived ones are shown read-only
 * beside them, because "what is the model actually being told about me" is a
 * question this app should always be able to answer with the text itself.
 */
function IntegrityBlock() {
  const [state, setState] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api.integrity().then(setState).catch(setError); }, []);
  if (!state) return null;

  return html`
    <section class="settings-block">
      <h2>Integrity constraints</h2>
      <p class="muted">
        Sent with every generation. Most of it is built from what you filled in above; this box is
        for the rest — a project that must never be called a startup, a collaborator you may not
        name, a figure that is not releasable.
      </p>
      <textarea
        class="input"
        rows="5"
        value=${state.text}
        placeholder="- The evaluation platform is research, not a product. Never describe it as having customers or revenue."
        onInput=${(e) => { setState({ ...state, text: e.target.value }); setSaved(false); }}
      ></textarea>
      <div class="row">
        <button type="button" class="button" onClick=${async () => {
          try { await api.saveIntegrity(state.text); setSaved(true); } catch (err) { setError(err); }
        }}>Save constraints</button>
        ${saved ? html`<span class="saved-tick"><${Check} size="1em" /> Saved</span>` : null}
      </div>
      <details class="derived">
        <summary>What is being sent right now</summary>
        <pre class="notice-detail">${state.derived}${state.text ? `\n${state.text}` : ''}</pre>
      </details>
      <${ErrorBanner} error=${error} />
    </section>
  `;
}

function ProviderBlock({ meta, onChanged }) {
  const [provider, setProvider] = useState(meta?.provider ?? 'gemini');
  const [key, setKey] = useState('');
  const [tested, setTested] = useState(null);
  const [error, setError] = useState(null);

  return html`
    <section class="settings-block">
      <h2>Model provider</h2>
      <p class="muted">
        Written to <code>.env</code>. Currently ${meta?.provider ?? 'unset'}, and a key
        ${' '}${meta?.keyPresent ? 'is saved' : 'is not saved'}.
      </p>
      <div class="field-grid">
        <label class="field">
          <span class="field-label">Provider</span>
          <select class="input" value=${provider} onChange=${(e) => setProvider(e.target.value)}>
            <option value="gemini">Google Gemini (free tier)</option>
            <option value="anthropic">Anthropic Claude (paid)</option>
          </select>
        </label>
        <${Field}
          label="API key"
          type="password"
          value=${key}
          onInput=${(e) => setKey(e.target.value)}
          placeholder=${meta?.keyPresent ? 'leave blank to keep the saved one' : 'paste your key'}
          hint="Never displayed back to you."
        />
      </div>
      <div class="row">
        <button type="button" class="button" onClick=${async () => {
          try { await api.saveProvider(provider, key); setKey(''); setError(null); onChanged?.(); } catch (err) { setError(err); }
        }}>Save provider</button>
        <button type="button" class="button" onClick=${async () => {
          try { setTested(await api.testKey()); } catch (err) { setError(err); }
        }}>Test the key</button>
      </div>
      ${tested === null
        ? null
        : tested.ok
          ? html`<${Notice} kind="info">Works — answered on ${tested.model}.<//>`
          : html`<${Notice} kind="error"><strong>Rejected.</strong><pre class="notice-detail">${tested.error}</pre><//>`}
      <${ErrorBanner} error=${error} />
    </section>
  `;
}

export default Settings;
