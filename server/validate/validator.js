// WHY: this is the core of the product — the mechanical answer to "how do I know
// it didn't invent a metric". It is deterministic, makes no LLM calls, and it
// SURFACES problems rather than silently correcting them; the draft is always
// shown alongside its report and the human has the last word.
// R4 reads qualification status from profile-meta.json's structured booleans and
// NEVER from record prose: the previous build's substring check read "has NOT
// been submitted" as permission to write "submitted" onto a real CV (D006).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../store.js';
import { extractNumbers, numbersMatch, valuesEqual } from '../profile/numbers.js';
import { honorificPattern, postNominalPattern } from '../profile/identity.js';
import { contactLinks } from '../generate/workrights.js';
import { getProfile } from '../generate/profiles/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const BANNED = readJson(path.join(here, 'banned.json'));
const TERM_MAP = readJson(path.join(here, '..', 'generate', 'term-map.json'));
const STOPWORDS = new Set(readJson(path.join(here, 'stopwords.json')).words ?? []);

/**
 * Words that mean "a qualification", used as the context test for R4. The
 * generic ones are here; the names of the qualifications you actually list in
 * profile-meta.json are added to them at check time, so somebody whose
 * unfinished credential is a Masters gets the same protection as somebody whose
 * is a PhD.
 */
const GENERIC_QUALIFICATION_WORDS = [
  'phd', 'ph\\.?d\\.?', 'dphil', 'doctorate', 'doctoral', 'dissertation', 'thesis',
  'degree', 'candidature', 'qualification',
];

function qualificationWordPattern(entries) {
  const extra = entries
    .flatMap(([key, entry]) => [key, entry?.label])
    .filter((word) => typeof word === 'string' && word.trim().length > 2)
    .map((word) => escapeRegex(word.trim()));
  return new RegExp(`\\b(?:${[...GENERIC_QUALIFICATION_WORDS, ...extra].join('|')})\\b`, 'i');
}

/** Which qualifications are doctorates, and so make "Dr" and ", PhD" false. */
function isDoctorate(key, entry) {
  return /\b(?:phd|ph\.?d|dphil|doctor)/i.test(`${key} ${entry?.label ?? ''}`);
}

/** R4 status triggers. `claim` names the profile-meta boolean each one asserts. */
const STATUS_TRIGGERS = [
  { word: 'submitted', claim: 'submitted' },
  { word: 'awarded', claim: 'awarded' },
  { word: 'conferred', claim: 'awarded' },
  { word: 'graduated', claim: 'awarded' },
  { word: 'completed', claim: 'awarded' },
];

/**
 * "Dr" only counts as a false credential when it is attached to YOUR name — a
 * profile legitimately names supervisors, co-authors and referees who really do
 * hold doctorates, and flagging a true statement about somebody else is how a
 * validator loses its authority.
 *
 * Both patterns are built from profile-meta.json by profile/identity.js, which
 * is the one module allowed to know how to read a name. No name there, no check:
 * a validator that guesses whose doctorate is being claimed is worse than one
 * that stays quiet.
 *
 * @param {object} profileMeta
 * @returns {{honorific: RegExp, postNominal: RegExp}|null}
 */
export function nameClaimPatterns(profileMeta) {
  const honorific = honorificPattern(profileMeta);
  const postNominal = postNominalPattern(profileMeta);
  if (!honorific && !postNominal) return null;
  // A profile with a mononym has no post-nominal pattern and still deserves the
  // honorific check, so a missing half is a regex that matches nothing rather
  // than a reason to drop the rule entirely.
  return { honorific: honorific ?? NEVER, postNominal: postNominal ?? NEVER };
}

const NEVER = /(?!)/;

/** Used by R1 to decide whether an uncited cover-letter paragraph is framing. */
const CLAIM_WORD = /\b(?:submitted|submission|awarded|conferred|graduated|completed|phd|doctorate|doctoral|thesis|dissertation|degree|dr)\b/i;

const WORD_SPLIT = /[^A-Za-z0-9′'.]+/;
const CONTEXT_WINDOW = 6; // words either side of a status word count as context

/**
 * @param {object} options
 * @param {object} options.artifact structured generation output (see server/llm/schemas/)
 * @param {'cv'|'cover-letter'|'criteria'} options.artifactKind
 * @param {string[]} options.offeredIds evidence ids actually offered to the model
 * @param {object[]} options.evidence whole evidence records from parse.js
 * @param {string} options.profile
 * @param {object} [options.jobParsed] parse-jd output for this job, for R6 and R9
 * @param {string} [options.renderedText] the assembled markdown, for R5/R7/R9
 * @param {string[]} [options.expectedContactLines] code-generated lines, for R7
 * @param {'strict'|'advisory'} [options.mode] advisory = after human edits (R8)
 * @param {object} [options.profileMeta] profile-meta.json — R4's ground truth
 * @returns {{errors: Array<object>, warnings: Array<object>}}
 */
export function validate({
  artifact,
  artifactKind = 'cv',
  offeredIds = [],
  evidence = [],
  profile,
  jobParsed,
  renderedText,
  expectedContactLines,
  mode = 'strict',
  profileMeta,
} = {}) {
  const errors = [];
  const warnings = [];
  const advisory = mode === 'advisory';
  const meta = profileMeta ?? {};
  const records = Array.isArray(evidence) ? evidence : [];
  const byId = new Map(records.map((r) => [r?.id, r]));
  const offered = new Set(offeredIds ?? []);
  const units = textUnits(artifact, artifactKind);
  const terminology = terminologyContext(profile, jobParsed);

  /** In advisory mode every finding becomes an R8 warning — your word is final. */
  const report = (severity, rule, ref, message, detail) => {
    if (advisory) {
      warnings.push({
        rule: 'R8',
        sourceRule: rule,
        ref,
        message: `advisory (${rule}): ${message}`,
        ...(detail ? { detail } : {}),
      });
      return;
    }
    const item = { rule, ref, message, ...(detail ? { detail } : {}) };
    (severity === 'error' ? errors : warnings).push(item);
  };

  for (const unit of units) {
    const cited = advisory ? records : unit.ids.map((id) => byId.get(id)).filter(Boolean);

    if (!advisory) checkCitations(unit, { offered, byId, report });
    if (cited.length > 0) {
      checkNumbers(unit, cited, { report, advisory });
      if (!advisory) checkReleasability(unit, cited, report);
    }
    checkQualifications(unit, meta, report);
    checkBanned(unit.text, unit.ref, report);
    checkTerms(unit, terminology, report);
  }

  if (typeof renderedText === 'string') {
    checkBanned(renderedText, 'document', report);
    // Over the whole document as well as per bullet, because the place a false
    // credential actually appears is the header — "Rosa Kimani, PhD" under the
    // name — and the header is not a bullet, so a per-unit check never sees it.
    checkCredentialClaims(renderedText, 'document', meta, report);
  }
  if (!advisory) checkContactBlock({ renderedText, expectedContactLines, profileMeta: meta, report });
  checkKeywordCoverage({ renderedText, jobParsed, report });

  return { errors, warnings };
}

// --- R1: citations ---------------------------------------------------------

function checkCitations(unit, { offered, byId, report }) {
  if (unit.ids.length === 0) {
    // A cover-letter paragraph may be pure framing — but only if it makes no
    // factual claim: no digits, and nothing about qualification status.
    if (unit.allowUncited && !CLAIM_WORD.test(unit.text) && !/\d/.test(unit.text)) return;
    report(
      'error',
      'R1',
      unit.ref,
      `this ${unit.label} cites no evidence record, so there is no way to check what it says. ` +
        `Add at least one evidence id from the offered set.`,
      { text: unit.text },
    );
    return;
  }
  for (const id of unit.ids) {
    if (!offered.has(id)) {
      report(
        'error',
        'R1',
        unit.ref,
        `this ${unit.label} cites "${id}", which was not among the evidence records offered ` +
          `for this job. Either the id is wrong or the claim came from somewhere other than your profile.`,
        { id },
      );
    } else if (!byId.has(id)) {
      report('error', 'R1', unit.ref, `this ${unit.label} cites "${id}", which is not in the evidence pool.`, { id });
    }
  }
}

// --- R2: numbers -----------------------------------------------------------

function checkNumbers(unit, cited, { report, advisory }) {
  const pool = [];
  for (const record of cited) {
    for (const number of record?.numbers ?? []) pool.push({ number, id: record.id });
  }
  const source = advisory ? 'anywhere in your profile' : citedList(cited);

  for (const found of extractNumbers(unit.text)) {
    let unitMismatch = null;
    let matched = false;

    for (const entry of pool) {
      const result = numbersMatch(found, entry.number);
      if (!result.match) continue;
      if (!result.unitMismatch) {
        matched = true;
        break;
      }
      unitMismatch = unitMismatch ?? entry;
    }
    if (matched) continue;

    if (unitMismatch) {
      report(
        'warning',
        'R2',
        unit.ref,
        `"${found.raw}" has the same value as ${describe(unitMismatch.number)} in ${unitMismatch.id}, ` +
          `but not the same unit. Check that ${found.raw} is what that record actually says.`,
        { number: found.raw, recordId: unitMismatch.id },
      );
      continue;
    }

    const derived = differenceOf(found.value, pool);
    if (derived) {
      report(
        'warning',
        'R2',
        unit.ref,
        `"${found.raw}" is not stated in ${source}, but it is the difference between ` +
          `${derived.a.number.value} (${derived.a.id}) and ${derived.b.number.value} (${derived.b.id}) — ` +
          `plausibly derived. Worth re-reading to be sure the subtraction says what you mean.`,
        { number: found.raw, from: [derived.a.id, derived.b.id] },
      );
      continue;
    }

    report(
      'error',
      'R2',
      unit.ref,
      `"${found.raw}" does not appear in ${source}. Every figure has to come from a record you ` +
        `cited — if the number is real, add it to master-profile.md; if it is not, remove it.`,
      { number: found.raw },
    );
  }
}

/** First pair of pooled numbers whose absolute difference equals `value`. */
function differenceOf(value, pool) {
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      if (valuesEqual(Math.abs(pool[i].number.value - pool[j].number.value), value)) {
        return { a: pool[i], b: pool[j] };
      }
    }
  }
  return null;
}

// --- R3: releasability -----------------------------------------------------

function checkReleasability(unit, cited, report) {
  if (!cited.every((r) => r?.figuresReleasable === false)) return;
  const found = extractNumbers(unit.text);
  if (found.length === 0) return;
  report(
    'error',
    'R3',
    unit.ref,
    `this role's outcomes are not releasable, so this ${unit.label} must carry no figures — ` +
      `found ${found.map((n) => `"${n.raw}"`).join(', ')}. Describe the mechanism and the data instead.`,
    { numbers: found.map((n) => n.raw), records: cited.map((r) => r.id) },
  );
}

// --- R4: qualification claims ----------------------------------------------

function checkQualifications(unit, meta, report) {
  const entries = Object.entries(meta?.qualifications ?? {}).filter(
    ([, entry]) => entry && typeof entry === 'object',
  );
  if (entries.length === 0) return;

  const text = unit.text ?? '';
  checkCredentialClaims(text, unit.ref, meta, report);

  const qualificationWord = qualificationWordPattern(entries);
  const words = text.split(WORD_SPLIT).filter(Boolean);
  const qualifierAt = words.map((w) => qualificationWord.test(w));
  // The entry heading counts as context for a submission claim only: a bullet
  // under a PhD entry saying "Submitted in October" is about the thesis, while
  // "Awarded a scholarship" under the same entry is not about the degree.
  const headingIsQualification = qualificationWord.test(unit.context ?? '');

  for (const [key, entry] of entries) {
    const label = qualificationLabel(key, entry);
    for (const trigger of STATUS_TRIGGERS) {
      if (entry[trigger.claim] !== false) continue;
      for (let i = 0; i < words.length; i += 1) {
        if (words[i].toLowerCase().replace(/[.,;:]+$/, '') !== trigger.word) continue;

        const near = qualifierAt.some(
          (isQualifier, j) => isQualifier && Math.abs(i - j) <= CONTEXT_WINDOW,
        );
        const inContext = near || (trigger.claim === 'submitted' && headingIsQualification);
        if (!inContext) continue;

        report(
          'error',
          'R4',
          unit.ref,
          `"${words[i]}" says the ${label} has been ${trigger.claim}, but profile-meta.json records ` +
            `${trigger.claim}: false${expectedNote(entry)}. Allowed forms: ${allowedForms(label, entry)}.`,
          { trigger: trigger.word, claim: trigger.claim, status: entry.status, qualification: key },
        );
        break; // one report per trigger word per qualification is enough
      }
    }
  }
}

/**
 * "Dr <you>" and "<you>, PhD": claiming a doctorate that profile-meta.json says
 * has not been awarded. Split out from the rest of R4 because it applies to the
 * whole document as well as to each bullet.
 */
function checkCredentialClaims(text, ref, meta, report) {
  const patterns = nameClaimPatterns(meta);
  if (!patterns || typeof text !== 'string' || text === '') return;
  const unawarded = Object.entries(meta?.qualifications ?? {}).find(
    ([key, entry]) => entry && typeof entry === 'object' && isDoctorate(key, entry) && entry.awarded === false,
  );
  if (!unawarded) return;
  const [, entry] = unawarded;

  if (patterns.honorific.test(text)) {
    report('error', 'R4', ref, credentialMessage('"Dr" is used as a title', entry), { status: entry.status });
  }
  if (patterns.postNominal.test(text)) {
    report('error', 'R4', ref, credentialMessage('the doctorate is used as a post-nominal', entry), {
      status: entry.status,
    });
  }
}

function qualificationLabel(key, entry) {
  const label = String(entry?.label ?? '').trim();
  if (label) return label;
  return key === 'phd' ? 'doctorate' : String(key ?? 'qualification');
}

function credentialMessage(what, entry) {
  return (
    `${what} here, but profile-meta.json records awarded: false — the degree has not been ` +
    `conferred${expectedNote(entry)}. Allowed forms: ${allowedForms('doctorate', entry)}.`
  );
}

function expectedNote(entry) {
  const month = formatMonth(entry?.expectedSubmission);
  return month ? ` (expected submission ${month})` : '';
}

function allowedForms(label, entry) {
  const forms = entry?.allowedForms?.length ? entry.allowedForms : [`${label} candidate`, `${label} in progress`];
  return forms.map((f) => `"${f}"`).join(' or ');
}

function formatMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

// --- R5: banned strings ----------------------------------------------------

function checkBanned(text, ref, report) {
  if (typeof text !== 'string' || text === '') return;
  const lower = text.toLowerCase();

  for (const phrase of BANNED.strings ?? []) {
    if (!lower.includes(phrase.toLowerCase())) continue;
    report('error', 'R5', ref, `"${phrase}" is on the banned list — rewrite this without it.`, { phrase });
  }
  for (const pattern of BANNED.patterns ?? []) {
    const regex = new RegExp(pattern.regex, pattern.flags ?? '');
    const match = regex.exec(text);
    if (!match) continue;
    report('error', 'R5', ref, `${pattern.message} (found "${match[0]}")`, { pattern: pattern.id });
  }
}

// --- R6: technical register ------------------------------------------------
//
// The PROFILE used to decide this: keep the jargon on research/ai-eval, translate it
// on gov/industry. That was wrong. A cognitive-neuroscience role at a startup is
// not a research profile but wants the exact vocabulary, and a data-cleaning role at
// a university does not. The ADVERTISEMENT decides now: if the ad uses the term,
// the document may; otherwise the register decides, and the register comes from
// the ad too, falling back to the profile's default only when the ad was not parsed.

/**
 * One entry per concept, matched on either of its surface forms: the full name
 * and, where it has one, the acronym. Carrying both on one entry is what lets the
 * ad's "DCM" license the CV's "Dynamic Causal Modelling", and the reverse.
 */
const TERM_PATTERNS = TERM_MAP.map((entry) => {
  const forms = [entry.term, entry.acronym].filter(Boolean);
  const alternation = forms.map((form) => `${escapeRegex(form)}s?`).join('|');
  return { ...entry, forms, regex: new RegExp(`(?<![A-Za-z0-9])(?:${alternation})(?![A-Za-z0-9])`, 'i') };
});

/**
 * Fold a plural onto its singular so "theories" and "theory" are the same word.
 * Crude on purpose: it only has to make two spellings of the same term agree,
 * not to be right about English.
 */
function singular(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Strip the accidents — case, hyphens, spacing, primes — from a term. */
function termKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[′’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

/** True when `needle` appears in `haystack` as a whole phrase, not mid-word. */
function containsPhrase(haystack, needle) {
  if (needle === '') return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * What R6 needs to judge one document: how expert the reader is, and which
 * specialist words the advertisement itself already uses.
 *
 * Effective register = the job's `technical_register` when the ad was parsed,
 * otherwise the profile's default `register`. An unknown profile and an unparsed job
 * mean we know nothing about the reader, so nothing is flagged — a validator
 * that guesses loses its authority.
 */
export function terminologyContext(profile, jobParsed) {
  const fromJob = jobParsed?.technical_register;
  const profileRegister = getProfile(profile)?.register ?? null;
  const register = fromJob ?? profileRegister ?? 'specialist';
  const vocabulary = (Array.isArray(jobParsed?.domain_vocabulary) ? jobParsed.domain_vocabulary : [])
    .map(termKey)
    .filter(Boolean);
  return { register, vocabulary };
}

/** Does the advertisement itself use this term, in any close variant? */
function adUsesTerm(entry, vocabulary) {
  const keys = entry.forms.map(termKey).filter(Boolean);
  return vocabulary.some((phrase) => keys.some((key) => phrase === key || containsPhrase(phrase, key)));
}

function checkTerms(unit, terminology, report) {
  if (terminology.register === 'specialist') return; // the reader wants the exact name

  for (const entry of TERM_PATTERNS) {
    if (!entry.regex.test(unit.text ?? '')) continue;
    if (adUsesTerm(entry, terminology.vocabulary)) continue; // the ad said it first

    const alt = entry.alt ? ` (or "${entry.alt}")` : '';
    const why =
      terminology.register === 'general'
        ? 'this reader is not a specialist'
        : 'this reader is only partly technical';
    report(
      'warning',
      'R6',
      unit.ref,
      `"${entry.term}" is a specialist name, and the advertisement never uses it — ${why}. ` +
        `Say "${entry.translation}"${alt} instead. Generalising the name is fine; overstating the work is not.`,
      { term: entry.term, translation: entry.translation, register: terminology.register },
    );
  }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- R7: work-rights & contact block ---------------------------------------

function checkContactBlock({ renderedText, expectedContactLines, profileMeta, report }) {
  if (!Array.isArray(expectedContactLines) || expectedContactLines.length === 0) return;
  if (typeof renderedText !== 'string') {
    report('warning', 'R7', 'contact-block', `the contact block could not be checked because the rendered document was not supplied.`);
    return;
  }

  for (const line of expectedContactLines) {
    if (renderedText.includes(line)) continue;
    report(
      'error',
      'R7',
      'contact-block',
      `the contact line "${line}" is missing or was reworded. These lines are generated by code ` +
        `from your profile and the work-rights rules, and must appear byte-exact — the model never writes them.`,
      { line },
    );
  }

  if (expectedContactLines.some((line) => /FILL-ME/i.test(line))) {
    report(
      'warning',
      'R7',
      'contact-block',
      `your contact details still contain FILL-ME, so the link checks were skipped. Fill them in ` +
        `under Settings before you send this anywhere.`,
    );
    return;
  }

  // A missing link is a diagnosed defect, so every link the profile declares has
  // to reach the page. Which links those are is the person's business: the rule
  // used to demand GitHub and LinkedIn by name, which is wrong for anybody whose
  // field lives on ORCID, or who has neither and said so by not listing them.
  for (const link of contactLinks(profileMeta)) {
    if (renderedText.includes(link.url) || renderedText.includes(link.label)) continue;
    report(
      'error',
      'R7',
      'contact-block',
      `the ${link.kind} link is missing from the document — a missing link is one of the defects ` +
        `this app exists to fix.`,
      { link: link.kind },
    );
  }
}

// --- R9: keyword coverage --------------------------------------------------
//
// Ported from the ats_check.py in your LaTeX kit: an applicant-tracking system
// matches the ad's words against the document's words, so a must-have the CV
// never mentions at all is a silent filter. Warnings only, always — the document
// may answer a requirement in better words than the ad used, and a rule that
// cannot tell the difference has no business blocking anything.

/** Words worth matching on: not stopwords, at least three characters. */
function significantTerms(text) {
  const seen = new Set();
  for (const word of documentWords(text)) {
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/** Lowercase words, plural folded to singular so "evaluations" finds "evaluation". */
function documentWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean)
    .map(singular);
}

function checkKeywordCoverage({ renderedText, jobParsed, report }) {
  if (typeof renderedText !== 'string' || renderedText.trim() === '') return;
  const requirements = Array.isArray(jobParsed?.requirements) ? jobParsed.requirements : [];
  if (requirements.length === 0) return;

  const inDocument = new Set(documentWords(renderedText));

  requirements.forEach((requirement, index) => {
    const mustHave = requirement?.must_have ?? requirement?.mustHave ?? false;
    if (!mustHave) return;

    const text = typeof requirement === 'string' ? requirement : (requirement?.text ?? '');
    const terms = significantTerms(text);
    if (terms.length === 0) return; // nothing specific enough to look for
    if (terms.some((term) => inDocument.has(term))) return;

    report(
      'warning',
      'R9',
      `requirements[${index}]`,
      `the advertisement asks for "${text}" and the document never mentions it — none of ` +
        `${terms.map((t) => `"${t}"`).join(', ')} appears anywhere in the draft. If you can evidence it, ` +
        `say so in the document's own words; if you cannot, this is a gap worth knowing about before you apply.`,
      { requirement: text, terms },
    );
  });
}

// --- artifact shapes -------------------------------------------------------

function evidenceIdsOf(node) {
  const ids = node?.evidence_ids ?? node?.evidenceIds ?? [];
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id !== '') : [];
}

/** Flatten any artifact into the text units the rules run over. */
function textUnits(artifact, artifactKind) {
  const a = artifact ?? {};
  const units = [];
  const push = (ref, node, label, { allowUncited = false, context = '', text } = {}) => {
    const value = text ?? node?.text ?? '';
    if (typeof value !== 'string' || value.trim() === '') return;
    units.push({ ref, text: value, ids: evidenceIdsOf(node), label, allowUncited, context });
  };

  if (artifactKind === 'cover-letter') {
    (a.paragraphs ?? []).forEach((p, i) => {
      push(`cover-letter.paragraphs[${i}]`, p, 'paragraph', { allowUncited: true });
    });
    return units;
  }

  // A cold email is checked like a cover letter — framing sentences carry no
  // claim — with the subject line added, because "Cut evaluation time 40%" in a
  // subject is exactly the kind of figure that needs a record behind it.
  if (artifactKind === 'cold-email') {
    push('cold-email.subject', null, 'subject', { allowUncited: true, text: a.subject ?? '' });
    (a.paragraphs ?? []).forEach((p, i) => {
      push(`cold-email.paragraphs[${i}]`, p, 'paragraph', { allowUncited: true });
    });
    return units;
  }

  if (artifactKind === 'criteria') {
    const answers = a.answers ?? a.criteria ?? [];
    answers.forEach((answer, ai) => {
      const paragraphs = Array.isArray(answer?.paragraphs)
        ? answer.paragraphs
        : [answer].filter((x) => typeof x?.text === 'string');
      paragraphs.forEach((p, pi) => {
        push(`criteria.answers[${ai}].paragraphs[${pi}]`, p, 'paragraph', {
          context: answer?.criterion ?? '',
        });
      });
    });
    (a.paragraphs ?? []).forEach((p, i) => push(`criteria.paragraphs[${i}]`, p, 'paragraph'));
    return units;
  }

  push('cv.summary', a.summary, 'summary');
  (a.sections ?? []).forEach((section, si) => {
    (section?.entries ?? []).forEach((entry, ei) => {
      const base = `cv.sections[${si}].entries[${ei}]`;
      const context = [entry?.title, entry?.org].filter(Boolean).join(' ');
      push(`${base}.line`, entry, 'line', { context, text: entry?.line ?? '' });
      (entry?.bullets ?? []).forEach((b, bi) => {
        push(`${base}.bullets[${bi}]`, b, 'bullet', { context });
      });
    });
  });
  return units;
}

// --- helpers ---------------------------------------------------------------

function citedList(cited) {
  const ids = cited.map((r) => r.id);
  if (ids.length === 1) return `the cited record (${ids[0]})`;
  return `any cited record (${ids.join(', ')})`;
}

function describe(number) {
  return number.unit ? `"${number.raw}"` : String(number.value);
}
