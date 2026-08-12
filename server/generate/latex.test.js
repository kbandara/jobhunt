// WHY: LaTeX fails in two ways that a glance at the source never catches — a
// stray "%" silently comments out the rest of a line, so a bullet loses half its
// text and still compiles; a stray "&" refuses to compile at all and the error
// message names a line number rather than the word. So the escaping table is
// tested exhaustively, character by character, and the round trip is tested from
// EDITED markdown, because losing your edits is the one failure this cannot have.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeLatex, escapeLatexUrl, latexInline, renderLatex } from './latex.js';
import { documentFromMarkdown } from './from-markdown.js';
import { contactBlock } from './workrights.js';
import { readJson } from '../store.js';
import { createApp } from '../index.js';
import { exampleEvidence, exampleMeta } from '../examples.js';
import { selectEvidence } from './select-evidence.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..');
const PROFILE = 'industry-research';
const profileConfig = readJson(path.join(HERE, 'profiles', `${PROFILE}.json`));
const profileMeta = exampleMeta();

/** A Google Scholar link. The `&` in it is the whole point of this file. */
const SCHOLAR = 'https://scholar.google.com/citations?user=EXAMPLE1234&hl=en';

// --- escaping ---------------------------------------------------------------

test('escapeLatex handles every character TeX reserves', () => {
  const table = [
    ['\\', '\\textbackslash{}'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['$', '\\$'],
    ['&', '\\&'],
    ['#', '\\#'],
    ['^', '\\textasciicircum{}'],
    ['_', '\\_'],
    ['~', '\\textasciitilde{}'],
    ['%', '\\%'],
  ];
  for (const [input, expected] of table) {
    assert.equal(escapeLatex(input), expected, `escaping ${JSON.stringify(input)}`);
  }
  // All ten at once, in one string, in one pass.
  assert.equal(
    escapeLatex('\\{}$&#^_~%'),
    '\\textbackslash{}\\{\\}\\$\\&\\#\\textasciicircum{}\\_\\textasciitilde{}\\%',
  );
});

test('a backslash before a letter keeps its braces, so the letter survives', () => {
  // Without the braces this is \textbackslashpath: an undefined control word,
  // and "path" disappears from the page rather than failing loudly.
  assert.equal(escapeLatex('C:\\path'), 'C:\\textbackslash{}path');
  assert.equal(escapeLatex('a^b'), 'a\\textasciicircum{}b');
  assert.equal(escapeLatex('a~b'), 'a\\textasciitilde{}b');
});

test('escaping is one pass: a produced backslash is never escaped again', () => {
  assert.equal(escapeLatex('50% & rising'), '50\\% \\& rising');
  assert.equal(escapeLatex('\\&'), '\\textbackslash{}\\&');
  assert.equal(escapeLatex('#_%'), '\\#\\_\\%');
  // Nothing in the output is a bare special character.
  const out = escapeLatex('\\{}$&#^_~% every one of them');
  assert.equal(/(^|[^\\])[&#%$_]/.test(out), false, out);
});

test('escapeLatex converts the typographic characters these documents carry', () => {
  assert.equal(escapeLatex('2022 – 2026'), '2022 -- 2026');
  assert.equal(escapeLatex('Analyst — An Agency'), 'Analyst --- An Agency');
  assert.equal(escapeLatex('Riverina, Australia · Australian citizen'), 'Riverina, Australia \\textperiodcentered{} Australian citizen');
  assert.equal(escapeLatex('\u2018a\u2019 and \u201cb\u201d'), "`a' and ``b''");
  assert.equal(escapeLatex('meta-d\u2032'), "meta-d$'$");
  assert.equal(escapeLatex('and so on\u2026'), 'and so on\\ldots{}');
  assert.equal(escapeLatex('a\u00a0b'), 'a~b', 'a no-break space is what TeX\'s tie means');
});

test('escapeLatex leaves ordinary ASCII exactly as it was', () => {
  const plain = "Designed evaluations (n=240) for A/B testing; 3.4x faster, p<0.05 -- see notes.";
  assert.equal(escapeLatex(plain), plain);
  assert.equal(escapeLatex(''), '');
  assert.equal(escapeLatex(null), '');
  assert.equal(escapeLatex(undefined), '');
});

test('accented letters pass through, because names are not decoration', () => {
  assert.equal(escapeLatex('Müller, Sánchez & Þórsdóttir'), 'Müller, Sánchez \\& Þórsdóttir');
});

// --- URL escaping -----------------------------------------------------------

test('escapeLatexUrl keeps & # % _ as characters in the address', () => {
  assert.equal(escapeLatexUrl('a&b'), 'a\\&b');
  assert.equal(escapeLatexUrl('a#b'), 'a\\#b');
  assert.equal(escapeLatexUrl('a%b'), 'a\\%b');
  assert.equal(escapeLatexUrl('a_b'), 'a\\_b');
});

test('a Google Scholar URL survives with its ampersand', () => {
  const stripped = SCHOLAR.replace(/^https:\/\//, '');
  assert.equal(escapeLatexUrl(stripped), 'scholar.google.com/citations?user=EXAMPLE1234\\&hl=en');
  // The query string is intact: nothing before or after the & was lost, and the
  // & itself is escaped rather than left as an alignment tab that will not build.
  assert.match(escapeLatexUrl(stripped), /\?user=EXAMPLE1234\\&hl=en$/);
  assert.equal(/(^|[^\\])&/.test(escapeLatexUrl(stripped)), false);
});

test('escapeLatexUrl does not turn URL punctuation into prose', () => {
  assert.equal(escapeLatexUrl('example.com/a/b?x=1&y=2#frag'), 'example.com/a/b?x=1\\&y=2\\#frag');

  // The prose escaper would have replaced the tilde with a word, which is right
  // on a page and wrong in a link target — hyperref needs the character itself.
  const tilded = 'example.com/~user/a_b';
  assert.equal(escapeLatexUrl(tilded), 'example.com/~user/a\\_b');
  assert.equal(escapeLatex(tilded), 'example.com/\\textasciitilde{}user/a\\_b');
  assert.notEqual(escapeLatexUrl(tilded), escapeLatex(tilded));
});

test('inline markdown becomes LaTeX rather than printing its asterisks', () => {
  assert.equal(latexInline('**Languages:** Python'), '\\textbf{Languages:} Python');
  assert.equal(latexInline('the *Journal of Things*, 2025'), 'the \\textit{Journal of Things}, 2025');
  assert.equal(latexInline('run `pdflatex cv.tex`'), 'run \\texttt{pdflatex cv.tex}');
  assert.equal(latexInline(`[notes](${SCHOLAR})`), `\\href{https://scholar.google.com/citations?user=EXAMPLE1234\\&hl=en}{notes}`);
  assert.equal(latexInline('100% of **the** time'), '100\\% of \\textbf{the} time');
});

// --- a whole document -------------------------------------------------------

const contact = () => contactBlock(profileMeta, { country: 'AU', workArrangement: 'hybrid' });

const JOB_META = {
  company: 'Acme Alignment',
  roleTitle: 'Research Engineer, Model Evaluations',
  skills: ['statistics', 'python', 'evaluation & measurement'],
  evidenceTags: ['bayesian', 'psychometrics', 'python'],
};

/** A document in exactly the shape assemble.js writes, punctuation and all. */
function markdownFixture(bullet = 'Designed evaluations that separate discrimination from response bias.') {
  const lines = contact().lines;
  return [
    `# ${lines[0]}`,
    '',
    lines[1],
    '',
    lines[2],
    '',
    lines[3],
    '',
    '## Summary',
    '',
    'Computational scientist working on evaluation & measurement — 100% of the time, meta-d\u2032 and all.',
    '',
    '## Evaluation',
    '',
    '### LLM evaluation platform — independent research',
    '',
    'September 2025 – present',
    '',
    `- ${bullet}`,
    '- Built the measurement pipeline and the analysis that reads it.',
    '',
    '## Publications',
    '',
    '- Kimani, R. & Someone, A. A paper. *Journal of Things*, 2025.',
    '',
    '## Skills',
    '',
    '- **Languages:** Python, R, MATLAB, SQL',
    '- **Analysis:** Bayesian inference, signal detection theory (d\u2032)',
    '',
  ].join('\n');
}

function renderFixture(markdown = markdownFixture()) {
  const c = contact();
  return renderLatex({
    artifact: documentFromMarkdown(markdown, { contactLines: c.lines }).artifact,
    contact: c,
    profile: PROFILE,
    profileConfig,
    jobMeta: JOB_META,
    profileMeta,
  });
}

test('renderLatex produces a complete file targeting the vendored class', () => {
  const tex = renderFixture();

  assert.ok(tex.includes('\\documentclass[11pt]{article}'), tex.slice(0, 400));
  assert.ok(tex.includes('\\usepackage[charter,a4]{atscv}'));
  assert.ok(tex.includes('\\begin{document}'));
  assert.ok(tex.includes('\\end{document}'));
  assert.ok(tex.endsWith('\\end{document}\n'), 'the file ends with one newline and nothing after it');

  // Metadata, header, and the structures the class provides.
  assert.ok(tex.includes('\\cvmeta'));
  assert.ok(tex.includes('\\cvheader'));
  assert.ok(tex.includes('{Rosa Kimani}'));
  assert.ok(tex.includes('{Research Engineer, Model Evaluations}'), 'the tagline is the advertised role');
  assert.ok(tex.includes('\\section{Summary}'));
  assert.ok(tex.includes('\\cventry{LLM evaluation platform}{independent research}{}{September 2025 -- present}'));
  assert.ok(tex.includes('\\begin{cvbullets}') && tex.includes('\\end{cvbullets}'));
  assert.ok(tex.includes('\\begin{cvnumbered}') && tex.includes('\\end{cvnumbered}'), 'publications are numbered');
  assert.ok(tex.includes('\\cvskill{Languages}{Python, R, MATLAB, SQL}'));
});

test('the contact line is yours, built from code and not from the draft', () => {
  const tex = renderFixture();
  assert.ok(tex.includes('\\cvmail{rosa.kimani@example.org}'), tex);
  assert.ok(tex.includes('+61 400 000 000'));
  assert.ok(tex.includes('\\cvurl{github.com/example}'));
  assert.ok(tex.includes('Riverina, Australia \\cvsep\\ Australian citizen'), 'the work-rights line survives (R7)');
  // \cvurl prints the address as the visible text, so a screener reading only the
  // anchor text still gets somewhere it can go.
  assert.ok(tex.includes('\\cvurl{orcid.org/0000-0000-0000-0000}'), tex);
  // The markdown link syntax must not reach the page.
  assert.equal(/\]\(/.test(tex), false, 'a raw markdown link leaked into the .tex');
});

test('no unescaped ampersand anywhere, inside a link or out', () => {
  const tex = renderFixture();

  // Outside the link macros first: every & there must be \&.
  const prose = tex.replace(/\\cvurl\{[^}]*\}/g, '').replace(/\\href\{[^}]*\}/g, '');
  assert.equal(/(^|[^\\])&/.test(prose), false, `a bare & would not compile:\n${prose}`);

  // And inside them, because the argument is read with ordinary catcodes there
  // too — this is the case that breaks a Scholar link.
  for (const macro of tex.match(/\\cvurl\{[^}]*\}/g) ?? []) {
    assert.equal(/(^|[^\\])&/.test(macro), false, macro);
  }
  assert.equal(/(^|[^\\])%/.test(tex.replace(/^%.*$/gm, '')), false, 'a bare % comments out the rest of its line');
});

test('the same input renders byte-identical output', () => {
  const markdown = markdownFixture();
  const first = renderFixture(markdown);
  const second = renderFixture(markdown);
  assert.equal(first, second);
  // Nothing volatile: no timestamp, no run id, nothing that changes between runs.
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(first), false, 'a timestamp would make two exports undiffable');
});

test('sections come out in the order the profile asks for', () => {
  const tex = renderFixture();
  const order = [...tex.matchAll(/\\section\{([^}]*)\}/g)].map((match) => match[1]);
  // Summary, Skills then Publications is this profile's declared order.
  // "Evaluation" is not a section it names at all, and lands last rather than
  // being dropped — a heading the profile has not heard of is still content.
  assert.deepEqual(order, ['Summary', 'Skills', 'Publications', 'Evaluation']);
});

test('an edit to the markdown reaches the .tex', () => {
  const edited = 'Rewrote this bullet by hand: 40% faster, & measured it properly.';
  const tex = renderFixture(markdownFixture(edited));

  assert.ok(tex.includes('Rewrote this bullet by hand: 40\\% faster, \\& measured it properly.'), tex);
  assert.equal(
    tex.includes('Designed evaluations that separate discrimination from response bias.'),
    false,
    'the replaced bullet must not survive — the export starts from the saved markdown, not the model output',
  );
});

test('renderLatex survives an empty artifact rather than producing half a file', () => {
  const tex = renderLatex({ artifact: {}, contact: contact(), profileConfig });
  assert.ok(tex.includes('\\begin{document}'));
  assert.ok(tex.includes('\\end{document}'));
  assert.ok(tex.includes('\\cvheader'));
});

test('a bullet opening with a bracket is not eaten as an \\item label', () => {
  const markdown = ['# Rosa Kimani', '', '## Experience', '', '- [Outcome] to be filled in.'].join('\n');
  const tex = renderLatex({
    artifact: documentFromMarkdown(markdown).artifact,
    contact: contact(),
    profileConfig,
  });
  assert.ok(tex.includes('\\item {}[Outcome] to be filled in.'), tex);
});

// --- from-markdown ----------------------------------------------------------

test('documentFromMarkdown reads back the document assemble.js wrote', () => {
  const lines = contact().lines;
  const document = documentFromMarkdown(markdownFixture(), { contactLines: lines });

  assert.equal(document.title, 'Rosa Kimani');
  assert.deepEqual(document.contactLines, lines.slice(1), 'the contact block is lifted out, not left in the body');

  assert.deepEqual(
    document.artifact.sections.map((section) => section.heading),
    ['Summary', 'Evaluation', 'Publications', 'Skills'],
  );
  const entry = document.artifact.sections[1].entries[0];
  assert.equal(entry.title, 'LLM evaluation platform');
  assert.equal(entry.org, 'independent research');
  assert.equal(entry.dates, 'September 2025 – present');
  assert.equal(entry.bullets.length, 2);
});

test('a cover letter has no headings, so its body is kept as paragraphs', () => {
  const lines = contact().lines;
  const markdown = [`# ${lines[0]}`, '', lines[1], '', '3 August 2026', '', 'Re: Research Engineer, Acme', '', 'Dear hiring team,'].join('\n');
  const document = documentFromMarkdown(markdown, { contactLines: lines });

  const texts = document.artifact.sections[0].entries.flatMap((e) => e.bullets.map((b) => b.text));
  assert.deepEqual(texts, ['3 August 2026', 'Re: Research Engineer, Acme', 'Dear hiring team,']);
  assert.deepEqual(document.contactLines, [lines[1]]);
});

test('front matter you wrote yourself is content, not silently dropped', () => {
  const lines = contact().lines;
  const markdown = [`# ${lines[0]}`, '', lines[1], '', 'A note I added at the top.', '', '## Summary', '', 'Text.'].join('\n');
  const document = documentFromMarkdown(markdown, { contactLines: lines });
  assert.equal(document.artifact.sections[0].heading, '');
  assert.equal(document.artifact.sections[0].entries[0].bullets[0].text, 'A note I added at the top.');
});

// --- through the route ------------------------------------------------------

const evidence = exampleEvidence();
const { offeredIds } = selectEvidence({ evidence, jdJson: jdJson(), profile: PROFILE, profileConfig });

function jdJson() {
  return {
    role_title: 'Research Engineer, Model Evaluations',
    company: 'Acme Alignment & Co.',
    location: { country: 'AU', city: 'Sydney' },
    work_arrangement: 'hybrid',
    seniority: 'mid',
    closing_date: null,
    requirements: [{ text: 'Python', kind: 'skill', must_have: true }],
    skills: ['statistics', 'python', 'evaluation'],
    responsibilities: [],
    selection_criteria: [],
    profile_guess: PROFILE,
    profile_guess_reason: 'Model evaluation work at an AI lab.',
  };
}

const cvArtifact = () => ({
  summary: { text: 'Measurement scientist moving into model evaluation.', evidence_ids: [offeredIds[0]] },
  sections: [
    {
      heading: 'Evaluation',
      entries: [
        {
          title: 'LLM evaluation platform',
          org: 'independent research',
          dates: 'September 2025 – present',
          bullets: [{ text: 'Designed evaluations that separate discrimination from response bias.', evidence_ids: [offeredIds[0]] }],
        },
      ],
    },
  ],
  gaps: [],
  changes_made: [],
});

async function startApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-latex-'));
  const app = createApp({
    dataDir,
    profileMeta,
    llmComplete: async ({ task }) => ({
      data: { 'parse-jd': jdJson(), 'generate-cv': cvArtifact() }[task],
      usage: { inputTokens: 10, outputTokens: 10 },
      costCents: 1,
      model: 'stub-model',
      provider: 'stub',
    }),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    dataDir,
    call: async (method, url, body) => {
      const res = await fetch(base + url, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      return { status: res.status, text: await res.text(), res };
    },
    stop: () =>
      new Promise((resolve) => {
        server.close(resolve);
        fs.rmSync(dataDir, { recursive: true, force: true });
      }),
  };
}

test('GET /api/jobs/:id/docs/:kind/latex downloads the .tex and leaves it on disk', async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const created = JSON.parse((await app.call('POST', '/api/jobs', { rawText: 'Research Engineer at Acme.' })).text);
  const jobId = created.job.id;
  await app.call('POST', `/api/jobs/${jobId}/parse`);

  const tooEarly = await app.call('GET', `/api/jobs/${jobId}/docs/cover-letter/latex`);
  assert.equal(tooEarly.status, 404, 'nothing generated yet means nothing to export');
  assert.match(JSON.parse(tooEarly.text).error, /has been generated/);

  await app.call('POST', `/api/jobs/${jobId}/generate/cv`);

  // His edit is what gets exported, so make one first.
  const current = fs.readFileSync(path.join(app.dataDir, 'apps', jobId, 'cv.md'), 'utf8');
  const edited = current.replace(
    'Designed evaluations that separate discrimination from response bias.',
    'Hand-edited: measured 12% drift & wrote it up.',
  );
  assert.notEqual(edited, current, 'the fixture bullet must be present to be edited');
  await app.call('PUT', `/api/jobs/${jobId}/docs/cv`, { markdown: edited });

  const exported = await app.call('GET', `/api/jobs/${jobId}/docs/cv/latex`);
  assert.equal(exported.status, 200);
  assert.match(exported.res.headers.get('content-type') ?? '', /application\/x-tex/);
  assert.equal(
    exported.res.headers.get('content-disposition'),
    'attachment; filename="Rosa-Kimani-CV-Acme-Alignment-Co.tex"',
    'the company name is sanitised for a filename',
  );

  assert.ok(exported.text.includes('\\documentclass[11pt]{article}'));
  assert.ok(exported.text.includes('\\usepackage[charter,a4]{atscv}'));
  assert.ok(
    exported.text.includes('Hand-edited: measured 12\\% drift \\& wrote it up.'),
    'the edited markdown must be what reaches the .tex',
  );

  // Both files land beside the draft, so pdflatex finds the class where it looks.
  const dir = path.join(app.dataDir, 'apps', jobId, 'latex');
  assert.equal(fs.readFileSync(path.join(dir, 'cv.tex'), 'utf8'), exported.text);
  assert.equal(
    fs.readFileSync(path.join(dir, 'atscv.sty'), 'utf8'),
    fs.readFileSync(path.join(HERE, 'latex', 'atscv.sty'), 'utf8'),
    'atscv.sty is copied verbatim',
  );

  const events = fs
    .readFileSync(path.join(app.dataDir, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const exportEvent = events.find((event) => event.type === 'doc-exported');
  assert.ok(exportEvent, 'the export is logged');
  assert.equal(exportEvent.format, 'latex');
  assert.equal(exportEvent.kind, 'cv');

  const missing = await app.call('GET', '/api/jobs/j_nope/docs/cv/latex');
  assert.equal(missing.status, 404);
  const badKind = await app.call('GET', `/api/jobs/${jobId}/docs/manifesto/latex`);
  assert.equal(badKind.status, 404);
});
