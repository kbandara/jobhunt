// WHY: most applications are read by a machine before they are read by a person,
// and the machine is doing term matching. An applicant tracking system — and the
// recruiter running a boolean search over it — is looking for the words the
// requisition used. A CV that says "measurement instruments for language models"
// against an ad that says "evaluations" describes the same work and scores zero
// on the term that mattered.
//
// So the words of the advertisement are extracted HERE, in code, and handed to
// the generator as a ranked list. Two reasons it is not left to the model to
// notice them for itself:
//
// 1. The model is given the parsed ad as a JSON blob, where the words sit as
//    data. Data gets read; an explicit "these are the terms this will be matched
//    on" gets acted on.
// 2. Coverage can then be MEASURED afterwards, against the same list, and shown.
//    A tailoring claim nobody can check is a tailoring claim nobody should
//    believe.
//
// THE HONESTY LINE, which everything here is subordinate to: this changes
// WORDING, never CLAIMS. Preferring the ad's name for something genuinely done
// is good writing. Adding a term for work nobody did is a lie that an
// interview finds in one question, and the prompt says so in as many words. This
// module never asks for a keyword list, a "skills matrix", or white text — the
// tricks that get a CV binned by the human who opens it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../store.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Shared with the validator on purpose: a term the generator was told to use
 *  and the checker then cannot find would be maddening, and that is exactly what
 *  two separate stop-word lists produce. */
const STOPWORDS = new Set(readJson(path.join(here, '..', 'validate', 'stopwords.json')).words ?? []);

/**
 * How much each place a term came from is worth.
 *
 * A must-have requirement is what the screen is filtering on, and the `skills`
 * and `domain_vocabulary` arrays are already terms rather than prose — parse-jd
 * pulled them out as the ad's own vocabulary, so they need no mining and are
 * trusted accordingly (D006: prefer the structured field to a text search).
 */
export const SOURCE_WEIGHTS = {
  'must-have': 4,
  skill: 3,
  vocabulary: 3,
  responsibility: 2,
  desirable: 1,
};

/** Longest phrase worth treating as one term. Past three words it is a sentence. */
const PHRASE_MAX = 3;

/** How many terms to carry. Enough to matter, few enough that the list is read. */
export const DEFAULT_LIMIT = 24;

/**
 * The terms this application will be matched on, ranked.
 *
 * @param {object} options
 * @param {object} options.jdJson parse-jd output
 * @param {number} [options.limit]
 * @returns {{term: string, weight: number, sources: string[]}[]} highest first
 */
export function extractKeywords({ jdJson = {}, profileMeta = {}, limit = DEFAULT_LIMIT } = {}) {
  const forbidden = qualificationTerms(profileMeta);
  const found = new Map(); // normalised term -> { term, weight, sources:Set }

  const add = (raw, source) => {
    const term = tidy(raw);
    if (!isUseful(term)) return;
    // "An awarded PhD at the time of application" is a real requirement and
    // "awarded phd" is a real term in it — and it is the one phrase this person
    // must never write. Suggesting it would be the app inviting the exact claim
    // its own validator exists to stop.
    if (forbidden.some((pattern) => pattern.test(term))) return;
    const key = normalise(term);
    if (key === '') return;
    if (!found.has(key)) found.set(key, { term, weight: 0, sources: new Set() });
    const entry = found.get(key);
    entry.weight += SOURCE_WEIGHTS[source] ?? 1;
    entry.sources.add(source);
    // Prefer the shortest spelling seen: "evaluation" over "the evaluations".
    if (term.length < entry.term.length) entry.term = term;
  };

  // The structured fields first — they are already the ad's vocabulary.
  for (const skill of asArray(jdJson?.skills)) add(skill, 'skill');
  for (const word of asArray(jdJson?.domain_vocabulary)) add(word, 'vocabulary');

  for (const requirement of asArray(jdJson?.requirements)) {
    const text = typeof requirement === 'string' ? requirement : requirement?.text;
    const mustHave = requirement?.must_have ?? requirement?.mustHave ?? false;
    for (const phrase of phrasesIn(text)) add(phrase, mustHave ? 'must-have' : 'desirable');
  }

  for (const duty of asArray(jdJson?.responsibilities)) {
    for (const phrase of phrasesIn(duty)) add(phrase, 'responsibility');
  }

  // Weight first, then the LONGER phrase — at equal weight "applied statistics"
  // is the ad's actual phrase and "applied" is the fragment of it. Sorting the
  // fragment first would keep it and then fail to subsume the phrase, leaving
  // both, which is how the list fills with half-terms.
  const ranked = [...found.values()]
    .map((entry) => ({ term: entry.term, weight: entry.weight, sources: [...entry.sources] }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        wordCount(b.term) - wordCount(a.term) ||
        a.term.localeCompare(b.term),
    );

  return dropSubsumed(ranked).slice(0, Math.max(0, limit));
}

/**
 * Which of those terms the document actually uses.
 *
 * A phrase counts only when its words appear together, in order. "Item response
 * theory" matched by a document containing "item", "response" and "theory" in
 * three unrelated bullets would be a coverage number that means nothing, and a
 * number that means nothing is worse than no number.
 *
 * @param {object} options
 * @param {{term: string, weight: number}[]} options.keywords
 * @param {string} options.text the document
 * @returns {{covered: object[], missing: object[], score: number}} score is the
 *   share of total WEIGHT covered, not of terms — missing a must-have costs more
 *   than missing a nice-to-have, which is also how the screen works.
 */
export function coverage({ keywords = [], text = '' } = {}) {
  const haystack = ` ${normalise(text)} `;
  const covered = [];
  const missing = [];

  for (const keyword of keywords) {
    const needle = normalise(keyword.term);
    if (needle !== '' && haystack.includes(` ${needle} `)) covered.push(keyword);
    else missing.push(keyword);
  }

  const total = keywords.reduce((sum, k) => sum + (k.weight ?? 1), 0);
  const hit = covered.reduce((sum, k) => sum + (k.weight ?? 1), 0);
  return { covered, missing, score: total === 0 ? 1 : hit / total };
}

/**
 * The terms rendered for a prompt, with the rule that governs them.
 *
 * The rule is longer than the list on purpose. Handing a model a list of words
 * and no constraint is how you get a "Key Skills" block full of things nobody
 * did — which reads as a lie to the person who opens the CV, and is one, and
 * costs the interview that would have found it.
 */
export function keywordSection(keywords = []) {
  if (keywords.length === 0) return [];
  return [
    `## The words this advertisement uses (${keywords.length})`,
    '',
    'Ranked by how much weight the advertisement puts on each. An applicant tracking system,',
    'and the recruiter running a search over it, matches on these exact terms — so where a',
    'record shows the work was genuinely done, use the advertisement\'s word for it rather',
    'than your own synonym for it. "Evaluations" beats "measurement instruments" when the ad',
    'says evaluations, and it costs nothing, because it is the same work.',
    '',
    keywords.map((k) => `- ${k.term}`).join('\n'),
    '',
    'The hard limit on this, which overrides everything above: THIS CHANGES WORDING, NOT',
    'CLAIMS. Use a term only where an evidence record supports the work it describes. Do not',
    'add a term for work the applicant has not done, do not add a keyword list or a "key skills"',
    'block to hold terms that do not fit anywhere real, and do not stretch a record to reach a',
    'word. A CV padded with terms is discarded by the person who reads it after the machine,',
    'and an invented one is found by the first interview question about it.',
    '',
    'A term with no honest home in the document is meant to be left out. It will be reported',
    'as missing, which is useful information for the applicant — it is not a failure on your part.',
  ];
}

// --- the text machinery -------------------------------------------------------

/**
 * Every 1..3-word phrase in a string that could be a term.
 *
 * Phrases may not begin or end on a stop word: "design of evaluations" yields
 * "evaluations" and "design", not "of evaluations" or "design of".
 */
function phrasesIn(text) {
  // Built from the words AS WRITTEN, not from the folded forms used for
  // matching. The list goes to a model as "use the advertisement's word for it",
  // so an ad asking for "statistics" must not come back as "statistic" — that is
  // not the advertisement's word, it is this file's index key.
  const raw = rawWords(text);
  const folded = raw.map(singular);
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (STOPWORDS.has(folded[i])) continue;
    for (let n = 1; n <= PHRASE_MAX && i + n <= raw.length; n += 1) {
      // A stop word ANYWHERE in the phrase, not just at the ends. "evaluations
      // of language" and "psychometrics and item" both read like terms and are
      // not: they straddle the join between two things the ad listed, and
      // nobody has ever searched for either.
      if (folded.slice(i, i + n).some((word) => STOPWORDS.has(word))) continue;
      out.push(raw.slice(i, i + n).join(' '));
    }
  }
  return out;
}

/**
 * Drop a term that only ever appears inside a longer one that scored at least as
 * well. Without this the list reads "evaluation, language model evaluation,
 * model evaluation, evaluations" and the model is told the same thing four times.
 */
function dropSubsumed(ranked) {
  const kept = [];
  for (const entry of ranked) {
    const key = normalise(entry.term);
    const inside = kept.some((other) => {
      const longer = normalise(other.term);
      return longer !== key && ` ${longer} `.includes(` ${key} `);
    });
    if (!inside) kept.push(entry);
  }
  return kept;
}

/** A term worth carrying: long enough to mean something, not a stop word. */
function isUseful(term) {
  const parts = words_(term);
  if (parts.length === 0) return false;
  if (parts.every((word) => STOPWORDS.has(word))) return false;
  // A single short word is almost always noise — except the ones that are not,
  // which are exactly the ones with a symbol in them: R, C#, C++, Go, AI, ML.
  if (parts.length === 1 && parts[0].length < 3 && !/[+#]/.test(parts[0])) return false;
  return true;
}

/** Collapse whitespace and strip surrounding punctuation, keeping the spelling. */
function tidy(value) {
  return String(value ?? '').replace(/\s+/g, ' ').replace(/^[^\w(]+|[^\w)+#]+$/g, '').trim();
}

/**
 * Comparable form: lowercase, punctuation gone, plurals folded.
 *
 * `+` and `#` survive because "c++" and "c#" are terms and "c" is not. Folding
 * plurals is what lets an ad asking for "evaluations" be satisfied by a CV that
 * says "evaluation", which is the same claim in different clothes.
 */
export function normalise(text) {
  return words_(text).join(' ');
}

function words_(text) {
  return rawWords(text).map(singular);
}

/** The words as written, lowercased — punctuation gone, spelling intact. */
function rawWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean);
}

/**
 * Plural to singular, for the endings that are safe to strip.
 *
 * Conservative on purpose. Folding too eagerly is not a cosmetic error: it makes
 * two different terms compare equal, so the screen reports a word as covered
 * that the document never used. "Bias" is not the plural of "bia".
 */
export function singular(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && /(?:ss|us|is|as|os)$/.test(word)) return word; // bias, status, analysis
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Terms that would assert a qualification this person does not have.
 *
 * Built from the same booleans the validator's R4 reads, so the two cannot
 * disagree. Without this, an advertisement requiring "an awarded PhD" puts
 * "awarded phd" near the top of the list of words to work into the CV — which
 * is the app inviting the single claim it exists to prevent.
 */
function qualificationTerms(profileMeta) {
  const unawarded = Object.values(profileMeta?.qualifications ?? {})
    .filter((value) => value && typeof value === 'object' && value.awarded === false);
  if (unawarded.length === 0) return [];

  // One pattern, not one per qualification. A status verb is a useless term on
  // its own — nobody searches a CV for "awarded" — so dropping all of them costs
  // nothing and closes the whole class, including "awarded phd", "phd awarded"
  // and "recently conferred".
  return [/\b(?:awarded|conferred|graduated)\b/i];
}

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordCount = (term) => String(term).trim().split(/\s+/).filter(Boolean).length;
const asArray = (value) => (Array.isArray(value) ? value : []);
