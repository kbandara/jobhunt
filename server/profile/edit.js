// WHY: the profile can now be edited in the app, and the naive way to do that —
// parse every record, then write them all back out — would quietly destroy the
// file. master-profile.md is hand-maintained: it carries a preamble, comments,
// blank lines in particular places, and whatever formatting its owner likes.
// Re-serialising it would return a technically-equivalent file that had lost all
// of that, on every edit, forever.
//
// So edits are surgical. A record occupies a known span of lines; adding,
// changing or deleting one rewrites only that span, and every byte outside it
// survives untouched. That is also what makes editing in the app and editing in
// a text editor the same operation on the same file rather than two systems
// fighting over it.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../store.js';

/** Section heading -> record kind. The inverse of the parser's map. */
export const SECTION_FOR_KIND = {
  education: 'Education',
  project: 'Projects',
  finding: 'Findings',
  role: 'Roles',
  publication: 'Publications',
  skill: 'Skills',
  award: 'Awards',
  service: 'Service',
};

/** The order sections appear in when one has to be created. */
const SECTION_ORDER = ['Education', 'Projects', 'Findings', 'Roles', 'Publications', 'Skills', 'Awards', 'Service'];

export const RECORD_KINDS = Object.keys(SECTION_FOR_KIND);

export function readProfileText(file) {
  try {
    return readText(file);
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

export function writeProfileText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const ending = text.endsWith('\n') ? text : `${text}\n`;
  fs.writeFileSync(tmp, ending, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Where every record and every section heading sits, by line index (0-based,
 * `end` exclusive). Scanned directly rather than taken from the parser, because
 * this has to work on a file the parser is currently rejecting — an edit made to
 * FIX a broken record is exactly when you need it most.
 *
 * @param {string} text
 * @returns {{records: Array<object>, sections: Array<object>}}
 */
export function scan(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const records = [];
  const sections = [];

  for (let i = 0; i < lines.length; i += 1) {
    const record = /^###\s+(.*)$/.exec(lines[i]);
    if (record) {
      records.push({ heading: record[1].trim(), start: i, end: lines.length, id: null });
      continue;
    }
    const section = /^##\s+(.*)$/.exec(lines[i]);
    if (section) {
      if (records.length > 0 && records.at(-1).end === lines.length) records.at(-1).end = i;
      sections.push({ name: section[1].trim(), start: i, end: lines.length });
      if (sections.length > 1) sections.at(-2).end = i;
    }
  }

  // A record runs to the next heading of any level.
  for (let n = 0; n < records.length; n += 1) {
    const nextRecord = records[n + 1]?.start ?? lines.length;
    const nextSection = sections.find((section) => section.start > records[n].start)?.start ?? lines.length;
    records[n].end = Math.min(nextRecord, nextSection);
    const idLine = lines.slice(records[n].start + 1, records[n].end).find((line) => /^id\s*:/i.test(line));
    records[n].id = idLine ? idLine.split(':').slice(1).join(':').trim() : null;
  }

  return { records, sections, lines };
}

/**
 * One record as the markdown it is stored as. The inverse of parse.js, and the
 * ONLY place a record becomes text — so the format lives in two files rather
 * than in every caller that fancied building a heading itself.
 */
export function recordToMarkdown(record = {}) {
  const title = String(record.title ?? '').trim();
  const org = String(record.org ?? '').trim();
  const heading = org ? `${title} — ${org}` : title;

  const dates = datesToText(record.dates);
  const list = (value) => (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .join(', ');

  // `key:` with nothing after it, rather than `key: ` with a trailing space: the
  // parser accepts both, and a file full of invisible trailing whitespace is the
  // kind of thing that shows up as a diff full of nothing.
  const line = (key, value) => (value ? `${key}: ${value}` : `${key}:`);
  const meta = [
    line('id', String(record.id ?? '').trim()),
    line('dates', dates),
    line('profiles', list(record.evidenceProfiles)),
    line('tags', list(record.tags)),
    ...(String(record.location ?? '').trim() ? [`location: ${String(record.location).trim()}`] : []),
  ];

  const body = String(record.body ?? '').replace(/\r\n/g, '\n').trim();
  return [`### ${heading}`, ...meta, '', body, ''].join('\n');
}

function datesToText(dates) {
  if (typeof dates === 'string') return dates.trim();
  const start = String(dates?.start ?? '').trim();
  const end = String(dates?.end ?? '').trim();
  if (!start && !end) return '';
  return end ? `${start} .. ${end}` : `${start} ..`;
}

/**
 * Add a record, or replace one that already exists.
 *
 * @param {string} text the whole file
 * @param {object} record
 * @param {object} [options]
 * @param {string} [options.originalId] the id being replaced, when it is being renamed
 * @returns {string} the new file
 */
export function upsertRecord(text, record, { originalId = null } = {}) {
  const kind = String(record?.kind ?? '').trim();
  const sectionName = SECTION_FOR_KIND[kind];
  if (!sectionName) {
    throw new Error(`"${kind}" is not a kind of record. Use one of: ${RECORD_KINDS.join(', ')}.`);
  }
  const id = String(record?.id ?? '').trim();
  if (!id) throw new Error('A record needs an id — it is what generated documents cite.');

  const { records, sections, lines } = scan(text);
  const target = originalId ?? id;
  const existing = records.find((entry) => entry.id === target);
  const block = recordToMarkdown(record).split('\n');

  if (existing) {
    // Changing a record's kind moves it to another section, which a span
    // replacement cannot express — so that is a delete plus an insert.
    const owningSection = [...sections].reverse().find((section) => section.start < existing.start);
    if (owningSection?.name?.toLowerCase() === sectionName.toLowerCase()) {
      return [...lines.slice(0, existing.start), ...block, ...lines.slice(existing.end)].join('\n');
    }
    return insertRecord(removeRecord(text, target), block, sectionName);
  }

  if (records.some((entry) => entry.id === id)) {
    throw new Error(`There is already a record with the id "${id}". Ids have to be unique.`);
  }
  return insertRecord(text, block, sectionName);
}

/** Put a rendered record at the end of its section, creating the section if needed. */
function insertRecord(text, block, sectionName) {
  const { sections, lines } = scan(text);
  const section = sections.find((entry) => entry.name.toLowerCase() === sectionName.toLowerCase());

  if (section) {
    let at = section.end;
    while (at > section.start + 1 && String(lines[at - 1] ?? '').trim() === '') at -= 1;
    return [...lines.slice(0, at), '', ...block, ...lines.slice(at)].join('\n');
  }

  // No such section yet. Put it in catalogue order rather than at the end, so a
  // file built up record by record still reads in the order the format documents.
  const wantedAt = SECTION_ORDER.indexOf(sectionName);
  const laterSection = sections.find((entry) => {
    const index = SECTION_ORDER.findIndex((name) => name.toLowerCase() === entry.name.toLowerCase());
    return index !== -1 && index > wantedAt;
  });
  const at = laterSection ? laterSection.start : lines.length;
  const trimmed = laterSection ? lines.slice(0, at) : trimTrailingBlanks(lines);
  return [...trimmed, '', `## ${sectionName}`, '', ...block, ...(laterSection ? lines.slice(at) : [])].join('\n');
}

function trimTrailingBlanks(lines) {
  const out = [...lines];
  while (out.length > 0 && String(out.at(-1) ?? '').trim() === '') out.pop();
  return out;
}

/**
 * Delete one record by id. Returns the file unchanged when nothing has that id,
 * because a delete that silently succeeds on a typo is worse than a no-op.
 */
export function removeRecord(text, id) {
  const { records, lines } = scan(text);
  const target = records.find((entry) => entry.id === String(id ?? '').trim());
  if (!target) return text;
  const before = lines.slice(0, target.start);
  while (before.length > 0 && String(before.at(-1) ?? '').trim() === '') before.pop();
  const after = lines.slice(target.end);
  return [...before, '', ...after].join('\n');
}

/** Does a record with this id exist? */
export function hasRecord(text, id) {
  return scan(text).records.some((entry) => entry.id === String(id ?? '').trim());
}
