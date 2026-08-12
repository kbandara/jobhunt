// WHY: assembly is where the profile actually shows up in the document (defect #3)
// and where the code-generated contact block must survive byte-for-byte (D007).
// Determinism is tested because the whole point of a pure assembler is that two
// runs of the same draft can be diffed and show nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../store.js';
import { assemble } from './assemble.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const profileConfig = (profile) => readJson(path.join(here, 'profiles', `${profile}.json`));

/**
 * A shipped profile with something changed. Two features here — a clearance
 * section and labelled skill groups — are things a profile MAY declare rather
 * than things the shipped ones happen to use, and testing them through whichever
 * stock profile currently sets them made the tests break every time a stock
 * profile was retuned. They are declared inline now, which is also how a reader
 * finds out the feature exists.
 */
const withConfig = (profile, changes) => ({ ...profileConfig(profile), ...changes });

const SKILL_GROUPS = [
  { label: 'Languages', tags: ['python', 'r', 'sql', 'sas', 'matlab', 'bash'] },
  { label: 'Tooling', tags: ['pytorch', 'jira', 'confluence', 'bitbucket', 'git'] },
];

const CONTACT = [
  'Rosa Kimani',
  'rosa.kimani@example.org · +61 400 000 000',
  'https://github.com/example · https://linkedin.com/in/example',
  'Riverina, Australia · Australian citizen',
];

const cvArtifact = () => ({
  summary: { text: 'Statistician moving into evaluation work.', evidence_ids: ['edu-phd'] },
  sections: [
    {
      heading: 'Experience',
      entries: [
        {
          title: 'Data Analyst',
          org: 'Australian Department of Health',
          dates: 'August 2021 – May 2022',
          bullets: [
            { text: 'Rebuilt the reporting pipeline.', evidence_ids: ['role-health'] },
            { text: 'Wrote the QA checks the team still runs.', evidence_ids: ['role-health'] },
          ],
        },
      ],
    },
    {
      heading: 'Security Clearance',
      entries: [
        { line: 'Baseline (national security clearance) — held historically.', evidence_ids: ['role-analyst'] },
      ],
    },
    {
      heading: 'Technical Skills',
      entries: [{ line: 'R, SQL, Python, SAS.', evidence_ids: ['skill-languages'] }],
    },
  ],
  gaps: [],
  changes_made: [],
});

test('a profile that declares a clearance slot puts it immediately after the summary', () => {
  const markdown = assemble({
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'public-sector',
    profileConfig: withConfig('public-sector', {
      sections: [{ id: 'summary' }, { id: 'clearance' }, { id: 'experience' }, { id: 'skills' }],
    }),
    contactLines: CONTACT,
  });

  const headings = markdown
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));

  assert.deepEqual(headings, ['Summary', 'Security Clearance', 'Experience', 'Technical Skills']);
});

test('a profile without a clearance slot orders sections its own way', () => {
  const markdown = assemble({
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'industry',
    profileConfig: profileConfig('industry'),
    contactLines: CONTACT,
  });

  const headings = markdown
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));

  // industry: summary, experience, skills — clearance is not in its sectionOrder,
  // so it falls to the end rather than being dropped.
  assert.deepEqual(headings, ['Summary', 'Experience', 'Technical Skills', 'Security Clearance']);
});

test('every contact line appears byte-exact, in order, at the top', () => {
  const markdown = assemble({
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'public-sector',
    profileConfig: profileConfig('public-sector'),
    contactLines: CONTACT,
  });

  for (const line of CONTACT) assert.ok(markdown.includes(line), `missing contact line: ${line}`);
  assert.ok(markdown.startsWith('# Rosa Kimani\n'));
  assert.ok(markdown.indexOf('Riverina, Australia · Australian citizen') < markdown.indexOf('## Summary'));
});

test('entries render as heading, dates, bullets; line entries render as single lines', () => {
  const markdown = assemble({
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'public-sector',
    profileConfig: profileConfig('public-sector'),
    contactLines: CONTACT,
  });

  assert.ok(markdown.includes('### Data Analyst — Australian Department of Health'));
  assert.ok(markdown.includes('\nAugust 2021 – May 2022\n'));
  assert.ok(markdown.includes('- Rebuilt the reporting pipeline.'));
  assert.ok(markdown.includes('- Baseline (national security clearance) — held historically.'));
  assert.ok(!markdown.includes('### Baseline'));
});

test('rendering the same draft twice is byte-identical', () => {
  const args = {
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'industry-research',
    profileConfig: profileConfig('industry-research'),
    contactLines: CONTACT,
    jobMeta: { company: 'Acme', roleTitle: 'Research Engineer', date: '2 August 2026' },
  };
  assert.equal(assemble(args), assemble(args));
  assert.equal(assemble(args), assemble({ ...args, artifact: cvArtifact() }));
});

test('a cover letter is contact block, date, subject, then paragraphs', () => {
  const markdown = assemble({
    artifact: {
      paragraphs: [
        { text: 'First paragraph.', evidence_ids: [] },
        { text: 'Second paragraph.', evidence_ids: ['project-eval-platform'] },
      ],
      gaps: [],
      changes_made: [],
    },
    artifactKind: 'cover-letter',
    profile: 'industry-research',
    profileConfig: profileConfig('industry-research'),
    contactLines: CONTACT,
    jobMeta: { company: 'Acme', roleTitle: 'Research Engineer', date: '2 August 2026' },
  });

  const blocks = markdown.trim().split('\n\n');
  assert.equal(blocks[0], '# Rosa Kimani');
  assert.equal(blocks[4], '2 August 2026');
  assert.equal(blocks[5], 'Re: Research Engineer, Acme');
  assert.equal(blocks[6], 'First paragraph.');
  assert.equal(blocks[7], 'Second paragraph.');
  assert.ok(markdown.includes('Riverina, Australia · Australian citizen'));
});

test('empty sections are omitted rather than left as bare headings', () => {
  const markdown = assemble({
    artifact: {
      summary: { text: 'A summary.', evidence_ids: [] },
      sections: [{ heading: 'Education', entries: [] }],
      gaps: [],
      changes_made: [],
    },
    artifactKind: 'cv',
    profile: 'public-sector',
    profileConfig: profileConfig('public-sector'),
    contactLines: CONTACT,
  });
  assert.ok(!markdown.includes('## Education'));
  assert.ok(markdown.includes('## Summary'));
});

// --- modular sections --------------------------------------------------------

const headings = (markdown) =>
  markdown.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3));

test('a profile written the old way, with a flat sectionOrder, still renders', () => {
  const markdown = assemble({
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'legacy',
    profileConfig: { sectionOrder: ['summary', 'clearance', 'experience', 'skills'] },
    contactLines: CONTACT,
  });
  assert.deepEqual(headings(markdown), ['Summary', 'Security Clearance', 'Experience', 'Technical Skills']);
});

test('sections wins over sectionOrder when a profile has both', () => {
  const markdown = assemble({
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'both',
    profileConfig: {
      sectionOrder: ['summary', 'clearance', 'experience', 'skills'],
      sections: [{ id: 'summary' }, { id: 'skills' }, { id: 'experience' }],
    },
    contactLines: CONTACT,
  });
  assert.deepEqual(headings(markdown), ['Summary', 'Technical Skills', 'Experience', 'Security Clearance']);
});

test('a profile can override the heading the model chose', () => {
  const markdown = assemble({
    artifact: cvArtifact(),
    artifactKind: 'cv',
    profile: 'renamed',
    profileConfig: { sections: [{ id: 'summary' }, { id: 'skills', heading: 'Methods & Techniques' }] },
    contactLines: CONTACT,
  });
  assert.ok(markdown.includes('## Methods & Techniques'));
  assert.ok(!markdown.includes('## Technical Skills'));
});

test('max caps how many entries a section renders', () => {
  const artifact = {
    summary: { text: 'A summary.', evidence_ids: [] },
    sections: [
      {
        heading: 'Publications',
        entries: [1, 2, 3, 4, 5].map((n) => ({ line: `Paper ${n}.`, evidence_ids: ['x'] })),
      },
    ],
    gaps: [],
    changes_made: [],
  };
  const markdown = assemble({
    artifact,
    artifactKind: 'cv',
    profile: 'capped',
    profileConfig: { sections: [{ id: 'summary' }, { id: 'publications', max: 2 }] },
    contactLines: CONTACT,
  });
  assert.ok(markdown.includes('- Paper 1.'));
  assert.ok(markdown.includes('- Paper 2.'));
  assert.ok(!markdown.includes('Paper 3.'), 'the third publication is over the profile budget');
});

test('style "lines" collapses an entry into one line, using only fields the model set', () => {
  const artifact = {
    summary: { text: 'A summary.', evidence_ids: [] },
    sections: [
      {
        heading: 'Publications',
        entries: [
          { title: 'A paper title', org: 'A Journal', dates: '2025', bullets: [], evidence_ids: ['x'] },
        ],
      },
    ],
    gaps: [],
    changes_made: [],
  };
  const markdown = assemble({
    artifact,
    artifactKind: 'cv',
    profile: 'oneline',
    profileConfig: { sections: [{ id: 'summary' }, { id: 'publications', style: 'lines' }] },
    contactLines: CONTACT,
  });
  assert.ok(markdown.includes('- A paper title — A Journal — 2025'));
  assert.ok(!markdown.includes('### A paper title'));
});

// --- skills as labelled groups ------------------------------------------------

const skillsArtifact = () => ({
  summary: { text: 'A summary.', evidence_ids: [] },
  sections: [
    {
      heading: 'Technical Skills',
      entries: [
        { line: 'Python, R, SQL, PyTorch, Jira, Confluence, hand-rolled abacus', evidence_ids: ['skill-languages'] },
      ],
    },
  ],
  gaps: [],
  changes_made: [],
});

test('skillGroups turn the skills blob into labelled lines', () => {
  const markdown = assemble({
    artifact: skillsArtifact(),
    artifactKind: 'cv',
    profile: 'public-sector',
    profileConfig: withConfig('public-sector', { skillGroups: SKILL_GROUPS }),
    contactLines: CONTACT,
  });

  assert.ok(markdown.includes('- **Languages:** Python, R, SQL'), markdown);
  assert.ok(markdown.includes('- **Tooling:** PyTorch, Jira, Confluence') || markdown.includes('Jira, Confluence'));
  // Nothing the model wrote may be lost, even when it fits no group.
  assert.ok(markdown.includes('hand-rolled abacus'), 'an ungrouped skill must still be printed');
});

test('a group matches on its tags, whatever order the model wrote the line in', () => {
  const markdown = assemble({
    artifact: {
      summary: { text: 'A summary.', evidence_ids: [] },
      sections: [
        {
          heading: 'Technical Skills',
          entries: [{ line: 'R, SAS, SQL, Jira, Confluence, Bitbucket', evidence_ids: ['skill-languages'] }],
        },
      ],
      gaps: [],
      changes_made: [],
    },
    artifactKind: 'cv',
    profile: 'public-sector',
    profileConfig: withConfig('public-sector', { skillGroups: SKILL_GROUPS }),
    contactLines: CONTACT,
  });
  assert.ok(markdown.includes('- **Languages:** R, SAS, SQL'), markdown);
  assert.ok(markdown.includes('- **Tooling:** Jira, Confluence, Bitbucket'), markdown);
});

test('a profile with no skillGroups renders skills exactly as before', () => {
  const markdown = assemble({
    artifact: skillsArtifact(),
    artifactKind: 'cv',
    profile: 'teaching',
    profileConfig: profileConfig('teaching'),
    contactLines: CONTACT,
  });
  assert.ok(markdown.includes('- Python, R, SQL, PyTorch, Jira, Confluence, hand-rolled abacus'));
  assert.ok(!markdown.includes('**'));
});

test('grouping is deterministic and never invents or duplicates a skill', () => {
  const args = {
    artifact: skillsArtifact(),
    artifactKind: 'cv',
    profile: 'industry-research',
    profileConfig: withConfig('industry-research', { skillGroups: SKILL_GROUPS }),
    contactLines: CONTACT,
  };
  const once = assemble(args);
  assert.equal(once, assemble(args));
  assert.equal(once, assemble({ ...args, artifact: skillsArtifact() }));

  for (const skill of ['Python', 'R', 'SQL', 'PyTorch', 'Jira', 'Confluence', 'hand-rolled abacus']) {
    const pattern = new RegExp(`(?<![A-Za-z])${skill.replace(/[-]/g, '\\-')}(?![A-Za-z])`, 'g');
    const count = (once.match(pattern) ?? []).length;
    assert.equal(count, 1, `${skill} appears ${count} times`);
  }
});

test('a bracketed list stays one skill instead of being cut at its commas', () => {
  const markdown = assemble({
    artifact: {
      summary: { text: 'A summary.', evidence_ids: [] },
      sections: [
        {
          heading: 'Technical Skills',
          entries: [{ line: 'Python (NumPy, SciPy, PyTorch), MATLAB (SPM), R', evidence_ids: ['skill-languages'] }],
        },
      ],
      gaps: [],
      changes_made: [],
    },
    artifactKind: 'cv',
    profile: 'industry-research',
    profileConfig: withConfig('industry-research', { skillGroups: SKILL_GROUPS }),
    contactLines: CONTACT,
  });
  assert.ok(markdown.includes('- **Languages:** Python (NumPy, SciPy, PyTorch), MATLAB (SPM), R'), markdown);
});

test('sections the profile order does not name are kept, not dropped', () => {
  const markdown = assemble({
    artifact: {
      summary: { text: 'A summary.', evidence_ids: [] },
      sections: [{ heading: 'Selected Talks', entries: [{ line: 'A talk.', evidence_ids: ['x'] }] }],
      gaps: [],
      changes_made: [],
    },
    artifactKind: 'cv',
    profile: 'public-sector',
    profileConfig: profileConfig('public-sector'),
    contactLines: CONTACT,
  });
  assert.ok(markdown.includes('## Selected Talks'));
  assert.ok(markdown.includes('- A talk.'));
});

// --- publications rendered from records, never from the model ----------------
//
// Why: a citation is the most checkable thing on a CV, and the model was
// rewriting them in prose it invented. These pin the handover — when citations
// are supplied they replace the model's section entirely, and when they are not
// nothing about the old behaviour changes.

const PUBS = [
  'Kimani, R., & Other, A. B. (2025). A real paper. *A Real Journal*, *12*(3), 45–67.',
  'Kimani, R. (2026). An unsubmitted one [Manuscript in preparation].',
];

const withPubs = (extra = {}) =>
  assemble({
    artifact: {
      summary: { text: 'A summary.', evidence_ids: [] },
      sections: [
        { heading: 'Publications', entries: [{ line: 'Some paraphrase the model invented.', evidence_ids: [] }] },
      ],
    },
    artifactKind: 'cv',
    profile: 'research',
    profileConfig: { sections: [{ id: 'summary' }, { id: 'publications' }] },
    contactLines: ['Rosa Kimani'],
    ...extra,
  });

test('supplied citations replace whatever the model wrote', () => {
  const markdown = withPubs({ publications: PUBS });
  assert.ok(markdown.includes('A Real Journal'), 'the real citation is used');
  assert.ok(!markdown.includes('paraphrase the model invented'), 'and the model\'s version is gone');
});

test('the model\'s publications section is not re-emitted further down', () => {
  const markdown = withPubs({ publications: PUBS });
  assert.equal(markdown.split('## Publications').length - 1, 1, 'exactly one publications heading');
});

test('with no citations supplied, the model\'s section is used as before', () => {
  const markdown = withPubs();
  assert.ok(markdown.includes('paraphrase the model invented'));
});

test('an empty selection removes the section rather than leaving a bare heading', () => {
  const markdown = withPubs({ publications: [] });
  assert.ok(!markdown.includes('## Publications'));
  assert.ok(!markdown.includes('paraphrase the model invented'), 'and does not fall through to the model');
});

test('citations keep their order and their markdown emphasis', () => {
  const markdown = withPubs({ publications: PUBS });
  const first = markdown.indexOf('A real paper');
  const second = markdown.indexOf('An unsubmitted one');
  assert.ok(first > -1 && second > first, 'order is preserved');
  assert.ok(markdown.includes('*A Real Journal*'), 'italics survive into the markdown');
});

test('the profile max does not silently drop a paper you ticked', () => {
  const markdown = assemble({
    artifact: { summary: { text: 'x', evidence_ids: [] }, sections: [] },
    artifactKind: 'cv',
    profile: 'industry',
    profileConfig: { sections: [{ id: 'summary' }, { id: 'publications', max: 1 }] },
    contactLines: ['Rosa Kimani'],
    publications: PUBS,
  });
  assert.ok(markdown.includes('A real paper'));
  assert.ok(markdown.includes('An unsubmitted one'), 'max is a budget for the model, not an override of your choice');
});
