// Why these tests exist: this module is what the validator sees once a document
// has been edited, so anything it gets wrong shows up as a false flag — and a
// flags panel with false flags in it is one you learn to scroll past, which
// costs you the true flags too. The contact-block cases are the ones that were
// actually wrong: the digits of a phone number were being reported as four
// invented statistics on every edited CV.
import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactFromMarkdown, documentFromMarkdown } from './from-markdown.js';

const CONTACT = [
  'Melbourne, Australia · rosa.kimani@example.org · +61 400 000 000',
  '[github.com/example](https://github.com/example) · [linkedin.com/in/example](https://www.linkedin.com/in/example/)',
];

const CV = [
  '# Rosa Kimani',
  '',
  ...CONTACT.flatMap((line) => [line]),
  '',
  '## Summary',
  '',
  'A computational neuroscientist moving into evaluation work.',
  '',
  '## Selected work',
  '',
  '### LLM evaluation platform — independent research',
  'June 2025 – present',
  '',
  '- Built a harness across a panel of five models, n=100 per cell.',
].join('\n');

/** Every piece of text the validator would check. */
const allText = (artifact) =>
  (artifact.sections ?? [])
    .flatMap((s) => s.entries ?? [])
    .flatMap((e) => e.bullets ?? [])
    .map((b) => b.text);

test('without contact lines supplied, the header is checked like any other text', () => {
  const text = allText(artifactFromMarkdown(CV, 'cv')).join(' ');
  assert.match(text, /400 000 000/, 'the old behaviour, kept as the default');
});

test('the code-generated contact block is not checked as a claim', () => {
  const text = allText(artifactFromMarkdown(CV, 'cv', { contactLines: CONTACT })).join(' ');
  assert.doesNotMatch(text, /400 000 000/, 'a phone number is not an unsourced statistic');
  assert.doesNotMatch(text, /linkedin/i, 'nor is a profile URL');
  assert.doesNotMatch(text, /rosa\.kimani@example\.org/);
});

test('dropping the contact block does not drop anything else', () => {
  const text = allText(artifactFromMarkdown(CV, 'cv', { contactLines: CONTACT })).join(' ');
  assert.match(text, /n=100 per cell/, 'real claims are still checked');
  assert.match(text, /moving into evaluation work/);
  assert.match(text, /Rosa Kimani/, 'the name is still there — it is a heading, not contact');
});

test('a contact line retyped by hand goes back to being checked', () => {
  const edited = CV.replace('+61 400 000 000', '+61 400 999 888');
  const text = allText(artifactFromMarkdown(edited, 'cv', { contactLines: CONTACT })).join(' ');
  assert.match(text, /400 999 888/, 'failing towards checking too much, never too little');
});

test('entry headings survive, so the heading-scoped rules still fire', () => {
  const artifact = artifactFromMarkdown(CV, 'cv', { contactLines: CONTACT });
  const titles = artifact.sections[0].entries.map((e) => e.title);
  assert.ok(titles.includes('LLM evaluation platform'), `got ${JSON.stringify(titles)}`);
});

test('a cover letter drops its contact block too', () => {
  const letter = [...CONTACT, '', 'Dear hiring team,', '', 'I am writing about the role.'].join('\n');
  const artifact = artifactFromMarkdown(letter, 'cover-letter', { contactLines: CONTACT });
  const text = artifact.paragraphs.map((p) => p.text).join(' ');
  assert.doesNotMatch(text, /474/);
  assert.match(text, /Dear hiring team/);
});

test('empty and nonsense input never throws', () => {
  for (const input of ['', null, undefined, '#', '\n\n\n']) {
    assert.doesNotThrow(() => artifactFromMarkdown(input, 'cv', { contactLines: CONTACT }), `for ${JSON.stringify(input)}`);
  }
  assert.doesNotThrow(() => artifactFromMarkdown(CV, 'cv', { contactLines: null }));
});

// --- the export path -------------------------------------------------------

test('the LaTeX path reads the CURRENT markdown, so an edit reaches the PDF', () => {
  const edited = CV.replace('n=100 per cell', 'n=250 per cell');
  const document = documentFromMarkdown(edited, { contactLines: CONTACT });
  const bullets = document.artifact.sections
    .flatMap((s) => s.entries)
    .flatMap((e) => e.bullets ?? [])
    .map((b) => b.text);
  assert.ok(bullets.some((b) => b.includes('n=250')), 'the edit is what gets typeset');
  assert.ok(!bullets.some((b) => b.includes('n=100')), 'and the original is gone');
});

test('the contact block is lifted out for the renderer rather than printed twice', () => {
  const document = documentFromMarkdown(CV, { contactLines: CONTACT });
  assert.deepEqual(document.contactLines, CONTACT);
  const body = JSON.stringify(document.artifact);
  assert.doesNotMatch(body, /400 000 000/, 'the header is laid out by the template, not left in the body');
});

// The two cases below are what a real compiled PDF actually looked like before
// they were fixed: the phone number printed twice, and the second half of a
// wrapped bullet sitting flush left outside its own list.

test('a contact line retyped by hand is still contact, not a second header in the body', () => {
  const edited = CV.replace('+61 400 000 000', '+61 400 000 000 (mobile)');
  const document = documentFromMarkdown(edited, { contactLines: CONTACT });
  assert.ok(
    document.contactLines.some((line) => line.includes('(mobile)')),
    `the edited line went into the body instead: ${JSON.stringify(document.contactLines)}`,
  );
  assert.doesNotMatch(JSON.stringify(document.artifact), /mobile/);
});

test('a note you add at the top is content and is never dropped', () => {
  const withNote = CV.replace('## Summary', 'Draft two — check the dates.\n\n## Summary');
  const document = documentFromMarkdown(withNote, { contactLines: CONTACT });
  assert.match(JSON.stringify(document.artifact), /Draft two/, 'prose in the header area is content');
  assert.ok(!document.contactLines.some((l) => l.includes('Draft two')));
});

test('a bullet you have hard-wrapped stays one bullet', () => {
  const wrapped = CV.replace(
    '- Built a harness across a panel of five models, n=100 per cell.',
    '- Built a harness across a panel of five models,\n  n=100 per cell.',
  );
  const document = documentFromMarkdown(wrapped, { contactLines: CONTACT });
  const bullets = document.artifact.sections
    .flatMap((s) => s.entries)
    .flatMap((e) => e.bullets ?? [])
    .filter((b) => b.kind === 'bullet')
    .map((b) => b.text);
  assert.ok(
    bullets.some((b) => b.includes('five models, n=100 per cell')),
    `the wrap split the bullet: ${JSON.stringify(bullets)}`,
  );
});

test('the validator sees a wrapped bullet as one claim too', () => {
  const wrapped = CV.replace(
    '- Built a harness across a panel of five models, n=100 per cell.',
    '- Built a harness across a panel of five models,\n  n=100 per cell.',
  );
  const texts = allText(artifactFromMarkdown(wrapped, 'cv', { contactLines: CONTACT }));
  assert.ok(
    texts.some((t) => t.includes('five models, n=100 per cell')),
    'a figure must be checked against the sentence that sources it, not half of it',
  );
});
