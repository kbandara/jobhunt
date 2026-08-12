// WHY THIS EXISTS: this app was written for one person, with that person's phone
// number, citizenship and employment record committed to the repository. That is
// fine for a repo of one. It is wrong the moment a second person clones it: their
// details would land in a tracked file, one `git commit -a` away from being
// published, and every `git pull` would fight them for it.
//
// So the repository ships *no* personal data at all. Everything about the person
// using the app lives under `data/`, which is gitignored, created on first start,
// and never touched by an update. This module is the one place that knows where
// that is.
//
// The one-time migration matters as much as the layout: the original author has
// a working `profile/` folder in their own clone, and an app that silently
// started them from an empty profile would look like it had lost their work.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The checkout this file lives in. */
export const REPO_ROOT = path.join(HERE, '..');

/**
 * Everything the person using the app owns. Gitignored, and the only folder
 * they need to copy to move to a new machine.
 */
export const DEFAULT_DATA_DIR = process.env.JOBHUNT_DATA_DIR
  ? path.resolve(process.env.JOBHUNT_DATA_DIR)
  : path.join(REPO_ROOT, 'data');

/** Starter files, copied on first run. Tracked, and never written to. */
export const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates');

/**
 * Where the previous, single-person version kept its files. Read once, on first
 * start, so an existing clone migrates instead of appearing to have been wiped.
 */
const LEGACY_PROFILE_DIR = path.join(REPO_ROOT, 'profile');

/**
 * Every path derived from a data directory. Taking `dataDir` as an argument
 * rather than reading a module-level constant is what lets a test point the
 * whole app at a temp folder.
 *
 * @param {string} [dataDir]
 */
export function userPaths(dataDir = DEFAULT_DATA_DIR) {
  const profileDir = path.join(dataDir, 'profile');
  const cvProfilesDir = path.join(dataDir, 'cv-profiles');
  return {
    dataDir,
    profileDir,
    masterProfile: path.join(profileDir, 'master-profile.md'),
    profileMeta: path.join(profileDir, 'profile-meta.json'),
    // CV profiles the person writes in the app. Shipped ones stay in the repo
    // and are read-only; these sit beside them and win on a name clash, so an
    // update can improve a stock profile without overwriting an edited copy.
    cvProfilesDir,
    cvPromptsDir: path.join(cvProfilesDir, 'prompts'),
    setupState: path.join(dataDir, 'setup.json'),
  };
}

/** Contact details for somebody who has not filled anything in yet. */
export function blankProfileMeta() {
  return {
    name: '',
    preferred: '',
    email: '',
    phone: '',
    city: '',
    links: [],
    citizenship: '',
    workRights: { statement: '', relocation: 'open to relocation', remoteNote: '', byCountry: {} },
    qualifications: {},
    evidenceTags: [...DEFAULT_EVIDENCE_TAGS],
    timezoneOverlapClaims: false,
  };
}

/**
 * The evidence tags a brand-new profile starts with. They are only a starting
 * vocabulary — the person can rename them, delete them or invent their own, and
 * the parser reads the list out of their own profile-meta.json rather than
 * holding one of its own.
 */
export const DEFAULT_EVIDENCE_TAGS = ['research', 'industry', 'teaching', 'public-sector'];

/**
 * Make sure the person's own files exist, creating them if this is the first
 * start. Safe to call on every boot: it only ever writes what is missing.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir]
 * @param {string} [options.legacyDir] the old in-repo profile folder — a test seam
 * @param {string} [options.templateDir]
 * @returns {{created: boolean, migratedFrom: string|null, paths: object}}
 */
export function ensureUserData({
  dataDir = DEFAULT_DATA_DIR,
  legacyDir = LEGACY_PROFILE_DIR,
  templateDir = TEMPLATE_DIR,
} = {}) {
  const paths = userPaths(dataDir);
  const hadProfile = fs.existsSync(paths.masterProfile);
  const hadMeta = fs.existsSync(paths.profileMeta);
  if (hadProfile && hadMeta) return { created: false, migratedFrom: null, paths };

  fs.mkdirSync(paths.profileDir, { recursive: true });

  // A pre-existing `profile/` in the checkout is the single-person version's
  // data. Copy it rather than starting them from nothing; the originals are left
  // where they are, so nothing is destroyed if this goes wrong.
  const legacyProfile = path.join(legacyDir, 'master-profile.md');
  const legacyMeta = path.join(legacyDir, 'profile-meta.json');
  let migratedFrom = null;

  if (!hadProfile && fs.existsSync(legacyProfile)) {
    fs.copyFileSync(legacyProfile, paths.masterProfile);
    migratedFrom = legacyDir;
  } else if (!hadProfile) {
    fs.copyFileSync(path.join(templateDir, 'master-profile.md'), paths.masterProfile);
  }

  if (!hadMeta && fs.existsSync(legacyMeta)) {
    fs.copyFileSync(legacyMeta, paths.profileMeta);
    migratedFrom = legacyDir;
  } else if (!hadMeta) {
    fs.copyFileSync(path.join(templateDir, 'profile-meta.json'), paths.profileMeta);
  }

  return { created: true, migratedFrom, paths };
}

/**
 * Has this person finished setting up? Used to decide whether the app opens on
 * the board or on the welcome screen.
 *
 * Deliberately a fact about their data rather than a flag they clicked past: a
 * profile with no name and no records is not set up, whatever a stored boolean
 * says, and somebody who deletes their profile should get the welcome screen
 * back rather than an app that quietly generates blank CVs.
 *
 * @param {object} options
 * @param {object|null} options.profileMeta
 * @param {number} options.recordCount
 * @returns {{done: boolean, steps: object}}
 */
export function setupState({ profileMeta, recordCount = 0, keyPresent = false } = {}) {
  const filled = (value) => typeof value === 'string' && value.trim() !== '' && !/FILL-ME/i.test(value);
  const steps = {
    key: Boolean(keyPresent),
    contact: filled(profileMeta?.name) && filled(profileMeta?.email),
    profile: recordCount > 0,
  };
  return { done: steps.key && steps.contact && steps.profile, steps };
}

export default userPaths;
