// Why these tests exist: the transcript is what makes "no, shorter" mean
// anything. If it silently stops being sent, the feature degrades into the
// one-shot box it replaced and nothing fails — it just quietly gets worse.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readChat,
  appendTurn,
  clearChat,
  chatFile,
  transcriptFor,
  HISTORY_TURNS,
  MAX_TEXT,
} from './chat.js';
import { saveVersion } from './docs.js';

const dirs = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'));
  dirs.push(dir);
  return dir;
}

test('a conversation that has not started is empty, not an error', () => {
  assert.deepEqual(readChat(tempDir(), 'j1', 'cv'), []);
});

test('turns come back in the order they were said', () => {
  const dir = tempDir();
  appendTurn(dir, 'j1', 'cv', { role: 'you', text: 'first' });
  appendTurn(dir, 'j1', 'cv', { role: 'model', text: 'second' });
  appendTurn(dir, 'j1', 'cv', { role: 'you', text: 'third' });
  assert.deepEqual(readChat(dir, 'j1', 'cv').map((t) => t.text), ['first', 'second', 'third']);
});

test('every turn gets a distinct id, even within the same millisecond', () => {
  const dir = tempDir();
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) ids.add(appendTurn(dir, 'j1', 'cv', { text: `m${i}` }).id);
  assert.equal(ids.size, 50, 'duplicate ids would make the list re-animate on every render');
});

test('an unknown role becomes "you" rather than being stored as-is', () => {
  const dir = tempDir();
  assert.equal(appendTurn(dir, 'j1', 'cv', { role: 'system', text: 'x' }).role, 'you');
  assert.equal(appendTurn(dir, 'j1', 'cv', { role: 'model', text: 'x' }).role, 'model');
});

test('a runaway message is truncated rather than stored whole', () => {
  const dir = tempDir();
  const turn = appendTurn(dir, 'j1', 'cv', { text: 'x'.repeat(MAX_TEXT * 3) });
  assert.equal(turn.text.length, MAX_TEXT);
});

test('extra fields the UI shows survive the round trip', () => {
  const dir = tempDir();
  appendTurn(dir, 'j1', 'cv', {
    role: 'model', text: 'done', revised: true, version: 3,
    changes_made: ['tightened the summary'], costCents: 4,
  });
  const [turn] = readChat(dir, 'j1', 'cv');
  assert.equal(turn.revised, true);
  assert.equal(turn.version, 3);
  assert.deepEqual(turn.changes_made, ['tightened the summary']);
  assert.equal(turn.costCents, 4);
});

test('a CV and a cover letter hold separate conversations', () => {
  const dir = tempDir();
  appendTurn(dir, 'j1', 'cv', { text: 'about the cv' });
  appendTurn(dir, 'j1', 'cover-letter', { text: 'about the letter' });
  assert.deepEqual(readChat(dir, 'j1', 'cv').map((t) => t.text), ['about the cv']);
  assert.deepEqual(readChat(dir, 'j1', 'cover-letter').map((t) => t.text), ['about the letter']);
});

test('so do two jobs', () => {
  const dir = tempDir();
  appendTurn(dir, 'j1', 'cv', { text: 'job one' });
  appendTurn(dir, 'j2', 'cv', { text: 'job two' });
  assert.deepEqual(readChat(dir, 'j1', 'cv').map((t) => t.text), ['job one']);
});

test('clearing forgets the conversation and nothing else', () => {
  const dir = tempDir();
  saveVersion(dir, 'j1', 'cv', { markdown: '# A draft' });
  appendTurn(dir, 'j1', 'cv', { text: 'something' });

  clearChat(dir, 'j1', 'cv');

  assert.deepEqual(readChat(dir, 'j1', 'cv'), []);
  // The point: a chat is not a way to lose a draft.
  assert.equal(fs.readFileSync(path.join(dir, 'apps', 'j1', 'cv.md'), 'utf8'), '# A draft');
});

test('clearing a conversation that never existed is not an error', () => {
  const dir = tempDir();
  assert.doesNotThrow(() => clearChat(dir, 'j1', 'cv'));
  assert.equal(fs.existsSync(chatFile(dir, 'j1', 'cv')), false);
});

test('a conversation survives being written to after it was cleared', () => {
  const dir = tempDir();
  appendTurn(dir, 'j1', 'cv', { text: 'before' });
  clearChat(dir, 'j1', 'cv');
  appendTurn(dir, 'j1', 'cv', { text: 'after' });
  assert.deepEqual(readChat(dir, 'j1', 'cv').map((t) => t.text), ['after']);
});

// --- what the model is shown -------------------------------------------------

test('nothing said yet renders as an empty string, so the section can be omitted', () => {
  assert.equal(transcriptFor([]), '');
});

test('the transcript labels who said what', () => {
  const text = transcriptFor([
    { role: 'you', text: 'make it shorter' },
    { role: 'model', text: 'Cut two bullets.' },
  ]);
  assert.match(text, /He asked: make it shorter/);
  assert.match(text, /You said: Cut two bullets\./);
});

test('a turn that rewrote the document says so, so "undo that" is answerable', () => {
  const text = transcriptFor([{ role: 'model', text: 'Tightened it.', revised: true }]);
  assert.match(text, /You said \(and you rewrote the document\): Tightened it\./);
});

test('only the recent turns are sent, because every one is paid for again', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ role: 'you', text: `message ${i}` }));
  const text = transcriptFor(many);
  assert.equal(text.split('\n\n').length, HISTORY_TURNS);
  assert.match(text, /message 39/, 'and it is the LAST ones that are kept');
  assert.doesNotMatch(text, /message 0\b/);
});

test('the limit is adjustable, so a caller can send less', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ role: 'you', text: `m${i}` }));
  assert.equal(transcriptFor(many, 2).split('\n\n').length, 2);
});

test('a garbled turn does not break the transcript', () => {
  assert.doesNotThrow(() => transcriptFor([{ role: 'you' }, {}, { text: null }]));
});
