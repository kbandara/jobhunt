// WHY: once you edit a draft, the markdown is the document — the structured
// artifact the model returned no longer describes it. The validator works on
// text units, so this turns edited markdown back into that shape for the
// advisory re-check on save (R8). Citations are gone by then, which is exactly
// why that re-check is advisory: it can flag a number, never prove a source.
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;

/**
 * @param {string} markdown edited document text
 * @param {'cv'|'cover-letter'} artifactKind
 * @param {object} [options]
 * @param {string[]} [options.contactLines] the code-generated contact block.
 *   These are dropped before checking, because they are not claims the model
 *   made — workrights.js wrote them from profile-meta.json. Without this the
 *   number rule reads a phone number as an unsourced figure and reports the
 *   digits of "+61 400 000 000" as four invented statistics, which is both
 *   wrong and the fastest way to teach you to ignore this panel.
 * @returns {object} an artifact shaped like the generation schemas
 */
export function artifactFromMarkdown(markdown, artifactKind = 'cv', { contactLines = [] } = {}) {
  const blocks = textBlocks(withoutContact(markdown, contactLines));
  if (artifactKind === 'cover-letter' || artifactKind === 'cold-email') {
    return {
      paragraphs: blocks.map((block) => ({ text: block.text, evidence_ids: [] })),
      gaps: [],
      changes_made: [],
    };
  }

  // Criteria answers are prose under a heading, like a cover letter — but every
  // paragraph IS a claim about you, so unlike a cover letter none of them is
  // exempt from the number rule. Flattening them into one bag is enough: the
  // advisory re-check reports a ref and a line, and which question it sat under
  // is visible from the document itself.
  if (artifactKind === 'criteria') {
    return {
      answers: [{
        criterion: '',
        paragraphs: blocks.map((block) => ({ text: block.text, evidence_ids: [] })),
      }],
      gaps: [],
      changes_made: [],
    };
  }

  // Entries carry the nearest "### " heading as context, so R4's heading rule
  // still fires on an edit like "Submitted October 2026" under the PhD entry.
  const entries = [];
  let current = null;
  for (const block of blocks) {
    if (block.entryHeading !== null) {
      const [title, org] = splitEntryHeading(block.entryHeading);
      current = { title, org, dates: null, bullets: [] };
      entries.push(current);
      continue;
    }
    if (!current) {
      current = { title: null, org: null, dates: null, bullets: [] };
      entries.push(current);
    }
    current.bullets.push({ text: block.text, evidence_ids: [] });
  }

  return {
    summary: { text: '', evidence_ids: [] },
    sections: [{ heading: 'Edited document', entries }],
    gaps: [],
    changes_made: [],
  };
}

/**
 * The same edited markdown, but read back as a DOCUMENT rather than as a bag of
 * checkable text: the contact block, then real sections holding real entries.
 * artifactFromMarkdown above flattens all of that away on purpose, because the
 * validator only cares about text units — a renderer cares about the shape.
 *
 * The rule is one rule for both kinds: `# ` is the title, everything up to the
 * first `## ` is front matter, `## ` opens a section, `### ` opens an entry.
 * A cover letter simply has no `## `, so its whole body is front matter.
 *
 * @param {string} markdown the saved document
 * @param {object} [options]
 * @param {string[]} [options.contactLines] the code-generated contact block. Lines
 *   matching it are lifted out as contact rather than left in the body, so the
 *   renderer can lay them out itself instead of printing them twice.
 * @returns {{title: string, contactLines: string[], artifact: object}}
 */
export function documentFromMarkdown(markdown, { contactLines = [] } = {}) {
  const known = new Set((Array.isArray(contactLines) ? contactLines : []).map((line) => String(line).trim()));

  let title = '';
  const contact = [];
  const sections = [];
  let section = null;
  let entry = null;

  const openSection = (heading) => {
    section = { heading, entries: [] };
    sections.push(section);
    entry = null;
    return section;
  };
  const openEntry = (fields) => {
    if (!section) openSection('');
    entry = { title: null, org: null, dates: null, bullets: [], ...fields };
    section.entries.push(entry);
    return entry;
  };

  // A CV has "## " sections; a cover letter has none, so its whole body would
  // otherwise count as front matter. The two need different rules, and this is
  // how they are told apart.
  const hasSections = /^##\s+\S/m.test(String(markdown ?? ''));

  for (const block of documentBlocks(markdown, known)) {
    if (block.type === 'contact') {
      contact.push(block.text);
      continue;
    }
    if (block.type === 'heading' && block.level === 1) {
      if (title === '') title = block.text;
      else contact.push(block.text);
      continue;
    }
    if (block.type === 'heading' && block.level === 2) {
      openSection(block.text);
      continue;
    }
    if (block.type === 'heading') {
      const [role, org] = splitEntryHeading(block.text);
      openEntry({ title: role, org });
      continue;
    }
    // Front matter in a CV that looks like contact details IS contact details.
    //
    // Exact matching against the generated lines alone was not enough: you edit
    // these drafts, and a contact line you have retyped by one character stopped
    // matching, fell through to the body, and got typeset a second time
    // underneath the header the template had already built from
    // profile-meta.json. A CV with the phone number printed twice is not one you
    // can send.
    //
    // But front matter that does NOT look like contact — a note you have added at
    // the top — is content, and content is never dropped. Hence looksLikeContact
    // rather than "everything above the first heading".
    if (section === null && hasSections && looksLikeContact(block.text, known)) {
      contact.push(block.text);
      continue;
    }
    if (section === null && !hasSections && known.has(block.text)) {
      // A cover letter has no "## " at all, so its whole body is front matter.
      // Only the exact generated lines are contact here; everything else is the
      // letter.
      contact.push(block.text);
      continue;
    }
    // The line straight after an entry heading is its dates — that is what
    // assemble.js writes there, and a date range is what it looks like.
    if (entry && entry.title && entry.dates === null && entry.bullets.length === 0 && looksLikeDates(block.text)) {
      entry.dates = block.text;
      continue;
    }
    if (!entry) openEntry({});
    entry.bullets.push({ text: block.text, evidence_ids: [], kind: block.type });
  }

  return {
    title,
    contactLines: contact,
    artifact: {
      summary: { text: '', evidence_ids: [] },
      sections,
      gaps: [],
      changes_made: [],
    },
  };
}

/**
 * Is this front-matter line contact details rather than something you wrote?
 *
 * The markers are the ones the contact block is actually built from: an email
 * address, a link, a phone number, or the middot the generator uses to join
 * fields. Prose has none of them, which is what keeps "A note I added at the
 * top." out of the header.
 *
 * Deliberately not clever. Getting it wrong in one direction prints a line
 * twice; in the other it moves one line into the header. Both are visible on
 * the page you are about to read, which is the right place for a judgement call
 * like this to be caught.
 */
function looksLikeContact(text, known = new Set()) {
  if (known.has(text)) return true;
  return (
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(text) || // an email address
    /\[[^\]]+\]\([^)]+\)/.test(text) || // a markdown link
    /\+\d[\d\s]{6,}/.test(text) || // an international phone number
    text.includes(' · ') // the separator the contact block joins fields with
  );
}

/** Short, and carries a year or the word "present". Deliberately not a parser. */
function looksLikeDates(text) {
  return text.length <= 60 && (/\b(19|20)\d{2}\b/.test(text) || /\bpresent\b/i.test(text));
}

/** Blocks with their kind and heading level kept, unlike textBlocks below. */
function documentBlocks(markdown, known = new Set()) {
  const blocks = [];
  let paragraph = [];

  const flush = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ type: 'paragraph', text });
  };

  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    // A contact line breaks the paragraph it is in. The contact block is two
    // consecutive lines with no blank between them, so without this they are
    // glued into one paragraph, neither half matches the lines the server
    // generated, and the whole header gets typeset as a bullet in the body.
    if (known.has(line)) {
      flush();
      blocks.push({ type: 'contact', text: line });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      blocks.push({ type: 'bullet', text: bullet[1].trim() });
      continue;
    }
    // A plain line directly under a bullet continues that bullet. Markdown calls
    // this lazy continuation, and it matters here because the editor is a
    // textarea: hard-wrapping a long bullet over two lines is the natural thing
    // to do, and without this the second half broke out of the list and was
    // typeset flush left as its own paragraph.
    const previous = blocks[blocks.length - 1];
    if (paragraph.length === 0 && previous?.type === 'bullet') {
      previous.text = `${previous.text} ${line}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return blocks;
}

/** Every checkable line: bullets, paragraphs, and "### " headings as context. */
function textBlocks(markdown) {
  const blocks = [];
  let paragraph = [];

  const flush = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ text, entryHeading: null });
  };

  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      // Entry headings become context; document/section headings are checked as text.
      if (heading[1].length >= 3) blocks.push({ text: '', entryHeading: heading[2].trim() });
      else blocks.push({ text: heading[2].trim(), entryHeading: null });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      blocks.push({ text: bullet[1].trim(), entryHeading: null });
      continue;
    }
    // Lazy continuation, exactly as in documentBlocks above: a hard-wrapped
    // bullet is ONE claim, and checking its two halves separately would report
    // a figure as uncited when its source sits in the other half of the
    // sentence.
    const previous = blocks[blocks.length - 1];
    if (paragraph.length === 0 && previous && previous.entryHeading === null && previous.text !== '') {
      previous.text = `${previous.text} ${line}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return blocks.filter((block) => block.entryHeading !== null || block.text !== '');
}

/**
 * Remove the code-generated contact lines from the markdown before anything
 * else reads it.
 *
 * Done on raw lines rather than on parsed blocks because the contact block is
 * two consecutive lines with no blank between them, so by the time it is a
 * block it has already been joined into one paragraph and neither half matches
 * anything on its own.
 *
 * Matched by exact text, and only against lines the server actually generated.
 * That is deliberately narrow: a line you have retyped yourself no longer matches
 * and goes back to being checked, which is the safe direction to fail — the
 * alternative is a rule that quietly stops looking at the top of the document
 * and never tells anyone it has.
 */
function withoutContact(markdown, contactLines) {
  const known = new Set(
    (Array.isArray(contactLines) ? contactLines : [])
      .map((line) => String(line).trim())
      .filter(Boolean),
  );
  const text = String(markdown ?? '');
  if (known.size === 0) return text;
  return text
    .split(/\r?\n/)
    .filter((line) => !known.has(line.trim()))
    .join('\n');
}

/** "Data Analyst — Department of Health" back into title and org. */
function splitEntryHeading(heading) {
  const parts = heading.split(/\s+—\s+|\s+–\s+|\s+-\s+/);
  if (parts.length < 2) return [heading, null];
  return [parts[0].trim(), parts.slice(1).join(' — ').trim()];
}

export default artifactFromMarkdown;
