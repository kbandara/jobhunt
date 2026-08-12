import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../store.js';
import { parseProfile, loadEvidence } from './parse.js';
import { EXAMPLE_PROFILE_FILE, exampleMeta } from '../examples.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TAGS = exampleMeta().evidenceTags;

const real = () => parseProfile(readText(EXAMPLE_PROFILE_FILE), { allowedTags: TAGS });
const byId = (records, id) => records.find((r) => r.id === id);
const values = (record) => record.numbers.map((n) => n.value);

// ---------------------------------------------------------------------------
// The example profile. It is the fixture the whole suite leans on, and it is
// also the file the app offers as "load a worked example" — so these tests are
// checking the first thing a new person will click, not only the parser.
// ---------------------------------------------------------------------------

test('the example profile parses with zero errors', () => {
  const { errors } = real();
  assert.deepEqual(errors, [], errors.map((e) => e.message).join('\n'));
});

test('the example profile contains 21 records', () => {
  const { records } = real();
  assert.equal(records.length, 21);
});

test('every record has a unique id, a kind and evidence tags', () => {
  const { records } = real();
  const ids = new Set();
  for (const record of records) {
    assert.ok(record.id, `a record with no id: ${record.title}`);
    assert.ok(!ids.has(record.id), `duplicate id ${record.id}`);
    ids.add(record.id);
    assert.ok(record.kind, `${record.id} has no kind`);
    assert.ok(record.evidenceProfiles.length > 0, `${record.id} has no evidence tags`);
  }
});

test('kind counts match the section headings', () => {
  const counts = {};
  for (const record of real().records) counts[record.kind] = (counts[record.kind] ?? 0) + 1;
  assert.deepEqual(counts, {
    education: 2,
    project: 2,
    finding: 2,
    role: 3,
    publication: 6,
    skill: 3,
    award: 1,
    service: 2,
  });
});

test('spot-check edu-phd: education kind, open-ended dates, title and org split', () => {
  const rec = byId(real().records, 'edu-phd');
  assert.equal(rec.kind, 'education');
  assert.equal(rec.dates.start, '2021-03');
  assert.equal(rec.dates.end, null); // '..' open range means current
  assert.equal(rec.org, 'Riverina University');
  assert.equal(rec.title, 'PhD, Freshwater Ecology');
  assert.deepEqual(rec.evidenceProfiles, ['research', 'teaching']);
  assert.ok(rec.tags.includes('bayesian'));
  assert.equal(rec.isGap, false);
  assert.equal(rec.figuresReleasable, true);
});

test('spot-check edu-phd body carries the NOT-submitted wording verbatim', () => {
  // R4's regression case depends on this text existing and being ignored by the
  // validator in favour of profile-meta.json's structured booleans.
  const rec = byId(real().records, 'edu-phd');
  assert.match(rec.body, /has not been\nsubmitted|has not been submitted/i);
});

test('a record whose body says "not releasable" is figuresReleasable: false', () => {
  const { records } = real();
  assert.equal(byId(records, 'role-analyst').figuresReleasable, false);
  const notReleasable = records.filter((r) => !r.figuresReleasable).map((r) => r.id);
  assert.deepEqual(notReleasable, ['role-analyst']);
});

test('numbers are pulled out of the body', () => {
  const v = values(byId(real().records, 'finding-turnover'));
  assert.ok(v.includes(52), `expected 52 in ${v}`);
  assert.ok(v.includes(40), `expected 40 in ${v}`);
});

test('several numbers in one body are all found', () => {
  const v = values(byId(real().records, 'project-riverkit'));
  for (const n of [3, 240, 2, 15]) {
    assert.ok(v.includes(n), `expected ${n} in ${v}`);
  }
});

test('dates contribute years to the number pool, not months', () => {
  // The worked example lists years only for a 2019-02..2023-06 period.
  const rec = byId(real().records, 'role-analyst'); // dates: 2023-02 .. 2023-11
  const v = values(rec);
  assert.ok(v.includes(2023));
  assert.ok(!v.includes(11), 'a month must not become a claimable figure');
});

test('year-only date ranges parse', () => {
  const rec = byId(real().records, 'edu-bsc');
  assert.deepEqual(rec.dates, { start: '2016', end: '2020' });
});

// A publication happens on one date rather than over a range, and making people
// write "2025 .. 2025" to say so taught them the format was fussier than it is.
test('a single date is a point in time, not a parse error', () => {
  const rec = byId(real().records, 'pub-turnover');
  assert.deepEqual(rec.dates, { start: '2025', end: '2025' });
});

test('records with an empty body are valid', () => {
  const { records, errors } = parseProfile(
    ['## Awards', '', '### A Prize — An Institution', 'id: a1', 'dates: 2020', 'profiles: research', 'tags: x', ''].join('\n'),
    { allowedTags: TAGS },
  );
  assert.deepEqual(errors, []);
  assert.equal(records[0].body.trim(), '');
  assert.equal(records[0].title, 'A Prize');
  assert.equal(records[0].org, 'An Institution');
});

test('a heading with no em dash leaves org null', () => {
  const { records } = parseProfile(
    ['## Awards', '', '### Some Award', 'id: a1', 'dates: 2020 .. 2020', 'lanes: gov', 'tags: x', '', 'body'].join('\n'),
  );
  assert.equal(records[0].title, 'Some Award');
  assert.equal(records[0].org, null);
});

test('records are returned in document order with their source line', () => {
  const { records } = real();
  assert.equal(records[0].id, 'edu-phd');
  assert.equal(records.at(-1).id, 'service-committee');
  const lines = records.map((r) => r.sourceLine);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

test('loadEvidence reads the file through store.readText', () => {
  const records = loadEvidence(EXAMPLE_PROFILE_FILE, { allowedTags: TAGS });
  assert.equal(records.length, 21);
  assert.equal(records[0].id, 'edu-phd');
});

// ---------------------------------------------------------------------------
// Malformed fixtures. This file is hand-edited: error quality IS the feature,
// so every error must name the line number and what was expected.
// ---------------------------------------------------------------------------

const HEAD = ['## Roles', ''].join('\n');

const record = (over = {}) => {
  const meta = {
    id: 'role-x',
    dates: '2020-01 .. 2021-01',
    lanes: 'gov',
    tags: 'sql',
    ...over,
  };
  return [
    '### A Role — An Org',
    ...Object.entries(meta)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}: ${v}`),
    '',
    '- did a thing',
  ].join('\n');
};

test('missing id is fatal and names the line', () => {
  const { errors } = parseProfile(`${HEAD}\n${record({ id: null })}`);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 3);
  assert.match(errors[0].message, /line 3/);
  assert.match(errors[0].message, /id:/);
  assert.match(errors[0].message, /missing/i);
});

test('duplicate id is fatal and names both lines', () => {
  const { errors } = parseProfile(`${HEAD}\n${record()}\n\n${record()}`);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /duplicate/i);
  assert.match(errors[0].message, /role-x/);
  assert.match(errors[0].message, /line 12/); // the second record's id line
  assert.match(errors[0].message, /line 4/); // ...and the first
});

// The tag vocabulary is the person's own, declared in profile-meta.json. Given
// one, a typo is caught; given none, anything parses — refusing somebody's first
// record because they invented a sensible word for it would be the wrong way
// round, and there is no canonical list to check against.
test('an unknown evidence tag is fatal when a vocabulary has been declared', () => {
  const { errors } = parseProfile(`${HEAD}\n${record({ lanes: 'gov, goverment' })}`, {
    allowedTags: ['gov', 'research'],
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 6);
  assert.match(errors[0].message, /goverment/);
  assert.match(errors[0].message, /gov, research/);
});

test('with no declared vocabulary, any tag parses', () => {
  const { records, errors } = parseProfile(`${HEAD}\n${record({ lanes: 'archaeology' })}`);
  assert.deepEqual(errors, []);
  assert.deepEqual(records[0].evidenceProfiles, ['archaeology']);
});

// Both spellings parse, because master-profile.md is the person's own file and
// an app update must never need to rewrite it. `profiles:` is what new records
// should say; `lanes:` is the older spelling and must keep working forever.
test('a record may say "profiles:" instead of "lanes:"', () => {
  const { records, errors } = parseProfile(
    `${HEAD}\n${record({ lanes: null, profiles: 'gov, industry' })}`,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(records[0].evidenceProfiles, ['gov', 'industry']);
});

test('the two spellings produce identical records', () => {
  const viaLanes = parseProfile(`${HEAD}\n${record({ lanes: 'gov' })}`).records[0];
  const viaProfiles = parseProfile(`${HEAD}\n${record({ lanes: null, profiles: 'gov' })}`).records[0];
  assert.deepEqual(viaLanes, viaProfiles);
});

test('saying both is an error rather than a silent winner', () => {
  const { errors } = parseProfile(
    `${HEAD}\n${record({ lanes: 'gov', profiles: 'research' })}`,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /both "profiles:" and "lanes:"/);
});

test('a record with neither spelling names "profiles:" as the one to add', () => {
  const { errors } = parseProfile(`${HEAD}\n${record({ lanes: null })}`);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /profiles:/);
  assert.match(errors[0].message, /lanes:/); // still tells you the old one works
});

test('missing metadata line is fatal and says which key is missing', () => {
  const { errors } = parseProfile(`${HEAD}\n${record({ dates: null })}`);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /dates:/);
  assert.match(errors[0].message, /line 3/); // the record heading
});

test('all missing metadata keys are reported, not just the first', () => {
  const { errors } = parseProfile(
    `${HEAD}\n### A Role — An Org\nid: role-x\n\n- body`,
  );
  const joined = errors.map((e) => e.message).join(' ');
  assert.match(joined, /dates:/);
  assert.match(joined, /lanes:/);
  assert.match(joined, /tags:/);
});

test('a mistyped metadata key is caught rather than silently ignored', () => {
  const { errors } = parseProfile(`${HEAD}\n${record()}`.replace('tags:', 'tag:'));
  const joined = errors.map((e) => e.message).join('\n');
  assert.match(joined, /tag/);
  assert.match(joined, /line 7/);
});

test('a body line before the blank line is reported as a metadata error', () => {
  const bad = ['## Roles', '', '### A Role — An Org', 'id: role-x', '- oops, no blank line', ''].join('\n');
  const { errors } = parseProfile(bad);
  assert.match(errors[0].message, /line 5/);
  assert.match(errors[0].message, /metadata/i);
});

test('malformed dates are fatal and show the expected format', () => {
  const { errors } = parseProfile(`${HEAD}\n${record({ dates: '2020 to 2021' })}`);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 5);
  assert.match(errors[0].message, /YYYY-MM/);
});

test('an unknown ## section heading is fatal', () => {
  const { errors } = parseProfile('## Hobbies\n\n### A Thing\nid: x\ndates: 2020 ..\nlanes: gov\ntags: y\n\nbody');
  assert.match(errors[0].message, /line 1/);
  assert.match(errors[0].message, /Hobbies/);
  assert.match(errors[0].message, /Education, Projects, Findings, Roles/);
});

test('a record before any section heading is fatal', () => {
  const { errors } = parseProfile('### Orphan — Org\nid: x\ndates: 2020 ..\nlanes: gov\ntags: y\n\nbody');
  assert.match(errors[0].message, /line 1/);
  assert.match(errors[0].message, /##/);
});

test('errors accumulate across records instead of stopping at the first', () => {
  const { errors } = parseProfile(
    `${HEAD}\n${record({ id: null })}\n\n${record({ id: 'role-y', lanes: 'nope' })}`,
    { allowedTags: ['gov'] },
  );
  assert.equal(errors.length, 2);
});

test('FILL: anywhere in a record marks it as a gap', () => {
  const { records } = parseProfile(`${HEAD}\n${record()}\n- FILL: a quantified outcome`);
  assert.equal(records[0].isGap, true);
});

test('FILL: in the heading also marks a gap', () => {
  const src = `${HEAD}\n${record()}`.replace('### A Role — An Org', '### FILL: a role — An Org');
  const { records } = parseProfile(src);
  assert.equal(records[0].isGap, true);
});

test('loadEvidence throws ONE readable error listing every parse problem', () => {
  const missing = path.join(here, 'does-not-exist.md');
  assert.throws(() => loadEvidence(missing), /ENOENT|no such file/);

  // And with a real parse failure, every problem appears in one message.
  const tmp = path.join(here, 'fixture-broken.md');
  fs.writeFileSync(
    tmp,
    `${HEAD}\n${record({ id: null })}\n\n${record({ id: 'role-y', lanes: 'nope' })}`,
    'utf8',
  );
  try {
    assert.throws(
      () => loadEvidence(tmp, { allowedTags: ['gov'] }),
      (err) => {
        assert.match(err.message, /2 problems?/i);
        assert.match(err.message, /id:/);
        assert.match(err.message, /nope/);
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
