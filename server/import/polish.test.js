// WHY these tests are the important ones in this folder: the polish button is
// the one feature in the app that asks a model to rewrite the source of truth,
// and the only thing standing between it and a fabricated CV is the check below.
// If it is wrong, nothing downstream catches it — every later check validates a
// document AGAINST these records, so a number added here becomes the truth the
// checker enforces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPolish, polishUserMessage, polishSystemPrompt } from './polish.js';

const records = [
  {
    id: 'role-analyst',
    kind: 'role',
    title: 'Data Analyst',
    org: 'An Agency',
    body: 'Wrote the SQL behind the annual report, and automated a step that took 3 days each quarter.',
  },
  {
    id: 'role-thin',
    kind: 'role',
    title: 'Research Assistant',
    org: 'A University',
    body: 'Did fieldwork and helped with the analysis.',
  },
  {
    id: 'pub-one',
    kind: 'publication',
    title: 'A paper',
    org: 'A Journal',
    body: 'Kimani, R. (2025). A paper. A Journal, 1(1), 1-10.',
  },
];

const suggest = (suggestions) => checkPolish({ suggestions }, records);

// --- the rule that matters ----------------------------------------------------

test('a rewrite that invents a figure is rejected, and the figure is named', () => {
  const { accepted, rejected } = suggest([
    {
      id: 'role-analyst',
      body: 'Cut a quarterly reporting step from 3 days to 20 minutes by automating the SQL behind the annual report.',
      why: 'led with the outcome',
    },
  ]);
  assert.deepEqual(accepted, []);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].problem, /"20"/);
  assert.match(rejected[0].problem, /cannot be added by a rewrite/);
});

test('a rewrite that drops a figure is rejected too — a tidy-up must not lose them', () => {
  const { accepted, rejected } = suggest([
    { id: 'role-analyst', body: 'Automated the quarterly reporting step and wrote the SQL behind the annual report.', why: 'shorter' },
  ]);
  assert.deepEqual(accepted, []);
  assert.match(rejected[0].problem, /drops "3"/);
});

test('a rewrite that keeps every figure and leads with the outcome is accepted', () => {
  const { accepted, rejected } = suggest([
    {
      id: 'role-analyst',
      body: 'Automated a quarterly reporting step that had taken 3 days, and wrote the SQL behind the annual report.',
      why: 'outcome first, duty-listing verb removed',
    },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].id, 'role-analyst');
  assert.match(accepted[0].before, /^Wrote the SQL/);
  assert.match(accepted[0].after, /^Automated/);
});

test('prose that has doubled in length is rejected, whatever its numbers say', () => {
  const { rejected } = suggest([
    {
      id: 'role-thin',
      body:
        'Led a comprehensive programme of field research, taking responsibility for data collection ' +
        'across the full season, and subsequently played a central role in the statistical analysis ' +
        'that followed, working closely with senior colleagues throughout.',
      why: 'expanded',
    },
  ]);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].problem, /longer than the record/);
});

test('a suggestion for a record that does not exist is rejected rather than created', () => {
  const { accepted, rejected } = suggest([{ id: 'role-invented', body: 'Something.', why: 'x' }]);
  assert.deepEqual(accepted, []);
  assert.match(rejected[0].problem, /no record with the id/);
});

// --- the honest alternative to inventing --------------------------------------

test('a thin record comes back with questions instead of padding', () => {
  const { accepted, rejected } = suggest([
    {
      id: 'role-thin',
      body: 'Ran fieldwork and the analysis that followed.',
      why: 'plainer, but this record needs facts more than it needs wording',
      asks: ['How many sites, and over how long?', 'What did the analysis find?'],
    },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(accepted[0].asks.length, 2);
});

test('a record returned unchanged and with nothing to ask is dropped as noise', () => {
  const { accepted, rejected } = suggest([
    { id: 'role-analyst', body: records[0].body, why: 'already fine' },
  ]);
  assert.deepEqual(accepted, []);
  assert.deepEqual(rejected, []);
});

test('an empty rewrite is rejected rather than blanking the record', () => {
  const { rejected } = suggest([{ id: 'role-analyst', body: '   ', why: 'x' }]);
  assert.match(rejected[0].problem, /empty/);
});

// --- shape --------------------------------------------------------------------

test('publications are never offered for rewriting — the body is a parsed citation', () => {
  const message = polishUserMessage(records);
  assert.doesNotMatch(message, /pub-one/);
  assert.match(message, /role-analyst/);
  assert.match(message, /role-thin/);
});

test('the prompt says the check exists, because a rejected suggestion helps nobody', () => {
  const prompt = polishSystemPrompt();
  assert.match(prompt, /rejected automatically/);
  assert.match(prompt, /You are not editing WHAT IT SAYS/);
});

test('nothing here throws on a malformed or empty reply', () => {
  for (const reply of [null, undefined, {}, { suggestions: null }, { suggestions: [null, {}] }]) {
    assert.doesNotThrow(() => checkPolish(reply, records), `threw on ${JSON.stringify(reply)}`);
  }
  assert.deepEqual(checkPolish({}, records).accepted, []);
});
