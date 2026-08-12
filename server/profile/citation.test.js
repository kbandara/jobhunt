// Why these tests exist: a citation is the most checkable thing on a CV. A
// reader can put the title into Google Scholar and know in ten seconds whether
// the year, the venue and the status are right. So the rendering has to be
// arithmetic, and the arithmetic has to be pinned — including against a whole
// real file, because a parser that works on invented fixtures and mangles a
// finished profile is worth nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleEvidence, exampleMeta } from '../examples.js';
import {
  parseCitation,
  apa,
  citations,
  compareCitations,
  surnameFrom,
  STATUSES,
  statusLabel,
} from './citation.js';

const SURNAME = surnameFrom(exampleMeta());

/** A record in the shape profile/parse.js produces. */
const record = (over = {}) => ({
  id: 'pub-x',
  kind: 'publication',
  title: 'A paper about things',
  org: 'Journal of Things',
  dates: { start: '2024', end: '2024' },
  body: 'Kimani, R. J., & Other, A. B. (2024). Journal of Things, 12(3), 45–67.',
  ...over,
});

// --- the real file ----------------------------------------------------------

const REAL = citations(exampleEvidence(), { surname: SURNAME });

test('every real publication parses with no problems', () => {
  for (const citation of REAL) {
    assert.deepEqual(citation.problems, [], `${citation.id}: ${citation.problems.join(' | ')}`);
  }
});

test('every publication in the profile lists its owner as an author', () => {
  for (const citation of REAL) {
    assert.ok(
      citation.authors.some((name) => name.includes('Kimani')),
      `${citation.id} does not list them: ${citation.authors.join(' / ')}`,
    );
  }
});

test('no rendered citation contains a doubled comma or a stray dash', () => {
  for (const citation of REAL) {
    const rendered = apa(citation);
    assert.doesNotMatch(rendered, /,\s*,/, `${citation.id}: ${rendered}`);
    assert.doesNotMatch(rendered, /\(\s*\)/, `${citation.id}: ${rendered}`);
    assert.doesNotMatch(rendered, /\s{2,}/, `${citation.id}: ${rendered}`);
  }
});

test('a journal article renders exactly right, down to the punctuation', () => {
  const paper = REAL.find((c) => c.id === 'pub-turnover');
  assert.equal(
    apa(paper),
    'Kimani, R., & Brooks, A. (2025). Flow regulation reduces seasonal turnover in lowland ' +
      'river invertebrates. *Journal of Freshwater Biology*, *41*(2), 118–133. ' +
      'https://doi.org/10.0000/jfb.2025.0118',
  );
  assert.equal(paper.firstAuthor, true);
  assert.equal(paper.pages, '118–133');
});

test('a three-author paper keeps every name and exactly one ampersand', () => {
  const paper = REAL.find((c) => c.id === 'pub-recovery');
  assert.equal(paper.authors.length, 3, paper.authors.join(' / '));
  assert.equal((apa(paper).match(/&/g) ?? []).length, 1);
});

test('a page range is not read as a volume number', () => {
  const paper = parseCitation(
    record({ org: 'Brain Topography', body: 'Kimani, R. J. (2024). Brain Topography, 1-10.' }),
    { surname: SURNAME },
  );
  assert.equal(paper.volume, null, 'a volume is never a range');
  assert.equal(paper.pages, '1–10');
  assert.equal(paper.note, null, 'and nothing is left over as a note');
});

// --- status, which is the thing that must never drift -----------------------

test('unpublished work never renders as though it were published', () => {
  for (const citation of REAL.filter((c) => c.status !== 'published')) {
    const rendered = apa(citation);
    assert.match(rendered, /\[(Manuscript|Registered report)/, `${citation.id}: ${rendered}`);
  }
});

test('under review reads as submitted, not as a journal article', () => {
  const rendered = apa(parseCitation(record({
    org: 'Under review',
    body: 'Kimani, R. J., & Hutchinson, B. T. (under review).',
    dates: { start: '2026', end: null },
  }), { surname: SURNAME }));
  assert.match(rendered, /\[Manuscript submitted for publication\]\./);
  assert.doesNotMatch(rendered, /\*/, 'no italic journal name, because there is no journal yet');
});

test('in preparation is distinct from under review', () => {
  const prep = apa(parseCitation(record({ org: 'In preparation', body: 'Kimani, R. J. (in preparation).' }), { surname: SURNAME }));
  assert.match(prep, /\[Manuscript in preparation\]/);
  assert.doesNotMatch(prep, /submitted/);
});

test('an in-principle acceptance says so and names the venue', () => {
  const rendered = apa(parseCitation(record({
    org: 'Psychological Bulletin',
    body: 'Hutchinson, B. T., & Kimani, R. J. (2025). Stage 1 in-principle acceptance at Psychological Bulletin.',
  }), { surname: SURNAME }));
  assert.match(rendered, /\[Registered report, Stage 1 in-principle acceptance\]/);
  assert.match(rendered, /\*Psychological Bulletin\*/);
});

test('the APA bracket sits inside the title sentence, not after it', () => {
  const rendered = apa(parseCitation(record({ org: 'Under review', body: 'Kimani, R. J. (under review).' }), { surname: SURNAME }));
  assert.match(rendered, /things \[Manuscript/, 'APA 7 puts the bracket before the full stop');
  assert.doesNotMatch(rendered, /things\. \[Manuscript/);
});

// --- rendering details ------------------------------------------------------

test('journal and volume are italicised; issue and pages are not', () => {
  const rendered = apa(parseCitation(record(), { surname: SURNAME }));
  assert.match(rendered, /\*Journal of Things\*, \*12\*\(3\), 45–67\./);
});

test('a DOI is appended when the record carries one', () => {
  const rendered = apa(parseCitation(record({
    body: 'Kimani, R. J. (2024). Journal of Things, 12(3), 45. doi.org/10.1234/abcd',
  }), { surname: SURNAME }));
  assert.match(rendered, /https:\/\/doi\.org\/10\.1234\/abcd$/);
});

test('two authors take an ampersand, one takes none', () => {
  const two = parseCitation(record({ body: 'Kimani, R. J., & Other, A. B. (2024). Journal of Things, 1.' }), { surname: SURNAME });
  assert.match(apa(two), /Kimani, R\. J\., & Other, A\. B\. \(2024\)/);
  const one = parseCitation(record({ body: 'Kimani, R. J. (2024). Journal of Things, 1.' }), { surname: SURNAME });
  assert.doesNotMatch(apa(one), /&/);
});

test('the year comes from the record dates, not from a volume that looks like one', () => {
  // Volume 2025 of a 2025 journal is exactly the trap: a year scraped from the
  // text could pick up either, and only the dates line is a checked field.
  const citation = parseCitation(record({
    dates: { start: '2019', end: '2019' },
    body: 'Kimani, R. J. (2019). Journal of Things, 2025(1).',
  }), { surname: SURNAME });
  assert.equal(citation.year, 2019);
});

test('a record with no year says so rather than inventing one', () => {
  const citation = parseCitation(record({ dates: { start: null, end: null }, body: 'Kimani, R. J. (n.d.).' }), { surname: SURNAME });
  assert.equal(citation.year, null);
  assert.ok(citation.problems.some((p) => /no year/.test(p)));
  assert.match(apa(citation), /\(n\.d\.\)/, 'and renders the APA marker for it');
});

test('a record without you in the authors is flagged, not silently used', () => {
  const citation = parseCitation(record({ body: 'Other, A. B., & Third, C. D. (2024). Journal of Things, 1.' }), { surname: SURNAME });
  assert.ok(citation.problems.some((p) => /Kimani/.test(p)));
});

test('an unparseable body is reported rather than half-rendered', () => {
  const citation = parseCitation(record({ body: 'just some prose with no citation shape at all' }), { surname: SURNAME });
  assert.ok(citation.problems.length > 0);
});

test('nonsense input never throws', () => {
  for (const input of [undefined, null, {}, { body: '' }, { title: null, org: null }]) {
    assert.doesNotThrow(() => apa(parseCitation(input)), `for ${JSON.stringify(input)}`);
  }
});

// --- ordering ---------------------------------------------------------------

test('order is status groups, then newest first, then id', () => {
  const order = REAL.map((c) => c.status);
  const ranks = order.map((s) => STATUSES.indexOf(s));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `statuses out of order: ${order.join(', ')}`);
});

test('within published, newest comes first', () => {
  const years = REAL.filter((c) => c.status === 'published').map((c) => c.year);
  assert.deepEqual(years, [...years].sort((a, b) => b - a));
});

test('ordering is stable regardless of input order', () => {
  const evidence = exampleEvidence();
  const forwards = citations(evidence, { surname: SURNAME }).map((c) => c.id);
  const backwards = citations([...evidence].reverse(), { surname: SURNAME }).map((c) => c.id);
  assert.deepEqual(forwards, backwards);
});

test('same status and year fall back to id, never to input order', () => {
  const a = { id: 'pub-b', status: 'published', year: 2020 };
  const b = { id: 'pub-a', status: 'published', year: 2020 };
  assert.ok(compareCitations(a, b) > 0);
});

test('every status has a human label', () => {
  for (const status of STATUSES) {
    assert.ok(statusLabel(status).length > 0);
    assert.notEqual(statusLabel(status), status, `${status} needs wording a person would use`);
  }
});
