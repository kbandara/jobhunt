// Why these tests exist: this is the one module that shells out, and the two
// things it must never do are claim success without a PDF and fail without
// saying why. Every "engine" here is `node` running a one-liner, so the suite
// still needs no LaTeX, no network and no fixtures on disk.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compilePdf, findEngine, forgetEngine, explainLog, installHint, enginesFor, ENGINES, COMPILE_TIMEOUT_MS } from './pdf.js';

const dirs = [];
afterEach(() => {
  forgetEngine();
  // maxRetries is for Windows: a process that has just been killed can still
  // hold its working directory for a moment, and rmdir answers EBUSY until the
  // OS lets go. And the whole thing is wrapped, because failing to delete a
  // temp folder is a triviality — while a red suite tells somebody their app is
  // broken when it is not.
  while (dirs.length) {
    const dir = dirs.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* a stray folder in the OS temp directory is not worth a failed test */
    }
  }
});

function workspace(files = { 'cv.tex': '\\documentclass{article}' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdftest-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

/** A fake engine driven by node: `script` runs with the .tex name as argv[1]. */
const engine = (name, script, { passes = 1, probeOk = true } = {}) => ({
  name,
  command: process.execPath,
  probe: ['-e', probeOk ? '' : 'process.exit(1)'],
  passes,
  args: (file) => ['-e', script, file],
});

const WRITES_PDF = 'require("fs").writeFileSync("cv.pdf", "%PDF-1.4 fake")';
const NOTHING = '';

test('with nothing installed, findEngine says so rather than guessing', async () => {
  assert.equal(await findEngine({ engines: [engine('nope', NOTHING, { probeOk: false })] }), null);
});

test('findEngine takes the first engine that answers', async () => {
  const found = await findEngine({
    engines: [engine('missing', NOTHING, { probeOk: false }), engine('present', NOTHING)],
  });
  assert.equal(found.name, 'present');
});

test('a missing engine is never cached — installing LaTeX must not need a restart', async () => {
  const absent = [engine('nope', NOTHING, { probeOk: false })];
  assert.equal(await findEngine({ engines: absent }), null);
  // Same process, no forgetEngine() call: the engine "appears" and is found.
  const found = await findEngine({ engines: [engine('now-here', NOTHING)] });
  assert.equal(found.name, 'now-here');
});

test('with no engine, compilePdf reports no-engine and does not pretend', async () => {
  const result = await compilePdf({
    dir: workspace(),
    name: 'cv',
    engines: [engine('nope', NOTHING, { probeOk: false })],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-engine');
  assert.equal(result.pdfPath, undefined);
});

test('a missing .tex is reported as no-source, naming the file', async () => {
  const result = await compilePdf({
    dir: workspace({ 'other.tex': 'x' }),
    name: 'cv',
    engines: [engine('fake', WRITES_PDF)],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-source');
  assert.match(result.detail, /cv\.tex/);
});

test('a successful compile returns the path to a PDF that exists', async () => {
  const dir = workspace();
  const result = await compilePdf({ dir, name: 'cv', engines: [engine('fake', WRITES_PDF)] });
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'fake');
  assert.equal(result.pdfPath, path.join(dir, 'cv.pdf'));
  assert.ok(fs.existsSync(result.pdfPath));
});

test('a PDF that exists wins over a non-zero exit code, which is what pdflatex really does', async () => {
  const dir = workspace();
  const result = await compilePdf({
    dir,
    name: 'cv',
    engines: [engine('grumpy', `${WRITES_PDF}; process.exit(1)`)],
  });
  assert.equal(result.ok, true, 'pdflatex exits non-zero on warnings that still typeset');
  assert.ok(fs.existsSync(path.join(dir, 'cv.pdf')));
});

test('an empty PDF does not count as success', async () => {
  const result = await compilePdf({
    dir: workspace(),
    name: 'cv',
    engines: [engine('empty', 'require("fs").writeFileSync("cv.pdf", "")')],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
});

test('a failed compile explains itself with the error from the log', async () => {
  const script =
    'console.log("(/usr/share/texmf/tex/latex/base/article.cls");' +
    'console.log("! Undefined control sequence.");' +
    'console.log("l.42 \\\\cvheadr");' +
    'process.exit(1)';
  const result = await compilePdf({ dir: workspace(), name: 'cv', engines: [engine('fake', script)] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.match(result.detail, /Undefined control sequence/);
  assert.doesNotMatch(result.detail, /article\.cls/, 'font and class noise is dropped');
});

test('a two-pass engine runs twice — the second pass is what makes links work', async () => {
  const dir = workspace();
  const script = 'const fs=require("fs");const n=fs.existsSync("passes")?fs.readFileSync("passes","utf8"):"";' +
    'fs.writeFileSync("passes", n + "x");fs.writeFileSync("cv.pdf", "%PDF-1.4 fake")';
  await compilePdf({ dir, name: 'cv', engines: [engine('twice', script, { passes: 2 })] });
  assert.equal(fs.readFileSync(path.join(dir, 'passes'), 'utf8'), 'xx');
});

test('a first pass that fails outright is not run a second time', async () => {
  const dir = workspace();
  const script = 'const fs=require("fs");const n=fs.existsSync("passes")?fs.readFileSync("passes","utf8"):"";' +
    'fs.writeFileSync("passes", n + "x");process.exit(1)';
  await compilePdf({ dir, name: 'cv', engines: [engine('twice', script, { passes: 2 })] });
  assert.equal(fs.readFileSync(path.join(dir, 'passes'), 'utf8'), 'x');
});

test('a hung engine is killed and reported as a timeout, not left running', async () => {
  const dir = workspace();
  const result = await compilePdf({
    dir,
    name: 'cv',
    engines: [engine('hangs', 'setTimeout(() => {}, 60000)')],
    timeoutMs: 400,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'timeout');
  assert.match(result.detail, /did not finish/);

  // "not left running" is half this test's name and it used to check none of
  // it. Deleting the directory the engine was working in is the observable
  // form of the claim: a process that is still alive still holds it, and
  // Windows refuses with EBUSY. On Linux this passes either way, which is
  // exactly why the bug lived here — it was only ever visible on somebody
  // else's machine, as a confusing failure in the cleanup hook rather than a
  // named assertion in the test that caused it. No retries on purpose.
  assert.doesNotThrow(
    () => fs.rmSync(dir, { recursive: true }),
    'compilePdf resolved while the engine it killed was still holding the directory',
  );
});

test('a command that cannot be spawned is a missing engine, not a crash', async () => {
  const result = await compilePdf({
    dir: workspace(),
    name: 'cv',
    engines: [{ name: 'ghost', command: 'definitely-not-a-real-binary-xyz', probe: ['-v'], passes: 1, args: (f) => [f] }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-engine');
});

test('explainLog keeps the error and drops the noise', () => {
  const log = ['Loading fonts...', 'lots of nothing', '! LaTeX Error: File `atscv.sty` not found.',
    'Type X to quit.', '', 'l.3 \\usepackage{atscv}'].join('\n');
  const out = explainLog(log);
  assert.match(out, /atscv\.sty` not found/);
  assert.doesNotMatch(out, /Loading fonts/);
});

test('explainLog falls back to the tail when there is no marked error', () => {
  assert.match(explainLog('one\ntwo\nsegmentation fault'), /segmentation fault/);
});

test('explainLog survives no output at all', () => {
  assert.doesNotThrow(() => explainLog(undefined));
  assert.equal(explainLog(''), '');
});

test('the install hint names a real installer for the platform you are on', () => {
  assert.match(installHint('win32'), /MiKTeX/);
  assert.match(installHint('darwin'), /MacTeX|BasicTeX/);
  assert.match(installHint('linux'), /TeX Live|texlive/);
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.doesNotMatch(installHint(platform), /^Install LaTeX\.?$/, 'must be actionable');
  }
});

// This is not pedantry: the first version of this hint listed
// texlive-latex-recommended and texlive-fonts-recommended, and following it
// left you with an engine that still could not compile the CV, because
// atscv.sty pulls in titlesec and enumitem from texlive-latex-extra. An install
// instruction that does not actually work is worse than none.
test('the Linux hint lists every package atscv.sty actually needs', () => {
  const hint = installHint('linux');
  for (const pkg of ['texlive-latex-base', 'texlive-latex-extra', 'texlive-fonts-recommended']) {
    assert.match(hint, new RegExp(pkg), `${pkg} is required and must be in the hint`);
  }
});

// --- platform handling -------------------------------------------------------
//
// These exist because the reported failure was on Windows with MiKTeX, which
// this container cannot run. They pin the two decisions made about it.

test('Windows tries pdflatex before latexmk', () => {
  // latexmk is a Perl script. MiKTeX ships latexmk.exe but not necessarily a
  // Perl for it to drive, so it can be present, spawn, and fail every time
  // while pdflatex.exe beside it works.
  assert.deepEqual(enginesFor('win32').map((e) => e.name), ['pdflatex', 'latexmk', 'tectonic']);
});

test('other platforms keep latexmk first, since it decides its own pass count', () => {
  assert.equal(enginesFor('linux')[0].name, 'latexmk');
  assert.equal(enginesFor('darwin')[0].name, 'latexmk');
});

test('every platform offers the same engines, only in a different order', () => {
  const names = (p) => [...enginesFor(p).map((e) => e.name)].sort();
  assert.deepEqual(names('win32'), names('linux'));
});

test('MiKTeX gets --enable-installer; TeX Live must not', () => {
  // MiKTeX asks before installing a missing package, with a dialog that
  // windowsHide makes invisible — so the compile hangs until the timeout.
  // TeX Live rejects the flag outright, so it can only ever go to MiKTeX.
  const pdflatex = ENGINES.find((e) => e.name === 'pdflatex');
  assert.ok(pdflatex.args('cv.tex', { isMiktex: true }).includes('--enable-installer'));
  assert.ok(!pdflatex.args('cv.tex', { isMiktex: false }).includes('--enable-installer'));
  assert.ok(!pdflatex.args('cv.tex').includes('--enable-installer'), 'and not when nothing is known');
});

test('the .tex file is always the last argument, whatever flags are added', () => {
  for (const engine of ENGINES) {
    for (const context of [{ isMiktex: true }, { isMiktex: false }]) {
      const args = engine.args('cv.tex', context);
      assert.equal(args[args.length - 1], 'cv.tex', engine.name);
    }
  }
});

test('the timeout allows for MiKTeX fetching packages on a first run', () => {
  assert.ok(COMPILE_TIMEOUT_MS >= 300_000, 'two minutes was not enough and read as a broken install');
});

test('the engine search reports what it tried, so the terminal is not silent', async () => {
  const said = [];
  await findEngine({
    engines: [engine('missing', NOTHING, { probeOk: false })],
    log: (line) => said.push(line),
  });
  assert.ok(said.some((line) => /no missing on PATH|no .* on PATH/.test(line)), said.join(' | '));
});

test('a compile reports the command it ran and where it ran it', async () => {
  const said = [];
  const dir = workspace();
  await compilePdf({ dir, name: 'cv', engines: [engine('fake', WRITES_PDF)], log: (line) => said.push(line) });
  const all = said.join('\n');
  assert.match(all, /pass 1 of 1/);
  assert.match(all, /cv\.tex/);
  assert.match(all, /wrote .*cv\.pdf/);
});

test('a failed compile puts the LaTeX error in the terminal too, not only in the browser', async () => {
  const said = [];
  await compilePdf({
    dir: workspace(),
    name: 'cv',
    engines: [engine('fake', 'console.log("! Undefined control sequence.");process.exit(1)')],
    log: (line) => said.push(line),
  });
  assert.match(said.join('\n'), /Undefined control sequence/);
});
