// WHY: the master profile was a markdown file you edited by hand, in a format
// documented in a README, with the app's only feedback being a red banner naming
// a line number. That is a fine way to work once you know the format and an
// impossible one before you do — and it is the step everything else waits on.
//
// So: a form per record, with the format's rules turned into fields and hints.
// The file is still the store, still hand-editable, and still watched — this
// writes the same markdown, one record at a time, leaving the rest of the file
// alone. The raw tab is not a fallback for a missing feature; it is the thing to
// use when the file will not parse, which is exactly when forms cannot help.
import { html, useState, useEffect, useCallback, useMemo, useRef } from '../vendor/ui.js';
import { api } from '../api.js';
import { Notice, ErrorBanner } from './notice.js';
import { Plus, Close, Working, Check, ChevronDown, ChevronRight, Refresh, Read } from './icons.js';
import { ImportProfile } from './import-profile.js';
import { PolishProfile } from './polish-profile.js';

const KIND_LABELS = {
  education: 'Education',
  project: 'Projects',
  finding: 'Findings',
  role: 'Roles',
  publication: 'Publications',
  skill: 'Skills',
  award: 'Awards',
  service: 'Service',
};

const KIND_HINTS = {
  education: 'Degrees and qualifications. One record each.',
  project: 'Things you built or ran that were not a job — side projects, open-source, a thesis chapter that became a tool.',
  finding: 'A single result worth stating on its own. Findings are what let a CV say what you found rather than only what you did.',
  role: 'Jobs, contracts, assistantships, internships.',
  publication: 'Papers, preprints and manuscripts. Write the body as a normal citation — the app parses it and renders APA in code, so a model can never alter a year or a venue.',
  skill: 'Grouped, not one per skill: "Statistics and modelling", "Programming and data".',
  award: 'Prizes, scholarships, competitive funding.',
  service: 'Reviewing, committees, mentoring, outreach.',
};

const BLANK = {
  id: '',
  kind: 'role',
  title: '',
  org: '',
  dates: { start: '', end: '' },
  evidenceProfiles: [],
  tags: [],
  location: '',
  body: '',
};

export function ProfileEditor({ onChanged }) {
  const [tab, setTab] = useState('records');
  // Set by the whole-file editor while it holds unsaved text. Switching tabs
  // unmounts it and drops what was typed, and beforeunload does not fire for
  // that — so the tab list has to ask before it does.
  const [unsaved, setUnsaved] = useState(false);
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(null); // {record, originalId|null}
  const [tool, setTool] = useState(null); // 'import' | 'polish'
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.records().then(setState).catch(setError);
  }, []);

  useEffect(load, [load]);

  const afterWrite = () => {
    setEditing(null);
    load();
    onChanged?.();
  };


  if (!state) return html`<p class="muted"><${Working} /> Loading your profile…</p>`;

  const byKind = new Map();
  for (const kind of state.kinds) byKind.set(kind, []);
  for (const record of state.records) {
    if (!byKind.has(record.kind)) byKind.set(record.kind, []);
    byKind.get(record.kind).push(record);
  }

  return html`
    <div class="profile-editor">
      <header class="page-head">
        <div>
          <h1>Your profile</h1>
          <p class="muted">
            ${state.records.length} records. Everything generated cites this file, and a claim that
            is not in it cannot appear on a CV.
          </p>
        </div>
        <div class="row wrap">
          <button type="button" class="button" onClick=${() => setTool('import')}>
            <${Read} size="1em" /> Import from a CV
          </button>
          <button
            type="button"
            class="button"
            disabled=${state.records.length === 0}
            title=${state.records.length === 0 ? 'Nothing to tighten yet' : 'Same facts, better sentences'}
            onClick=${() => setTool('polish')}
          >
            <${Refresh} size="1em" /> Tighten the wording
          </button>
          <button type="button" class="button primary" onClick=${() => setEditing({ record: { ...BLANK }, originalId: null })}>
            <${Plus} size="1em" /> Add a record
          </button>
        </div>
      </header>

      ${state.profileError
        ? html`
            <${Notice} kind="error">
              <strong>Your profile currently does not parse, so your latest edit is not being used.</strong>
              Everything below is the last version that worked. Fix the line named here — the
              <button type="button" class="link-button" onClick=${() => setTab('raw')}>The whole file</button>
              is the place to do it.
              <pre class="notice-detail">${state.profileError}</pre>
            <//>
          `
        : null}

      <${ErrorBanner} error=${error} />

      <nav class="tabs" role="tablist" aria-label="Profile sections">
        ${[['records', 'Records'], ['publications', 'Publications'], ['raw', 'The whole file']].map(
          ([id, label]) => html`
            <button
              key=${id}
              type="button"
              class=${tab === id ? 'tab active' : 'tab'}
              role="tab"
              aria-selected=${tab === id}
              onClick=${() => {
                if (id === tab) return;
                if (
                  unsaved &&
                  // eslint-disable-next-line no-alert
                  !window.confirm('You have unsaved changes to the file. Leave this tab and lose them?')
                ) {
                  return;
                }
                setUnsaved(false);
                setTab(id);
              }}
            >${label}${id === 'raw' && unsaved ? html`<span class="tab-dot" title="unsaved changes"></span>` : null}</button>
          `,
        )}
      </nav>

      ${tab === 'records'
        ? html`
            <${RecordList}
              byKind=${byKind}
              startOpen=${state.records.length === 0}
              onEdit=${(record) => setEditing({ record, originalId: record.id })}
              onAdd=${(kind) => setEditing({ record: { ...BLANK, kind }, originalId: null })}
              onDeleted=${afterWrite}
            />
          `
        : null}
      ${tab === 'publications' ? html`<${Publications} records=${state.records} onEdit=${(record) => setEditing({ record, originalId: record.id })} />` : null}
      ${tab === 'raw' ? html`<${RawEditor} onSaved=${afterWrite} onDirty=${setUnsaved} />` : null}

      ${tool === 'import'
        ? html`<${ImportProfile} onClose=${() => setTool(null)} onImported=${afterWrite} />`
        : null}
      ${tool === 'polish'
        ? html`<${PolishProfile} onClose=${() => setTool(null)} onApplied=${afterWrite} />`
        : null}

      ${editing
        ? html`
            <${RecordForm}
              record=${editing.record}
              originalId=${editing.originalId}
              tags=${state.evidenceTags}
              kinds=${state.kinds}
              onClose=${() => setEditing(null)}
              onSaved=${afterWrite}
            />
          `
        : null}
    </div>
  `;
}

function RecordList({ byKind, startOpen, onEdit, onAdd, onDeleted }) {
  return html`
    <div class="record-groups">
      ${[...byKind.entries()].map(([kind, records]) => html`
        <${KindGroup}
          key=${kind}
          kind=${kind}
          records=${records}
          startOpen=${startOpen}
          onEdit=${onEdit}
          onAdd=${onAdd}
          onDeleted=${onDeleted}
        />
      `)}
    </div>
  `;
}

/**
 * Collapsed when it has records — there are eight of these and an expanded list
 * of everything is a wall. Open when the whole profile is empty, because on a
 * first visit the collapsed version is eight identical rows that explain
 * nothing about what goes in them.
 */
function KindGroup({ kind, records, startOpen, onEdit, onAdd, onDeleted }) {
  const [open, setOpen] = useState(startOpen || records.length > 0);
  return html`
    <section class="record-group">
      <h2>
        <button type="button" class="group-toggle" aria-expanded=${open} onClick=${() => setOpen(!open)}>
          ${open ? html`<${ChevronDown} size="1em" />` : html`<${ChevronRight} size="1em" />`}
          ${KIND_LABELS[kind] ?? kind}
          <span class="count">${records.length}</span>
        </button>
      </h2>
      ${open
        ? html`
            <p class="group-hint">${KIND_HINTS[kind]}</p>
            ${records.length === 0
              ? html`<p class="muted empty">Nothing here yet.</p>`
              : html`
                  <ul class="record-list">
                    ${records.map((record) => html`
                      <${RecordRow} key=${record.id} record=${record} onEdit=${onEdit} onDeleted=${onDeleted} />
                    `)}
                  </ul>
                `}
            <button type="button" class="link-button" onClick=${() => onAdd(kind)}>
              <${Plus} size="0.9em" /> Add ${(KIND_LABELS[kind] ?? kind).toLowerCase().replace(/s$/, '')}
            </button>
          `
        : null}
    </section>
  `;
}

function RecordRow({ record, onEdit, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  const remove = async () => {
    try {
      await api.deleteRecord(record.id);
      onDeleted();
    } catch (err) {
      setError(err);
      setConfirming(false);
    }
  };

  return html`
    <li class="record-row">
      <button type="button" class="record-main" onClick=${() => onEdit(record)}>
        <span class="record-title">
          ${record.title}${record.org ? html` <span class="muted">— ${record.org}</span>` : null}
        </span>
        <span class="record-meta">
          <code>${record.id}</code>
          ${dateLabel(record.dates)}
          ${(record.evidenceProfiles ?? []).map((tag) => html`<span key=${tag} class="tag">${tag}</span>`)}
          ${record.isGap ? html`<span class="pill warn">FILL:</span>` : null}
        </span>
      </button>
      ${confirming
        ? html`
            <span class="confirm">
              Delete it?
              <button type="button" class="link-button danger" onClick=${remove}>Yes</button>
              <button type="button" class="link-button" onClick=${() => setConfirming(false)}>No</button>
            </span>
          `
        : html`<button type="button" class="icon-button" title="Delete" onClick=${() => setConfirming(true)}><${Close} size="1em" /></button>`}
      ${error ? html`<span class="hint error">${error.message}</span>` : null}
    </li>
  `;
}

function dateLabel(dates) {
  const start = dates?.start ?? '';
  const end = dates?.end ?? '';
  if (!start) return '';
  if (!end) return `${start} – now`;
  if (start === end) return start;
  return `${start} – ${end}`;
}

/**
 * The publications tab exists because a citation is the one thing on a CV a
 * reader can check in ten seconds, and a citation that failed to parse is
 * otherwise invisible — it renders as something half-right rather than as an
 * error. So each is shown exactly as it will print, with anything unreadable
 * said out loud.
 */
function Publications({ records, onEdit }) {
  const pubs = useMemo(() => records.filter((record) => record.kind === 'publication'), [records]);
  if (pubs.length === 0) {
    return html`
      <p class="muted empty">
        No publications yet. Add them under Records → Publications; write the body as an ordinary
        citation and the app will render it.
      </p>
    `;
  }
  return html`
    <p class="muted">
      Rendered in APA from your records, in code. The model is shown these so it can refer to the
      work in prose, and anything it writes under a publications heading is discarded — which is
      why a year or a venue can never drift.
    </p>
    <ul class="citation-list">
      ${pubs.map((record) => html`
        <li key=${record.id} class=${record.citation?.problems?.length ? 'citation has-problem' : 'citation'}>
          <button type="button" class="citation-main" onClick=${() => onEdit(record)}>
            <span class="citation-apa" dangerouslySetInnerHTML=${{ __html: emphasise(record.citation?.apa ?? '') }}></span>
            <span class="record-meta">
              <span class="pill">${record.citation?.status ?? 'unknown'}</span>
              <code>${record.id}</code>
            </span>
          </button>
          ${(record.citation?.problems ?? []).map((problem) => html`
            <p key=${problem} class="hint error">This one could not be read cleanly: ${problem}</p>
          `)}
        </li>
      `)}
    </ul>
  `;
}

/** The APA renderer marks italics with *asterisks*; nothing else is interpreted. */
function emphasise(text) {
  const escaped = String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * The master profile as one file, editable here rather than in a text editor.
 *
 * This tab existed as a bare textarea and was called "Markdown", and somebody
 * looking for their master file went to File Explorer instead — so it is now
 * called what it is, and it behaves like somewhere you would willingly work on a
 * five-hundred-line file.
 *
 * What it does NOT do is become a code editor. No syntax highlighting, no
 * autocomplete, no dependency (D010). A gutter of line numbers and a jump list
 * are the two things a long structured file actually needs, and both are twenty
 * lines of plain DOM.
 */
function RawEditor({ onSaved, onDirty }) {
  const [text, setText] = useState(null);
  const [saved, setSaved] = useState('');   // the text as it is on disk
  const [path, setPath] = useState('');
  const [problems, setProblems] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const gutter = useRef(null);

  useEffect(() => {
    api
      .rawProfile()
      .then((result) => {
        setText(result.text);
        setSaved(result.text);
        setPath(result.path);
      })
      .catch(setError);
  }, []);

  const dirty = text !== null && text !== saved;

  // Told to the tab list, which is the only thing that can stop a click from
  // unmounting this and dropping the text.
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);

  // The browser's own "leave this page?" prompt. Crude, and the only thing that
  // works for a tab close or a back button — losing an afternoon of typing to a
  // reflex is the one failure this app cannot have.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(
    async (force) => {
      setBusy(true);
      setProblems(null);
      setError(null);
      try {
        const current = box.current?.value ?? text;
        await api.saveRawProfile(current, force);
        setSaved(current);
        setJustSaved(true);
        onSaved();
      } catch (err) {
        if (err.status === 400 && Array.isArray(err.problems)) setProblems(err.problems);
        else setError(err);
      } finally {
        setBusy(false);
      }
    },
    [text, onSaved],
  );

  // Ctrl+S / Cmd+S, because anybody editing a file in a box reaches for it.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (dirty && !busy) save(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, busy, save]);

  if (text === null) return html`<p class="muted"><${Working} /> Opening the file…</p>`;

  const lines = text.split('\n');

  /** Put the caret on a line and scroll it into the middle of the box. */
  const goToLine = (line) => {
    const area = box.current;
    if (!area) return;
    const upto = lines.slice(0, Math.max(0, line - 1)).join('\n').length + (line > 1 ? 1 : 0);
    area.focus();
    area.setSelectionRange(upto, upto);
    // Rough but reliable: line height times line number, minus a third of the
    // visible height so the line lands where the eye already is.
    const lineHeight = area.scrollHeight / Math.max(1, lines.length);
    area.scrollTop = Math.max(0, lineHeight * (line - 1) - area.clientHeight / 3);
    syncGutter();
  };

  /** The gutter is a separate element, so it has to follow the textarea's scroll. */
  const syncGutter = () => {
    if (gutter.current && box.current) gutter.current.scrollTop = box.current.scrollTop;
  };

  const onKeyDown = (event) => {
    // Tab indents instead of leaving the box. Shift+Tab still escapes, so the
    // keyboard route through the page is not broken.
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const area = event.target;
      const { selectionStart: from, selectionEnd: to, value } = area;
      const next = `${value.slice(0, from)}  ${value.slice(to)}`;
      setText(next);
      requestAnimationFrame(() => area.setSelectionRange(from + 2, from + 2));
    }
  };

  return html`
    <p class="muted">
      Your whole profile, in one file, at <code>${path}</code>. Editing it here and editing it in a
      text editor are the same thing — the app watches the file either way, so you never have to
      choose.
    </p>

    <${Outline} lines=${lines} onGo=${goToLine} />

    <div class="raw-wrap">
      <pre class="raw-gutter" ref=${gutter} aria-hidden="true">${lines.map((_, i) => `${i + 1}\n`).join('')}</pre>
      <textarea
        class="raw-editor"
        ref=${box}
        spellcheck="false"
        wrap="off"
        value=${text}
        onScroll=${syncGutter}
        onKeyDown=${onKeyDown}
        onInput=${(event) => {
          setText(event.target.value);
          setJustSaved(false);
        }}
      ></textarea>
    </div>

    <div class="row raw-foot">
      <button type="button" class="button primary" disabled=${!dirty || busy} onClick=${() => save(false)}>
        ${busy ? html`<${Working} />` : null} ${dirty ? 'Save' : 'Saved'}
      </button>
      ${dirty
        ? html`<button type="button" class="link-button" onClick=${() => { setText(saved); setProblems(null); }}>
            Undo my changes
          </button>`
        : null}
      ${justSaved && !dirty ? html`<span class="saved-tick"><${Check} size="1em" /> Saved</span>` : null}
      <span class="raw-stat muted">
        <span class="num">${lines.length}</span> lines ·
        ${' '}<span class="num">${countRecords(lines)}</span> records
        ${dirty ? html` · <strong>unsaved</strong>` : null}
      </span>
      <span class="raw-hint muted">${'⌘'}/Ctrl+S saves</span>
    </div>

    ${problems
      ? html`
          <${Notice} kind="error">
            <strong>This would not parse, so nothing has been saved.</strong>
            <ul class="problem-list">
              ${problems.map(
                (problem) => html`
                  <li key=${problem}>
                    ${/* Every parse error starts "line 42: …", so the number is a
                         place to go rather than a number to hunt for. */ ''}
                    ${lineIn(problem)
                      ? html`<button type="button" class="link-button" onClick=${() => goToLine(lineIn(problem))}>
                          line ${lineIn(problem)}
                        </button> — ${problem.replace(/^line \d+:\s*/, '')}`
                      : problem}
                  </li>
                `,
              )}
            </ul>
            <button type="button" class="link-button" onClick=${() => save(true)}>Save it anyway</button>
            ${' '}— the app keeps using the last version that parsed until this is fixed, so nothing
            you have already generated breaks.
          <//>
        `
      : null}
    <${ErrorBanner} error=${error} />
  `;
}

/** The line number out of "line 42: something is wrong", or null. */
function lineIn(problem) {
  const match = /^line (\d+):/.exec(String(problem ?? ''));
  return match ? Number(match[1]) : null;
}

/** `### ` headings are records; the count is a useful thing to watch while editing. */
function countRecords(lines) {
  return lines.filter((line) => line.startsWith('### ')).length;
}

/**
 * A jump list of the file's own headings.
 *
 * Scrolling a five-hundred-line file to find one record is the thing that sends
 * people back to a text editor with a sidebar. Closed by default, because on a
 * short file it is noise.
 */
function Outline({ lines, onGo }) {
  const [open, setOpen] = useState(false);

  const headings = useMemo(
    () =>
      lines
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter((entry) => /^#{2,3} /.test(entry.text))
        .map((entry) => ({
          line: entry.line,
          depth: entry.text.startsWith('### ') ? 3 : 2,
          label: entry.text.replace(/^#+\s*/, ''),
        })),
    [lines],
  );

  if (headings.length === 0) return null;

  return html`
    <div class=${`disclosure outline ${open ? 'open' : ''}`}>
      <button class="disclosure-toggle" type="button" onClick=${() => setOpen(!open)} aria-expanded=${open}>
        <span class="disclosure-caret"><${ChevronRight} size="0.9em" /></span>
        <strong>Jump to</strong>
        <span class="disclosure-note muted">${headings.length} headings in this file</span>
      </button>
      ${open
        ? html`
            <div class="disclosure-body">
              <ul class="outline-list">
                ${headings.map(
                  (heading) => html`
                    <li key=${heading.line} class=${`outline-${heading.depth}`}>
                      <button type="button" class="link-button" onClick=${() => onGo(heading.line)}>
                        ${heading.label}
                      </button>
                      <span class="muted">line ${heading.line}</span>
                    </li>
                  `,
                )}
              </ul>
            </div>
          `
        : null}
    </div>
  `;
}

/**
 * One record. A dialog rather than an inline expansion because a record body is
 * a paragraph, and editing a paragraph inside a list makes everything below it
 * jump around while you type.
 */
function RecordForm({ record, originalId, tags, kinds, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({
    ...record,
    dates: { start: record.dates?.start ?? '', end: record.dates?.end ?? '' },
    evidenceProfiles: [...(record.evidenceProfiles ?? [])],
    tags: [...(record.tags ?? [])],
    location: record.location ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  // An id becomes part of a citation in generated documents, so it is suggested
  // rather than demanded — but only while adding, because changing the id of a
  // record a document already cites is a decision, not a side effect of typing.
  const suggestId = () => {
    if (originalId || draft.id) return;
    const slug = `${draft.kind}-${draft.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug.length > draft.kind.length + 1) set('id', slug.slice(0, 48));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (originalId) await api.saveRecord(originalId, draft);
      else await api.addRecord(draft);
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const toggleTag = (tag) => {
    const has = draft.evidenceProfiles.includes(tag);
    set('evidenceProfiles', has ? draft.evidenceProfiles.filter((entry) => entry !== tag) : [...draft.evidenceProfiles, tag]);
  };

  return html`
    <div class="modal-backdrop" onClick=${(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label=${originalId ? 'Edit record' : 'Add record'}>
        <header class="modal-head">
          <h2>${originalId ? 'Edit record' : 'Add a record'}</h2>
          <button type="button" class="icon-button" onClick=${onClose} aria-label="Close"><${Close} size="1.1em" /></button>
        </header>

        <div class="modal-body">
          <label class="field">
            <span class="field-label">What kind</span>
            <select class="input" value=${draft.kind} onChange=${(event) => set('kind', event.target.value)}>
              ${kinds.map((kind) => html`<option key=${kind} value=${kind}>${KIND_LABELS[kind] ?? kind}</option>`)}
            </select>
            <span class="field-hint">${KIND_HINTS[draft.kind]}</span>
          </label>

          <div class="field-grid">
            <label class="field">
              <span class="field-label">Title</span>
              <input class="input" value=${draft.title} onBlur=${suggestId} onInput=${(event) => set('title', event.target.value)} />
            </label>
            <label class="field">
              <span class="field-label">Organisation</span>
              <input class="input" value=${draft.org} onInput=${(event) => set('org', event.target.value)} />
            </label>
            <label class="field">
              <span class="field-label">From</span>
              <input class="input" placeholder="2023-01" value=${draft.dates.start} onInput=${(event) => set('dates', { ...draft.dates, start: event.target.value })} />
              <span class="field-hint">A year, or a year and month.</span>
            </label>
            <label class="field">
              <span class="field-label">To</span>
              <input class="input" placeholder="leave empty if current" value=${draft.dates.end} onInput=${(event) => set('dates', { ...draft.dates, end: event.target.value })} />
            </label>
          </div>

          <label class="field">
            <span class="field-label">Id</span>
            <input class="input mono" value=${draft.id} onInput=${(event) => set('id', event.target.value)} />
            <span class="field-hint">
              Unique, and cited by every document that draws on this record. Lower case with
              hyphens. ${originalId ? 'Changing it here renames the record.' : ''}
            </span>
          </label>

          <fieldset class="field">
            <legend class="field-label">What kind of job is this evidence for?</legend>
            <div class="tag-picker">
              ${tags.map((tag) => html`
                <label key=${tag} class=${draft.evidenceProfiles.includes(tag) ? 'tag-choice chosen' : 'tag-choice'}>
                  <input type="checkbox" checked=${draft.evidenceProfiles.includes(tag)} onChange=${() => toggleTag(tag)} />
                  ${tag}
                </label>
              `)}
            </div>
            <span class="field-hint">
              Your own labels — change them under <a href="#/settings">Settings</a>. A CV profile
              says which of these it may draw on; the ones this app ships draw on all of them.
            </span>
          </fieldset>

          <label class="field">
            <span class="field-label">Keywords</span>
            <input
              class="input"
              value=${draft.tags.join(', ')}
              placeholder="r, statistics, fieldwork"
              onInput=${(event) => set('tags', event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))}
            />
            <span class="field-hint">Comma separated. Used to match this record against a job ad.</span>
          </label>

          <label class="field">
            <span class="field-label">What it was, and what came of it</span>
            <textarea
              class="input body-input"
              rows="7"
              value=${draft.body}
              placeholder=${draft.kind === 'publication'
                ? 'Kimani, R., & Brooks, A. (2025). Title of the paper. Journal Name, 41(2), 118–133. doi.org/…'
                : 'What the work was, and the specific things that came out of it. Put your real numbers in — a figure in a generated bullet must appear in a record it cites, or it is flagged.'}
              onInput=${(event) => set('body', event.target.value)}
            ></textarea>
            ${draft.kind === 'publication'
              ? html`<span class="field-hint">Write it as an ordinary citation. The app parses the authors, year, venue and DOI out of it and renders APA itself.</span>`
              : null}
          </label>

          <${ErrorBanner} error=${error} />
        </div>

        <footer class="modal-foot">
          <button type="button" class="button" onClick=${onClose}>Cancel</button>
          <button type="button" class="button primary" disabled=${busy} onClick=${save}>
            ${busy ? html`<${Working} />` : null} ${originalId ? 'Save changes' : 'Add it'}
          </button>
        </footer>
      </div>
    </div>
  `;
}

export default ProfileEditor;
