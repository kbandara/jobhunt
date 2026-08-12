// WHY: the third thing every application asks for, and the one this app had no
// answer to. A CV and a cover letter go in the portal's file fields; then there
// are eight boxes wanting 300 words each on "demonstrated capacity to work
// independently", and those boxes are where the day actually goes.
//
// Two facts shape everything here.
//
// 1. THE QUESTIONS ARE RARELY IN THE ADVERTISEMENT. Some are — parse-jd picks up
//    a `selection_criteria` list when the ad prints one — but most live behind a
//    login, in the portal, and arrive by copy and paste. So the questions are an
//    editable field seeded from the parse, never a read-only derivation of it.
//
// 2. THE WORD LIMIT IS LOAD-BEARING. Portals truncate mid-sentence without
//    warning, and an answer that stops halfway reads as carelessness. The limit
//    is therefore extracted in CODE from the text you paste, counted in CODE
//    against what was written, and shown — never left to a model that cannot
//    count words and will cheerfully claim it did.

/** How a limit is written in the wild. Ordered longest-first so "300 word limit"
 *  is not matched by the bare-number rule before the specific one sees it. */
const LIMIT_PATTERNS = [
  /\b(?:max(?:imum)?|no more than|up to|within|limit(?:ed)? to)\s*[:\s]?\s*(\d{2,5})\s*words?\b/i,
  /\b(\d{2,5})\s*words?\s*(?:max(?:imum)?|or less|or fewer|limit)\b/i,
  /\((\d{2,5})\s*words?[^)]*\)/i,
  /\b(\d{2,5})\s*words?\b/i,
];

/**
 * Turn pasted text into a list of questions.
 *
 * Splits on blank lines first, because that is how a portal's questions come out
 * of a copy and paste; a single-line-per-question paste works too. Numbering and
 * bullet markers are stripped, and a word limit anywhere in the question is
 * lifted out into its own field so it can be counted against later.
 *
 * @param {string} text
 * @returns {{question: string, wordLimit: number|null}[]}
 */
export function parseQuestions(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (raw === '') return [];

  // A blank line between questions is the strongest signal there is. Without
  // one, every non-empty line is its own question — which is right for a pasted
  // list and harmless for a single question typed on one line.
  const chunks = /\n\s*\n/.test(raw)
    ? raw.split(/\n\s*\n+/)
    : raw.split('\n');

  return chunks
    .map((chunk) => chunk.split('\n').map((line) => line.trim()).filter(Boolean).join(' '))
    .map(stripMarker)
    .filter((question) => question !== '')
    .map((question) => ({ question, wordLimit: limitIn(question) }));
}

/** "1." / "1)" / "-" / "•" / "a)" at the start of a question is formatting, not content. */
function stripMarker(line) {
  return String(line)
    .replace(/^\s*(?:[-*+•–—]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i, '')
    .trim();
}

/**
 * The word limit stated inside a question, or null.
 *
 * Deliberately returns null rather than guessing when the number is implausible:
 * "in the last 5 words you used" is not a limit, and a limit of 5 would produce
 * an answer that fails for a reason you would never find.
 */
export function limitIn(question) {
  const text = String(question ?? '');
  for (const pattern of LIMIT_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 20 && n <= 5000) return n;
  }
  return null;
}

/**
 * The questions for a job: what you pasted, or the ones the advertisement printed.
 *
 * Your paste always wins outright rather than being merged. A merge sounds
 * helpful and is not: the ad's wording and the portal's wording for the same
 * criterion are usually slightly different, and you would get both, twice
 * answered, with no way to tell which the assessor will read.
 *
 * @param {object} job
 * @returns {{questions: {question: string, wordLimit: number|null}[], source: 'you'|'advertisement'|'none'}}
 */
export function questionsFor(job) {
  const own = Array.isArray(job?.questions?.items) ? job.questions.items : [];
  if (own.length > 0) return { questions: own, source: 'you' };

  const fromAd = (job?.parsed?.selection_criteria ?? [])
    .map((c) => ({
      question: String(c?.question ?? '').trim(),
      wordLimit: Number.isInteger(c?.word_limit) ? c.word_limit : limitIn(c?.question),
    }))
    .filter((c) => c.question !== '');

  return fromAd.length > 0
    ? { questions: fromAd, source: 'advertisement' }
    : { questions: [], source: 'none' };
}

/**
 * Words in a string, counted the way a portal counts them.
 *
 * Portals split on whitespace. That means "state-of-the-art" is one word and
 * "3.4%" is one word, and any cleverer definition would report a number you
 * cannot reconcile with the box you are pasting into.
 */
export function wordCount(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length === 1 && words[0] === '' ? 0 : words.length;
}

/**
 * Count each answer in a saved criteria document against its limit.
 *
 * Reads the markdown rather than the model's structured output on purpose: you
 * edits these by hand, and the count that matters is of the text you are about to
 * paste. Questions are matched to headings by position — the document is
 * generated from the list in order, and a heading that has been reworded is
 * still the answer to the nth question.
 *
 * @param {string} markdown the saved document
 * @param {{question: string, wordLimit: number|null}[]} questions
 * @returns {{question: string, heading: string|null, words: number, wordLimit: number|null, over: boolean}[]}
 */
export function answerCounts(markdown, questions = []) {
  const answers = splitAnswers(markdown);
  return questions.map((q, i) => {
    const found = answers[i] ?? null;
    const words = found ? wordCount(found.body) : 0;
    return {
      question: q.question,
      heading: found?.heading ?? null,
      words,
      wordLimit: q.wordLimit ?? null,
      over: Boolean(q.wordLimit && words > q.wordLimit),
    };
  });
}

/**
 * The document split into one block per answer, in document order.
 *
 * "## " starts an answer. The contact block above the first one is not an
 * answer and is dropped — it is the same code-generated header every document
 * carries, and counting it against a word limit would be nonsense.
 */
export function splitAnswers(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  const out = [];
  let current = null;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { heading: heading[1], body: '' };
      out.push(current);
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  return out.map((answer) => ({ ...answer, body: answer.body.trim() }));
}
