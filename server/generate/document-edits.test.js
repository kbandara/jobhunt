// Why these tests exist: both functions edit a document you are about to send to
// an employer. The id-stripping case is not hypothetical — a compiled PDF came
// out with "(role-phd)" after every bullet, because a revision read the house
// rule about citing evidence and typed the ids into the text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripEvidenceIds, replacePublications } from './document-edits.js';
import { exampleEvidence } from '../examples.js';

const IDS = ['role-phd', 'role-neuromatch', 'skill-bayesian', 'pub-tacs', 'project-eval-platform'];

// --- ids that must never reach the page ---------------------------------------

test('a trailing evidence id is removed', () => {
  const { markdown } = stripEvidenceIds('- Ran the experiments (role-phd).', IDS);
  assert.equal(markdown, '- Ran the experiments.');
});

test('square brackets go too — models use both', () => {
  const { markdown } = stripEvidenceIds('- Taught the course [role-neuromatch].', IDS);
  assert.equal(markdown, '- Taught the course.');
});

test('several ids in one bracket are removed together', () => {
  const { markdown } = stripEvidenceIds('- Built the pipeline (role-phd, skill-bayesian).', IDS);
  assert.equal(markdown, '- Built the pipeline.');
});

test('what was removed is reported, so the app can say it happened', () => {
  const { removed } = stripEvidenceIds('- A (role-phd). B [pub-tacs].', IDS);
  assert.deepEqual(removed, ['role-phd', 'pub-tacs']);
});

test('a year in brackets is NOT an evidence id and survives', () => {
  const line = 'Kimani, R. (2025). A paper about things.';
  assert.equal(stripEvidenceIds(line, IDS).markdown, line);
});

test('ordinary parentheses survive', () => {
  const line = '- Reduced processing time (from four hours to twenty minutes).';
  assert.equal(stripEvidenceIds(line, IDS).markdown, line);
});

test('a mixed bracket is left alone entirely, rather than half-edited', () => {
  // Removing only the recognised half would leave "(see role-phd)" as "(see )".
  const line = '- Something (see role-phd for detail).';
  assert.equal(stripEvidenceIds(line, IDS).markdown, line);
});

test('a markdown link is never mistaken for a citation', () => {
  const line = '[github.com/example](https://github.com/example)';
  assert.equal(stripEvidenceIds(line, IDS).markdown, line);
});

test('the space before a full stop is tidied, not left dangling', () => {
  const { markdown } = stripEvidenceIds('- Did a thing (role-phd) .', IDS);
  assert.doesNotMatch(markdown, / \./);
});

test('with no known ids nothing is touched', () => {
  const line = '- Did a thing (role-phd).';
  assert.equal(stripEvidenceIds(line, []).markdown, line);
});

test('every real record id is recognised', () => {
  const ids = exampleEvidence().map((r) => r.id);
  const doc = ids.map((id) => `- A bullet (${id}).`).join('\n');
  const { removed } = stripEvidenceIds(doc, ids);
  assert.equal(removed.length, ids.length, 'some real ids were not recognised');
});

test('nonsense input never throws', () => {
  for (const input of ['', null, undefined]) {
    assert.doesNotThrow(() => stripEvidenceIds(input, IDS));
  }
});

// --- publications, updated in place -------------------------------------------

const CV = [
  '# Rosa Kimani',
  '',
  '## Summary',
  '',
  'A summary.',
  '',
  '## Publications',
  '',
  '- An old citation.',
  '- Another old one.',
  '',
  '## Education',
  '',
  '- A degree.',
].join('\n');

test('ticking new publications rewrites only that section', () => {
  const { markdown, found, changed } = replacePublications(CV, ['A new citation.']);
  assert.equal(found, true);
  assert.equal(changed, true);
  assert.match(markdown, /- A new citation\./);
  assert.doesNotMatch(markdown, /An old citation/);
  // Everything else is exactly where it was.
  assert.match(markdown, /## Summary\n\nA summary\./);
  assert.match(markdown, /## Education\n\n- A degree\./);
});

test('the heading keeps whatever the profile called it', () => {
  const doc = CV.replace('## Publications', '## Selected Publications');
  const { markdown, found } = replacePublications(doc, ['A new citation.']);
  assert.equal(found, true);
  assert.match(markdown, /## Selected Publications/);
});

test('unticking everything removes the heading as well', () => {
  // A "Publications" heading with nothing under it reads as an oversight.
  const { markdown, found } = replacePublications(CV, []);
  assert.equal(found, true);
  assert.doesNotMatch(markdown, /## Publications/);
  assert.match(markdown, /## Education/);
});

test('a document with no publications section is left alone and says so', () => {
  const doc = '# Name\n\n## Summary\n\nText.';
  const { markdown, found, changed } = replacePublications(doc, ['A citation.']);
  assert.equal(found, false);
  assert.equal(changed, false);
  assert.equal(markdown, doc);
});

test('replacing with the same list reports no change', () => {
  const once = replacePublications(CV, ['A citation.']).markdown;
  assert.equal(replacePublications(once, ['A citation.']).changed, false);
});

test('the order given is the order written', () => {
  const { markdown } = replacePublications(CV, ['First.', 'Second.', 'Third.']);
  const positions = ['First.', 'Second.', 'Third.'].map((t) => markdown.indexOf(t));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('no run of blank lines is left behind', () => {
  const { markdown } = replacePublications(CV, ['One.']);
  assert.doesNotMatch(markdown, /\n{3,}/);
});

test('nonsense input never throws', () => {
  for (const input of ['', null, undefined]) {
    assert.doesNotThrow(() => replacePublications(input, ['x']));
  }
});
