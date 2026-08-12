// WHY: "export your LinkedIn profile to PDF and drop it here" is the difference
// between a profile somebody writes and a profile somebody never gets round to
// writing. It is also the one step that cannot be done with the five
// dependencies this project has, so it is done here — Node's own zlib plus a
// tolerant reader for the parts of the PDF format that carry text.
//
// This is deliberately NOT a general PDF library. It reads text out of a
// text-based PDF (which is what LinkedIn, Word and every CV template produce)
// and gives up honestly on anything else — a scan, an encrypted file, an exotic
// encoding. Giving up honestly matters more than coverage here, because the
// paste-the-text path beside it always works, and a silent half-extraction would
// produce a profile with words missing and no sign that anything went wrong.
//
// Two things make the difference between readable output and mojibake:
//
// 1. FONT ENCODING. A subset font embedded with Identity-H addresses glyphs by
//    number, so the bytes in the content stream are not text in any encoding.
//    They are only readable through that font's /ToUnicode CMap, so fonts are
//    resolved per page and per Tf operator rather than guessed at globally.
// 2. WHERE THE LINES ARE. A PDF has no line breaks. They are inferred from the
//    text-positioning operators, because a CV run together into one paragraph is
//    not something a model can read structure out of.
import zlib from 'node:zlib';

/** Anything past this is not a CV, and is more likely a mis-picked file. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * @param {Buffer|Uint8Array} input the PDF file
 * @returns {{text: string, pages: number, warnings: string[], readable: boolean}}
 *   `readable` is false when what came out does not look like prose — the signal
 *   the UI uses to send somebody to the paste box instead of handing a model
 *   something that is 90% missing.
 */
export function extractPdfText(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  const warnings = [];

  if (bytes.length === 0) return fail('The file was empty.');
  if (bytes.length > MAX_BYTES) return fail('That file is far larger than any CV — is it the right one?');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return fail('That does not look like a PDF. If it is a Word file, export it to PDF first, or paste the text.');
  }

  const raw = bytes.toString('latin1');
  if (/\/Encrypt\b/.test(raw)) {
    return fail('This PDF is password-protected, so its text cannot be read. Open it and paste the text instead.');
  }

  const objects = indexObjects(raw, bytes);
  const pages = findPages(objects);
  if (pages.length === 0) warnings.push('No page objects were found, so the whole file was read at once.');

  const chunks = [];
  const sources = pages.length > 0 ? pages : [{ contents: [...objects.keys()], fonts: new Map() }];

  for (const page of sources) {
    const content = page.contents
      .map((ref) => decodeStream(objects.get(ref), bytes))
      .filter(Boolean)
      .join('\n');
    if (!content) continue;
    chunks.push(readTextOperators(content, page.fonts));
  }

  const text = tidy(chunks.join('\n\n'));
  if (text.trim() === '') {
    return fail(
      'No text could be read out of this PDF. It is probably a scan (an image of a page rather ' +
        'than text). Paste the text instead.',
    );
  }

  const readable = looksLikeProse(text);
  if (!readable) {
    warnings.push(
      'The text came out garbled, which usually means the fonts are embedded in a way this reader ' +
        'cannot follow. Paste the text instead — it will be exact.',
    );
  }

  return { text, pages: sources.length, warnings, readable };

  function fail(message) {
    return { text: '', pages: 0, warnings: [message], readable: false };
  }
}

// --- objects ----------------------------------------------------------------

/**
 * `12 0 obj … endobj`, by object number. Built by scanning rather than by
 * reading the cross-reference table, because a file that has been appended to,
 * linearised or produced by something slightly wrong still scans fine and can
 * easily have an xref that does not agree with it.
 */
function indexObjects(raw, bytes) {
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endobj', start);
    objects.set(Number(match[1]), { start, end: end === -1 ? raw.length : end, raw, bytes });
  }
  return objects;
}

/** The dictionary text of an object — everything before its stream, if any. */
function dictOf(object) {
  if (!object) return '';
  const streamAt = object.raw.indexOf('stream', object.start);
  const until = streamAt === -1 || streamAt > object.end ? object.end : streamAt;
  return object.raw.slice(object.start, until);
}

/** `/Key 12 0 R` -> 12. Also reads `/Key [ 1 0 R 2 0 R ]` into a list. */
function refsIn(dict, key) {
  const single = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  if (single) return [Number(single[1])];
  const array = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
  if (!array) return [];
  return [...array[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
}

/** Decode one stream object to a string. Unfiltered and FlateDecode only. */
function decodeStream(object, bytes) {
  if (!object) return '';
  const marker = object.raw.indexOf('stream', object.start);
  if (marker === -1 || marker > object.end) return '';

  let from = marker + 'stream'.length;
  if (object.raw[from] === '\r') from += 1;
  if (object.raw[from] === '\n') from += 1;
  const to = object.raw.indexOf('endstream', from);
  if (to === -1) return '';

  const body = bytes.subarray(from, to);
  const dict = object.raw.slice(object.start, marker);

  if (!/\/Filter/.test(dict)) return body.toString('latin1');
  if (!/FlateDecode/.test(dict)) return ''; // DCT, JPX, LZW: not text we can use
  try {
    return zlib.inflateSync(body).toString('latin1');
  } catch {
    // Some producers leave a stray byte before the deflate block. Retry raw,
    // then give up on this stream rather than on the document.
    try {
      return zlib.inflateRawSync(body.subarray(2)).toString('latin1');
    } catch {
      return '';
    }
  }
}

/**
 * Every page, with its content streams and the fonts in scope for it. Font
 * scope is the part that matters: a code of 0x0024 means different characters in
 * two different subset fonts, so decoding has to know which one is current.
 */
function findPages(objects) {
  const pages = [];
  for (const [number, object] of objects) {
    const dict = dictOf(object);
    if (!/\/Type\s*\/Page\b/.test(dict)) continue;

    const contents = refsIn(dict, 'Contents');
    if (contents.length === 0) continue;

    // Resources are either inline in the page dict or one indirect step away.
    let resources = dict;
    const resourceRef = refsIn(dict, 'Resources')[0];
    if (resourceRef !== undefined) resources = dictOf(objects.get(resourceRef));

    pages.push({ number, contents, fonts: fontsIn(resources, objects) });
  }
  return pages;
}

/** `/Font << /F1 12 0 R /F2 13 0 R >>` -> Map('F1' -> toUnicode map | null). */
function fontsIn(resources, objects) {
  const fonts = new Map();
  const block = /\/Font\s*<<([\s\S]*?)>>/.exec(resources ?? '');
  if (!block) return fonts;

  for (const entry of block[1].matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
    const fontDict = dictOf(objects.get(Number(entry[2])));
    const toUnicodeRef = refsIn(fontDict, 'ToUnicode')[0];
    if (toUnicodeRef === undefined) {
      // A composite font with no ToUnicode cannot be decoded at all; a simple
      // one is readable as Latin-1, which is what `null` means downstream.
      fonts.set(entry[1], null);
      continue;
    }
    const stream = decodeStream(objects.get(toUnicodeRef), objects.get(toUnicodeRef)?.bytes);
    fonts.set(entry[1], parseToUnicode(stream));
  }
  return fonts;
}

/**
 * A /ToUnicode CMap: `beginbfchar` pairs and `beginbfrange` runs, mapping a
 * character code to one or more UTF-16BE units.
 */
export function parseToUnicode(cmap) {
  const map = new Map();
  let codeBytes = 1;
  const text = String(cmap ?? '');

  const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (codespace) {
    const first = /<([0-9A-Fa-f]+)>/.exec(codespace[1]);
    if (first) codeBytes = Math.max(1, Math.ceil(first[1].length / 2));
  }

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      codeBytes = Math.max(codeBytes, Math.ceil(pair[1].length / 2));
      map.set(parseInt(pair[1], 16), utf16beToString(pair[2]));
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    for (const run of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      codeBytes = Math.max(codeBytes, Math.ceil(run[1].length / 2));
      const lo = parseInt(run[1], 16);
      const hi = parseInt(run[2], 16);
      const base = run[3];
      for (let code = lo; code <= hi && code - lo < 65536; code += 1) {
        map.set(code, bumpLastUnit(base, code - lo));
      }
    }
    for (const run of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      codeBytes = Math.max(codeBytes, Math.ceil(run[1].length / 2));
      const lo = parseInt(run[1], 16);
      let offset = 0;
      for (const item of run[3].matchAll(/<([0-9A-Fa-f]*)>/g)) {
        map.set(lo + offset, utf16beToString(item[1]));
        offset += 1;
      }
    }
  }

  return map.size > 0 ? { map, codeBytes } : null;
}

function utf16beToString(hex) {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const unit = parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16);
    if (Number.isNaN(unit)) break;
    out += String.fromCharCode(unit);
  }
  return out;
}

/** The nth entry of a bfrange: the destination with its last unit incremented. */
function bumpLastUnit(hex, offset) {
  if (hex.length < 4) return utf16beToString(hex);
  const head = hex.slice(0, -4);
  const last = parseInt(hex.slice(-4), 16) + offset;
  return utf16beToString(head + last.toString(16).padStart(4, '0'));
}

// --- content streams ---------------------------------------------------------

/**
 * Walk a content stream and collect what the text operators show.
 *
 * A PDF has no lines and no spaces between words in any reliable sense: both are
 * positioning. So both are inferred — a move down the page is a line break, and
 * a large negative kern inside a TJ array is a space. Getting this roughly right
 * is what makes the difference between a model reading a CV and a model reading
 * one enormous word.
 */
function readTextOperators(content, fonts) {
  let out = '';
  let font = null;
  let pendingBreak = false;

  const tokens = tokenize(content);
  const stack = [];

  const emit = (piece) => {
    if (piece === '') return;
    if (pendingBreak && out !== '') out += '\n';
    pendingBreak = false;
    out += piece;
  };

  for (const token of tokens) {
    if (token.type !== 'op') {
      stack.push(token);
      continue;
    }

    switch (token.value) {
      case 'Tf': {
        const name = stack.findLast((t) => t.type === 'name');
        font = name ? (fonts.get(name.value) ?? null) : null;
        break;
      }
      case 'Tj':
      case "'":
      case '"': {
        const string = stack.findLast((t) => t.type === 'string');
        if (token.value !== 'Tj') pendingBreak = true;
        if (string) emit(decodeString(string, font));
        break;
      }
      case 'TJ': {
        const array = stack.findLast((t) => t.type === 'array');
        if (array) emit(decodeArray(array.value, font));
        break;
      }
      case 'Td':
      case 'TD':
      case 'T*':
      case 'ET':
        pendingBreak = true;
        break;
      case 'TD_ignored':
        break;
      default:
        break;
    }
    stack.length = 0;
  }

  return out;
}

/** A TJ array: strings, and numbers that are kerning in thousandths of an em. */
function decodeArray(items, font) {
  let out = '';
  for (const item of items) {
    if (item.type === 'string') {
      out += decodeString(item, font);
    } else if (item.type === 'number' && item.value <= -120) {
      // Anything this negative is a word gap rather than letter spacing. The
      // threshold is generous: a missing space is a joinedword, an extra one is
      // harmless.
      if (!out.endsWith(' ')) out += ' ';
    }
  }
  return out;
}

function decodeString(token, font) {
  const bytes = token.bytes;
  if (font && font.map) {
    let out = '';
    const width = font.codeBytes >= 2 ? 2 : 1;
    for (let i = 0; i + width <= bytes.length; i += width) {
      const code = width === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
      out += font.map.get(code) ?? '';
    }
    return out;
  }
  return Buffer.from(bytes).toString('latin1');
}

/**
 * Enough of a PDF content-stream tokenizer for the text operators: strings, hex
 * strings, arrays, names, numbers and operators. Everything else is skipped
 * rather than understood.
 */
function tokenize(content) {
  const tokens = [];
  let i = 0;

  const readString = () => {
    const bytes = [];
    let depth = 1;
    i += 1;
    while (i < content.length) {
      const ch = content[i];
      if (ch === '\\') {
        const next = content[i + 1];
        const octal = /^[0-7]{1,3}/.exec(content.slice(i + 1, i + 4));
        if (octal) {
          bytes.push(parseInt(octal[0], 8) & 0xff);
          i += 1 + octal[0].length;
          continue;
        }
        const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
        if (next === '\n') i += 2;
        else {
          bytes.push(escapes[next] ?? next.charCodeAt(0));
          i += 2;
        }
        continue;
      }
      if (ch === '(') depth += 1;
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) { i += 1; break; }
      }
      bytes.push(content.charCodeAt(i) & 0xff);
      i += 1;
    }
    return { type: 'string', bytes };
  };

  const readHexString = () => {
    i += 1;
    const end = content.indexOf('>', i);
    const hex = content.slice(i, end === -1 ? content.length : end).replace(/[^0-9A-Fa-f]/g, '');
    i = end === -1 ? content.length : end + 1;
    const bytes = [];
    for (let n = 0; n < hex.length; n += 2) bytes.push(parseInt(hex.slice(n, n + 2).padEnd(2, '0'), 16));
    return { type: 'string', bytes };
  };

  while (i < content.length) {
    const ch = content[i];

    if (ch === '%') { // comment to end of line
      while (i < content.length && content[i] !== '\n') i += 1;
      continue;
    }
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '(') { tokens.push(readString()); continue; }
    if (ch === '<' && content[i + 1] !== '<') { tokens.push(readHexString()); continue; }
    if (ch === '<' || ch === '>') { i += 2; continue; } // dictionaries are not text
    if (ch === '[') {
      const items = [];
      i += 1;
      while (i < content.length && content[i] !== ']') {
        if (/\s/.test(content[i])) { i += 1; continue; }
        if (content[i] === '(') { items.push(readString()); continue; }
        if (content[i] === '<') { items.push(readHexString()); continue; }
        const number = /^[-+]?[\d.]+/.exec(content.slice(i));
        if (number) { items.push({ type: 'number', value: Number(number[0]) }); i += number[0].length; continue; }
        i += 1;
      }
      i += 1;
      tokens.push({ type: 'array', value: items });
      continue;
    }
    if (ch === '/') {
      const name = /^\/([^\s/[\]<>()]*)/.exec(content.slice(i));
      tokens.push({ type: 'name', value: name ? name[1] : '' });
      i += name ? name[0].length : 1;
      continue;
    }
    const number = /^[-+]?[\d.]+/.exec(content.slice(i));
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const op = /^[A-Za-z'"*][A-Za-z0-9*'"]*/.exec(content.slice(i));
    if (op) {
      tokens.push({ type: 'op', value: op[0] });
      i += op[0].length;
      continue;
    }
    i += 1;
  }

  return tokens;
}

// --- tidying ------------------------------------------------------------------

function tidy(text) {
  return normaliseCharacters(text)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Drop what is not really on the page and normalise what is.
 *
 * Written as a scan over code points rather than as a regular expression of
 * escapes, because the characters this deals with are invisible — a regex
 * literal full of them is a line nobody can review, and one that has been
 * mangled by an editor looks exactly like one that has not.
 *
 * Three groups:
 *  - CONTROL BYTES, which is what an undecodable glyph leaves behind. Dropping
 *    them keeps the prompt clean, and stops them padding out the garbled-text
 *    check with characters that were never on the page.
 *  - ZERO-WIDTH characters and byte-order marks: invisible, and noise in a prompt.
 *  - FIXED-WIDTH SPACES, which become ordinary spaces rather than nothing,
 *    because they are holding words apart.
 */
function normaliseCharacters(text) {
  const NEWLINE = 10;
  const TAB = 9;
  const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0xfeff, 0x2060]);
  const FIXED_SPACES = new Set([0x00a0, 0x2007, 0x202f, 0x2009, 0x2002, 0x2003]);

  let out = '';
  for (const character of String(text ?? '').replace(/\r\n?/g, '\n')) {
    const code = character.codePointAt(0);
    if (code === NEWLINE || code === TAB) {
      out += character;
    } else if (code < 32 || code === 127) {
      continue;
    } else if (ZERO_WIDTH.has(code)) {
      continue;
    } else if (FIXED_SPACES.has(code)) {
      out += ' ';
    } else {
      out += character;
    }
  }
  return out;
}

/**
 * Does this look like language? Worth catching, because a model handed noise
 * will confidently produce a profile out of it.
 *
 * Two tests, because one is not enough. A letter ratio catches the obvious kind
 * of garbling — punctuation and control bytes with barely a letter in it. But
 * the failure that actually happens is a subset font decoded with the wrong
 * table, and that comes out as a substitution cipher: "Research Assistant"
 * becomes "5HVHDUFK$VVLVWDQW", which is almost all letters and passes a ratio
 * test comfortably. What it never contains is the words English is mostly made
 * of. So over any meaningful length, their absence is the signal.
 */
const COMMON_WORDS = ['the', 'and', 'of', 'to', 'in', 'for', 'with', 'at', 'on', 'from', 'by', 'as'];

function looksLikeProse(text) {
  const sample = text.slice(0, 4000);
  const compact = sample.replace(/\s/g, '');
  // Below this there is genuinely nothing to judge — but an extraction this
  // short from a CV is itself a failure, so it is reported as one either way.
  if (compact.length < 12) return false;

  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  if (letters / compact.length < 0.55) return false;

  // A heading or a two-word fixture has no common words either, so the second
  // test only applies once there is enough text for their absence to mean
  // something. Any real CV is far past this.
  if (compact.length < 200) return true;
  const words = new Set(sample.toLowerCase().match(/[a-z]+/g) ?? []);
  return COMMON_WORDS.filter((word) => words.has(word)).length >= 2;
}

export default extractPdfText;
