// WHY these tests build real PDFs byte by byte: the failure this reader has is
// not "it throws", it is "it returns something that looks like text and is
// missing every third word". That is invisible to a test written against a
// fixture nobody can read, so the fixtures here are constructed from known
// input and asserted against exactly.
//
// Two encodings are covered because they are the two that turn up: a simple
// font, where the bytes are the characters, and a subset font with Identity-H,
// where they are glyph numbers and only the /ToUnicode CMap can turn them back
// into words. The second is what a CV exported from a modern tool usually is,
// and it is the case that produces mojibake when a reader ignores it.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { extractPdfText, parseToUnicode } from './pdf-text.js';

/** Assemble a one-page PDF around a content stream. */
function pdf({ content, toUnicode = null, compress = false, encrypt = false }) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  const stream = (dict, data) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
    const payload = compress ? zlib.deflateSync(body) : body;
    const filter = compress ? ' /Filter /FlateDecode' : '';
    return Buffer.concat([
      Buffer.from(`<< ${dict} /Length ${payload.length}${filter} >>\nstream\n`, 'latin1'),
      payload,
      Buffer.from('\nendstream', 'latin1'),
    ]);
  };

  const contentRef = add(stream('', content));
  let fontRef;
  if (toUnicode) {
    const cmapRef = add(stream('', toUnicode));
    fontRef = add(`<< /Type /Font /Subtype /Type0 /BaseFont /AAAAAA+Test /Encoding /Identity-H /ToUnicode ${cmapRef} 0 R >>`);
  } else {
    fontRef = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  }
  const pageRef = add(
    `<< /Type /Page /Parent 99 0 R /Contents ${contentRef} 0 R ` +
      `/Resources << /Font << /F1 ${fontRef} 0 R >> >> >>`,
  );

  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')];
  objects.forEach((body, index) => {
    parts.push(Buffer.from(`${index + 1} 0 obj\n`, 'latin1'));
    parts.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    parts.push(Buffer.from('\nendobj\n', 'latin1'));
  });
  parts.push(Buffer.from(`trailer << /Root 1 0 R${encrypt ? ' /Encrypt 50 0 R' : ''} >>\n%%EOF\n`, 'latin1'));
  return { buffer: Buffer.concat(parts), pageRef };
}

/** Identity-H: two bytes per glyph, mapped back through the CMap below. */
const IDENTITY_CMAP = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin begincmap',
  '1 begincodespacerange <0000> <FFFF> endcodespacerange',
  '2 beginbfrange',
  '<0024> <003D> <0041>', // glyphs 0x24.. -> "A".."Z"
  '<0044> <005D> <0061>', // glyphs 0x44.. -> "a".."z"
  'endbfrange',
  '2 beginbfchar',
  '<0003> <0020>', // space
  '<000F> <002C>', // comma
  'endbfchar',
  'endcmap end end',
].join('\n');

/** "Research Assistant" as Identity-H glyph codes for the CMap above. */
function glyphs(text) {
  let hex = '';
  for (const ch of text) {
    if (ch === ' ') hex += '0003';
    else if (ch === ',') hex += '000f';
    else if (ch >= 'A' && ch <= 'Z') hex += (0x24 + ch.charCodeAt(0) - 65).toString(16).padStart(4, '0');
    else if (ch >= 'a' && ch <= 'z') hex += (0x44 + ch.charCodeAt(0) - 97).toString(16).padStart(4, '0');
    else throw new Error(`the test CMap has no glyph for "${ch}"`);
  }
  return hex;
}

// --- the ordinary case --------------------------------------------------------

test('a simple-font PDF reads back the words that were put in', () => {
  const { buffer } = pdf({
    content: [
      'BT /F1 12 Tf 72 720 Td (Research Assistant) Tj',
      '0 -14 Td (Riverina University) Tj',
      'ET',
    ].join('\n'),
  });
  const result = extractPdfText(buffer);
  assert.equal(result.readable, true, result.warnings.join(' '));
  assert.match(result.text, /Research Assistant/);
  assert.match(result.text, /Riverina University/);
});

test('a move down the page becomes a line break, because a CV run together is unreadable', () => {
  const { buffer } = pdf({
    content: 'BT /F1 12 Tf 72 720 Td (First line) Tj 0 -14 Td (Second line) Tj ET',
  });
  const lines = extractPdfText(buffer).text.split('\n').filter(Boolean);
  assert.deepEqual(lines, ['First line', 'Second line']);
});

test('a large negative kern inside TJ becomes the space it stands for', () => {
  const { buffer } = pdf({
    content: 'BT /F1 12 Tf 72 720 Td [(Data)-400(Analyst)] TJ ET',
  });
  assert.match(extractPdfText(buffer).text, /Data Analyst/);
});

test('letter-spacing kerns are not mistaken for spaces', () => {
  const { buffer } = pdf({ content: 'BT /F1 12 Tf 72 720 Td [(Ana)-20(lyst)] TJ ET' });
  assert.match(extractPdfText(buffer).text, /Analyst/);
});

test('escapes inside a string survive', () => {
  const { buffer } = pdf({
    content: String.raw`BT /F1 12 Tf 72 720 Td (Ran \(and rebuilt\) the pipeline \\ twice) Tj ET`,
  });
  assert.match(extractPdfText(buffer).text, /Ran \(and rebuilt\) the pipeline \\ twice/);
});

test('a hex string is read as bytes, not as its own digits', () => {
  const { buffer } = pdf({ content: 'BT /F1 12 Tf 72 720 Td <48656C6C6F> Tj ET' });
  assert.match(extractPdfText(buffer).text, /Hello/);
});

test('a compressed content stream is inflated', () => {
  const { buffer } = pdf({
    content: 'BT /F1 12 Tf 72 720 Td (Compressed all the same) Tj ET',
    compress: true,
  });
  assert.match(extractPdfText(buffer).text, /Compressed all the same/);
});

// --- the case that produces mojibake if ignored -------------------------------

test('an Identity-H subset font is decoded through its ToUnicode CMap', () => {
  const { buffer } = pdf({
    content: `BT /F1 12 Tf 72 720 Td <${glyphs('Research Assistant')}> Tj ET`,
    toUnicode: IDENTITY_CMAP,
  });
  const result = extractPdfText(buffer);
  assert.equal(result.readable, true, result.warnings.join(' '));
  assert.equal(result.text.trim(), 'Research Assistant');
});

test('without the CMap the same bytes come out as a cipher, and that is caught', () => {
  // Same glyph codes, no /ToUnicode. This is the failure worth catching: the
  // output is almost all letters and looks fine until you read it, because a
  // subset font decoded with the wrong table is a substitution cipher.
  // A page of it, because that is the length a real CV is.
  const line = glyphs('Ran the field season and rebuilt the analysis pipeline in R for the whole team');
  const { buffer } = pdf({
    content: ['BT /F1 12 Tf 72 720 Td', ...Array(4).fill(`<${line}> Tj 0 -14 Td`), 'ET'].join('\n'),
  });
  const result = extractPdfText(buffer);
  const compact = result.text.replace(/\s/g, '');
  const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
  assert.ok(letters / compact.length > 0.9, 'it really does look like letters — that is the trap');
  assert.equal(result.readable, false, 'and it must still be caught');
  assert.match(result.warnings.join(' '), /paste/i);
});

test('a page of real prose passes both checks', () => {
  const prose =
    'Ran the field season for a 40 site sampling program with three volunteers and rebuilt the ' +
    'data entry process after finding a transcription error rate of about four percent';
  const { buffer } = pdf({ content: `BT /F1 12 Tf 72 720 Td (${prose}) Tj 0 -14 Td (${prose}) Tj ET` });
  assert.equal(extractPdfText(buffer).readable, true);
});

test('parseToUnicode reads both bfchar pairs and bfrange runs', () => {
  const cmap = parseToUnicode(IDENTITY_CMAP);
  assert.equal(cmap.codeBytes, 2);
  assert.equal(cmap.map.get(0x24), 'A');
  assert.equal(cmap.map.get(0x3d), 'Z');
  assert.equal(cmap.map.get(0x44), 'a');
  assert.equal(cmap.map.get(0x03), ' ');
  assert.equal(cmap.map.get(0x0f), ',');
});

test('parseToUnicode reads the array form of bfrange', () => {
  const cmap = parseToUnicode(
    '1 begincodespacerange <00> <FF> endcodespacerange\n' +
      '1 beginbfrange <01> <03> [<0058> <0059> <005A>] endbfrange',
  );
  assert.equal(cmap.map.get(1), 'X');
  assert.equal(cmap.map.get(3), 'Z');
});

// --- giving up honestly --------------------------------------------------------

test('a file that is not a PDF says so, and says what to do instead', () => {
  const result = extractPdfText(Buffer.from('This is a Word document, really'));
  assert.equal(result.text, '');
  assert.match(result.warnings[0], /does not look like a PDF/);
  assert.match(result.warnings[0], /paste/i);
});

test('an encrypted PDF is refused rather than half-read', () => {
  const { buffer } = pdf({ content: 'BT /F1 12 Tf (x) Tj ET', encrypt: true });
  const result = extractPdfText(buffer);
  assert.equal(result.text, '');
  assert.match(result.warnings[0], /password-protected/);
});

test('a PDF with no text at all — a scan — says it is probably a scan', () => {
  const { buffer } = pdf({ content: '1 0 0 1 0 0 cm /Im0 Do' });
  const result = extractPdfText(buffer);
  assert.equal(result.text, '');
  assert.match(result.warnings[0], /scan/);
});

test('an empty file does not throw', () => {
  assert.doesNotThrow(() => extractPdfText(Buffer.alloc(0)));
  assert.equal(extractPdfText(Buffer.alloc(0)).readable, false);
});

test('nothing here throws on rubbish input', () => {
  for (const input of [null, undefined, Buffer.from('%PDF-1.4\nnonsense'), new Uint8Array([37, 80, 68, 70, 45])]) {
    assert.doesNotThrow(() => extractPdfText(input), `threw on ${JSON.stringify(input)}`);
  }
});
