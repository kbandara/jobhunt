// WHY: master-profile.md is the only source of truth about the person using this
// app, so a silently half-parsed profile would produce silently degraded CVs —
// the worst failure this app has. Parse failures are therefore fatal and every
// error names the line number and what was expected.
// A hand-rolled line scanner, not a markdown AST walk, precisely so it can.
import { readText } from '../store.js';
import { extractNumbers } from './numbers.js';

const KIND_BY_SECTION = {
  education: 'education',
  projects: 'project',
  findings: 'finding',
  roles: 'role',
  publications: 'publication',
  skills: 'skill',
  awards: 'award',
  service: 'service',
};

const SECTION_NAMES = 'Education, Projects, Findings, Roles, Publications, Skills, Awards, Service';

/**
 * The evidence tags a record may carry: your own vocabulary for what a record is
 * evidence *for*. A CV profile's `evidenceProfiles` names a subset, and that is
 * how a profile reaches records at all — so this is the shared vocabulary
 * between master-profile.md and the CV profile files.
 *
 * It is NOT a fixed list. Whoever is using the app declares theirs in
 * profile-meta.json (`evidenceTags`), because a list hardcoded here would mean a
 * biologist had to tag their fieldwork as "ai-eval". These are only the values a
 * fresh profile starts with. Pass `allowedTags: null` and any tag parses, which
 * is what an unconfigured profile gets — better a tag the app has not been told
 * about than a parse error on somebody's first edit.
 *
 * NOTE ON THE SPELLING: a record may write this line as either `profiles:` or
 * the older `lanes:`, and both parse to the same thing. Both are accepted on
 * purpose — master-profile.md is hand-maintained and yours rather than the
 * app's, so a rename in this repo must never reach in and rewrite your records.
 * Write `profiles:` in anything new; `lanes:` keeps working forever.
 */
export const DEFAULT_EVIDENCE_TAGS = ['research', 'industry', 'teaching', 'public-sector'];

/** @deprecated the old fixed list, kept so an older import still resolves. */
export const EVIDENCE_PROFILES = DEFAULT_EVIDENCE_TAGS;

/** How the evidence-tag line may be spelled. First is preferred; both parse. */
export const EVIDENCE_META_KEYS = ['profiles', 'lanes'];

const REQUIRED_META = ['id', 'dates', 'tags'];
const KNOWN_META = [...REQUIRED_META, ...EVIDENCE_META_KEYS, 'location'];

const DATE_PART = /^\d{4}(?:-\d{2})?$/;
const YEAR_RE = /^\d{4}$/;

/**
 * @param {string} markdownText
 * @param {object} [options]
 * @param {string[]|null} [options.allowedTags] the evidence tags this person has
 *   declared. `null` (the default) accepts any tag: a new profile has not
 *   declared a vocabulary yet, and refusing to parse their first record because
 *   they invented a sensible word for it would be the wrong way round.
 * @returns {{records: Array<object>, errors: Array<{line: number, message: string}>}}
 */
export function parseProfile(markdownText, { allowedTags = null } = {}) {
  const lines = String(markdownText ?? '').split(/\r?\n/);
  const records = [];
  const errors = [];
  const idLines = new Map(); // id -> line number of its first definition

  const fail = (line, message) => errors.push({ line, message: `line ${line}: ${message}` });

  let kind = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const recordHeading = /^###\s+(.*)$/.exec(line);
    if (recordHeading) {
      i = parseRecord(recordHeading[1].trim(), i);
      continue;
    }

    const sectionHeading = /^##\s+(.*)$/.exec(line);
    if (sectionHeading) {
      const name = sectionHeading[1].trim();
      const mapped = KIND_BY_SECTION[name.toLowerCase()];
      if (!mapped) {
        fail(i + 1, `unknown section heading "## ${name}" — expected one of: ${SECTION_NAMES}`);
        kind = null;
      } else {
        kind = mapped;
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return { records, errors };

  /** Parse one `###` record starting at line index `start`. Returns the next index. */
  function parseRecord(headingText, start) {
    const headingLine = start + 1;
    if (!kind) {
      fail(
        headingLine,
        `record "${headingText}" appears before any "## <Kind>" section heading — ` +
          `add one of: ${SECTION_NAMES}`,
      );
    }

    const { title, org } = splitHeading(headingText);
    const meta = new Map(); // key -> {value, line}
    let i = start + 1;

    // Metadata block: the consecutive non-blank lines directly under the heading.
    while (i < lines.length && lines[i].trim() !== '' && !/^#{2,3}\s/.test(lines[i])) {
      const lineNo = i + 1;
      const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(lines[i]);
      if (!match) {
        fail(
          lineNo,
          `expected a metadata line ("key: value") or a blank line before the body, ` +
            `but found: ${lines[i].trim()}`,
        );
        i += 1;
        continue;
      }
      const key = match[1].toLowerCase();
      if (!KNOWN_META.includes(key)) {
        fail(
          lineNo,
          `unknown metadata key "${match[1]}:" — expected one of: ${KNOWN_META.join(', ')}`,
        );
      } else if (meta.has(key)) {
        fail(lineNo, `duplicate metadata key "${key}:" (already set on line ${meta.get(key).line})`);
      } else {
        meta.set(key, { value: match[2].trim(), line: lineNo });
      }
      i += 1;
    }

    // Body: everything up to the next heading of any level.
    const bodyStart = i;
    while (i < lines.length && !/^#{2,3}\s/.test(lines[i])) i += 1;
    const body = lines.slice(bodyStart, i).join('\n').trim();

    for (const key of REQUIRED_META) {
      if (!meta.has(key)) {
        fail(
          headingLine,
          `record "${headingText}" is missing its required "${key}:" metadata line — ` +
            `add it directly below this heading`,
        );
      }
    }

    // Either spelling satisfies the requirement, but writing both would leave it
    // ambiguous which one won, so that is an error rather than a silent choice.
    const evidenceKeys = EVIDENCE_META_KEYS.filter((key) => meta.has(key));
    if (evidenceKeys.length === 0) {
      fail(
        headingLine,
        `record "${headingText}" is missing its required "profiles:" metadata line — ` +
          `add it directly below this heading (the older spelling "lanes:" also works)`,
      );
    } else if (evidenceKeys.length > 1) {
      fail(
        meta.get(evidenceKeys[1]).line,
        `record "${headingText}" has both "profiles:" and "lanes:" — they mean the same ` +
          `thing, so keep one. "profiles:" is the current spelling.`,
      );
    }

    const id = meta.get('id')?.value ?? null;
    if (meta.has('id') && !id) {
      fail(meta.get('id').line, `"id:" is missing a value — every record needs a unique id`);
    }
    if (id) {
      const seen = idLines.get(id);
      if (seen !== undefined) {
        fail(
          meta.get('id').line,
          `duplicate id "${id}" on line ${meta.get('id').line} — already used on line ${seen}; ` +
            `ids are cited by generated documents and must be unique`,
        );
      } else {
        idLines.set(id, meta.get('id').line);
      }
    }

    const dates = meta.has('dates') ? parseDates(meta.get('dates')) : { start: null, end: null };
    const evidenceProfiles = evidenceKeys[0]
      ? parseEvidenceProfiles(meta.get(evidenceKeys[0]), evidenceKeys[0])
      : [];
    const tags = meta.has('tags') ? splitList(meta.get('tags').value) : [];

    const numbers = [
      ...extractNumbers(body),
      ...extractNumbers(meta.get('dates')?.value ?? '').filter((n) => YEAR_RE.test(n.raw)),
    ];

    records.push({
      id,
      kind,
      title,
      org,
      dates,
      evidenceProfiles,
      tags,
      location: meta.get('location')?.value ?? null,
      body,
      numbers,
      isGap: headingText.includes('FILL:') || body.includes('FILL:'),
      figuresReleasable: !/not releasable/i.test(body),
      sourceLine: headingLine,
    });

    return i;
  }

  function parseDates({ value, line }) {
    const parts = value.split('..').map((p) => p.trim());

    // A single date is a point in time, not a malformed range. Publications,
    // awards and findings genuinely happen on one date, and making somebody
    // write "2025 .. 2025" to say so taught them the format was fussier than it
    // needed to be — which is the sort of thing that stops a profile getting
    // written at all.
    if (parts.length === 1) {
      const only = parts[0];
      if (!only) {
        fail(line, `"dates:" is empty — give a year, a month, or a range like "2023-01 .. 2024-06"`);
        return { start: null, end: null };
      }
      if (!DATE_PART.test(only)) {
        fail(line, `"dates: ${value}" — "${only}" is not a YYYY-MM (or YYYY) date`);
        return { start: null, end: null };
      }
      return { start: only, end: only };
    }

    if (parts.length !== 2 || !parts[0]) {
      fail(
        line,
        `"dates: ${value}" is not a date range — expected "YYYY-MM .. YYYY-MM", ` +
          `or "YYYY-MM .." for something still current`,
      );
      return { start: null, end: null };
    }
    for (const part of parts) {
      if (part && !DATE_PART.test(part)) {
        fail(line, `"dates: ${value}" — "${part}" is not a YYYY-MM (or YYYY) date`);
        return { start: null, end: null };
      }
    }
    return { start: parts[0], end: parts[1] || null }; // empty end = current
  }

  function parseEvidenceProfiles({ value, line }, key) {
    const tags = splitList(value);
    const known = Array.isArray(allowedTags) && allowedTags.length > 0 ? allowedTags : null;
    if (tags.length === 0) {
      fail(
        line,
        `"${key}:" is empty — name at least one kind of job this is evidence for` +
          (known ? `, from: ${known.join(', ')}` : ''),
      );
    }
    if (!known) return tags;
    for (const bad of tags.filter((tag) => !known.includes(tag))) {
      fail(
        line,
        `unknown evidence tag "${bad}" — yours are: ${known.join(', ')}. ` +
          `Add it under Settings if it is a tag you want.`,
      );
    }
    return tags.filter((tag) => known.includes(tag));
  }
}

/** Every evidence tag actually used by a set of records, alphabetically. */
export function tagsInUse(records = []) {
  const seen = new Set();
  for (const record of records) for (const tag of record?.evidenceProfiles ?? []) seen.add(tag);
  return [...seen].sort((a, b) => a.localeCompare(b, 'en'));
}

function splitHeading(headingText) {
  const index = headingText.indexOf('—');
  if (index === -1) return { title: headingText, org: null };
  return {
    title: headingText.slice(0, index).trim(),
    org: headingText.slice(index + 1).trim() || null,
  };
}

function splitList(value) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

/**
 * Read and parse the master profile. Throws ONE readable error listing every
 * problem, because fixing a hand-edited file one error per run is miserable.
 * @param {string} filePath
 * @param {object} [options] passed through to parseProfile
 * @returns {Array<object>} evidence records
 */
export function loadEvidence(filePath, options) {
  const { records, errors } = parseProfile(readText(filePath), options);
  if (errors.length > 0) {
    const list = errors.map((e) => `  ${e.message}`).join('\n');
    throw new Error(
      `${filePath} has ${errors.length} problem${errors.length === 1 ? '' : 's'} ` +
        `and cannot be used until they are fixed:\n${list}`,
    );
  }
  return records;
}
