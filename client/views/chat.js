// WHY: the revise box was a text input that replaced its own answer each time.
// You could not see what you had already asked, the model could not either, and
// the obvious follow-up — "no, shorter" — meant nothing to it. This is the same
// feature as a conversation: a panel that slides over the document, keeps the
// exchange, and shows the model's actual words rather than a summary of them.
//
// A drawer rather than a separate window on purpose. The thing being discussed
// is the draft, and a second browser window would put it on another screen,
// out of sight, with its own copy of the state to keep in step.
import { html, useState, useEffect, useRef } from '../vendor/ui.js';
import { api, centsToDollars } from '../api.js';
import { Thinking } from './thinking.js';
import { renderMarkdown } from './markdown.js';
import { Portal } from './portal.js';
import { Close, ArrowUp, Working, Quote } from './icons.js';

/** The two things you can want, in the words that describe what happens. */
const PLACEHOLDER = {
  ask: 'Ask what a line claims, or why it says that…',
  edit: 'Say what to change, and it rewrites the draft…',
};

/** Longest quote we will send. The server slices at the same length. */
const MAX_QUOTE = 2000;

/** What to call the thing being discussed, in the words you would use for it. */
const KIND_LABEL = { cv: 'CV', 'cover-letter': 'cover letter', criteria: 'set of answers', 'cold-email': 'email' };

/**
 * The conversation about one document.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {string} props.markdown what is in the editor right now, unsaved edits
 *   included — the model should answer about what you are looking at
 * @param {string} [props.selection] whatever is highlighted in the editor right
 *   now, so a question can be about one paragraph rather than the whole document
 * @param {boolean} [props.modal] whether this is the only thing on screen. False
 *   when the profile panel is open beside it: two panels that both dim the page
 *   and both drag focus back inside themselves make each other unusable.
 * @param {Function} props.onRevised called with the new markdown after a rewrite
 * @param {Function} props.onBusy true while a turn is in flight, so the page can
 *   show that the draft is out of your hands
 */
export function ChatDrawer({ jobId, kind, open, onClose, markdown, selection = '', modal = true, onRevised, onBusy, onCost }) {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [askedAt, setAskedAt] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [deadlineMs, setDeadlineMs] = useState(null);
  // Ask, until you say otherwise. The two failure modes are not symmetric: being
  // stuck in Ask costs you one click, and being unexpectedly in Edit costs you a
  // draft you had been working on. See server/generate/revise.js, which enforces
  // the same default and throws away any rewrite made in Ask mode.
  const [mode, setMode] = useState('ask');
  const [quote, setQuote] = useState('');
  // null = not known yet, false = the server cannot honour Ask. See the effect
  // that reads /api/meta below.
  const [modesOk, setModesOk] = useState(null);
  // The id of the turn whose proposal is being saved, so only that card shows it.
  const [applying, setApplying] = useState(null);

  const scroller = useRef(null);
  const input = useRef(null);
  const inFlight = useRef(null);
  const panel = useRef(null);

  // How long the server will wait before giving up. Shown beside the counter,
  // because a number climbing with no stated end is the difference between
  // waiting and wondering whether it has hung — which is exactly what happened
  // at 557 seconds with no way to tell.
  useEffect(() => {
    api
      .meta()
      .then((meta) => {
        setDeadlineMs(meta.reviseTimeoutMs ?? null);
        // Explicitly true, or we assume not. A server started before the last
        // pull answers this route happily and has never heard of Ask — it would
        // rewrite the draft for a question, which is the one thing Ask promises
        // will not happen. `null` while unknown, so a failed request does not
        // raise a false alarm.
        setModesOk(meta.chatModes === true);
      })
      .catch(() => {});
  }, []);

  // Load the transcript the first time it opens, not on mount: most sessions
  // never open this, and it is one request per document.
  useEffect(() => {
    if (!open || loaded) return;
    api
      .chat(jobId, kind)
      .then((data) => {
        setTurns(data.turns ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded, jobId, kind]);

  // A new document is a new conversation — and a new decision about whether the
  // model may write to it. Carrying Edit across from the CV to the cover letter
  // would mean the first thing you typed there could rewrite it without you
  // having chosen that for this document.
  useEffect(() => {
    setTurns([]);
    setLoaded(false);
    setError(null);
    setMode('ask');
    setQuote('');
  }, [jobId, kind]);

  // Escape closes it, from anywhere — the panel covers the page, so the usual
  // way out (clicking past it) is not always available.
  //
  // Tab is trapped inside while it is MODAL. Without this the third Tab walked
  // out of the drawer and into the page behind it, which is still there and
  // still focusable — so a keyboard user ended up typing into the draft they
  // had just opened a conversation about, with no visible sign of where they
  // were. Focus goes back to the button that opened it on the way out; that is
  // handled by the caller, which is the only thing that knows what that was.
  //
  // The trap is off when the profile panel is open beside it, because then this
  // is not the only thing on screen and dragging focus back would make the panel
  // next to it unreachable from the keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modal) return;
      const focusable = panel.current?.querySelectorAll(
        'button:not([disabled]), [href], textarea:not([disabled]), input:not([disabled]), select:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Also catches focus having escaped already — from a click on the page
      // behind, say — and pulls it back rather than letting Tab continue there.
      if (!panel.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, modal]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // On a wide screen the page makes room instead of being covered — you are
  // discussing the draft, so hiding it behind the discussion is the one thing
  // this panel should not do. The class lives on <body> because the element
  // that has to move is an ancestor of this one.
  useEffect(() => {
    document.body.classList.toggle('chat-open', open);
    return () => document.body.classList.remove('chat-open');
  }, [open]);

  // Follow the conversation down as it grows, including while it is thinking.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy, open]);

  // The draft may be about to change under you, and the panel can be closed or
  // scrolled away from — so the page behind is told, and blurs the editor.
  //
  // The cleanup is not paperwork. `busy` makes the editor read-only, and if this
  // component goes away mid-request — switching tabs, leaving the page — nothing
  // else would ever say otherwise, and the box you type your CV into would stay
  // locked with no visible reason and no way back except a reload.
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy]);

  // Same reason, for the request itself: a turn in flight against the CV must not
  // still be running when the cover letter is on screen.
  useEffect(() => () => inFlight.current?.abort(), [jobId, kind]);

  const send = async () => {
    const instruction = draft.trim();
    if (instruction === '' || busy || blocked) return;
    const sending = { mode, quote };

    // Shown immediately, with a temporary id — waiting several seconds to see
    // your own message appear is the one thing a chat interface must not do.
    const pending = { id: `pending_${Date.now()}`, role: 'you', text: instruction, pending: true, ...sending };
    setTurns((current) => [...current, pending]);
    setDraft('');
    // The quote belongs to the question that has just gone, and it stays visible
    // on that turn. Leaving it pinned would silently attach it to the next one.
    setQuote('');
    setBusy(true);
    setAskedAt(Date.now());
    setError(null);

    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const result = await api.revise(jobId, kind, instruction, markdown, { ...sending, signal: controller.signal });
      // The server's own turns replace the optimistic one, so ids and
      // timestamps come from one place.
      setTurns((current) => [...current.filter((t) => t.id !== pending.id), ...(result.turns ?? [])]);
      // `sending.mode`, not the current mode, and not the server's word for it.
      // Two reasons: you may have switched the toggle while this was in flight,
      // and a server older than this page answers `revised: true` for a question
      // because it has never heard of Ask. The promise is kept on both sides.
      if (sending.mode === 'edit' && result.revised && result.markdown) onRevised?.(result.markdown);
      onCost?.();
    } catch (err) {
      // Stopping is not an error. The server is still working and will record
      // the answer whether or not this page is listening, so the honest thing
      // to say is "it may still arrive", with a way to go and look.
      if (err.type === 'aborted') {
        setTurns((current) => current.map((t) => (t.id === pending.id ? { ...t, pending: false, abandoned: true } : t)));
      } else {
        setError(err);
        // The question stays on screen — it was really asked, and the server
        // recorded it too. Marking it failed is better than removing it and
        // leaving you wondering whether it went.
        setTurns((current) => current.map((t) => (t.id === pending.id ? { ...t, pending: false, failed: true } : t)));
      }
    } finally {
      inFlight.current = null;
      setBusy(false);
      setAskedAt(null);
      input.current?.focus();
    }
  };

  /** Give up waiting. The request keeps running server-side; see `refresh`. */
  const stop = () => inFlight.current?.abort();

  /** Fetch the transcript again — for an answer that landed after you stopped. */
  const refresh = async () => {
    try {
      const data = await api.chat(jobId, kind);
      setTurns(data.turns ?? []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  };

  const clear = async () => {
    try {
      await api.clearChat(jobId, kind);
      setTurns([]);
      setError(null);
    } catch (err) {
      setError(err);
    }
  };

  const spent = turns.reduce((sum, turn) => sum + (turn.costCents ?? 0), 0);

  /**
   * Take a version the model wrote while you were only asking.
   *
   * It goes through the ordinary save — the same path as one of your own edits —
   * so it becomes a new version with the old one kept, and the validator sees it
   * exactly as it sees anything else. Ask still never changes the document on its
   * own; this is you deciding, with the text in front of you.
   */
  const applyProposal = async (turnId, proposal) => {
    setApplying(turnId);
    try {
      await api.saveDoc(jobId, kind, proposal);
      onRevised?.(proposal);
      // The offer is spent. Leaving it on screen would invite applying the same
      // rewrite twice, which makes two identical versions and reads as a bug.
      setTurns((current) => current.map((t) => (t.id === turnId ? { ...t, proposal: null, applied: true } : t)));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setApplying(null);
    }
  };

  const dismissProposal = (turnId) =>
    setTurns((current) => current.map((t) => (t.id === turnId ? { ...t, proposal: null, dismissed: true } : t)));

  /** Pin whatever is highlighted in the editor, so the question is about that. */
  const pinQuote = () => {
    const picked = selection.trim().slice(0, MAX_QUOTE);
    if (picked === '') return;
    setQuote(picked);
    input.current?.focus();
  };
  const canQuote = selection.trim() !== '' && selection.trim() !== quote;

  // Ask is a guarantee or it is nothing. Against a server that cannot keep it,
  // sending would rewrite the document — so the button says no and the banner
  // above says why. Edit is left alone: an old server does that correctly.
  const blocked = modesOk === false && mode === 'ask';

  // Portalled to <body>: this panel is fixed to the WINDOW, and where it sits in
  // the component tree would otherwise decide what "fixed" means. See portal.js.
  return html`
    <${Portal}>
    ${modal
      ? html`<div class=${`chat-scrim ${open ? 'open' : ''}`} onClick=${onClose} aria-hidden=${!open}></div>`
      : null}
    <aside
      ref=${panel}
      class=${`chat ${open ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label=${`Conversation about your ${KIND_LABEL[kind] ?? kind}`}
      aria-hidden=${!open}
    >
      <header class="chat-head">
        <div class="chat-title">
          <span class="chat-mark"><${Working} size="1.05em" /></span>
          <span>
            <strong>Your AI, on ${KIND_LABEL[kind] ? `this ${KIND_LABEL[kind]}` : kind}</strong>
            <span class="chat-sub">
              ${turns.length === 0 ? 'it can read your whole profile' : `${centsToDollars(spent)} of model time`}
            </span>
          </span>
        </div>
        <div class="chat-head-actions">
          ${turns.length > 0
            ? html`<button class="link-button" onClick=${clear} title="Forget this conversation. Your drafts are kept.">
                Clear
              </button>`
            : null}
          <button class="button ghost icon-only" onClick=${onClose} aria-label="Close this conversation">
            <${Close} size="1.1em" />
          </button>
        </div>
      </header>

      <div class="chat-log" ref=${scroller}>
        ${turns.length === 0 && loaded ? html`<${Empty} mode=${mode} onPick=${(text) => setDraft(text)} />` : null}
        ${turns.map(
          (turn) => html`<${Turn}
            key=${turn.id}
            turn=${turn}
            kind=${kind}
            onRefresh=${refresh}
            applying=${applying === turn.id}
            onApply=${() => applyProposal(turn.id, turn.proposal)}
            onDismiss=${() => dismissProposal(turn.id)}
          />`,
        )}
        ${busy ? html`<${Pending} since=${askedAt} deadlineMs=${deadlineMs} onStop=${stop} />` : null}
        ${error ? html`<div class="chat-error">${error.message}${error.hint ? html` ${error.hint}` : null}</div>` : null}
      </div>

      <div class="chat-composer">
        ${modesOk === false
          ? html`
              <div class="chat-stale">
                <strong>The server running is older than this page.</strong> It has not heard of Ask,
                so it would rewrite your draft to answer a question. Stop it in the terminal with
                Ctrl+C, run <code>npm start</code> again, then reload this page.
              </div>
            `
          : null}
        ${quote
          ? html`
              <div class="chat-quote">
                <blockquote>${quote}</blockquote>
                <button
                  class="button ghost icon-only chat-quote-drop"
                  onClick=${() => setQuote('')}
                  aria-label="Ask about the whole document instead"
                  title="Ask about the whole document instead"
                ><${Close} size="1em" /></button>
              </div>
            `
          : null}

        <div class="chat-compose">
          <textarea
            ref=${input}
            class="chat-input"
            rows="1"
            placeholder=${PLACEHOLDER[mode]}
            value=${draft}
            disabled=${busy}
            onInput=${(e) => {
              setDraft(e.target.value);
              // Grow with the text, up to a point, then scroll inside itself.
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown=${(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          ></textarea>
          <button
            class="button primary chat-send"
            disabled=${busy || draft.trim() === '' || blocked}
            onClick=${send}
            aria-label="Send"
          >
            ${busy ? html`<${Working} size="1.1em" />` : html`<${ArrowUp} size="1.1em" />`}
          </button>
        </div>

        <div class="chat-tools">
          <${ModePicker} mode=${mode} onPick=${setMode} disabled=${busy} kind=${kind} />
          ${canQuote
            ? html`<button class="chat-quote-add" onClick=${pinQuote} disabled=${busy}>
                <${Quote} size="1em" /> Quote what you highlighted
              </button>`
            : null}
        </div>
      </div>
      <p class="chat-foot">
        ${mode === 'edit'
          ? html`<strong>Edit</strong> rewrites the draft and saves it as a new version — the one
              before it is kept, so nothing is lost.`
          : html`<strong>Ask</strong> answers questions and never changes your draft. Switch to Edit
              when you want it to make the change.`}
        ${' '}Enter sends, Shift+Enter starts a new line.
      </p>
    </aside>
    <//>
  `;
}

/**
 * Ask or Edit, drawn as the choice it is.
 *
 * Plain buttons with `aria-pressed`, not a radio group: a radio group promises
 * arrow-key navigation between options, and this is a two-state switch you hit
 * once. The consequence is on the control itself rather than in a paragraph
 * below it, because the paragraph is what nobody reads before the rewrite lands.
 */
function ModePicker({ mode, onPick, disabled, kind }) {
  const what = KIND_LABEL[kind] ?? 'draft';
  const options = [
    ['ask', 'Ask', `Answer questions about this ${what}. It cannot change it.`],
    ['edit', 'Edit', `Let it rewrite this ${what}. Each rewrite is saved as a new version.`],
  ];
  return html`
    <div class="segmented" aria-label="What it is allowed to do">
      ${options.map(
        ([id, label, title]) => html`
          <button
            key=${id}
            class=${`segment ${mode === id ? 'on' : ''}`}
            onClick=${() => onPick(id)}
            disabled=${disabled}
            aria-pressed=${mode === id}
            title=${title}
          >${label}</button>
        `,
      )}
    </div>
  `;
}

/** What the box is for, said once, with examples you can send with one click. */
function Empty({ mode, onPick }) {
  const examples =
    mode === 'edit'
      ? [
          'make the third bullet concrete',
          'this reads as too junior — fix the tone',
          'add my research assistant role',
          'cut the summary to two lines',
        ]
      : [
          'why does the summary lead with the PhD?',
          'what does the third bullet actually claim?',
          'is anything here not backed by one of my records?',
          'what have I got that this draft leaves out?',
        ];
  return html`
    <div class="chat-empty">
      <p>
        It has <strong>every record in your profile</strong> and the advertisement, and it will
        refuse anything that would need a fact you do not have.
      </p>
      <p>
        ${mode === 'edit'
          ? html`In <strong>Edit</strong> it changes the draft and saves the result as a new version.
              Ask for one change at a time — the rest of the document comes back as it was.`
          : html`In <strong>Ask</strong> it only answers. Your draft is not touched, whatever it
              suggests. Highlight a passage in the editor — before opening this, or beside it on a
              wide screen — and you can quote it, so the question is about that passage alone.`}
      </p>
      <div class="chat-examples">
        ${examples.map(
          (text) => html`<button key=${text} class="chat-example" onClick=${() => onPick(text)}>${text}</button>`,
        )}
      </div>
    </div>
  `;
}

function Turn({ turn, kind, onRefresh, applying, onApply, onDismiss }) {
  const mine = turn.role !== 'model';

  if (mine) {
    return html`
      <div class=${`turn mine ${turn.failed ? 'failed' : ''} ${turn.pending ? 'pending' : ''}`}>
        ${turn.quote ? html`<blockquote class="turn-quote">${turn.quote}</blockquote>` : null}
        <div class="bubble">${turn.text}</div>
        ${turn.mode === 'edit' ? html`<div class="turn-mode">asked in Edit</div>` : null}
        ${turn.abandoned
          ? html`<div class="turn-abandoned">
              You stopped waiting. The model may still finish — ${' '}
              <button class="link-button" onClick=${onRefresh}>check for a reply</button>.
            </div>`
          : null}
      </div>
    `;
  }

  const label = KIND_LABEL[kind] ?? 'document';

  return html`
    <div class=${`turn theirs ${turn.failed ? 'failed' : ''}`}>
      <div class="answer">
        ${turn.proposal
          ? html`<div class="answer-warning">
              It has written this as though the change were already made. <strong>It is not</strong> —
              your ${label} is exactly as you left it.
            </div>`
          : null}
        <div class="answer-body" dangerouslySetInnerHTML=${{ __html: renderMarkdown(turn.text) }}></div>
        ${turn.revised
          ? html`<div class="answer-note revised">
              <strong>Rewrote the draft</strong> — saved as version ${turn.version}
            </div>`
          : null}
        ${(turn.changes_made ?? []).length > 0
          ? html`<ul class="answer-list">${turn.changes_made.map((c, i) => html`<li key=${i}>${c}</li>`)}</ul>`
          : null}
        ${(turn.declined ?? []).length > 0
          ? html`
              <div class="answer-note declined">
                <strong>Not done</strong>
                <ul class="answer-list">${turn.declined.map((d, i) => html`<li key=${i}>${d}</li>`)}</ul>
              </div>
            `
          : null}
        ${turn.proposal
          ? html`<${Proposal}
              markdown=${turn.proposal}
              changes=${turn.proposed_changes ?? []}
              label=${label}
              applying=${applying}
              onApply=${onApply}
              onDismiss=${onDismiss}
            />`
          : null}
        ${turn.applied
          ? html`<div class="answer-note revised"><strong>Applied</strong> — saved as a new version</div>`
          : null}
        ${turn.dismissed ? html`<div class="answer-note">Left as it was.</div>` : null}
        ${/* The warning above and the card's own subtitle already say the draft
              is untouched; a third copy underneath reads as the app protesting
              too much. The note still earns its place for the other case it
              covers — a rewrite claimed but not actually different. */
        turn.note && !turn.proposal && !turn.applied && !turn.dismissed
          ? html`<div class="answer-note declined">${turn.note}</div>`
          : null}
      </div>
    </div>
  `;
}

/**
 * A version the model wrote in Ask mode, offered rather than applied.
 *
 * Held instead of thrown away, because discarding it gave the worst of both: you
 * paid for the call, and the reply above described a document that did not exist.
 * The text is here to read before you decide — collapsed, because a whole CV
 * inside a chat bubble buries the answer you asked for.
 */
function Proposal({ markdown, changes, label, applying, onApply, onDismiss }) {
  return html`
    <div class="proposal">
      <div class="proposal-head">
        <strong>The version it wrote</strong>
        <span class="proposal-sub">not applied — your ${label} has not changed</span>
      </div>
      ${changes.length > 0
        ? html`<ul class="answer-list">${changes.map((c, i) => html`<li key=${i}>${c}</li>`)}</ul>`
        : null}
      <details class="proposal-body">
        <summary>Read it in full</summary>
        <pre>${markdown}</pre>
      </details>
      <div class="proposal-actions">
        <button class="button primary" onClick=${onApply} disabled=${applying}>
          ${applying ? html`<${Thinking} word="Saving" showTime=${false} />` : `Use this ${label}`}
        </button>
        <button class="link-button" onClick=${onDismiss} disabled=${applying}>Ignore it</button>
      </div>
      <p class="proposal-foot">
        Applying it saves a new version. The one you have now is kept, and the flags below are
        re-checked against whichever you end up with.
      </p>
    </div>
  `;
}

/**
 * The model's side, before it has said anything.
 *
 * The deadline is on screen because it is the difference between waiting and
 * wondering. A counter that reached 557 seconds with no stated end and no way
 * out is what prompted this; now it says where it stops, and Stop hands the
 * page back without pretending the request went away.
 */
function Pending({ since, deadlineMs, onStop }) {
  const limit = deadlineMs ? Math.round(deadlineMs / 1000) : null;
  return html`
    <div class="turn theirs">
      <div class="answer answer-thinking">
        <${Thinking} word="Thinking" since=${since} />
        <span class="chat-deadline">
          ${limit ? `gives up at ${limit}s` : ''}
        </span>
        <button class="link-button chat-stop" onClick=${onStop}>Stop</button>
      </div>
    </div>
  `;
}

export default ChatDrawer;
