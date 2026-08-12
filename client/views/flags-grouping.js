// WHY a separate file: this is the only logic in the flags panel, and it needs
// to be testable in Node — which the view file is not, because it imports the
// browser build of Preact. Nothing here touches the DOM.
//
// The problem it solves: the panel used to be a flat list in document order.
// One real CV produced thirteen entries, twelve of which were the same
// terminology note about six terms, with the finding that actually mattered —
// a claim the doctorate had been awarded — last, where nobody would reach it.
// A panel you learn to scroll past costs you the findings you would have acted
// on, so ordering by importance is not decoration.

/**
 * What each rule is called, and how much it matters.
 *
 * Ordered by what it costs to miss: a claim a reader can check and disprove
 * comes first; a wording preference comes last. Document order — which is what
 * this used to use — carries no information at all.
 */
const RULES = {
  R4: { title: 'Qualification status', weight: 0 },
  R3: { title: 'Figures that are not releasable', weight: 1 },
  R2: { title: 'Numbers without a source', weight: 2 },
  R1: { title: 'Bullets with no evidence cited', weight: 3 },
  R5: { title: 'Wording that must not appear', weight: 4 },
  R7: { title: 'Contact details', weight: 5 },
  R9: { title: 'Requirements the draft never mentions', weight: 6 },
  R6: { title: 'Wording for this reader', weight: 7 },
};

/** Group by the rule that actually fired, not the advisory wrapper around it. */
export function groupFlags(flags = []) {
  const groups = new Map();

  for (const flag of flags) {
    // In advisory mode every finding is reported as R8 with the real rule in
    // sourceRule. Showing "R8" would tell you nothing — it is the wrapper, not
    // the finding.
    const rule = flag.sourceRule ?? flag.rule ?? 'other';
    if (!groups.has(rule)) groups.set(rule, { rule, title: RULES[rule]?.title ?? rule, flags: [], terms: [] });
    groups.get(rule).flags.push(flag);
  }

  const wording = groups.get('R6');
  if (wording) wording.terms = collectTerms(wording.flags);

  for (const group of groups.values()) {
    const { advice, items } = condense(group.flags);
    group.advice = advice;
    group.items = items;
  }

  return [...groups.values()].sort(
    (a, b) => (RULES[a.rule]?.weight ?? 99) - (RULES[b.rule]?.weight ?? 99) || a.rule.localeCompare(b.rule),
  );
}

/**
 * Turn a group's findings into rows worth reading.
 *
 * Two things happen, and both were visible on a real draft: the same finding
 * appeared twice word for word with only the ref differing, and the same closing
 * advice — "If you can evidence it, say so in the document's own words; if you
 * cannot, this is a gap worth knowing about" — was repeated under every single
 * one. Six findings, and most of the panel's height was two sentences said over
 * and over.
 *
 * So: identical findings fold into one row carrying every ref, and the sentences
 * every finding in the group ends with are hoisted out and said once. The
 * hoisting is by longest common suffix at a sentence boundary rather than by a
 * table of known phrases, so rewording a rule cannot silently stop it working.
 */
export function condense(flags = []) {
  const messages = flags.map((flag) => stripAdvisory(flag.message));
  const advice = flags.length > 1 ? sharedTail(messages) : '';

  const byText = new Map();
  flags.forEach((flag, i) => {
    const text = (advice ? messages[i].slice(0, messages[i].length - advice.length) : messages[i]).trim();
    const key = text || messages[i];
    if (!byText.has(key)) byText.set(key, { text: key, severity: flag.severity, refs: [] });
    const row = byText.get(key);
    if (flag.ref) row.refs.push(flag.ref);
    // One error among ten warnings makes the row an error: the worst thing a row
    // says is what it costs to ignore it.
    if (flag.severity === 'error') row.severity = 'error';
  });

  return { advice: advice.trim(), items: [...byText.values()] };
}

/**
 * The run of whole sentences every message ends with, or ''.
 *
 * Sentence boundaries only. Trimming a shared half-sentence would leave rows
 * ending mid-clause, which reads as a rendering bug rather than as brevity.
 */
function sharedTail(messages) {
  if (messages.length < 2) return '';
  const [first, ...rest] = messages;

  // Every position in `first` where a sentence ends. Walking from the earliest
  // gives the LONGEST suffix that all of them share.
  for (const start of sentenceStarts(first)) {
    const candidate = first.slice(start);
    if (candidate.trim().length < 25) return ''; // too short to be worth hoisting
    if (rest.every((message) => message.endsWith(candidate))) return candidate;
  }
  return '';
}

function sentenceStarts(text) {
  const starts = [];
  const pattern = /[.!?]\s+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) starts.push(match.index + match[0].length);
  return starts;
}

/**
 * One row per term rather than one per occurrence.
 *
 * The term and its plainer wording come from the flag's `detail`, which the
 * validator fills in — parsing them back out of the sentence would break the
 * moment anyone reworded it.
 */
function collectTerms(flags) {
  const byTerm = new Map();
  for (const flag of flags) {
    const term = flag.detail?.term;
    if (!term) continue;
    if (!byTerm.has(term)) byTerm.set(term, { term, translation: flag.detail.translation ?? '', count: 0 });
    byTerm.get(term).count += 1;
  }
  // Most-repeated first: the term used eight times is the bigger decision.
  return [...byTerm.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}

/** "advisory (R6): …" is said once at the top of the panel, not on every line. */
export function stripAdvisory(message) {
  return String(message ?? '').replace(/^advisory \(R\d+\):\s*/, '');
}
