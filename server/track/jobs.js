// WHY: one job = one JSON file under data/jobs/, so the state of an application
// is greppable and hand-fixable (D002). This module owns the record shape and
// the six board columns; nothing else writes a job file, so "what can a job look
// like" has exactly one answer.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../store.js';

/** the columns, in order. Board layout reads this. */
export const STATUSES = ['wishlist', 'drafting', 'applied', 'interviewing', 'offer', 'rejected'];

// The list of CV profiles is NOT cached here. It used to be, as a snapshot taken
// when this module was first imported — which was fine while profiles were only
// ever added by hand between restarts, and wrong the moment the app could write
// one. Callers ask server/generate/profiles/index.js instead, which is live.

export function jobsDir(dataDir) {
  return path.join(dataDir, 'jobs');
}

export function jobFile(dataDir, id) {
  return path.join(jobsDir(dataDir), `${id}.json`);
}

/**
 * `j_<epoch ms>`, with a suffix if two jobs are created inside one millisecond —
 * which happens in tests and would otherwise overwrite the first job silently.
 */
export function newJobId(dataDir, now = Date.now()) {
  const base = `j_${now}`;
  let id = base;
  let n = 1;
  while (fs.existsSync(jobFile(dataDir, id))) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

/** A new job record. Everything the pipeline fills in later starts null. */
export function createJob(dataDir, { rawText, source = 'pasted', url = null } = {}) {
  const id = newJobId(dataDir);
  const job = {
    id,
    createdAt: new Date().toISOString(),
    source,
    rawAd: String(rawText ?? ''),
    url,
    parsed: null,
    // `confirmedBy` is 'auto' when the app accepted its own guess and 'human' when
    // you picked one. Both mean "generation may proceed"; only one is your decision.
    profile: { guess: null, guessReason: null, confirmed: null, confirmedBy: null },
    // Which papers go on the CV. `selected: null` means "nobody has chosen",
    // and the app proposes a set from the profile's policy; once you tick
    // anything this becomes your list and the proposal stops overriding it.
    publications: { selected: null, chosenBy: null },
    fit: null,
    status: 'wishlist',
    closingDate: null,
    docs: {},
  };
  writeJson(jobFile(dataDir, id), job);
  return job;
}

export function readJob(dataDir, id) {
  return migrate(readJson(jobFile(dataDir, id), null));
}

/**
 * What used to be called a "lane" is now called a CV profile. Jobs saved before
 * the rename carry `lane: {guess, guessReason, confirmed, confirmedBy}`, and
 * they are real applications in progress — so they are mapped on the way in
 * rather than being asked to be re-parsed. Nothing rewrites the file: the next
 * updateJob() writes the new shape, and until then the old key is simply
 * translated on every read. A job that already has `profile` is left alone.
 *
 * @param {object|null} job
 * @returns {object|null} the job with `profile` set and no `lane` key
 */
export function migrate(job) {
  if (!job || typeof job !== 'object') return job;

  const { lane, ...rest } = job;
  const migrated = 'lane' in job ? { ...rest, profile: rest.profile ?? lane ?? null } : job;

  // Jobs saved before the publication picker existed have no `publications` at
  // all. Defaulting on read rather than rewriting the file keeps this the same
  // kind of migration as the lane rename above: nothing on disk changes until
  // the next ordinary save.
  if (migrated.publications) return migrated;
  return { ...migrated, publications: { selected: null, chosenBy: null } };
}

export function writeJob(dataDir, job) {
  writeJson(jobFile(dataDir, job.id), job);
  return job;
}

/** Read-modify-write in one place, so no route forgets to persist. */
export function updateJob(dataDir, id, mutate) {
  const job = readJob(dataDir, id);
  if (!job) return null;
  const next = mutate({ ...job }) ?? job;
  return writeJob(dataDir, next);
}

// --- deleting, and undeleting -------------------------------------------------
//
// Delete used to be permanent, on the reasoning that a hidden pile of dead
// applications is a screen you eventually have to build. That was the wrong
// question. The risk is not clutter, it is a mis-aimed click destroying a day of
// writing — in an app whose whole purpose is not losing your work. A two-click
// confirmation was the wrong answer to it too: confirmations get clicked.
//
// So Delete moves everything to data/trash/ and the bin has a Restore button.
// Permanent deletion still exists, but it is a separate, deliberate act on a
// screen you had to go to on purpose.
//
// The event log is never touched by any of this. It is append-only and answers
// "how long until they replied" across the whole history, which outlives any one
// application. Its lines carry the job id, so a binned job leaves exactly the
// trace it should: that it happened, and when.

/** Where a job's drafts live. Kept here so nothing can miss a directory. */
function appDirFor(dataDir, id) {
  return path.join(dataDir, 'apps', id);
}

export function trashDir(dataDir) {
  return path.join(dataDir, 'trash');
}

const trashJobFile = (dataDir, id) => path.join(trashDir(dataDir), 'jobs', `${id}.json`);
const trashAppDir = (dataDir, id) => path.join(trashDir(dataDir), 'apps', id);

/**
 * Move a path, falling back to copy-and-delete.
 *
 * `rename` is atomic and instant, and it fails across volumes and (on Windows)
 * onto an existing destination. Neither should be able to lose a job, so the
 * fallback copies first and only removes the source once the copy is there.
 */
function movePath(from, to) {
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // A leftover at the destination would make rename fail on Windows and silently
  // merge on Linux. Both are worse than replacing it outright.
  if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

  try {
    fs.renameSync(from, to);
    return true;
  } catch {
    fs.cpSync(from, to, { recursive: true });
    // Only now that the copy exists. maxRetries is for Windows, where a file
    // another program has open answers EBUSY rather than deleting.
    fs.rmSync(from, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    return true;
  }
}

/** How many files a path accounts for, for the "and its N drafts" wording. */
function countFiles(target) {
  if (!fs.existsSync(target)) return 0;
  if (!fs.statSync(target).isDirectory()) return 1;
  return fs.readdirSync(target).reduce((sum, name) => sum + countFiles(path.join(target, name)), 0);
}

/**
 * Move a job and everything written for it into the bin.
 *
 * @returns {{trashed: boolean, files: number}} files counts the drafts that went
 *   with it, so the UI can say what is about to happen before it happens.
 */
export function trashJob(dataDir, id) {
  const record = jobFile(dataDir, id);
  if (!fs.existsSync(record)) return { trashed: false, files: 0 };

  const folder = appDirFor(dataDir, id);
  const files = countFiles(folder);

  // Stamped before the move, so the bin can be ordered by when things were
  // binned rather than by when they were created.
  const job = readJob(dataDir, id);
  if (job) writeJson(record, { ...job, deletedAt: new Date().toISOString() });

  movePath(folder, trashAppDir(dataDir, id));
  movePath(record, trashJobFile(dataDir, id));
  return { trashed: true, files };
}

/** What is in the bin, most recently binned first. */
export function listTrash(dataDir) {
  const dir = path.join(trashDir(dataDir), 'jobs');
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const job = readJson(path.join(dir, name), null);
      if (!job) return null;
      return { ...migrate(job), files: countFiles(trashAppDir(dataDir, job.id)) };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.deletedAt ?? '').localeCompare(String(a.deletedAt ?? '')));
}

/** One binned job, or null. */
export function readTrashedJob(dataDir, id) {
  const job = readJson(trashJobFile(dataDir, id), null);
  return job ? migrate(job) : null;
}

/**
 * Put a binned job back on the board, in the lane it was in.
 *
 * @returns {{restored: boolean, reason?: string, job?: object}} reason is set
 *   when it could not happen, so a route can say why rather than 404.
 */
export function restoreJob(dataDir, id) {
  const binned = trashJobFile(dataDir, id);
  if (!fs.existsSync(binned)) return { restored: false, reason: 'not-in-trash' };

  // A live job with the same id would be overwritten. Ids are minted from the
  // clock so this is close to impossible, and "close to" is not good enough when
  // the cost is somebody's application.
  if (fs.existsSync(jobFile(dataDir, id))) return { restored: false, reason: 'already-exists' };

  movePath(trashAppDir(dataDir, id), appDirFor(dataDir, id));
  movePath(binned, jobFile(dataDir, id));

  const job = readJob(dataDir, id);
  if (job) {
    // deletedAt is dropped rather than kept as history: the event log already
    // records the delete and the restore, and a restored job carrying a
    // deletedAt would read as still binned to anything that checks.
    const { deletedAt, ...rest } = job;
    return { restored: true, job: writeJob(dataDir, rest) };
  }
  return { restored: true };
}

/**
 * Delete a binned job for good. The only call in this module that destroys
 * anything, and it is reachable only from the bin.
 *
 * @returns {{purged: boolean, files: number}}
 */
export function purgeJob(dataDir, id) {
  const record = trashJobFile(dataDir, id);
  if (!fs.existsSync(record)) return { purged: false, files: 0 };

  const folder = trashAppDir(dataDir, id);
  const files = countFiles(folder);
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  fs.rmSync(record, { force: true, maxRetries: 10, retryDelay: 50 });
  return { purged: true, files };
}

/** Empty the bin. @returns {{purged: number}} how many jobs went. */
export function emptyTrash(dataDir) {
  let purged = 0;
  for (const job of listTrash(dataDir)) {
    if (purgeJob(dataDir, job.id).purged) purged += 1;
  }
  return { purged };
}

/** Every job, newest first — the board and the tests both want that order. */
export function listJobs(dataDir) {
  let names;
  try {
    names = fs.readdirSync(jobsDir(dataDir));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => migrate(readJson(path.join(jobsDir(dataDir), name), null)))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

/** Board state: every column present, even when empty. */
export function groupByStatus(jobs) {
  const board = Object.fromEntries(STATUSES.map((status) => [status, []]));
  for (const job of jobs) {
    const status = STATUSES.includes(job?.status) ? job.status : 'wishlist';
    board[status].push(job);
  }
  return board;
}
