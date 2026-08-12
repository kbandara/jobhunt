import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers, numbersMatch } from './numbers.js';

/** Convenience: just the numeric values, in document order. */
const values = (text) => extractNumbers(text).map((n) => n.value);
const raws = (text) => extractNumbers(text).map((n) => n.raw);

test('integers', () => {
  assert.deepEqual(values('Ran 20 experiments'), [20]);
});

test('decimals', () => {
  assert.deepEqual(values('GPA 6.531, First Class Honours'), [6.531]);
  assert.deepEqual(values('exceedance probability above 0.999'), [0.999]);
});

test('signed decimals keep their sign', () => {
  assert.deepEqual(values('c_social between -0.21 and -0.39'), [-0.21, -0.39]);
  assert.deepEqual(raws('criterion of -0.21'), ['-0.21']);
});

test('a hyphen between two numbers is a range, never a minus sign', () => {
  assert.deepEqual(values('Brain Topography, 1-10'), [1, 10]);
  assert.deepEqual(values('148(5-6), 370'), [148, 5, 6, 370]);
  // A percent sign before the hyphen must not turn the next number negative.
  assert.deepEqual(values('86%-21%'), [86, 21]);
  // A word before the hyphen is a compound, not a sign.
  assert.deepEqual(values('COVID-19 response'), [19]);
});

test('percentages carry value and unit', () => {
  const [n] = extractNumbers('accuracy of 86%');
  assert.equal(n.value, 86);
  assert.equal(n.unit, '%');
  assert.equal(n.raw, '86%');
});

test('comma thousands normalize', () => {
  const [n] = extractNumbers('about 2,500 postings per refresh');
  assert.equal(n.value, 2500);
  assert.equal(n.raw, '2,500');
  assert.deepEqual(values('1,234,567 rows'), [1234567]);
});

test('hyphenated counts', () => {
  assert.deepEqual(values('a 13-construct behavioural battery'), [13]);
  assert.deepEqual(values('7-fold cross-validation'), [7]);
  assert.deepEqual(values('an 8-node network'), [8]);
});

test('"X of Y" yields both endpoints', () => {
  assert.deepEqual(values('obeyed the override in 76 of 100 trials'), [76, 100]);
  assert.deepEqual(values('42 of 100 items sat at ceiling'), [42, 100]);
});

test('ranges yield each endpoint', () => {
  assert.deepEqual(values('collapsed accuracy from 86% to 21%'), [86, 21]);
  assert.deepEqual(values('moved from 56% and 63%'), [56, 63]);
  assert.deepEqual(values('2019–2023'), [2019, 2023]); // en dash
  assert.deepEqual(values('a panel of 5–6 small open-weight models'), [5, 6]);
});

test('currency', () => {
  const [au] = extractNumbers('AU$500 award for a conference abstract');
  assert.equal(au.value, 500);
  assert.equal(au.unit, '$');
  assert.equal(au.raw, 'AU$500');
  const [zero] = extractNumbers('Ran 20 experiments at $0 API spend');
  assert.equal(zero.value, 20);
  assert.deepEqual(values('at $0 API spend'), [0]);
});

test('N=100 style', () => {
  assert.deepEqual(values('MEG dataset (N=100)'), [100]);
  assert.deepEqual(values('n=100 per cell'), [100]);
});

test('times and units after the number', () => {
  assert.deepEqual(values('breakthrough-time detection (mean 1250 ms)'), [1250]);
});

test('four-digit years', () => {
  assert.deepEqual(values('2022-05 .. 2025-11'), [2022, 5, 2025, 11]);
  assert.deepEqual(values('expected submission October 2026'), [2026]);
});

// D012 — the rule that exists because breaking it damaged a real document.
test('number-words are NEVER extracted', () => {
  assert.deepEqual(extractNumbers('one honest difference'), []);
  assert.deepEqual(extractNumbers('one of those findings'), []);
  assert.deepEqual(
    extractNumbers('Two to four sentences; twelve models; a dozen findings'),
    [],
  );
  assert.deepEqual(extractNumbers('First Class Honours'), []);
});

test('no special casing: phone-like strings are matched literally', () => {
  // Not treated as one "phone number" token and not skipped — just the digit
  // runs it contains, so the validator compares them like any other number.
  assert.deepEqual(values('call 0412 345 678'), [412, 345, 678]);
  assert.deepEqual(values('+61 412 345 678'), [61, 412, 345, 678]);
});

test('empty and non-string input', () => {
  assert.deepEqual(extractNumbers(''), []);
  assert.deepEqual(extractNumbers(null), []);
  assert.deepEqual(extractNumbers(undefined), []);
  assert.deepEqual(extractNumbers('no digits here at all'), []);
});

test('numbersMatch: equality after normalization', () => {
  const rec = extractNumbers('2500 postings')[0];
  const bullet = extractNumbers('2,500 postings')[0];
  assert.deepEqual(numbersMatch(rec, bullet), { match: true, unitMismatch: false });
});

test('numbersMatch: value match with unit mismatch is flagged, not denied', () => {
  const rec = extractNumbers('20 experiments')[0];
  const bullet = extractNumbers('20% of experiments')[0];
  assert.deepEqual(numbersMatch(rec, bullet), { match: true, unitMismatch: true });
});

test('numbersMatch: different values never match', () => {
  const a = extractNumbers('34%')[0];
  const b = extractNumbers('86%')[0];
  assert.equal(numbersMatch(a, b).match, false);
});

test('numbersMatch: accepts plain numbers and strings too', () => {
  assert.equal(numbersMatch(2500, '2,500').match, true);
  assert.equal(numbersMatch(20, 21).match, false);
  assert.equal(numbersMatch(null, 5).match, false);
});

test('numbersMatch: same unit on both sides is not a mismatch', () => {
  const a = extractNumbers('86%')[0];
  const b = extractNumbers('86%')[0];
  assert.deepEqual(numbersMatch(a, b), { match: true, unitMismatch: false });
});
