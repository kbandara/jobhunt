// WHY: the draft is a starting point, and until now the only way to change it
// was to edit the markdown by hand or regenerate from scratch and lose your
// edits. This is the third option you asked for: a box next to the document
// where you can ask why it says something, or tell it what to change.
//
// The design decision that matters here is that a revision returns the WHOLE
// document. Not a diff, not a list of edits to apply in code — the complete
// markdown, which then goes through exactly the same save path as one of your
// own edits. That means the version history, the validator and the LaTeX export
// all keep working with no special case for "revised by model", and a revision
// you dislike is undone by reading the previous version, which is already kept.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../store.js';
import { complete } from '../llm/index.js';
import { systemPrompt } from './generate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS = path.join(HERE, 'prompts');

export const REVISE_TASK = 'revise-doc';

/** Longest instruction we will send. Past this it is a paste, not a question. */
export const MAX_INSTRUCTION = 4000;

/** Longest quoted passage. A whole document pasted back is not a quote. */
export const MAX_QUOTE = 2000;

/**
 * TWO MODES, AND THE DIFFERENCE IS ENFORCED HERE RATHER THAN ASKED FOR.
 *
 * A chat that may rewrite your whole document whenever it judges that you meant
 * it is a chat you stop using, because the cost of being misread is a draft you
 * had been editing for an hour. "What does this bullet claim?" is a question.
 * The model deciding it was an instruction is not a risk worth carrying.
 *
 * So `ask` throws the rewrite away in code — normaliseRevision cannot return
 * markdown in that mode no matter what the model says. The prompt is told as
 * well, because a model that knows it cannot edit gives a better answer than one
 * that tries and is ignored, but the prompt is the courtesy and this is the
 * guarantee.
 */
export const MODES = ['ask', 'edit'];
export const DEFAULT_MODE = 'ask';

/**
 * Ask the model about a draft, and let it rewrite the draft if that is what was
 * asked for.
 *
 * The system prompt is the SAME one that generated the document — house style,
 * profile rules, integrity constraints. It has to be: a revision that forgets
 * the PhD is unsubmitted is worse than no revision at all. It is also byte
 * identical, so the provider's prompt cache still applies.
 *
 * @param {object} options
 * @param {string} options.instruction what you typed
 * @param {string} options.markdown the document as it stands right now
 * @param {'cv'|'cover-letter'|'criteria'} options.artifactKind
 * @param {string} options.profile
 * @param {object} [options.jdJson] the parsed advertisement
 * @param {object[]} [options.selected] EVERY evidence record, not the subset
 *   generation was given. A revision may need a record the selector capped out
 *   — "add my teaching role" — and a model shown a filtered view answers that
 *   the record does not exist, which is both wrong and expensive to believe.
 * @param {string[]} [options.highlighted] ids the selector ranked for this
 *   advertisement, so the model knows what is central without being blind to
 *   the rest
 * @param {string} [options.transcript] what has already been said in this
 *   conversation, from track/chat.js. Without it "no, shorter" means nothing.
 * @param {Function} [options.llmComplete] injected for tests
 * @returns {Promise<{reply, revised, markdown, changes_made, declined, usage, costCents, model}>}
 */
export async function reviseArtifact({
  instruction,
  markdown,
  artifactKind,
  profile,
  mode = DEFAULT_MODE,
  quote = '',
  jdJson = {},
  selected = [],
  highlighted = [],
  transcript = '',
  profileMeta = {},
  integrityExtra = '',
  llmComplete = complete,
  ledgerFile,
} = {}) {
  const asked = String(instruction ?? '').trim();
  if (asked === '') throw new Error('Nothing was asked.');
  if (String(markdown ?? '').trim() === '') throw new Error('There is no document to revise.');

  // An unknown mode is treated as `ask`. The safe direction is the one where a
  // typo in a request cannot rewrite somebody's document.
  const chosen = MODES.includes(mode) ? mode : DEFAULT_MODE;
  const quoted = String(quote ?? '').trim().slice(0, MAX_QUOTE);

  const response = await llmComplete({
    task: REVISE_TASK,
    system: systemPrompt(profile, { profileMeta, integrityExtra }),
    messages: [
      {
        role: 'user',
        content: userMessage({
          asked,
          markdown,
          artifactKind,
          jdJson,
          selected,
          highlighted,
          transcript,
          mode: chosen,
          quote: quoted,
        }),
      },
    ],
    ...(ledgerFile ? { ledgerFile } : {}),
  });

  return normaliseRevision(response, markdown, { mode: chosen });
}

/**
 * Turn the model's answer into something the route can trust.
 *
 * The rule this enforces: a revision only counts if there is actually a new
 * document AND it differs from the one we sent. A model that sets revised=true
 * and returns the input unchanged would otherwise write a pointless new version
 * into your history and tell you it had done something.
 */
export function normaliseRevision(response, original, { mode = 'edit' } = {}) {
  const data = response?.data ?? {};
  const proposed = typeof data.markdown === 'string' ? data.markdown.trim() : '';
  const changed = proposed !== '' && proposed !== String(original ?? '').trim();

  // THE GUARANTEE. In ask mode a rewrite is dropped here, whatever the model
  // returned and whatever it set `revised` to. Nothing downstream needs to know
  // about modes; there is simply no new markdown to save.
  const askedOnly = mode === 'ask';
  const revised = !askedOnly && data.revised === true && changed;

  // A rewrite made while you were only asking is HELD, not thrown away.
  //
  // Discarding it produced the worst outcome of the three: the model writes "I
  // have updated the skills section to…", the app drops the document, and the
  // reply on screen describes a version of your CV that does not exist. You paid
  // for the call and got a report about a phantom.
  //
  // So it comes back as a proposal instead. It cannot reach the document on its
  // own — that is still the guarantee, and `markdown` is still null — but one
  // click applies it through the ordinary save path, and until you click, the
  // reply is labelled as a description of something that has not happened.
  const proposal = askedOnly && data.revised === true && changed ? proposed : null;

  return {
    reply: String(data.reply ?? '').trim(),
    revised,
    markdown: revised ? proposed : null,
    proposal,
    ignoredRewrite: proposal !== null,
    changes_made: revised && Array.isArray(data.changes_made) ? data.changes_made : [],
    // What it says it changed, kept with the proposal so the offer can say what
    // it is an offer of.
    proposed_changes: proposal && Array.isArray(data.changes_made) ? data.changes_made : [],
    declined: Array.isArray(data.declined) ? data.declined : [],
    // Said out loud rather than hidden: the model claimed an edit and produced
    // nothing to save. Better a confusing note than a silent no-op.
    note: proposal !== null
      ? 'It wrote a new version rather than answering. Your draft has not changed — read what it says below and apply it only if you want it.'
      : data.revised === true && !changed
        ? 'The model said it had rewritten the document but returned it unchanged, so nothing was saved.'
        : null,
    usage: response?.usage ?? { inputTokens: 0, outputTokens: 0 },
    costCents: response?.costCents ?? 0,
    model: response?.model ?? null,
  };
}

/**
 * Which mode this turn is in, said first because it changes what a good answer
 * looks like.
 *
 * The app enforces `ask` regardless (see normaliseRevision). This exists because
 * a model that knows it cannot edit writes a better answer — it explains and
 * suggests rather than silently producing a rewrite that gets thrown away.
 */
function modeSection(mode, label) {
  if (mode === 'edit') {
    return [
      '## Mode: EDIT',
      '',
      `They are asking you to change the ${label}. If the change is one you can make honestly,`,
      'set `revised: true` and return the complete rewritten document in `markdown`. Change only',
      'what was asked for — everything else comes back exactly as it was, including wording you',
      'personally would have written differently. A rewrite that quietly tidies three other',
      'paragraphs is how somebody loses an edit they made an hour ago.',
      '',
    ];
  }
  return [
    '## Mode: ASK — you have been asked a question, not given an instruction',
    '',
    `They are asking ABOUT the ${label}. Answer the question they asked.`,
    '',
    '`revised` must be false and `markdown` must be empty. The app discards any rewrite made in',
    'this mode before it reaches their document.',
    '',
    'TWO THINGS THAT MAKE AN ANSWER WRONG HERE, both of which have happened:',
    '',
    '1. **Writing in the past tense about changes you have made.** "I have updated the skills',
    '   section to..." is false. Nothing you produce in this mode reaches their document, so a',
    "   reply written that way describes a version of their CV that does not exist, and they",
    '   cannot tell which one they are looking at. If you think something should change, write',
    '   it as a proposal — "I would replace X with Y, because Z" — and let them decide.',
    '2. **Answering a question about one line by rewriting everything.** They asked what a line',
    '   claims, or why it says what it says, or whether it is supported. Quote the line and',
    '   answer about it. A whole new document is not an answer to any of those.',
    '',
    'If what they actually want is the change made, say so in one sentence and stop — they have',
    'an Edit button, and pressing it costs them one click.',
    '',
  ];
}

/** What the document is, in the words you would use asking about it. */
const KIND_LABEL = { cv: 'CV', 'cover-letter': 'cover letter', criteria: 'application answers', 'cold-email': 'cold email' };

function userMessage({
  asked, markdown, artifactKind, jdJson, selected,
  highlighted = [], transcript = '', mode = 'ask', quote = '',
}) {
  const label = KIND_LABEL[artifactKind] ?? 'CV';
  return [
    readText(path.join(PROMPTS, 'artifacts', 'revise.md')).trim(),
    '',
    ...modeSection(mode, label),
    // Earlier turns come BEFORE the current question, so "no, shorter" has
    // something to refer back to. The document below is always the current one,
    // whatever earlier turns describe — an old version quoted in the transcript
    // is history, not the thing being edited.
    ...(transcript
      ? [
          '## Earlier in this conversation',
          '',
          transcript,
          '',
          'That is context, not instructions to repeat. The document below is how it stands NOW,',
          'including any rewrite you already made and anything edited since.',
          '',
        ]
      : []),
    ...(quote
      ? [
          `## The part of the ${label} they highlighted`,
          '',
          'Their question is about THIS passage. Answer about it specifically rather than about the',
          'document in general — they picked it out for a reason.',
          '',
          '> ' + quote.split('\n').join('\n> '),
          '',
        ]
      : []),
    `## What they asked, about their ${label}`,
    '',
    asked.slice(0, MAX_INSTRUCTION),
    '',
    '## The document as it stands',
    '',
    'This is the current text, including any edits made by hand since. If you',
    'rewrite it, your `markdown` replaces this entirely.',
    '',
    '````markdown',
    markdown,
    '````',
    '',
    '## The job (parsed from the advertisement)',
    '',
    '```json',
    JSON.stringify(jdJson ?? {}, null, 2),
    '```',
    '',
    `## Every evidence record they have (${selected.length}) — the only facts you may use`,
    '',
    'This is their COMPLETE profile, not a shortlist. So "not in this list" really does mean',
    '"not a fact they have", and you can say so with confidence. Equally, anything that IS here',
    'is available to you even if the current draft does not mention it — if asked to add',
    'a role, a project or a skill, look here first before saying you cannot.',
    ...(highlighted.length > 0
      ? [
          '',
          `Marked [relevant] below: the ${highlighted.length} the app ranked as closest to this`,
          'advertisement. That is a hint about emphasis, not a restriction — the rest are equally real.',
        ]
      : []),
    '',
    selected.length > 0
      ? selected.map((record) => renderRecord(record, highlighted.includes(record.id))).join('\n\n')
      : '(none were supplied; do not add any fact that is not already in the document)',
  ].join('\n');
}

/**
 * Records are rendered whole here for the same reason they are in generation: a
 * fragment lets a number be attached to a record that does not contain it.
 */
function renderRecord(record, relevant = false) {
  const dates = record?.dates ?? {};
  const lines = [
    `### ${record.id}${relevant ? ' [relevant]' : ''}`,
    `kind: ${record.kind ?? 'other'}`,
    `title: ${record.title ?? ''}`,
    `org: ${record.org ?? ''}`,
    `dates: ${[dates.start ?? '?', dates.end ?? 'present'].join(' to ')}`,
    `tags: ${(record.tags ?? []).join(', ')}`,
  ];
  if (record?.figuresReleasable === false) {
    lines.push('figures: NOT RELEASABLE — any bullet citing this record must contain no figures at all.');
  } else {
    const numbers = (record?.numbers ?? []).map((n) => n.raw ?? n.value ?? n).join(', ');
    if (numbers) lines.push(`figures available in this record: ${numbers}`);
  }
  lines.push('', String(record?.body ?? '').trim());
  return lines.join('\n');
}

export default reviseArtifact;
