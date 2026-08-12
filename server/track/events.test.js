// Why these tests exist: the event log is append-only and nothing reads it yet
// (D009), which means a fault in here is invisible until the day you want to
// know how long applications take to get a reply — and by then the data is
// already wrong. The whitelist test at the bottom is the one that has already
// caught real bugs.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../store.js';
import { EVENT_TYPES, logEvent, readEvents, eventsFile } from './events.js';

const dirs = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'));
  dirs.push(dir);
  return dir;
}

test('an event is appended with a timestamp and the fields it was given', () => {
  const dir = tempDir();
  const line = logEvent(dir, { jobId: 'j1', type: 'scored', cappedScore: 71 });
  assert.equal(line.jobId, 'j1');
  assert.equal(line.type, 'scored');
  assert.equal(line.cappedScore, 71, 'extra fields ride along');
  assert.match(line.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test('events accumulate in order and nothing is overwritten', () => {
  const dir = tempDir();
  logEvent(dir, { jobId: 'j1', type: 'created' });
  logEvent(dir, { jobId: 'j1', type: 'parsed' });
  logEvent(dir, { jobId: 'j2', type: 'created' });
  const events = readEvents(dir);
  assert.deepEqual(events.map((e) => e.type), ['created', 'parsed', 'created']);
});

test('an unknown type throws rather than being written', () => {
  const dir = tempDir();
  assert.throws(() => logEvent(dir, { jobId: 'j1', type: 'invented' }), /Unknown event type/);
  assert.equal(fs.existsSync(eventsFile(dir)), false, 'nothing was written');
});

test('reading a log that does not exist yet gives an empty list, not an error', () => {
  assert.deepEqual(readEvents(tempDir()), []);
});

test('an event with no jobId is allowed and records null', () => {
  const dir = tempDir();
  assert.equal(logEvent(dir, { type: 'created' }).jobId, null);
});

// Why this test exists: EVENT_TYPES is a whitelist and logEvent THROWS on a
// type that is not in it. That throw happens deep inside a route, AFTER the
// real work has been done and saved — so adding a route with a new event type
// ships a 500 on a request that actually succeeded, and you see a failure for
// something that worked. This has already happened twice (doc-revised,
// profile-created). This catches the third one.
test('every event type the server logs is in the whitelist', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readText(path.join(here, '..', 'index.js'));
  const used = new Set();
  // logEvent(dataDir, { ... type: 'x' ... }) — the type key inside a logEvent call.
  for (const call of source.matchAll(/logEvent\(\s*\w+\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    const type = /\btype:\s*'([a-z-]+)'/.exec(call[1]);
    if (type) used.add(type[1]);
  }

  assert.ok(used.size >= 8, `only found ${used.size} logEvent calls — has the call shape changed?`);
  for (const type of used) {
    assert.ok(EVENT_TYPES.includes(type), `server/index.js logs "${type}", which EVENT_TYPES does not allow`);
  }
});
