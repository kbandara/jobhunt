// WHY: a profile written in a hurry reads like notes, and tightening it is a
// good use of a model. It is also the one place a model could do real damage, so
// the screen is built around showing you exactly what changed.
//
// Every suggestion arrives already checked in code — a rewrite that acquired a
// figure the record did not contain never becomes an option — and the rejected
// ones are shown anyway, under "not offered", because seeing what was refused is
// more instructive than a silent filter. The before and after sit side by side
// for the same reason: an accepted rewrite still has to be read.
import { html, useState, useEffect } from '../vendor/ui.js';
import { api } from '../api.js';
import { Notice, ErrorBanner } from './notice.js';
import { Close, Check, Working } from './icons.js';

export function PolishProfile({ onClose, onApplied }) {
  const [state, setState] = useState(null);
  const [keep, setKeep] = useState(new Set());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api
      .polish()
      .then((answer) => {
        setState(answer);
        setKeep(new Set(answer.accepted.filter((s) => s.after !== s.before).map((s) => s.id)));
      })
      .catch(setError)
      .finally(() => setBusy(false));
  }, []);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const changes = state.accepted
        .filter((suggestion) => keep.has(suggestion.id))
        .map((suggestion) => ({ id: suggestion.id, body: suggestion.after }));
      setResult(await api.applyPolish(changes));
      onApplied?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const changed = (state?.accepted ?? []).filter((s) => s.after !== s.before);
  const asksOnly = (state?.accepted ?? []).filter((s) => s.after === s.before && s.asks.length > 0);

  return html`
    <div class="modal-backdrop" onClick=${(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div class="modal wide" role="dialog" aria-modal="true" aria-label="Tighten the wording">
        <header class="modal-head">
          <h2>Tighten the wording</h2>
          <button type="button" class="icon-button" onClick=${onClose} aria-label="Close"><${Close} size="1.1em" /></button>
        </header>

        <div class="modal-body">
          ${busy && !state ? html`<p class="muted"><${Working} /> Reading your profile…</p>` : null}
          <${ErrorBanner} error=${error} />

          ${result
            ? html`
                <${Notice} kind="info">
                  <strong>${result.applied.length} record${result.applied.length === 1 ? '' : 's'} rewritten.</strong>
                <//>
              `
            : null}

          ${state && !result
            ? html`
                <${Notice} kind="info" live=${false}>
                  <strong>Same facts, different sentences.</strong> Every rewrite below has already
                  been checked in code: one that had picked up a number your record does not
                  contain, or dropped one it does, is not offered at all. Read each one anyway —
                  they are your words on your CV.
                <//>

                ${changed.length === 0 && asksOnly.length === 0
                  ? html`<p class="muted empty">Nothing to change. Your records are already specific.</p>`
                  : null}

                ${changed.length > 0
                  ? html`
                      <div class="row">
                        <button type="button" class="link-button" onClick=${() => setKeep(new Set(changed.map((s) => s.id)))}>Tick all</button>
                        <button type="button" class="link-button" onClick=${() => setKeep(new Set())}>Untick all</button>
                        <span class="muted">${keep.size} of ${changed.length} chosen</span>
                      </div>
                      <ul class="polish-list">
                        ${changed.map((suggestion) => html`
                          <${PolishRow}
                            key=${suggestion.id}
                            suggestion=${suggestion}
                            checked=${keep.has(suggestion.id)}
                            onToggle=${() => {
                              const next = new Set(keep);
                              if (next.has(suggestion.id)) next.delete(suggestion.id);
                              else next.add(suggestion.id);
                              setKeep(next);
                            }}
                          />
                        `)}
                      </ul>
                    `
                  : null}

                ${asksOnly.length > 0
                  ? html`
                      <h3>Records that need facts more than they need wording</h3>
                      <p class="muted">
                        These are short because the thing that would make them strong is not written
                        down. Nothing was invented to fill the gap — the questions are for you.
                      </p>
                      <ul class="ask-list">
                        ${asksOnly.map((suggestion) => html`
                          <li key=${suggestion.id}>
                            <strong>${suggestion.title}</strong>
                            <ul>${suggestion.asks.map((ask) => html`<li key=${ask}>${ask}</li>`)}</ul>
                          </li>
                        `)}
                      </ul>
                    `
                  : null}

                ${(state.rejected ?? []).length > 0
                  ? html`
                      <details class="rejected">
                        <summary>${state.rejected.length} rewrite${state.rejected.length === 1 ? '' : 's'} not offered</summary>
                        <p class="muted">
                          Refused by the check rather than by a person. Shown because what a model
                          tried to add tells you something — usually that the record it was working
                          from has a gap worth filling yourself.
                        </p>
                        <ul class="polish-list">
                          ${state.rejected.map((entry, index) => html`
                            <li key=${entry.id + index} class="polish-row rejected">
                              <div class="import-body">
                                <div class="record-meta"><code>${entry.id}</code></div>
                                <p class="hint error">${entry.problem}</p>
                                ${entry.after ? html`<p class="import-text struck">${entry.after}</p>` : null}
                              </div>
                            </li>
                          `)}
                        </ul>
                      </details>
                    `
                  : null}
              `
            : null}
        </div>

        <footer class="modal-foot">
          ${result
            ? html`<button type="button" class="button primary" onClick=${onClose}>Done</button>`
            : html`
                <button type="button" class="button" onClick=${onClose}>Cancel</button>
                <button type="button" class="button primary" disabled=${busy || keep.size === 0} onClick=${apply}>
                  ${busy ? html`<${Working} />` : null} Apply ${keep.size} rewrite${keep.size === 1 ? '' : 's'}
                </button>
              `}
        </footer>
      </div>
    </div>
  `;
}

function PolishRow({ suggestion, checked, onToggle }) {
  return html`
    <li class=${checked ? 'polish-row' : 'polish-row skipped'}>
      <label class="import-check">
        <input type="checkbox" checked=${checked} onChange=${onToggle} />
        <span class="visually-hidden">Accept this rewrite</span>
      </label>
      <div class="import-body">
        <div class="record-meta">
          <strong>${suggestion.title}</strong>
          ${suggestion.org ? html`<span class="muted">${suggestion.org}</span>` : null}
          <code>${suggestion.id}</code>
        </div>
        <div class="polish-pair">
          <div>
            <span class="field-label">Now</span>
            <p class="import-text">${suggestion.before}</p>
          </div>
          <div>
            <span class="field-label">Suggested</span>
            <p class="import-text">${suggestion.after}</p>
          </div>
        </div>
        ${suggestion.why ? html`<p class="hint">${suggestion.why}</p>` : null}
        ${suggestion.asks.length > 0
          ? html`
              <p class="hint">
                Would be stronger still if you added: ${suggestion.asks.join(' ')}
              </p>
            `
          : null}
      </div>
    </li>
  `;
}

export default PolishProfile;
