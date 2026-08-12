import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJson, writeJson, appendJsonl, readJsonl, readText } from './store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-store-'));
}

test('writeJson then readJson round-trips', () => {
  const file = path.join(tmpDir(), 'a', 'b.json'); // nested dir must be created
  writeJson(file, { x: 1, y: ['z'] });
  assert.deepEqual(readJson(file), { x: 1, y: ['z'] });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('readJson strips a UTF-8 BOM (the PowerShell case)', () => {
  const file = path.join(tmpDir(), 'bom.json');
  fs.writeFileSync(file, '﻿{"ok":true}', 'utf8');
  assert.deepEqual(readJson(file), { ok: true });
});

test('readJson returns fallback for a missing file, throws without one', () => {
  const file = path.join(tmpDir(), 'missing.json');
  assert.deepEqual(readJson(file, []), []);
  assert.throws(() => readJson(file));
});

test('readJson names the file on a parse failure', () => {
  const file = path.join(tmpDir(), 'bad.json');
  fs.writeFileSync(file, '{nope', 'utf8');
  assert.throws(() => readJson(file), new RegExp('bad\\.json'));
});

test('appendJsonl accumulates lines readJsonl reads back, BOM-safe', () => {
  const file = path.join(tmpDir(), 'events.jsonl');
  appendJsonl(file, { n: 1 });
  appendJsonl(file, { n: 2 });
  assert.deepEqual(readJsonl(file), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(readJsonl(path.join(tmpDir(), 'none.jsonl')), []);
});

test('readText strips a BOM', () => {
  const file = path.join(tmpDir(), 't.md');
  fs.writeFileSync(file, '﻿# hi', 'utf8');
  assert.equal(readText(file), '# hi');
});
