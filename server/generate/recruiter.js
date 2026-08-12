// WHY: everything else in this app reads your PROFILE. This reads the document
// you are actually about to send.
//
// Those are different questions and the second one is the one that decides. The
// fit score answers "is this worth applying for", from your records, before a
// draft exists — useful triage, and it says nothing about whether the CV you
// ended up with does you justice. A draft can be honest, well cited, pass every
// check, and still bury the thing this employer cares about on page two.
//
// So: a model plays the screener for this specific role, reads the actual draft
// against the actual advertisement, and says what it would do with it. Then it
// suggests two kinds of change, and both are checked in code before you see them
// (the same discipline as import/polish.js, for the same reason):
//
//   - a term the ad uses that the draft does not, where a RECORD supports the
//     work. The record id has to be real, and the term has to be one the
//     advertisement actually used. Otherwise it is a model inventing something
//     for you to claim.
//   - a record from your profile that this application should be drawing on and
//     is not. Same rule: the id has to be real, and it must not already be cited.
//
// Suggestions that fail those checks are dropped and counted, not shown as
// advice. A review that quietly invents a qualification to "work in" would undo
// the only thing this app is for.

/** How many of each kind of suggestion is useful before it becomes a list to ignore. */
export const MAX_SUGGESTIONS = 6;

const VERDICTS = new Set(['interview', 'maybe', 'pass']);

/**
 * The screener, told who they are and what they may not do.
 *
 * @param {object} [options]
 * @param {string} [options.roleTitle] so the persona is specific rather than generic
 * @param {string} [options.company]
 * @param {string} [options.kind] 'cv' | 'cover-letter' | 'criteria'
 */
export function reviewSystemPrompt({ roleTitle = '', company = '', kind = 'cv' } = {}) {
  const role = roleTitle ? `the ${roleTitle} role` : 'this role';
  const at = company ? ` at ${company}` : '';
  const document = kind === 'cover-letter' ? 'cover letter' : kind === 'criteria' ? 'set of answers' : 'CV';

  return [
    `You are the person screening applications for ${role}${at}. A ${document} has landed in your pile,`,
    'along with the advertisement you wrote and the applicant\'s full record of what they have done.',
    '',
    'Read the document the way you actually read one: quickly, looking for whether this person can',
    'do the job, and stopping at anything that makes you doubt it. Then say what you would do.',
    '',
    '## What you are judging',
    '',
    `THE DOCUMENT IN FRONT OF YOU, not the applicant's potential. Two people with identical`,
    'experience can send documents a grade apart, and the difference is what you are here to find.',
    'If something they have done is relevant and the document does not mention it, that is a fault',
    'in the document — say so, and name the record it should have used.',
    '',
    'Address the applicant directly. They are the one reading this.',
    '',
    '## Two kinds of change, and the rule that governs both',
    '',
    'ONLY WORDING AND EMPHASIS. You may not invent a fact, and you may not suggest they claim',
    'anything the records do not show. Every suggestion has to point at a record by its id, and the',
    'id has to be one from the list you were given — a suggestion citing an id that does not exist',
    'is thrown away by the app before the applicant sees it, so guessing wastes the slot.',
    '',
    '- keywords_to_work_in: a term the advertisement uses that the document does not, where a',
    '  record shows they genuinely did that work. This is a wording change: the ad says',
    '  "evaluations", their record describes measurement instruments, and the ad\'s word is the one',
    '  a screening system searches for. If there is no honest home for a term, LEAVE IT OUT —',
    '  a document padded with terms fails with the human who reads it after the machine.',
    '- records_to_add: something in their record that answers this advertisement and is not in the',
    '  document. Name what it answers, not just that it exists.',
    '',
    'Both lists may be empty. Empty is a real answer and a better one than a stretch.',
    '',
    '## The verdict',
    '',
    '  interview  You would put this through. It answers the essentials and you can see the person.',
    '  maybe      It goes on the pile you come back to if the strong ones fall through.',
    '  pass       You would not progress it, and the concerns below say why.',
    '',
    'Judge the document, not the person, and do not soften it. "Maybe" when you mean pass costs',
    'them the chance to fix it.',
  ].join('\n');
}

/**
 * The advertisement, the document, and the records — in that order, because the
 * screener reads the ad first and everything else is measured against it.
 *
 * @param {object} options
 * @param {object} options.jdJson parse-jd output
 * @param {string} options.markdown the draft as saved
 * @param {object[]} options.records every evidence record, with ids
 * @param {string[]} [options.cited] record ids the draft already cites
 * @param {object[]} [options.keywords] extractKeywords output, so the model sees
 *   which terms the app already knows are missing
 */
export function reviewUserMessage({ jdJson = {}, markdown = '', records = [], cited = [], keywords = [] } = {}) {
  const missing = keywords.filter((keyword) => keyword?.used === false).map((keyword) => keyword.term);
  const used = new Set(cited);

  return [
    '## The advertisement you are screening against',
    '',
    '```json',
    JSON.stringify(jdJson, null, 2),
    '```',
    '',
    `## The ${'document'} that arrived`,
    '',
    markdown.trim() === '' ? '(empty)' : markdown,
    '',
    ...(missing.length > 0
      ? [
          '## Terms from your advertisement this document does not use',
          '',
          'Worked out by the app, not by you. Some of these will have no honest home in the',
          'document — say nothing about those.',
          '',
          missing.map((term) => `- ${term}`).join('\n'),
          '',
        ]
      : []),
    `## Everything the applicant has done (${records.length} records)`,
    '',
    'These are the only facts available. An id in a suggestion must come from this list.',
    'Records marked USED are already drawn on by the document.',
    '',
    records.map((record) => recordLine(record, used.has(record.id))).join('\n\n'),
  ].join('\n');
}

function recordLine(record = {}, isUsed) {
  const head = [
    `### ${record.id}${isUsed ? '  [USED]' : ''}`,
    record.title ? `title: ${record.title}` : null,
    record.org ? `org: ${record.org}` : null,
    record.dates ? `dates: ${record.dates}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const body = String(record.text ?? record.body ?? '').trim();
  return body ? `${head}\n${body}` : head;
}

/**
 * Keep the suggestions that survive checking, and say what was dropped.
 *
 * @param {object} reply review-cv output
 * @param {object} options
 * @param {object[]} options.records every evidence record — the id whitelist
 * @param {string[]} [options.cited] ids the document already uses
 * @param {object[]} [options.keywords] extractKeywords output — the term whitelist
 * @param {string} [options.markdown] the document, for "is this term already here"
 * @returns {{verdict: string, firstImpression: string, strengths: string[],
 *   concerns: object[], keywords: object[], records: object[], dropped: object[]}}
 */
export function checkReview(reply = {}, { records = [], cited = [], keywords = [], markdown = '' } = {}) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const usedIds = new Set(cited);
  // Terms the ad genuinely used. A "keyword" the model made up is not a keyword,
  // it is a suggestion to claim something nobody asked for.
  const adTerms = new Map(keywords.map((keyword) => [normalise(keyword.term), keyword.term]));
  const inDocument = normalise(markdown);
  const dropped = [];

  const keywordsToWorkIn = [];
  for (const item of asArray(reply.keywords_to_work_in).slice(0, MAX_SUGGESTIONS * 2)) {
    const term = String(item?.term ?? '').trim();
    const supportedBy = String(item?.supported_by ?? '').trim();
    if (term === '') continue;

    if (!adTerms.has(normalise(term))) {
      dropped.push({ kind: 'keyword', term, reason: 'the advertisement never used that term' });
      continue;
    }
    if (!byId.has(supportedBy)) {
      dropped.push({
        kind: 'keyword',
        term,
        reason: supportedBy
          ? `no record called "${supportedBy}" exists, so nothing shows you did this`
          : 'no record was named, so nothing shows you did this',
      });
      continue;
    }
    // normalise() already pads both ends, so this is a whole-word check. Padding
    // it again here was the bug this comment exists to stop coming back: the
    // needle became "  python  " and matched nothing, so every term the document
    // already used was offered back as a suggestion.
    if (inDocument.includes(normalise(term))) {
      dropped.push({ kind: 'keyword', term, reason: 'the document already uses it' });
      continue;
    }
    keywordsToWorkIn.push({
      term: adTerms.get(normalise(term)),
      supportedBy,
      supportedByTitle: byId.get(supportedBy)?.title ?? null,
      where: String(item?.where ?? '').trim(),
    });
    if (keywordsToWorkIn.length >= MAX_SUGGESTIONS) break;
  }

  const recordsToAdd = [];
  for (const item of asArray(reply.records_to_add).slice(0, MAX_SUGGESTIONS * 2)) {
    const id = String(item?.record_id ?? '').trim();
    if (!byId.has(id)) {
      dropped.push({ kind: 'record', term: id || '(unnamed)', reason: 'no record with that id exists' });
      continue;
    }
    if (usedIds.has(id)) {
      dropped.push({ kind: 'record', term: id, reason: 'the document already cites it' });
      continue;
    }
    const record = byId.get(id);
    recordsToAdd.push({
      id,
      title: record?.title ?? id,
      org: record?.org ?? null,
      why: String(item?.why ?? '').trim(),
    });
    if (recordsToAdd.length >= MAX_SUGGESTIONS) break;
  }

  return {
    verdict: VERDICTS.has(reply.verdict) ? reply.verdict : 'maybe',
    firstImpression: String(reply.first_impression ?? '').trim(),
    strengths: asArray(reply.strengths).map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, MAX_SUGGESTIONS),
    concerns: asArray(reply.concerns)
      .map((item) => ({
        concern: String(item?.concern ?? '').trim(),
        fix: String(item?.fix ?? '').trim(),
      }))
      .filter((item) => item.concern !== '')
      .slice(0, MAX_SUGGESTIONS),
    keywords: keywordsToWorkIn,
    records: recordsToAdd,
    dropped,
  };
}

/**
 * Which records the document appears to draw on.
 *
 * INFERRED FROM THE TEXT, and deliberately so. A saved version stores the
 * markdown and which records were OFFERED, not which the model ended up citing —
 * the citations live in the artifact JSON, which is not kept, and the ids are
 * stripped out of the document because a reader should never see them.
 *
 * So this does what a person would: looks for the record's title and its
 * organisation in the document. It is approximate in one direction only. A record
 * it misses gets suggested and the applicant sees a suggestion for something
 * already there — mildly annoying. A record it wrongly matches would be silently
 * left out of the suggestions, so the matching is deliberately strict: the title
 * has to appear whole.
 *
 * @param {string} markdown
 * @param {object[]} records
 * @returns {string[]} ids
 */
export function recordsUsedIn(markdown = '', records = []) {
  const haystack = normalise(markdown);
  return records
    .filter((record) => {
      const title = normalise(record?.title ?? '').trim();
      const org = normalise(record?.org ?? '').trim();
      if (title !== '' && haystack.includes(` ${title} `)) return true;
      // An org alone is weaker evidence — two roles at one employer share it — so
      // it counts only when the record has no title to look for.
      return title === '' && org !== '' && haystack.includes(` ${org} `);
    })
    .map((record) => record.id);
}

const asArray = (value) => (Array.isArray(value) ? value : []);

/** Words only, lowercased, single-spaced and padded — so matching is whole-word. */
function normalise(text) {
  return ` ${String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()} `;
}

export default checkReview;
