// Why these tests exist: the panel's job is to make the important finding
// visible. A real CV produced thirteen entries where the one that mattered — a
// claim the PhD had been awarded — sat last, below twelve repetitions of the
// same wording note. Every test here is about that failure: the right thing
// first, and the repetitive thing folded down so it cannot bury anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFlags, stripAdvisory } from '../../client/views/flags-grouping.js';

/** A terminology finding, in the shape the validator's advisory mode produces. */
const wording = (term, translation, ref) => ({
  rule: 'R8',
  sourceRule: 'R6',
  ref,
  severity: 'warning',
  message: `advisory (R6): "${term}" is a specialist name, and the advertisement never uses it — this reader is only partly technical. Say "${translation}" instead. Generalising the name is fine; overstating the work is not.`,
  detail: { term, translation, register: 'mixed' },
});

const phdClaim = {
  rule: 'R8',
  sourceRule: 'R4',
  ref: 'cv.sections[0].entries[7].bullets[1]',
  severity: 'warning',
  message: 'advisory (R4): "Completed" says the doctorate has been awarded, but profile-meta.json records awarded: false.',
};

/** The exact thirteen findings reported, in the order they were received. */
const REAL_CASE = [
  wording('posterior exceedance probability', 'how strongly the comparison favours one model', 'a[1]'),
  wording('Dynamic Causal Modelling', 'generative modelling of dynamical systems', 'a[3]'),
  wording('Dynamic Causal Modelling', 'generative modelling of dynamical systems', 'a[5]'),
  wording('signal detection theory', 'separating what someone can tell apart from what they say', 'b[5]'),
  wording('variational inference', 'an approximate Bayesian fitting method', 'b[5]'),
  wording('source reconstruction', 'estimating where in the brain a signal came from', 'b[6]'),
  wording('Dynamic Causal Modelling', 'generative modelling of dynamical systems', 'b[8]'),
  wording('Parametric Empirical Bayes', 'hierarchical Bayesian modelling across participants', 'b[8]'),
  wording('item response theory', 'modelling how hard each question is', 'b[8]'),
  wording('event-related potential', 'an averaged brain response time-locked to an event', 'b[8]'),
  wording('Dynamic Causal Modelling', 'generative modelling of dynamical systems', 'c[1]'),
  wording('Parametric Empirical Bayes', 'hierarchical Bayesian modelling across participants', 'c[1]'),
  phdClaim,
];

test('the PhD claim comes first, not thirteenth', () => {
  // The whole point. It arrived last because it appeared last in the document.
  const groups = groupFlags(REAL_CASE);
  assert.equal(groups[0].rule, 'R4');
  assert.equal(groups[0].title, 'Qualification status');
});

test('twelve wording findings collapse to eight rows', () => {
  // Twelve four-line entries become eight one-line rows. The saving is not only
  // the count: each row is a term and its plainer wording, without the same
  // trailing sentence repeated twelve times.
  const groups = groupFlags(REAL_CASE);
  const terms = groups.find((g) => g.rule === 'R6');
  assert.equal(terms.flags.length, 12, 'every occurrence is still counted');
  assert.equal(terms.terms.length, 8, 'but shown once per term');
});

test('a term used four times says so', () => {
  const terms = groupFlags(REAL_CASE).find((g) => g.rule === 'R6').terms;
  const dcm = terms.find((t) => t.term === 'Dynamic Causal Modelling');
  assert.equal(dcm.count, 4);
  assert.equal(dcm.translation, 'generative modelling of dynamical systems');
});

test('the most-repeated term is listed first — it is the bigger decision', () => {
  const terms = groupFlags(REAL_CASE).find((g) => g.rule === 'R6').terms;
  assert.equal(terms[0].term, 'Dynamic Causal Modelling');
  assert.deepEqual(
    terms.map((t) => t.count),
    [...terms.map((t) => t.count)].sort((a, b) => b - a),
  );
});

test('wording is last, because it is the least costly to miss', () => {
  const groups = groupFlags(REAL_CASE);
  assert.equal(groups[groups.length - 1].rule, 'R6');
});

// --- ordering across every rule ------------------------------------------------

test('rules are ordered by what it costs to miss them', () => {
  const flags = [
    { sourceRule: 'R6', ref: 'a', detail: { term: 't', translation: 'p' } },
    { sourceRule: 'R9', ref: 'b' },
    { sourceRule: 'R2', ref: 'c' },
    { sourceRule: 'R4', ref: 'd' },
    { sourceRule: 'R3', ref: 'e' },
  ];
  assert.deepEqual(groupFlags(flags).map((g) => g.rule), ['R4', 'R3', 'R2', 'R9', 'R6']);
});

test('the advisory wrapper is never shown as the rule', () => {
  // "R8" is the mode, not the finding. Showing it says nothing about what is wrong.
  const groups = groupFlags(REAL_CASE);
  assert.ok(!groups.some((g) => g.rule === 'R8'), `got ${groups.map((g) => g.rule).join(', ')}`);
});

test('strict-mode flags, which have no sourceRule, group by their own rule', () => {
  const groups = groupFlags([{ rule: 'R2', ref: 'a' }, { rule: 'R1', ref: 'b' }]);
  assert.deepEqual(groups.map((g) => g.rule), ['R2', 'R1']);
});

test('every group gets a title a person would recognise', () => {
  for (const group of groupFlags(REAL_CASE)) {
    assert.ok(group.title.length > 3, `${group.rule} has no title`);
    assert.notEqual(group.title, group.rule, `${group.rule} is showing its code as its name`);
  }
});

test('an unknown rule still groups rather than being dropped', () => {
  const groups = groupFlags([{ rule: 'R99', ref: 'a' }, { sourceRule: 'R4', ref: 'b' }]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].rule, 'R4', 'known rules still sort ahead');
  assert.ok(groups.some((g) => g.rule === 'R99'));
});

// --- the details ---------------------------------------------------------------

test('a wording flag with no detail does not become an empty row', () => {
  const groups = groupFlags([{ sourceRule: 'R6', ref: 'a', message: 'something' }]);
  const terms = groups.find((g) => g.rule === 'R6');
  assert.equal(terms.flags.length, 1, 'the finding is kept');
  assert.equal(terms.terms.length, 0, 'but there is no term row to draw');
});

test('the advisory prefix is stripped, since the panel says it once', () => {
  assert.equal(stripAdvisory('advisory (R6): the actual message.'), 'the actual message.');
  assert.equal(stripAdvisory('advisory (R4): another one'), 'another one');
});

test('a message with no prefix is left exactly as it is', () => {
  assert.equal(stripAdvisory('a plain message'), 'a plain message');
  assert.equal(stripAdvisory(''), '');
  assert.equal(stripAdvisory(undefined), '');
});

test('no findings means no groups, not an empty shell', () => {
  assert.deepEqual(groupFlags([]), []);
  assert.deepEqual(groupFlags(), []);
});

test('grouping is stable — the same input gives the same order twice', () => {
  assert.deepEqual(
    groupFlags(REAL_CASE).map((g) => g.rule),
    groupFlags([...REAL_CASE].reverse()).map((g) => g.rule),
  );
});

// --- condensing a group into rows worth reading ---------------------------------
//
// From a real draft: six findings, of which two were word-for-word identical and
// all six ended with the same two sentences of advice. Most of the panel's
// height was the same words said over and over, which is how a panel stops being
// read at all.

import { condense } from './flags-grouping.js';

test('the same finding twice is one row carrying both refs', () => {
  const { items } = condense([
    { rule: 'R1', ref: 'cv.sections[0].entries[0].bullets[1]', message: 'this bullet cites "skill-bayesian", which was not offered.', severity: 'error' },
    { rule: 'R1', ref: 'cv.sections[1].entries[0].bullets[1]', message: 'this bullet cites "skill-bayesian", which was not offered.', severity: 'error' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].refs.length, 2);
});

test('different findings stay separate — folding is not summarising', () => {
  const { items } = condense([
    { rule: 'R1', ref: 'a', message: 'this bullet cites "skill-bayesian", which was not offered.', severity: 'error' },
    { rule: 'R1', ref: 'b', message: 'this line cites no evidence record at all.', severity: 'error' },
  ]);
  assert.equal(items.length, 2);
});

test('the advice every finding repeats is hoisted out and said once', () => {
  const tail = ' If you can evidence it, say so in the document\'s own words; if you cannot, this is a gap worth knowing about before you apply.';
  const { advice, items } = condense([
    { rule: 'R9', ref: 'requirements[0]', message: `the ad asks for "statistics" and the draft never mentions it.${tail}`, severity: 'warning' },
    { rule: 'R9', ref: 'requirements[3]', message: `the ad asks for "a PhD" and the draft never mentions it.${tail}`, severity: 'warning' },
  ]);
  assert.equal(advice, tail.trim());
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.doesNotMatch(item.text, /gap worth knowing/, 'the advice must not also stay on the row');
    assert.match(item.text, /never mentions it\.$/, 'and the row must still end at a sentence');
  }
});

test('a single finding keeps its whole message — there is nothing to share it with', () => {
  const message = 'the ad asks for "statistics" and the draft never mentions it. Say so in its own words.';
  const { advice, items } = condense([{ rule: 'R9', ref: 'a', message, severity: 'warning' }]);
  assert.equal(advice, '');
  assert.equal(items[0].text, message);
});

test('only whole sentences are hoisted, never half of one', () => {
  const { advice, items } = condense([
    { rule: 'R2', ref: 'a', message: 'the figure 40% appears in this bullet but in no record it cites', severity: 'warning' },
    { rule: 'R2', ref: 'b', message: 'the figure 12 appears in this bullet but in no record it cites', severity: 'warning' },
  ]);
  assert.equal(advice, '', 'a shared clause with no full stop is not advice');
  assert.equal(items.length, 2);
});

test('a short shared ending is left alone', () => {
  // "Fix it." repeated is not worth its own paragraph.
  const { advice } = condense([
    { rule: 'R2', ref: 'a', message: 'something is wrong here. Fix it.', severity: 'warning' },
    { rule: 'R2', ref: 'b', message: 'something else is wrong. Fix it.', severity: 'warning' },
  ]);
  assert.equal(advice, '');
});

test('one error among warnings makes the folded row an error', () => {
  const { items } = condense([
    { rule: 'R2', ref: 'a', message: 'the same problem, twice.', severity: 'warning' },
    { rule: 'R2', ref: 'b', message: 'the same problem, twice.', severity: 'error' },
  ]);
  assert.equal(items[0].severity, 'error');
});

test('the advisory prefix is gone before anything is compared', () => {
  const { items } = condense([
    { rule: 'R8', sourceRule: 'R2', ref: 'a', message: 'advisory (R2): the same text.', severity: 'warning' },
    { rule: 'R8', sourceRule: 'R2', ref: 'b', message: 'advisory (R2): the same text.', severity: 'warning' },
  ]);
  assert.equal(items.length, 1, 'otherwise identical findings fold only when the prefix happens to match');
  assert.equal(items[0].text, 'the same text.');
});

test('groupFlags attaches the condensed rows, so the view has nothing to compute', () => {
  const [group] = groupFlags([
    { rule: 'R1', ref: 'a', message: 'identical.', severity: 'error' },
    { rule: 'R1', ref: 'b', message: 'identical.', severity: 'error' },
  ]);
  assert.equal(group.items.length, 1);
  assert.equal(group.flags.length, 2, 'the raw findings stay available for the count');
});

test('condense never throws on the shapes a validator can produce', () => {
  for (const input of [[], [{}], [{ message: null }], [{ message: 'x' }, { message: 'x' }]]) {
    assert.doesNotThrow(() => condense(input));
  }
});
