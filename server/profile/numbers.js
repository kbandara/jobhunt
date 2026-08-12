// WHY: the parser and the validator must agree, byte for byte, on what counts as
// a number — any disagreement between them is a gap a fabricated figure walks
// through. So both sides call this one module.
// DIGITS ONLY, never number-words (D012): "one honest difference" is rhetoric,
// and flagging it once pushed a draft into deleting a claim that was TRUE.

/** Digit runs: comma-grouped thousands first, then plain integers/decimals. */
const TOKEN_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** Currency symbols, matched against the ≤3 characters in front of the digits. */
const CURRENCY_RE = /(AU\$|NZ\$|US\$|A\$|\$|£|€)$/;

/**
 * A '-' directly before digits is a minus sign only when what precedes IT is not
 * itself part of a value. "1-10" and "86%-21%" are ranges; "COVID-19" is a
 * compound word; only " -0.21" is negative.
 */
const NOT_A_SIGN_BEFORE = /[\w)\]%]/;

const EPSILON = 1e-9;

/**
 * Every digit-based number in `text`, in document order.
 * @returns {Array<{raw: string, value: number, unit: string|null, index: number}>}
 */
export function extractNumbers(text) {
  if (typeof text !== 'string' || text === '') return [];

  const out = [];
  TOKEN_RE.lastIndex = 0;
  let m;

  while ((m = TOKEN_RE.exec(text)) !== null) {
    const digits = m[0];
    const digitsStart = m.index;
    let start = digitsStart;
    let end = digitsStart + digits.length;
    let sign = 1;

    const prev = text[start - 1];
    if (prev === '-' || prev === '−') {
      const before = text[start - 2];
      if (before === undefined || !NOT_A_SIGN_BEFORE.test(before)) {
        sign = -1;
        start -= 1;
      }
    }

    // Unit: a trailing percent sign wins; otherwise a leading currency symbol.
    let unit = null;
    const percent = /^ ?%/.exec(text.slice(end));
    if (percent) {
      unit = '%';
      end += percent[0].length;
    } else {
      const currency = CURRENCY_RE.exec(text.slice(Math.max(0, start - 3), start));
      if (currency) {
        unit = currency[1].endsWith('$') ? '$' : currency[1];
        start -= currency[1].length;
      }
    }

    const value = Number.parseFloat(digits.replace(/,/g, '')) * sign;
    if (Number.isNaN(value)) continue;

    out.push({ raw: text.slice(start, end), value, unit, index: start });
  }

  return out;
}

/** Coerce a number, a numeric string, or an extracted number into {value, unit}. */
function toNumber(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isNaN(input) ? null : { value: input, unit: null };
  }
  if (typeof input === 'string') {
    const [first] = extractNumbers(input);
    return first ? { value: first.value, unit: first.unit } : null;
  }
  if (typeof input === 'object' && typeof input.value === 'number') {
    return { value: input.value, unit: input.unit ?? null };
  }
  return null;
}

/**
 * Do two numbers refer to the same quantity? Values are compared after
 * normalization ("2,500" === 2500). A value match whose units differ (record
 * says 20, bullet says "20%") still matches, but reports `unitMismatch` so the
 * validator can warn rather than either passing it silently or failing it flat.
 * @returns {{match: boolean, unitMismatch: boolean}}
 */
export function numbersMatch(a, b) {
  const left = toNumber(a);
  const right = toNumber(b);
  if (left === null || right === null) return { match: false, unitMismatch: false };

  const match = Math.abs(left.value - right.value) < EPSILON;
  return { match, unitMismatch: match && left.unit !== right.unit };
}

/** Shared tolerance, so the validator's arithmetic checks use the same epsilon. */
export function valuesEqual(a, b) {
  return Math.abs(a - b) < EPSILON;
}
