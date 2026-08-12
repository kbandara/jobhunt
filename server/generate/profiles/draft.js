// WHY: adding a CV profile used to mean hand-writing two files in the right
// shape, which is a thing you only get right if you already know the codebase.
// The app can draft them now — but a model draft is a suggestion, not a fact, so
// this module is the gate: nothing reaches disk until every section id and every
// evidence tag it names is one that actually exists, and a rejection says which
// one was wrong in words rather than throwing a schema dump at you.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_SECTION_IDS } from '../sections.js';
import { PROFILE_DIR, REGISTERS, loadProfiles, normaliseProfile } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where a profile's prose prompt lives, beside the house style and the artifacts. */
export const PROFILE_PROMPT_DIR = path.join(HERE, '..', 'prompts', 'profiles');

/** kebab-case: lower-case words joined by single hyphens. It becomes a file name. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const PUBLICATION_POLICIES = ['omit', 'brief', 'selected', 'all'];
const PUBLICATION_STYLES = ['one-line', 'full'];
const CLEARANCE_RULES = ['first-line', 'mention', 'omit'];

/**
 * Split what the model returned into the two files it becomes. The prose lives
 * in `prompt_markdown` inside the reply because one model call producing one
 * object is simpler than two; on disk they are a `.json` and a `.md`.
 *
 * @param {object} drafted a draft-profile reply
 * @returns {{config: object, promptMarkdown: string}}
 */
export function splitDraft(drafted) {
  const { prompt_markdown: promptMarkdown, ...config } = drafted ?? {};
  return { config, promptMarkdown: typeof promptMarkdown === 'string' ? promptMarkdown : '' };
}

/** Is there already a profile with this id? The check behind the 409. */
export function profileExists(id, { dir = PROFILE_DIR } = {}) {
  return fs.existsSync(path.join(dir, `${String(id ?? '')}.json`));
}

/**
 * Everything wrong with a drafted profile, in plain language. An empty array
 * means it is safe to write.
 *
 * @param {object} options
 * @param {object} options.config the profile config, without `prompt_markdown`
 * @param {string} options.promptMarkdown the body of the profile's prompt file
 * @param {string[]} [options.evidenceTags] the tags this person's records
 *   actually carry. Given them, an invented tag is caught here rather than
 *   surfacing later as a CV built from no evidence; without them nothing is
 *   checked, because a tag vocabulary is something you invent and the app has no
 *   standing to reject a word it has not been shown.
 * @returns {string[]} one sentence per problem
 */
export function checkProfile({ config, promptMarkdown, evidenceTags = null } = {}) {
  const problems = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['The profile is not a JSON object, so there is nothing to check.'];
  }

  const id = config.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    problems.push(
      `"${id}" is not a usable profile id. It becomes a file name, so it has to be lower-case ` +
        `words joined by single hyphens — for example "science-communication".`,
    );
  }

  if (typeof config.description !== 'string' || config.description.trim() === '') {
    problems.push('The profile has no description, and the description is what the picker shows you.');
  }

  if (!REGISTERS.includes(config.register)) {
    problems.push(
      `"${config.register}" is not a register. Use one of: ${REGISTERS.join(', ')}.`,
    );
  }

  // The two lists a model can get wrong in a way that produces a profile which
  // loads fine and then quietly builds a broken CV: an invented section id is a
  // heading the renderer never finds, and an invented evidence tag is a profile
  // that matches no records at all.
  const sections = Array.isArray(config.sections) ? config.sections : [];
  if (sections.length === 0) {
    problems.push('The profile lists no sections, so there would be no CV to build.');
  }
  for (const section of sections) {
    const sectionId = typeof section === 'string' ? section : section?.id;
    if (KNOWN_SECTION_IDS.includes(sectionId)) continue;
    problems.push(
      `There is no section called "${sectionId}". The sections a profile may use are: ` +
        `${KNOWN_SECTION_IDS.join(', ')}.`,
    );
  }

  const known = Array.isArray(evidenceTags) && evidenceTags.length > 0 ? evidenceTags : null;
  const evidenceProfiles = Array.isArray(config.evidenceProfiles) ? config.evidenceProfiles : [];
  if (evidenceProfiles.length === 0) {
    problems.push(
      'The profile draws evidence from nothing, so it would match none of your records. Use ["*"] for ' +
        'every record' + (known ? `, or name some of: ${known.join(', ')}.` : '.'),
    );
  }
  if (known) {
    for (const tag of evidenceProfiles) {
      if (tag === '*' || known.includes(tag)) continue;
      problems.push(
        `"${tag}" is not one of your evidence tags. Your records are tagged with: ${known.join(', ')}. ` +
          `Use "*" to draw on all of them.`,
      );
    }
  }

  const publications = config.publications;
  if (!publications || typeof publications !== 'object') {
    problems.push('The profile does not say what to do with publications.');
  } else {
    if (!PUBLICATION_POLICIES.includes(publications.policy)) {
      problems.push(
        `"${publications.policy}" is not a publications policy. Use one of: ${PUBLICATION_POLICIES.join(', ')}.`,
      );
    }
    if (publications.style !== undefined && !PUBLICATION_STYLES.includes(publications.style)) {
      problems.push(
        `"${publications.style}" is not a publications style. Use one of: ${PUBLICATION_STYLES.join(', ')}.`,
      );
    }
  }

  if (config.clearance !== undefined && !CLEARANCE_RULES.includes(config.clearance)) {
    problems.push(
      `"${config.clearance}" is not a clearance rule. Use one of: ${CLEARANCE_RULES.join(', ')}.`,
    );
  }

  const kindPriority = config.kindPriority;
  if (!kindPriority || typeof kindPriority !== 'object' || Array.isArray(kindPriority)) {
    problems.push('The profile has no kindPriority, so nothing decides which evidence leads.');
  } else {
    for (const [kind, weight] of Object.entries(kindPriority)) {
      if (Number.isFinite(weight)) continue;
      problems.push(`kindPriority.${kind} is "${weight}", which is not a number.`);
    }
  }

  if (typeof promptMarkdown !== 'string' || promptMarkdown.trim() === '') {
    problems.push('The profile has no prompt text, which is the part that tells the model how to write.');
  }

  // Last: the registry's own rules, so a profile can never be written that the
  // registry would then refuse to load on the next start.
  if (problems.length === 0) {
    try {
      normaliseProfile(config, { id });
    } catch (err) {
      problems.push(err.message);
    }
  }

  return problems;
}

/**
 * Write a checked profile to disk and make it usable at once. The registry
 * cache is reloaded here rather than by the caller, because a profile you cannot
 * select until you restart the server is not the feature you asked for.
 *
 * @param {object} options
 * @param {object} options.config
 * @param {string} options.promptMarkdown
 * @param {string} [options.dir] where the .json goes — a test seam
 * @param {string} [options.promptDir] where the .md goes — a test seam
 * @returns {{id: string, configFile: string, promptFile: string}}
 */
export function saveProfile({
  config,
  promptMarkdown,
  dir = PROFILE_DIR,
  promptDir = PROFILE_PROMPT_DIR,
  evidenceTags = null,
} = {}) {
  const problems = checkProfile({ config, promptMarkdown, evidenceTags });
  if (problems.length > 0) {
    throw new Error(`This profile cannot be saved:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  }

  const id = config.id;
  const configFile = path.join(dir, `${id}.json`);
  const promptFile = path.join(promptDir, `${id}.md`);

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.writeFileSync(promptFile, promptMarkdown.trim().endsWith('\n') ? promptMarkdown : `${promptMarkdown.trim()}\n`, 'utf8');

  loadProfiles({ dir, reload: true });
  return { id, configFile, promptFile };
}

/** A profile's prompt file as text, or '' when it has never had one written. */
export function readProfilePrompt(id, { promptDir = PROFILE_PROMPT_DIR } = {}) {
  try {
    return fs.readFileSync(path.join(promptDir, `${String(id ?? '')}.md`), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

/**
 * Delete a profile and its prompt. Returns false when there was nothing to
 * delete, so a route can answer 404 rather than reporting a success that did not
 * happen.
 */
export function deleteProfile(id, { dir = PROFILE_DIR, promptDir = PROFILE_PROMPT_DIR } = {}) {
  const name = String(id ?? '');
  const configFile = path.join(dir, `${name}.json`);
  if (!fs.existsSync(configFile)) return false;
  fs.rmSync(configFile);
  fs.rmSync(path.join(promptDir, `${name}.md`), { force: true });
  loadProfiles({ dir, reload: true });
  return true;
}

export default saveProfile;
