// WHY: this app started as one person's, and their surname was spelled out in
// the source — a constant in the citation parser, two regexes in the validator,
// and two sentences in prompts. That is fine until somebody else runs it, at
// which point their copy decides whether THEY are first author on a paper by
// looking for a stranger's surname, and fails to notice a "Dr" in front of
// their own name because it is watching for a name they do not have.
//
// Every one of those now comes from profile-meta.json, through this module. The
// rule for anything added here: if it is a fact about a person, it belongs in
// their profile file, and code may only ask this module what that file says.

/**
 * The parts of a name that other modules need to recognise.
 *
 * Deliberately simple, and deliberately not clever about it. Names are the
 * classic place where clever rules are wrong for whole populations — mononyms,
 * multiple family names, family name first, particles like "van der". So:
 * the LAST whitespace-separated word is treated as the family name, the first
 * as the given name, and both are exposed for the caller to use as it sees fit.
 * Anyone that rule gets wrong can set `surname` and `given` explicitly.
 *
 * @param {object} profileMeta profile/profile-meta.json
 * @returns {{full: string, given: string, surname: string, aliases: string[]}}
 */
export function nameParts(profileMeta = {}) {
  const full = String(profileMeta?.name ?? '').trim();
  const explicitSurname = String(profileMeta?.surname ?? '').trim();
  const explicitGiven = String(profileMeta?.given ?? '').trim();

  // Initials ("H.") are not names, and one of them standing in as the family
  // name is how "A. H. Okonkwo" would end up looking for "H." in author lists.
  const words = full
    .replace(/,.*$/, '')
    .split(/\s+/)
    .filter((word) => word !== '' && !/^[A-Za-z]\.?$/.test(word));

  const surname = explicitSurname || familyNameIn(words);
  const given = explicitGiven || words[0] || '';
  const preferred = String(profileMeta?.preferred ?? '').trim();

  const aliases = [...new Set([given, surname, preferred].filter(Boolean))];
  return { full, given, surname, aliases };
}

/**
 * "Dr" in front of THEIR name, and only theirs.
 *
 * The profile legitimately names supervisors and co-authors — "Dr Elise Rowe" —
 * and a validator that flags a true statement about somebody else is one you
 * stop reading. So this matches the honorific only when one of their own names
 * follows it, with up to two initials in between.
 *
 * Returns null when the profile has no name to match, which is the only honest
 * answer: with nothing to compare against, every "Dr" is somebody else's.
 *
 * @param {object} profileMeta
 * @returns {RegExp|null}
 */
export function honorificPattern(profileMeta = {}) {
  const { aliases } = nameParts(profileMeta);
  if (aliases.length === 0) return null;
  return new RegExp(`\\bDr\\.?\\s+(?:[A-Z]\\.\\s*){0,2}(?:${aliases.map(escape).join('|')})\\b`, 'i');
}

/**
 * Their family name followed by ", PhD" — the other way an unawarded doctorate
 * gets claimed in passing.
 *
 * @param {object} profileMeta
 * @returns {RegExp|null}
 */
export function postNominalPattern(profileMeta = {}) {
  const { surname } = nameParts(profileMeta);
  if (!surname) return null;
  return new RegExp(`${escape(surname)},?\\s*(?:PhD|Ph\\.D\\.?|DPhil)\\b`, 'i');
}

/**
 * How to describe this person in one clause, for a prompt.
 *
 * Used where a prompt used to name one particular person and their field in as
 * many words. `headline` in profile-meta.json is the place to say what you are;
 * without one, the name alone is used, which reads fine and claims nothing.
 *
 * @param {object} profileMeta
 * @returns {string}
 */
export function describePerson(profileMeta = {}) {
  const { full } = nameParts(profileMeta);
  const headline = String(profileMeta?.headline ?? '').trim();
  if (!full) return headline || 'the candidate';
  return headline ? `${full}, ${headline}` : full;
}

/**
 * What is true about their qualifications, as a sentence for a prompt.
 *
 * Built from `qualifications` in profile-meta.json, which is already the
 * validator's ground truth for rule R4 — so the prompt and the checker cannot
 * disagree about whether a doctorate has been awarded. Nothing here is written
 * by hand for a particular person.
 *
 * @param {object} profileMeta
 * @returns {string} '' when the profile claims no qualifications in progress
 */
export function qualificationNote(profileMeta = {}) {
  const entries = Object.entries(profileMeta?.qualifications ?? {});
  const notes = [];

  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue;
    // `label` is the field the app's own Settings screen writes; `name` is what
    // an older hand-edited profile may say. Both are somebody's answer to the
    // same question, so both are read.
    const written = String(value.label ?? value.name ?? key).trim();
    const name = written.toUpperCase() === 'PHD' ? 'PhD' : written;
    if (value.awarded === true) continue; // an awarded degree constrains nothing

    const parts = [];
    if (value.submitted === false) parts.push('thesis NOT submitted');
    if (value.awarded === false) parts.push('degree NOT awarded');
    if (parts.length === 0) continue;

    const forms = Array.isArray(value.allowedForms) && value.allowedForms.length > 0
      ? ` The only accepted wordings are: ${value.allowedForms.map((f) => `"${f}"`).join(', ')}.`
      : '';
    notes.push(`${name}: ${parts.join(', ')}.${forms}`);
  }

  return notes.join(' ');
}

/**
 * The family name out of a list of words, allowing for the two shapes the
 * last-word rule gets wrong most often: a trailing suffix ("Okafor Jr."), and a
 * particle that belongs to the name after it ("van der Berg").
 *
 * Still a guess, and still overridable with `surname` in the profile. The cost
 * of getting it wrong is a missing "first author" note, never a wrong claim —
 * which is why a guess is allowed here at all.
 */
const PARTICLES = new Set([
  'van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'dos', 'du',
  'la', 'le', 'bin', 'ibn', 'al', 'mac', 'mc', "o'", 'ter', 'ten',
]);
const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'phd', 'md']);

function familyNameIn(words) {
  if (words.length === 0) return '';
  let end = words.length - 1;
  while (end > 0 && SUFFIXES.has(words[end].toLowerCase().replace(/,$/, ''))) end -= 1;
  let start = end;
  while (start > 0 && PARTICLES.has(words[start - 1].toLowerCase())) start -= 1;
  return words.slice(start, end + 1).join(' ');
}

/** Regex-safe: names contain dots, hyphens and apostrophes, all of them special. */
function escape(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
