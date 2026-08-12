// Why these tests exist: this feature hands the model a document you have already
// read and edited, and the ways it can go wrong are all destructive — returning
// a fragment that silently deletes the rest, claiming an edit it did not make,
// or forgetting the integrity rules because it is "only" a revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviseArtifact, normaliseRevision, REVISE_TASK, MAX_INSTRUCTION, MAX_QUOTE, DEFAULT_MODE } from './revise.js';

const DOC = ['# Rosa Kimani', '', 'Riverina · rosa.kimani@example.org', '', '## Summary', '', 'A researcher.'].join('\n');

/** Captures what was sent, and replies with whatever the test supplies. */
function fakeLlm(data, capture = {}) {
  return async (request) => {
    Object.assign(capture, request);
    return { data, usage: { inputTokens: 10, outputTokens: 20 }, costCents: 1, model: 'test-model' };
  };
}

// The integrity rules are built from profile-meta, so a revision that was not
// given one would be exempt from them — which is exactly what this file's
// headline test exists to catch.
const META = {
  name: 'Rosa Kimani',
  qualifications: {
    phd: { label: 'PhD', status: 'in_progress', expectedSubmission: '2027-03', submitted: false, awarded: false },
  },
};

const base = (over = {}) => ({
  instruction: 'make the summary less generic',
  markdown: DOC,
  artifactKind: 'cv',
  profile: 'industry',
  profileMeta: META,
  ...over,
});

test('an empty instruction is refused before any model is called', async () => {
  let called = false;
  const llm = async () => { called = true; };
  await assert.rejects(() => reviseArtifact(base({ instruction: '   ', llmComplete: llm })), /Nothing was asked/);
  assert.equal(called, false, 'no money is spent asking nothing');
});

test('revising a document that does not exist is refused', async () => {
  await assert.rejects(
    () => reviseArtifact(base({ markdown: '', llmComplete: fakeLlm({}) })),
    /no document to revise/,
  );
});

test('it uses the revise task, so the registry decides the model and ceiling', async () => {
  const sent = {};
  await reviseArtifact(base({ llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  assert.equal(sent.task, REVISE_TASK);
});

test('the system prompt still carries the integrity rules — a revision is not exempt', async () => {
  const sent = {};
  await reviseArtifact(base({ llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  assert.match(sent.system, /has NOT been awarded and has NOT been submitted/, 'the PhD rule must survive into a revision');
  assert.match(sent.system, /Never invent supervisors/);
});

test('the current document is sent, so your own edits are what get revised', async () => {
  const sent = {};
  const edited = DOC.replace('A researcher.', 'A researcher who edited this line by hand.');
  await reviseArtifact(base({ markdown: edited, llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  assert.match(sent.messages[0].content, /edited this line by hand/);
});

test('a runaway instruction is truncated rather than sent whole', async () => {
  const sent = {};
  const huge = 'Ω'.repeat(MAX_INSTRUCTION * 3);
  await reviseArtifact(base({ instruction: huge, llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  const longest = (sent.messages[0].content.match(/Ω+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  assert.equal(longest, MAX_INSTRUCTION);
});

// --- what comes back --------------------------------------------------------

test('a question returns an answer and changes nothing', () => {
  const out = normaliseRevision({ data: { reply: 'Because the ad asks for it first.', revised: false } }, DOC);
  assert.equal(out.revised, false);
  assert.equal(out.markdown, null);
  assert.match(out.reply, /Because the ad/);
});

test('a real rewrite comes back as a whole document', () => {
  const rewritten = DOC.replace('A researcher.', 'A computational neuroscientist moving into evaluation work.');
  const out = normaliseRevision({ data: { reply: 'Tightened it.', revised: true, markdown: rewritten, changes_made: ['summary rewritten'] } }, DOC);
  assert.equal(out.revised, true);
  assert.equal(out.markdown, rewritten);
  assert.deepEqual(out.changes_made, ['summary rewritten']);
});

test('a claimed rewrite that returns the document unchanged saves nothing, and says so', () => {
  const out = normaliseRevision({ data: { reply: 'Done!', revised: true, markdown: DOC } }, DOC);
  assert.equal(out.revised, false, 'no new version for an identical document');
  assert.equal(out.markdown, null);
  assert.match(out.note, /returned it unchanged/);
});

test('whitespace-only differences do not count as a revision', () => {
  const out = normaliseRevision({ data: { reply: 'Done!', revised: true, markdown: `\n\n${DOC}\n  ` } }, DOC);
  assert.equal(out.revised, false);
});

test('revised=true with no markdown at all is not a revision', () => {
  const out = normaliseRevision({ data: { reply: 'Sure', revised: true, markdown: null } }, DOC);
  assert.equal(out.revised, false);
  assert.equal(out.markdown, null);
});

test('markdown supplied without revised=true is ignored — consent is explicit', () => {
  const out = normaliseRevision({ data: { reply: 'Here is what it could look like', markdown: 'something else entirely' } }, DOC);
  assert.equal(out.revised, false);
  assert.equal(out.markdown, null);
});

test('a refusal is carried through rather than dropped', () => {
  const out = normaliseRevision(
    { data: { reply: 'That record has no figure in it.', revised: false, declined: ['add a metric to the analyst bullet'] } },
    DOC,
  );
  assert.deepEqual(out.declined, ['add a metric to the analyst bullet']);
  assert.equal(out.revised, false);
});

test('changes_made is dropped when nothing was actually changed', () => {
  const out = normaliseRevision({ data: { reply: 'x', revised: true, markdown: DOC, changes_made: ['did a thing'] } }, DOC);
  assert.deepEqual(out.changes_made, [], 'a changelog for an edit that did not happen is a lie');
});

test('cost and model are reported, so the ledger and the header stay honest', () => {
  const out = normaliseRevision(
    { data: { reply: 'x', revised: false }, costCents: 4, model: 'claude-opus-5', usage: { inputTokens: 1, outputTokens: 2 } },
    DOC,
  );
  assert.equal(out.costCents, 4);
  assert.equal(out.model, 'claude-opus-5');
  assert.deepEqual(out.usage, { inputTokens: 1, outputTokens: 2 });
});

test('a garbled response degrades to an empty answer rather than throwing', () => {
  assert.doesNotThrow(() => normaliseRevision(undefined, DOC));
  assert.doesNotThrow(() => normaliseRevision({ data: null }, DOC));
  assert.equal(normaliseRevision({}, DOC).reply, '');
});

// --- Ask or Edit --------------------------------------------------------------
//
// Why: asking "why does the summary lead with the PhD?" came back as a rewritten
// CV, because the model read the question as an instruction. That is not a
// prompting problem to be solved by asking more nicely — a model will misread
// this sometimes, and the cost of it misreading is an hour of somebody's edits.
// So Ask is enforced in code: there is no path from ask mode to new markdown.

const REWRITTEN = DOC.replace('A researcher.', 'A computational neuroscientist.');
const ANSWERED_WITH_A_REWRITE = { data: { reply: 'Here you go.', revised: true, markdown: REWRITTEN, changes_made: ['rewrote the summary'] } };

test('ask mode never returns markdown for the route to save', () => {
  const out = normaliseRevision(ANSWERED_WITH_A_REWRITE, DOC, { mode: 'ask' });
  assert.equal(out.revised, false);
  assert.equal(out.markdown, null);
  assert.deepEqual(out.changes_made, [], 'and no changelog for an edit that did not happen');
});

// Why a proposal rather than a bin: the model writes "I have updated the skills
// section to…" and means it. Drop the document and the reply left on screen
// describes a version of the CV that does not exist — you have paid for the call
// and been told about a phantom. Holding it makes that sentence true on a click.
test('the rewrite is held as a proposal, not thrown away', () => {
  const out = normaliseRevision(ANSWERED_WITH_A_REWRITE, DOC, { mode: 'ask' });
  assert.equal(out.proposal, REWRITTEN);
  assert.equal(out.ignoredRewrite, true);
  assert.deepEqual(out.proposed_changes, ['rewrote the summary']);
});

test('the note says the draft has not changed, not that the work was binned', () => {
  const out = normaliseRevision(ANSWERED_WITH_A_REWRITE, DOC, { mode: 'ask' });
  assert.match(out.note, /has not changed/);
});

test('the answer itself survives ask mode', () => {
  const out = normaliseRevision(ANSWERED_WITH_A_REWRITE, DOC, { mode: 'ask' });
  assert.equal(out.reply, 'Here you go.');
});

test('edit mode applies the rewrite and offers nothing', () => {
  const out = normaliseRevision(ANSWERED_WITH_A_REWRITE, DOC, { mode: 'edit' });
  assert.equal(out.revised, true);
  assert.equal(out.markdown, REWRITTEN);
  assert.equal(out.proposal, null, 'it is applied, so there is nothing to offer');
  assert.equal(out.ignoredRewrite, false);
  assert.equal(out.note, null);
});

test('an ask that really was only an answer carries no note and no proposal', () => {
  const out = normaliseRevision({ data: { reply: 'Because the ad asks for it.', revised: false } }, DOC, { mode: 'ask' });
  assert.equal(out.note, null);
  assert.equal(out.proposal, null);
  assert.equal(out.ignoredRewrite, false);
});

test('an ask that returns the document unchanged is not a proposal either', () => {
  const out = normaliseRevision({ data: { reply: 'Done!', revised: true, markdown: DOC } }, DOC, { mode: 'ask' });
  assert.equal(out.proposal, null, 'offering the document you already have is not an offer');
  assert.match(out.note, /returned it unchanged/);
});

test('the ask prompt forbids the past tense that caused this', async () => {
  const sent = {};
  await reviseArtifact(base({ mode: 'ask', llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  assert.match(sent.messages[0].content, /past tense/);
  assert.match(sent.messages[0].content, /I have updated/, 'by quoting the exact shape of the mistake');
});

test('the default mode is ask, so a caller that forgets cannot rewrite anything', async () => {
  assert.equal(DEFAULT_MODE, 'ask');
  const out = await reviseArtifact(base({ llmComplete: fakeLlm(ANSWERED_WITH_A_REWRITE.data) }));
  assert.equal(out.revised, false);
  assert.equal(out.markdown, null);
});

test('an unknown mode is treated as ask — a typo must not rewrite a document', async () => {
  const out = await reviseArtifact(base({ mode: 'Edit', llmComplete: fakeLlm(ANSWERED_WITH_A_REWRITE.data) }));
  assert.equal(out.revised, false);
});

test('the model is told which mode it is in', async () => {
  const asking = {};
  await reviseArtifact(base({ mode: 'ask', llmComplete: fakeLlm({ reply: 'ok', revised: false }, asking) }));
  assert.match(asking.messages[0].content, /## Mode: ASK/);
  assert.match(asking.messages[0].content, /`revised` must be false and `markdown` must be empty/);

  const editing = {};
  await reviseArtifact(base({ mode: 'edit', llmComplete: fakeLlm({ reply: 'ok', revised: false }, editing) }));
  assert.match(editing.messages[0].content, /## Mode: EDIT/);
  assert.match(editing.messages[0].content, /Change only\s+what was asked for/);
});

// --- quoting a passage --------------------------------------------------------

test('a quoted passage reaches the model as a quote, before the question', async () => {
  const sent = {};
  await reviseArtifact(base({
    instruction: 'what does this claim?',
    quote: 'Led the evaluation of a national programme.',
    llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent),
  }));
  const body = sent.messages[0].content;
  assert.match(body, /> Led the evaluation of a national programme\./);
  assert.ok(
    body.indexOf('they highlighted') < body.indexOf('what does this claim?'),
    'the passage is introduced before the question about it',
  );
});

test('a multi-line quote is quoted on every line, so the document below stays separate', async () => {
  const sent = {};
  await reviseArtifact(base({ quote: 'First line.\nSecond line.', llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  assert.match(sent.messages[0].content, /> First line\.\n> Second line\./);
});

test('no quote means no quote section — an empty heading is worse than none', async () => {
  const sent = {};
  await reviseArtifact(base({ llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  assert.doesNotMatch(sent.messages[0].content, /they highlighted/);
});

test('a quote the size of the whole document is truncated', async () => {
  const sent = {};
  await reviseArtifact(base({ quote: 'Ω'.repeat(MAX_QUOTE * 3), llmComplete: fakeLlm({ reply: 'ok', revised: false }, sent) }));
  const longest = (sent.messages[0].content.match(/Ω+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  assert.equal(longest, MAX_QUOTE);
});
