// WHY: markdown is the editable source, but a PDF made by the browser's print
// dialogue is not the document you sends — your own ATS-hardened LaTeX class is.
// So this module is the last mile: markdown-shaped content in, a compilable .tex
// targeting atscv.sty out. It is pure and deterministic (same input, same bytes)
// so two exports can be diffed, and every character that reaches the page goes
// through escapeLatex — a stray "%" comments out the rest of a line silently and
// a stray "&" refuses to compile at all.

import { normaliseSections } from './profiles/index.js';
import { SECTION_CATALOGUE, LEGACY_SECTIONS } from './sections.js';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const normalise = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Keyword field of \cvmeta. Long enough to be useful, short enough to be read. */
const MAX_KEYWORDS = 24;

const DOC_LABEL = { cv: 'CV', 'cover-letter': 'Cover letter', criteria: 'Selection criteria', 'cold-email': 'Email' };

// --- escaping ---------------------------------------------------------------

/**
 * The ten characters TeX reserves, plus the typographic characters your documents
 * actually carry. Replacement happens in ONE pass over the string, which is what
 * makes "escape the backslash first" a non-question: a backslash produced by this
 * table is never re-examined, so `&` cannot become `\textbackslash{}&`.
 *
 * `\textbackslash{}`, `\textasciicircum{}` and `\textasciitilde{}` keep their
 * braces on purpose. Without them TeX swallows the following letter as part of
 * the control-word name, so "C:\path" would silently render as "C:path".
 */
const TEXT_ESCAPES = new Map([
  ['\\', '\\textbackslash{}'],
  ['{', '\\{'],
  ['}', '\\}'],
  ['$', '\\$'],
  ['&', '\\&'],
  ['#', '\\#'],
  ['^', '\\textasciicircum{}'],
  ['_', '\\_'],
  ['~', '\\textasciitilde{}'],
  ['%', '\\%'],

  // Typography. inputenc would accept some of these, but a character that is not
  // set up for the current encoding is a hard error mid-compile, and the error
  // names a line number rather than the word — so map them here instead.
  ['\u00a0', '~'], //  no-break space is exactly what TeX's tie means
  ['\u00b7', '\\textperiodcentered{}'], // · separates the contact block
  ['\u2013', '--'], // – en dash
  ['\u2014', '---'], // — em dash, the entry-heading separator assemble.js writes
  ['\u2018', '`'], // ‘
  ['\u2019', "'"], // ’
  ['\u201c', '``'], // “
  ['\u201d', "''"], // ”
  ['\u2032', "$'$"], // ′ the prime in meta-d′ — a real prime, not an apostrophe
  ['\u2026', '\\ldots{}'], // …
  ['\u2022', '\\textbullet{}'], // • pasted in from a bulleted list

  // A statistician's prose: p ≤ .05, d = 0.4 ± 0.1, 12 × 3, 37 °C, A → B.
  ['\u2212', '$-$'], // − true minus
  ['\u00d7', '\\texttimes{}'], // ×
  ['\u00b1', '\\textpm{}'], // ±
  ['\u00b0', '\\textdegree{}'], // °
  ['\u2264', '$\\leq$'], // ≤
  ['\u2265', '$\\geq$'], // ≥
  ['\u2192', '$\\rightarrow$'], // →
]);

/**
 * URLs are a different job. `\cvurl{x}` expands to `\href{https://x}{x}`, so its
 * argument is read with ordinary catcodes long before hyperref sees it: a bare
 * `&` is an alignment tab and stops the compile. A backslash escape is what
 * hyperref itself documents — it un-escapes `\&`, `\#`, `\%` and `\_` back into
 * literal characters in the link target, and they print as themselves in the
 * visible text. That is why your Google Scholar URL survives with its `&` intact.
 *
 * `~` and `^` are deliberately absent: hyperref needs the raw character in the
 * link target, and no escape for them is correct in both slots at once. Neither
 * appears in any of your links; a URL containing one is a known limitation.
 */
const URL_ESCAPES = new Map([
  ['\\', '\\textbackslash{}'], // not legal in a URL, but must not break the build
  ['{', '\\{'],
  ['}', '\\}'],
  ['$', '\\$'],
  ['&', '\\&'],
  ['#', '\\#'],
  ['_', '\\_'],
  ['%', '\\%'],
]);

/** A character class built from the table itself, so the two cannot drift apart. */
function classFor(map) {
  const body = [...map.keys()]
    .map((character) => `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`)
    .join('');
  return new RegExp(`[${body}]`, 'g');
}

const TEXT_PATTERN = classFor(TEXT_ESCAPES);
const URL_PATTERN = classFor(URL_ESCAPES);

/**
 * Make one run of prose safe to put on a LaTeX page. ASCII that TeX does not
 * reserve is left exactly as it was.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeLatex(text) {
  return String(text ?? '').replace(TEXT_PATTERN, (character) => TEXT_ESCAPES.get(character) ?? character);
}

/**
 * Make one URL safe inside `\href` or `\cvurl`, keeping `&`, `#`, `%` and `_` as
 * characters in the address rather than turning them into prose.
 *
 * @param {string} url
 * @returns {string}
 */
export function escapeLatexUrl(url) {
  return String(url ?? '').replace(URL_PATTERN, (character) => URL_ESCAPES.get(character) ?? character);
}

/**
 * Inline markdown, because markdown is the source: `**bold**`, `*italic*`,
 * `` `code` `` and `[label](url)`. Everything between the markup is escaped as
 * prose; leaving the asterisks in would print them on the page.
 */
export function latexInline(text) {
  const source = String(text ?? '');
  // A fresh matcher per call: this function recurses, and a shared `lastIndex`
  // on a /g regex would have the inner call rewind the outer one.
  const pattern = /\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\*([^*\n]+)\*/g;

  let out = '';
  let last = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    out += escapeLatex(source.slice(last, match.index));
    if (match[1] !== undefined) out += `\\href{${escapeLatexUrl(match[2])}}{${latexInline(match[1])}}`;
    else if (match[3] !== undefined) out += `\\textbf{${latexInline(match[3])}}`;
    else if (match[4] !== undefined) out += `\\texttt{${escapeLatex(match[4])}}`;
    else out += `\\textit{${latexInline(match[5])}}`;
    last = match.index + match[0].length;
  }
  return out + escapeLatex(source.slice(last));
}

// --- the document -----------------------------------------------------------

/**
 * Render one artifact as a complete, compilable `.tex` file targeting atscv.sty.
 *
 * @param {object} options
 * @param {object} options.artifact artifact shape — from documentFromMarkdown for
 *   a saved draft, or straight from the generator
 * @param {'cv'|'cover-letter'} [options.artifactKind]
 * @param {object} options.contact contactBlock() output: { lines, links }
 * @param {string} [options.profile] the profile this document was built for
 * @param {object} [options.profileConfig] server/generate/profiles/<profile>.json — section order
 * @param {object} [options.jobMeta] { company, roleTitle, skills, evidenceTags }
 * @param {object} [options.profileMeta] profile/profile-meta.json
 * @returns {string} the whole file, ending in a newline
 */
export function renderLatex({
  artifact = {},
  artifactKind = 'cv',
  contact = {},
  profile = null,
  profileConfig = {},
  jobMeta = {},
  profileMeta = {},
} = {}) {
  const contactLines = Array.isArray(contact?.lines) ? contact.lines : [];
  const name = clean(contactLines[0]) || clean(profileMeta?.name) || 'FILL-ME';
  const label = DOC_LABEL[artifactKind] ?? artifactKind;

  const lines = [
    '% ---------------------------------------------------------------------------',
    `% ${label} for ${comment(jobMeta?.company) || 'this application'}, exported by job_hunt.`,
    '% Content only: every formatting decision lives in atscv.sty, which must sit',
    '% in this same folder. Compile it twice -- pdflatex, then pdflatex again --',
    '% because the second pass is what resolves the links.',
    ...(profile ? [`% Profile: ${comment(profile)}`] : []),
    '% ---------------------------------------------------------------------------',
    '\\documentclass[11pt]{article}',
    '\\usepackage[charter,a4]{atscv}',
    '',
    '% Mirrored into the PDF information dictionary, which some parsers read before',
    '% they read the page: the advertisement\'s own words first, then the profile tags.',
    '\\cvmeta',
    `  {${escapeLatex([name, label, clean(jobMeta?.company)].filter(Boolean).join(' - '))}}`,
    `  {${escapeLatex(name)}}`,
    `  {${escapeLatex(keywordLine(jobMeta))}}`,
    '',
    '\\begin{document}',
    '',
    '% Contact details as plain text at the top of page one — never a header or a',
    '% footer, because many parsers discard that region outright.',
    '\\cvheader',
    `  {${escapeLatex(name)}}`,
    `  {${escapeLatex(clean(jobMeta?.roleTitle))}}`,
    `  {${headerContact(contact)}}`,
    '',
    ...documentBody(artifact, profileConfig, artifactKind),
    '\\end{document}',
  ];

  return `${collapseBlanks(lines).join('\n')}\n`;
}

/**
 * Text safe to sit after a `%`. A comment runs to the end of its line, so a
 * company name carrying a newline would put the rest of itself on the page as
 * LaTeX source — collapse the whitespace and the comment stays a comment.
 */
function comment(value) {
  return clean(value).replace(/\s+/g, ' ');
}

/** The `\cvmeta` keyword field: the ad's own skills first, then your matched tags. */
function keywordLine(jobMeta) {
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const text = clean(value);
    if (text === '') return;
    const key = normalise(text);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };

  for (const skill of Array.isArray(jobMeta?.skills) ? jobMeta.skills : []) add(skill);
  for (const tag of Array.isArray(jobMeta?.evidenceTags) ? jobMeta.evidenceTags : []) add(tag);
  return out.slice(0, MAX_KEYWORDS).join(', ');
}

/**
 * The contact line for `\cvheader`. Links become `\cvurl`, whose visible text is
 * the address itself — a screener that reads only the anchor text still sees
 * where to go, which "LinkedIn" as a label would have thrown away.
 */
function headerContact(contact) {
  const lines = Array.isArray(contact?.lines) ? contact.lines : [];
  const links = Array.isArray(contact?.links) ? contact.links : [];
  const pieces = [];

  for (const line of lines.slice(1)) {
    // The link line arrives as markdown (`[label](url)`); the structured `links`
    // say the same thing without the label getting in the way of the address.
    if (links.length > 0 && /\]\(/.test(String(line))) {
      for (const link of links) pieces.push(urlMacro(link?.url));
      continue;
    }
    for (const piece of String(line ?? '').split('\u00b7')) {
      const text = clean(piece);
      if (text === '') continue;
      pieces.push(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `\\cvmail{${escapeLatexUrl(text)}}` : escapeLatex(text));
    }
  }

  return pieces.join(' \\cvsep\\ ');
}

/** `\cvurl` re-adds https://, so only an https URL may lose its scheme this way. */
function urlMacro(url) {
  const address = clean(url);
  if (/^https:\/\//i.test(address)) return `\\cvurl{${escapeLatexUrl(address.replace(/^https:\/\//i, ''))}}`;
  return `\\href{${escapeLatexUrl(address)}}{${escapeLatexUrl(address.replace(/^[a-z]+:\/\//i, ''))}}`;
}

// --- sections ---------------------------------------------------------------

const ALL_SECTIONS = [...SECTION_CATALOGUE, ...LEGACY_SECTIONS];
const sameWord = (a, b) => a === b || a === `${b}s` || b === `${a}s`;

/** Which catalogue section a model-written or hand-edited heading is, or null. */
function idForHeading(heading) {
  const tokens = normalise(heading).split(' ').filter(Boolean);
  if (tokens.length === 0) return null;
  const found = ALL_SECTIONS.find((section) =>
    tokens.some((token) => section.aliases.some((alias) => sameWord(token, alias))),
  );
  return found?.id ?? null;
}

function documentBody(artifact, profileConfig, artifactKind = 'cv') {
  const sections = Array.isArray(artifact?.sections) ? [...artifact.sections] : [];

  // A generator artifact keeps the summary outside `sections`; a parsed document
  // has it as a section already. Only one of the two is ever populated.
  const summary = clean(artifact?.summary?.text);
  if (summary !== '') {
    sections.unshift({ heading: 'Summary', entries: [{ bullets: [{ text: summary, kind: 'paragraph' }] }] });
  }

  const out = [];
  for (const { section, id, heading } of orderSections(sections, profileConfig)) {
    // Criteria answers are prose, not achievements. Every section is one
    // question and its answer, so they are typeset as paragraphs regardless of
    // what the section happens to be called — a criteria heading like
    // "Demonstrated experience leading teams" would otherwise be matched to the
    // CV's "experience" slot and come out as a bullet list.
    out.push(...sectionLatex(section, artifactKind === 'criteria' ? 'summary' : id, heading));
  }
  return out;
}

/**
 * Section order comes from the profile, exactly as it does in assemble.js — "the
 * same CV with a different heading order" is diagnosed defect #3, and the .tex
 * must not disagree with the markdown it was made from. Anything the profile does
 * not name still appears, at the end, rather than being dropped.
 */
function orderSections(sections, profileConfig) {
  const used = new Set();
  const out = [];

  // Front matter — content above the first heading — always leads, unnamed.
  sections.forEach((section, index) => {
    if (clean(section?.heading) !== '') return;
    used.add(index);
    out.push({ section, id: null, heading: '' });
  });

  for (const wanted of normaliseSections(profileConfig)) {
    const index = sections.findIndex((section, at) => !used.has(at) && idForHeading(section?.heading) === wanted.id);
    if (index === -1) continue;
    used.add(index);
    out.push({ section: sections[index], id: wanted.id, heading: clean(wanted.heading) || clean(sections[index]?.heading) });
  }

  sections.forEach((section, index) => {
    if (used.has(index)) return;
    out.push({ section, id: idForHeading(section?.heading), heading: clean(section?.heading) });
  });

  return out;
}

function sectionLatex(section, id, headingOverride) {
  const entries = Array.isArray(section?.entries) ? section.entries : [];
  const body = bodyLatex(entries, id);
  if (body.length === 0) return []; // a heading with nothing under it is noise

  const heading = clean(headingOverride) || clean(section?.heading);
  if (heading === '') return [...body, ''];
  return [`\\section{${escapeLatex(heading)}}`, ...body, ''];
}

function bodyLatex(entries, id) {
  if (id === 'skills' || id === 'methods') return skillLatex(entries);
  if (id === 'publications') return numberedLatex(entries);
  if (id === 'summary' || id === 'clearance') return itemTexts(entries).map(latexInline);
  return entryLatex(entries);
}

/** Every line of prose an entry carries, in order, whatever shape it arrived in. */
function itemTexts(entries) {
  return items(entries).map((item) => item.text);
}

function items(entries) {
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const line = clean(entry?.line);
    if (line !== '') out.push({ text: line, kind: 'bullet' });
    for (const bullet of Array.isArray(entry?.bullets) ? entry.bullets : []) {
      const text = clean(bullet?.text);
      if (text !== '') out.push({ text, kind: bullet?.kind === 'paragraph' ? 'paragraph' : 'bullet' });
    }
  }
  return out;
}

const SKILL_LINE = /^\*\*\s*(.+?)\s*:?\s*\*\*:?\s*(.*)$/;

/**
 * `\cvskill{Category}{comma, separated, list}`. Your profiles group skills under
 * labels and assemble.js writes them as `- **Languages:** Python, R`, so the
 * label is already there to be read back — nothing is invented here.
 */
function skillLatex(entries) {
  const out = [];
  for (const { text } of items(entries)) {
    const match = SKILL_LINE.exec(text);
    if (match) out.push(`\\cvskill{${latexInline(match[1])}}{${latexInline(match[2])}}`);
    else out.push(latexInline(text));
  }
  return out;
}

/**
 * One list item. `\item` takes an OPTIONAL argument in square brackets, so a line
 * that opens with "[" — a placeholder, or a bracketed citation — would be eaten
 * as a custom bullet label and vanish from the page. `{}` in front stops that.
 */
function texItem(text) {
  const rendered = latexInline(text);
  return `  \\item ${rendered.startsWith('[') ? '{}' : ''}${rendered}`;
}

function numberedLatex(entries) {
  const lines = itemTexts(entries);
  if (lines.length === 0) return [];
  return ['\\begin{cvnumbered}', ...lines.map(texItem), '\\end{cvnumbered}'];
}

function entryLatex(entries) {
  const out = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const title = clean(entry?.title);
    const org = clean(entry?.org);
    const dates = clean(entry?.dates);

    // \cventry puts role and dates on line one and organisation on line two — the
    // association a date-proximity parser expects. Location is not in the markdown,
    // so it stays empty and the class omits it.
    if (title !== '' || org !== '' || dates !== '') {
      out.push(`\\cventry{${latexInline(title)}}{${latexInline(org)}}{}{${escapeLatex(dates)}}`);
    }

    let bullets = [];
    const flush = () => {
      if (bullets.length === 0) return;
      out.push('\\begin{cvbullets}', ...bullets.map(texItem), '\\end{cvbullets}');
      bullets = [];
    };

    for (const item of items([entry])) {
      if (item.kind === 'paragraph') {
        flush();
        out.push(latexInline(item.text), '');
        continue;
      }
      bullets.push(item.text);
    }
    flush();
    out.push('');
  }

  while (out.length > 0 && out.at(-1) === '') out.pop();
  return out;
}

/** At most one blank line anywhere, and none before \end{document}. */
function collapseBlanks(lines) {
  const out = [];
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out.at(-1) === '')) continue;
    out.push(line);
  }
  while (out.length > 0 && out.at(-1) === '') out.pop();
  return out;
}

export default renderLatex;
