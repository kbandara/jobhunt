// Why these tests exist: this feature hands a model your draft and asks it what
// to change. Every other part of the app is built so a model cannot put a claim
// in your mouth, and a review that suggests "work in the term 'clinical trials'"
// when nothing you have done involves one would walk straight around that. So the
// suggestions are checked in code, and these tests are that check's contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSystemPrompt, reviewUserMessage, checkReview, recordsUsedIn, MAX_SUGGESTIONS } from './recruiter.js';

const RECORDS = [
  { id: 'role-analyst', title: 'Data Analyst', org: 'Riverina Water', text: 'Built a reporting pipeline in Python.' },
  { id: 'proj-harness', title: 'Evaluation harness', org: 'independent', text: 'Designed evaluations of model output.' },
  { id: 'edu-phd', title: 'PhD in freshwater ecology', org: 'Riverina University', text: 'Thesis in progress.' },
];

const KEYWORDS = [
  { term: 'python', weight: 7, sources: ['skill', 'must-have'], used: true },
  { term: 'evaluations', weight: 7, sources: ['skill', 'must-have'], used: false },
  { term: 'stakeholder reporting', weight: 4, sources: ['responsibility'], used: false },
];

const DRAFT = '# Rosa Kimani\n\n## Experience\n\n### Data Analyst — Riverina Water\n\n- Built a reporting pipeline in Python.\n';

const reply = (over = {}) => ({
  verdict: 'maybe',
  first_impression: 'Reads as a competent analyst, but nothing says you have done evaluation work.',
  strengths: ['The Python work is concrete and dated.'],
  concerns: [{ concern: 'No evaluation work is visible.', fix: 'Lead the second bullet with the harness project.' }],
  keywords_to_work_in: [],
  records_to_add: [],
  ...over,
});

// --- the prompt ----------------------------------------------------------------

test('the screener is told the role, so the persona is not generic', () => {
  const prompt = reviewSystemPrompt({ roleTitle: 'Research Engineer', company: 'Meridian Health' });
  assert.match(prompt, /Research Engineer/);
  assert.match(prompt, /Meridian Health/);
});

test('the prompt judges the document, not the person', () => {
  const prompt = reviewSystemPrompt();
  assert.match(prompt, /THE DOCUMENT IN FRONT OF YOU/);
  assert.match(prompt, /ONLY WORDING AND EMPHASIS/);
  assert.match(prompt, /may not invent a fact/i);
  assert.match(prompt, /LEAVE IT OUT/, 'a term with no honest home has to be allowed to go missing');
});

test('the prompt says an invented id is thrown away, so guessing is pointless', () => {
  assert.match(reviewSystemPrompt(), /thrown away by the app/i);
});

test('the document kind changes what it is called', () => {
  assert.match(reviewSystemPrompt({ kind: 'cover-letter' }), /cover letter/);
  assert.match(reviewSystemPrompt({ kind: 'cv' }), /\bCV\b/);
});

// --- the message ---------------------------------------------------------------

test('the message carries the ad, the draft and every record', () => {
  const message = reviewUserMessage({
    jdJson: { role_title: 'Research Engineer' },
    markdown: DRAFT,
    records: RECORDS,
    cited: ['role-analyst'],
    keywords: KEYWORDS,
  });
  assert.match(message, /Research Engineer/);
  assert.match(message, /reporting pipeline in Python/);
  for (const record of RECORDS) assert.match(message, new RegExp(record.id));
});

test('records the draft already uses are marked, so it does not suggest them back', () => {
  const message = reviewUserMessage({ markdown: DRAFT, records: RECORDS, cited: ['role-analyst'] });
  assert.match(message, /### role-analyst {2}\[USED\]/);
  assert.doesNotMatch(message, /### proj-harness {2}\[USED\]/);
});

test('the missing terms the app already worked out are handed over', () => {
  const message = reviewUserMessage({ markdown: DRAFT, records: RECORDS, keywords: KEYWORDS });
  assert.match(message, /evaluations/);
  assert.match(message, /stakeholder reporting/);
  // Already used, so raising it would be noise.
  assert.doesNotMatch(message, /^- python$/m);
});

test('an empty draft is described rather than sent as nothing', () => {
  assert.match(reviewUserMessage({ markdown: '   ', records: RECORDS }), /\(empty\)/);
});

// --- what the draft appears to use ---------------------------------------------

test('a record is counted as used when its title appears in the document', () => {
  assert.deepEqual(recordsUsedIn(DRAFT, RECORDS), ['role-analyst']);
});

test('an organisation alone does not count when the record has a title', () => {
  // Two roles at one employer share the org, so matching on it would mark both.
  const draft = '## Experience\n\n- Something at Riverina Water.\n';
  assert.deepEqual(recordsUsedIn(draft, RECORDS), []);
});

test('matching survives markdown punctuation around the title', () => {
  assert.deepEqual(recordsUsedIn('### **Evaluation harness** (independent)', RECORDS), ['proj-harness']);
});

test('no document means nothing is used', () => {
  assert.deepEqual(recordsUsedIn('', RECORDS), []);
  assert.deepEqual(recordsUsedIn(DRAFT, []), []);
});

// --- the checks that stop it inventing things ------------------------------------

test('a keyword the advertisement never used is thrown away', () => {
  const out = checkReview(
    reply({ keywords_to_work_in: [{ term: 'clinical trials', supported_by: 'role-analyst', where: 'summary' }] }),
    { records: RECORDS, keywords: KEYWORDS, markdown: DRAFT },
  );
  assert.deepEqual(out.keywords, []);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0].reason, /never used that term/);
});

test('a keyword with no record behind it is thrown away', () => {
  const out = checkReview(
    reply({ keywords_to_work_in: [{ term: 'evaluations', supported_by: 'role-invented', where: 'summary' }] }),
    { records: RECORDS, keywords: KEYWORDS, markdown: DRAFT },
  );
  assert.deepEqual(out.keywords, []);
  assert.match(out.dropped[0].reason, /no record called "role-invented"/);
});

test('a keyword naming no record at all is thrown away', () => {
  const out = checkReview(
    reply({ keywords_to_work_in: [{ term: 'evaluations', supported_by: '', where: 'summary' }] }),
    { records: RECORDS, keywords: KEYWORDS, markdown: DRAFT },
  );
  assert.deepEqual(out.keywords, []);
  assert.match(out.dropped[0].reason, /no record was named/);
});

test('a keyword the document already uses is thrown away as noise', () => {
  const out = checkReview(
    reply({ keywords_to_work_in: [{ term: 'python', supported_by: 'role-analyst', where: 'summary' }] }),
    { records: RECORDS, keywords: KEYWORDS, markdown: DRAFT },
  );
  assert.deepEqual(out.keywords, []);
  assert.match(out.dropped[0].reason, /already uses it/);
});

test('an honest keyword survives, carrying the record that backs it', () => {
  const out = checkReview(
    reply({
      keywords_to_work_in: [
        { term: 'evaluations', supported_by: 'proj-harness', where: 'the summary, replacing "measurement instruments"' },
      ],
    }),
    { records: RECORDS, keywords: KEYWORDS, markdown: DRAFT },
  );
  assert.equal(out.keywords.length, 1);
  assert.equal(out.keywords[0].term, 'evaluations');
  assert.equal(out.keywords[0].supportedBy, 'proj-harness');
  assert.equal(out.keywords[0].supportedByTitle, 'Evaluation harness', 'so the panel can name it readably');
  assert.deepEqual(out.dropped, []);
});

test('a record suggestion with an invented id is thrown away', () => {
  const out = checkReview(reply({ records_to_add: [{ record_id: 'role-nope', why: 'relevant' }] }), {
    records: RECORDS,
    keywords: KEYWORDS,
    markdown: DRAFT,
  });
  assert.deepEqual(out.records, []);
  assert.match(out.dropped[0].reason, /no record with that id/);
});

test('a record the document already cites is thrown away', () => {
  const out = checkReview(reply({ records_to_add: [{ record_id: 'role-analyst', why: 'relevant' }] }), {
    records: RECORDS,
    cited: ['role-analyst'],
    keywords: KEYWORDS,
    markdown: DRAFT,
  });
  assert.deepEqual(out.records, []);
  assert.match(out.dropped[0].reason, /already cites it/);
});

test('a real, unused record survives with its title and reason', () => {
  const out = checkReview(
    reply({ records_to_add: [{ record_id: 'proj-harness', why: 'It answers the evaluation requirement.' }] }),
    { records: RECORDS, cited: ['role-analyst'], keywords: KEYWORDS, markdown: DRAFT },
  );
  assert.equal(out.records.length, 1);
  assert.deepEqual(out.records[0], {
    id: 'proj-harness',
    title: 'Evaluation harness',
    org: 'independent',
    why: 'It answers the evaluation requirement.',
  });
});

// --- the shape the panel renders --------------------------------------------------

test('a verdict outside the three is not passed through', () => {
  assert.equal(checkReview(reply({ verdict: 'definitely' }), { records: RECORDS }).verdict, 'maybe');
  assert.equal(checkReview({}, { records: RECORDS }).verdict, 'maybe');
  for (const verdict of ['interview', 'maybe', 'pass']) {
    assert.equal(checkReview(reply({ verdict }), { records: RECORDS }).verdict, verdict);
  }
});

test('a reply with nothing in it produces empty lists, not undefined', () => {
  const out = checkReview({}, { records: RECORDS });
  assert.deepEqual(out.strengths, []);
  assert.deepEqual(out.concerns, []);
  assert.deepEqual(out.keywords, []);
  assert.deepEqual(out.records, []);
  assert.deepEqual(out.dropped, []);
  assert.equal(out.firstImpression, '');
});

test('a concern with no wording is dropped, since there is nothing to act on', () => {
  const out = checkReview(reply({ concerns: [{ concern: '  ', fix: 'do something' }, { concern: 'Real one', fix: '' }] }), {
    records: RECORDS,
  });
  assert.equal(out.concerns.length, 1);
  assert.equal(out.concerns[0].concern, 'Real one');
});

test('a model that returns fifty suggestions is capped, not rendered', () => {
  const many = Array.from({ length: 40 }, () => ({
    term: 'evaluations',
    supported_by: 'proj-harness',
    where: 'summary',
  }));
  const out = checkReview(reply({ keywords_to_work_in: many }), {
    records: RECORDS,
    keywords: KEYWORDS,
    markdown: '# nothing relevant',
  });
  assert.equal(out.keywords.length, MAX_SUGGESTIONS);
});
