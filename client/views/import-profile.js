// WHY: writing a master profile from nothing is forty minutes of typing out
// things you have already written down once, and it is the step everything else
// waits on. Almost everybody has a CV or a LinkedIn export, so: read that.
//
// The review step in the middle is not a formality and is not skippable. This is
// the one place in the app where a model writes something that then becomes
// evidence — every later check validates a document AGAINST these records, so a
// job that gets invented here is invisible from then on. Each proposed record is
// therefore shown beside the fragment of the document it came from, so checking
// it is a glance rather than a re-read, and nothing is written until you tick it.
import { html, useState, useRef } from '../vendor/ui.js';
import { api } from '../api.js';
import { Notice, ErrorBanner } from './notice.js';
import { Close, Check, Working, ArrowRight } from './icons.js';

const KIND_LABELS = {
  education: 'Education',
  project: 'Project',
  finding: 'Finding',
  role: 'Role',
  publication: 'Publication',
  skill: 'Skills',
  award: 'Award',
  service: 'Service',
};

/**
 * @param {object} props
 * @param {Function} props.onClose
 * @param {Function} props.onImported called once records have been written
 */
export function ImportProfile({ onClose, onImported }) {
  const [step, setStep] = useState('source'); // source -> review -> done
  const [text, setText] = useState('');
  const [notice, setNotice] = useState(null);
  const [drafted, setDrafted] = useState(null);
  const [keep, setKeep] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const fileInput = useRef(null);

  const readFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await base64Of(file);
      const read = await api.readDocument(file.name, data);
      setText(read.text ?? '');
      if (!read.readable || (read.warnings ?? []).length > 0) {
        setNotice({
          kind: read.readable ? 'warning' : 'error',
          lines: read.warnings ?? [],
          readable: read.readable,
        });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const draft = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api.draftImport(text);
      setDrafted(answer);
      setKeep(new Set(answer.records.map((record) => record.id)));
      setStep('review');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = drafted.records
        .filter((record) => keep.has(record.id))
        // `quote` and `missing` are for deciding, not for keeping. They are not
        // part of the record format and would end up in the file.
        .map(({ quote, missing, ...record }) => record);
      setResult(await api.applyImport(chosen));
      setStep('done');
      onImported?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="modal-backdrop" onClick=${(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div class="modal wide" role="dialog" aria-modal="true" aria-label="Import from a CV">
        <header class="modal-head">
          <h2>${step === 'review' ? 'What it found' : step === 'done' ? 'Imported' : 'Start from a CV'}</h2>
          <button type="button" class="icon-button" onClick=${onClose} aria-label="Close"><${Close} size="1.1em" /></button>
        </header>

        <div class="modal-body">
          ${step === 'source'
            ? html`
                <p>
                  Upload a CV or a LinkedIn PDF export, or paste the text. It gets read into
                  records that you then look at before anything is saved — nothing is written
                  until you say so.
                </p>
                <p class="field-hint">
                  On LinkedIn: your profile → <strong>More</strong> → <strong>Save to PDF</strong>.
                </p>

                <div class="row wrap">
                  <button type="button" class="button" disabled=${busy} onClick=${() => fileInput.current?.click()}>
                    ${busy ? html`<${Working} />` : null} Choose a file
                  </button>
                  <input
                    ref=${fileInput}
                    type="file"
                    class="visually-hidden"
                    accept=".pdf,.txt,.md,.markdown"
                    onChange=${(event) => readFile(event.target.files?.[0])}
                  />
                  <span class="field-hint">PDF, or a plain text file. It never leaves your machine except as text sent to the model.</span>
                </div>

                ${notice
                  ? html`
                      <${Notice} kind=${notice.kind}>
                        ${notice.lines.map((line) => html`<p key=${line}>${line}</p>`)}
                        ${notice.readable
                          ? null
                          : html`<p><strong>Open the PDF, select all, copy, and paste it below instead — that always works exactly.</strong></p>`}
                      <//>
                    `
                  : null}

                <label class="field">
                  <span class="field-label">The text</span>
                  <textarea
                    class="raw-editor short"
                    placeholder="Paste your CV here, or choose a file above."
                    value=${text}
                    onInput=${(event) => setText(event.target.value)}
                  ></textarea>
                  <span class="field-hint">
                    ${text.trim().length > 0
                      ? `${text.trim().length.toLocaleString()} characters. Check it reads properly before going on.`
                      : 'Anything a CV would have: jobs, degrees, projects, publications, skills.'}
                  </span>
                </label>
              `
            : null}

          ${step === 'review' && drafted
            ? html`
                <${Notice} kind="warning" live=${false}>
                  <strong>Nothing has been saved yet.</strong> These records become the only things
                  a CV of yours may claim, so check each one against the quote beside it before you
                  keep it. Untick anything that is wrong or that you would rather write yourself.
                <//>
                ${(drafted.notes ?? []).length > 0
                  ? html`
                      <${Notice} kind="info" live=${false}>
                        ${drafted.notes.map((note) => html`<p key=${note}>${note}</p>`)}
                      <//>
                    `
                  : null}

                <div class="row">
                  <button type="button" class="link-button" onClick=${() => setKeep(new Set(drafted.records.map((r) => r.id)))}>Tick all</button>
                  <button type="button" class="link-button" onClick=${() => setKeep(new Set())}>Untick all</button>
                  <span class="muted">${keep.size} of ${drafted.records.length} chosen</span>
                </div>

                <ul class="import-list">
                  ${drafted.records.map((record) => html`
                    <${ImportRow}
                      key=${record.id}
                      record=${record}
                      checked=${keep.has(record.id)}
                      onToggle=${() => {
                        const next = new Set(keep);
                        if (next.has(record.id)) next.delete(record.id);
                        else next.add(record.id);
                        setKeep(next);
                      }}
                    />
                  `)}
                </ul>
              `
            : null}

          ${step === 'done' && result
            ? html`
                <${Notice} kind="info">
                  <strong>${result.added.length} records added.</strong> They are in your profile
                  now, and you can edit any of them.
                <//>
                ${(result.skipped ?? []).length > 0
                  ? html`
                      <${Notice} kind="warning">
                        <strong>${result.skipped.length} could not be written:</strong>
                        <ul class="problem-list">
                          ${result.skipped.map((entry) => html`<li key=${entry.id}>${entry.id}: ${entry.problem}</li>`)}
                        </ul>
                      <//>
                    `
                  : null}
                <p>
                  Worth doing next: open each record and add the numbers. A figure in a generated
                  bullet has to appear in a record it cites, so the records with numbers in them
                  are the ones that produce a CV worth sending.
                </p>
              `
            : null}

          <${ErrorBanner} error=${error} />
        </div>

        <footer class="modal-foot">
          ${step === 'source'
            ? html`
                <button type="button" class="button" onClick=${onClose}>Cancel</button>
                <button type="button" class="button primary" disabled=${busy || text.trim().length < 100} onClick=${draft}>
                  ${busy ? html`<${Working} />` : null} Read it <${ArrowRight} size="1em" />
                </button>
              `
            : null}
          ${step === 'review'
            ? html`
                <button type="button" class="button" onClick=${() => setStep('source')}>Back</button>
                <button type="button" class="button primary" disabled=${busy || keep.size === 0} onClick=${apply}>
                  ${busy ? html`<${Working} />` : null} Add ${keep.size} record${keep.size === 1 ? '' : 's'}
                </button>
              `
            : null}
          ${step === 'done' ? html`<button type="button" class="button primary" onClick=${onClose}>Done</button>` : null}
        </footer>
      </div>
    </div>
  `;
}

function ImportRow({ record, checked, onToggle }) {
  return html`
    <li class=${checked ? 'import-row' : 'import-row skipped'}>
      <label class="import-check">
        <input type="checkbox" checked=${checked} onChange=${onToggle} />
        <span class="visually-hidden">Keep this record</span>
      </label>
      <div class="import-body">
        <div class="record-meta">
          <span class="pill">${KIND_LABELS[record.kind] ?? record.kind}</span>
          ${dateLabel(record.dates)}
          <code>${record.id}</code>
        </div>
        <strong>${record.title}${record.org ? html` <span class="muted">— ${record.org}</span>` : null}</strong>
        <p class="import-text">${record.body}</p>
        ${(record.missing ?? []).length > 0
          ? html`<p class="hint">Not in the document: ${record.missing.join('; ')}. Worth adding yourself.</p>`
          : null}
        ${record.quote
          ? html`<blockquote class="import-quote">“${record.quote}”</blockquote>`
          : html`<p class="hint error">This one came with no quote from the document — check it especially carefully.</p>`}
      </div>
    </li>
  `;
}

function dateLabel(dates) {
  const start = dates?.start ?? '';
  const end = dates?.end ?? '';
  if (!start) return 'no dates';
  if (!end) return `${start} – now`;
  if (start === end) return start;
  return `${start} – ${end}`;
}

/** A file as base64, because the API speaks JSON and this avoids a form parser. */
function base64Of(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => resolve(String(reader.result).split(',').pop() ?? '');
    reader.readAsDataURL(file);
  });
}

export default ImportProfile;
