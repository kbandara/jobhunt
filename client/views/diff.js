// WHY: the version history could tell you a version existed, who wrote it and
// when, and could show you the whole document — but not the one thing you open
// it to find out, which is what actually changed. Reading two hundred lines of
// CV twice and spotting the altered sentence is not a thing anyone does, so in
// practice the history was used for restoring and nothing else.
//
// No dependency (D010, D001 — there is no build step to bundle one with). A line
// diff is a first-year algorithm and the documents here are a few hundred lines,
// so the whole thing is below.
//
// Pure on purpose: no imports at all, so `node --test` can load it directly. The
// component that draws the result lives in job.js, next to the history bar it
// belongs to.

/**
 * Beyond this many cells the table is not worth building. Nothing this app
 * produces comes close — a long CV is 200 lines, the master profile about 550 —
 * so this exists for the pasted-in-a-novel case, where a coarse answer now beats
 * a precise one that locks the tab.
 */
export const MAX_CELLS = 2_000_000;

/** How much unchanged text to keep either side of a change. */
export const CONTEXT = 3;

/**
 * Line-by-line difference between two documents.
 *
 * @param {string} before
 * @param {string} after
 * @returns {Array<{type: 'same'|'add'|'remove', text: string}>} in the order the
 *   lines should be read, removals before the additions that replace them
 */
export function diffLines(before = '', after = '') {
  const a = toLines(before);
  const b = toLines(after);

  // Common prefix and suffix come off first. The usual edit is a handful of
  // lines in a document that is otherwise identical, and trimming turns the
  // table from the size of the document into the size of the change.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle =
    midA.length * midB.length > MAX_CELLS
      ? [...midA.map((text) => ({ type: 'remove', text })), ...midB.map((text) => ({ type: 'add', text }))]
      : lcsDiff(midA, midB);

  return [
    ...a.slice(0, start).map((text) => ({ type: 'same', text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ type: 'same', text })),
  ];
}

/** How big the change was, in the terms every diff on earth reports it in. */
export function countChanges(rows = []) {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === 'add') added += 1;
    else if (row.type === 'remove') removed += 1;
  }
  return { added, removed };
}

/**
 * Drop the unchanged middle, keeping a few lines either side of each change.
 *
 * This is the difference between a diff that answers the question and one that
 * buries it: in a two-page CV where a sentence moved, 95% of the lines are
 * noise. Runs of unchanged text become a single `gap` row carrying how many
 * lines it stands for.
 *
 * @returns {Array<{type: 'same'|'add'|'remove'|'gap', text?: string, count?: number}>}
 */
export function withContext(rows = [], context = CONTEXT) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.type === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j += 1) {
      keep[j] = true;
    }
  });

  const out = [];
  let hidden = 0;
  const flush = () => {
    // A gap of one line is longer to describe than to show, so it is not a gap.
    if (hidden === 0) return;
    if (hidden === 1) out.push({ type: 'same', text: '' });
    else out.push({ type: 'gap', count: hidden });
    hidden = 0;
  };
  rows.forEach((row, i) => {
    if (keep[i]) {
      flush();
      out.push(row);
    } else {
      hidden += 1;
    }
  });
  flush();
  return out;
}

/** A document with no text at all has no lines, rather than one empty one. */
function toLines(text) {
  const value = String(text ?? '');
  return value === '' ? [] : value.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Longest common subsequence, walked back into a list of edits.
 *
 * The table is filled from the end so the walk can go forwards, which is what
 * keeps the output in reading order. Uint32Array rather than nested arrays:
 * same result, a fraction of the allocation, and it makes the size cap above a
 * question of arithmetic rather than of hope.
 */
function lcsDiff(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      // Ties go to the removal, so a replaced line reads "was this, now that"
      // rather than the other way round.
      out.push({ type: 'remove', text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ type: 'remove', text: a[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j] });
    j += 1;
  }
  return out;
}
