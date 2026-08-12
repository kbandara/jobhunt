// WHY: the model returns structured data, never a document — so this file is the
// only place a CV becomes text. It is pure and deterministic (same input, same
// bytes) so two runs can be diffed, and it puts the code-generated contact block
// in verbatim (D007) and orders sections by the profile config, because "the same CV
// with a different heading order" is diagnosed defect #3.

import { aliasesFor, headingFor } from './sections.js';
import { normaliseSections } from './profiles/index.js';

const EM_DASH = '—';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const normalise = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Render one artifact as markdown.
 *
 * @param {object} options
 * @param {object} options.artifact structured output from generate-cv / generate-cover-letter
 * @param {'cv'|'cover-letter'} options.artifactKind
 * @param {string} options.profile confirmed profile id
 * @param {object} options.profileConfig server/generate/profiles/<profile>.json
 * @param {string[]} options.contactLines code-generated contact block, injected verbatim
 * @param {object} [options.jobMeta] { company, roleTitle, date } — job facts, never model prose
 * @param {string[]} [options.publications] APA citations, already rendered by
 *   server/profile/citation.js and already in the order they should appear. When
 *   supplied these REPLACE whatever the model wrote under publications: a
 *   citation is checkable in ten seconds and is the last thing that should be
 *   paraphrased. When absent the model's own section is used, so nothing that
 *   does not know about this option changes behaviour.
 * @returns {string} markdown
 */
export function assemble({
  artifact = {},
  artifactKind = 'cv',
  profile,
  profileConfig = {},
  contactLines = [],
  jobMeta = {},
  publications,
} = {}) {
  // A cold email is the one document that is not a document — it goes in a mail
  // client, where a typeset contact block at the top would be pasted in as a
  // letterhead. Your name and details belong in the sign-off, and coldEmailBlocks
  // puts them there.
  if (artifactKind === 'cold-email') {
    return coldEmailBlocks(artifact, jobMeta, contactLines).join('\n\n') + '\n';
  }

  const blocks =
    artifactKind === 'cover-letter'
      ? coverLetterBlocks(artifact, jobMeta)
      : artifactKind === 'criteria'
        ? criteriaBlocks(artifact)
        : cvBlocks(artifact, profileConfig, publications);

  return [...contactBlocks(contactLines), ...blocks].join('\n\n') + '\n';
}

/**
 * The contact block. Line 1 (your name) is the document title; the rest are their
 * own paragraphs so each survives markdown rendering on its own line — and every
 * one appears byte-for-byte, which is exactly what validator R7 checks.
 */
function contactBlocks(contactLines) {
  const lines = (Array.isArray(contactLines) ? contactLines : []).map(clean).filter(Boolean);
  if (lines.length === 0) return [];
  return [`# ${lines[0]}`, ...lines.slice(1)];
}

// --- CV --------------------------------------------------------------------

function cvBlocks(artifact, profileConfig, publications) {
  const sections = Array.isArray(artifact?.sections) ? artifact.sections : [];
  const used = new Set();
  const blocks = [];
  const chosen = Array.isArray(publications) ? publications.map(clean).filter(Boolean) : null;

  for (const wanted of normaliseSections(profileConfig)) {
    if (wanted.id === 'summary') {
      blocks.push(...summaryBlocks(artifact, sections, used));
      continue;
    }

    if (wanted.id === 'publications' && chosen !== null) {
      // The model's publications section is consumed and discarded, not left to
      // be re-emitted by the catch-all below — otherwise the document would
      // carry both the chosen citations and the model's paraphrase of them.
      const modelIndex = findSection(sections, 'publications', used, profileConfig);
      if (modelIndex !== -1) used.add(modelIndex);
      if (chosen.length > 0) blocks.push(...publicationBlocks(chosen, wanted));
      continue;
    }

    const index = findSection(sections, wanted.id, used, profileConfig);
    if (index === -1) continue; // nothing to say here: omit the heading entirely
    used.add(index);
    blocks.push(...sectionBlocks(sections[index], wanted, profileConfig));
  }

  // Anything the model produced that the profile order does not name still belongs
  // in the document — dropping content silently is how a CV loses its best line.
  sections.forEach((section, index) => {
    if (used.has(index)) return;
    blocks.push(...sectionBlocks(section, null, profileConfig));
  });

  return blocks;
}

/** The summary is `artifact.summary`, but tolerate a model that made it a section. */
function summaryBlocks(artifact, sections, used) {
  const text = clean(artifact?.summary?.text);
  if (text) return [`## ${headingFor('summary')}`, text];

  const index = findSection(sections, 'summary', used, {});
  if (index === -1) return [];
  used.add(index);
  return sectionBlocks(sections[index], { id: 'summary' }, {});
}

function findSection(sections, key, used, profileConfig) {
  const aliases = aliasesFor(key);
  const techName = normalise(profileConfig?.techSectionName);
  const wanted = key === 'skills' && techName ? [...aliases, ...techName.split(' ')] : aliases;

  return sections.findIndex((section, index) => {
    if (used.has(index)) return false;
    const tokens = normalise(section?.heading).split(' ').filter(Boolean);
    // Whole-word match, not substring: "Framework" must not read as "work".
    return tokens.some((token) => wanted.some((word) => sameWord(token, word)));
  });
}

const sameWord = (a, b) => a === b || a === `${b}s` || b === `${a}s`;

/**
 * Render one section.
 *
 * @param {object} section the model's section: { heading, entries }
 * @param {object|null} wanted the profile's slot: { id, heading?, max?, style? }
 * @param {object} profileConfig the whole profile config, for `skillGroups`
 */
function sectionBlocks(section, wanted, profileConfig = {}) {
  const all = Array.isArray(section?.entries) ? section.entries : [];
  // `max` is the profile's length budget for this section, e.g. five publications.
  const entries = Number.isFinite(wanted?.max) ? all.slice(0, Math.max(0, wanted.max)) : all;

  // The profile's own wording wins if it set one; otherwise keep what the model called
  // it, because the model chose the heading to suit this particular advertisement.
  const heading = clean(wanted?.heading) || clean(section?.heading) || headingFor(wanted?.id) || 'Details';
  const blocks = [`## ${heading}`];

  const grouped = wanted?.id === 'skills' ? skillGroupBlocks(entries, profileConfig.skillGroups) : null;
  if (grouped) {
    blocks.push(...grouped);
    return blocks.length === 1 ? [] : blocks;
  }

  let lineRun = []; // consecutive one-line entries render as one list

  const flush = () => {
    if (lineRun.length === 0) return;
    blocks.push(lineRun.map((line) => `- ${line}`).join('\n'));
    lineRun = [];
  };

  for (const entry of entries) {
    const line = clean(entry?.line) || (wanted?.style === 'lines' ? entryAsLine(entry) : '');
    if (line) {
      lineRun.push(line);
      continue;
    }
    flush();
    blocks.push(...entryBlocks(entry));
  }
  flush();

  return blocks.length === 1 ? [] : blocks; // a heading with no content is noise
}

/**
 * The publications section, rendered from citations you chose rather than from
 * anything the model wrote.
 *
 * Deliberately ignores the profile's `max`: the list was already narrowed by
 * hand, and silently dropping the eleventh paper you had just ticked would be
 * the app overruling you. `max` is a budget for a model that does not know when
 * to stop, and that is no longer what is producing this section.
 */
function publicationBlocks(citations, wanted) {
  const heading = clean(wanted?.heading) || headingFor('publications') || 'Publications';
  return [`## ${heading}`, citations.map((line) => `- ${line}`).join('\n')];
}

/** `style: "lines"` — one entry, one line, built only from fields the model set. */
function entryAsLine(entry) {
  const head = [clean(entry?.title), clean(entry?.org)].filter(Boolean).join(` ${EM_DASH} `);
  const dates = clean(entry?.dates);
  const bullets = (Array.isArray(entry?.bullets) ? entry.bullets : []).map((b) => clean(b?.text)).filter(Boolean);
  const tail = [dates, ...bullets].filter(Boolean).join('. ');
  return [head, tail].filter(Boolean).join(' — ');
}

// --- skills as labelled groups ----------------------------------------------
//
// Your own LaTeX CV groups skills under labels (Languages / Analysis / Machine
// learning / Data and tooling / Domain) rather than running them together in one
// blob, because a reader skimming for "Python" finds it faster on a labelled line.
// The groups only re-arrange what the model already wrote: nothing is added, and
// anything that fits no group is still printed rather than quietly dropped.

/** Returns null when the profile defines no groups, so the caller renders as before. */
function skillGroupBlocks(entries, skillGroups) {
  if (!Array.isArray(skillGroups) || skillGroups.length === 0) return null;

  const items = skillItems(entries);
  if (items.length === 0) return null;

  const buckets = skillGroups.map((group) => ({ label: clean(group?.label), tags: (group?.tags ?? []).map(normalise), items: [] }));
  const leftovers = [];

  for (const item of items) {
    const key = normalise(item);
    const bucket = buckets.find((b) => b.tags.some((tag) => tag !== '' && phraseIn(key, tag)));
    (bucket ? bucket.items : leftovers).push(item);
  }

  const lines = buckets
    .filter((bucket) => bucket.items.length > 0)
    .map((bucket) => `- **${bucket.label}:** ${bucket.items.join(', ')}`);
  // Un-grouped skills keep their own line with no label: inventing a category for
  // them would be a claim the profile config never made.
  if (leftovers.length > 0) lines.push(`- ${leftovers.join(', ')}`);

  return lines.length === 0 ? null : [lines.join('\n')];
}

/**
 * Split a skills line on its commas — but not on the commas inside a bracket.
 * "Python (NumPy, SciPy, PyTorch)" is one skill with a parenthetical, and cutting
 * it at every comma leaves "Python (NumPy" on the page.
 */
function splitSkillLine(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of String(text)) {
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    else if ((character === ',' || character === ';') && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

/** The individual skills the model wrote, in order, without repeats. */
function skillItems(entries) {
  const out = [];
  const seen = new Set();
  const add = (text) => {
    for (const part of splitSkillLine(text)) {
      const item = part.trim().replace(/\.$/, '').trim();
      if (item === '') continue;
      const key = normalise(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  };

  for (const entry of entries) {
    const line = clean(entry?.line);
    if (line) {
      add(line);
      continue;
    }
    for (const bullet of Array.isArray(entry?.bullets) ? entry.bullets : []) add(clean(bullet?.text));
  }
  return out;
}

/** Whole-phrase containment, so the tag "r" does not match the word "research". */
const phraseIn = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);

function entryBlocks(entry) {
  const blocks = [];
  const title = clean(entry?.title);
  const org = clean(entry?.org);
  const dates = clean(entry?.dates);

  const heading = [title, org].filter(Boolean).join(` ${EM_DASH} `);
  if (heading) blocks.push(`### ${heading}`);
  if (dates) blocks.push(dates);

  const bullets = (Array.isArray(entry?.bullets) ? entry.bullets : [])
    .map((bullet) => clean(bullet?.text))
    .filter(Boolean);
  if (bullets.length > 0) blocks.push(bullets.map((text) => `- ${text}`).join('\n'));

  return blocks;
}

// --- Cover letter ----------------------------------------------------------

function coverLetterBlocks(artifact, jobMeta) {
  const blocks = [];

  const date = clean(jobMeta?.date);
  if (date) blocks.push(date);

  const subject = [clean(jobMeta?.roleTitle), clean(jobMeta?.company)].filter(Boolean).join(', ');
  if (subject) blocks.push(`Re: ${subject}`);

  const paragraphs = Array.isArray(artifact?.paragraphs)
    ? artifact.paragraphs
    : flattenParagraphs(artifact);

  for (const paragraph of paragraphs) {
    const text = clean(paragraph?.text);
    if (text) blocks.push(text);
  }

  return blocks;
}

// --- cold email --------------------------------------------------------------

/**
 * An email, laid out as one would be pasted into a mail client: a subject line
 * you can copy, then the greeting, the body, and a sign-off carrying your contact
 * details.
 *
 * The greeting and the sign-off are written here rather than by the model. Both
 * are pure form — "Hi <team>," and a name with a phone number — and both are
 * places a model reliably adds a flourish nobody wants. The contact details in
 * particular are code-generated everywhere else in this app (D007) and there is
 * no reason for an email to be the exception.
 */
function coldEmailBlocks(artifact, jobMeta, contactLines) {
  const lines = (Array.isArray(contactLines) ? contactLines : []).map(clean).filter(Boolean);
  const name = lines[0] ?? '';
  const company = clean(jobMeta?.company);

  const subject = clean(artifact?.subject);
  const blocks = [];

  // Marked as the subject rather than left as the first line: pasted into a
  // mail client, an unlabelled first line goes into the body by mistake.
  if (subject) blocks.push(`**Subject:** ${subject}`);

  blocks.push(company ? `Hi ${company} team,` : 'Hello,');

  for (const paragraph of Array.isArray(artifact?.paragraphs) ? artifact.paragraphs : []) {
    const text = clean(paragraph?.text);
    if (text) blocks.push(text);
  }

  if (name) blocks.push(['Best,', name, ...lines.slice(1)].join('\n'));
  return blocks;
}

// --- selection criteria and application questions ---------------------------

/**
 * One "## " heading per question, then the answer as prose.
 *
 * Prose, not bullets, and no "STAR:" labels: these get pasted into a portal
 * textarea, and most strip formatting entirely. What survives is paragraphs
 * separated by blank lines, so that is what the document is made of.
 *
 * The heading is the question verbatim, which also makes the split unambiguous
 * later — server/generate/questions.js counts each answer's words against its
 * limit by reading these headings back out of the saved markdown.
 */
function criteriaBlocks(artifact) {
  const answers = Array.isArray(artifact?.answers) ? artifact.answers : [];
  const blocks = [];

  for (const answer of answers) {
    const criterion = clean(answer?.criterion);
    if (!criterion) continue;

    const paragraphs = (Array.isArray(answer?.paragraphs) ? answer.paragraphs : [])
      .map((p) => clean(p?.text))
      .filter(Boolean);
    // A heading with no answer under it is worse than no heading: pasted into a
    // portal it becomes an empty box you believe you have filled.
    if (paragraphs.length === 0) continue;

    blocks.push(`## ${criterion}`, ...paragraphs);
  }

  return blocks;
}

/** Fallback for a model that answered in the CV shape (sections of bullets). */
function flattenParagraphs(artifact) {
  const out = [];
  for (const section of artifact?.sections ?? []) {
    for (const entry of section?.entries ?? []) {
      for (const bullet of entry?.bullets ?? []) out.push(bullet);
    }
  }
  return out;
}

export default assemble;
