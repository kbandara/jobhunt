// Why these tests exist: a word limit read wrongly costs you an answer that a
// portal truncates mid-sentence, and a question split wrongly costs you an
// answer to a question nobody asked. Both fail silently at the far end, in a
// form you only find out about by not hearing back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestions, limitIn, questionsFor, wordCount, answerCounts, splitAnswers } from './questions.js';

// --- splitting a paste ---------------------------------------------------------

test('blank lines separate questions', () => {
  const out = parseQuestions('Tell us about a time you led.\n\nDescribe your statistics experience.');
  assert.equal(out.length, 2);
  assert.equal(out[0].question, 'Tell us about a time you led.');
});

test('a wrapped question stays one question', () => {
  // Portals wrap long criteria across lines; each line is not a criterion.
  const out = parseQuestions(
    'Demonstrated capacity to work independently\nand as part of a multidisciplinary team.\n\nCommunicates with influence.',
  );
  assert.equal(out.length, 2);
  assert.match(out[0].question, /independently and as part/);
});

test('without blank lines, one question per line', () => {
  const out = parseQuestions('First criterion\nSecond criterion\nThird criterion');
  assert.equal(out.length, 3);
});

test('numbering and bullets are formatting, and are removed', () => {
  for (const marker of ['1. ', '2) ', '- ', '• ', 'a) ']) {
    const [only] = parseQuestions(`${marker}Communicates with influence`);
    assert.equal(only.question, 'Communicates with influence', `failed for "${marker}"`);
  }
});

test('empty and whitespace input give nothing, not one blank question', () => {
  assert.deepEqual(parseQuestions(''), []);
  assert.deepEqual(parseQuestions('   \n\n  '), []);
  assert.deepEqual(parseQuestions(null), []);
});

// --- word limits ---------------------------------------------------------------

test('the shapes a limit is actually written in are all recognised', () => {
  const cases = [
    ['Describe your experience (300 words max)', 300],
    ['Describe your experience. Maximum 250 words.', 250],
    ['Describe your experience — no more than 400 words', 400],
    ['Up to 500 words.', 500],
    ['Answer within 350 words', 350],
    ['200 words or less', 200],
    ['750 word limit', 750],
    ['Please keep to 300 words', 300],
  ];
  for (const [text, expected] of cases) {
    assert.equal(limitIn(text), expected, `failed for "${text}"`);
  }
});

test('a question with no limit says so rather than guessing one', () => {
  assert.equal(limitIn('Tell us about a time you led a team.'), null);
});

test('an implausible number is not a limit', () => {
  // "in your own words" and similar phrasing must not become a 5-word ceiling.
  assert.equal(limitIn('Answer in 5 words'), null);
  assert.equal(limitIn('Describe your last 10 years'), null);
});

test('the limit is lifted onto the parsed question', () => {
  const [only] = parseQuestions('Describe a time you led a project (300 words max).');
  assert.equal(only.wordLimit, 300);
});

// --- where the questions come from ---------------------------------------------

test('the advertisement supplies them when you have pasted nothing', () => {
  const job = {
    parsed: { selection_criteria: [{ question: 'Works independently', word_limit: 300 }] },
  };
  const { questions, source } = questionsFor(job);
  assert.equal(source, 'advertisement');
  assert.equal(questions[0].wordLimit, 300);
});

test('what you pasted replaces the advertisement outright, never merges with it', () => {
  // The portal's wording and the ad's wording for the same criterion differ
  // slightly. Merging gives you both, each answered, with nothing to say which
  // one the assessor will read.
  const job = {
    parsed: { selection_criteria: [{ question: 'From the ad', word_limit: null }] },
    questions: { items: [{ question: 'From the portal', wordLimit: 300 }] },
  };
  const { questions, source } = questionsFor(job);
  assert.equal(source, 'you');
  assert.equal(questions.length, 1);
  assert.equal(questions[0].question, 'From the portal');
});

test('a job with neither is "none", not an error', () => {
  const { questions, source } = questionsFor({});
  assert.deepEqual(questions, []);
  assert.equal(source, 'none');
});

test('a limit stated in the ad text is found even when the parse left the field null', () => {
  const job = { parsed: { selection_criteria: [{ question: 'Leads teams (250 words)', word_limit: null }] } };
  assert.equal(questionsFor(job).questions[0].wordLimit, 250);
});

// --- counting ------------------------------------------------------------------

test('words are counted the way a portal counts them', () => {
  // Whitespace splitting, because that is what the box on the other end does.
  assert.equal(wordCount('one two three'), 3);
  assert.equal(wordCount('state-of-the-art evaluation'), 2);
  assert.equal(wordCount('  spaced   out  '), 2);
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount(null), 0);
});

test('the document is split into one block per answer', () => {
  const doc = '# Name\n\ncontact\n\n## First question\n\nAnswer one.\n\n## Second question\n\nAnswer two.';
  const answers = splitAnswers(doc);
  assert.equal(answers.length, 2);
  assert.equal(answers[0].heading, 'First question');
  assert.equal(answers[0].body, 'Answer one.');
});

test('the contact block is not counted as an answer', () => {
  const doc = '# Rosa Kimani\n\nrosa@example.org\n\n## A question\n\nThe answer.';
  assert.equal(splitAnswers(doc).length, 1);
});

test('an answer over its limit is reported as over', () => {
  const questions = [{ question: 'A question', wordLimit: 3 }];
  const doc = '## A question\n\none two three four';
  const [count] = answerCounts(doc, questions);
  assert.equal(count.words, 4);
  assert.equal(count.over, true);
});

test('an answer within its limit is not', () => {
  const [count] = answerCounts('## A question\n\none two', [{ question: 'A question', wordLimit: 300 }]);
  assert.equal(count.over, false);
});

test('a question with no limit can never be over', () => {
  const doc = `## A question\n\n${'word '.repeat(900)}`;
  const [count] = answerCounts(doc, [{ question: 'A question', wordLimit: null }]);
  assert.equal(count.words, 900);
  assert.equal(count.over, false);
});

test('a question the document has no answer for counts zero rather than throwing', () => {
  const counts = answerCounts('## Only one\n\nText.', [
    { question: 'Only one', wordLimit: null },
    { question: 'Never answered', wordLimit: 300 },
  ]);
  assert.equal(counts[1].words, 0);
  assert.equal(counts[1].heading, null);
});

test('nonsense input never throws', () => {
  for (const input of ['', null, undefined]) {
    assert.doesNotThrow(() => answerCounts(input, [{ question: 'q', wordLimit: 100 }]));
    assert.doesNotThrow(() => splitAnswers(input));
  }
});
