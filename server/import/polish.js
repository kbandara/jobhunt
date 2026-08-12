// WHY: a master profile written in a hurry reads like notes, because that is
// what it is — "did some fieldwork, wrote the analysis". The facts are all there
// and the record is doing none of the work it could. Tightening it is exactly
// the kind of thing a model is good at.
//
// It is also exactly the kind of thing this app exists to stop a model doing
// unsupervised. "Make it sound better" and "make it sound better than it was"
// are one careless sentence apart, and the master profile is the worst possible
// place for that sentence to land: every downstream check validates a document
// AGAINST these records, so a number added here is not caught later — it becomes
// the truth the checker enforces.
//
// So the rewrite is CHECKED IN CODE, not trusted:
//
//   - a figure in the rewrite that was not in the original is a rejection
//   - a rewrite that drops a figure the original had is a rejection
//   - a rewrite for a record id that does not exist is a rejection
//   - a rewrite that has grown by more than half is a rejection, because prose
//     that doubles in length has acquired content from somewhere
//
// Rejections are shown, not hidden: seeing what the model tried to slip in is
// more instructive than a silent filter. And nothing is written at all until the
// person accepts it, one record at a time.
//
// What the model IS free to do is ask. `asks` carries questions only the person
// can answer — "how many sites?", "what did it go down to?" — which is the
// honest version of the thing that would otherwise be invented.
import { extractNumbers, numbersMatch } from '../profile/numbers.js';

/** A rewrite this much longer than the original has gained content, not clarity. */
const GROWTH_LIMIT = 1.6;

export function polishSystemPrompt() {
  return [
    'You are tightening the wording of somebody\'s master profile: the record of what they have',
    'done, which a separate system uses as the ONLY permitted source of facts when it writes',
    'their job applications.',
    '',
    'You are editing HOW each record reads. You are not editing WHAT IT SAYS.',
    '',
    'This distinction is the whole task, and it is enforced in code after you answer: a rewrite',
    'containing a figure the original did not contain is rejected automatically, as is one that',
    'loses a figure the original had. You cannot smuggle anything past it, so do not try — a',
    'rejected suggestion helps nobody, least of all the person reading it.',
    '',
    '## What a good rewrite does',
    '',
    '- **Leads with the outcome, then the method.** "Cut the reporting step from three days to',
    '  one by automating it" beats "was responsible for automating the reporting step, which',
    '  previously took three days".',
    '- **Uses verbs that carry a result**: built, designed, led, reduced, replicated, shipped,',
    '  established, found, validated. Not: undertook, utilised, supported, assisted with, was',
    '  responsible for, involved in.',
    '- **Keeps every number exactly as written.** Same figure, same units, same wording. Do not',
    '  round, convert, annualise or combine.',
    '- **Keeps every name exactly as written**: employers, institutions, tools, methods.',
    '- **Says the same amount.** If the original is two sentences, the rewrite is about two',
    '  sentences. Prose that doubles in length has acquired content from somewhere.',
    '- **Stays first-person-implied and plain.** No "results-driven", no "passionate about", no',
    '  adjectives doing the work a fact should do.',
    '',
    '## What to do when a record is simply thin',
    '',
    'Some records have nothing to tighten: they are short because the person has not written down',
    'what happened. Do not pad them. Put the record in your answer with the body barely changed,',
    'and put the questions in `asks` — the specific things only they know, which would make it',
    'strong. "How many sites?" "What did the error rate go down to?" "How many students?"',
    '',
    'A question is worth more than a sentence you made up, because they can answer it and then the',
    'number is real.',
    '',
    '## What to leave alone',
    '',
    'Records that are already clear and specific. Returning them unchanged is noise. Only include',
    'a record if you are changing something or asking something.',
    '',
    'Publications: leave the body exactly as it is. It is a citation, parsed by code — rewriting',
    'it breaks the parse and changes nothing a reader sees.',
  ].join('\n');
}

/** The records, as the model sees them. Ids matter: they are how a reply is matched back. */
export function polishUserMessage(records = []) {
  const blocks = records
    .filter((record) => record && record.kind !== 'publication')
    .map((record) =>
      [
        `### ${record.id}`,
        `kind: ${record.kind}`,
        `title: ${record.title}${record.org ? ` — ${record.org}` : ''}`,
        '',
        record.body || '(empty)',
      ].join('\n'),
    );

  return [
    `${blocks.length} records. Return only the ones you are changing or asking about.`,
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

/**
 * Check every suggestion against the record it claims to rewrite.
 *
 * @param {object} reply a polish-profile response
 * @param {object[]} records the current records
 * @returns {{accepted: object[], rejected: object[]}} `accepted` entries carry
 *   `{id, before, after, why, asks}`; `rejected` entries carry `{id, after, problem}`
 *   and are shown rather than dropped.
 */
export function checkPolish(reply, records = []) {
  const byId = new Map(records.filter((record) => record?.id).map((record) => [record.id, record]));
  const accepted = [];
  const rejected = [];

  for (const suggestion of Array.isArray(reply?.suggestions) ? reply.suggestions : []) {
    const id = String(suggestion?.id ?? '').trim();
    const after = String(suggestion?.body ?? '').trim();
    const record = byId.get(id);

    if (!record) {
      rejected.push({ id, after, problem: `There is no record with the id "${id}".` });
      continue;
    }
    if (after === '') {
      rejected.push({ id, after, problem: 'The rewrite was empty.' });
      continue;
    }

    const problem = whatIsWrong(record.body ?? '', after);
    const entry = {
      id,
      title: record.title,
      org: record.org,
      before: record.body ?? '',
      after,
      why: String(suggestion?.why ?? '').trim(),
      asks: (Array.isArray(suggestion?.asks) ? suggestion.asks : []).map(String).filter(Boolean),
    };

    if (problem) rejected.push({ ...entry, problem });
    else if (after !== (record.body ?? '').trim() || entry.asks.length > 0) accepted.push(entry);
  }

  return { accepted, rejected };
}

/** The rule the model was told about, applied. Null when the rewrite is honest. */
function whatIsWrong(before, after) {
  const original = extractNumbers(before);
  const rewritten = extractNumbers(after);

  // numbersMatch, not raw string equality: "2,500" and "2500" are the same
  // figure written twice, and rejecting a rewrite for reformatting one would
  // make the check useless noise.
  const invented = rewritten.filter(
    (number) => !original.some((existing) => numbersMatch(existing, number).match),
  );
  if (invented.length > 0) {
    return (
      `the rewrite contains ${invented.map((n) => `"${n.raw}"`).join(', ')}, which the record ` +
      `does not. A figure that is not in the record cannot be added by a rewrite — if it is real, ` +
      `edit the record and put it in.`
    );
  }

  const lost = original.filter(
    (number) => !rewritten.some((kept) => numbersMatch(kept, number).match),
  );
  if (lost.length > 0) {
    return (
      `the rewrite drops ${lost.map((n) => `"${n.raw}"`).join(', ')}. Numbers are the most useful ` +
      `thing in a record and a tidy-up must not lose them.`
    );
  }

  if (before.trim() !== '' && after.length > before.length * GROWTH_LIMIT) {
    return (
      `the rewrite is ${Math.round((after.length / before.length - 1) * 100)}% longer than the ` +
      `record. Prose that grows this much has gained content, and content is what a rewrite may ` +
      `not add.`
    );
  }

  return null;
}
