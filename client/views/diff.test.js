// Why these tests exist: this is the one piece of the app that tells you what
// changed, and a diff that is subtly wrong is worse than none — you read it,
// believe it, and restore the wrong version. The cases below are the ones that
// actually come up in a CV: a rewritten bullet, a section moved, a line added at
// the top, and the same word appearing in twenty places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, countChanges, withContext, MAX_CELLS } from './diff.js';

const lines = (rows) => rows.map((r) => `${{ same: ' ', add: '+', remove: '-', gap: '~' }[r.type]}${r.text ?? r.count}`);

test('identical documents have no changes at all', () => {
  const doc = 'one\ntwo\nthree';
  const rows = diffLines(doc, doc);
  assert.deepEqual(countChanges(rows), { added: 0, removed: 0 });
  assert.ok(rows.every((r) => r.type === 'same'));
});

test('a rewritten line reads as the old one removed then the new one added', () => {
  const rows = diffLines('one\ntwo\nthree', 'one\nTWO\nthree');
  assert.deepEqual(lines(rows), [' one', '-two', '+TWO', ' three']);
});

test('an added line is an addition, not a rewrite of its neighbour', () => {
  const rows = diffLines('one\nthree', 'one\ntwo\nthree');
  assert.deepEqual(lines(rows), [' one', '+two', ' three']);
  assert.deepEqual(countChanges(rows), { added: 1, removed: 0 });
});

test('a deleted line is a deletion', () => {
  const rows = diffLines('one\ntwo\nthree', 'one\nthree');
  assert.deepEqual(lines(rows), [' one', '-two', ' three']);
});

test('the first version has no previous, so everything is new', () => {
  const rows = diffLines('', 'one\ntwo');
  assert.deepEqual(lines(rows), ['+one', '+two']);
  assert.deepEqual(countChanges(rows), { added: 2, removed: 0 });
});

test('emptying a document removes every line rather than reporting nothing', () => {
  const rows = diffLines('one\ntwo', '');
  assert.deepEqual(countChanges(rows), { added: 0, removed: 2 });
});

test('a moved section shows as removed from one place and added in the other', () => {
  const before = ['# CV', '', '## Experience', 'a role', '', '## Education', 'a degree'].join('\n');
  const after = ['# CV', '', '## Education', 'a degree', '', '## Experience', 'a role'].join('\n');
  const rows = diffLines(before, after);
  const { added, removed } = countChanges(rows);
  assert.equal(added, removed, 'nothing was gained or lost, only reordered');
  assert.ok(added > 0);
  // And the document reconstructs exactly from what it says.
  assert.equal(rows.filter((r) => r.type !== 'remove').map((r) => r.text).join('\n'), after);
  assert.equal(rows.filter((r) => r.type !== 'add').map((r) => r.text).join('\n'), before);
});

test('a repeated line does not confuse the alignment', () => {
  // Blank lines and bullet prefixes repeat constantly in a CV; a diff that
  // matches the wrong one of them reports a change three lines from where it is.
  const before = ['- a', '', '- b', '', '- c'].join('\n');
  const after = ['- a', '', '- b', '', '- c', '', '- d'].join('\n');
  const rows = diffLines(before, after);
  assert.deepEqual(countChanges(rows), { added: 2, removed: 0 });
  assert.deepEqual(lines(rows).slice(-2), ['+', '+- d']);
});

test('whatever it says, the two documents rebuild from it exactly', () => {
  const before = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
  const after = Array.from({ length: 60 }, (_, i) => (i % 7 === 0 ? `changed ${i}` : `line ${i}`)).join('\n');
  const rows = diffLines(before, after);
  assert.equal(rows.filter((r) => r.type !== 'add').map((r) => r.text).join('\n'), before);
  assert.equal(rows.filter((r) => r.type !== 'remove').map((r) => r.text).join('\n'), after);
});

test('carriage returns do not turn a whole file into one changed line', () => {
  assert.deepEqual(countChanges(diffLines('one\r\ntwo', 'one\ntwo')), { added: 0, removed: 0 });
});

test('a document far past the size cap still answers, coarsely', () => {
  const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 50;
  const before = Array.from({ length: n }, (_, i) => `a${i}`).join('\n');
  const after = Array.from({ length: n }, (_, i) => `b${i}`).join('\n');
  const started = Date.now();
  const rows = diffLines(before, after);
  assert.ok(Date.now() - started < 3000, 'and does not lock the tab doing it');
  assert.deepEqual(countChanges(rows), { added: n, removed: n });
});

// --- what actually gets shown ------------------------------------------------

test('unchanged runs collapse to a gap, so the change is not buried', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 20', 'CHANGED');
  const shown = withContext(diffLines(before, after));
  assert.ok(shown.length < 12, `expected a short view, got ${shown.length} rows`);
  assert.equal(shown.filter((r) => r.type === 'gap').length, 2, 'one gap above, one below');
  assert.equal(shown.find((r) => r.type === 'gap').count, 17);
});

test('context is kept either side, so a change has something to sit against', () => {
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 20', 'CHANGED');
  const shown = withContext(diffLines(before, after));
  const texts = shown.map((r) => r.text);
  for (const near of ['line 17', 'line 18', 'line 19', 'line 21', 'line 22', 'line 23']) {
    assert.ok(texts.includes(near), `${near} should be shown for context`);
  }
  assert.ok(!texts.includes('line 16'), 'and nothing further out');
});

test('a single hidden line is shown rather than described', () => {
  // "1 unchanged line" is longer than the line it is hiding.
  const before = ['a', 'x', 'b', 'y', 'c'].join('\n');
  const after = ['A', 'x', 'b', 'y', 'C'].join('\n');
  const shown = withContext(diffLines(before, after), 1);
  assert.equal(shown.filter((r) => r.type === 'gap').length, 0);
});

test('a document with no changes collapses to nothing at all', () => {
  assert.deepEqual(withContext(diffLines('same\ntext', 'same\ntext')), [{ type: 'gap', count: 2 }]);
});
