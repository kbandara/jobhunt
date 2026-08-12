// Why these tests exist: this feature has an obvious failure mode and a subtle
// one. The obvious one is a coverage number that means nothing — a phrase
// counted as present because its three words appear in three unrelated bullets.
// The subtle one is the feature working TOO well: a prompt that hands a model a
// list of words with no constraint produces a "Key Skills" block full of things
// nobody did, which reads as a lie to the human who opens the CV, because it is
// one. The honesty rule is tested here as seriously as the extraction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords, coverage, keywordSection, normalise, singular, SOURCE_WEIGHTS } from './keywords.js';

const JD = {
  requirements: [
    { text: 'Strong applied statistics', kind: 'skill', must_have: true },
    { text: 'Experience designing evaluations of language models', kind: 'experience', must_have: true },
    { text: 'Psychometrics and item response theory', kind: 'skill', must_have: false },
  ],
  skills: ['statistics', 'python', 'evaluation', 'psychometrics'],
  responsibilities: ['Design evaluations', 'Analyse results', 'Write up findings'],
  domain_vocabulary: ['item response theory', 'signal detection theory'],
};

// --- what comes out ------------------------------------------------------------

test('the structured fields are used — they are already the ad’s own vocabulary', () => {
  const terms = extractKeywords({ jdJson: JD }).map((k) => k.term.toLowerCase());
  for (const expected of ['python', 'psychometrics', 'signal detection theory']) {
    assert.ok(terms.includes(expected), `expected "${expected}" among ${terms.join(', ')}`);
  }
});

test('a must-have requirement outranks a nice-to-have', () => {
  assert.ok(SOURCE_WEIGHTS['must-have'] > SOURCE_WEIGHTS.desirable);
  const jd = {
    requirements: [
      { text: 'Kubernetes', must_have: true },
      { text: 'Terraform', must_have: false },
    ],
  };
  const keywords = extractKeywords({ jdJson: jd });
  const weightOf = (t) => keywords.find((k) => normalise(k.term) === normalise(t))?.weight;
  assert.ok(weightOf('kubernetes') > weightOf('terraform'));
});

test('the term is spelled the way the advertisement spells it', () => {
  // The folded form is an index key, not the ad's word. Telling a model to write
  // "statistic" where the ad says "statistics" is subtly wrong prose.
  const terms = extractKeywords({ jdJson: JD }).map((k) => k.term);
  assert.ok(terms.includes('statistics'), `expected the ad's spelling among ${terms.join(', ')}`);
  assert.ok(!terms.includes('statistic'));
});

test('a fragment of a phrase is dropped in favour of the phrase', () => {
  // "applied" on its own tells a model nothing; "applied statistics" is the
  // phrase the ad used and the phrase a search will look for.
  const terms = extractKeywords({ jdJson: { requirements: [{ text: 'Strong applied statistics', must_have: true }] } })
    .map((k) => k.term);
  assert.ok(terms.includes('applied statistics'));
  assert.ok(!terms.includes('applied'), `a bare fragment survived: ${terms.join(', ')}`);
});

test('a term the ad states on its own survives alongside the phrase containing it', () => {
  // "statistics" is in the skills array in its own right, so it outranks
  // "applied statistics" and both are worth carrying — the CV may reasonably
  // say "Bayesian statistics" and still be matching what was asked for.
  const terms = extractKeywords({ jdJson: JD }).map((k) => normalise(k.term));
  assert.ok(terms.includes(normalise('statistics')));
  assert.ok(terms.includes(normalise('applied statistics')));
});

test('a phrase that straddles two listed things is not a term', () => {
  // "Psychometrics and item response theory" is two things. "psychometrics and
  // item" reads like a term and is a join artefact nobody has ever searched for.
  const terms = extractKeywords({ jdJson: JD }).map((k) => k.term);
  for (const junk of terms) {
    assert.doesNotMatch(junk, /\b(?:and|of|or|with|for|the)\b/i, `"${junk}" straddles a stop word`);
  }
});

test('phrases are kept whole, because that is what gets searched for', () => {
  const terms = extractKeywords({ jdJson: JD }).map((k) => normalise(k.term));
  assert.ok(terms.includes('item response theory'));
});

test('a phrase never begins or ends on a stop word', () => {
  const jd = { responsibilities: ['Design of evaluations for the team'] };
  for (const { term } of extractKeywords({ jdJson: jd })) {
    assert.doesNotMatch(term, /^(?:of|the|for|and|a|an)\b/i, `"${term}" starts on a stop word`);
    assert.doesNotMatch(term, /\b(?:of|the|for|and|a|an)$/i, `"${term}" ends on a stop word`);
  }
});

test('a term that only ever appears inside a longer one is dropped', () => {
  // Otherwise the list reads "theory, response theory, item response theory" and
  // the model is told the same thing three times.
  const terms = extractKeywords({ jdJson: JD }).map((k) => normalise(k.term));
  assert.ok(terms.includes('item response theory'));
  assert.ok(!terms.includes('response theory'), `"response theory" should have been subsumed: ${terms.join(', ')}`);
});

test('short noise words are dropped, but short real ones survive', () => {
  const jd = { skills: ['R', 'Go', 'C++', 'C#', 'AI'] };
  const terms = extractKeywords({ jdJson: jd }).map((k) => normalise(k.term));
  assert.ok(terms.includes('c++'), `c++ must survive: ${terms.join(', ')}`);
  assert.ok(terms.includes('c#'));
});

test('the list is capped, so it stays a list somebody reads', () => {
  const jd = { responsibilities: Array.from({ length: 60 }, (_, i) => `Doing distinctthing${i} work daily`) };
  assert.ok(extractKeywords({ jdJson: jd, limit: 10 }).length <= 10);
});

test('an empty or nonsense advertisement yields nothing and never throws', () => {
  for (const jdJson of [{}, null, undefined, { requirements: null, skills: 'not an array' }]) {
    assert.doesNotThrow(() => extractKeywords({ jdJson }));
    assert.deepEqual(extractKeywords({ jdJson }), []);
  }
});

// --- coverage, and what it is allowed to claim ----------------------------------

test('a term the document uses is covered', () => {
  const { covered } = coverage({ keywords: [{ term: 'psychometrics', weight: 3 }], text: 'Applied psychometrics daily.' });
  assert.equal(covered.length, 1);
});

test('plurals count — the same claim in different clothes', () => {
  const { covered } = coverage({ keywords: [{ term: 'evaluations', weight: 3 }], text: 'Designed one evaluation.' });
  assert.equal(covered.length, 1);
});

test('a phrase scattered across the document is NOT covered', () => {
  // The whole value of the number depends on this. "item ... response ...
  // theory" in three unrelated bullets is not the term the recruiter searched.
  const text = 'Built an item bank. Measured response times. Applied detection theory.';
  const { missing } = coverage({ keywords: [{ term: 'item response theory', weight: 3 }], text });
  assert.equal(missing.length, 1);
});

test('a phrase used as written is covered', () => {
  const { covered } = coverage({
    keywords: [{ term: 'item response theory', weight: 3 }],
    text: 'Fitted item response theory models to the data.',
  });
  assert.equal(covered.length, 1);
});

test('a term inside a longer word does not count', () => {
  const { missing } = coverage({ keywords: [{ term: 'eval', weight: 1 }], text: 'medieval history' });
  assert.equal(missing.length, 1);
});

test('the score is weighted, so missing a must-have costs more than missing a nicety', () => {
  const keywords = [{ term: 'statistics', weight: 4 }, { term: 'psychometrics', weight: 1 }];
  const missedBig = coverage({ keywords, text: 'psychometrics' }).score;
  const missedSmall = coverage({ keywords, text: 'statistics' }).score;
  assert.ok(missedSmall > missedBig, `${missedSmall} should beat ${missedBig}`);
});

test('an advertisement with no terms scores 1 rather than dividing by zero', () => {
  assert.equal(coverage({ keywords: [], text: 'anything' }).score, 1);
});

test('coverage never throws on the shapes a saved document can be', () => {
  for (const text of ['', null, undefined]) {
    assert.doesNotThrow(() => coverage({ keywords: [{ term: 'x', weight: 1 }], text }));
  }
});

// --- the rule that keeps this honest ---------------------------------------------

test('the prompt section forbids the things that make a CV worse', () => {
  const section = keywordSection([{ term: 'python', weight: 3 }]).join('\n');
  assert.match(section, /WORDING, NOT/i, 'the constraint must be unmissable, not a footnote');
  assert.match(section, /key skills/i, 'the "keyword block" escape hatch has to be closed explicitly');
  assert.match(section, /has not done/i);
  assert.match(section, /left out/i, 'a term with no honest home must be allowed to go missing');
});

test('the prompt section is empty when there is nothing to say', () => {
  assert.deepEqual(keywordSection([]), []);
});

// --- the text machinery --------------------------------------------------------

test('plurals fold the way an English reader expects', () => {
  assert.equal(singular('evaluations'), 'evaluation');
  assert.equal(singular('studies'), 'study');
  assert.equal(singular('analysis'), 'analysis');
  assert.equal(singular('bias'), 'bias', 'a word that merely ends in s is not a plural');
  assert.equal(singular('status'), 'status');
  assert.equal(singular('ai'), 'ai');
});

test('normalise makes two spellings of the same term comparable', () => {
  assert.equal(normalise('  Item-Response  Theory! '), normalise('item response theory'));
  assert.equal(normalise('C++'), 'c++');
});

// --- the term it must never suggest ------------------------------------------------

test('a term that would claim an unawarded qualification is never offered', () => {
  // "An awarded PhD at the time of application" is a real requirement, and
  // "awarded phd" is a real term inside it — and it is the single phrase this
  // person must not write. Offering it would be the app inviting the exact claim
  // its own validator exists to stop.
  const jd = { requirements: [{ text: 'An awarded PhD at the time of application', must_have: true }] };
  const meta = { qualifications: { phd: { awarded: false, submitted: false } } };
  for (const { term } of extractKeywords({ jdJson: jd, profileMeta: meta })) {
    assert.doesNotMatch(term, /\b(?:awarded|conferred|graduated)\b/i, `"${term}" invites a false claim`);
  }
});

test('someone who HAS been awarded the degree is offered the term normally', () => {
  const jd = { requirements: [{ text: 'An awarded PhD at the time of application', must_have: true }] };
  const terms = extractKeywords({ jdJson: jd, profileMeta: { qualifications: { phd: { awarded: true } } } })
    .map((k) => k.term.toLowerCase());
  assert.ok(terms.some((t) => t.includes('awarded')), `expected the term for someone who can claim it: ${terms.join(', ')}`);
});

test('"phd" itself is still offered — "PhD candidate" is a true thing to write', () => {
  const jd = { requirements: [{ text: 'An awarded PhD at the time of application', must_have: true }] };
  const terms = extractKeywords({ jdJson: jd, profileMeta: { qualifications: { phd: { awarded: false } } } })
    .map((k) => normalise(k.term));
  assert.ok(terms.includes('phd'));
});

test('words that appear in every advertisement are not terms', () => {
  // "at the time of application" produced "time" and "application", which no
  // recruiter has ever searched for and which a CV cannot meaningfully be
  // missing.
  const jd = { requirements: [{ text: 'An awarded PhD at the time of application', must_have: true }] };
  const terms = extractKeywords({ jdJson: jd }).map((k) => normalise(k.term));
  for (const junk of ['time', 'application', 'team', 'opportunity', 'ability']) {
    assert.ok(!terms.includes(junk), `"${junk}" is not a term worth matching on`);
  }
});
