// Why these tests exist: this function takes text a language model produced and
// puts it into the page as HTML. The model's input includes a job advertisement
// pasted from the internet, so "a model would never emit a script tag" is not a
// safety argument — it is a hope. Escaping first is what makes it safe, and
// these hold that line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../client/views/markdown.js';

// --- safety --------------------------------------------------------------------

test('a script tag comes out as text, never as a tag', () => {
  const out = renderMarkdown('Here you go: <script>alert(1)</script>');
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /&lt;script&gt;/);
});

test('an event handler on an injected tag cannot survive', () => {
  const out = renderMarkdown('<img src=x onerror="alert(1)">');
  // The property that matters is that no ELEMENT is created. The characters
  // "onerror=" still appear, as visible text inside a paragraph — which is
  // correct: it is showing you what the model wrote. Asserting the string is
  // absent would be testing the wrong thing and would pass on output that had
  // silently dropped content instead of escaping it.
  assert.doesNotMatch(out, /<img/i);
  assert.match(out, /&lt;img/);
  assert.match(out, /^<p>/, 'the whole thing is inert text in a paragraph');
});

test('an iframe is text too', () => {
  assert.doesNotMatch(renderMarkdown('<iframe src="https://evil.test"></iframe>'), /<iframe/i);
});

test('ampersands are escaped before anything else, so entities cannot be smuggled', () => {
  // Escaping < and > but not & first lets "&lt;script&gt;" round-trip into a tag.
  const out = renderMarkdown('&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.doesNotMatch(out, /<script/i);
  assert.match(out, /&amp;lt;/);
});

// --- the formatting you actually get -------------------------------------------

test('headings become headings, at every level a reply uses', () => {
  const out = renderMarkdown('# One\n\n## Two\n\n### Three');
  assert.match(out, /<h1[^>]*>One<\/h1>/);
  assert.match(out, /<h2[^>]*>Two<\/h2>/);
  assert.match(out, /<h3[^>]*>Three<\/h3>/);
});

test('bullet and numbered lists both render', () => {
  assert.match(renderMarkdown('- one\n- two'), /<ul>[\s\S]*<li>one<\/li>/);
  assert.match(renderMarkdown('1. first\n2. second'), /<ol>[\s\S]*<li>first<\/li>/);
});

test('bold and italic survive', () => {
  assert.match(renderMarkdown('**bold** and *italic*'), /<strong>bold<\/strong>/);
  assert.match(renderMarkdown('**bold** and *italic*'), /<em>italic<\/em>/);
});

test('inline code renders — record ids and file paths arrive this way', () => {
  const out = renderMarkdown('Look at `role-riverina` in `data/profile/master-profile.md`.');
  assert.match(out, /<code>role-riverina<\/code>/);
  assert.match(out, /<code>data\/master-profile\.md<\/code>|<code>data\/profile\/master-profile\.md<\/code>/);
});

test('a fenced block renders as a block, not as one long line', () => {
  assert.match(renderMarkdown('```\nline one\nline two\n```'), /<pre>/);
});

test('a single newline is a line break, because models write replies that way', () => {
  // Without `breaks`, "line one\nline two" collapses into one paragraph and a
  // reply written as short lines reads as a wall.
  assert.match(renderMarkdown('line one\nline two'), /<br\s*\/?>/);
});

test('plain prose is just a paragraph', () => {
  assert.match(renderMarkdown('Just a sentence.'), /<p>Just a sentence\.<\/p>/);
});

// --- degrading well --------------------------------------------------------------

test('empty and missing input produce nothing, not "undefined"', () => {
  assert.equal(renderMarkdown('').trim(), '');
  assert.doesNotMatch(renderMarkdown(undefined), /undefined/);
  assert.doesNotMatch(renderMarkdown(null), /null/);
});

test('nothing here throws, whatever it is given', () => {
  for (const input of ['', null, undefined, 0, '#'.repeat(500), '```unterminated']) {
    assert.doesNotThrow(() => renderMarkdown(input), `for ${JSON.stringify(input)?.slice(0, 40)}`);
  }
});
