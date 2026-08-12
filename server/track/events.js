// WHY: "how long until they replied" is the question that eventually tells you
// whether any of this works, and it is unanswerable retroactively — so every
// mutation appends a timestamped line here from day one, even though nothing
// reads it in v1 (D009). Append-only: no migrations, no corruption on a crash.
import path from 'node:path';
import { appendJsonl, readJsonl } from '../store.js';

/** The complete set. A new mutation means a new type here, not a free-text string. */
export const EVENT_TYPES = [
  'created',
  'parsed',
  'profile-confirmed',
  'scored',
  'doc-generated',
  'doc-saved',
  'doc-revised',
  'publications-chosen',
  'questions-set',
  'chat-cleared',
  'doc-exported',
  'doc-export-failed',
  'profile-created',
  'profile-edited',
  'profile-deleted',
  'status-change',
  // A job moved to the bin, put back, or deleted for good. Once it is purged
  // these lines are the only remaining evidence the application happened at all,
  // which is the point of an append-only log.
  'deleted',
  'restored',
  'purged',
  // A recruiter's read of a draft. Worth logging because it costs money and
  // because "did the verdict improve after I rewrote it" is a real question.
  'reviewed',
  // Setting up and editing your own profile. Worth recording for the same reason
  // as everything else: "when did I add that record" is unanswerable afterwards.
  'provider-set',
  'meta-saved',
  'record-added',
  'record-edited',
  'record-deleted',
  'profile-replaced',
  'profile-imported',
  'profile-polished',
];

export function eventsFile(dataDir) {
  return path.join(dataDir, 'events.jsonl');
}

/**
 * Append one event.
 * @param {string} dataDir
 * @param {{jobId: string, type: string}} event extra fields ride along as-is
 * @returns {object} the line as written
 */
export function logEvent(dataDir, { jobId, type, ...rest }) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`Unknown event type "${type}". Known types: ${EVENT_TYPES.join(', ')}`);
  }
  const line = { ts: new Date().toISOString(), jobId: jobId ?? null, type, ...rest };
  appendJsonl(eventsFile(dataDir), line);
  return line;
}

/** Every event, oldest first. Nothing in v1 calls this except the tests. */
export function readEvents(dataDir) {
  return readJsonl(eventsFile(dataDir));
}
