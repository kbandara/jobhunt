// WHY: the point of the profile registry is that adding a profile is adding a FILE —
// no code change anywhere. These tests hold that promise to account: every profile on
// disk loads and validates, a broken one fails loudly with the file name in the
// message, and the older flat `sectionOrder` keeps working alongside `sections`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProfiles, getProfile, profileIds, profileSummaries, normaliseSections, REGISTERS } from './profiles/index.js';
import { SECTION_IDS, SECTION_CATALOGUE, headingFor, aliasesFor } from './sections.js';
import { profilePrompt } from './generate.js';
import { readText } from '../store.js';
import { exampleEvidence } from '../examples.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(HERE, 'prompts', 'profiles');

/** A profile file with everything required, so a test can break one thing at a time. */
const VALID = {
  id: 'demo',
  description: 'A profile invented by a test.',
  evidenceProfiles: ['research'],
  register: 'mixed',
  sectionOrder: ['summary', 'experience'],
  publications: { policy: 'brief', count: 2, style: 'one-line' },
  kindPriority: { role: 5 },
};

/** Write profile files into a throwaway folder and load them from there. */
function profileDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-profiles-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

// --- the profiles actually on disk ---------------------------------------------

test('every profile file in the folder loads, and the four originals are still there', () => {
  const ids = profileIds();
  for (const id of ['industry-research', 'research', 'public-sector', 'industry']) {
    assert.ok(ids.includes(id), `${id} disappeared`);
  }
  assert.equal(new Set(ids).size, ids.length, 'no duplicate profile ids');
});

// Every shipped profile draws on every record. It has to: evidence tags are a
// vocabulary each person invents, so a shipped profile naming particular tags
// would match nothing at all in a profile written by somebody who called theirs
// something else. Narrowing is for profiles you write yourself.
test('every shipped profile draws on all of your records', () => {
  for (const profile of loadProfiles().values()) {
    assert.deepEqual(profile.evidenceProfiles, ['*'], profile.id);
  }
});

test('the shipped profiles are the ones the app documents', () => {
  // Sorted by id, so data-science comes first. Adding a file here means updating
  // the table in README.md and the list on the landing page — this test failing
  // is the reminder to do that.
  const expected = [
    'data-science', 'general', 'industry', 'industry-research', 'public-sector', 'research', 'teaching',
  ];
  assert.deepEqual([...loadProfiles().keys()], expected);
  assert.equal(getProfile('teaching').register, 'mixed');
  assert.equal(getProfile('research').register, 'specialist');
  assert.equal(getProfile('industry-research').register, 'specialist');
  assert.equal(getProfile('general').register, 'mixed');
  // Technical reader, so specialist vocabulary is allowed where a record supports
  // it — but not the full specialist register that assumes a peer in the field.
  assert.equal(getProfile('data-science').register, 'mixed');
});

test('the data-science profile leads with the stack, which is what its reader scans for', () => {
  const profile = getProfile('data-science');
  const order = profile.sections.map((section) => section.id);
  assert.deepEqual(order, ['summary', 'skills', 'experience', 'projects', 'education', 'publications']);
  assert.ok(
    order.indexOf('skills') < order.indexOf('experience'),
    'skills above experience is the whole point of this profile existing separately from industry',
  );
  // Projects are evidence in this field, so they are weighted like a role rather
  // than like a footnote.
  assert.equal(profile.kindPriority.project, profile.kindPriority.role);
  assert.equal(profile.publications.count, 3);
});

test('every profile has a description, a register, and evidence profiles it can draw from', () => {
  for (const profile of loadProfiles().values()) {
    assert.equal(typeof profile.description, 'string', `${profile.id} description`);
    assert.ok(profile.description.trim().length > 0, `${profile.id} has an empty description`);
    assert.ok(REGISTERS.includes(profile.register), `${profile.id} register is "${profile.register}"`);
    assert.ok(profile.evidenceProfiles.length > 0, `${profile.id} draws evidence from nothing`);
    assert.ok(profile.sections.length > 0, `${profile.id} has no sections`);
  }
});

// The failure this guards against: a profile whose evidenceProfiles name tags
// nobody has used matches zero records, and produces a CV with nothing on it and
// no visible reason why.
test('every profile reaches the records in a real profile', () => {
  const tags = new Set(exampleEvidence().flatMap((record) => record.evidenceProfiles));
  for (const profile of loadProfiles().values()) {
    assert.ok(
      profile.evidenceProfiles.includes('*') || profile.evidenceProfiles.some((tag) => tags.has(tag)),
      `${profile.id} draws from ${profile.evidenceProfiles.join(', ')}, none of which any record carries`,
    );
  }
});

test('profileSummaries is exactly what the UI needs, in the same order as profileIds', () => {
  const summaries = profileSummaries();
  assert.deepEqual(summaries.map((s) => s.id), profileIds());
  for (const summary of summaries) assert.deepEqual(Object.keys(summary).sort(), ['description', 'id']);
});

test('profile ids are sorted, so the dropdown never depends on the filesystem', () => {
  assert.deepEqual(profileIds(), [...profileIds()].sort((a, b) => a.localeCompare(b, 'en')));
});

test('getProfile returns null for an id that is not a file', () => {
  assert.equal(getProfile('astrophysics'), null);
  assert.equal(getProfile(undefined), null);
});

// --- validation --------------------------------------------------------------

for (const key of ['id', 'description', 'evidenceProfiles', 'register', 'publications', 'kindPriority']) {
  test(`a profile file missing "${key}" throws, naming the file and the key`, () => {
    const broken = { ...VALID };
    delete broken[key];
    const dir = profileDir({ 'demo.json': broken });
    assert.throws(() => loadProfiles({ dir }), (err) => {
      assert.match(err.message, /demo\.json/, 'the message must name the file');
      assert.ok(err.message.includes(`"${key}"`), `the message must name "${key}": ${err.message}`);
      return true;
    });
  });
}

test('a profile file with neither sections nor sectionOrder throws', () => {
  const broken = { ...VALID };
  delete broken.sectionOrder;
  const dir = profileDir({ 'demo.json': broken });
  assert.throws(() => loadProfiles({ dir }), /demo\.json.*sections/s);
});

test('a profile whose id does not match its file name throws', () => {
  const dir = profileDir({ 'demo.json': { ...VALID, id: 'something-else' } });
  assert.throws(() => loadProfiles({ dir }), /demo\.json.*something-else/s);
});

test('an unknown register throws and lists the ones that work', () => {
  const dir = profileDir({ 'demo.json': { ...VALID, register: 'very technical' } });
  assert.throws(() => loadProfiles({ dir }), /specialist, mixed, general/);
});

test('an empty evidenceProfiles throws, because the profile would match nothing', () => {
  const dir = profileDir({ 'demo.json': { ...VALID, evidenceProfiles: [] } });
  assert.throws(() => loadProfiles({ dir }), /evidenceProfiles/);
});

// --- adding a profile is adding a file ------------------------------------------

test('a brand new profile file is picked up with no code change at all', () => {
  const dir = profileDir({
    'demo.json': VALID,
    'another.json': { ...VALID, id: 'another', description: 'A second invented profile.' },
  });
  const profiles = loadProfiles({ dir });
  assert.deepEqual([...profiles.keys()], ['another', 'demo']);
  assert.equal(profiles.get('demo').description, 'A profile invented by a test.');
});

test('files that are not .json are ignored, so index.js is not read as a profile', () => {
  const dir = profileDir({ 'demo.json': VALID, 'index.js': 'export default 1;', 'notes.md': '# hello' });
  assert.deepEqual([...loadProfiles({ dir }).keys()], ['demo']);
});

// --- sectionOrder / sections normalisation -----------------------------------

test('the old flat sectionOrder is normalised into the new sections shape', () => {
  const profiles = loadProfiles({ dir: profileDir({ 'demo.json': VALID }) });
  const profile = profiles.get('demo');
  assert.deepEqual(profile.sectionOrder, ['summary', 'experience']);
  assert.deepEqual(profile.sections.map((s) => s.id), ['summary', 'experience']);
  assert.equal(profile.sections[1].defaultHeading, 'Experience');
});

test('sections wins when a profile has both, and sectionOrder is kept in step', () => {
  const dir = profileDir({
    'demo.json': {
      ...VALID,
      sectionOrder: ['summary', 'experience'],
      sections: [{ id: 'summary' }, { id: 'publications', max: 4 }, { id: 'skills', heading: 'Toolkit' }],
    },
  });
  const profile = loadProfiles({ dir }).get('demo');
  assert.deepEqual(profile.sections.map((s) => s.id), ['summary', 'publications', 'skills']);
  assert.deepEqual(profile.sectionOrder, ['summary', 'publications', 'skills']);
  assert.equal(profile.sections[1].max, 4);
  assert.equal(profile.sections[2].heading, 'Toolkit');
});

test('normaliseSections handles a raw config read straight off disk', () => {
  assert.deepEqual(normaliseSections({ sectionOrder: ['summary'] }).map((s) => s.id), ['summary']);
  assert.deepEqual(normaliseSections({ sections: [{ id: 'summary' }] }).map((s) => s.id), ['summary']);
  assert.deepEqual(normaliseSections({}), []);
  assert.deepEqual(normaliseSections(null), []);
});

// --- the section catalogue ---------------------------------------------------

test('the section catalogue holds the agreed ids, each with a heading', () => {
  assert.deepEqual(SECTION_IDS, [
    'summary', 'clearance', 'skills', 'experience', 'projects', 'research',
    'publications', 'education', 'teaching', 'awards', 'service', 'additional',
  ]);
  for (const section of SECTION_CATALOGUE) {
    assert.equal(typeof section.heading, 'string');
    assert.ok(section.heading.length > 0, `${section.id} has no heading`);
    assert.ok(section.aliases.length > 0, `${section.id} has no aliases`);
  }
  assert.equal(headingFor('clearance'), 'Security Clearance');
  assert.equal(headingFor('additional'), 'Additional');
});

test('an unknown section id still matches itself rather than throwing', () => {
  assert.deepEqual(aliasesFor('field-work'), ['field work']);
  assert.equal(headingFor('field-work'), 'field-work');
});

test('every section a profile names is one the renderer knows how to find', () => {
  for (const profile of loadProfiles().values()) {
    for (const section of profile.sections) {
      assert.ok(
        aliasesFor(section.id).length > 0,
        `${profile.id} names a section "${section.id}" with nothing to match on`,
      );
    }
  }
});

// --- prompts -----------------------------------------------------------------

test('every profile on disk has a hand-written prompt file', () => {
  for (const id of profileIds()) {
    assert.ok(fs.existsSync(path.join(PROMPT_DIR, `${id}.md`)), `server/generate/prompts/profiles/${id}.md is missing`);
  }
});

test('a profile with no prompt file falls back to a block built from its config', () => {
  const built = profilePrompt('demo-no-prompt-file', {
    ...VALID,
    id: 'demo-no-prompt-file',
    lengthPages: 2,
    clearance: 'first-line',
    techSectionName: 'Toolkit',
    sections: normaliseSections(VALID),
  });

  assert.match(built, /# Profile: demo-no-prompt-file/);
  assert.match(built, /A profile invented by a test\./);
  assert.match(built, /Section order: Summary, Experience/);
  assert.match(built, /2 pages/);
  assert.match(built, /Call the technical section "Toolkit"/);
});

test('an unknown profile produces a usable prompt instead of crashing generation', () => {
  const built = profilePrompt('not-a-profile-at-all');
  assert.match(built, /not-a-profile-at-all/);
  assert.ok(built.length > 0);
});

// --- length is guidance, never a ceiling ------------------------------------
//
// Why: the question came up whether the CV was restricted to under two pages. It was —
// `lengthPages` plus a line in each profile prompt, one of which said "treat
// that as a hard ceiling". A page count is a bad instrument for this anyway:
// the model is writing markdown and cannot see where a page break falls, so any
// hard limit is enforced by guessing, and a CV that drops something the ad
// asked for to fit a page has been made worse rather than shorter.

const promptDir = path.join(HERE, 'prompts', 'profiles');
const promptFiles = fs.readdirSync(promptDir).filter((name) => name.endsWith('.md'));

test('no profile prompt states a hard page ceiling', () => {
  for (const name of promptFiles) {
    const text = readText(path.join(promptDir, name));
    assert.doesNotMatch(text, /hard ceiling/i, name);
    assert.doesNotMatch(text, /\bkeep it to \w+ pages?\b/i, name);
    // "Two pages." as a bare sentence reads as a rule; "roughly two pages" does not.
    assert.doesNotMatch(text, /(?:^|[.;] )(?:Two|Three|One) pages?\./m, name);
  }
});

test('a profile that states a length says it is a guide', () => {
  for (const name of promptFiles) {
    const text = readText(path.join(promptDir, name));
    if (!/\bpages?\b/i.test(text)) continue;
    // Whitespace-tolerant: these files are hand-wrapped at 80 columns, so the
    // phrase routinely straddles a line break.
    assert.match(
      text,
      /guide,?\s+(?:not|rather\s+than)\s+a\s+(?:limit|ceiling)|no\s+page\s+limit/i,
      `${name} mentions pages without saying it is guidance`,
    );
  }
});

test('the generated fallback prompt offers a target, not a cap', () => {
  const withLength = profilePrompt('made-up', { ...VALID, lengthPages: 2, sections: [{ id: 'summary' }] });
  assert.match(withLength, /Aim for roughly 2 pages/);
  assert.match(withLength, /guide, not a limit/);
  assert.doesNotMatch(withLength, /Keep it to/);

  const noLength = profilePrompt('made-up', { ...VALID, lengthPages: null, sections: [{ id: 'summary' }] });
  assert.match(noLength, /no target length/i);
});
