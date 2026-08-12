// WHY: the master profile is the step everything else waits on, and writing one
// from nothing is forty minutes of typing things you have already written down
// once. Almost everybody has a CV or a LinkedIn export. So: read that, turn it
// into records, and show them for approval.
//
// The approval is not politeness. This is the one place in the app where a model
// writes something that then becomes evidence — and every later check trusts the
// profile completely, because the profile is what the checks are checked
// against. A record invented here would be invisible forever after. So nothing
// reaches disk until a person has looked at it, and every record carries the
// fragment of the document it came from, so looking at it takes a glance rather
// than a re-read.
import { RECORD_KINDS } from '../profile/edit.js';

const MAX_INPUT_CHARS = 60_000;

/**
 * What the model is told. The whole prompt is about not inventing, because that
 * is the only way this feature can do harm — a CV that reads well and contains a
 * job you did not have is worse than no CV at all.
 */
export function importSystemPrompt({ evidenceTags = [] } = {}) {
  return [
    'You are reading somebody\'s CV, résumé or LinkedIn profile export, and turning it into',
    'structured records for a system that will later use them as the ONLY permitted source of',
    'facts about this person.',
    '',
    'That last part is the whole job. Everything downstream — every CV this system writes, every',
    'honesty check it runs — trusts these records absolutely. A detail you add here that the',
    'document did not contain becomes invisible: it will be treated as something the person told',
    'the system about themselves, and it will end up on a real application.',
    '',
    'So:',
    '',
    '- **Use only what the document says.** Not what a role like that usually involves, not what',
    '  the tools imply, not a rounder number than the one written down.',
    '- **Keep every figure exactly as written.** "reduced processing time from 6 hours to 20',
    '  minutes" stays word for word. Do not convert, round, annualise, or turn "several" into a',
    '  number.',
    '- **Where the document is thin, leave it thin** and say what is missing in `missing`. A',
    '  two-line record with a gap noted is useful; a five-line record with three invented',
    '  sentences is a liability.',
    '- **Never guess dates.** "2021 – Present" means start 2021 and end empty. A date you cannot',
    '  find is an empty string, not an estimate.',
    '- **Quote your source.** `quote` is a short verbatim fragment from the document, so a human',
    '  can check the record against the original at a glance. If you cannot quote it, you have',
    '  invented it — leave the record out.',
    '',
    '## Which section each thing belongs in',
    '',
    `The kinds are: ${RECORD_KINDS.join(', ')}.`,
    '',
    '- **role** — a job, contract, assistantship, internship. One per position, even at the same',
    '  employer: a promotion is two records, because they are different work.',
    '- **education** — a degree or qualification.',
    '- **project** — something built or run that was not a job.',
    '- **publication** — a paper, preprint or manuscript. Put the citation in `body` as the',
    '  document writes it; the system renders citations itself and needs the raw text.',
    '- **skill** — a GROUP of skills, not one per skill. "Statistics and modelling",',
    '  "Programming and data". A CV\'s skills line usually becomes two or three of these.',
    '- **award** — a prize, scholarship or competitive grant.',
    '- **service** — reviewing, committees, mentoring, volunteering, outreach.',
    '- **finding** — a single result worth stating on its own. Rare in a CV; only use it when the',
    '  document states a specific finding rather than a responsibility.',
    '',
    '## Tags',
    '',
    'Lower-case keywords taken from the words in that entry — tools, methods, domains. They are',
    'used later to match a record against a job advertisement, so they should be the words a job',
    'ad would use.',
    ...(evidenceTags.length > 0
      ? ['', `For reference, this person's own categories are: ${evidenceTags.join(', ')}.`]
      : []),
    '',
    '## What not to produce',
    '',
    'Do not write a summary, an objective, a personal statement or a covering paragraph. Those are',
    'documents this system writes later, from these records. Do not include contact details,',
    'referees, or interests — those live elsewhere.',
  ].join('\n');
}

/** The document itself, trimmed to something a model can hold. */
export function importUserMessage(documentText) {
  const text = String(documentText ?? '').trim();
  const clipped = text.length > MAX_INPUT_CHARS;
  return [
    'The document:',
    '',
    clipped ? `${text.slice(0, MAX_INPUT_CHARS)}\n\n[…truncated…]` : text,
  ].join('\n');
}

/**
 * Turn what the model returned into records the profile editor can show, with
 * ids that do not collide with anything already there.
 *
 * @param {object} reply the import-profile response
 * @param {object} options
 * @param {string[]} options.existingIds ids already in the profile
 * @param {string[]} options.evidenceTags this person's categories
 * @returns {{records: object[], notes: string[]}}
 */
export function normaliseImport(reply, { existingIds = [], evidenceTags = [] } = {}) {
  const taken = new Set(existingIds);
  const records = [];

  for (const raw of Array.isArray(reply?.records) ? reply.records : []) {
    const kind = RECORD_KINDS.includes(raw?.kind) ? raw.kind : null;
    const title = String(raw?.title ?? '').trim();
    if (!kind || title === '') continue;

    const id = uniqueId(kind, title, String(raw?.org ?? ''), taken);
    taken.add(id);

    records.push({
      id,
      kind,
      title,
      org: String(raw?.org ?? '').trim(),
      dates: { start: cleanDate(raw?.start), end: cleanDate(raw?.end) },
      // Untagged on purpose: which kinds of job a record is evidence for is a
      // judgement about where you are going, and a model reading a CV only knows
      // where you have been. Everything imported starts in every category, which
      // is the setting that loses nothing, and the editor is where it is narrowed.
      evidenceProfiles: [...evidenceTags],
      tags: (Array.isArray(raw?.tags) ? raw.tags : [])
        .map((tag) => String(tag).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8),
      location: String(raw?.location ?? '').trim(),
      body: String(raw?.body ?? '').trim(),
      // Not part of the record — shown beside it while deciding, then dropped.
      quote: String(raw?.quote ?? '').trim(),
      missing: (Array.isArray(raw?.missing) ? raw.missing : []).map(String).filter(Boolean),
    });
  }

  return {
    records,
    notes: (Array.isArray(reply?.notes) ? reply.notes : []).map(String).filter(Boolean),
  };
}

/** `role-data-analyst-state-water`, and never one that is already in use. */
function uniqueId(kind, title, org, taken) {
  const slug = (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const base = [kind, slug(title), slug(org)].filter(Boolean).join('-').slice(0, 52).replace(/-$/, '');
  const stem = base || kind;
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 200; n += 1) {
    if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
  }
  return `${stem}-${Date.now()}`;
}

/** YYYY or YYYY-MM, or an empty string. Anything else is not a date we can use. */
function cleanDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}(-\d{2})?$/.test(text)) return text;
  // "March 2027", "03/2027" and "2027-3" all turn up; they are all salvageable.
  const named = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3).toLowerCase());
    if (month !== -1) return `${named[2]}-${String(month + 1).padStart(2, '0')}`;
  }
  const numeric = /^(\d{1,2})[/-](\d{4})$/.exec(text);
  if (numeric) return `${numeric[2]}-${String(Number(numeric[1])).padStart(2, '0')}`;
  const loose = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (loose) return `${loose[1]}-${String(Number(loose[2])).padStart(2, '0')}`;
  return '';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
