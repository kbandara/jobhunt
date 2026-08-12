// WHY: drafts are versioned and never overwritten — the model's
// first attempt has to stay readable after you have edited it, and "what did the
// generator actually say" must survive a bad edit. So every save writes a new
// <kind>.v<N>.md, updates <kind>.md as the current copy, and appends a row to
// meta.json recording model, cost, flags and whether a human wrote it.
import path from 'node:path';
import fs from 'node:fs';
import { readJson, writeJson, readText } from '../store.js';

export function appDir(dataDir, jobId) {
  return path.join(dataDir, 'apps', jobId);
}

export function metaFile(dataDir, jobId) {
  return path.join(appDir(dataDir, jobId), 'meta.json');
}

export function docFile(dataDir, jobId, kind) {
  return path.join(appDir(dataDir, jobId), `${kind}.md`);
}

export function versionFile(dataDir, jobId, kind, version) {
  return path.join(appDir(dataDir, jobId), `${kind}.v${version}.md`);
}

export function readMeta(dataDir, jobId) {
  return readJson(metaFile(dataDir, jobId), { jobId, docs: {} });
}

/**
 * Save one version of one document.
 *
 * @returns {{version: number, file: string}} the version number just written
 */
export function saveVersion(dataDir, jobId, kind, entry = {}) {
  const meta = readMeta(dataDir, jobId);
  meta.jobId = jobId;
  meta.docs = meta.docs ?? {};
  const doc = meta.docs[kind] ?? { versions: [] };
  const version = doc.versions.length + 1;
  const markdown = String(entry.markdown ?? '');

  // The versioned copy first: if the process dies between the two writes, the
  // history is intact and only the convenience pointer is stale.
  fs.mkdirSync(appDir(dataDir, jobId), { recursive: true });
  fs.writeFileSync(versionFile(dataDir, jobId, kind, version), markdown, 'utf8');
  fs.writeFileSync(docFile(dataDir, jobId, kind), markdown, 'utf8');

  doc.versions.push({
    v: version,
    ts: new Date().toISOString(),
    model: entry.model ?? null,
    costCents: entry.costCents ?? 0,
    flags: entry.flags ?? { errors: [], warnings: [] },
    gaps: entry.gaps ?? [],
    changes_made: entry.changes_made ?? [],
    editedByUser: entry.editedByUser === true,
    offeredIds: entry.offeredIds ?? [],
    file: path.basename(versionFile(dataDir, jobId, kind, version)),
  });
  doc.current = version;
  meta.docs[kind] = doc;
  writeJson(metaFile(dataDir, jobId), meta);

  return { version, file: versionFile(dataDir, jobId, kind, version) };
}

/** Current markdown for one document, or null if it has never been generated. */
export function readDoc(dataDir, jobId, kind) {
  try {
    return readText(docFile(dataDir, jobId, kind));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * One earlier version, by number, or null if there is no such version.
 *
 * The history was already on disk and already listed on the screen; without
 * this it could only be read by opening the data directory in a file manager,
 * which is not a feature — it is a place the app gave up.
 */
export function readVersion(dataDir, jobId, kind, version) {
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) return null;
  try {
    return readText(versionFile(dataDir, jobId, kind, n));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Everything the job screen needs: current text plus the version log, per kind. */
export function readDocs(dataDir, jobId, kinds) {
  const meta = readMeta(dataDir, jobId);
  const out = {};
  for (const kind of kinds) {
    out[kind] = {
      markdown: readDoc(dataDir, jobId, kind),
      versions: meta.docs?.[kind]?.versions ?? [],
    };
  }
  return out;
}
