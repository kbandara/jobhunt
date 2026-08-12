// WHY: which evidence the model sees decides what the CV can say, so the choice
// is made by deterministic code — same job, same profile, same
// pack, every time. Records are offered WHOLE and never as fragments, so the
// model cannot attribute a number to a record that does not contain it.

/** Sane per-kind caps; publications instead follow the profile's policy. */
const CAPS = {
  role: 6,
  finding: 4,
  skill: 4,
  award: 2,
  service: 2,
  education: Infinity,
  project: Infinity,
};

const TAG_WEIGHT = 3;
const TERM_WEIGHT = 1;
const RECENCY_WEIGHT = 2; // a current record scores 2, a ten-year-old one scores 0
const RECENCY_YEARS = 10;

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it',
  'of', 'on', 'or', 'our', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'with', 'you',
  'your', 'we', 'will', 'able', 'across', 'experience', 'strong', 'work', 'working', 'role',
]);

/**
 * @param {object} options
 * @param {object[]} options.evidence all records from parse.js
 * @param {object} options.jdJson parse-jd output (skills / requirements / domain_vocabulary)
 * @param {string} options.profile confirmed profile
 * @param {object} options.profileConfig the profile's JSON config
 * @param {Date} [options.now] injectable, so recency scoring is testable
 * @returns {{selected: object[], offeredIds: string[]}}
 */
export function selectEvidence({ evidence = [], jdJson, profile, profileConfig = {}, now = new Date() } = {}) {
  const jd = jdJson ?? {};
  const requirementText = requirementsOf(jd).join(' ');
  // The advertisement's own technical words count for as much as its skills list:
  // an ad that says "EEG" and "PyTorch" is telling you which records it wants.
  const vocabularyText = vocabularyOf(jd).join(' ');
  // Tags are a controlled vocabulary, so they match on exact tokens (including
  // one-letter ones like "r"); prose terms need a length floor to stay useful.
  const tagVocabulary = tokenize(
    [skillsOf(jd).join(' '), vocabularyText, requirementText, jd.title ?? ''].join(' '),
    1,
  );
  const requirementTerms = tokenize([requirementText, vocabularyText].join(' '), 3);

  // Which evidence tags in master-profile.md this CV profile may draw from.
  // Without this a new profile could match nothing at all, because a record only
  // reaches a profile through a tag they share.
  //
  // `"*"` means every record, whatever it is tagged with. The stock profiles ship
  // that way on purpose: evidence tags are a vocabulary you invent, so a profile
  // that named specific ones would match nothing in a profile written by somebody
  // who called their tags something else. Narrow a profile by editing it.
  const declared = Array.isArray(profileConfig?.evidenceProfiles) ? profileConfig.evidenceProfiles : [];
  const drawFromAll = declared.includes('*');
  const drawFrom = new Set(declared.length > 0 ? declared : [profile]);

  const scored = evidence
    .filter(
      (record) =>
        record &&
        !record.isGap &&
        (drawFromAll || (record.evidenceProfiles ?? []).some((tag) => drawFrom.has(tag))),
    )
    .map((record) => ({ record, score: scoreRecord(record, { tagVocabulary, requirementTerms, profileConfig, now }) }))
    .sort(compare);

  const caps = { ...CAPS, publication: publicationCap(profileConfig) };
  const taken = {};
  const selected = [];

  for (const entry of scored) {
    const kind = entry.record.kind ?? 'other';
    const cap = caps[kind] ?? Infinity;
    taken[kind] = taken[kind] ?? 0;
    if (taken[kind] >= cap) continue;
    taken[kind] += 1;
    selected.push(entry);
  }

  // Lead order for the prompt: the profile's most important kinds first.
  selected.sort((a, b) => {
    const priority = kindPriority(b.record, profileConfig) - kindPriority(a.record, profileConfig);
    return priority !== 0 ? priority : compare(a, b);
  });

  const records = selected.map((entry) => entry.record);
  return { selected: records, offeredIds: records.map((r) => r.id) };
}

/** Score desc, then id asc — never input order, so reruns are identical. */
function compare(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  return String(a.record.id).localeCompare(String(b.record.id), 'en');
}

function scoreRecord(record, { tagVocabulary, requirementTerms, profileConfig, now }) {
  const tagHits = (record.tags ?? []).filter((tag) => tagMatches(tag, tagVocabulary)).length;

  const bodyTerms = new Set(tokenize(record.body ?? '', 3));
  const termHits = requirementTerms.filter((term) => bodyTerms.has(term)).length;

  const score =
    TAG_WEIGHT * tagHits +
    TERM_WEIGHT * termHits +
    recencyScore(record, now) +
    kindPriority(record, profileConfig);

  return Math.round(score * 1e6) / 1e6; // keep ties exact for the id tie-break
}

/** A multi-word tag ("fraud-analytics") counts when every part of it appears. */
function tagMatches(tag, vocabulary) {
  const parts = tokenize(tag, 1);
  return parts.length > 0 && parts.every((part) => vocabulary.includes(part));
}

function kindPriority(record, profileConfig) {
  return profileConfig?.kindPriority?.[record.kind] ?? 0;
}

/**
 * Linear decay over ten years; a null end date means the work is current.
 * Measured in whole months, because that is all the precision `dates:` has —
 * scoring finer than the data would let a stray day decide the ordering.
 */
function recencyScore(record, now) {
  const months = monthsBetween(endMonth(record, now), monthIndex(now.getUTCFullYear(), now.getUTCMonth()));
  const years = months / 12;
  return RECENCY_WEIGHT * Math.max(0, Math.min(1, 1 - years / RECENCY_YEARS));
}

const monthIndex = (year, monthZeroBased) => year * 12 + monthZeroBased;
const monthsBetween = (from, to) => to - from;

function endMonth(record, now) {
  const nowMonth = monthIndex(now.getUTCFullYear(), now.getUTCMonth());
  const end = record?.dates?.end;
  if (!end) return nowMonth; // still current
  const [year, month] = String(end).split('-');
  if (!/^\d{4}$/.test(year)) return nowMonth;
  return monthIndex(Number(year), month ? Number(month) - 1 : 11);
}

function publicationCap(profileConfig) {
  const policy = profileConfig?.publications ?? {};
  if (policy.policy === 'omit') return 0;
  if (policy.policy === 'all') return Infinity;
  return typeof policy.count === 'number' ? policy.count : 3;
}

function skillsOf(jd) {
  return Array.isArray(jd?.skills) ? jd.skills.map(String) : [];
}

/** The technical terms the advertisement itself used, from parse-jd. */
function vocabularyOf(jd) {
  return Array.isArray(jd?.domain_vocabulary) ? jd.domain_vocabulary.map(String) : [];
}

function requirementsOf(jd) {
  if (!Array.isArray(jd?.requirements)) return [];
  return jd.requirements.map((r) => (typeof r === 'string' ? r : (r?.text ?? ''))).filter(Boolean);
}

/** Lowercase word tokens, minus stopwords and anything shorter than `minLength`. */
function tokenize(text, minLength) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((token) => token.length >= minLength && !STOPWORDS.has(token));
}
