// WHY: one screen per application. The left half is what the ad asks for and how
// honestly you matches it — including the cap, always spelled out (D008), because
// a tool that quietly rewrites its own score is one you stop trusting. The right
// half is the document: generate, read, edit, save.
//
// Two structural changes, both about the same complaint — that the app never
// said where you were in the thing you were doing.
//
// 1. The rail across the top. Read, Fit, Draft, Send, each carrying its own
//    result. It replaced four paragraph-length empty states that used to explain
//    in prose what a step would do if you ran it; a step whose result is on its
//    own face does not need a paragraph underneath.
// 2. Send exists. The app used to stop once a draft existed: exporting was three
//    of six equal buttons above the editor, and moving the card was on a
//    different screen entirely, so the last thing you did in a session was never
//    the last step of the job.
import { html, useState, useEffect, useRef, useMemo } from '../vendor/ui.js';
import { api, centsToDollars, downloadFile } from '../api.js';
import { ParsedPanel, ProfilePicker } from './add.js';
import { navigate } from '../router.js';
import { Thinking } from './thinking.js';
import { Notice, ErrorBanner } from './notice.js';
import { ChatDrawer } from './chat.js';
import { ProfileDrawer } from './profile-drawer.js';
import { diffLines, withContext, countChanges } from './diff.js';
import { groupFlags } from './flags-grouping.js';
import { StepRail, jobSteps } from './steps.js';
import { ArrowLeft, Check, Alert, Info, Read, Chat, History, Download, External, Copy, Draft as DraftIcon, Send as SendIcon, FileText, Sparkles, Working, Person as Profile } from './icons.js';

// Which documents an application needs depends on how it started. An advertised
// role wants a cover letter and, usually, a set of answers; a company nobody is
// advertising for wants an email. Offering all four in both cases would be
// offering two that make no sense, and one of them costs money to find out.
const KINDS = [
  { id: 'cv', label: 'CV', sources: ['pasted', 'cold'] },
  { id: 'cover-letter', label: 'Cover letter', sources: ['pasted'] },
  { id: 'criteria', label: 'Questions', sources: ['pasted'] },
  { id: 'cold-email', label: 'Email', sources: ['cold'] },
];

const kindsFor = (source) => KINDS.filter((k) => k.sources.includes(source === 'cold' ? 'cold' : 'pasted'));

const STATUS_LABEL = {
  wishlist: 'Wishlist',
  drafting: 'Drafting',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
};

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function JobView({ jobId, onCost }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [busySince, setBusySince] = useState(null);
  const [kind, setKind] = useState('cv');
  // Which panel the rail last sent you to, and a brief ring on it when it lands.
  const [current, setCurrent] = useState(null);
  const [called, setCalled] = useState(null);

  const load = () => api.job(jobId).then(setState).catch(setError);
  useEffect(() => {
    load();
  }, [jobId]);

  if (error && !state) return html`<${ErrorBanner} error=${error} />`;
  if (!state) return html`<p class="muted"><${Thinking} word="Loading" showTime=${false} /></p>`;

  const { job, docs } = state;
  const parsed = Boolean(job.parsed);
  const cold = job.source === 'cold';
  const profile = job.profile?.confirmed ?? job.profile?.guess ?? '';
  const profileBy = job.profile?.confirmedBy ?? null;
  const tabs = kindsFor(job.source);
  // A cold approach has no cover-letter tab, so a stale `kind` from a previous
  // job would render a panel with no way back to it.
  const shown = tabs.some((k) => k.id === kind) ? kind : tabs[0].id;

  const steps = jobSteps(job);
  const suggested = steps.find((s) => s.state === 'now')?.id ?? null;
  const doc = docs[shown];
  const hasDraft = (doc?.versions ?? []).length > 0;

  const run = async (label, fn) => {
    setBusy(label);
    setBusySince(Date.now());
    setError(null);
    try {
      await fn();
      await load();
      onCost?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
      setBusySince(null);
    }
  };

  /** Move the page to a step's panel and mark it briefly, so the jump lands. */
  const goTo = (id) => {
    setCurrent(id);
    const el = document.getElementById(`panel-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    setCalled(id);
    setTimeout(() => setCalled(null), 1500);
  };

  return html`
    <section class="animate-blur-in-up stagger-1">
      <a class="backlink" href="#/board"><${ArrowLeft} size="1em" /> Board</a>

      <div class="page-head">
        <div>
          <h1>
            ${job.parsed?.company ?? (cold ? 'A company to approach' : 'Job')}
            ${job.parsed ? html` — ${job.parsed.role_title}` : null}
          </h1>
          <div class="card-meta" style="padding:0">
            ${profile
              ? html`<span class="badge profile">${profile}${profileBy === 'human' ? '' : ' · guessed'}</span>`
              : null}
            <span class="badge">${STATUS_LABEL[job.status] ?? job.status}</span>
            ${cold ? html`<span class="badge cold">cold approach</span>` : null}
          </div>
        </div>
        <${DeleteJob} job=${job} onDeleted=${() => navigate('/board')} />
      </div>

      ${error ? html`<${ErrorBanner} error=${error} />` : null}

      <${StepRail} steps=${steps} current=${current ?? suggested} onGo=${goTo} />

      ${/* A job normally arrives here already parsed, because Add does both in one
           go. It gets here unparsed when that second call failed — no key, a 503,
           a timeout — and without this there is no way back from that except
           pasting the whole advertisement again. Until it is parsed there is
           nothing else on this screen worth showing, so nothing else is. */ ''}
      ${!parsed
        ? html`
            <div class=${`panel glass animate-blur-in-up stagger-2 ${called === 'read' ? 'called' : ''}`} id="panel-read">
              <div class="panel-head"><h2>${cold ? 'Your notes have not been read yet' : 'This advertisement has not been read yet'}</h2></div>
              <p class="muted">
                ${cold ? 'Your notes' : 'The advertisement'} has to be read before anything else can
                happen — scoring and drafting both work from what comes out of it.
              </p>
              <button
                class="button primary"
                disabled=${busy === 'parse'}
                onClick=${() => run('parse', () => api.parse(job.id))}
              >
                ${busy === 'parse'
                  ? html`<${Thinking} word=${cold ? 'Reading your notes' : 'Reading it'} since=${busySince} />`
                  : html`<${Read} size="1.05em" /> ${cold ? 'Read my notes' : 'Read it'}`}
              </button>
            </div>
          `
        : html`
            <div class="split animate-blur-in-up stagger-2">
              <div class="left">
                ${cold
                  ? html`<${ApproachPanel} job=${job} called=${called} />`
                  : html`<${FitPanel} job=${job} busy=${busy} busySince=${busySince} called=${called}
                      onScore=${() => run('score', () => api.score(job.id))} />`}
                <${ParsedPanel} parsed=${job.parsed} cold=${cold} />
              </div>

              <div class="right">
                <${DocTabs} tabs=${tabs} shown=${shown} docs=${docs} onPick=${setKind} />
                <${DocPanel}
                  jobId=${job.id}
                  kind=${shown}
                  doc=${doc}
                  called=${called}
                  profile=${profile}
                  profileBy=${profileBy}
                  profileReason=${job.profile?.guessReason ?? ''}
                  cold=${cold}
                  notes=${job.notes ?? ''}
                  busy=${busy}
                  onProfile=${(next) => run('profile', () => api.confirmProfile(job.id, next))}
                  ${/* Not routed through run(): that awaits and reloads, which
                       is right for a save and wrong for something designed to
                       outlive the click. Starting is all this does. */ ''}
                  onGenerate=${async () => {
                    setError(null);
                    try {
                      await api.generate(job.id, shown);
                    } catch (err) {
                      setError(err);
                    }
                  }}
                  onSave=${(markdown) => run('save', () => api.saveDoc(job.id, shown, markdown))}
                  onReloaded=${load}
                  onCost=${onCost}
                />
              </div>
            </div>

            ${hasDraft
              ? html`<${SendPanel}
                  job=${job}
                  kind=${shown}
                  doc=${doc}
                  called=${called}
                  busy=${busy}
                  onStatus=${(status) => run('status', () => api.setStatus(job.id, status))}
                  onSaveFirst=${(markdown) => run('save', () => api.saveDoc(job.id, shown, markdown))}
                />`
              : null}
          `}
    </section>
  `;
}

/**
 * The document tabs. They are a real tablist now — they used to be four
 * unrelated buttons as far as a screen reader was concerned, and the left and
 * right arrow keys did nothing.
 */
function DocTabs({ tabs, shown, docs, onPick }) {
  const refs = useRef([]);

  const onKey = (event, index) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + tabs.length) % tabs.length;
    onPick(tabs[next].id);
    refs.current[next]?.focus();
  };

  return html`
    <div class="tabs" role="tablist" aria-label="Documents for this application">
      ${tabs.map((k, i) => {
        const version = docs[k.id]?.versions?.length ?? 0;
        return html`
          <button
            key=${k.id}
            type="button"
            role="tab"
            class="tab"
            id=${`doc-tab-${k.id}`}
            aria-selected=${shown === k.id}
            aria-controls="doc-panel"
            tabindex=${shown === k.id ? 0 : -1}
            ref=${(el) => (refs.current[i] = el)}
            onKeyDown=${(e) => onKey(e, i)}
            onClick=${() => onPick(k.id)}
          >
            <${FileText} size="0.9em" style="margin-right: 4px; opacity: 0.7;" />
            ${k.label}
            ${version > 0 ? html`<span class="tab-count">v${docs[k.id].versions[version - 1].v}</span>` : null}
          </button>
        `;
      })}
    </div>
  `;
}

/**
 * Too senior for the role — a real way to be screened out that nobody ever
 * tells you about, so it gets its own line rather than a sentence buried in the
 * summary. Shown separately from the score and never routed through the cap:
 * a hard filter genuinely ends an application, while being too senior is a
 * judgement you may well disagree with, and it is your to make.
 */
function Overqualification({ signal }) {
  const level = signal?.level ?? 'none';
  if (level === 'none') return null;
  return html`
    <p class=${`overqualified level-${level}`}>
      <${Alert} size="1.05em" />
      <span>
        <strong>${level === 'clearly' ? 'Probably too senior' : 'Possibly too senior'}</strong>
        ${signal.note ? html` — ${signal.note}` : null}
      </span>
    </p>
  `;
}

/**
 * What sits where the fit score would, when nobody has advertised anything.
 *
 * There is deliberately no score here. A number computed against requirements
 * the app invented from your own notes would be fiction with a decimal point on
 * it, and a score is the one output people believe without checking. What is
 * useful instead is the notes themselves, back on screen: the email can only be
 * as specific as they are, and seeing them thin is what prompts adding to them.
 */
function ApproachPanel({ job, called }) {
  const notes = String(job.rawAd ?? '').trim();
  const words = notes === '' ? 0 : notes.split(/\s+/).length;

  return html`
    <div class=${`panel glass animate-blur-in-up stagger-3 ${called === 'fit' ? 'called' : ''}`} id="panel-fit">
      <div class="panel-head"><h2>Approaching them cold</h2></div>
      <p class="muted">
        Nobody advertised a role here, so there is nothing to score against and no closing date.
        What decides whether this works is how specific the email can be — and it can only be as
        specific as what you know about them.
      </p>
      ${words < 40
        ? html`<p class="thin-notes">
            <${Alert} size="1.05em" />
            <span>
              Your notes are short (<span class="num">${words}</span> word${words === 1 ? '' : 's'}). The
              email will have little to say about <em>them</em>, which is the part that makes a cold
              email land.
            </span>
          </p>`
        : null}
      <h3>What you wrote about them</h3>
      <p class="notes">${notes || 'nothing yet'}</p>
      <p class="muted small">
        The model gets these notes and your evidence records, and nothing else. It is told not to
        name a customer, a funding round or a product feature that is not in here — an invented
        detail about a small company is caught instantly by the person who works there.
      </p>
    </div>
  `;
}

function FitPanel({ job, onScore, busy, busySince, called }) {
  const fit = job.fit;
  return html`
    <div class=${`panel glass animate-blur-in-up stagger-3 ${called === 'fit' ? 'called' : ''}`} id="panel-fit">
      <div class="panel-head">
        <h2>Worth applying?</h2>
        ${fit
          ? html`<button class="button small" disabled=${busy === 'score'} onClick=${onScore}>
              ${busy === 'score' ? html`<${Thinking} word="Reading" showTime=${false} />` : 'Score again'}
            </button>`
          : null}
      </div>
      ${!fit
        ? html`
            <p class="muted">
              A quick read of <strong>your profile</strong> against this advertisement, before you
              spend anything on a draft. Once you have a CV, <em>Recruiter's read</em> further down
              does the same for the document itself.
            </p>
            <button class="button primary" disabled=${busy === 'score'} onClick=${onScore}>
              ${busy === 'score'
                ? html`<${Thinking} word="Reading" since=${busySince} />`
                : 'Score this job'}
            </button>
            <p class="muted small" style="margin-top:0.75rem">a few cents of model time</p>
          `
        : html`
            ${/* "29 skip /100" read as three unrelated things. The number and its
                 scale belong together, and the verdict is the label on them. */ ''}
            <div class=${`score-row verdict-${fit.verdict}`}>
              <span class="score-number">${fit.cappedScore}<span class="score-of">/100</span></span>
              <span class="verdict">${fit.verdict}</span>
            </div>
            ${fit.capReason
              ? html`
                  <div class="cap">
                    <${Alert} size="1.05em" />
                    <span>
                      The model said <span class="num">${fit.modelScore}</span>. Capped to
                      ${' '}<span class="num">${fit.cappedScore}</span> because ${fit.capReason}.
                      A “blocking” requirement is a hard filter — something no amount of good writing
                      gets past — so both numbers are shown rather than one quietly changed.
                    </span>
                  </div>
                `
              : null}
            <p class="score-summary">${fit.summary}</p>
            <${Overqualification} signal=${fit.overqualification} />

            <h3>Matched <span class="muted num">(${(fit.matched ?? []).length})</span></h3>
            <ul class="req-list">
              ${(fit.matched ?? []).map(
                (m, i) => html`<li key=${i}>
                  <span class="req-tick"><${Check} size="1em" /></span>
                  <span>${m.requirement}</span>
                </li>`,
              )}
            </ul>

            <h3>Unmet <span class="muted num">(${(fit.unmet ?? []).length})</span></h3>
            <ul class="req-list">
              ${(fit.unmet ?? []).map(
                (u, i) => html`
                  <li key=${i}>
                    <span class=${`chip severity-${u.severity}`}>${u.severity}</span>
                    <span>
                      ${u.requirement}
                      ${u.note ? html`<span class="req-note"> — ${u.note}</span>` : null}
                    </span>
                  </li>
                `,
              )}
            </ul>
          `}
    </div>
  `;
}

function DocPanel({ jobId, kind, doc, called, profile, profileBy, profileReason, cold, notes, busy, onProfile, onGenerate, onSave, onReloaded, onCost }) {
  const [draft, setDraft] = useState(doc?.markdown ?? '');
  const [dirty, setDirty] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Independent of the chat on purpose: the arrangement worth having is your
  // records on the left, the model on the right, and the draft in between.
  const [profileOpen, setProfileOpen] = useState(false);
  const [revising, setRevising] = useState(false);
  const [askedCount, setAskedCount] = useState(null);
  // Whether the SERVER says something is being written for this document. Not
  // the same as "this page pressed Generate": a run started here survives
  // navigating away, and a run started elsewhere shows up here.
  const [generating, setGenerating] = useState(false);
  // null means "the current draft". A number means you are reading history, and
  // the editor is read-only until you come back or restore it.
  const [viewing, setViewing] = useState(null);
  const [historic, setHistoric] = useState(null);
  // Reading history: 'changes' shows what this version did, 'full' shows the
  // document. Changes first, because that is the question you opened it with —
  // the whole text was always available and told you nothing you did not know.
  const [historyView, setHistoryView] = useState('changes');
  // What the version on screen is compared against: the one before it ("what did
  // this version change") or the current draft ("what happens if I restore it").
  const [against, setAgainst] = useState('previous');
  const [base, setBase] = useState(null);
  // What you have highlighted in the editor, so a question can be about one
  // paragraph rather than the whole document. Read here rather than inside the
  // drawer because this is the component that owns the textarea; the drawer
  // reaching across the page for an element by id is how these two get out of
  // step the first time either one moves.
  const [selection, setSelection] = useState('');
  // Where focus goes back to when a drawer closes. Losing it to the top of the
  // document is the classic dialog bug and it strands anyone using a keyboard.
  const chatOpener = useRef(null);
  const profileOpener = useRef(null);

  // When a generate finishes (or the tab changes) the server's copy wins, unless
  // there are unsaved edits in the box — losing typing is unforgivable.
  useEffect(() => {
    if (!dirty) setDraft(doc?.markdown ?? '');
  }, [doc?.markdown, kind]);
  useEffect(() => {
    setDirty(false);
    setDraft(doc?.markdown ?? '');
    setViewing(null);
    setHistoric(null);
    setSelection('');
    // The conversation belongs to one document, so switching tabs closes it
    // rather than leaving a CV discussion open over a cover letter.
    setChatOpen(false);
  }, [kind]);

  // Three events rather than one, on purpose. `select` alone misses the click
  // that CLEARS a selection in some browsers, which left a stale quote on offer
  // long after the highlight had gone; mouseup and keyup between them catch
  // dragging, shift-arrow, Ctrl+A and the click that collapses it.
  const readSelection = (e) => {
    const { selectionStart: from, selectionEnd: to, value } = e.target;
    setSelection(to > from ? value.slice(from, to) : '');
  };

  const versions = doc?.versions ?? [];
  const latest = versions[versions.length - 1];
  const shownVersion = versions.find((v) => v.v === viewing) ?? latest;

  // Blurred whenever the text on screen is not yours to change: while the model
  // is writing, while a save is in flight, and while you are reading an old
  // version.
  const working = generating || busy === 'generate' || busy === 'save' || revising;

  const openVersion = async (v) => {
    if (v === null || v === latest?.v) {
      setViewing(null);
      setHistoric(null);
      return;
    }
    setViewing(v);
    setHistoric(null);
    setAgainst('previous');
    try {
      const data = await api.docVersion(jobId, kind, v);
      setHistoric(data.markdown);
    } catch {
      // The dropdown only offers versions the server listed, so this is the
      // rare case of a data directory edited underneath us. Falling back to the
      // current draft is better than an empty box.
      setViewing(null);
    }
  };

  // The other side of the comparison. Only one of the two needs fetching: the
  // current draft is already here, and the very first version has nothing before
  // it, which is not an error — everything in it is new.
  useEffect(() => {
    if (viewing === null) {
      setBase(null);
      return undefined;
    }
    if (against === 'current') {
      setBase(doc?.markdown ?? '');
      return undefined;
    }
    const index = versions.findIndex((entry) => entry.v === viewing);
    const before = index > 0 ? versions[index - 1] : null;
    if (!before) {
      setBase('');
      return undefined;
    }
    let dropped = false;
    setBase(null);
    api
      .docVersion(jobId, kind, before.v)
      .then((data) => {
        if (!dropped) setBase(data.markdown ?? '');
      })
      .catch(() => {
        if (!dropped) setBase(null);
      });
    return () => {
      dropped = true;
    };
  }, [viewing, against, jobId, kind, doc?.markdown]);

  // Both documents in hand, this is the answer. Memoised because it is O(n·m) in
  // the changed region and the page re-renders on every keystroke elsewhere.
  const changes = useMemo(() => {
    if (viewing === null || historic === null || base === null) return null;
    const rows = diffLines(base, historic);
    return { rows: withContext(rows), ...countChanges(rows) };
  }, [viewing, historic, base]);

  // Nothing to answer means nothing to generate. Gated here rather than letting
  // the server refuse, so the button is visibly unavailable instead of costing a
  // click to find out.
  const nothingAsked = kind === 'criteria' && askedCount === 0;

  return html`
    <div class=${`panel glass animate-blur-in-up stagger-4 ${called === 'draft' ? 'called' : ''}`} id="panel-draft" role="tabpanel" aria-labelledby=${`doc-tab-${kind}`}>
      <div class="doc-header">
        ${/* Starting is instant now, so the button is only busy for the moment
             the request is in the air. What it turns into afterwards is
             "Writing…" driven by the SERVER's run — which is still true if you
             comes back to this page ten minutes later. */ ''}
        <button
          class="button primary"
          disabled=${generating || busy === 'generate' || nothingAsked}
          onClick=${onGenerate}
        >
          ${generating || busy === 'generate'
            ? html`<${Thinking} word="Writing" showTime=${false} />`
            : html`<${DraftIcon} size="1.05em" /> ${versions.length === 0 ? 'Generate' : 'Generate again'}`}
        </button>
        ${versions.length > 0
          ? html`<${VersionPicker} versions=${versions} viewing=${viewing} onView=${openVersion} />`
          : null}
        ${latest
          ? html`<span class="spend">
              ${centsToDollars(versions.reduce((sum, v) => sum + (v.costCents ?? 0), 0))} of model time here
            </span>`
          : null}
      </div>

      <${GenerationProgress}
        jobId=${jobId}
        kind=${kind}
        onRunning=${setGenerating}
        onFinished=${() => {
          setDirty(false);
          onReloaded?.();
          onCost?.();
        }} />

      <${ProfileRow} profile=${profile} profileBy=${profileBy} profileReason=${profileReason}
        cold=${cold} busy=${busy} onProfile=${onProfile} />

      ${kind === 'cv'
        ? html`<${PublicationPicker} jobId=${jobId} />`
        : null}

      ${kind === 'criteria'
        ? html`<${QuestionsPanel} jobId=${jobId} docVersion=${latest?.v ?? 0} onCount=${setAskedCount} />`
        : null}

      <${NotesPanel} jobId=${jobId} notes=${notes} />
      <${RecordPicker} onInsert=${(text) => {
        setDirty(true);
        setDraft((current) => `${current.replace(/\s*$/, '')}\n\n${text}\n`);
      }} disabled=${working || viewing !== null || versions.length === 0} />

      ${versions.length === 0
        ? html`<${DraftEmpty} kind=${kind} cold=${cold} askedCount=${askedCount} />`
        : html`
            ${viewing !== null
              ? html`<${HistoryBar}
                  version=${shownVersion}
                  loaded=${historic !== null}
                  latestV=${latest?.v ?? 0}
                  view=${historyView}
                  onView=${setHistoryView}
                  against=${against}
                  onAgainst=${setAgainst}
                  first=${versions.findIndex((entry) => entry.v === viewing) === 0}
                  onBack=${() => openVersion(null)}
                  onRestore=${() => {
                    setViewing(null);
                    setDirty(false);
                    onSave(historic);
                    setHistoric(null);
                  }} />`
              : null}

            ${viewing !== null && historyView === 'changes'
              ? html`<${DiffView}
                  changes=${changes}
                  against=${against}
                  versionV=${viewing}
                  baseLabel=${against === 'current'
                    ? 'the current draft'
                    : versions.findIndex((entry) => entry.v === viewing) === 0
                      ? 'nothing — this is the first version'
                      : `version ${versions[versions.findIndex((entry) => entry.v === viewing) - 1].v}`} />`
              : html`
            <div class=${`editor-wrap ${working ? 'working' : ''} ${viewing !== null ? 'historic' : ''}`}>
              <label class="visually-hidden" for="editor">The draft, in markdown</label>
              <textarea
                id="editor"
                class="editor"
                rows="26"
                readonly=${viewing !== null || working}
                value=${viewing !== null ? (historic ?? '') : draft}
                onInput=${(e) => {
                  setDirty(true);
                  setDraft(e.target.value);
                }}
                onSelect=${readSelection}
                onMouseUp=${readSelection}
                onKeyUp=${readSelection}
              ></textarea>
              ${working
                ? html`<div class="editor-veil">
                    <${Thinking} word=${busy === 'save' ? 'Saving' : 'Your AI is writing'} showTime=${false} />
                  </div>`
                : null}
            </div>
              `}

            ${viewing === null
              ? html`
                  <div class="doc-actions">
                    <button
                      class="button primary"
                      disabled=${working || draft.trim() === ''}
                      onClick=${() => {
                        setDirty(false);
                        onSave(draft);
                      }}
                    >${busy === 'save' ? html`<${Thinking} word="Saving" showTime=${false} />` : 'Save'}</button>
                    <button
                      class="button"
                      ref=${profileOpener}
                      onClick=${() => setProfileOpen((current) => !current)}
                      aria-pressed=${profileOpen}
                    ><${Profile} size="1.05em" /> Check against your profile</button>
                    <button
                      class="button"
                      disabled=${working}
                      ref=${chatOpener}
                      onClick=${() => setChatOpen(true)}
                    ><${Chat} size="1.05em" /> Ask your AI about this draft</button>
                    ${dirty ? html`<span class="unsaved">unsaved changes</span>` : null}
                  </div>
                  <p class="hint">
                    Nothing is ever overwritten — every save is a new version. The chat reads the box
                    exactly as it is now, unsaved edits included, and it answers questions without
                    touching the draft unless you switch it to Edit. Highlight a passage first to ask
                    about that passage alone. Your profile opens on the left and can stay open beside
                    the chat.
                  </p>
                `
              : null}

            <${ChatDrawer}
              jobId=${jobId}
              kind=${kind}
              open=${chatOpen}
              onClose=${() => {
                setChatOpen(false);
                chatOpener.current?.focus();
              }}
              markdown=${draft}
              selection=${viewing === null ? selection : ''}
              modal=${!profileOpen}
              onBusy=${setRevising}
              onRevised=${(revised) => {
                setDirty(false);
                setDraft(revised);
                onReloaded?.();
              }}
              onCost=${onCost}
            />
            <${ProfileDrawer}
              jobId=${jobId}
              kind=${kind}
              open=${profileOpen}
              onClose=${() => {
                setProfileOpen(false);
                profileOpener.current?.focus();
              }}
              markdown=${viewing !== null ? (historic ?? '') : draft}
              canInsert=${!working && viewing === null}
              onInsert=${(text) => {
                setDirty(true);
                setDraft((current) => `${current.replace(/\s*$/, '')}\n\n${text}\n`);
              }}
            />
            <${FlagsPanel} version=${shownVersion} />
            ${cold ? null : html`<${KeywordPanel} jobId=${jobId} kind=${kind} docVersion=${latest?.v ?? 0} />`}
            ${cold || !latest
              ? null
              : html`<${RecruiterPanel} jobId=${jobId} kind=${kind} docVersion=${latest?.v ?? 0} />`}
          `}
    </div>
  `;
}

/**
 * What Generate is about to read, said once, where an empty panel already is.
 *
 * Deliberately only here, and deliberately shorter than it was. The rail above
 * already says this step has not run; what is left to explain is the one thing
 * the rail cannot show — which of your records the model is given.
 */
function DraftEmpty({ kind, cold, askedCount }) {
  const what = {
    cv: 'your evidence records, ranked for this advertisement rather than all of them, plus the parsed advertisement, the profile’s rules and the publications you have ticked',
    'cv-cold': 'your evidence records, ranked against the work your notes describe, plus the profile’s rules and the publications you have ticked',
    'cover-letter': 'the same inputs as the CV. Nothing in the CV tab reaches this one — they are written independently',
    criteria: 'your evidence records, one answer per question, to the word limit it was given',
    'cold-email': 'your notes about them and your evidence records, and nothing else — it cannot look them up, so it is told not to name anything about them that is not in your notes',
  };
  const key = kind === 'cv' && cold ? 'cv-cold' : kind;

  if (kind === 'criteria' && askedCount === 0) {
    return html`
      <${Notice} kind="info" live=${false}>
        Paste the questions above first. There is nothing to answer yet.
      <//>
    `;
  }

  return html`
    <p class="muted">
      Press Generate. The model gets ${what[key] ?? what.cv}, and returns a draft with a source
      record cited for every bullet.
    </p>
  `;
}

/**
 * The profile, sitting with the draft it decides the shape of. It is never blank and
 * never blocking: after a parse the app has accepted its own guess, and this says
 * so in as many words so "guessed" is never mistaken for "you chose this".
 * Changing it saves immediately and the record then reads `confirmedBy: human`.
 *
 * The model's reasoning used to sit here as three wrapped lines above the thing
 * you came to look at. It is behind "why?" now — the same words, read when you
 * doubts the guess rather than every time you open a draft.
 */
function ProfileRow({ profile, profileBy, profileReason, cold, busy, onProfile }) {
  const [why, setWhy] = useState(false);
  const guessed = Boolean(profile) && profileBy !== 'human';

  return html`
    <div class="profile-row">
      <${ProfilePicker} value=${profile} onChange=${onProfile} disabled=${busy === 'profile'}
        describe=${false} id="doc-profile" />
      ${!profile
        ? html`<span class="muted small">
            ${cold
              ? 'guessed once your notes have been read'
              : 'guessed once the advertisement has been read'}
          </span>`
        : html`<span class="badge">${profileBy === 'human' ? 'your choice' : 'guessed'}</span>`}
      ${guessed && profileReason
        ? html`<button class="profile-why" type="button" aria-expanded=${why} onClick=${() => setWhy(!why)}>
            ${why ? 'hide why' : 'why?'}
          </button>`
        : null}
      ${why && profileReason
        ? html`<p class="profile-reason">
            ${profileReason.replace(/\.$/, '')}. Change it above if that is wrong.
          </p>`
        : null}
    </div>
  `;
}

/**
 * Which version is on screen. Every save has always kept the one before it, but
 * there was no way to read one without opening the data directory — so pressing
 * "Generate again" and preferring what it replaced was, in practice, a loss.
 *
 * Newest first, because the one you want is nearly always the last or the one
 * before it, and each row says where it came from: the model wrote it, you wrote
 * it, or a publication tick did.
 */
function VersionPicker({ versions, viewing, onView }) {
  const latest = versions[versions.length - 1];
  const current = viewing ?? latest.v;
  return html`
    <label class="visually-hidden" for="version-select">Version</label>
    <select
      id="version-select"
      class="version-select"
      value=${String(current)}
      onChange=${(e) => {
        const v = Number(e.target.value);
        onView(v === latest.v ? null : v);
      }}
    >
      ${[...versions].reverse().map(
        (v) => html`<option key=${v.v} value=${String(v.v)}>
          ${`v${v.v}${v.v === latest.v ? ' (current)' : ''} — ${sourceOf(v)}, ${whenText(v.ts)}`}
        </option>`,
      )}
    </select>
  `;
}

/** Who wrote a version, in the words you would use about it. */
function sourceOf(version) {
  if (!version.editedByUser) return 'the model';
  const changes = version.changes_made ?? [];
  if (changes.some((c) => /^publications set to/.test(c))) return 'publication ticks';
  return 'your edit';
}

/** "4 min ago" beats a timestamp for the one question being asked: how old is this? */
function whenText(ts) {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return 'unknown';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Reading an old version. It is read-only on purpose: editing history in place
 * would quietly destroy the thing the history is for. Restoring writes it
 * forward as a new version instead, so both remain.
 */
function HistoryBar({ version, loaded, latestV, view, onView, against, onAgainst, first, onBack, onRestore }) {
  return html`
    <div class="history-bar">
      <${History} size="1.05em" />
      <span class="history-what">
        Reading <strong>version ${version.v}</strong> of ${latestV} — ${sourceOf(version)},
        ${' '}${whenText(version.ts)}. Read-only.
      </span>
      <div class="segmented" aria-label="What to show for this version">
        ${[
          ['changes', 'Changes', 'Only the lines that differ, with a little of the text around them.'],
          ['full', 'Full text', 'The whole document as it stood at this version.'],
        ].map(
          ([id, text, title]) => html`
            <button
              key=${id}
              class=${`segment ${view === id ? 'on' : ''}`}
              onClick=${() => onView(id)}
              aria-pressed=${view === id}
              title=${title}
            >${text}</button>
          `,
        )}
      </div>
      <button class="button small" disabled=${!loaded} onClick=${onRestore}>Restore this version</button>
      <button class="link-button" onClick=${onBack}>Back to the current draft</button>
      ${/* Only in the diff, and only when there is a second thing to compare
            against. "What did this change" and "what happens if I restore it"
            are different questions, and the second is why most people are here. */
      view === 'changes' && !first
        ? html`<button
            class="link-button history-against"
            onClick=${() => onAgainst(against === 'previous' ? 'current' : 'previous')}
          >
            ${against === 'previous' ? 'Compare with the current draft instead' : 'Compare with the version before it instead'}
          </button>`
        : null}
    </div>
  `;
}

/**
 * What changed, in the notation everyone already knows.
 *
 * Unchanged runs are collapsed rather than printed (see diff.js): in a two-page
 * CV where one sentence moved, showing all of it buries the answer in the thing
 * you were trying to see past. The sign carries the meaning as well as the
 * colour, so this survives being printed, being colour-blind, and being read at
 * a glance.
 */
function DiffView({ changes, against, versionV, baseLabel }) {
  if (changes === null) {
    return html`<div class="diff diff-waiting"><${Thinking} word="Reading the other version" showTime=${false} /></div>`;
  }
  const { rows, added, removed } = changes;
  return html`
    <div class="diff">
      <div class="diff-sum">
        <span class="diff-count added">+${added}</span>
        <span class="diff-count removed">−${removed}</span>
        <span class="diff-what">
          ${added === 0 && removed === 0
            ? html`version ${versionV} is identical to ${baseLabel}`
            : html`version ${versionV}, against ${baseLabel}`}
        </span>
      </div>
      ${added === 0 && removed === 0
        ? null
        : html`
            <ol class="diff-lines">
              ${rows.map((row, i) =>
                row.type === 'gap'
                  ? html`<li key=${i} class="diff-gap">${row.count} unchanged lines</li>`
                  : html`<li key=${i} class=${`diff-line ${row.type}`}>
                      <span class="diff-sign" aria-hidden="true">
                        ${row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}
                      </span>
                      <span class="diff-text">${row.text === '' ? ' ' : row.text}</span>
                    </li>`,
              )}
            </ol>
          `}
    </div>
  `;
}

/* ==========================================================================
   Send — the step the app never had
   ========================================================================== */

/**
 * Exporting, and then saying what happened.
 *
 * These controls used to be three of six equal-weight buttons above the editor,
 * which meant the row above the draft had no primary action at all — and moving
 * the card was on the board, a screen away, so the application never actually
 * finished anywhere. Both belong at the end, together, because they are the
 * same moment: this is done, here is the file, it has gone.
 */
function SendPanel({ job, kind, doc, called, busy, onStatus, onSaveFirst }) {
  const versions = doc?.versions ?? [];
  const latest = versions[versions.length - 1];
  const email = kind === 'cold-email';

  return html`
    <div class=${`panel glass animate-blur-in-up stagger-5 ${called === 'send' ? 'called' : ''}`} id="panel-send">
      <div class="panel-head">
        <h2><${SendIcon} size="1em" /> Send it</h2>
      </div>
      <div class="send-grid">
        <div class="send-block">
          <h3>Take the document</h3>
          ${email
            ? html`
                <p class="muted small">An email is pasted into a mail client, never typeset.</p>
                <${CopyButton} text=${doc?.markdown ?? ''} />
              `
            : html`
                <p class="muted small">
                  The exports read the <strong>saved</strong> draft, and save first if you have
                  unsaved edits.
                </p>
                <div class="send-row">
                  <${ExportButtons}
                    jobId=${job.id}
                    kind=${kind}
                    version=${latest?.v ?? 0}
                    onSaveFirst=${onSaveFirst}
                  />
                  <a class="button" href=${`/print/${job.id}/${kind}`} target="_blank" rel="noopener">
                    <${External} size="1.05em" /> Print view
                  </a>
                </div>
              `}
        </div>

        <div class="send-block">
          <h3>Where it is up to</h3>
          <p class="muted small">Every move is logged with its time, which is what eventually answers “how long until they replied”.</p>
          <div class="status-picker" role="group" aria-label="Application status">
            ${Object.keys(STATUS_LABEL).map(
              (status) => html`
                <button
                  key=${status}
                  type="button"
                  class="button status-option"
                  data-status=${status}
                  aria-pressed=${job.status === status}
                  disabled=${busy === 'status'}
                  onClick=${() => onStatus(status)}
                >
                  <span class="lane-dot" aria-hidden="true"></span>
                  ${STATUS_LABEL[status]}
                </button>
              `,
            )}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * The questions the application actually asks, and how the answers measure up.
 *
 * This is a paste box rather than something derived from the advertisement,
 * because that is where the questions come from: most portals ask them behind a
 * login, and the ad prints them only sometimes. When it does, they are used
 * until you paste something — and then your paste replaces them outright, since
 * the portal's wording and the ad's wording for the same criterion differ just
 * enough to produce two near-identical answers with nothing to choose between.
 *
 * The word count is the whole reason this panel has a body. Portals truncate
 * mid-sentence without warning, so the count is computed in code from the saved
 * text and shown against the limit — a model cannot count words and will say it
 * did.
 */
function QuestionsPanel({ jobId, docVersion, onCount }) {
  const [state, setState] = useState(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const data = await api.questions(jobId);
      setState(data);
      setText(data.text ?? '');
      onCount?.(data.questions.length);
      // Open itself when there is nothing to answer: an empty panel you have to
      // find and expand is the same as a missing feature.
      if (data.questions.length === 0) setOpen(true);
    } catch (err) {
      setError(err);
    }
  };

  useEffect(() => {
    load();
  }, [jobId, docVersion]);

  if (!state) return null;

  const { questions, source, counts } = state;
  const over = counts.filter((c) => c.over);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.setQuestions(jobId, text);
      setState(data);
      onCount?.(data.questions.length);
      if (data.questions.length > 0) setOpen(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class=${`disclosure ${open ? 'open' : ''}`}>
      <button class="disclosure-toggle" type="button" onClick=${() => setOpen(!open)} aria-expanded=${open}>
        <span class="disclosure-caret"><${ChevronRightSmall} /></span>
        <strong>Questions</strong>
        <span class="disclosure-note">
          ${questions.length === 0
            ? 'none yet — paste them here'
            : `${questions.length} question${questions.length === 1 ? '' : 's'}${source === 'advertisement' ? ', from the advertisement' : ''}`}
        </span>
        ${over.length > 0 ? html`<span class="disclosure-problem">${over.length} over the limit</span>` : null}
      </button>

      ${open
        ? html`
            <div class="disclosure-body">
              <p class="muted small">
                Paste them exactly as the form asks them, one per line or separated by blank lines.
                A word limit written into a question — “(300 words max)” — is read out of it and
                counted against your answer.
              </p>
              ${error ? html`<${ErrorBanner} error=${error} />` : null}
              <label class="visually-hidden" for="questions-input">The questions this application asks</label>
              <textarea
                id="questions-input"
                class="questions-input"
                rows="6"
                placeholder=${'1. Describe your experience designing evaluations. (300 words max)\n\n2. Tell us about a time you worked in a multidisciplinary team.'}
                value=${text}
                onInput=${(e) => setText(e.target.value)}
              ></textarea>
              <div class="doc-actions">
                <button class="button primary" disabled=${busy} onClick=${save}>
                  ${busy ? html`<${Thinking} word="Saving" showTime=${false} />` : 'Save questions'}
                </button>
                ${source === 'advertisement'
                  ? html`<span class="muted small">
                      These came from the advertisement. Anything you save here replaces them.
                    </span>`
                  : null}
              </div>
            </div>
          `
        : null}

      ${counts.length > 0 ? html`<${AnswerCounts} counts=${counts} />` : null}
    </div>
  `;
}

/** The caret, at the size a disclosure row wants it. */
const ChevronRightSmall = () => html`
  <svg viewBox="0 0 24 24" width="0.85em" height="0.85em" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"
    class="icon"><path d="m9 18 6-6-6-6" /></svg>
`;

/** One row per question: how long the answer is, and whether that is a problem. */
function AnswerCounts({ counts }) {
  return html`
    <ul class="counts">
      ${counts.map(
        (c, i) => html`
          <li key=${i} class=${`count ${c.over ? 'over' : ''} ${c.words === 0 ? 'empty' : ''}`}>
            <span class="count-q">${c.question}</span>
            <span class="count-n num">
              ${c.words === 0
                ? 'not answered'
                : c.wordLimit
                  ? `${c.words} / ${c.wordLimit} words`
                  : `${c.words} words`}
            </span>
          </li>
        `,
      )}
    </ul>
  `;
}

/**
 * Deleting an application.
 *
 * Two clicks, and the second one is a different button in a different place —
 * not a browser confirm(), which is a modal you dismiss by reflex, and not a
 * single red button, which is a thing you hit while reaching for something else.
 * The second click says what will go, counted, because "delete this?" is a
 * question nobody can answer without knowing that.
 *
 * The deletion is real: the job record, every draft version, the conversations,
 * the exported .tex. No archive, no hidden pile — an "archived" flag is a screen
 * somebody eventually has to build and nobody ever wants.
 */
function DeleteJob({ job, onDeleted }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Disarms itself. A confirmation left sitting on screen becomes something you
  // clicks a minute later having forgotten what it was for.
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [armed]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteJob(job.id);
      onDeleted?.();
    } catch (err) {
      setError(err);
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  const drafts = Object.keys(job.docs ?? {}).length;

  if (!armed) {
    return html`
      <div class="delete-job">
        ${error ? html`<${ErrorBanner} error=${error} />` : null}
        <button class="link-button danger" type="button" onClick=${() => setArmed(true)}>Delete</button>
      </div>
    `;
  }

  return html`
    <div class="delete-job armed">
      <span class="delete-what">
        Delete this application${drafts > 0 ? ` and its ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}?
        This cannot be undone.
      </span>
      <button class="button danger" type="button" disabled=${busy} onClick=${remove}>
        ${busy ? html`<${Thinking} word="Deleting" showTime=${false} />` : 'Delete it'}
      </button>
      <button class="link-button" type="button" onClick=${() => setArmed(false)}>Keep it</button>
    </div>
  `;
}

/**
 * What you want from THIS application, written before anything is generated.
 *
 * The gap this fills: you could only steer the model after seeing what it wrote.
 * "Mention my E-3 eligibility in the header" meant generate, read, open the
 * chat, ask, wait again — two model calls and a rewrite to get what one call
 * would have produced if it had been told. Now it is told.
 *
 * Saved on blur rather than on a button. A note is a scrap of thought, and a
 * scrap of thought behind a Save button is a scrap of thought that gets lost.
 */
function NotesPanel({ jobId, notes }) {
  const [text, setText] = useState(notes ?? '');
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(Boolean(notes));

  useEffect(() => {
    setText(notes ?? '');
  }, [jobId]);

  const save = async () => {
    if (text === (notes ?? '')) return;
    setError(null);
    try {
      await api.setNotes(jobId, text);
      setSaved(Date.now());
      setTimeout(() => setSaved(null), 2000);
    } catch (err) {
      setError(err);
    }
  };

  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

  return html`
    <div class=${`disclosure ${open ? 'open' : ''}`}>
      <button class="disclosure-toggle" type="button" onClick=${() => setOpen(!open)} aria-expanded=${open}>
        <span class="disclosure-caret"><${ChevronRightSmall} /></span>
        <strong>Your notes for this application</strong>
        <span class="disclosure-note">
          ${words === 0 ? 'nothing yet' : `${words} word${words === 1 ? '' : 's'} — used by every draft here`}
        </span>
        ${saved ? html`<span class="saved-tick"><${Check} size="0.85em" /> saved</span>` : null}
      </button>

      ${open
        ? html`
            <div class="disclosure-body">
              <p class="muted small">
                Read at the top of the brief, before the advertisement and before your records —
                so it is the first thing the model weighs. Say what to lead with, what to leave
                out, what to mention. <strong>It cannot make something true:</strong> ask for a
                claim no record supports and it will do the closest honest thing and report the
                gap.
              </p>
              ${error ? html`<${ErrorBanner} error=${error} />` : null}
              <label class="visually-hidden" for="job-notes">Notes for this application</label>
              <textarea
                id="job-notes"
                class="questions-input"
                rows="4"
                placeholder=${'e.g. Mention my E-3 eligibility in the header — they are US-based.\nLead with the evaluation platform, not the doctorate.\nKeep the teaching to one line.'}
                value=${text}
                onInput=${(e) => setText(e.target.value)}
                onBlur=${save}
              ></textarea>
            </div>
          `
        : null}
    </div>
  `;
}

/**
 * The master profile, beside the draft, one click from being in it.
 *
 * For when the selector capped a record out or the model picked the wrong one.
 * The alternative was opening master-profile.md in a text editor and copying by
 * hand, which is the app admitting it has no answer — and the record it inserts
 * is the record's OWN words, not a summary, because the whole premise is that a
 * judgement about this record was already made wrongly once.
 */
function RecordPicker({ onInsert, disabled }) {
  const [records, setRecords] = useState(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || records) return;
    api.evidence().then((data) => setRecords(data.records ?? [])).catch(() => setRecords([]));
  }, [open, records]);

  const needle = query.trim().toLowerCase();
  const shown = (records ?? []).filter(
    (r) =>
      needle === '' ||
      [r.id, r.title, r.org, ...(r.tags ?? [])].filter(Boolean).join(' ').toLowerCase().includes(needle),
  );

  return html`
    <div class=${`disclosure ${open ? 'open' : ''}`}>
      <button class="disclosure-toggle" type="button" onClick=${() => setOpen(!open)} aria-expanded=${open}>
        <span class="disclosure-caret"><${ChevronRightSmall} /></span>
        <strong>Add a record the model left out</strong>
        <span class="disclosure-note">from your master profile, as written</span>
      </button>

      ${open
        ? html`
            <div class="disclosure-body">
              <p class="muted small">
                Inserted at the end of the draft in the record's own words — move it where it
                belongs and edit it down. Nothing here calls a model, so it costs nothing and
                cannot reword anything.
              </p>
              <label class="visually-hidden" for="record-search">Search your records</label>
              <input
                id="record-search"
                class="record-search"
                type="search"
                placeholder="Search by title, organisation, tag or id…"
                value=${query}
                onInput=${(e) => setQuery(e.target.value)}
              />
              ${records === null
                ? html`<p class="muted small"><${Thinking} word="Reading your profile" showTime=${false} /></p>`
                : html`
                    <ul class="record-list">
                      ${shown.slice(0, 40).map(
                        (r) => html`
                          <li key=${r.id} class="record">
                            <span class="record-what">
                              <span class="record-title">${r.title || r.id}</span>
                              ${r.org ? html`<span class="record-org">${r.org}</span>` : null}
                              <span class="record-id">${r.id}</span>
                            </span>
                            <button
                              class="button small"
                              type="button"
                              disabled=${disabled}
                              onClick=${() => onInsert(r.markdown)}
                            >Insert</button>
                          </li>
                        `,
                      )}
                    </ul>
                    ${shown.length === 0
                      ? html`<p class="muted small">Nothing matches “${query}”.</p>`
                      : null}
                    ${shown.length > 40
                      ? html`<p class="muted small">${shown.length - 40} more — narrow the search.</p>`
                      : null}
                  `}
            </div>
          `
        : null}
    </div>
  `;
}

/**
 * Which papers go on the CV. Tick boxes rather than free text, and the citation
 * beside each one is rendered from `master-profile.md` in APA by the server —
 * the model is never asked to write one. A citation is the single most
 * checkable thing on a CV: a reader pastes the title into Scholar and knows in
 * ten seconds whether the year and the venue are right, so it must be a
 * function of the record and nothing else.
 *
 * Collapsed by default. Most of the time the proposal is right and this is one
 * more thing between you and the draft; the summary line says what it chose so
 * you can ignore it with confidence.
 *
 * A tick changes NOTHING on disk. It used to rewrite the saved CV and store a
 * version, which cost real work: ticking mid-edit rebuilt the draft from the
 * last SAVED text and silently threw away whatever was in the editor. Now the
 * choice is recorded, and the citations are put into the document on the way out
 * — print view, .tex and PDF all render them from the records.
 */
function PublicationPicker({ jobId }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stale = false;
    api.publications(jobId).then((data) => {
      if (!stale) setState(data);
    }).catch(() => {});
    return () => {
      stale = true;
    };
  }, [jobId]);

  if (!state) return null;

  const items = state.publications ?? [];
  if (items.length === 0) return null;

  const chosen = items.filter((p) => p.selected);
  const problems = items.filter((p) => (p.problems ?? []).length > 0);

  const toggle = async (id) => {
    const next = items.filter((p) => (p.id === id ? !p.selected : p.selected)).map((p) => p.id);
    // Optimistic, so ticking a box feels like ticking a box; the server's answer
    // replaces it a moment later and wins if they ever differ.
    setState({ ...state, publications: items.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)) });
    setBusy(true);
    setError(null);
    try {
      setState(await api.setPublications(jobId, next));
    } catch (err) {
      setError(err);
      setState(await api.publications(jobId).catch(() => state));
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class=${`disclosure ${open ? 'open' : ''}`}>
      <button class="disclosure-toggle" type="button" onClick=${() => setOpen(!open)} aria-expanded=${open}>
        <span class="disclosure-caret"><${ChevronRightSmall} /></span>
        <strong>Publications</strong>
        <span class="disclosure-note">
          <span class="num">${chosen.length}</span> of <span class="num">${items.length}</span>
          ${state.chosenBy === 'human' ? ' — your choice' : ' — proposed for this job'}
        </span>
        ${problems.length > 0 ? html`<span class="disclosure-problem">${problems.length} need a look</span>` : null}
      </button>

      ${open
        ? html`
            <div class="disclosure-body">
              <p class="muted small">
                Rendered in APA from <code>data/profile/master-profile.md</code>. The model never writes
                a citation — it only refers to the work in prose.
                <strong>Ticking never touches your draft.</strong> The choice is recorded here and
                the citations are put in when the CV leaves the app — print view, .tex and PDF —
                so nothing you have typed can be overwritten by a tick.
              </p>
              ${error ? html`<${ErrorBanner} error=${error} />` : null}
              <ul class="pubs-list">
                ${items.map(
                  (p) => html`
                    <li key=${p.id} class=${`pub ${p.selected ? 'on' : ''}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked=${p.selected}
                          disabled=${busy}
                          onChange=${() => toggle(p.id)}
                        />
                        <span class="pub-body">
                          <span class="pub-apa" dangerouslySetInnerHTML=${{ __html: emphasise(p.apa) }}></span>
                          <span class="pub-meta">
                            <span class=${`pub-status status-${p.status}`}>${p.status.replace(/-/g, ' ')}</span>
                            ${p.firstAuthor ? html`<span class="pub-first">first author</span>` : null}
                            ${p.note ? html`<span class="muted">${p.note}</span>` : null}
                          </span>
                          ${(p.problems ?? []).map(
                            (problem, i) => html`<span class="pub-warn" key=${i}>${problem}</span>`,
                          )}
                        </span>
                      </label>
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
 * `*Journal*, *12*(3)` into italics for display only.
 *
 * The APA string is server-rendered markdown and the asterisks are meaningful,
 * so everything is escaped first and only the emphasis is put back — the value
 * came from your own profile file, but escaping is what makes that irrelevant.
 */
function emphasise(text) {
  const escaped = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Where the model is up to, and nothing else. It appears when a generation
 * starts and takes itself away a moment after it finishes — fleeting and clean,
 * so it does not linger.
 *
 * It polls the SERVER's run record rather than a local "am I busy" flag, and
 * that difference is the whole feature. Generation now returns the moment the
 * work starts, so the run outlives the click, the panel and the page: you can
 * start a CV, go to another application, start that one, and come back to find
 * both either finished or still going. A local flag would have said "idle" the
 * second you navigated, about work that was very much still happening.
 *
 * There is no percentage anywhere in this, on purpose. The writing step is most
 * of the wait and nobody can know how long it will take, so a bar would speed
 * up, stall at 90%, and teach you to distrust it. Steps that really happened,
 * plus a seconds counter that is simply true, are worth more.
 */
function GenerationProgress({ jobId, kind, onRunning, onFinished }) {
  const [progress, setProgress] = useState(null);
  const wasRunning = useRef(false);

  // Polled whether or not this page started the run. The first poll is what
  // tells a freshly-opened screen that something is already being written for
  // it, which is exactly the case a local flag could never cover.
  useEffect(() => {
    let stopped = false;
    let timer = null;

    const poll = async () => {
      try {
        const data = await api.progress(jobId, kind);
        if (stopped) return;
        setProgress(data.progress);

        const running = data.progress?.running === true;
        onRunning?.(running);
        // The edge that matters: it WAS running and now is not. That is the
        // moment the document on disk changed, and the only moment worth
        // re-reading it — polling the job every second would be wasteful and
        // would fight the editor for what is in the box.
        if (wasRunning.current && !running) onFinished?.(data.progress);
        wasRunning.current = running;
      } catch {
        /* the run reports its own failure; this is only the commentary on it */
      }
    };

    poll();
    // Slower when nothing is happening: this runs on every job screen now, and
    // a poll every 600ms forever to learn "still nothing" is rude to a laptop.
    timer = setInterval(poll, wasRunning.current ? 600 : 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, kind, progress?.running]);

  if (!progress) return null;

  const done = progress.done ?? [];
  const finished = !progress.running;
  const failed = progress.outcome === 'failed';

  return html`
    <div class=${`progress ${finished ? 'progress-done' : ''} ${failed ? 'progress-failed' : ''}`}>
      <div class="progress-steps">
        ${STEP_LABELS.map(({ id, label }) => {
          const state = done.includes(id) ? 'done' : progress.step === id ? 'now' : 'todo';
          return html`<span key=${id} class=${`progress-step ${state}`}>${label}</span>`;
        })}
      </div>
      <div class="progress-line">
        ${failed
          ? html`<span class="progress-now">stopped — ${progress.error}</span>`
          : finished
            ? html`<span class="progress-now">done</span>`
            : html`<${Thinking} word=${progress.label ?? 'Working'} showTime=${false} />`}
        <span class="progress-time num">${Math.round((progress.elapsedMs ?? 0) / 1000)}s</span>
      </div>
    </div>
  `;
}

// Kept next to the component that draws them. The server owns the step ids; if
// it ever reports one that is not here it simply is not drawn, which is the
// right failure for a progress display.
const STEP_LABELS = [
  { id: 'selecting', label: 'evidence' },
  { id: 'briefing', label: 'brief' },
  { id: 'writing', label: 'writing' },
  { id: 'checking', label: 'checks' },
  { id: 'saving', label: 'saved' },
];

/**
 * Copy the email to the clipboard — the only export an email needs.
 *
 * It copies what is in the editor, unsaved edits included, because that is what
 * is on screen and what you means by "this email". Everything else in the app
 * exports the saved copy; this is the one place where following the eye is more
 * honest than following the file.
 */
function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text ?? '');
      setDone(true);
      setFailed(false);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // A browser can refuse the clipboard outright — over plain http on some
      // configurations, or without a user gesture it recognises. Saying so
      // beats a button that silently does nothing.
      setFailed(true);
    }
  };

  return html`
    <span class="export-group">
      <button class=${`button ${done ? 'copied' : ''}`} onClick=${copy}>
        ${done ? html`<${Check} size="1.05em" /> Copied` : html`<${Copy} size="1.05em" /> Copy the email`}
      </button>
      ${failed
        ? html`<div class="export-note">Your browser would not let the page use the clipboard.
            Select the text in the box and copy it yourself.</div>`
        : null}
    </span>
  `;
}

/**
 * Export buttons. Two things they do that a plain link could not:
 *
 * 1. Save first when there are unsaved edits. Exporting reads what is on disk,
 *    so exporting with an unsaved textarea would hand you a PDF of the previous
 *    draft — the exact complaint that started this.
 * 2. Fetch rather than navigate, so a failed compile can show the LaTeX error
 *    instead of the browser saving an error page as "cv.pdf".
 */
function ExportButtons({ jobId, kind, version, onSaveFirst }) {
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.latexEngine().then(setEngine).catch(() => setEngine({ available: false, hint: null }));
  }, []);

  const download = (what) => async () => {
    setBusy(what);
    setStartedAt(Date.now());
    setError(null);
    try {
      // Always save first: the export reads what is on disk, and working out
      // whether the box is dirty from up here was one more thing to get wrong.
      await onSaveFirst?.();
      const url = what === 'pdf' ? api.pdfUrl(jobId, kind, version) : api.latexUrl(jobId, kind, version);
      await downloadFile(url);
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
      setStartedAt(null);
    }
  };

  return html`
    <span class="export-group">
      <button class="button primary" disabled=${busy !== ''} onClick=${download('pdf')}
        title=${engine && !engine.available ? 'Needs a LaTeX engine installed' : 'Compile and download the PDF'}>
        ${busy === 'pdf'
          ? html`<${Thinking} word="Compiling" since=${startedAt} />`
          : html`<${Download} size="1.05em" /> Download PDF`}
      </button>
      <button class="button" disabled=${busy !== ''} onClick=${download('tex')}
        title="The LaTeX source — for overleaf.com, which needs nothing installed">
        ${busy === 'tex' ? html`<${Thinking} word="Building" showTime=${false} />` : '.tex'}
      </button>
      ${engine && !engine.available && engine.hint
        ? html`<div class="export-note">${engine.hint} Until then, use <strong>.tex</strong> and
            upload it to overleaf.com.</div>`
        : null}
      ${error ? html`<div class="export-error">${error.message}</div>` : null}
    </span>
  `;
}

/**
 * Which of the advertisement's own words the draft actually uses.
 *
 * This is the one panel that is about the machine reading the CV rather than the
 * person. Most applications are term-matched before anybody opens them, and a
 * draft that describes the right work in its own vocabulary scores nothing on
 * the term that was searched for.
 *
 * Collapsed by default and never framed as a score out of ten. A missing term is
 * information, not a fault: some of them are things you genuinely have not done,
 * and the right response to those is to leave them missing rather than to write
 * a sentence that gets found out in an interview.
 */
function KeywordPanel({ jobId, kind, docVersion }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stale = false;
    api.keywords(jobId, kind).then((data) => {
      if (!stale) setState(data);
    }).catch(() => {});
    return () => {
      stale = true;
    };
  }, [jobId, kind, docVersion]);

  if (!state?.available || state.keywords.length === 0 || state.score === null) return null;

  const percent = Math.round(state.score * 100);
  const tone = percent >= 75 ? 'good' : percent >= 50 ? 'fair' : 'thin';

  return html`
    <div class=${`pubs keywords ${open ? 'open' : ''}`}>
      <button class="pubs-toggle" onClick=${() => setOpen(!open)} aria-expanded=${open}>
        <span class="pubs-caret" aria-hidden="true"></span>
        <strong>The advertisement's words</strong>
        <span class="muted">
          ${state.covered.length} of ${state.keywords.length} used
        </span>
        <span class=${`kw-score ${tone}`}>${percent}%</span>
      </button>

      ${open
        ? html`
            <div class="pubs-body">
              <p class="muted small">
                Applicant tracking systems, and recruiters searching them, match on these terms.
                Where a bullet already describes work you did, using the ad's word for it costs
                nothing. <strong>Where you have not done the thing, leave the term missing</strong> —
                that is what it is for.
              </p>
              <div class="kw-lists">
                <div>
                  <h4 class="kw-head">Missing (${state.missing.length})</h4>
                  <ul class="kw-list">
                    ${state.missing.map((k) => html`<${Keyword} keyword=${k} used=${false} />`)}
                  </ul>
                </div>
                <div>
                  <h4 class="kw-head">Used (${state.covered.length})</h4>
                  <ul class="kw-list">
                    ${state.covered.map((k) => html`<${Keyword} keyword=${k} used=${true} />`)}
                  </ul>
                </div>
              </div>
            </div>
          `
        : null}
    </div>
  `;
}

/**
 * A recruiter's read of the saved draft.
 *
 * The fit score reads your profile and answers "is this worth applying for". This
 * reads the document and answers "does it do you justice", which is a different
 * question with a different answer — a draft can be honest, well cited, pass
 * every check, and still bury the thing this employer cares about.
 *
 * It costs a model call, so nothing happens until the button is pressed. A review
 * of an older version is shown as stale rather than hidden: knowing the verdict
 * was about a previous draft is useful, and quietly presenting it as current
 * would not be.
 */
function RecruiterPanel({ jobId, kind, docVersion }) {
  const [state, setState] = useState(null);
  const [stale, setStale] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let dropped = false;
    api
      .savedReview(jobId, kind)
      .then((data) => {
        if (dropped) return;
        setState(data.review);
        setStale(data.stale === true);
        if (data.review && !data.stale) setOpen(true);
      })
      .catch(() => {});
    return () => {
      dropped = true;
    };
  }, [jobId, kind, docVersion]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { review } = await api.review(jobId, kind);
      setState(review);
      setStale(false);
      setOpen(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const verdict = state?.verdict ?? null;
  const label = { interview: 'would interview', maybe: 'on the maybe pile', pass: 'would pass' }[verdict] ?? '';

  return html`
    <div class=${`disclosure recruiter ${open ? 'open' : ''}`}>
      <button class="disclosure-toggle" type="button" onClick=${() => setOpen(!open)} aria-expanded=${open}>
        <span class="disclosure-caret"><${ChevronRightSmall} /></span>
        <strong>Recruiter's read</strong>
        <span class="disclosure-note">
          ${state
            ? html`<span class=${`rec-verdict rec-${verdict}`}>${label}</span>${stale
                ? html`<span class="muted"> — of an earlier draft</span>`
                : null}`
            : html`<span class="muted">a screener reads this draft against the ad</span>`}
        </span>
      </button>

      ${open
        ? html`
            <div class="disclosure-body">
              <p class="muted small">
                A model plays the person screening applications for this role, reads
                <strong>the saved draft</strong> — not your profile — against the advertisement, and
                says what it would do with it. Its suggestions are checked against your records
                before you see them, so it cannot invent something for you to claim.
              </p>

              <${ErrorBanner} error=${error} />

              <div class="row">
                <button type="button" class="button primary" disabled=${busy} onClick=${run}>
                  ${busy ? html`<${Working} />` : html`<${Sparkles} size="1em" />`}
                  ${state ? 'Read it again' : 'Get a recruiter\'s read'}
                </button>
                ${state?.costCents
                  ? html`<span class="muted small">last read cost ${centsToDollars(state.costCents)}</span>`
                  : html`<span class="muted small">a few cents of model time</span>`}
              </div>

              ${stale
                ? html`<${Notice} kind="warn" live=${false}>
                    This was a read of version ${state.version}, and you are looking at version${' '}
                    ${docVersion}. Run it again for a verdict on what is on screen.
                  <//>`
                : null}

              ${state ? html`<${ReviewBody} review=${state} />` : null}
            </div>
          `
        : null}
    </div>
  `;
}

/** The findings, ordered by what it costs to ignore them. */
function ReviewBody({ review }) {
  return html`
    ${review.firstImpression
      ? html`<p class="rec-impression">${review.firstImpression}</p>`
      : null}

    ${review.concerns.length > 0
      ? html`
          <h4 class="rec-head">What would make them hesitate (${review.concerns.length})</h4>
          <ul class="rec-list">
            ${review.concerns.map(
              (item, i) => html`
                <li key=${i} class="rec-concern">
                  <span class="rec-what"><${Alert} size="0.95em" /> ${item.concern}</span>
                  ${item.fix ? html`<span class="rec-fix">${item.fix}</span>` : null}
                </li>
              `,
            )}
          </ul>
        `
      : null}

    ${review.records.length > 0
      ? html`
          <h4 class="rec-head">In your profile, missing from this draft (${review.records.length})</h4>
          <p class="muted small">
            You have these and this application does not use them. Paste one in with${' '}
            <em>Add a record the model left out</em> above, or say so in your notes and generate again.
          </p>
          <ul class="rec-list">
            ${review.records.map(
              (item) => html`
                <li key=${item.id} class="rec-record">
                  <span class="rec-what">
                    <strong>${item.title}</strong>${' '}
                    ${item.org ? html`<span class="muted">· ${item.org}</span>` : null}
                    <code class="record-id">${item.id}</code>
                  </span>
                  ${item.why ? html`<span class="rec-fix">${item.why}</span>` : null}
                </li>
              `,
            )}
          </ul>
        `
      : null}

    ${review.keywords.length > 0
      ? html`
          <h4 class="rec-head">The ad's words for things you have done (${review.keywords.length})</h4>
          <p class="muted small">
            Each one is a wording change with a record behind it, named below. Nothing here asks you
            to claim something new.
          </p>
          <ul class="rec-list">
            ${review.keywords.map(
              (item) => html`
                <li key=${item.term} class="rec-keyword">
                  <span class="rec-what">
                    <strong>${item.term}</strong>${' '}
                    <span class="muted">from ${item.supportedByTitle ?? item.supportedBy}</span>
                    <code class="record-id">${item.supportedBy}</code>
                  </span>
                  ${item.where ? html`<span class="rec-fix">${item.where}</span>` : null}
                </li>
              `,
            )}
          </ul>
        `
      : null}

    ${review.strengths.length > 0
      ? html`
          <h4 class="rec-head">What is working (${review.strengths.length})</h4>
          <ul class="rec-list">
            ${review.strengths.map(
              (point, i) => html`<li key=${i} class="rec-strength"><${Check} size="0.95em" /> ${point}</li>`,
            )}
          </ul>
        `
      : null}

    ${review.dropped.length > 0
      ? html`
          <details class="rec-dropped">
            <summary>${review.dropped.length} suggestion${review.dropped.length === 1 ? '' : 's'} thrown away</summary>
            <p class="muted small">
              Checked against your records and rejected before you saw them. Usually a term the ad
              never used, or a record id that does not exist.
            </p>
            <ul class="rec-list">
              ${review.dropped.map(
                (item, i) => html`<li key=${i} class="muted small"><strong>${item.term}</strong> — ${item.reason}</li>`,
              )}
            </ul>
          </details>
        `
      : null}

    ${review.concerns.length === 0 && review.records.length === 0 && review.keywords.length === 0
      ? html`<p class="muted">Nothing it would change. Send it.</p>`
      : null}
  `;
}

/**
 * One term, marked with where the advertisement used it.
 *
 * The terms arrive heaviest-first, and without this the ordering is invisible:
 * a missing must-have and a missing nice-to-have look identical, so the list
 * reads as a flat pile of words to stuff in. A must-have the draft does not use
 * is the one worth acting on, and it is the one this makes look different.
 */
function Keyword({ keyword, used }) {
  const sources = keyword.sources ?? [];
  const required = sources.includes('must-have');
  return html`
    <li
      class=${`kw ${used ? 'used' : 'missing'}${required ? ' required' : ''}`}
      title=${`${keyword.term} — ${sources.join(', ')}`}
    >
      ${keyword.term}
    </li>
  `;
}

/**
 * What the checks found, arranged so the important thing is visible.
 *
 * The flat list this replaces was technically complete and practically useless:
 * thirteen entries in document order, twelve of them the same terminology note
 * repeated with the same trailing sentence, and the one finding that mattered —
 * a claim that the doctorate had been awarded — last on the list where nobody
 * would reach it. A panel you scroll past costs you the findings you would have
 * acted on.
 *
 * So: grouped by rule, ordered by how much it matters rather than where it
 * appears, and terminology folded to one row per term with a count.
 */
function FlagsPanel({ version }) {
  if (!version) return null;
  const errors = version.flags?.errors ?? [];
  const warnings = version.flags?.warnings ?? [];
  const gaps = version.gaps ?? [];
  const all = [...errors.map((f) => ({ ...f, severity: 'error' })), ...warnings.map((f) => ({ ...f, severity: 'warning' }))];

  const groups = groupFlags(all);
  const advisory = all.some((f) => f.rule === 'R8');
  const wording = groups.find((g) => g.rule === 'R6');
  const substantive = all.length - (wording?.flags.length ?? 0);

  return html`
    <div class="flags">
      <h3>Checks</h3>
      <div class="flags-summary">
        ${all.length === 0
          ? html`<span class="flag-count clean"><${Check} size="0.95em" /> all checks passed</span>`
          : html`
              ${substantive > 0
                ? html`<span class=${`flag-count ${errors.length > 0 ? 'error' : 'warning'}`}>
                    <${Alert} size="0.95em" /> ${substantive} to look at
                  </span>`
                : null}
              ${wording
                ? html`<span class="flag-count muted-count">${wording.terms.length} wording note${wording.terms.length === 1 ? '' : 's'}</span>`
                : null}
            `}
        ${advisory ? html`<span class="flags-advisory">advisory — you have edited this, so nothing here blocks you</span>` : null}
      </div>

      ${all.length === 0
        ? html`<p class="muted small">Every bullet cites a record, and every figure in the draft
            appears in a record it cites.</p>`
        : null}

      ${groups.map((group) => html`<${FlagGroup} key=${group.rule} group=${group} />`)}

      ${gaps.length > 0
        ? html`
            <h3>The model wanted more</h3>
            <ul>
              ${gaps.map(
                (g, i) => html`<li key=${i}>
                  the model wanted: ${g.wanted} — for <code>${g.evidence_id}</code>
                </li>`,
              )}
            </ul>
            <p class="muted small">
              These are the places it had no fact to use. If the fact is real, add it on the
              <a href="#/profile">Profile</a> screen and generate again.
            </p>
          `
        : null}
      ${(version.changes_made ?? []).length > 0
        ? html`
            <h3>What it chose to do</h3>
            <ul>${version.changes_made.map((c, i) => html`<li key=${i}>${c}</li>`)}</ul>
          `
        : null}
    </div>
  `;
}

/**
 * One rule, one block. R6 gets its own shape because it is the only rule that
 * fires many times for the same underlying reason — the same term in eight
 * bullets is one decision to make, not eight.
 */
function FlagGroup({ group }) {
  const worst = group.flags.some((f) => f.severity === 'error') ? 'error' : 'warning';

  if (group.rule === 'R6') {
    return html`
      <div class="flag-group wording">
        <div class="flag-group-head">
          <strong><${Info} size="1em" /> ${group.title}</strong>
          <span class="muted small">
            ${group.terms.length} term${group.terms.length === 1 ? '' : 's'}, ${group.flags.length} place${group.flags.length === 1 ? '' : 's'}
          </span>
        </div>
        <p class="muted small">
          The advertisement never uses these, and its reader is not a specialist in them.
          Generalising a name is fine; overstating the work is not — so change them only where
          the plainer wording is still true.
        </p>
        <ul class="term-list">
          ${group.terms.map(
            (term) => html`
              <li key=${term.term}>
                <span class="term-name">${term.term}</span>
                ${term.count > 1 ? html`<span class="term-count num">${term.count} places</span>` : null}
                <span class="term-arrow" aria-hidden="true">→</span>
                <span class="term-plain">${term.translation}</span>
              </li>
            `,
          )}
        </ul>
      </div>
    `;
  }

  return html`
    <div class=${`flag-group ${worst}`}>
      <div class="flag-group-head">
        <strong><${Alert} size="1em" /> ${group.title}</strong>
        <span class="muted small">
          ${group.flags.length > group.items.length
            ? `${group.flags.length} places · ${group.rule}`
            : group.rule}
        </span>
      </div>
      ${group.items.map(
        (item, i) => html`
          <div class=${`flag-item ${item.severity === 'error' ? 'is-error' : ''}`} key=${i}>
            <div>${item.text}</div>
            ${item.refs.length > 0
              ? html`<span class="ref">${item.refs.join(' · ')}</span>`
              : null}
          </div>
        `,
      )}
      ${/* Said once for the group rather than under every finding. On a real
           draft this sentence was most of the panel's height. */ ''}
      ${group.advice ? html`<p class="flag-advice">${group.advice}</p>` : null}
    </div>
  `;
}
