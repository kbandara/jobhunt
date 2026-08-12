// WHY: a publication is the one thing on a CV that a reader can check in ten
// seconds, and the one thing a language model is most likely to get subtly
// wrong — a year off by one, a volume invented, "under review" quietly becoming
// a journal name. The fix is the same one D006 applied to the PhD status: stop
// asking the model for it. Publications are parsed into fields here and
// rendered as APA in code, so the citation on the page is a function of
// master-profile.md and nothing else.
//
// The parser is tuned to the shape a normal APA reference list uses rather than
// being a
// general APA parser, which would be a research project. Anything it cannot
// read is reported in `problems` and shown in the app, because a citation that
// silently comes out half-right is worse than one that says it needs a look.

import { nameParts } from './identity.js';

/** Publication statuses, in the order they should appear on a CV. */
export const STATUSES = ['published', 'in-principle', 'under-review', 'in-preparation'];

const STATUS_LABELS = {
  published: 'Published',
  'in-principle': 'Accepted in principle',
  'under-review': 'Under review',
  'in-preparation': 'In preparation',
};

/** How a status is written in the heading after the em dash, or in the body. */
const STATUS_PATTERNS = [
  { status: 'in-preparation', re: /\bin\s+preparation\b/i },
  { status: 'under-review', re: /\bunder\s+review\b|\bsubmitted\b/i },
  { status: 'in-principle', re: /\bin[-\s]principle\s+acceptance\b|\bstage\s*1\b/i },
];

/**
 * Your surname, from profile-meta.json. Used for exactly two things: deciding
 * whether you are first author, and warning that a record has your name nowhere
 * in it (usually a copy-paste of somebody else's paper). Both degrade to silence
 * when there is no name yet, which is right for a profile nobody has filled in.
 *
 * The reading itself lives in profile/identity.js, so there is one place that
 * knows how to get a family name out of a name and not two that disagree.
 */
export function surnameFrom(profileMeta) {
  return nameParts(profileMeta).surname || null;
}

/**
 * Parse one publication record into citation fields.
 *
 * @param {object} record a `kind: 'publication'` record from profile/parse.js
 * @param {object} [options]
 * @param {string|null} [options.surname] the author name to treat as yours
 * @returns {object} { id, status, authors, year, title, venue, volume, issue,
 *   pages, doi, note, firstAuthor, problems }
 */
export function parseCitation(input, { surname = null } = {}) {
  // `= {}` only covers undefined, and a null record reaches here whenever a
  // caller maps over something it did not check.
  const record = input && typeof input === 'object' ? input : {};
  const problems = [];
  const body = String(record.body ?? '').replace(/\s*\n\s*/g, ' ').trim();

  // The heading already splits title from venue-or-status: profile/parse.js put
  // the part before the em dash in `title` and the part after it in `org`.
  const title = String(record.title ?? '').trim();
  const headingTail = String(record.org ?? '').trim();
  if (!title) problems.push('no title — the record heading is empty');

  // "Under review" after the em dash is a status, not a journal name. So the
  // heading tail is a venue only when no status word is hiding in it.
  const headingStatus = statusInText(headingTail);
  const status = headingStatus ?? statusInText(body) ?? 'published';
  const venue = headingStatus === null ? headingTail : venueFromBody(body);

  const { authors, rest } = splitAuthors(body, problems, surname);
  const year = yearFrom(record, rest);
  if (year === null) problems.push('no year — add one to the record\'s `dates:` line');

  const { volume, issue, pages, note } = tailFrom(rest, venue);
  const doi = doiFrom(body);

  return {
    id: record.id ?? null,
    status,
    authors,
    year,
    title,
    venue: venue || null,
    volume,
    issue,
    pages,
    doi,
    note,
    firstAuthor: Boolean(surname) && authors.length > 0 && authors[0].includes(surname),
    problems,
  };
}

/**
 * Render a parsed citation as APA 7, with markdown emphasis.
 *
 * Journal name and volume are italicised, which is what `*...*` means in the
 * markdown draft and what `\textit{}` means once it reaches LaTeX — so the same
 * string is correct in the editor, the print view and the PDF.
 *
 * Unpublished work gets an APA bracket note rather than a journal, because
 * "under review at Nature" and "published in Nature" must never be able to look
 * alike on the page. That rule is in prompts/integrity.md; here it is arithmetic.
 */
export function apa(citation = {}) {
  const authors = formatAuthors(citation.authors ?? []);
  const year = citation.year ?? 'n.d.';
  const title = stripTrailingStop(citation.title ?? '');

  const opening = `${authors} (${year}).`;

  // APA 7 puts the bracket description INSIDE the title's sentence — "Title
  // [Manuscript submitted for publication]." — not after it as a second
  // sentence. Getting this wrong is the sort of thing an academic reader
  // notices immediately.
  const BRACKETS = {
    'in-preparation': 'Manuscript in preparation',
    'under-review': 'Manuscript submitted for publication',
    'in-principle': 'Registered report, Stage 1 in-principle acceptance',
  };
  const bracket = BRACKETS[citation.status];
  if (bracket) {
    const where = citation.venue ? ` ${italic(citation.venue)}.` : '';
    return `${opening} ${title} [${bracket}].${where}`.replace(/\s+/g, ' ').trim();
  }

  // Published: Journal, Volume(Issue), pages. https://doi.org/...
  const head = `${opening} ${title}.`;
  const parts = [];
  if (citation.venue) {
    let where = italic(citation.venue);
    if (citation.volume) {
      where += `, ${italic(citation.volume)}`;
      if (citation.issue) where += `(${citation.issue})`;
    }
    if (citation.pages) where += `, ${citation.pages}`;
    parts.push(`${where}.`);
  }
  if (citation.doi) parts.push(citation.doi);

  return `${head} ${parts.join(' ')}`.replace(/\s+/g, ' ').trim();
}

/** Every publication in the evidence, parsed, newest first within status order. */
export function citations(evidence = [], options) {
  return evidence
    .filter((record) => record?.kind === 'publication')
    .map((record) => parseCitation(record, options))
    .sort(compareCitations);
}

/**
 * CV order: unpublished work first only if it is more recent is a matter of
 * taste, so this uses the plain convention — status groups in STATUSES order,
 * newest first inside each, id as the final tie-break so the order never
 * depends on how the file happened to be read.
 */
export function compareCitations(a, b) {
  const byStatus = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
  if (byStatus !== 0) return byStatus;
  const byYear = (b.year ?? 0) - (a.year ?? 0);
  if (byYear !== 0) return byYear;
  return String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

// --- parsing helpers --------------------------------------------------------

/** The status named in a piece of text, or null when it names none. */
function statusInText(text) {
  const value = String(text ?? '');
  for (const { status, re } of STATUS_PATTERNS) {
    if (re.test(value)) return status;
  }
  return null;
}

/**
 * Authors are everything before the year parenthetical — "(2025)",
 * "(under review)", "(in preparation)". That parenthetical is the one reliable
 * landmark in an APA string, which is why it, and not a comma count, is the
 * thing being matched.
 */
function splitAuthors(body, problems, surname) {
  const match = /\(([^)]*)\)\s*\.?/.exec(body);
  if (!match) {
    problems.push('could not find the "(year)" part, so the authors could not be separated from the rest');
    return { authors: [], rest: body };
  }

  const authorText = body.slice(0, match.index).trim().replace(/[,;]\s*$/, '');
  const rest = body.slice(match.index + match[0].length).trim();
  const authors = splitAuthorList(authorText);
  if (authors.length === 0) problems.push('no authors found before the year');
  if (surname && !authors.some((name) => name.includes(surname))) {
    problems.push(`"${surname}" does not appear in the author list — is this the right record?`);
  }
  return { authors, rest };
}

/**
 * "Kimani, R., Brooks, A., & Nguyen, T." into three names.
 *
 * Split on the comma that comes before a new surname rather than on every
 * comma, because "Kimani, R." contains one itself. A name starts after a
 * comma (or an ampersand) when what follows is a capitalised word that is not
 * an initial.
 */
function splitAuthorList(text) {
  // Normalise the ampersand to ", & " so one split rule handles the last name —
  // and swallow any comma already in front of it, or the list gains an empty
  // element and the rendered citation comes out with a double comma.
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').replace(/,?\s*&\s*/g, ', & ').trim();
  if (cleaned === '') return [];

  const names = [];
  let current = '';
  for (const piece of cleaned.split(', ')) {
    const part = piece.replace(/^&\s*/, '').trim();
    if (part === '') continue;
    // An initial ("K.", "K. H.", "B. T.") belongs to the name being built.
    if (/^(?:[A-Z]\.\s*)+$/.test(part) || /^(?:Jr\.|Sr\.|I{1,3}|IV)$/.test(part)) {
      current = current ? `${current}, ${part}` : part;
      continue;
    }
    if (current) names.push(current);
    current = part;
  }
  if (current) names.push(current);
  return names;
}

/** APA 7: up to 20 authors listed, "&" before the last. */
function formatAuthors(authors) {
  const names = authors.filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
}

/**
 * The year. Preferred from the record's own `dates:` line, because that is a
 * structured field the parser has already validated, rather than a number
 * scraped out of prose where a volume like "2025(1)" looks identical.
 */
function yearFrom(record, rest) {
  const start = String(record?.dates?.start ?? '');
  const fromDates = /^(\d{4})/.exec(start);
  if (fromDates) return Number(fromDates[1]);
  const fromText = /\b(19|20)\d{2}\b/.exec(rest ?? '');
  return fromText ? Number(fromText[0]) : null;
}

/**
 * For an unpublished record the heading carries the status, so the venue — if
 * there is one — has to come from the body: "Stage 1 in-principle acceptance at
 * Psychological Bulletin."
 */
function venueFromBody(body) {
  const at = /\bat\s+([A-Z][^.]*)/.exec(body);
  return at ? at[1].trim() : '';
}

/**
 * "Neuroscience of Consciousness, 2025(1)." or "Psychological Bulletin, 148(5-6), 370."
 * The venue is already known from the heading, so this only has to read the
 * numbers that follow it.
 */
/**
 * "Neuroscience of Consciousness, 2025(1). First author." into the numbers and
 * whatever prose follows them.
 *
 * The numbers and the note are read in one pass rather than by two independent
 * regexes, because they have to agree about where one ends and the other
 * begins — parsing them separately left "-10." sitting in the note after the
 * page range had already been consumed as pages.
 */
function tailFrom(rest, venue) {
  const text = String(rest ?? '');
  const after = venue && text.includes(venue) ? text.slice(text.indexOf(venue) + venue.length) : text;

  const match = /^[.,\s]*(\d+(?:\s*[–-]\s*\d+)?)\s*(?:\((\d[\d–-]*)\))?\s*(?:,\s*(\d+(?:\s*[–-]\s*\d+)?))?\s*\.?/.exec(after);
  const numbers = venue && match ? readNumbers(match) : { volume: null, issue: null, pages: null };
  const remainder = venue && match ? after.slice(match[0].length) : after;

  return { ...numbers, note: cleanNote(remainder) };
}

function readNumbers(match) {
  // A volume is never a range, so "Brain Topography, 1-10." is pages with the
  // volume not recorded — the advance-online-publication shape. Reading it as
  // volume 1 would print a number that is not true of the paper.
  if (/[–-]/.test(match[1]) && !match[3]) {
    return { volume: null, issue: null, pages: enDash(match[1]) };
  }
  return {
    volume: match[1] ?? null,
    issue: match[2] ? enDash(match[2]) : null,
    pages: match[3] ? enDash(match[3]) : null,
  };
}

/**
 * Whatever prose you added after the citation itself — "First author.",
 * "Directly relevant to evaluation work: …". Kept out of the APA string but
 * shown beside it in the picker, because it is often the reason to choose one
 * paper over another.
 */
function cleanNote(text) {
  const note = String(text ?? '')
    .replace(/(?:https?:\/\/)?(?:dx\.)?doi\.org\/\S+/g, '')
    .replace(/^[.,\s]+/, '')
    .trim();
  return note || null;
}

const enDash = (text) => String(text).replace(/\s*[–-]\s*/g, '–');

function doiFrom(body) {
  const match = /(?:https?:\/\/)?(?:dx\.)?doi\.org\/(\S+?)(?:[.,)\]]\s|[.,)\]]?$|\s)/.exec(`${body} `);
  return match ? `https://doi.org/${match[1].replace(/[.,)\]]+$/, '')}` : null;
}


const italic = (text) => `*${String(text).trim()}*`;
const stripTrailingStop = (text) => String(text).trim().replace(/\.\s*$/, '');
