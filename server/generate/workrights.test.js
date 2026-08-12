import test from 'node:test';
import assert from 'node:assert/strict';
import { rightsLine, contactBlock, contactLinks } from './workrights.js';
import { exampleMeta } from '../examples.js';

// One person's situation, expressed the way profile-meta.json expresses it. The
// table below is with these values substituted: the rules are the same
// rules, they are just no longer about one particular person from Sydney.
const META = {
  name: 'Rosa Kimani',
  city: 'Sydney, Australia',
  citizenship: 'Australian',
  workRights: {
    statement: 'Australian citizen',
    relocation: 'open to relocation',
    remoteNote: 'no sponsorship required for remote engagement',
    homeCountry: 'AU',
    byCountry: { GB: 'eligible for the UK Youth Mobility Scheme (unsponsored, 3 years)' },
  },
};

const AU = 'Sydney, Australia · Australian citizen';
const UK =
  'Sydney, Australia · Australian citizen, eligible for the UK Youth Mobility Scheme (unsponsored, 3 years)';
const ELSEWHERE = 'Sydney, Australia — open to relocation · Australian citizen';
const REMOTE =
  'Sydney, Australia · Australian citizen — no sponsorship required for remote engagement';

// every row.
const TABLE = [
  ['AU', 'onsite', AU],
  ['AU', 'hybrid', AU],
  ['GB', 'onsite', UK],
  ['GB', 'hybrid', UK],
  ['US', 'onsite', ELSEWHERE],
  ['US', 'hybrid', ELSEWHERE],
  ['DE', 'onsite', ELSEWHERE],
  ['SG', 'hybrid', ELSEWHERE],
  ['NZ', 'onsite', ELSEWHERE],
  ['AU', 'remote', REMOTE],
  ['GB', 'remote', REMOTE],
  ['US', 'remote', REMOTE],
  ['US', 'remote-anywhere', REMOTE],
  ['AU', 'remote-anywhere', REMOTE],
];

for (const [country, workArrangement, expected] of TABLE) {
  test(`rightsLine: ${country} + ${workArrangement}`, () => {
    const result = rightsLine(META, { country, workArrangement });
    assert.equal(result.line, expected);
    assert.equal(result.note, null);
  });
}

test('remote beats country in every direction', () => {
  for (const country of ['AU', 'GB', 'US', 'FR', 'JP']) {
    assert.equal(rightsLine(META, { country, workArrangement: 'remote' }).line, REMOTE);
  }
});

test('unspecified is treated as onsite for the country, with a note to double-check', () => {
  const rows = [
    ['AU', AU],
    ['GB', UK],
    ['US', ELSEWHERE],
  ];
  for (const [country, expected] of rows) {
    const result = rightsLine(META, { country, workArrangement: 'unspecified' });
    assert.equal(result.line, expected);
    assert.match(result.note, /unspecified/i);
    assert.match(result.note, /double-check/i);
  }
});

test('a missing work arrangement is treated the same as "unspecified"', () => {
  const result = rightsLine(META, { country: 'GB' });
  assert.equal(result.line, UK);
  assert.match(result.note, /unspecified/i);
});

test('country codes are case-insensitive and whitespace-tolerant', () => {
  assert.equal(rightsLine(META, { country: 'au', workArrangement: 'onsite' }).line, AU);
  assert.equal(rightsLine(META, { country: ' gb ', workArrangement: 'hybrid' }).line, UK);
});

test('an unknown or missing country falls back to open-to-relocation', () => {
  // No country in the ad says nothing about relocation, because there is nothing
  // to relocate to — the claim would be about a place the ad never named.
  assert.equal(rightsLine(META, { workArrangement: 'onsite' }).line, AU);
  assert.equal(rightsLine(META, { country: null, workArrangement: 'hybrid' }).line, AU);
  assert.equal(rightsLine(META, {}).line, AU);
  // A country that is neither home nor a special case does.
  assert.equal(rightsLine(META, { country: 'FR', workArrangement: 'onsite' }).line, ELSEWHERE);
});

// D012: an earlier design's "overlaps <N>h daily" line is OFF unless profile-meta
// asks for it. Somebody who would relocate is anchored wrongly by their current
// working hours.
test('no line ever claims a timezone overlap', () => {
  for (const [country, workArrangement] of TABLE) {
    const { line } = rightsLine(META, { country, workArrangement });
    assert.doesNotMatch(line, /UTC|overlap|timezone|time zone/i);
  }
});

test('every line names the citizenship, because that is the point of it', () => {
  for (const [country, workArrangement] of TABLE) {
    assert.match(rightsLine(META, { country, workArrangement }).line, /Australian citizen/);
  }
});

// --- contact block ---------------------------------------------------------

const COMPLETE_META = {
  ...META,
  email: 'rosa@example.org',
  phone: '0400 000 000',
  github: 'https://github.com/example',
  linkedin: 'https://linkedin.com/in/example',
};

const FILL_ME_META = { ...META, email: 'rosa@example.org', phone: 'FILL-ME', links: [] };

test('contactBlock builds four lines ending in the work-rights line', () => {
  const { lines, needsAttention } = contactBlock(COMPLETE_META, { country: 'GB', workArrangement: 'onsite' });
  assert.deepEqual(lines, [
    'Rosa Kimani',
    'rosa@example.org · 0400 000 000',
    '[github.com/example](https://github.com/example) · [linkedin.com/in/example](https://linkedin.com/in/example)',
    UK,
  ]);
  assert.deepEqual(needsAttention, []);
});

test('contactBlock reports every FILL-ME field instead of hiding it', () => {
  const { lines, needsAttention } = contactBlock(FILL_ME_META, { country: 'AU', workArrangement: 'onsite' });
  assert.deepEqual(needsAttention, ['phone']);
  // The placeholder stays visible in the document — a blank line would ship silently.
  assert.ok(lines.some((l) => l.includes('FILL-ME')));
  assert.equal(lines.at(-1), AU);
});

test('contactBlock passes the unspecified-arrangement note through', () => {
  const { note } = contactBlock(COMPLETE_META, { country: 'US' });
  assert.match(note, /unspecified/i);
});

test('contactBlock never invents a missing field', () => {
  const { lines, needsAttention } = contactBlock({ name: 'Rosa Kimani' }, { country: 'AU', workArrangement: 'onsite' });
  assert.equal(lines[0], 'Rosa Kimani');
  for (const field of ['email', 'phone']) {
    assert.ok(needsAttention.includes(field), `${field} should need attention`);
  }
  assert.ok(!lines.join('\n').includes('undefined'));
});

// A profile with nothing filled in gets no work-rights line at all. An empty
// line is honest; "FILL-ME · FILL-ME citizen" on a CV is not, and most people
// have no visa complexity to state in the first place.
test('an unfilled profile produces no work-rights line rather than a line of placeholders', () => {
  const { lines } = contactBlock({ name: 'Someone', email: 'a@b.c', phone: '1' }, { country: 'AU', workArrangement: 'onsite' });
  assert.deepEqual(lines, ['Someone', 'a@b.c · 1']);
});

test('"Australian" becomes "Australian citizen"; a full phrase is left alone', () => {
  const derived = contactBlock({ name: 'A', city: 'Perth', citizenship: 'Australian' }, {});
  assert.equal(derived.lines.at(-1), 'Perth · Australian citizen');
  const written = contactBlock(
    { name: 'A', city: 'Berlin', citizenship: 'EU citizen with UK settled status' },
    {},
  );
  assert.equal(written.lines.at(-1), 'Berlin · EU citizen with UK settled status');
});

test('contactBlock works on the example profile-meta.json', () => {
  const { lines, needsAttention } = contactBlock(exampleMeta(), { country: 'AU', workArrangement: 'onsite' });
  assert.equal(lines[0], 'Rosa Kimani');
  assert.ok(lines[1].startsWith('rosa.kimani@example.org'));
  assert.deepEqual(needsAttention, []);
  // Links render as markdown, so the label is readable text and the href is whole.
  assert.match(lines[2], /\[github\.com\/example\]\(https:\/\/github\.com\/example\)/);
  assert.match(lines[2], /\[orcid\.org/);
});

test('contactLinks still understands the older flat github/linkedin fields', () => {
  const links = contactLinks({ github: 'https://github.com/example', linkedin: 'https://www.linkedin.com/in/example/' });
  assert.deepEqual(links.map((l) => l.kind), ['github', 'linkedin']);
  // The label drops the scheme and any www., so it reads cleanly on the page.
  assert.equal(links[0].label, 'github.com/example');
  assert.equal(links[1].label, 'linkedin.com/in/example');
  assert.equal(links[1].url, 'https://www.linkedin.com/in/example/');
});

test('contactLinks skips a link whose url is still FILL-ME', () => {
  const links = contactLinks({ links: [
    { kind: 'github', label: 'gh', url: 'FILL-ME' },
    { kind: 'scholar', label: 'Google Scholar', url: 'https://scholar.google.com/x' },
  ] });
  assert.deepEqual(links.map((l) => l.kind), ['scholar']);
});

// --- the visa route, which is the reason this table exists ---------------------
//
// An employer advertising in the US reads "open to relocation" as "will need
// sponsorship" and stops. Naming a route that costs them almost nothing is the
// difference between being read and being filtered, and it is only sayable if
// the table can hold a different sentence per country.

const ROUTES = {
  name: 'Rosa Kimani',
  city: 'Riverina, Australia',
  citizenship: 'Australian',
  workRights: {
    relocation: 'open to relocation',
    remote: 'no sponsorship required for remote engagement',
    homeCountry: 'AU',
    byCountry: {
      AU: {},
      US: { visa: 'eligible for the E-3 visa (no lottery; the employer files a one-page LCA)' },
      GB: { relocation: 'relocating to the UK', visa: 'eligible for the Youth Mobility Scheme' },
      JP: { line: 'Riverina, Australia — visa sponsorship required' },
    },
  },
};

test('a country with a route names it, after the citizenship', () => {
  const { line, visa } = rightsLine(ROUTES, { country: 'US', workArrangement: 'onsite' });
  assert.equal(line, 'Riverina, Australia · Australian citizen, eligible for the E-3 visa (no lottery; the employer files a one-page LCA)');
  assert.match(visa, /E-3/);
});

test('a country entry may set its own relocation phrase as well as its route', () => {
  const { line } = rightsLine(ROUTES, { country: 'GB', workArrangement: 'hybrid' });
  assert.equal(
    line,
    'Riverina, Australia — relocating to the UK · Australian citizen, eligible for the Youth Mobility Scheme',
  );
});

test('a country entry may replace the whole line, for when the wording reads badly', () => {
  const { line } = rightsLine(ROUTES, { country: 'JP', workArrangement: 'onsite' });
  assert.equal(line, 'Riverina, Australia — visa sponsorship required');
});

test('the home country gets no relocation clause and no route', () => {
  assert.equal(rightsLine(ROUTES, { country: 'AU', workArrangement: 'onsite' }).line, 'Riverina, Australia · Australian citizen');
});

test('a country with no entry falls back to the general relocation phrase', () => {
  const { line, visa } = rightsLine(ROUTES, { country: 'DE', workArrangement: 'onsite' });
  assert.equal(line, 'Riverina, Australia — open to relocation · Australian citizen');
  assert.equal(visa, null, 'no route is claimed for a country nobody thought about');
});

// Remote wins over the whole table, in every direction: there is no visa
// question, so raising one would invent a problem the reader did not have.
test('a remote role never mentions a visa, even in a country with a route', () => {
  for (const country of ['US', 'GB', 'JP', 'DE']) {
    const { line, visa } = rightsLine(ROUTES, { country, workArrangement: 'remote' });
    assert.equal(visa, null, country);
    // None of the per-country wording leaks through — not a route, and not the
    // JP entry's whole-line override either.
    assert.doesNotMatch(line, /E-3|Youth Mobility|visa sponsorship required/, country);
    assert.match(line, /no sponsorship required for remote engagement/);
  }
});

test('a route is never invented for somebody who wrote none', () => {
  const bare = { name: 'A', city: 'Berlin', citizenship: 'German' };
  const { line, visa } = rightsLine(bare, { country: 'US', workArrangement: 'onsite' });
  assert.equal(visa, null);
  assert.equal(line, 'Berlin · German citizen', 'no relocation phrase was written, so none is claimed');
});

test('the example profile carries a route for the US, since that is the case it exists for', () => {
  const { lines } = contactBlock(exampleMeta(), { country: 'US', workArrangement: 'onsite' });
  assert.match(lines.at(-1), /E-3/);
  assert.doesNotMatch(lines.join('\n'), /FILL-ME/);
});
