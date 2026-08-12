// Why these tests exist: the default selection is what you will accept most of
// the time, so it is effectively the feature. The first version of it ranked by
// relevance alone and proposed a publication list of four unsubmitted
// manuscripts and zero peer-reviewed papers — see proposeFrom. It looked
// perfectly reasonable in code and was obviously wrong on screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../store.js';
import { exampleEvidence, exampleMeta } from '../examples.js';
import { surnameFrom } from '../profile/citation.js';
import { selectEvidence } from './select-evidence.js';
import { publicationList, proposeFrom, renderSelected, unknownIds } from './publications.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = (id) => readJson(path.join(here, 'profiles', `${id}.json`));
const evidence = exampleEvidence();
const SURNAME = surnameFrom(exampleMeta());

const JD = {
  title: 'Research Fellow, River Ecology',
  skills: ['r', 'statistics', 'monitoring'],
  requirements: [{ text: 'designing and running long-term monitoring programmes', kind: 'experience', mustHave: true }],
};

const propose = (id) => {
  const config = profile(id);
  const { selected } = selectEvidence({ evidence, jdJson: JD, profile: id, profileConfig: config });
  return proposeFrom(selected, evidence, config);
};

const statusOf = (id) => publicationList({ surname: SURNAME, evidence }).find((p) => p.id === id)?.status;

// --- the default selection --------------------------------------------------

test('a profile that omits publications proposes none', () => {
  assert.deepEqual(propose('public-sector'), []);
});

test('a profile that takes all of them proposes all of them', () => {
  const all = publicationList({ surname: SURNAME, evidence }).length;
  assert.equal(propose('research').length, all);
});

test('a counted profile proposes exactly its count', () => {
  assert.equal(propose('industry-research').length, profile('industry-research').publications.count);
  assert.equal(propose('industry').length, profile('industry').publications.count);
});

test('the peer-reviewed first-author paper is never crowded out by manuscripts', () => {
  // The exact failure this rule exists for: the 2025 peer-reviewed paper is the
  // strongest single item on the CV, and relevance-by-recency dropped it in
  // favour of 2026 manuscripts nobody has accepted.
  for (const id of ['industry-research', 'industry', 'research']) {
    assert.ok(propose(id).includes('pub-turnover'), `${id} left off the strongest paper`);
  }
});

test('at most half the proposed list is unpublished', () => {
  for (const id of ['industry-research', 'industry', 'research']) {
    const proposed = propose(id);
    const unpublished = proposed.filter((pubId) => statusOf(pubId) !== 'published').length;
    assert.ok(
      unpublished <= Math.ceil(proposed.length / 2),
      `${id}: ${unpublished} of ${proposed.length} are unpublished`,
    );
  }
});

test('relevance still decides WHICH manuscripts, when there is room for any', () => {
  // pub-monitoring is the manuscript whose own record is about monitoring, so a
  // monitoring ad should surface it ahead of the others.
  assert.ok(propose('industry-research').includes('pub-monitoring'));
});

test('the proposal is in citation order, not relevance order', () => {
  const proposed = propose('industry-research');
  const order = publicationList({ surname: SURNAME, evidence }).map((p) => p.id);
  const positions = proposed.map((id) => order.indexOf(id));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('proposing is deterministic', () => {
  assert.deepEqual(propose('industry-research'), propose('industry-research'));
});

test('a profile with no publication policy still proposes something usable', () => {
  const proposed = proposeFrom([], evidence, {});
  assert.ok(proposed.length > 0);
  assert.ok(proposed.includes('pub-turnover'));
});

// --- the list the picker draws ----------------------------------------------

test('the list carries every publication, ticked or not', () => {
  const list = publicationList({ surname: SURNAME, evidence, proposed: propose('industry-research') });
  assert.equal(list.length, evidence.filter((r) => r.kind === 'publication').length);
  assert.equal(list.filter((p) => p.selected).length, 5);
});

test('an explicit selection overrides the proposal completely', () => {
  const list = publicationList({ surname: SURNAME, evidence, selected: ['pub-riverkit'], proposed: propose('industry-research') });
  assert.deepEqual(list.filter((p) => p.selected).map((p) => p.id), ['pub-riverkit']);
});

test('an empty explicit selection means none, not "fall back to the proposal"', () => {
  // The distinction that matters: `selected: []` is you unticking everything, and
  // quietly re-proposing would put papers back onto a CV you took them off.
  const list = publicationList({ surname: SURNAME, evidence, selected: [], proposed: propose('industry-research') });
  assert.equal(list.filter((p) => p.selected).length, 0);
});

test('each entry carries what the picker shows', () => {
  const entry = publicationList({ surname: SURNAME, evidence }).find((p) => p.id === 'pub-turnover');
  assert.match(entry.apa, /^Kimani, R\./);
  assert.equal(entry.status, 'published');
  assert.equal(entry.firstAuthor, true);
  assert.equal(entry.note, 'First author.');
  assert.deepEqual(entry.problems, []);
});

// --- rendering --------------------------------------------------------------

test('rendering returns APA lines in citation order for the chosen ids', () => {
  const lines = renderSelected({ evidence, selected: ['pub-occupancy', 'pub-turnover'] });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Flow regulation reduces/, 'published comes first whatever order was asked for');
  assert.match(lines[1], /\[Manuscript in preparation\]/);
});

test('an id that no longer exists is dropped, not thrown', () => {
  // A job saved before a record was renamed must still generate.
  const lines = renderSelected({ evidence, selected: ['pub-turnover', 'pub-deleted'] });
  assert.equal(lines.length, 1);
});

test('unknownIds names exactly the ids with no record', () => {
  assert.deepEqual(unknownIds({ evidence, selected: ['pub-turnover', 'pub-nope'] }), ['pub-nope']);
  assert.deepEqual(unknownIds({ evidence, selected: [] }), []);
});

test('nothing here throws on empty input', () => {
  assert.doesNotThrow(() => publicationList({}));
  assert.deepEqual(renderSelected({}), []);
  assert.deepEqual(proposeFrom(), []);
});
