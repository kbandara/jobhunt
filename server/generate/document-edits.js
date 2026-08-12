// WHY: two things that must happen to a saved document in CODE, not by asking a
// model, because both went wrong in exactly the way asking a model goes wrong.
//
// 1. EVIDENCE IDS MUST NEVER REACH THE PAGE. They are how the validator traces a
//    bullet back to a record; they are not for a reader. In generation they are
//    a structured field and cannot leak. In a revision the model returns raw
//    markdown, read the house rule "every bullet must cite its evidence ids",
//    and helpfully typed them into the text — so a compiled PDF came out with
//    "(role-phd)" after every bullet. On a CV about to be sent to an employer.
//
// 2. TICKING A PUBLICATION MUST CHANGE THE DOCUMENT. It used to change only what
//    the NEXT generation would say, which is invisible: you ticked, looked at the
//    draft, and nothing had happened. Citations are rendered deterministically
//    (server/profile/citation.js), so the section can simply be rewritten in
//    place — no model call, no cost, no chance of the rest of the CV moving.

/**
 * Remove evidence ids that a model has written into the visible text.
 *
 * Deliberately conservative: a bracketed group is removed ONLY when every id
 * inside it is a real record id. "(2020)" survives, "[see below]" survives, and
 * "[role-phd, skill-bayesian]" goes. Anything looser would eventually eat a
 * real parenthetical from your CV, which is a worse failure than leaving one id
 * behind — one is a typo, the other is lost content.
 *
 * @param {string} markdown
 * @param {Iterable<string>} knownIds every evidence record id
 * @returns {{markdown: string, removed: string[]}}
 */
export function stripEvidenceIds(markdown, knownIds = []) {
  const known = new Set([...knownIds].filter(Boolean));
  const removed = [];
  if (known.size === 0) return { markdown: String(markdown ?? ''), removed };

  const text = String(markdown ?? '').replace(
    /\s*[[(]([^\][()\n]{1,200})[\])]/g,
    (whole, inside) => {
      const ids = inside.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
      if (ids.length === 0 || !ids.every((id) => known.has(id))) return whole;
      removed.push(...ids);
      return '';
    },
  );

  // Removing a trailing "(role-phd)" leaves " ." behind often enough to be worth
  // tidying: a stray space before a full stop is the kind of thing a reader
  // notices without knowing why the line looks wrong.
  const tidied = text
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/[ \t]+$/gm, '');

  return { markdown: tidied, removed };
}

/**
 * Replace the publications section of a document with a new list.
 *
 * Only the list changes: the heading keeps whatever wording the profile gave it,
 * and every other section is untouched. If there is no publications section the
 * document is returned unchanged and `found` is false — the caller says so
 * rather than inventing a section in a position nobody chose.
 *
 * @param {string} markdown the saved document
 * @param {string[]} citations APA lines, already rendered and ordered
 * @param {string[]} [headings] section headings that count as "publications"
 * @returns {{markdown: string, found: boolean, changed: boolean}}
 */
export function replacePublications(markdown, citations = [], headings = PUBLICATION_HEADINGS) {
  const text = String(markdown ?? '');
  const lines = text.split(/\r?\n/);

  const start = lines.findIndex((line) => isPublicationHeading(line, headings));
  if (start === -1) return { markdown: text, found: false, changed: false };

  // The section runs to the next "## " heading, or to the end of the document.
  let end = start + 1;
  while (end < lines.length && !/^##\s+\S/.test(lines[end])) end += 1;

  const body = citations.length > 0 ? ['', ...citations.map((line) => `- ${line}`), ''] : [''];
  const next = [...lines.slice(0, start + 1), ...body, ...lines.slice(end)];

  // An empty selection removes the heading too — a "Publications" heading with
  // nothing under it reads as an oversight rather than as a decision.
  const cleaned = citations.length === 0 ? [...lines.slice(0, start), ...lines.slice(end)] : next;

  const result = cleaned.join('\n').replace(/\n{3,}/g, '\n\n');
  return { markdown: result, found: true, changed: result !== text };
}

/** Headings that mean "publications", whatever a profile chose to call it. */
export const PUBLICATION_HEADINGS = [
  'publications',
  'selected publications',
  'papers',
  'preprints',
  'publications and preprints',
];

function isPublicationHeading(line, headings) {
  const match = /^##\s+(.+?)\s*$/.exec(line);
  if (!match) return false;
  const normalised = match[1].toLowerCase().replace(/[^a-z ]/g, '').trim();
  return headings.includes(normalised);
}
