// WHY: CV profiles used to be four ids the code knew by name, so adding a fifth
// meant editing a hardcoded array in the tracker, the API and the client. This
// module is the registry — every *.json file in this folder IS a CV profile — so
// a new profile is a new file plus a prompt, and no code change at all.
// (A "CV profile" is a document SHAPE. It is not data/profile/master-profile.md,
// which is the record of you yourself; the two are different things.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../../store.js';
import { headingFor } from '../sections.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the CV profile configs live. Exported so the write path agrees with the read path. */
export const PROFILE_DIR = HERE;

/** Keys every profile file must set. A missing one is a startup error, not a shrug. */
const REQUIRED_KEYS = ['id', 'description', 'evidenceProfiles', 'register', 'publications', 'kindPriority'];

/** How expert the reader of the finished application is assumed to be. */
export const REGISTERS = ['specialist', 'mixed', 'general'];

// Read once. These files do not change while the server runs, and re-reading them
// per request would make "same input, same output" depend on the disk. The one
// thing that DOES change them is the app writing a new profile, and that path
// calls loadProfiles({ reload: true }) itself.
let cache = null;

/**
 * Every CV profile, keyed by id. Loaded from disk on the first call and kept.
 *
 * @param {object} [options]
 * @param {string} [options.dir] where the profile files live — a test seam
 * @param {boolean} [options.reload] read from disk again instead of using the cache
 * @returns {Map<string, object>} profile id -> normalised profile config
 */
export function loadProfiles({ dir = HERE, reload = false } = {}) {
  const isDefaultDir = dir === HERE;
  if (isDefaultDir && cache && !reload) return cache;

  // Sorted by profile id, not by file name, so the order never depends on the
  // filesystem — and so "industry" sorts before "industry-research" the way a
  // reader expects, rather than by where the ".json" falls.
  const ids = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const profiles = new Map();
  for (const id of ids) {
    const file = `${id}.json`;
    const raw = readJson(path.join(dir, file));
    profiles.set(id, normaliseProfile(raw, { id, file: `server/generate/profiles/${file}` }));
  }

  if (isDefaultDir) cache = profiles;
  return profiles;
}

/** The profile ids, alphabetically. This is the list every dropdown is built from. */
export function profileIds(options) {
  return [...loadProfiles(options).keys()];
}

/** One profile's config, or null when nothing on disk has that id. */
export function getProfile(id, options) {
  return loadProfiles(options).get(String(id ?? '')) ?? null;
}

/** `[{id, description}]` — what the UI needs to offer a choice. */
export function profileSummaries(options) {
  return [...loadProfiles(options).values()].map((profile) => ({
    id: profile.id,
    description: profile.description,
  }));
}

/**
 * Check a profile config and fill in the parts other modules rely on. Exported so
 * a caller holding a raw config (a test, a freshly drafted profile, or an older
 * code path that read the JSON itself) gets the same shape the registry hands out.
 *
 * @param {object} raw the parsed profile JSON
 * @param {object} where {id, file} — used only to write a useful error message
 * @returns {object} the config plus normalised `sections` and `sectionOrder`
 */
export function normaliseProfile(raw, { id, file } = {}) {
  const name = file ?? `profile "${id}"`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${name} does not contain a JSON object, so it cannot be a profile.`);
  }

  for (const key of REQUIRED_KEYS) {
    if (raw[key] === undefined || raw[key] === null) {
      throw new Error(
        `${name} is missing the required key "${key}". Every profile file needs: ${REQUIRED_KEYS.join(', ')}, ` +
          `and either "sections" or "sectionOrder".`,
      );
    }
  }

  if (id !== undefined && raw.id !== id) {
    throw new Error(
      `${name} has "id": "${raw.id}", but the file name says the profile id is "${id}". Make them match.`,
    );
  }
  if (!Array.isArray(raw.evidenceProfiles) || raw.evidenceProfiles.length === 0) {
    throw new Error(
      `${name} has an empty "evidenceProfiles". It lists which evidence tags in your master profile ` +
        `this profile may draw from — with none, the profile would match no records at all.`,
    );
  }
  if (!REGISTERS.includes(raw.register)) {
    throw new Error(`${name} has "register": ${JSON.stringify(raw.register)}. Use one of: ${REGISTERS.join(', ')}.`);
  }

  const sections = normaliseSections(raw);
  if (sections.length === 0) {
    throw new Error(
      `${name} is missing the required key "sections" (or the older "sectionOrder"): a profile must say what order the CV runs in.`,
    );
  }

  return {
    ...raw,
    sections,
    // Kept in step so anything still reading the flat list keeps working.
    sectionOrder: sections.map((section) => section.id),
  };
}

/**
 * `sections: [{id, heading?, max?, style?}]` wins; a profile still written as the
 * older `sectionOrder: ["summary", "skills"]` is turned into the same shape.
 *  - `heading` overrides what the model called the section
 *  - `max` renders at most that many entries (e.g. five publications)
 *  - `style: "lines"` forces one line per entry instead of heading-plus-bullets
 */
export function normaliseSections(config) {
  const list = Array.isArray(config?.sections)
    ? config.sections
    : (config?.sectionOrder ?? []).map((id) => ({ id }));

  return list
    .map((entry) => (typeof entry === 'string' ? { id: entry } : entry))
    .filter((entry) => entry && typeof entry.id === 'string' && entry.id !== '')
    .map((entry) => ({
      id: entry.id,
      ...(entry.heading ? { heading: entry.heading } : {}),
      ...(Number.isFinite(entry.max) ? { max: entry.max } : {}),
      ...(entry.style ? { style: entry.style } : {}),
      defaultHeading: headingFor(entry.id),
    }));
}

export default loadProfiles;
