import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../store.js';
import { exampleEvidence } from '../examples.js';
import { selectEvidence } from './select-evidence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = (id) => readJson(path.join(here, 'profiles', `${id}.json`));

const NOW = new Date('2026-08-02T00:00:00Z');

/** A tiny fixed evidence set; every test states exactly what it depends on. */
function rec({ id, kind = 'role', tags = [], body = '', profiles = ['industry'], dates, ...rest }) {
  return {
    id,
    kind,
    title: id,
    org: 'Org',
    dates: dates ?? { start: '2020-01', end: '2021-01' },
    evidenceProfiles: profiles,
    tags,
    body,
    numbers: [],
    isGap: false,
    figuresReleasable: true,
    sourceLine: 1,
    ...rest,
  };
}

const JD = {
  title: 'Data Scientist',
  skills: ['python', 'sql'],
  requirements: [
    { text: 'Experience building fraud analytics in SQL', kind: 'experience', mustHave: true },
    { text: 'Strong Python and stakeholder communication', kind: 'skill', mustHave: true },
  ],
};

const ids = (result) => result.selected.map((r) => r.id);

/** Is this record inside the set of `profiles:` tags the profile may draw from? */
const drawsFrom = (record, profileId) => {
  const declared = profile(profileId).evidenceProfiles;
  return declared.includes('*') || record.evidenceProfiles.some((tag) => declared.includes(tag));
};

/**
 * A stock profile narrowed to specific evidence tags. The shipped profiles all
 * say `["*"]` — every record, whatever it is tagged with — because an evidence
 * vocabulary is something each person invents, so a shipped profile naming
 * particular tags would match nothing in somebody else's profile. Narrowing is
 * still a supported thing to do, so the tests that are about narrowing say so
 * explicitly instead of relying on a stock file to be narrow for them.
 */
const narrowed = (id, tags) => ({ ...profile(id), evidenceProfiles: tags });

test('gaps are excluded from selection', () => {
  const evidence = [
    rec({ id: 'good', tags: ['python'] }),
    rec({ id: 'gappy', tags: ['python'], isGap: true, body: 'FILL: a quantified outcome' }),
  ];
  const result = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.deepEqual(ids(result), ['good']);
  assert.deepEqual(result.offeredIds, ['good']);
});

test('records outside the profile are excluded', () => {
  const evidence = [
    rec({ id: 'in-profile', tags: ['python'], profiles: ['industry'] }),
    rec({ id: 'out-of-profile', tags: ['python'], profiles: ['research'] }),
  ];
  const result = selectEvidence({
    evidence,
    jdJson: JD,
    profile: 'industry',
    profileConfig: narrowed('industry', ['industry']),
    now: NOW,
  });
  assert.deepEqual(ids(result), ['in-profile']);
});

// The stock profiles are the other way round, and that is the behaviour a new
// person depends on: their records are tagged with words they chose, and a
// profile that named tags would silently match none of them.
test('a profile declaring "*" reaches every record whatever its tags', () => {
  const evidence = [
    rec({ id: 'industry-tagged', tags: ['python'], profiles: ['industry'] }),
    rec({ id: 'invented-tag', tags: ['python'], profiles: ['underwater-basket-weaving'] }),
  ];
  const result = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.deepEqual(ids(result).sort(), ['industry-tagged', 'invented-tag']);
});

test('tag overlap with the job outranks body term overlap', () => {
  const evidence = [
    rec({ id: 'tagged', tags: ['python', 'sql'], body: 'Nothing else in common.' }),
    rec({ id: 'prose', tags: [], body: 'Experience building fraud analytics with stakeholder communication.' }),
  ];
  const result = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.equal(ids(result)[0], 'tagged');
});

test('recency breaks a tie between otherwise identical records', () => {
  const evidence = [
    rec({ id: 'a-old', tags: ['python'], dates: { start: '2014-01', end: '2015-01' } }),
    rec({ id: 'b-current', tags: ['python'], dates: { start: '2024-01', end: null } }),
  ];
  const result = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.deepEqual(ids(result), ['b-current', 'a-old']);
});

test('a null end date is treated as current', () => {
  const evidence = [
    rec({ id: 'a-ended-now', tags: ['python'], dates: { start: '2020-01', end: '2026-08' } }),
    rec({ id: 'b-open', tags: ['python'], dates: { start: '2020-01', end: null } }),
  ];
  const result = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  // Same recency, so the tie-break by id decides — not the missing date.
  assert.deepEqual(ids(result), ['a-ended-now', 'b-open']);
});

test('ties are broken deterministically by id, not by input order', () => {
  const make = () => [
    rec({ id: 'zebra', tags: ['python'] }),
    rec({ id: 'alpha', tags: ['python'] }),
    rec({ id: 'mango', tags: ['python'] }),
  ];
  const forwards = selectEvidence({ evidence: make(), jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  const backwards = selectEvidence({ evidence: make().reverse(), jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.deepEqual(ids(forwards), ['alpha', 'mango', 'zebra']);
  assert.deepEqual(ids(forwards), ids(backwards));
});

test('selection is stable across repeated runs', () => {
  const evidence = exampleEvidence();
  const a = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  const b = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.deepEqual(a.offeredIds, b.offeredIds);
});

test('per-kind caps are applied', () => {
  const evidence = [];
  for (let i = 0; i < 9; i += 1) evidence.push(rec({ id: `role-${i}`, kind: 'role', tags: ['python'] }));
  for (let i = 0; i < 7; i += 1) evidence.push(rec({ id: `finding-${i}`, kind: 'finding', tags: ['python'] }));
  for (let i = 0; i < 6; i += 1) evidence.push(rec({ id: `skill-${i}`, kind: 'skill', tags: ['python'] }));
  for (let i = 0; i < 5; i += 1) evidence.push(rec({ id: `award-${i}`, kind: 'award', tags: ['python'] }));
  for (let i = 0; i < 4; i += 1) evidence.push(rec({ id: `service-${i}`, kind: 'service', tags: ['python'] }));

  const { selected } = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  const count = (kind) => selected.filter((r) => r.kind === kind).length;
  assert.equal(count('role'), 6);
  assert.equal(count('finding'), 4);
  assert.equal(count('skill'), 4);
  assert.equal(count('award'), 2);
  assert.equal(count('service'), 2);
});

test('education and projects are never capped', () => {
  const evidence = [];
  for (let i = 0; i < 5; i += 1) evidence.push(rec({ id: `edu-${i}`, kind: 'education', tags: ['python'] }));
  for (let i = 0; i < 5; i += 1) evidence.push(rec({ id: `proj-${i}`, kind: 'project', tags: ['python'] }));
  const { selected } = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.equal(selected.filter((r) => r.kind === 'education').length, 5);
  assert.equal(selected.filter((r) => r.kind === 'project').length, 5);
});

test('the publication cap follows the profile policy', () => {
  const evidence = [];
  for (let i = 0; i < 11; i += 1) {
    evidence.push(
      rec({ id: `pub-${String(i).padStart(2, '0')}`, kind: 'publication', tags: ['python'], profiles: ['industry-research', 'research', 'public-sector', 'industry'] }),
    );
  }
  const pubs = (profileId) =>
    selectEvidence({ evidence, jdJson: JD, profile: profileId, profileConfig: profile(profileId), now: NOW }).selected.filter(
      (r) => r.kind === 'publication',
    ).length;

  assert.equal(pubs('public-sector'), 0, 'the public-sector profile omits publications');
  assert.equal(pubs('research'), 11, 'research takes all of them');
  assert.equal(pubs('industry-research'), 5, 'industry-research takes a selected few');
  assert.equal(pubs('industry'), 2, 'industry takes a couple, one line each');
});

test('records are returned WHOLE, never fragments', () => {
  const original = rec({ id: 'whole', tags: ['python'], body: 'Ran 20 experiments.', numbers: [{ raw: '20', value: 20, unit: null, index: 4 }] });
  const { selected } = selectEvidence({
    evidence: [original],
    jdJson: JD,
    profile: 'industry',
    profileConfig: profile('industry'),
    now: NOW,
  });
  assert.deepEqual(selected[0], original);
  assert.equal(selected[0], original, 'the same object, so no field can be lost in transit');
});

test('offeredIds always matches the selected records', () => {
  const evidence = exampleEvidence();
  for (const profileId of ['industry-research', 'research', 'public-sector', 'industry']) {
    const result = selectEvidence({ evidence, jdJson: JD, profile: profileId, profileConfig: profile(profileId), now: NOW });
    assert.deepEqual(result.offeredIds, result.selected.map((r) => r.id));
    assert.equal(new Set(result.offeredIds).size, result.offeredIds.length, 'no duplicates');
  }
});

test('kind priority from the profile orders the offered set', () => {
  const evidence = [
    rec({ id: 'a-role', kind: 'role', tags: ['python'], profiles: ['public-sector', 'industry-research'] }),
    rec({ id: 'b-finding', kind: 'finding', tags: ['python'], profiles: ['public-sector', 'industry-research'] }),
  ];
  const publicSector = selectEvidence({ evidence, jdJson: JD, profile: 'public-sector', profileConfig: profile('public-sector'), now: NOW });
  assert.deepEqual(ids(publicSector), ['a-role', 'b-finding'], 'public-sector leads with delivery');

  // The research profile weights findings and roles equally, so priority is set
  // explicitly here rather than borrowed from whichever stock file currently
  // happens to disagree with public-sector.
  const findingsFirst = selectEvidence({
    evidence,
    jdJson: JD,
    profile: 'research',
    profileConfig: { ...profile('research'), kindPriority: { finding: 6, role: 1 } },
    now: NOW,
  });
  assert.deepEqual(ids(findingsFirst), ['b-finding', 'a-role'], 'a profile that leads with findings does');
});

test('a whole real profile selects a sane pack', () => {
  const evidence = exampleEvidence();
  const jd = {
    title: 'Research Fellow, Freshwater Ecology',
    skills: ['r', 'bayesian', 'monitoring', 'statistics'],
    requirements: [
      { text: 'Designing and running long-term monitoring programmes', kind: 'experience', mustHave: true },
      { text: 'Strong R and hierarchical modelling background', kind: 'skill', mustHave: true },
    ],
  };
  const { selected, offeredIds } = selectEvidence({
    evidence,
    jdJson: jd,
    profile: 'industry-research',
    profileConfig: profile('industry-research'),
    now: NOW,
  });
  assert.ok(offeredIds.includes('project-riverkit'), 'the strongest work must be offered (defect #1)');
  // Records do not have to carry the profile's own tag: the profile says which
  // `profiles:` tags it draws from, and the stock ones draw on all of them.
  assert.ok(selected.every((r) => drawsFrom(r, 'industry-research')));
  assert.ok(selected.every((r) => !r.isGap));
  assert.ok(selected.filter((r) => r.kind === 'publication').length <= 5);
  assert.ok(selected.filter((r) => r.kind === 'role').length <= 6);
});

test('an empty or minimal job description still returns a usable pack', () => {
  const evidence = exampleEvidence();
  for (const jd of [{}, { requirements: [] }, { skills: [] }, null]) {
    const result = selectEvidence({ evidence, jdJson: jd, profile: 'public-sector', profileConfig: profile('public-sector'), now: NOW });
    assert.ok(result.selected.length > 0);
    assert.ok(result.selected.every((r) => drawsFrom(r, 'public-sector')));
  }
});

// --- evidenceProfiles: what makes a new profile work at all ------------------------

test('a profile draws from every tag in its evidenceProfiles, not just its own id', () => {
  const evidence = [
    rec({ id: 'public-only', tags: ['python'], profiles: ['public-sector'] }),
    rec({ id: 'industry-only', tags: ['python'], profiles: ['industry'] }),
    rec({ id: 'research-only', tags: ['python'], profiles: ['research'] }),
  ];
  const config = narrowed('public-sector', ['public-sector', 'industry']);
  const result = selectEvidence({ evidence, jdJson: JD, profile: 'public-sector', profileConfig: config, now: NOW });
  assert.deepEqual(ids(result).sort(), ['industry-only', 'public-only']);
});

test('a new profile finds records even though nothing in the profile carries its tag', () => {
  // This is the whole point: a profile whose id is not an evidence tag anybody
  // has used would otherwise offer an empty pack, and an empty pack produces a
  // CV with nothing on it and no visible reason why.
  const evidence = exampleEvidence();
  for (const profileId of ['teaching', 'research', 'industry-research', 'general']) {
    const result = selectEvidence({ evidence, jdJson: JD, profile: profileId, profileConfig: profile(profileId), now: NOW });
    assert.ok(result.selected.length > 5, `${profileId} offered only ${result.selected.length} records`);
    assert.ok(result.selected.every((r) => !r.isGap));
    assert.ok(
      result.selected.every((r) => drawsFrom(r, profileId)),
      `${profileId} offered a record outside its evidenceProfiles`,
    );
  }
});

test('a profile config with no evidenceProfiles falls back to its own id', () => {
  const evidence = [
    rec({ id: 'in-profile', tags: ['python'], profiles: ['industry'] }),
    rec({ id: 'out-of-profile', tags: ['python'], profiles: ['public-sector'] }),
  ];
  const bare = { ...profile('industry'), evidenceProfiles: undefined };
  const result = selectEvidence({ evidence, jdJson: JD, profile: 'industry', profileConfig: bare, now: NOW });
  assert.deepEqual(ids(result), ['in-profile']);
});

// --- domain_vocabulary: the ad's own technical words -------------------------

test("the advertisement's own vocabulary moves a record up the ranking", () => {
  const evidence = [
    rec({ id: 'a-sql', tags: ['sql'] }),
    rec({ id: 'b-pytorch', tags: ['pytorch'] }),
  ];
  const jd = { title: 'Applied Scientist', skills: [], requirements: [] };

  const silent = selectEvidence({ evidence, jdJson: jd, profile: 'industry', profileConfig: profile('industry'), now: NOW });
  assert.deepEqual(ids(silent), ['a-sql', 'b-pytorch'], 'nothing to go on: the id tie-break decides');

  const spoken = selectEvidence({
    evidence,
    jdJson: { ...jd, domain_vocabulary: ['PyTorch'] },
    profile: 'industry',
    profileConfig: profile('industry'),
    now: NOW,
  });
  assert.deepEqual(ids(spoken), ['b-pytorch', 'a-sql']);
});

test('a term in domain_vocabulary counts for the same as one in skills', () => {
  const evidence = [rec({ id: 'a-sql', tags: ['sql'] }), rec({ id: 'b-pytorch', tags: ['pytorch'] })];
  const asSkill = selectEvidence({
    evidence,
    jdJson: { skills: ['PyTorch'], requirements: [] },
    profile: 'industry',
    profileConfig: profile('industry'),
    now: NOW,
  });
  const asVocabulary = selectEvidence({
    evidence,
    jdJson: { skills: [], requirements: [], domain_vocabulary: ['PyTorch'] },
    profile: 'industry',
    profileConfig: profile('industry'),
    now: NOW,
  });
  assert.deepEqual(ids(asVocabulary), ids(asSkill));
});

test('the ad decides which record leads, not the profile', () => {
  const evidence = exampleEvidence();
  const teachingAd = {
    title: 'Lecturer, Ecological Statistics',
    skills: ['teaching', 'r', 'statistics'],
    domain_vocabulary: ['undergraduate', 'statistics'],
    requirements: [{ text: 'Teaching statistics to undergraduates', kind: 'experience', must_have: true }],
  };
  const reportingAd = {
    title: 'Data Analyst, Reporting',
    skills: ['sql', 'reporting'],
    domain_vocabulary: [],
    requirements: [{ text: 'Producing annual reports from a monitoring database in SQL', kind: 'experience', must_have: true }],
  };
  const pack = (jd) => selectEvidence({ evidence, jdJson: jd, profile: 'industry', profileConfig: profile('industry'), now: NOW });

  const teaching = pack(teachingAd);
  assert.ok(teaching.offeredIds.includes('role-tutor'), 'the tutoring role must be offered');
  assert.equal(ids(teaching)[0], 'role-tutor', 'and it should lead for this ad');

  const reporting = pack(reportingAd);
  assert.notEqual(ids(reporting)[0], 'role-tutor', 'an ad about neither must not lead with it');
  assert.equal(ids(reporting)[0], 'role-analyst', 'the reporting role leads instead');
});

test('requirements given as plain strings are handled', () => {
  const evidence = [
    rec({ id: 'a', tags: ['sql'], body: 'fraud analytics' }),
    rec({ id: 'b', tags: [], body: 'unrelated' }),
  ];
  const result = selectEvidence({
    evidence,
    jdJson: { skills: ['sql'], requirements: ['Experience with fraud analytics in SQL'] },
    profile: 'industry',
    profileConfig: profile('industry'),
    now: NOW,
  });
  assert.equal(ids(result)[0], 'a');
});
