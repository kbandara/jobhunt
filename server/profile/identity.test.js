// Why these tests exist: this app started as one person's, and that person used
// to be spelled out in the source — a surname constant in the citation parser,
// two regexes in the validator, a name in two prompts. In anybody else's copy
// each of those was actively wrong: it decided whether THEY were first author by
// looking for a stranger's surname, and watched for a "Dr" in front of a name
// they do not have.
//
// The guard at the bottom is the part that keeps it fixed. It reads the whole
// repository and fails if a personal fact — or a file that should live under
// data/ — is written back into it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nameParts, honorificPattern, postNominalPattern, describePerson, qualificationNote } from './identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

// --- reading a name ------------------------------------------------------------

test('the last word is the family name and the first is the given name', () => {
  const { given, surname, full } = nameParts({ name: 'Ada M. Lovelace' });
  assert.equal(given, 'Ada');
  assert.equal(surname, 'Lovelace');
  assert.equal(full, 'Ada M. Lovelace');
});

test('an initial is never mistaken for the family name', () => {
  // "A. H. Okonkwo" must not decide that "H." is the surname and then look for
  // "H." in every author list.
  assert.equal(nameParts({ name: 'A. H. Okonkwo' }).surname, 'Okonkwo');
  assert.equal(nameParts({ name: 'Ada M. Lovelace' }).surname, 'Lovelace');
});

test('a particle belongs to the name it precedes', () => {
  // The last-word rule would make these "Berg", "Groot" and "Rashid" — and then
  // fail to notice their own first-authored papers.
  assert.equal(nameParts({ name: 'Maria van der Berg' }).surname, 'van der Berg');
  assert.equal(nameParts({ name: 'Joris de Groot' }).surname, 'de Groot');
  assert.equal(nameParts({ name: 'Amina bint Rashid' }).surname, 'Rashid', 'only known particles count');
});

test('a suffix is not a family name', () => {
  assert.equal(nameParts({ name: 'Chidi Okafor Jr.' }).surname, 'Okafor');
  assert.equal(nameParts({ name: 'Harold Vance III' }).surname, 'Vance');
});

test('a mononym is a name, not an error', () => {
  const { given, surname } = nameParts({ name: 'Prince' });
  assert.equal(given, 'Prince');
  assert.equal(surname, 'Prince');
});

test('explicit given and surname win, for every name the rule gets wrong', () => {
  // Family name first, particles, multiple family names — the escape hatch has
  // to exist, because no rule about names is right for everybody.
  const parts = nameParts({ name: '陈 伟', given: '伟', surname: '陈' });
  assert.equal(parts.surname, '陈');
  assert.equal(parts.given, '伟');
});

test('a preferred name counts as one of theirs', () => {
  assert.ok(nameParts({ name: 'Rosa Kimani', preferred: 'Ro' }).aliases.includes('Ro'));
});

test('an empty profile yields empty parts rather than throwing', () => {
  for (const meta of [{}, null, undefined, { name: '   ' }]) {
    assert.doesNotThrow(() => nameParts(meta));
    assert.deepEqual(nameParts(meta).aliases, []);
  }
});

// --- the patterns the validator uses ---------------------------------------------

test('"Dr" in front of their own name matches', () => {
  const pattern = honorificPattern({ name: 'Ada M. Lovelace' });
  assert.ok(pattern.test('Dr Lovelace led the work'));
  assert.ok(pattern.test('Dr. Ada Lovelace'));
  assert.ok(pattern.test('Dr A. M. Lovelace'), 'initials in between are still their name');
});

test('"Dr" in front of somebody else does NOT match', () => {
  // The profile legitimately names supervisors and co-authors. Flagging a true
  // statement about one of them is how a validator loses its authority.
  const pattern = honorificPattern({ name: 'Ada M. Lovelace' });
  assert.ok(!pattern.test('supervised by Dr Elise Rowe'));
  assert.ok(!pattern.test('Dr Charles Babbage'));
});

test('the post-nominal pattern matches their surname and nobody else’s', () => {
  const pattern = postNominalPattern({ name: 'Ada M. Lovelace' });
  assert.ok(pattern.test('Lovelace, PhD'));
  assert.ok(pattern.test('Lovelace PhD'));
  assert.ok(!pattern.test('Babbage, PhD'));
});

test('a name full of punctuation cannot break the pattern', () => {
  // O'Brien, Smith-Jones, and anything with a dot in it are regex specials.
  for (const name of ["Fiona O'Brien", 'Ann Smith-Jones', 'A. B. C.']) {
    assert.doesNotThrow(() => honorificPattern({ name }));
    assert.doesNotThrow(() => postNominalPattern({ name }));
  }
  assert.ok(honorificPattern({ name: "Fiona O'Brien" }).test("Dr O'Brien"));
});

test('with no name there is no pattern, which is the honest answer', () => {
  // With nothing to compare against, every "Dr" in a document is somebody
  // else's — so the check must not fire at all rather than guess.
  assert.equal(honorificPattern({}), null);
  assert.equal(postNominalPattern({}), null);
});

// --- describing them for a prompt ------------------------------------------------

test('the headline is used when there is one, and the name alone when there is not', () => {
  assert.equal(
    describePerson({ name: 'Ada M. Lovelace', headline: 'a mathematician' }),
    'Ada M. Lovelace, a mathematician',
  );
  assert.equal(describePerson({ name: 'Ada M. Lovelace' }), 'Ada M. Lovelace');
});

test('an empty profile still describes somebody, without naming them', () => {
  assert.equal(describePerson({}), 'the candidate');
});

test('the qualification note is built from the same booleans the validator reads', () => {
  const note = qualificationNote({
    qualifications: { phd: { status: 'in_progress', submitted: false, awarded: false, allowedForms: ['PhD candidate'] } },
  });
  assert.match(note, /thesis NOT submitted/);
  assert.match(note, /degree NOT awarded/);
  assert.match(note, /"PhD candidate"/);
});

test('the note says PhD, not "phd" and not "PhD PhD"', () => {
  // The key is whatever the owner typed; the label is what the app writes. Both
  // reach a prompt, so both have to read as a sentence.
  assert.match(qualificationNote({ qualifications: { phd: { submitted: false, awarded: false } } }), /^PhD: /);
  assert.match(
    qualificationNote({ qualifications: { doctorate: { label: 'PhD', submitted: false, awarded: false } } }),
    /^PhD: /,
  );
});

test('an awarded qualification constrains nothing and says nothing', () => {
  assert.equal(qualificationNote({ qualifications: { phd: { awarded: true, submitted: true } } }), '');
  assert.equal(qualificationNote({}), '');
});

// --- the guards that keep a shared copy honest ------------------------------------

/**
 * Everything git tracks, which is exactly the set that reaches somebody else.
 *
 * Deliberately git's list rather than a directory walk: `data/` is gitignored
 * and holds the owner's real profile, so a walk would read the very files this
 * is meant to prove are not shipped, and fail on the machine of the person the
 * app was written for while passing everywhere else.
 */
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

test('no personal fact from the original author is anywhere in the repository', () => {
  // This one is not about code quality. A shared copy of this app carries its
  // whole history to somebody else's machine, and a name, a phone number or an
  // employer left in a comment is a disclosure, not a typo.
  //
  // Comments are checked too, unlike the version this grew from: a comment is
  // shipped text. The repository URL is not a personal fact, so it is allowed.
  const forbidden = /\b(Kavindu|Bandara|kavinduhbandara)\b/i;
  const allowed = /github\.com\/kbandara\//;

  // This file is the one place the names may appear, because it is the file that
  // forbids them — it cannot state the rule without writing down what the rule
  // is about. Exempting it by path rather than by some trick that hides the
  // literal: a check you can read is worth more than a check that is clever.
  const SELF = 'server/profile/identity.test.js';

  const offenders = [];
  for (const rel of trackedFiles()) {
    if (rel === SELF) continue;
    if (rel.startsWith('client/vendor/') || /\.(png|jpe?g|gif|ico|pdf|woff2?)$/i.test(rel)) continue;
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;

    fs.readFileSync(full, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (forbidden.test(line.replace(allowed, ''))) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
  }

  assert.deepEqual(offenders, [], `personal facts belong in data/, not in the repository:\n${offenders.join('\n')}`);
});

test('nothing under data/ is tracked, because that is where the person lives', () => {
  // The single rule the whole generalisation rests on. If a data/ file is ever
  // committed, the next person to clone this gets somebody else's phone number.
  const tracked = trackedFiles().filter((rel) => rel === 'data' || rel.startsWith('data/'));
  assert.deepEqual(tracked, [], `these must be gitignored:\n${tracked.join('\n')}`);
});

test('the ignore rule for data/ is anchored, so it cannot swallow another directory', () => {
  // A pattern without a leading slash matches at any depth: `profile/` once
  // matched `server/profile/` and silently kept a whole module out of a commit.
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\/data\/?$/m, '.gitignore must ignore /data/, anchored to the root');
});

// --- the two files a new copy starts from -----------------------------------------

const templateMeta = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'profile-meta.json'), 'utf8'));
const exampleMetaFile = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'example-profile-meta.json'), 'utf8'));

test('the template and the worked example describe the same shape', () => {
  // A new profile is created from the template; *Load a worked example* fills in
  // the example. A field in one and not the other is a field somebody meets for
  // the first time as a validation error.
  const keys = (o) => Object.keys(o).filter((k) => !k.startsWith('_')).sort();
  assert.deepEqual(keys(exampleMetaFile()), keys(templateMeta()));
  assert.deepEqual(keys(exampleMetaFile().workRights), keys(templateMeta().workRights));
});

test('the template claims nothing about anybody', () => {
  // It is the first thing a new person's data/ contains, and every field in it
  // prints on a CV. A default that is a claim is a claim they never made.
  const meta = templateMeta();
  for (const field of ['name', 'preferred', 'email', 'phone', 'city', 'citizenship']) {
    assert.equal(meta[field], '', `${field} must start empty`);
  }
  assert.deepEqual(meta.links, []);
  assert.deepEqual(meta.qualifications, {});
  assert.deepEqual(meta.workRights.byCountry, {}, 'a visa route nobody chose is a claim nobody made');
  assert.equal(meta.timezoneOverlapClaims, false);
});

test('the worked example is nobody real', () => {
  const text = fs.readFileSync(path.join(ROOT, 'examples', 'example-profile-meta.json'), 'utf8');
  assert.doesNotMatch(text, /Kavindu|Bandara|kbandara|kavinduhbandara/i);
  assert.match(text, /example\.(org|com)/, 'contact details must be obviously fake');
  assert.match(text, /\+61 400 000 000/, 'and so must the phone number');
});

test('the worked example produces a complete header for its own fictional owner', async () => {
  const { contactBlock } = await import('../generate/workrights.js');
  const { lines, needsAttention } = contactBlock(exampleMetaFile(), { country: 'US', workArrangement: 'onsite' });
  assert.deepEqual(needsAttention, [], 'a fresh copy should not start out incomplete');
  assert.match(lines.at(-1), /E-3/);
  assert.doesNotMatch(lines.join('\n'), /FILL-ME/);
});
