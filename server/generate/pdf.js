// WHY: you asked for a PDF, not a .tex. A .tex file is homework — it means
// installing something, remembering a command, and running it twice. The PDF is
// the thing you actually submits.
//
// So the app compiles it for you, using a TeX engine already on your machine.
// That is the whole trick and it is worth being explicit about why there is no
// alternative here:
//
//   - Bundling a TeX engine is out of the question (they are gigabytes).
//   - Rendering the LaTeX in JavaScript would mean a new dependency and a
//     different renderer from the one atscv.sty was written for, so the PDF
//     would not match the class file you already trusts. DECISIONS D010 caps the
//     runtime dependencies at five, and this is not worth the sixth.
//   - Headless Chrome printing the HTML view is a different document with
//     different typesetting. It already exists — it is the print view.
//
// If no engine is installed we do not fail silently or fake it: the caller gets
// `reason: 'no-engine'` and the UI tells you exactly what to install. The .tex
// download stays, because Overleaf needs nothing installed at all.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Engines we can drive, best first.
 *
 * latexmk wins when present because it decides how many passes are needed —
 * with plain pdflatex we have to run twice ourselves, since the first pass
 * writes the link and reference data that the second pass reads back.
 *
 * `probe` must be something that exits 0 and returns immediately.
 */
export const ENGINES = [
  { name: 'latexmk', command: 'latexmk', probe: ['-version'], passes: 1,
    args: (file) => ['-pdf', '-interaction=nonstopmode', '-halt-on-error', file] },
  { name: 'pdflatex', command: 'pdflatex', probe: ['-version'], passes: 2,
    args: (file, engine) => [
      '-interaction=nonstopmode',
      '-halt-on-error',
      // MiKTeX installs packages the first time it needs them, and by default it
      // asks first — with a dialog. windowsHide:true means that dialog is
      // invisible, so the compile appears to hang until the timeout kills it.
      // This tells it to go ahead. TeX Live has no such flag and rejects it, so
      // it is only ever passed to an engine that said "MiKTeX" when probed.
      ...(engine?.isMiktex ? ['--enable-installer'] : []),
      file,
    ] },
  { name: 'tectonic', command: 'tectonic', probe: ['--version'], passes: 1,
    args: (file) => [file] },
];

/**
 * On Windows, prefer pdflatex.
 *
 * latexmk is a Perl script. MiKTeX ships a `latexmk.exe` wrapper but not always
 * a Perl for it to run, so it can be present, spawn happily, and fail every
 * time — while `pdflatex.exe` beside it works perfectly. Ordering around that
 * is cheaper than diagnosing it.
 */
export function enginesFor(platform = process.platform) {
  if (platform !== 'win32') return ENGINES;
  const order = ['pdflatex', 'latexmk', 'tectonic'];
  return [...ENGINES].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

/**
 * A LaTeX run that has not finished by now is stuck, not slow.
 *
 * Generous because of MiKTeX's first run: it fetches every package the document
 * needs, one at a time, over the network. Two minutes was not enough for that
 * and turned a working install into a "timeout".
 */
export const COMPILE_TIMEOUT_MS = 300_000;

/**
 * How long to wait for a killed engine to actually be gone.
 *
 * SIGKILL is not instant: the process has to be reaped, and until it is, it
 * still holds its working directory. Two seconds is far longer than that ever
 * takes, and the only cost of reaching it is a temp folder left behind.
 */
export const KILL_GRACE_MS = 2_000;

/**
 * Run a command, capturing output. Rejects only on timeout; a non-zero exit is
 * data, not an exception, because LaTeX exits non-zero for things that still
 * produced a usable PDF.
 */
function run(command, args, { cwd, timeoutMs = COMPILE_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      // shell:false — nothing here is ever built from user input, and keeping it
      // false means a path with a space or a quote in it cannot become an
      // argument boundary. Windows finds pdflatex.exe from PATH without a shell.
      child = spawn(command, args, { cwd, windowsHide: true });
    } catch (err) {
      resolve({ ok: false, code: null, output: String(err?.message ?? err), spawnFailed: true });
      return;
    }

    let output = '';
    const collect = (chunk) => {
      // Cap it: a LaTeX log can run to megabytes and we only ever read the errors.
      if (output.length < 200_000) output += chunk;
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    let timedOut = false;
    let giveUp = null;

    const timer = setTimeout(() => {
      timedOut = true;
      // kill() only SENDS the signal. The process is still alive — and still
      // holding `cwd` open — until the OS reaps it, so resolving here handed
      // the caller a directory it was not yet allowed to delete. Invisible on
      // Linux, where you may remove a directory a process has open; an EBUSY on
      // Windows, where you may not. So the resolve waits for `close` below.
      child.kill('SIGKILL');
      // Unless it never comes. A slightly early resolve leaves a stray temp
      // folder; a promise that never settles leaves the export button spinning
      // for ever, which is much worse.
      giveUp = setTimeout(() => resolve({ ok: false, code: null, output, timedOut: true }), KILL_GRACE_MS);
    }, timeoutMs);

    const settle = (value) => {
      clearTimeout(timer);
      if (giveUp) clearTimeout(giveUp);
      resolve(value);
    };

    child.on('error', (err) => {
      settle({ ok: false, code: null, output: String(err?.message ?? err), spawnFailed: true });
    });
    child.on('close', (code) => {
      settle(timedOut ? { ok: false, code: null, output, timedOut: true } : { ok: code === 0, code, output });
    });
  });
}

let cached = null;

/**
 * The first engine that answers, or null. Cached: this spawns processes, and
 * the answer cannot change while the server runs — except that a null is NOT
 * cached, so installing MiKTeX and pressing the button again works without
 * restarting the app. That is the case where a stale answer would be maddening.
 *
 * @returns {Promise<object|null>}
 */
export async function findEngine({ engines = enginesFor(), reload = false, log } = {}) {
  if (cached && !reload) return cached;
  for (const engine of engines) {
    const result = await run(engine.command, engine.probe, { timeoutMs: 10_000 });
    if (result.ok) {
      // Which flavour matters: MiKTeX needs a flag TeX Live rejects. The probe
      // output is the only place that says which one this is.
      const found = { ...engine, isMiktex: /miktex/i.test(result.output ?? '') };
      log?.(`LaTeX engine: ${found.command}${found.isMiktex ? ' (MiKTeX)' : ''}`);
      cached = found;
      return found;
    }
    log?.(`no ${engine.command} on PATH`);
  }
  return null;
}

/** Test seam, and what `reload` would need if this ever gets a cache-clear button. */
export function forgetEngine() {
  cached = null;
}

/**
 * The part of a LaTeX log worth reading. TeX marks real errors with a line
 * starting `!`, and the next couple of lines say where. Everything else is
 * hundreds of lines of font loading.
 */
export function explainLog(output = '') {
  const lines = String(output).split(/\r?\n/);
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('!')) continue;
    kept.push(...lines.slice(i, i + 4).filter((line) => line.trim() !== ''));
    if (kept.length > 24) break;
  }
  if (kept.length > 0) return kept.join('\n');

  // No `!` line: fall back to the tail, which is where a crash lands.
  return lines.filter((line) => line.trim() !== '').slice(-12).join('\n');
}

/**
 * Compile `<name>.tex` in `dir` to `<name>.pdf` beside it.
 *
 * The .tex and atscv.sty must already be in `dir` — that is the LaTeX export's
 * job, and it is why compiling happens in place rather than in a temp folder:
 * `pdflatex cv.tex` in that folder has to keep working by hand.
 *
 * @returns {Promise<{ok: boolean, pdfPath?: string, engine?: string, reason?: string, detail?: string}>}
 */
export async function compilePdf({ dir, name, engines = enginesFor(), timeoutMs = COMPILE_TIMEOUT_MS, log } = {}) {
  const engine = await findEngine({ engines, log });
  if (!engine) {
    log?.('no LaTeX engine found — sending the install instructions instead');
    return { ok: false, reason: 'no-engine' };
  }

  const texFile = `${name}.tex`;
  if (!fs.existsSync(path.join(dir, texFile))) {
    return { ok: false, reason: 'no-source', detail: `${texFile} is not in ${dir}.` };
  }

  let last = null;
  for (let pass = 0; pass < engine.passes; pass += 1) {
    const args = engine.args(texFile, engine);
    log?.(`${engine.command} ${args.join(' ')} (pass ${pass + 1} of ${engine.passes}) in ${dir}`);
    last = await run(engine.command, args, { cwd: dir, timeoutMs });
    // A first pass that fails outright will not be rescued by a second.
    if (!last.ok && pass === 0 && engine.passes > 1) break;
  }

  if (last?.timedOut) {
    log?.(`${engine.command} was still running after ${Math.round(timeoutMs / 1000)}s and was stopped`);
    return { ok: false, reason: 'timeout', engine: engine.name,
      detail: `${engine.name} did not finish within ${Math.round(timeoutMs / 1000)} seconds.` };
  }

  // The exit code is advisory; the PDF existing is the real test. pdflatex
  // returns non-zero for warnings that still typeset perfectly well.
  const pdfPath = path.join(dir, `${name}.pdf`);
  if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) {
    log?.(`wrote ${pdfPath}`);
    return { ok: true, pdfPath, engine: engine.name };
  }

  const detail = explainLog(last?.output);
  log?.(`${engine.command} produced no PDF:\n${detail}`);
  return { ok: false, reason: 'failed', engine: engine.name, detail };
}

/**
 * What to tell you when there is no engine. Named per platform because "install
 * LaTeX" is not an instruction anybody can act on.
 */
export function installHint(platform = process.platform) {
  if (platform === 'win32') {
    return 'No LaTeX engine found. Install MiKTeX from https://miktex.org/download — take the default options, ' +
      'then close and reopen this terminal so it appears on PATH, and restart the app. MiKTeX fetches any ' +
      'missing package the first time it needs one, so the first PDF may pause while it does that.';
  }
  if (platform === 'darwin') {
    return 'No LaTeX engine found. Install MacTeX from https://tug.org/mactex/, then reopen your terminal and ' +
      'restart the app. If you take the smaller BasicTeX instead, also run: ' +
      'sudo tlmgr update --self && sudo tlmgr install titlesec enumitem microtype charter.';
  }
  // The package list is the one that actually worked, found by compiling a real
  // CV and installing whatever the log complained about next. The obvious
  // shorter list (latex-recommended + fonts-recommended) is NOT enough:
  // atscv.sty needs titlesec and enumitem, which live in texlive-latex-extra.
  return 'No LaTeX engine found. Install TeX Live — on Debian or Ubuntu: sudo apt install texlive-latex-base ' +
    'texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended — then restart the app.';
}
