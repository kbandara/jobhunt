// Why these tests exist: the failure this prevents is invisible. He adds a
// record, presses Generate, gets the same draft back, and there is nothing on
// screen — no error, no warning — to suggest the app never re-read the file. The
// second failure it prevents is worse: a mid-edit save replacing a good profile
// with a truncated one, so the CV silently loses records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { watchFile } from './live.js';

function tempFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-live-'));
  const file = path.join(dir, 'profile.md');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

/** A loader that refuses anything containing "BROKEN", the way a parser would. */
const load = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('BROKEN')) throw new Error('line 3: something is wrong');
  return text.trim().split('\n');
};

test('the file is read once up front', () => {
  const watcher = watchFile({ file: tempFile('one\ntwo'), load });
  assert.deepEqual(watcher.read().value, ['one', 'two']);
});

test('an unchanged file is not re-read', () => {
  let reads = 0;
  const file = tempFile('one');
  const watcher = watchFile({ file, load: (f) => { reads += 1; return load(f); } });
  watcher.read();
  watcher.read();
  watcher.read();
  assert.equal(reads, 1, 'the loader ran again for a file nobody touched');
});

test('an edit is picked up without a restart — the whole point', () => {
  const file = tempFile('one');
  const watcher = watchFile({ file, load });
  assert.deepEqual(watcher.read().value, ['one']);

  fs.writeFileSync(file, 'one\ntwo\nthree', 'utf8');
  assert.deepEqual(watcher.read().value, ['one', 'two', 'three']);
});

test('an edit of the same length is still noticed', () => {
  // mtime has one-second resolution on some filesystems, so size is part of the
  // signature — but a same-size edit must not be the case that slips through.
  const file = tempFile('aaa');
  const stats = [{ size: 3, mtimeMs: 1000 }, { size: 3, mtimeMs: 2000 }, { size: 3, mtimeMs: 2000 }];
  let at = 0;
  const watcher = watchFile({ file, load, stat: () => stats[Math.min(at++, stats.length - 1)] });
  fs.writeFileSync(file, 'bbb', 'utf8');
  assert.deepEqual(watcher.read().value, ['bbb']);
});

test('a file that no longer parses does NOT replace the one that did', () => {
  // This is the rule that makes watching safe. Half-finished editing is the
  // normal state of a file being edited.
  const file = tempFile('one\ntwo');
  const watcher = watchFile({ file, load });
  watcher.read();

  fs.writeFileSync(file, 'one\nBROKEN', 'utf8');
  const state = watcher.read();
  assert.deepEqual(state.value, ['one', 'two'], 'the good copy must survive a bad save');
  assert.match(state.error, /line 3/, 'and the reason must be reported, not swallowed');
});

test('fixing the file recovers on the next read — nothing to press, nothing to restart', () => {
  const file = tempFile('one');
  const watcher = watchFile({ file, load });
  watcher.read();

  fs.writeFileSync(file, 'BROKEN', 'utf8');
  assert.ok(watcher.read().error);

  fs.writeFileSync(file, 'one\ntwo', 'utf8');
  const fixed = watcher.read();
  assert.equal(fixed.error, null);
  assert.deepEqual(fixed.value, ['one', 'two']);
});

test('a broken file is retried, not written off after one failure', () => {
  // The signature must not advance on a failed parse, or a file saved broken and
  // then fixed with the same size and mtime would never be looked at again.
  const file = tempFile('one');
  const watcher = watchFile({ file, load });
  watcher.read();

  fs.writeFileSync(file, 'BROKEN', 'utf8');
  assert.ok(watcher.read().error);
  assert.ok(watcher.read().error, 'still broken, still reported');
});

test('a deleted file is reported and the last good copy is kept', () => {
  const file = tempFile('one\ntwo');
  const watcher = watchFile({ file, load });
  watcher.read();

  fs.rmSync(file);
  const state = watcher.read();
  assert.deepEqual(state.value, ['one', 'two']);
  assert.match(state.error, /could not be read/);
});

test('the reload time only moves when something actually reloaded', () => {
  const file = tempFile('one');
  const watcher = watchFile({ file, load });
  const first = watcher.read().reloadedAt;
  assert.equal(watcher.read().reloadedAt, first);
});

test('a file that does not parse at startup reports the error rather than hiding it', () => {
  // Different from every case above: there is no good copy to fall back to. It
  // used to throw, which was right when a profile always existed and wrong now
  // that a first run legitimately has none — a constructor that threw would stop
  // the app starting far enough to offer the screen that creates one. So the
  // error is carried instead, and every screen shows it.
  const watcher = watchFile({ file: tempFile('BROKEN'), load });
  const state = watcher.read();
  assert.deepEqual(state.value, [], 'nothing is invented to fill the gap');
  assert.match(state.error, /line 3/);
});
