// WHY: one artifact, one model call, one code path — select evidence, build the
// four-layer prompt, render markdown, inject the code-generated contact block,
// then run the validator and hand back the draft WITH its flags (never silently
// corrected, the design). Layers 1–3 of the system prompt are byte-stable
// across every call so the provider's prompt cache applies: nothing
// volatile — no timestamps, no job text, no ids — may ever be interpolated there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../store.js';
import { complete, loadPinnedSchema } from '../llm/index.js';
import { validate } from '../validate/validator.js';
import { selectEvidence } from './select-evidence.js';
import { contactBlock } from './workrights.js';
import { assemble } from './assemble.js';
import { getProfile } from './profiles/index.js';
import { proposeFrom, renderSelected } from './publications.js';
import { headingFor } from './sections.js';
import { extractKeywords, keywordSection } from './keywords.js';
import { nameParts } from '../profile/identity.js';
import { integrityRules } from './integrity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS = path.join(HERE, 'prompts');

export const TASK_BY_KIND = {
  cv: 'generate-cv',
  'cover-letter': 'generate-cover-letter',
  criteria: 'generate-criteria',
  'cold-email': 'generate-cold-email',
};

export const ARTIFACT_KINDS = Object.keys(TASK_BY_KIND);

// Layers 1–3 never change while the server runs, so they are read once. Reading
// them per call would be harmless for correctness and pointless for everything
// else — but caching also makes it obvious that they are meant to be constant.
const systemCache = new Map();

/**
 * The system prompt: house style, then this profile's rules, then the integrity
 * constraints — in that order, joined with blank lines, and identical byte for
 * byte on every call for a given profile and a given profile-meta.
 *
 * The integrity layer is built from profile-meta.json rather than read from a
 * file, so it says true things about whoever is using the app. It is still
 * stable across calls, which is what the provider's prompt cache needs —
 * the cache key includes it precisely so that stability is not assumed.
 *
 * @param {string} profile CV profile id
 * @param {object} [options]
 * @param {object} [options.profileMeta]
 * @param {string} [options.integrityExtra] the person's own integrity notes
 */
export function systemPrompt(profile, { profileMeta = {}, integrityExtra = '' } = {}) {
  const integrity = integrityRules({ profileMeta, extra: integrityExtra });
  const positioning = positioningRules(profileMeta);
  const key = [profile, positioning, integrity].join('\u0000');
  if (systemCache.has(key)) return systemCache.get(key);
  const parts = [
    readText(path.join(PROMPTS, 'house-style.md')),
    positioning,
    profilePrompt(profile),
    ['## Integrity constraints', '', integrity].join('\n'),
  ]
    .map((text) => String(text ?? '').trim())
    .filter(Boolean);
  const prompt = parts.join('\n\n');
  systemCache.set(key, prompt);
  return prompt;
}

/**
 * How to pitch this person: the one thing house-style.md cannot state in general,
 * because "mid-career career-transitioner" is a fact about one applicant and
 * getting it wrong reads worse than saying nothing. Blank unless profile-meta
 * says something, and a free-text `positioning` note wins over the level.
 */
export function positioningRules(profileMeta = {}) {
  const LEVELS = {
    'early-career': 'early-career: a recent graduate or in the first few years of professional work. ' +
      'Never describe them as senior, and never as having a decade of experience.',
    'mid-career': 'mid-career. Never describe them as early-career, junior, a recent graduate or a ' +
      'student, and never as senior or executive.',
    senior: 'senior: substantial experience and a record of leading work. Never describe them as ' +
      'junior or early-career.',
  };
  const level = String(profileMeta?.careerLevel ?? '').trim().toLowerCase();
  const note = String(profileMeta?.positioning ?? '').trim();
  const lines = [];
  if (LEVELS[level]) lines.push(`Position this candidate as ${LEVELS[level]}`);
  if (note) lines.push(note);
  if (lines.length === 0) return '';
  return ['## Career level', '', ...lines].join('\n');
}

/**
 * A profile's hand-written prompt file, or — when someone has added a profile JSON and
 * not yet written its prose — a plain block built from the config. A missing
 * prompt file should cost you some nuance, never a crash mid-generation.
 */
export function profilePrompt(profile, config = getProfile(profile)) {
  const file = path.join(PROMPTS, 'profiles', `${profile}.md`);
  if (fs.existsSync(file)) return readText(file);

  if (!config) return `# Profile: ${profile}\n\nNo profile rules were found for "${profile}". Use the house style alone.`;

  const order = config.sections.map((section) => section.heading ?? section.defaultHeading).join(', ');
  // A page count is guidance, never a ceiling. Two reasons: you are writing
  // markdown and cannot see where a page break lands, so any hard limit is
  // enforced by guessing; and a CV that leaves out something the advertisement
  // asked for in order to fit a page has been made worse, not shorter. How much
  // material there is to draw on is decided in code, before you see it.
  const length =
    config.lengthPages === null || config.lengthPages === undefined
      ? 'There is no target length in this profile — let the evidence decide.'
      : `Aim for roughly ${config.lengthPages} page${config.lengthPages === 1 ? '' : 's'}. ` +
        'That is a guide, not a limit: never drop something the advertisement asks for in order ' +
        'to hit it, and never pad to reach it.';

  return [
    `# Profile: ${profile}`,
    '',
    config.description,
    ...(config.targets?.length ? ['', `Typical targets: ${config.targets.join(', ')}.`] : []),
    '',
    `Section order: ${order}. ${length}`,
    '',
    'The summary always appears. This candidate is a career transitioner, so the',
    'summary is where the connection between the record and this role is stated.',
    '',
    `Publications: ${publicationRule(config.publications)}`,
    '',
    `Clearance: ${clearanceRule(config.clearance)}`,
    '',
    `Call the technical section "${config.techSectionName ?? headingFor('skills')}".`,
    '',
    'This profile has no hand-written prompt file yet, so these rules come from its',
    'configuration. Follow the advertisement closely where they leave a gap.',
  ].join('\n');
}

function publicationRule(policy = {}) {
  if (policy.policy === 'omit') return 'omit them unless a requirement explicitly asks for research output.';
  if (policy.policy === 'all') return 'list all of them, in full citation form, grouped by status.';
  const count = policy.count ?? 3;
  const style = policy.style === 'full' ? 'in full citation form' : 'one line each';
  return `the ${count} most relevant to this role, ${style}.`;
}

function clearanceRule(clearance) {
  if (clearance === 'first-line') return 'lead with it — it is the highest-value fact in this profile.';
  if (clearance === 'omit') return 'omit it; it is irrelevant to this audience.';
  return 'mention it only where the advertisement raises security, government work or vetting.';
}

/** The facts the code owns: where the job is, and how it is worked. */
export function jobFacts(jdJson = {}) {
  return {
    country: jdJson?.location?.country ?? '',
    workArrangement: jdJson?.work_arrangement ?? '',
    company: jdJson?.company ?? '',
    roleTitle: jdJson?.role_title ?? '',
  };
}

/**
 * Generate one artifact end to end.
 *
 * @param {object} options
 * @param {'cv'|'cover-letter'} options.artifactKind
 * @param {string} options.profile confirmed profile (never the guess)
 * @param {object} options.profileConfig server/generate/profiles/<profile>.json
 * @param {object} options.jdJson parse-jd output
 * @param {object[]} options.evidence all records from profile/parse.js
 * @param {object} options.profileMeta profile/profile-meta.json
 * @param {string} [options.date] today, already formatted — an input, so assembly stays pure
 * @param {Function} [options.llmComplete] injected for tests; defaults to the real LLM layer
 * @param {string[]} [options.publicationIds] which papers to cite. Omit and the
 *   profile's own policy proposes a set.
 * @param {{question: string, wordLimit: number|null}[]} [options.questions] the
 *   application questions, for artifactKind 'criteria'. Ignored by the others.
 * @param {string} [options.notes] what the applicant wrote about THIS application
 *   before generating — "mention my E-3 eligibility", "lead with the teaching".
 * @param {Function} [options.onProgress] called with a step id as each one begins.
 *   Defaults to a no-op so nothing here depends on anybody watching, and it is
 *   never awaited — reporting progress must not be able to slow down or fail the
 *   thing it is reporting on.
 * @param {string} [options.ledgerFile]
 * @returns {Promise<object>} { artifact, markdown, flags, gaps, changes_made, usage, costCents,
 *   model, offeredIds, contactLines, contactNote, needsAttention }
 */
export async function generateArtifact({
  artifactKind,
  profile,
  profileConfig = {},
  jdJson = {},
  evidence = [],
  profileMeta = {},
  date,
  llmComplete = complete,
  onProgress,
  publicationIds,
  questions = [],
  integrityExtra = '',
  notes = '',
  ledgerFile,
} = {}) {
  const task = TASK_BY_KIND[artifactKind];
  if (!task) {
    throw new Error(`Unknown artifact kind "${artifactKind}". Use one of: ${ARTIFACT_KINDS.join(', ')}`);
  }

  // Refused rather than answered: a criteria run with no questions would cost a
  // few cents to produce a document with nothing in it, and the reason would
  // not be visible anywhere on the screen that started it.
  if (artifactKind === 'criteria' && questions.length === 0) {
    throw Object.assign(
      new Error('There are no application questions to answer yet. Paste them in first — most portals ask them behind a login, so they are rarely in the advertisement.'),
      { expected: true },
    );
  }

  // A broken reporter is a cosmetic fault; a generation it took down with it
  // would not be. So every report is swallowed, always.
  const step = (id) => {
    try {
      onProgress?.(id);
    } catch {
      /* never let the progress display break the generation it describes */
    }
  };

  step('selecting');
  const { selected, offeredIds } = selectEvidence({ evidence, jdJson, profile, profileConfig });
  const facts = jobFacts(jdJson);

  // Which papers appear is your choice, or the profile's proposal until you make
  // one. Either way the citations are rendered from records in code — the model
  // is told below not to write a publications section at all.
  const chosenPublications =
    publicationIds ?? proposeFrom(selected, evidence, profileConfig, nameParts(profileMeta));
  const publications = renderSelected({ evidence, selected: chosenPublications });

  step('briefing');
  const message = userMessage({
    artifactKind,
    jdJson,
    selected,
    task,
    profileConfig,
    publications,
    questions,
    keywords: extractKeywords({ jdJson, profileMeta }),
    notes,
  });
  const system = systemPrompt(profile, { profileMeta, integrityExtra });

  step('writing');
  const response = await llmComplete({
    task,
    system,
    messages: [{ role: 'user', content: message }],
    ...(ledgerFile ? { ledgerFile } : {}),
  });

  const artifact = response?.data ?? {};
  const contact = contactBlock(profileMeta, facts);

  const markdown = assemble({
    artifact,
    artifactKind,
    profile,
    profileConfig,
    contactLines: contact.lines,
    jobMeta: { company: facts.company, roleTitle: facts.roleTitle, date },
    publications,
  });

  step('checking');
  const flags = validate({
    artifact,
    artifactKind,
    offeredIds,
    evidence,
    profile,
    jobParsed: jdJson,
    renderedText: markdown,
    expectedContactLines: contact.lines,
    mode: 'strict',
    ...(profileMeta && Object.keys(profileMeta).length > 0 ? { profileMeta } : {}),
  });

  return {
    artifact,
    markdown,
    flags,
    gaps: Array.isArray(artifact.gaps) ? artifact.gaps : [],
    changes_made: Array.isArray(artifact.changes_made) ? artifact.changes_made : [],
    usage: response?.usage ?? { inputTokens: 0, outputTokens: 0 },
    costCents: response?.costCents ?? 0,
    model: response?.model ?? null,
    offeredIds,
    publicationIds: chosenPublications,
    contactLines: contact.lines,
    contactNote: contact.note ?? null,
    needsAttention: contact.needsAttention ?? [],
  };
}

// --- layer 4: the task message ---------------------------------------------

/**
 * Everything volatile lives here, in the user turn: the artifact instruction,
 * the parsed job, and the selected evidence records rendered WHOLE — never a
 * fragment, so the model cannot attribute a number to a record that lacks it.
 */
function userMessage({ artifactKind, jdJson, selected, task, profileConfig, publications = [], questions = [], keywords = [], notes = '' }) {
  return [
    readText(path.join(PROMPTS, 'artifacts', `${artifactKind}.md`)).trim(),
    '',
    ...noteSection(notes),
    ...(artifactKind === 'criteria' ? [...questionList(questions), ''] : []),
    '## The job (parsed from the advertisement)',
    '',
    '```json',
    JSON.stringify(jdJson, null, 2),
    '```',
    '',
    ...terminologyRule(jdJson, profileConfig),
    '',
    // The words the application will be matched on, extracted in code. A cold
    // approach has no advertisement to be matched against — its "requirements"
    // were inferred from your own notes, so a keyword list built from them would
    // be the app telling the model to echo the app.
    ...(artifactKind === 'cv' ? [...skillsRule(jdJson), ''] : []),
    ...(artifactKind === 'cold-email' ? [] : [...keywordSection(keywords), '']),
    ...publicationRules(publications, artifactKind),
    '',
    `## Evidence records you may use (${selected.length}) — these are the only facts you have`,
    '',
    selected.map(renderRecord).join('\n\n'),
    '',
    '## Required output shape',
    '',
    `Reply with JSON only, matching the schema for this step. Top-level keys: ${topLevelKeys(task)}.`,
  ].join('\n');
}

/**
 * The technical section, answered against the ad's own skill list.
 *
 * A recruiter reading the skills line is checking it against the list they
 * wrote, in the order they wrote it, and a section grouped by HIS mental model —
 * "Analysis", "Tooling" — makes them do the matching themselves. The ad already
 * published the list; the section should read as a reply to it.
 *
 * The order is the ad's, not the applicant's. The contents are still theirs: a
 * skill with no record behind it is left out, and that gap is more useful to see
 * than a line that claims it.
 */
function skillsRule(jdJson = {}) {
  const skills = (Array.isArray(jdJson?.skills) ? jdJson.skills : []).filter(Boolean);
  if (skills.length === 0) return [];

  return [
    `## The skills this advertisement lists (${skills.length}), in its order`,
    '',
    skills.map((skill, i) => `${i + 1}. ${skill}`).join('\n'),
    '',
    'Make the technical section read as an answer to this list. Where a record supports one of',
    'these, name it using the advertisement\'s word for it, and put the ones it asked for before',
    'the ones it did not — a reader checking their own list should find it in their own order,',
    'not have to hunt through a grouping that made sense to you.',
    '',
    'A skill on this list with nothing behind it is LEFT OUT. Not softened, not implied by a',
    'neighbouring one, not written as "familiar with" — left out. The checks report it as a gap,',
    'which is a true and useful thing for the applicant to see before they apply; a line claiming',
    'it is neither. Genuine strengths the advertisement did not ask for still belong in the',
    'section, after the ones it did.',
  ];
}

/**
 * What the applicant asked for on this particular application, placed FIRST.
 *
 * First because it is the only part of the brief they wrote themselves, and a
 * model reading a long prompt weights the top of it. Without this the only way
 * to say "mention my E-3 eligibility in the header" was to generate, read, and
 * then ask the chat to fix it — two model calls and a rewrite to get what one
 * call would have produced if it had simply been told.
 *
 * The honesty rules still win. Emphasis, order, tone and what to leave out are
 * the applicant's to decide; a claim there is no record for is not, and the
 * integrity layer of the system prompt says so in terms this cannot override.
 */
function noteSection(notes) {
  const text = String(notes ?? '').trim();
  if (text === '') return [];
  return [
    '## What the applicant asked for on this application',
    '',
    'Their own words, about this job specifically. Follow them wherever they concern emphasis,',
    'ordering, length, tone or what to leave out — that is their call and they have made it.',
    '',
    text,
    '',
    'What they cannot do is license a claim: if something here asks for a fact no evidence',
    'record supports, do the closest honest thing and note it in `gaps`. They are telling you',
    'what to foreground, not what is true.',
    '',
  ];
}

/**
 * The questions, numbered, each with its limit stated in words rather than as a
 * field. A limit expressed as `"word_limit": 300` in a JSON blob is read as
 * metadata; "Limit: 300 words" on its own line is read as an instruction, and
 * the difference shows in how close the answers come to it.
 */
function questionList(questions) {
  return [
    `## The questions (${questions.length}) — answer every one, in this order`,
    '',
    ...questions.flatMap((q, i) => [
      `${i + 1}. ${q.question}`,
      `   Limit: ${q.wordLimit ? `${q.wordLimit} words` : 'no stated limit — write 250-350 words'}`,
      '',
    ]),
  ];
}

/**
 * The naming rule, stated for THIS advertisement. It lives in the task message
 * rather than the system prompt because it depends on the job: the words the ad
 * used and how expert its reader is. (Layers 1–3 stay byte-stable for the cache.)
 */
function terminologyRule(jdJson = {}, profileConfig = {}) {
  const register = jdJson?.technical_register ?? profileConfig?.register ?? 'mixed';
  const vocabulary = (Array.isArray(jdJson?.domain_vocabulary) ? jdJson.domain_vocabulary : []).filter(Boolean);

  const audience = {
    specialist: 'This advertisement is written for a specialist reader: keep the exact technical names.',
    mixed: 'This advertisement is written for a partly technical reader: keep a specialist name only where the ad itself uses it, and otherwise say what the method did.',
    general: 'This advertisement is written for a non-specialist reader: say what each method did, in words the reader already has.',
  }[register] ?? 'Judge the reader from the advertisement itself.';

  return [
    '## Terminology for this advertisement',
    '',
    audience,
    '',
    vocabulary.length > 0
      ? `The advertisement itself uses these terms, so you may use them exactly as written: ${vocabulary.join(', ')}.`
      : 'The advertisement uses no specialist vocabulary of its own.',
    '',
    'The rule in one line: use the specialist term when the advertisement uses it or the register is',
    'specialist; otherwise use the plainer wording. Generalising a name is fine; overstating the work is',
    'not — never translate a method into something larger or different from what was actually done.',
  ];
}

/**
 * Publications are not yours to write.
 *
 * They are rendered from records in code and inserted into the document after
 * you have finished, so a publications section in your output is discarded. You
 * are shown them because they are facts you may want to REFER to — "first
 * author on the 2025 modelling paper" in a summary is useful; retyping the
 * citation is not, and every retyping is a chance to move a year.
 */
function publicationRules(publications, artifactKind) {
  const lines = ['## Publications'];

  if (publications.length === 0) {
    lines.push(
      '',
      artifactKind === 'cover-letter'
        ? 'No publications have been chosen for this application. Do not cite any.'
        : 'No publications have been chosen for this application, so there is no publications section. Do not write one.',
    );
    return lines;
  }

  lines.push(
    '',
    'These are already written and will be placed in the document by the app, exactly as',
    'they appear below. Do NOT produce a publications section and do NOT retype any of',
    'these citations — anything you write under that heading is discarded, and a citation',
    'copied by hand is a chance to change a year or a venue that is currently correct.',
    '',
    'They are here so you can REFER to the work in prose where it helps: "first author on',
    'the 2025 modelling paper", "a critique of decoding accuracy currently under review".',
    'Describe the work; never restate the citation.',
    '',
    ...publications.map((line) => `- ${line}`),
  );
  return lines;
}

function topLevelKeys(task) {
  try {
    return Object.keys(loadPinnedSchema(task)?.properties ?? {}).join(', ');
  } catch {
    return 'as specified by the response schema';
  }
}

function renderRecord(record) {
  const dates = record?.dates ?? {};
  const period = [dates.start ?? '?', dates.end ?? 'present'].join(' to ');
  const lines = [
    `### ${record.id}`,
    `kind: ${record.kind ?? 'other'}`,
    `title: ${record.title ?? ''}`,
    `org: ${record.org ?? ''}`,
    `dates: ${period}`,
    `tags: ${(record.tags ?? []).join(', ')}`,
  ];

  if (record?.figuresReleasable === false) {
    lines.push(
      'figures: NOT RELEASABLE — any bullet citing this record must contain no figures at all. ' +
        'Describe the mechanism, the data and the decision instead.',
    );
  } else {
    const numbers = (record?.numbers ?? []).map((n) => n.raw ?? n.value ?? n).join(', ');
    if (numbers) lines.push(`figures available in this record: ${numbers}`);
  }

  lines.push('', String(record?.body ?? '').trim());
  return lines.join('\n');
}

export default generateArtifact;
