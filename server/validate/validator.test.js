// The honesty matrix, written before validator.js existed: one case per rule,
// each naming the failure it exists to prevent.
// In the previous build the validator was the one module written without tests,
// and that is exactly where the content-damaging bug shipped: a substring check
// read "has NOT been submitted" as permission to claim "submitted", and put a
// false statement on a real CV. Case 9 is that bug, pinned down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers } from '../profile/numbers.js';
import { validate, terminologyContext } from './validator.js';

// --- fixtures --------------------------------------------------------------

/** Build an evidence record the way parse.js builds one (body + date years). */
function rec({ id, body = '', dates = { start: '2020-01', end: '2021-01' }, ...rest }) {
  const datesRaw = `${dates.start ?? ''} .. ${dates.end ?? ''}`;
  return {
    id,
    kind: 'role',
    title: 'A Role',
    org: 'An Org',
    dates,
    profiles: ['industry-research', 'research', 'public-sector', 'industry'],
    tags: [],
    body,
    numbers: [
      ...extractNumbers(body),
      ...extractNumbers(datesRaw).filter((n) => /^\d{4}$/.test(n.raw)),
    ],
    isGap: false,
    figuresReleasable: true,
    sourceLine: 1,
    ...rest,
  };
}

/** profile-meta.json's structured booleans — R4's ground truth (D006). */
// R4 builds its "Dr <you>" and "<you>, PhD" patterns from this name, because a
// profile legitimately names supervisors and co-authors who really do hold
// doctorates. No name, no check — a validator that guesses whose doctorate is
// being claimed is worse than one that stays quiet.
const META = {
  name: 'Rosa Kimani',
  qualifications: {
    phd: { label: 'PhD', status: 'in_progress', expectedSubmission: '2027-03', submitted: false, awarded: false },
  },
};

// The real edu-phd body: it contains the word "submitted" inside a negation.
const PHD_BODY = `Thesis: the neural basis of conscious visual perception.

**In progress. Expected submission October 2026.** The thesis has NOT been
submitted and the degree has NOT been awarded.`;

const PHD = rec({ id: 'edu-phd', kind: 'education', body: PHD_BODY, dates: { start: '2022-05', end: null } });

const bullet = (text, ids) => ({ text, evidence_ids: ids });

/** Run the validator over a one-section CV made of `bullets`. */
function checkCv({ bullets, evidence, offeredIds, profile = 'industry-research', summary, profileMeta = META, ...rest }) {
  const ids = offeredIds ?? evidence.map((r) => r.id);
  return validate({
    artifactKind: 'cv',
    artifact: {
      summary: summary ?? {
        text: 'Computational scientist moving into model evaluation.',
        evidence_ids: [ids[0]],
      },
      sections: [
        { heading: 'Experience', entries: [{ title: 'A Role', org: 'An Org', dates: '2020 – 2021', bullets }] },
      ],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ids,
    evidence,
    profile,
    profileMeta,
    mode: 'strict',
    ...rest,
  });
}

const rules = (items) => items.map((i) => i.rule);
const has = (items, rule) => items.some((i) => i.rule === rule);
const find = (items, rule) => items.filter((i) => i.rule === rule);

// --- Appendix A ------------------------------------------------------------

// 1 | Bullet with no evidenceIds | R1 error
test('A1: a bullet with no evidence ids is an R1 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = checkCv({ evidence, bullets: [bullet('Built an evaluation platform.', [])] });
  assert.ok(has(errors, 'R1'), `expected R1, got ${rules(errors)}`);
  assert.equal(find(errors, 'R1')[0].ref, 'cv.sections[0].entries[0].bullets[0]');
});

// 2 | Bullet cites ID not in offered set | R1 error
test('A2: citing an id that was never offered is an R1 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = checkCv({
    evidence,
    offeredIds: ['r1'],
    bullets: [bullet('Built an evaluation platform.', ['r-not-offered'])],
  });
  assert.ok(has(errors, 'R1'));
  assert.match(find(errors, 'R1')[0].message, /r-not-offered/);
});

// 3 | "improved accuracy by 34%" — 34 in no cited record | R2 error
test('A3: a number in no cited record is an R2 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = checkCv({ evidence, bullets: [bullet('Improved accuracy by 34%.', ['r1'])] });
  assert.ok(has(errors, 'R2'), `expected R2, got ${rules(errors)}`);
  assert.match(find(errors, 'R2')[0].message, /34/);
});

// 4 | "20 experiments" — 20 in cited record | pass
test('A4: a number present in a cited record passes', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments at $0 API spend.' })];
  const { errors, warnings } = checkCv({ evidence, bullets: [bullet('Ran 20 experiments.', ['r1'])] });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter((w) => w.rule === 'R2'), []);
});

// 5 | "2,500 postings" vs record "2500" | pass (normalization)
test('A5: comma thousands normalize against a bare record number', () => {
  const evidence = [rec({ id: 'r1', body: 'Polls 2500 postings per refresh.' })];
  const { errors } = checkCv({ evidence, bullets: [bullet('Polled 2,500 postings per refresh.', ['r1'])] });
  assert.deepEqual(errors, []);
});

// 6 | Bullet says "4" where cited records contain 20 and 16 | R2 warning (derived)
test('A6: a difference of two cited numbers is a warning, not an error', () => {
  const evidence = [
    rec({ id: 'r1', body: 'Ran 20 experiments.' }),
    rec({ id: 'r2', body: 'Produced 16 numbered findings.' }),
  ];
  const { errors, warnings } = checkCv({
    evidence,
    bullets: [bullet('Closed 4 of the open questions.', ['r1', 'r2'])],
  });
  assert.deepEqual(errors, []);
  assert.ok(has(warnings, 'R2'));
  assert.match(find(warnings, 'R2')[0].message, /derived/i);
});

// 7 | "one honest difference" / "one of those findings" | pass — NEVER flagged
test('A7: number-words are never flagged (D012)', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  for (const text of [
    'Found one honest difference between the models.',
    'Presented one of those findings to the group.',
    'Two to four sentences of summary; twelve constructs considered.',
  ]) {
    const { errors, warnings } = checkCv({ evidence, bullets: [bullet(text, ['r1'])] });
    assert.deepEqual(errors, [], `${text} -> ${JSON.stringify(errors)}`);
    assert.deepEqual(warnings.filter((w) => w.rule === 'R2'), [], text);
  }
});

// 8 | "2019–2023" range, both years in record dates | pass; year missing → error
test('A8: a year range whose endpoints are both in the record dates passes', () => {
  const evidence = [rec({ id: 'r1', body: 'Analytics work.', dates: { start: '2019-02', end: '2023-06' } })];
  const { errors } = checkCv({ evidence, bullets: [bullet('Led the programme 2019–2023.', ['r1'])] });
  assert.deepEqual(errors, []);
});

test('A8b: a year the record does not contain is an R2 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Analytics work.', dates: { start: '2019-02', end: '2023-06' } })];
  const { errors } = checkCv({ evidence, bullets: [bullet('Led the programme 2019–2025.', ['r1'])] });
  assert.ok(has(errors, 'R2'));
  assert.match(find(errors, 'R2')[0].message, /2025/);
});

// 9 | THE REGRESSION CASE
test('A9: "Submitted PhD thesis" errors even though the record says "has NOT been submitted"', () => {
  const { errors } = checkCv({
    evidence: [PHD],
    bullets: [bullet('Submitted PhD thesis in computational neuroscience.', ['edu-phd'])],
  });
  assert.ok(has(errors, 'R4'), `expected R4, got ${rules(errors)}`);
  const r4 = find(errors, 'R4')[0];
  assert.match(r4.message, /not been submitted|has not been submitted|submitted: false/i);
  // And the reason must be the structured fact, not the record's prose.
  assert.match(r4.message, /profile-meta|expected submission|October 2026/i);
});

test('A9b: the same claim in a summary or a cover-letter paragraph also errors', () => {
  const { errors } = checkCv({
    evidence: [PHD],
    summary: { text: 'PhD submitted in 2026; now moving into evaluation work.', evidence_ids: ['edu-phd'] },
    bullets: [bullet('Built Bayesian measurement models.', ['edu-phd'])],
  });
  assert.ok(has(errors, 'R4'));

  const letter = validate({
    artifactKind: 'cover-letter',
    artifact: {
      paragraphs: [{ text: 'My doctorate was awarded last year.', evidence_ids: ['edu-phd'] }],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['edu-phd'],
    evidence: [PHD],
    profile: 'industry-research',
    profileMeta: META,
    mode: 'strict',
  });
  assert.ok(has(letter.errors, 'R4'));
});

test('A9c: "completed" only triggers R4 near a qualification word', () => {
  const evidence = [PHD, rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const innocent = checkCv({
    evidence,
    bullets: [bullet('Completed 20 experiments on open-weight models.', ['r1'])],
  });
  assert.ok(!has(innocent.errors, 'R4'), 'a plain "completed" must not be a qualification claim');

  const guilty = checkCv({
    evidence,
    bullets: [bullet('Completed a PhD in computational neuroscience.', ['edu-phd'])],
  });
  assert.ok(has(guilty.errors, 'R4'));
});

test('A9d: a true award claim is not collateral damage', () => {
  // "Awarded" is a qualification trigger, but this is a real, unrelated award.
  const award = rec({
    id: 'award-acns',
    kind: 'award',
    body: 'AU$500 award for a high-ranking conference abstract.',
  });
  const { errors } = checkCv({
    evidence: [award],
    bullets: [bullet('Awarded AU$500 for a high-ranking conference abstract.', ['award-acns'])],
  });
  assert.deepEqual(errors, [], `a genuine award must survive R4: ${JSON.stringify(errors)}`);
});

test('A9e: a scholarship awarded under the PhD entry is not a degree claim', () => {
  // The real profile lists award-rtp and award-studentship against the doctorate.
  const award = rec({ id: 'award-rtp', kind: 'award', body: 'Competitive Commonwealth scholarship funding doctoral research.' });
  const { errors } = validate({
    artifactKind: 'cv',
    artifact: {
      summary: { text: 'Computational scientist.', evidence_ids: ['award-rtp'] },
      sections: [
        {
          heading: 'Education',
          entries: [
            {
              title: 'PhD, Computational Neuroscience',
              org: 'University of Melbourne',
              dates: '2022 – present',
              bullets: [bullet('Awarded a Research Training Program Scholarship.', ['award-rtp'])],
            },
          ],
        },
      ],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['award-rtp'],
    evidence: [award],
    profile: 'research',
    profileMeta: META,
    mode: 'strict',
  });
  assert.deepEqual(errors, [], `a real scholarship must survive R4: ${JSON.stringify(errors)}`);
});

test('A9f: a bare "Submitted" under a PhD heading is still caught', () => {
  // The bullet alone says nothing about a degree — the entry heading does.
  const { errors } = validate({
    artifactKind: 'cv',
    artifact: {
      summary: { text: 'Computational scientist.', evidence_ids: ['edu-phd'] },
      sections: [
        {
          heading: 'Education',
          entries: [
            {
              title: 'PhD, Computational Neuroscience',
              org: 'University of Melbourne',
              dates: '2022 – present',
              bullets: [bullet('Submitted October 2026.', ['edu-phd'])],
            },
          ],
        },
      ],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['edu-phd'],
    evidence: [PHD],
    profile: 'research',
    profileMeta: META,
    mode: 'strict',
  });
  assert.ok(has(errors, 'R4'), `expected R4, got ${rules(errors)}`);
});

// 10 | "PhD candidate, expected October 2026" | pass
test('A10: the allowed forms pass', () => {
  for (const text of [
    'PhD candidate, expected October 2026.',
    'PhD, expected submission October 2026.',
    'PhD candidate in computational neuroscience; expected submission October 2026.',
  ]) {
    const { errors } = checkCv({ evidence: [PHD], bullets: [bullet(text, ['edu-phd'])] });
    assert.deepEqual(errors, [], `${text} -> ${JSON.stringify(errors)}`);
  }
});

// 11 | "Rosa Kimani, PhD" in contact block | R5 error (post-nominal)
test('A11: your name with PhD after it is an R4 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
    renderedText: 'Rosa Kimani, PhD\nrosa@example.org\n',
  });
  assert.ok(has(errors, 'R4'), `expected R4, got ${rules(errors)}`);
  assert.match(find(errors, 'R4')[0].message, /post-nominal|PhD/i);
});

// 12 | "Dr <you>" anywhere | R4 error
test('A12: the honorific attached to your own name is an R4 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const inBullet = checkCv({
    evidence,
    bullets: [bullet('Work by Dr Kimani on evaluation.', ['r1'])],
  });
  assert.ok(has(inBullet.errors, 'R4'));

  const inRendered = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
    renderedText: 'Dr Kimani\n',
  });
  assert.ok(has(inRendered.errors, 'R4'), 'the header is where this actually appears');

  const withPeriod = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
    renderedText: 'Dr. Kimani\n',
  });
  assert.ok(has(withPeriod.errors, 'R4'));

  // A supervisor, referee or co-author who really does hold a doctorate is a true
  // statement about somebody else, and flagging it is how a checker loses its
  // authority. Only YOUR name counts.
  const someoneElse = checkCv({
    evidence,
    bullets: [bullet('Supervised by Dr Brooks and Dr Nguyen.', ['r1'])],
  });
  assert.ok(!has(someoneElse.errors, 'R4'), rules(someoneElse.errors));
});

// 13 | "results-driven team player" | R5 errors (each banned string reported)
test('A13: every banned string in one bullet is reported separately', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = checkCv({
    evidence,
    bullets: [bullet('A results-driven team player who is passionate about data.', ['r1'])],
  });
  const r5 = find(errors, 'R5');
  assert.equal(r5.length, 3, `expected 3 R5 errors, got ${r5.map((e) => e.message)}`);
  const joined = r5.map((e) => e.message).join(' ').toLowerCase();
  for (const phrase of ['results-driven', 'team player', 'passionate about']) {
    assert.ok(joined.includes(phrase), `${phrase} not reported`);
  }
});

// 14 | "Dynamic Causal Modelling" where the ad never says it | R6 warning + translation
//
// R6 is no longer decided by the profile. The ADVERTISEMENT decides: if the ad uses
// the term the document may keep it, whatever profile the job sits in. The profile's
// `register` is only the fallback for a job that has not been parsed.
test('A14: a specialist term the advertisement never uses warns with its translation', () => {
  const evidence = [rec({ id: 'r1', body: 'Used Dynamic Causal Modelling.' })];
  const { errors, warnings } = checkCv({
    evidence,
    profile: 'industry',
    bullets: [bullet('Built pipelines using Dynamic Causal Modelling.', ['r1'])],
  });
  assert.deepEqual(errors, []);
  assert.ok(has(warnings, 'R6'), `expected R6, got ${rules(warnings)}`);
  assert.match(find(warnings, 'R6')[0].message, /generative modelling of dynamical systems/i);
});

test('A14b: the gov profile warns too, and the abbreviation is caught', () => {
  const evidence = [rec({ id: 'r1', body: 'Used DCM and meta-d′.' })];
  const { warnings } = checkCv({
    evidence,
    profile: 'public-sector',
    bullets: [bullet('Applied DCM to connectivity data.', ['r1'])],
  });
  assert.ok(has(warnings, 'R6'));
});

// The case this rule was rewritten for: a cognitive-neuroscience role at a startup
// sits in a non-research profile and WANTS the exact vocabulary.
test('A14c: a specialist term the advertisement itself uses is fine on the industry profile', () => {
  const evidence = [rec({ id: 'r1', body: 'Used Dynamic Causal Modelling.' })];
  const { errors, warnings } = checkCv({
    evidence,
    profile: 'industry',
    jobParsed: { domain_vocabulary: ['Dynamic Causal Modelling', 'EEG'] },
    bullets: [bullet('Built pipelines using Dynamic Causal Modelling.', ['r1'])],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(find(warnings, 'R6'), [], 'the ad said it first, so the CV may say it');
});

test('A14d: the same term on the same profile still warns when the ad does not use it', () => {
  const evidence = [rec({ id: 'r1', body: 'Used Dynamic Causal Modelling.' })];
  const { warnings } = checkCv({
    evidence,
    profile: 'industry',
    jobParsed: { domain_vocabulary: ['dashboards', 'stakeholder reporting'] },
    bullets: [bullet('Built pipelines using Dynamic Causal Modelling.', ['r1'])],
  });
  assert.ok(has(warnings, 'R6'), `expected R6, got ${rules(warnings)}`);
});

test('A14e: an acronym in the CV is allowed by the expansion in the ad', () => {
  const evidence = [rec({ id: 'r1', body: 'Used DCM.' })];
  const { warnings } = checkCv({
    evidence,
    profile: 'public-sector',
    jobParsed: { domain_vocabulary: ['dynamic causal modelling'] },
    bullets: [bullet('Applied DCM to connectivity data.', ['r1'])],
  });
  assert.deepEqual(find(warnings, 'R6'), []);
});

test('A14f: an expansion in the CV is allowed by the acronym in the ad', () => {
  const evidence = [rec({ id: 'r1', body: 'Used item response theory.' })];
  const { warnings } = checkCv({
    evidence,
    profile: 'public-sector',
    jobParsed: { domain_vocabulary: ['IRT'] },
    bullets: [bullet('Audited a benchmark using item response theory.', ['r1'])],
  });
  assert.deepEqual(find(warnings, 'R6'), []);
});

test('A14g: hyphens, case, spacing and plurals do not stop a vocabulary match', () => {
  const evidence = [rec({ id: 'r1', body: 'Used signal detection theory.' })];
  for (const vocabulary of [['Signal-Detection Theory'], ['signal  detection theories'], ['SDT']]) {
    const { warnings } = checkCv({
      evidence,
      profile: 'industry',
      jobParsed: { domain_vocabulary: vocabulary },
      bullets: [bullet('Separated sensitivity from bias using signal detection theory.', ['r1'])],
    });
    assert.deepEqual(find(warnings, 'R6'), [], vocabulary.join());
  }
});

test('A14h: the job\'s register beats the profile\'s, in both directions', () => {
  const evidence = [rec({ id: 'r1', body: 'Used Dynamic Causal Modelling.' })];
  const bullets = [bullet('Built pipelines using Dynamic Causal Modelling.', ['r1'])];

  // A specialist ad in a non-specialist profile: keep the name.
  const specialistAd = checkCv({
    evidence,
    profile: 'industry',
    jobParsed: { technical_register: 'specialist', domain_vocabulary: [] },
    bullets,
  });
  assert.deepEqual(find(specialistAd.warnings, 'R6'), []);

  // A lay ad in a specialist profile: translate it.
  const generalAd = checkCv({
    evidence,
    profile: 'industry-research',
    jobParsed: { technical_register: 'general', domain_vocabulary: [] },
    bullets,
  });
  assert.ok(has(generalAd.warnings, 'R6'), 'a lay reader gets the plain wording even on ai-eval');
});

test('A14i: the register is resolved from the job first, then the profile, then nothing', () => {
  assert.equal(terminologyContext('industry', { technical_register: 'specialist' }).register, 'specialist');
  assert.equal(terminologyContext('industry-research', { technical_register: 'general' }).register, 'general');
  assert.equal(terminologyContext('public-sector', null).register, 'general', 'the profile default when the job is unparsed');
  assert.equal(terminologyContext('research', null).register, 'specialist');
  // No profile and no parsed job: we know nothing about the reader, so we say nothing.
  assert.equal(terminologyContext(null, null).register, 'specialist');
});

// 15 | Same term on `research` profile | pass
test('A15: with no parsed job, the profile register decides — research and ai-eval pass through', () => {
  const evidence = [rec({ id: 'r1', body: 'Used Dynamic Causal Modelling.' })];
  for (const profile of ['research', 'industry-research']) {
    const { errors, warnings } = checkCv({
      evidence,
      profile,
      bullets: [bullet('Built pipelines using Dynamic Causal Modelling.', ['r1'])],
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings.filter((w) => w.rule === 'R6'), [], profile);
  }
});

test('A15b: the new specialist vocabulary is covered by the term map', () => {
  const evidence = [rec({ id: 'r1', body: 'Method notes.' })];
  const cases = [
    ['Estimated effective connectivity across the network.', /which parts of a system drive which/i],
    ['Used parametric empirical Bayes across participants.', /hierarchical Bayesian modelling/i],
    ['Applied Bayesian model reduction to the fitted models.', /pruning a fitted model/i],
    ['Reported the posterior exceedance probability for each model.', /favours one model/i],
    ['Fitted the models with variational Laplace.', /approximate Bayesian fitting/i],
    ['Ran source reconstruction on the sensor data.', /where in the brain/i],
    ['Measured metacognitive efficiency with the M-ratio.', /confidence tracks accuracy/i],
    ['Designed the psychophysics for the study.', /precisely controlled stimuli/i],
    ['Trained a temporal generalisation classifier.', /learned at one moment/i],
  ];
  for (const [text, expected] of cases) {
    const { warnings } = checkCv({ evidence, profile: 'public-sector', bullets: [bullet(text, ['r1'])] });
    const r6 = find(warnings, 'R6');
    assert.ok(r6.length > 0, `no R6 for: ${text}`);
    assert.ok(r6.some((w) => expected.test(w.message)), `wrong translation for: ${text} — ${r6.map((w) => w.message)}`);
  }
});

// 16 | Work-rights line reworded by model for a remote job | R7 error
test('A16: a reworded work-rights line is an R7 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const expected = 'Riverina, Australia · Australian citizen — no sponsorship required for remote engagement';
  const { errors } = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
    expectedContactLines: [
      'Rosa Kimani',
      'rosa@example.org · 0400 000 000',
      'https://github.com/example · https://linkedin.com/in/example',
      expected,
    ],
    renderedText: [
      'Rosa Kimani',
      'rosa@example.org · 0400 000 000',
      'https://github.com/example · https://linkedin.com/in/example',
      'Riverina, Australia · Australian citizen, no sponsorship needed for remote work', // reworded
    ].join('\n'),
  });
  assert.ok(has(errors, 'R7'), `expected R7, got ${rules(errors)}`);
  assert.match(find(errors, 'R7')[0].message, /work|line|byte|exact/i);
});

// 17 | Contact block missing LinkedIn | R7 error
test('A17: a missing LinkedIn link is an R7 error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
    expectedContactLines: [
      'Rosa Kimani',
      'https://github.com/example · https://linkedin.com/in/example',
      'Riverina, Australia · Australian citizen',
    ],
    renderedText: [
      'Rosa Kimani',
      'https://github.com/example',
      'Riverina, Australia · Australian citizen',
    ].join('\n'),
  });
  assert.ok(has(errors, 'R7'));
  assert.match(errors.map((e) => e.message).join(' '), /linkedin/i);
});

test('A17b: a byte-exact contact block passes', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const lines = [
    'Rosa Kimani',
    'rosa@example.org · 0400 000 000',
    'https://github.com/example · https://linkedin.com/in/example',
    'Riverina, Australia · Australian citizen',
  ];
  const { errors, warnings } = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
    expectedContactLines: lines,
    renderedText: `${lines.join('\n')}\n\n## Experience\n\n- Ran 20 experiments.\n`,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter((w) => w.rule === 'R7'), []);
});

test('A17c: FILL-ME contact details skip the link check with a warning, not an error', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const lines = ['Rosa Kimani', 'FILL-ME · FILL-ME', 'Riverina, Australia · Australian citizen'];
  const { errors, warnings } = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
    expectedContactLines: lines,
    renderedText: `${lines.join('\n')}\n`,
  });
  assert.deepEqual(errors, []);
  assert.ok(has(warnings, 'R7'));
  assert.match(find(warnings, 'R7')[0].message, /FILL-ME/i);
});

// 18 | Bullet cites only figuresReleasable:false record and contains "37%" | R3 error
test('A18: numbers in a bullet citing only non-releasable records are an R3 error', () => {
  const evidence = [
    rec({
      id: 'role-health',
      body: 'Applied advanced analytics to detect fraud.\n\nOutcome figures from this role are not releasable.',
      figuresReleasable: false,
    }),
  ];
  const { errors } = checkCv({
    evidence,
    bullets: [bullet('Cut fraudulent claims by 37%.', ['role-health'])],
  });
  assert.ok(has(errors, 'R3'), `expected R3, got ${rules(errors)}`);
  assert.match(find(errors, 'R3')[0].message, /not releasable/i);
});

test('A18b: the same bullet without figures passes', () => {
  const evidence = [
    rec({
      id: 'role-health',
      body: 'Applied advanced analytics to detect fraud.\n\nOutcome figures from this role are not releasable.',
      figuresReleasable: false,
    }),
  ];
  const { errors } = checkCv({
    evidence,
    bullets: [bullet('Targeted provider fraud across Commonwealth claims data in SQL and SAS.', ['role-health'])],
  });
  assert.deepEqual(errors, []);
});

test('A18c: citing one releasable record alongside a sealed one lifts R3', () => {
  const evidence = [
    rec({ id: 'role-health', body: 'Outcome figures from this role are not releasable.', figuresReleasable: false }),
    rec({ id: 'r1', body: 'Ran 20 experiments.' }),
  ];
  const { errors } = checkCv({
    evidence,
    bullets: [bullet('Ran 20 experiments across both programmes.', ['role-health', 'r1'])],
  });
  assert.deepEqual(errors, []);
});

// 19 | Record has 20, bullet says "20%" | R2 warning (unit mismatch, value match)
test('A19: a value match with a unit mismatch is a warning', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors, warnings } = checkCv({
    evidence,
    bullets: [bullet('Improved coverage by 20%.', ['r1'])],
  });
  assert.deepEqual(errors, []);
  assert.ok(has(warnings, 'R2'));
  assert.match(find(warnings, 'R2')[0].message, /unit/i);
});

// 20 | "13-construct battery", 13 in cited record | pass (hyphenated extraction)
test('A20: hyphenated counts match the record', () => {
  const evidence = [rec({ id: 'r1', body: 'Designed a 13-construct behavioural battery.' })];
  const { errors, warnings } = checkCv({
    evidence,
    bullets: [bullet('Designed a 13-construct battery.', ['r1'])],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.filter((w) => w.rule === 'R2'), []);
});

// 21 | Post-edit advisory run: unknown number present | R8 warning, not error
test('A21: advisory mode reports everything as warnings', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors, warnings } = checkCv({
    evidence,
    mode: 'advisory',
    bullets: [bullet('Improved accuracy by 34%.', ['r1'])],
  });
  assert.deepEqual(errors, [], 'advisory mode never errors — the human has the last word');
  assert.ok(has(warnings, 'R8'), `expected R8, got ${rules(warnings)}`);
  assert.match(find(warnings, 'R8')[0].message, /34/);
});

test('A21b: advisory mode checks numbers against the FULL evidence pool', () => {
  const evidence = [
    rec({ id: 'r1', body: 'Ran 20 experiments.' }),
    rec({ id: 'r2', body: 'Produced 16 numbered findings.' }),
  ];
  // 16 is in r2, which this bullet does NOT cite. Strict mode errors; advisory
  // mode looks at the whole pool, so the human's edit is left alone.
  const strict = checkCv({ evidence, bullets: [bullet('Produced 16 findings.', ['r1'])] });
  assert.ok(has(strict.errors, 'R2'));

  const advisory = checkCv({
    evidence,
    mode: 'advisory',
    bullets: [bullet('Produced 16 findings.', ['r1'])],
  });
  assert.deepEqual(advisory.errors, []);
  assert.deepEqual(advisory.warnings.filter((w) => w.rule === 'R8'), []);
});

test('A21c: advisory mode still surfaces R4/R5/R6, as warnings', () => {
  const { errors, warnings } = checkCv({
    evidence: [PHD],
    mode: 'advisory',
    profile: 'industry',
    bullets: [
      bullet('Submitted PhD thesis; a real team player.', ['edu-phd']),
      bullet('Applied Dynamic Causal Modelling.', ['edu-phd']),
    ],
  });
  assert.deepEqual(errors, []);
  const sources = warnings.map((w) => w.sourceRule);
  for (const rule of ['R4', 'R5', 'R6']) {
    assert.ok(sources.includes(rule), `expected an advisory ${rule}, got ${sources}`);
  }
  assert.ok(warnings.every((w) => w.rule === 'R8'));
});

test('A21d: advisory mode does not run R1 — citations drift once a human edits', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors, warnings } = checkCv({
    evidence,
    mode: 'advisory',
    bullets: [bullet('A sentence the human wrote with no citation.', [])],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

// 22 | Difference-derived number but only ONE source record cited | R2 error
test('A22: a derivation that needs an uncited record stays an error', () => {
  const evidence = [
    rec({ id: 'r1', body: 'Accuracy of 86% at baseline.' }),
    rec({ id: 'r2', body: 'Accuracy fell to 21% under false context.' }),
  ];
  const cited = checkCv({
    evidence,
    bullets: [bullet('A 65-point drop in accuracy.', ['r1', 'r2'])],
  });
  assert.deepEqual(cited.errors, [], 'both sources cited: warning only');
  assert.ok(has(cited.warnings, 'R2'));

  const uncited = checkCv({
    evidence,
    bullets: [bullet('A 65-point drop in accuracy.', ['r1'])],
  });
  assert.ok(has(uncited.errors, 'R2'), `expected R2 error, got ${rules(uncited.errors)}`);
});

// --- beyond the matrix -----------------------------------------------------

test('R1: a cover-letter framing paragraph may cite nothing', () => {
  const { errors } = validate({
    artifactKind: 'cover-letter',
    artifact: {
      paragraphs: [
        { text: 'I am writing to apply for the Research Engineer role on your evaluations team.', evidence_ids: [] },
        { text: 'I ran 20 experiments on open-weight models.', evidence_ids: ['r1'] },
      ],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['r1'],
    evidence: [rec({ id: 'r1', body: 'Ran 20 experiments.' })],
    profile: 'industry-research',
    profileMeta: META,
    mode: 'strict',
  });
  assert.deepEqual(errors, []);
});

test('R1: an uncited cover-letter paragraph containing a digit is an error', () => {
  const { errors } = validate({
    artifactKind: 'cover-letter',
    artifact: {
      paragraphs: [{ text: 'I have 7 years of analytics experience.', evidence_ids: [] }],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['r1'],
    evidence: [rec({ id: 'r1', body: 'Ran 20 experiments.' })],
    profile: 'industry-research',
    profileMeta: META,
    mode: 'strict',
  });
  assert.ok(has(errors, 'R1'));
});

test('R1: an uncited cover-letter paragraph claiming a qualification is an error', () => {
  const { errors } = validate({
    artifactKind: 'cover-letter',
    artifact: {
      paragraphs: [{ text: 'My PhD is complete and I am ready to start.', evidence_ids: [] }],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['edu-phd'],
    evidence: [PHD],
    profile: 'industry-research',
    profileMeta: META,
    mode: 'strict',
  });
  assert.ok(has(errors, 'R1'), `expected R1, got ${rules(errors)}`);
});

test('R1: publication and award line entries must cite too', () => {
  const evidence = [rec({ id: 'pub-1', kind: 'publication', body: 'Kimani, R. (2025).' })];
  const { errors } = validate({
    artifactKind: 'cv',
    artifact: {
      summary: { text: 'Researcher.', evidence_ids: ['pub-1'] },
      sections: [
        {
          heading: 'Publications',
          entries: [
            { title: null, org: null, dates: null, line: 'Kimani, R. (2025). Neuroscience of Consciousness.', bullets: [], evidence_ids: [] },
          ],
        },
      ],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['pub-1'],
    evidence,
    profile: 'research',
    profileMeta: META,
    mode: 'strict',
  });
  assert.ok(has(errors, 'R1'));
  assert.equal(find(errors, 'R1')[0].ref, 'cv.sections[0].entries[0].line');
});

test('the summary is checked for numbers like any other claim', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = checkCv({
    evidence,
    summary: { text: 'Ran 41 experiments on open-weight models.', evidence_ids: ['r1'] },
    bullets: [bullet('Ran 20 experiments.', ['r1'])],
  });
  assert.ok(has(errors, 'R2'));
  assert.equal(find(errors, 'R2')[0].ref, 'cv.summary');
});

test('criteria artifacts are validated paragraph by paragraph', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors } = validate({
    artifactKind: 'criteria',
    artifact: {
      answers: [
        {
          criterion: 'Demonstrates analytical capability',
          paragraphs: [
            { text: 'I ran 20 experiments.', evidence_ids: ['r1'] },
            { text: 'I improved accuracy by 34%.', evidence_ids: ['r1'] },
          ],
        },
      ],
      gaps: [],
      changes_made: [],
    },
    offeredIds: ['r1'],
    evidence,
    profile: 'public-sector',
    profileMeta: META,
    mode: 'strict',
  });
  assert.ok(has(errors, 'R2'));
  assert.equal(find(errors, 'R2')[0].ref, 'criteria.answers[0].paragraphs[1]');
});

test('every reported item has a rule, a ref and a plain-language message', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran 20 experiments.' })];
  const { errors, warnings } = checkCv({
    evidence,
    profile: 'industry',
    bullets: [
      bullet('A results-driven analyst who improved accuracy by 34% using Dynamic Causal Modelling.', ['r1']),
      bullet('No citation here.', []),
    ],
  });
  for (const item of [...errors, ...warnings]) {
    assert.match(item.rule, /^R[1-8]$/);
    assert.equal(typeof item.ref, 'string');
    assert.ok(item.ref.length > 0);
    assert.equal(typeof item.message, 'string');
    assert.ok(item.message.length > 10, `message too terse: ${item.message}`);
    assert.ok(!/undefined|\[object/.test(item.message), `unrendered value in: ${item.message}`);
  }
});

test('a clean CV produces nothing at all', () => {
  const evidence = [
    rec({ id: 'r1', body: 'Ran 20 experiments at $0 API spend. Designed a 13-construct battery.' }),
    rec({ id: 'r2', body: 'Produced 16 numbered findings.' }),
  ];
  const { errors, warnings } = checkCv({
    evidence,
    bullets: [
      bullet('Ran 20 experiments on open-weight models at $0 API spend.', ['r1']),
      bullet('Designed a 13-construct behavioural battery.', ['r1']),
      bullet('Produced 16 numbered findings with credible intervals.', ['r2']),
    ],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

// --- R9: keyword coverage ----------------------------------------------------
//
// Ported from an ats_check.py in a LaTeX CV kit: an applicant-tracking system
// matches the ad's words against the document's, so a must-have the CV never
// mentions is a silent filter. Warnings only — never an error, in either mode.

const R9_JOB = {
  requirements: [
    { text: 'Experience with Kubernetes', kind: 'skill', must_have: true },
    { text: 'Strong Python', kind: 'skill', must_have: true },
    { text: 'Familiarity with Rust', kind: 'skill', must_have: false },
  ],
};

const R9_DOC = `# Rosa Kimani

## Summary

Built evaluation pipelines in Python.
`;

test('R9: a must-have the document never mentions is a warning, naming it', () => {
  const evidence = [rec({ id: 'r1', body: 'Built pipelines in Python.' })];
  const { errors, warnings } = checkCv({
    evidence,
    jobParsed: R9_JOB,
    renderedText: R9_DOC,
    bullets: [bullet('Built evaluation pipelines in Python.', ['r1'])],
  });

  const r9 = find(warnings, 'R9');
  assert.equal(r9.length, 1, `expected exactly one R9, got ${r9.map((w) => w.message)}`);
  assert.match(r9[0].message, /Kubernetes/);
  assert.equal(r9[0].ref, 'requirements[0]');
  assert.deepEqual(errors.filter((e) => e.rule === 'R9'), [], 'R9 is never an error');
});

test('R9: a must-have the document does mention passes, plural or not', () => {
  const evidence = [rec({ id: 'r1', body: 'Ran evaluations.' })];
  const job = { requirements: [{ text: 'Designing evaluations', kind: 'experience', must_have: true }] };
  const { warnings } = checkCv({
    evidence,
    jobParsed: job,
    renderedText: '## Summary\n\nDesigned an evaluation of six language models.\n',
    bullets: [bullet('Ran evaluations.', ['r1'])],
  });
  assert.deepEqual(find(warnings, 'R9'), []);
});

test('R9: desirable requirements are not checked — only the must-haves are filters', () => {
  const evidence = [rec({ id: 'r1', body: 'Built pipelines in Python.' })];
  const { warnings } = checkCv({
    evidence,
    jobParsed: { requirements: [{ text: 'Familiarity with Rust', kind: 'skill', must_have: false }] },
    renderedText: R9_DOC,
    bullets: [bullet('Built evaluation pipelines in Python.', ['r1'])],
  });
  assert.deepEqual(find(warnings, 'R9'), []);
});

test('R9: a requirement made only of stopwords and short words is skipped', () => {
  const evidence = [rec({ id: 'r1', body: 'Built pipelines in Python.' })];
  const { warnings } = checkCv({
    evidence,
    jobParsed: { requirements: [{ text: 'You will be able to work with them', must_have: true }] },
    renderedText: R9_DOC,
    bullets: [bullet('Built evaluation pipelines in Python.', ['r1'])],
  });
  assert.deepEqual(find(warnings, 'R9'), [], 'nothing specific enough to look for');
});

test('R9: with no parsed job or no rendered document, it says nothing', () => {
  const evidence = [rec({ id: 'r1', body: 'Built pipelines in Python.' })];
  const bullets = [bullet('Built evaluation pipelines in Python.', ['r1'])];
  assert.deepEqual(find(checkCv({ evidence, bullets, renderedText: R9_DOC }).warnings, 'R9'), []);
  assert.deepEqual(find(checkCv({ evidence, bullets, jobParsed: R9_JOB }).warnings, 'R9'), []);
});

test('R9: after a human edit it is still only advice', () => {
  const evidence = [rec({ id: 'r1', body: 'Built pipelines in Python.' })];
  const { errors, warnings } = checkCv({
    evidence,
    mode: 'advisory',
    jobParsed: R9_JOB,
    renderedText: R9_DOC,
    bullets: [bullet('Built evaluation pipelines in Python.', ['r1'])],
  });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.sourceRule === 'R9'), `expected an advisory R9, got ${warnings.map((w) => w.sourceRule)}`);
});

test('validate never throws on an empty or partial artifact', () => {
  for (const artifact of [{}, { sections: [] }, { summary: null, sections: null }, { paragraphs: [] }]) {
    const result = validate({
      artifactKind: 'cv',
      artifact,
      offeredIds: [],
      evidence: [],
      profile: 'industry-research',
      profileMeta: META,
      mode: 'strict',
    });
    assert.ok(Array.isArray(result.errors));
    assert.ok(Array.isArray(result.warnings));
  }
});
