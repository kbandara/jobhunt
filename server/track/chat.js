// WHY: the revise box was one-shot — you asked, it answered, and the answer
// replaced the previous one. That is not a conversation, and it made the
// obvious follow-up impossible: "no, shorter" meant nothing to a model with no
// memory of what it had just done, so every request had to be restated in full.
//
// So the exchange is kept, per document, and the model is shown it. Append-only
// JSONL beside the drafts it is about: the same shape as the event log, no
// migrations, and nothing corrupted if the process dies mid-write.
//
// Not stored in the job record on purpose. A transcript grows without bound and
// the job record is read on every board render.
import path from 'node:path';
import fs from 'node:fs';
import { appendJsonl, readJsonl } from '../store.js';
import { appDir } from './docs.js';

/**
 * How many earlier turns the model is shown.
 *
 * A bound rather than the whole history, because every turn is sent on every
 * request and you pay for the tokens. Eight is four exchanges — enough for
 * "shorter" / "no, the other one" to mean something, short of the point where
 * an old instruction starts competing with the current one.
 */
export const HISTORY_TURNS = 8;

/** Longest single message kept. Past this it is a paste, not a message. */
export const MAX_TEXT = 8000;

export function chatFile(dataDir, jobId, kind) {
  return path.join(appDir(dataDir, jobId), `chat-${kind}.jsonl`);
}

/** The whole conversation for one document, oldest first. */
export function readChat(dataDir, jobId, kind) {
  return readJsonl(chatFile(dataDir, jobId, kind)).filter((turn) => turn && typeof turn === 'object');
}

/**
 * Append one turn.
 *
 * @param {object} turn { role: 'you'|'model', text, ...anything the UI shows }
 * @returns {object} the turn as written, with its id and timestamp
 */
export function appendTurn(dataDir, jobId, kind, turn = {}) {
  const written = {
    // Time plus a counter: two turns in the same millisecond still get distinct
    // ids, and the client needs stable keys or the list re-animates on every
    // render.
    id: `t_${Date.now()}_${nextCounter()}`,
    ts: new Date().toISOString(),
    ...turn,
    role: turn.role === 'model' ? 'model' : 'you',
    text: String(turn.text ?? '').slice(0, MAX_TEXT),
  };
  appendJsonl(chatFile(dataDir, jobId, kind), written);
  return written;
}

/** Forget the conversation. The documents and their versions are untouched. */
export function clearChat(dataDir, jobId, kind) {
  try {
    fs.unlinkSync(chatFile(dataDir, jobId, kind));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * The recent exchange, rendered for the prompt.
 *
 * Plain text rather than a real multi-turn message list: every reply in this
 * feature is JSON against a schema, so prior assistant turns would be prior
 * JSON blobs — noisy to read and easy for a model to imitate structurally
 * instead of answering. What matters is what was asked and what was said.
 *
 * @returns {string} '' when there is nothing yet, so the caller can omit the section
 */
export function transcriptFor(turns = [], limit = HISTORY_TURNS) {
  const recent = turns.slice(-limit);
  if (recent.length === 0) return '';

  return recent
    .map((turn) => {
      const who = turn.role === 'model' ? 'You said' : 'He asked';
      const note = turn.revised ? ' (and you rewrote the document)' : '';
      return `${who}${note}: ${String(turn.text ?? '').trim()}`;
    })
    .join('\n\n');
}

let counter = 0;
function nextCounter() {
  counter = (counter + 1) % 1_000_000;
  return counter;
}
