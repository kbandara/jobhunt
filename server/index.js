// WHY: the whole app is one local Express process — static client plus a JSON API
// bound to 127.0.0.1 only (PLAN Appendix B), because the machine running it holds
// a phone number, citizenship and a full employment record and none of it should
// be reachable from the network. Every route is thin: the thinking lives in the
// modules it calls, and every mutation logs an event (D009) before it answers.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { marked } from 'marked';

import { readJson, writeJson } from './store.js';
import { log, logError } from './log.js';
import { parseCitation, apa } from './profile/citation.js';
import { nameParts, describePerson, qualificationNote } from './profile/identity.js';
import { saveEnvValues } from './env-file.js';
import { integrityRules } from './generate/integrity.js';
import { extractPdfText } from './import/pdf-text.js';
import { importSystemPrompt, importUserMessage, normaliseImport } from './import/from-cv.js';
import { polishSystemPrompt, polishUserMessage, checkPolish } from './import/polish.js';
import { CHECKS } from './doctor.js';
import {
  userPaths,
  ensureUserData,
  setupState,
  blankProfileMeta,
  DEFAULT_EVIDENCE_TAGS,
} from './user-data.js';
import { complete } from './llm/index.js';
import { LlmError } from './llm/errors.js';
import { totals } from './llm/ledger.js';
import { resolveProvider, PROVIDERS, configFor } from './llm/registry.js';
import { loadEvidence, parseProfile, tagsInUse } from './profile/parse.js';
import {
  readProfileText,
  writeProfileText,
  upsertRecord,
  removeRecord,
  hasRecord,
  RECORD_KINDS,
} from './profile/edit.js';
import { watchFile } from './profile/live.js';
import {
  getProfile,
  profileIds,
  profileSummaries,
  PROFILE_DIR,
  REGISTERS,
} from './generate/profiles/index.js';
import {
  checkProfile,
  profileExists,
  saveProfile,
  splitDraft,
  deleteProfile,
  readProfilePrompt,
  PROFILE_PROMPT_DIR,
} from './generate/profiles/draft.js';
import { SECTION_CATALOGUE, LEGACY_SECTIONS } from './generate/sections.js';
import { selectEvidence } from './generate/select-evidence.js';
import { contactBlock } from './generate/workrights.js';
import { generateArtifact, jobFacts, ARTIFACT_KINDS } from './generate/generate.js';
import { reviseArtifact } from './generate/revise.js';
import { publicationList, proposeFrom, unknownIds, renderSelected } from './generate/publications.js';
import { parseQuestions, questionsFor, answerCounts } from './generate/questions.js';
import { extractKeywords, coverage } from './generate/keywords.js';
import { reviewSystemPrompt, reviewUserMessage, checkReview, recordsUsedIn } from './generate/recruiter.js';
import { stripEvidenceIds, replacePublications } from './generate/document-edits.js';
import { runKey, createRuns } from './generate/progress.js';
import { compilePdf, findEngine, installHint } from './generate/pdf.js';
import { artifactFromMarkdown, documentFromMarkdown } from './generate/from-markdown.js';
import { renderLatex } from './generate/latex.js';
import { validate } from './validate/validator.js';
import { applyCap } from './score/cap.js';
import * as jobsStore from './track/jobs.js';
import * as docsStore from './track/docs.js';
import * as chatStore from './track/chat.js';
import { logEvent } from './track/events.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..');
const CLIENT_DIR = path.join(REPO_ROOT, 'client');
const EXAMPLE_DIR = path.join(REPO_ROOT, 'examples');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'data');
const ENV_FILE = path.join(REPO_ROOT, '.env');

/** The CV class, vendored. Copied beside every exported .tex so it compiles. */
const ATSCV_STY = path.join(HERE, 'generate', 'latex', 'atscv.sty');

/**
 * Longest per-job note kept. Past this it is not a note, it is a document — and
 * a note that long stops being read by the model as an instruction and starts
 * competing with the evidence records for attention.
 */
export const MAX_NOTES = 4000;

/**
 * One evidence record as markdown you can paste straight into a draft.
 *
 * Deliberately the record's own words, not a summary of them: the point of this
 * is that the selector or the model got it wrong, so anything the app rewrote on
 * the way through would be the same judgement making the same mistake again.
 */
export function recordMarkdown(record = {}) {
  const dates = record?.dates ?? {};
  const period = [dates.start, dates.end ?? 'present'].filter(Boolean).join(' – ');
  const heading = [record.title, record.org].filter(Boolean).join(' — ');
  const body = String(record.body ?? '').trim();

  return [
    heading ? `### ${heading}` : null,
    period || null,
    '',
    body,
  ].filter((line) => line !== null).join('\n').trim();
}

/** Where an unrecognised profile guess lands. Must exist as a profile file. */
const FALLBACK_PROFILE = 'general';

/** Identifies this process. See the `startedAt` field on /api/meta. */
const STARTED_AT = new Date().toISOString();

// --- system prompts owned by the routes -------------------------------------

/**
 * Built from the CV profile registry rather than hard-coded, so a model choosing
 * a profile is choosing from the profiles that actually exist on disk today.
 */
export function parseSystemPrompt() {
  return [
    'You extract structured facts from a job advertisement. Be literal: record what the',
    'advertisement actually says, in its own words, and do not infer, soften or embellish.',
    'A requirement is must-have only when the ad marks it as essential, required or mandatory.',
    'If a field is not stated, use the schema\'s empty value (null, "XX", or an empty array)',
    'rather than a guess — a guessed closing date or citizenship rule is worse than none.',
    '',
    'Two of the fields are judgements about the writing rather than facts in it:',
    '',
    '- technical_register: how expert the person reading the application will be. Use',
    '  "specialist" when the ad is written by and for people in a technical field and uses',
    '  its vocabulary without explaining it; "general" when it is written for a lay reader',
    '  or an HR audience and explains or avoids technical words; "mixed" when it does some',
    '  of both. Judge the advertisement in front of you, not the industry it comes from.',
    '- domain_vocabulary: the technical terms the advertisement itself uses — for example',
    '  "EEG", "Bayesian inference", "PyTorch", "signal detection theory". Copy them as the',
    '  ad writes them. Include only terms actually present in the text; use an empty array',
    '  when there are none. This list decides which specialist words the application is',
    '  allowed to keep, so adding a term the ad never used is an error, not a helpful guess.',
    '',
    'profile_guess must be exactly one of these ids:',
    '',
    ...profileSummaries().map((profile) => `- ${profile.id}: ${profile.description}`),
    '',
    `If none of them fits, answer "${FALLBACK_PROFILE}". Give your reason in profile_guess_reason.`,
    'Your guess is used straight away rather than waiting for a click, and it can be changed',
    'afterwards — so a plain, honest guess is worth more than a confident wrong one.',
  ].join('\n');
}

/**
 * The same extraction, for a company that is not advertising anything.
 *
 * The input is notes you typed about a startup, so there are no requirements to
 * be literal about — the model is asked to infer what the work there would need,
 * and every downstream step reads the same shape as a parsed advertisement so
 * nothing else has to know the difference.
 *
 * What DOES have to know the difference is the screen and the scorer. The job
 * carries `source: 'cold'`, the requirements are shown as inferred, and scoring
 * is refused outright: a fit score computed against requirements the app made up
 * would be fiction with a number on it, which is worse than no number.
 */
export function coldParseSystemPrompt() {
  return [
    'These are notes somebody typed about a company they want to approach. There is no job',
    'advertisement and no open role. Read the notes and describe the work this company would',
    'need done, in the same structured shape as a job advertisement.',
    '',
    'Everything you record must come from the notes. If the notes do not say where the company',
    'is, leave the location empty rather than guessing from the name; if they do not describe a',
    'product, do not invent one. Thin notes should produce a thin record — that is the honest',
    'result, and the app shows what was inferred so more notes can be added.',
    '',
    'requirements: what someone doing this work would plausibly need, drawn from what the notes',
    'say the company does. Mark every one of them must_have: false. Nothing here is a stated',
    'requirement — there is no advertisement to state it — and a fabricated hard filter would be',
    'treated as one by the rest of the app.',
    '',
    'role_title: the role that would plausibly exist for this work, e.g. "Research Engineer".',
    'Not a title the notes claim to have seen advertised.',
    '',
    'responsibilities: what the work would involve. skills: the technical skills it would call for.',
    'selection_criteria: always an empty array — nobody is asking any questions yet.',
    'closing_date: always null. There is no deadline on an email nobody asked for.',
    '',
    'technical_register and domain_vocabulary: judge them from how the NOTES are written and',
    'what they say about the company. A startup described in engineering terms reads specialist;',
    'one described by what it sells reads general.',
    '',
    'profile_guess must be exactly one of these ids:',
    '',
    ...profileSummaries().map((profile) => `- ${profile.id}: ${profile.description}`),
    '',
    `If none of them fits, answer "${FALLBACK_PROFILE}". Give your reason in profile_guess_reason.`,
  ].join('\n');
}

/**
 * How the person using the app is described to a model that has never seen their
 * records. Assembled from profile-meta.json by profile/identity.js, because the
 * alternative — a paragraph about one person committed to the repository — is
 * what made this app unusable by anybody else.
 *
 * Every part is optional and the result degrades to "The applicant", which is
 * correct rather than merely safe: a model told nothing about who it is writing
 * for will read the evidence instead of a summary of it.
 */
export function applicantBrief(profileMeta = {}) {
  const described = describePerson(profileMeta);
  const name = nameParts(profileMeta).full;
  const qualifications = qualificationNote(profileMeta);
  return {
    name: name || 'The applicant',
    subject: name || 'The applicant',
    line: [described, qualifications].filter(Boolean).join('. '),
  };
}

/**
 * The prompt behind "New profile…". It is deliberately not shown in the UI: you
 * describe the kind of role you want a profile for in your own words, and this
 * is what turns that into the two files. It never sees your evidence records —
 * a profile is a SHAPE, and it must be written without reference to any
 * particular advertisement or record, or the shape starts encoding content.
 *
 * Built from the registry and the section catalogue on every call, so the ids it
 * offers are the ids that exist right now.
 *
 * @param {object} [options]
 * @param {string} [options.dir] which profiles directory to describe — a test seam
 * @param {object} [options.profileMeta]
 * @param {string[]} [options.evidenceTags] the tags this person's records carry
 */
export function draftProfileSystemPrompt({ dir = PROFILE_DIR, profileMeta = {}, evidenceTags = [] } = {}) {
  const sections = [...SECTION_CATALOGUE, ...LEGACY_SECTIONS];
  const who = applicantBrief(profileMeta);
  const tags = evidenceTags.length > 0 ? evidenceTags : DEFAULT_EVIDENCE_TAGS;
  return [
    `You design CV profiles for one person: ${who.line}.`,
    '',
    'A PROFILE FIXES THE SHAPE OF A CV, NOT ITS CONTENT.',
    '',
    'It decides the section order, roughly how long the document runs, what leads the page, how',
    'publications are treated, and what the technical section is called. It never decides what',
    'the CV says: the words come from their evidence records and from the advertisement being',
    'answered, every time the document is generated. So do not write a profile around one job,',
    'one employer, or one achievement. Write the shape that a whole class of roles wants.',
    '',
    'They will describe the kind of role they have in mind. Return one profile for it.',
    '',
    '## The section ids you may use',
    '',
    'These are the only sections that exist. Naming anything else is rejected by the server, so',
    'do not invent one, and do not rename one — use the id, and set "heading" if the wording on',
    'the page should differ.',
    '',
    ...sections.map((section) => `- ${section.id} (renders as "${section.heading}")`),
    '',
    'Order them the way the CV should read. "summary" belongs first in nearly every profile.',
    '',
    '## The evidence tags you may use',
    '',
    'evidenceProfiles decides which of their records this profile can draw on at all. These are',
    'the tags their records actually carry:',
    '',
    ...tags.map((tag) => `- ${tag}`),
    '',
    'Use ["*"] — every record, whatever it is tagged with — unless the person has asked for a',
    'profile that deliberately excludes part of their record. Too narrow a list produces a thin',
    'CV built from almost no evidence, which is hard to diagnose from the page.',
    '',
    '## Profiles that already exist',
    '',
    'Do not duplicate one of these, and do not reuse an id:',
    '',
    ...profileSummaries({ dir }).map((profile) => `- ${profile.id}: ${profile.description}`),
    '',
    '## The two things you are writing',
    '',
    '- The configuration: id, description, register, evidence tags, sections in order, page',
    '  budget, publication policy, clearance rule, technical section name and kindPriority.',
    `  register is one of ${REGISTERS.join(', ')} and says how expert the reader is assumed to be.`,
    '  The description is one sentence, and it does double duty: it is what they read in the',
    '  picker, and it is what a later model reads when guessing which profile a new',
    '  advertisement belongs to. Make it say what kind of role this is for.',
    '- prompt_markdown: the profile\'s own prompt file, which is given to the model that writes',
    '  the CV. Match the voice of the existing ones: a "# Profile: ..." heading, then the',
    '  section order in prose, what leads and why, how publications are handled, and what the',
    '  technical section is called. Write in plain declarative sentences addressed to the',
    '  writer. Do not include example bullets, do not invent achievements, and do not name a',
    '  company they might apply to.',
  ].join('\n');
}

// The previous version of this prompt told the model to "look for reasons not to
// apply before you look for reasons to", and it did exactly that: everything
// came back negative. That instruction is gone. The job here is to be the
// recruiter — to predict what actually happens to this application when a real
// screener reads it — not to be the friend who talks you out of things.
//
// TWO SEPARATE FIXES FOR THE SAME DOWNWARD DRIFT, and both are needed.
//
// The scale: the model is asked for a number out of TWENTY, not a hundred. Out
// of 100 there are a hundred choices, most of which mean nothing to it, and the
// answer slides toward the low forties. Out of 20 there are twenty-one, each of
// which has to be argued for. server/score/cap.js multiplies by five, so
// everything downstream still works in 0-100.
//
// The anchors: even on a good scale, a model with no reference points marks
// against an imagined perfect candidate, and nobody wins that comparison. So
// each band says what it means in terms of what a screener would DO.
export function scoreSystemPrompt(profileMeta = {}) {
  const who = applicantBrief(profileMeta);
  const level = String(profileMeta?.careerLevel ?? '').trim().toLowerCase();
  const transitioning = profileMeta?.careerTransition === true;

  return [
    `You are the recruiter screening applications for this role. ${who.subject} has applied.`,
    'Predict what actually happens to this application: does it reach an interview, or is it',
    'passed over, and why? You are not advising them and not encouraging them — you are saying',
    'what you would do with their application, which is more useful than either.',
    '',
    '## Scoring',
    '',
    'Score OUT OF 20. Not out of 100 — twenty, as a whole number from 0 to 20. The score is the',
    'strength of THIS application against THIS advertisement, in a normal field of applicants.',
    '',
    'What each band means, in terms of what you would actually do. These four are the app\'s own',
    'verdicts, so a number here becomes exactly the verdict its band describes:',
    '',
    '  15-20   One of the strongest applications you would see. Meets the essentials and brings',
    '          something the ad asks for that most applicants will not have. Interviewed.',
    '  10-14   Competitive. Meets the essentials; some desirables missing. Interviewed in a',
    '          normal field.',
    '   6-9    Real but uphill. Something they asked for is missing and the letter has to do',
    '          work. Interviewed if the field is thin, or if the missing piece is teachable.',
    '   0-5    Not this role. Several essentials unmet; you would need a reason to keep reading.',
    '',
    'Two calibration rules, because both failures are common:',
    '',
    ...(transitioning
      ? [
          '- This applicant is changing field. An advertisement is written describing someone',
          '  already doing the job, so they will always look imperfect against it. Do not charge',
          '  them for that twice — score the application in front of you, not its distance from an',
          '  imaginary ideal.',
        ]
      : [
          '- Score the application in front of you, not its distance from an imagined perfect',
          '  candidate who has done this exact job before. That candidate rarely applies.',
        ]),
    '  If almost everything you score lands below 10, you are grading against an ideal and are wrong.',
    '- Equally, do not round up out of kindness. A 14 that should be a 9 costs them a day of work',
    '  and a rejection. Both directions cost something real.',
    '',
    '## Unmet requirements',
    '',
    'Mark an unmet requirement "blocking" ONLY when it is a hard filter that no application can',
    'get past: a required degree they do not hold, citizenship or residency they do not have, a',
    'clearance they cannot obtain, a stated minimum years-of-experience floor they are under, or',
    'a licence they lack. The app caps the score when anything is blocking, so this severity is',
    'expensive — do not reach for it because a gap is large. "significant" is a real gap they',
    'could argue around; "minor" is a nice-to-have.',
    '',
    '## Overqualification',
    '',
    'Say whether they are too senior for this role, because that is a real way to be screened out',
    'and nobody tells you it happened. A recruiter passes over an obviously overqualified',
    'applicant for reasons that have nothing to do with ability: the salary will not match, they',
    'expect them to leave inside a year, or the work will bore them. Judge it as a recruiter',
    'would: "clearly" when you would genuinely hesitate to progress them for those reasons,',
    '"somewhat" when it is worth addressing in the letter, "none" otherwise. Holding a higher',
    'qualification than the ad asks for is not by itself overqualification — the question is the',
    'level of the WORK, not the height of the credential.',
    ...(level ? ['', `For reference, they describe themselves as ${level}.`] : []),
    '',
    'Reflect it in the score to the extent it changes what you would do with the application, and',
    'say so in the summary. It is reported separately as well, so they can see it and decide.',
    '',
    '## The summary',
    '',
    'Two or three plain sentences: what is strong, what is weak, and what you would actually do.',
    'Name the strengths as readily as the gaps — a summary that only lists problems is not an',
    'honest reading of an application you would have interviewed.',
    '',
    'You may only use the evidence records provided. If something is not in them, they cannot',
    'claim it — treat it as unmet, not as unknown.',
  ].join('\n');
}

// --- app --------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Express 4 does not catch rejected promises; this is that missing wrapper. */
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/**
 * @param {object} [options]
 * @param {Function} [options.llmComplete] injected in tests; defaults to the real LLM layer
 * @param {string} [options.dataDir] defaults to <repo>/data
 * @param {object[]} [options.evidence] a fixed set of records. Omit it and
 *   data/profile/master-profile.md is watched and re-read when it changes; pass one
 *   and it is used unchanged, which is what every test wants.
 * @param {object} [options.profileMeta] a fixed set of contact details, for tests;
 *   omit it and data/profile/profile-meta.json is read and written
 * @param {string} [options.profilesDir] CV profile configs; a test seam, so a test that
 *   creates a profile writes into a temp folder instead of the repo
 * @param {string} [options.profilePromptsDir] CV profile prompt files — the same seam
 */
export function createApp({
  llmComplete = complete,
  dataDir = DEFAULT_DATA_DIR,
  evidence: fixedEvidence = null,
  profileMeta: fixedProfileMeta = null,
  profilesDir = PROFILE_DIR,
  profilePromptsDir = PROFILE_PROMPT_DIR,
} = {}) {
  const app = express();
  const ledgerFile = path.join(dataDir, 'usage', 'ledger.jsonl');
  // Idempotent, and done here rather than only in main() so that every way of
  // starting this app — including a test — sees the same files in the same
  // places. A route that edits the profile has to have a profile to edit.
  const { paths } = ensureUserData({ dataDir });
  // This app's in-flight generations. Owned here rather than module-wide, so
  // two apps in one process cannot see each other's work.
  const runs = createRuns();

  // Contact details are re-read on write rather than held from startup: they are
  // editable in the app now, and a settings screen whose changes only take effect
  // after a restart is a settings screen nobody trusts.
  let profileMeta = fixedProfileMeta ?? readJson(paths.profileMeta, blankProfileMeta());
  const saveMeta = (next) => {
    profileMeta = next;
    if (!fixedProfileMeta) writeJson(paths.profileMeta, next);
    return profileMeta;
  };

  // Anything not derivable from profile-meta that must still constrain every
  // generation — "this project has no customers", "never name that collaborator".
  const integrityFile = path.join(paths.profileDir, 'integrity.md');
  const integrityExtra = () => {
    try {
      return fs.readFileSync(integrityFile, 'utf8');
    } catch {
      return '';
    }
  };

  // master-profile.md is edited while the app is running — that is the main loop,
  // not an edge case, whether the edit came from this app's own profile editor or
  // from a text editor beside it. The flags panel asks for a number, you add it,
  // press Generate, and used to get the same draft back because the records were
  // parsed once at startup. So the file is watched: a change is picked up on the
  // next request, and a save that does not parse never replaces the copy that
  // did. See server/profile/live.js.
  const loadRecords = (file) => loadEvidence(file, { allowedTags: profileMeta?.evidenceTags ?? null });
  const watcher = fixedEvidence ? null : watchFile({ file: paths.masterProfile, load: loadRecords });
  let evidence = fixedEvidence ?? watcher.read().value;
  let evidenceIds = evidence.map((record) => record.id).filter(Boolean);
  let profileError = null;

  const rereadProfile = () => {
    if (!watcher) return;
    const state = watcher.read({ force: true });
    evidence = state.value;
    evidenceIds = evidence.map((record) => record.id).filter(Boolean);
    profileError = state.error;
  };

  app.use((req, res, next) => {
    if (watcher) {
      const state = watcher.read();
      if (state.value !== evidence) {
        evidence = state.value;
        evidenceIds = evidence.map((record) => record.id).filter(Boolean);
        log(`  master-profile.md changed — ${evidence.length} records reloaded.`);
      }
      profileError = state.error;
    }
    next();
  });

  /** The evidence vocabulary: what you declared, plus anything your records use. */
  const evidenceTags = () => {
    const declared = Array.isArray(profileMeta?.evidenceTags) ? profileMeta.evidenceTags : [];
    return [...new Set([...declared, ...tagsInUse(evidence)])];
  };

  const knownProfiles = () => profileIds({ dir: profilesDir });
  const profileConfig = (profile) => {
    const config = getProfile(profile, { dir: profilesDir });
    if (!config) {
      throw new HttpError(400, `Unknown profile "${profile}". Known profiles: ${knownProfiles().join(', ')}`);
    }
    return config;
  };

  app.use(express.json({ limit: '16mb' })); // pasted ads are long; an uploaded CV is bigger
  app.use(express.static(CLIENT_DIR));

  // Every model call is announced in the terminal with how long it took. A
  // generation can legitimately run for a minute, and without this the only
  // signal is a spinner in the browser — which looks identical to a hang.
  const callModel = async (options) => {
    const startedAt = Date.now();
    const say = (outcome) =>
      // eslint-disable-next-line no-console
      log(
        `  [${options.task}] ${outcome} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );
    // eslint-disable-next-line no-console
    log(`  [${options.task}] asking the model…`);
    try {
      const result = await llmComplete({ ...options, ledgerFile });
      say(`done (${result.model}, ${result.usage?.outputTokens ?? '?'} tokens out)`);
      return result;
    } catch (err) {
      // `err.message` on something that is not an Error prints "undefined",
      // which is the least useful line a terminal can carry — it says a failure
      // happened and refuses to say what.
      const described = err instanceof Error ? err.message : JSON.stringify(err) ?? String(err);
      say(`FAILED — ${err?.type ?? 'error'}: ${described}`);
      throw err;
    }
  };

  const mustFindJob = (id) => {
    const job = jobsStore.readJob(dataDir, id);
    if (!job) throw new HttpError(404, `No job with id "${id}".`);
    return job;
  };

  /**
   * The profile to work in. Parsing now accepts its own guess (`confirmedBy: 'auto'`)
   * so nothing waits on a click you were always going to make — but the guess is
   * still a profile, so this falls back to it if a job predates that change. What is
   * NOT waived is parsing: without a parsed advertisement there is nothing to
   * generate or score against, and that stays a 409.
   */
  const mustHaveProfile = (job) => {
    if (!job.parsed) {
      throw new HttpError(409, 'This job has not been parsed yet. Run Parse first.', { needs: 'parse' });
    }
    const profile = job.profile?.confirmed || job.profile?.guess;
    if (!profile) {
      throw new HttpError(
        409,
        'This job has no profile at all, not even a guess. Parse it again.',
        { needs: 'profile' },
      );
    }
    return profile;
  };

  // --- jobs -----------------------------------------------------------------

  app.post(
    '/api/jobs',
    wrap((req, res) => {
      // Two things can be pasted here: an advertisement, or notes about a company
      // that is not advertising. They travel down the same pipeline — the notes
      // are parsed into the same shape — but the app must never lose track of
      // which it has, because one carries stated requirements and the other
      // carries requirements it made up itself.
      const cold = req.body?.source === 'cold';
      const rawText = String(req.body?.rawText ?? '').trim();
      if (rawText === '') {
        throw new HttpError(
          400,
          cold
            ? 'Write down what you know about the company first — what they do, who they are, why you want to talk to them.'
            : 'Paste the job advertisement text first.',
        );
      }

      const job = jobsStore.createJob(dataDir, {
        rawText,
        url: req.body?.url ?? null,
        ...(cold ? { source: 'cold' } : {}),
      });
      logEvent(dataDir, { jobId: job.id, type: 'created', source: job.source });
      res.status(201).json({ job });
    }),
  );

  app.post(
    '/api/jobs/:id/parse',
    wrap(async (req, res) => {
      const job = mustFindJob(req.params.id);
      const cold = job.source === 'cold';
      const reply = await callModel({
        task: 'parse-jd',
        system: cold ? coldParseSystemPrompt() : parseSystemPrompt(),
        messages: [{
          role: 'user',
          content: cold
            ? `Notes about a company they want to approach:\n\n${job.rawAd}`
            : `Job advertisement:\n\n${job.rawAd}`,
        }],
      });

      const parsed = reply.data;
      // `profile_guess` is a free string in the schema, because an enum cannot know
      // about a profile added next week. So the server checks it here: an id that is
      // not a profile on disk becomes the catch-all, and the substitution is recorded
      // rather than hidden — an invented profile id is worth seeing.
      const said = parsed?.profile_guess ?? null;
      const known = typeof said === 'string' && knownProfiles().includes(said);
      const guess = known ? said : FALLBACK_PROFILE;

      // The app accepts its own guess so the next step is not blocked on a click —
      // but it says so rather than pretending you chose it. `confirmedBy` is the
      // whole audit trail: 'auto' is the app's judgement, 'human' is your. D008's
      // rule is that the app never quietly substitutes its own, and it does not.
      // A profile you have already chosen by hand is never overwritten by a re-parse.
      const chosen = job.profile?.confirmedBy === 'human' && job.profile?.confirmed;
      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({
        ...next,
        parsed,
        profile: {
          ...next.profile,
          guess,
          guessReason: parsed?.profile_guess_reason ?? null,
          guessFellBack: !known,
          modelSaid: said,
          confirmed: chosen || guess,
          confirmedBy: chosen ? 'human' : 'auto',
        },
        closingDate: parsed?.closing_date ?? null,
      }));

      logEvent(dataDir, {
        jobId: job.id,
        type: 'parsed',
        profileGuess: guess,
        profileGuessFellBack: !known,
        modelSaid: said,
        profile: saved.profile.confirmed,
        profileConfirmedBy: saved.profile.confirmedBy,
        costCents: reply.costCents ?? 0,
      });
      res.json({ job: saved, costCents: reply.costCents ?? 0, model: reply.model ?? null });
    }),
  );

  app.post(
    '/api/jobs/:id/profile',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      const profile = String(req.body?.profile ?? '');
      if (!knownProfiles().includes(profile)) {
        throw new HttpError(400, `"${profile}" is not a profile. Choose one of: ${knownProfiles().join(', ')}.`);
      }

      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({
        ...next,
        profile: { ...next.profile, confirmed: profile, confirmedBy: 'human' },
      }));
      logEvent(dataDir, {
        jobId: job.id,
        type: 'profile-confirmed',
        profile,
        by: 'human',
        guess: job.profile?.guess ?? null,
      });
      res.json({ job: saved });
    }),
  );

  // --- scoring ---------------------------------------------------------------

  app.post(
    '/api/jobs/:id/score',
    wrap(async (req, res) => {
      const job = mustFindJob(req.params.id);
      // Scoring a cold approach would score you against requirements the app
      // invented from your own notes — fiction with a number on it, which is
      // worse than no number, and worse still because a score is the one output
      // people believe without checking.
      if (job.source === 'cold') {
        throw new HttpError(
          400,
          'There is nothing to score this against. Nobody has advertised a role here, so any requirements would be ones the app made up from your own notes.',
        );
      }
      const profile = mustHaveProfile(job);
      const config = profileConfig(profile);
      const { selected, offeredIds } = selectEvidence({
        evidence,
        jdJson: job.parsed,
        profile,
        profileConfig: config,
      });

      const reply = await callModel({
        task: 'score-deep',
        system: scoreSystemPrompt(profileMeta),
        messages: [
          {
            role: 'user',
            content: [
              '## The job (parsed from the advertisement)',
              '',
              '```json',
              JSON.stringify(job.parsed, null, 2),
              '```',
              '',
              `## Their evidence records (${selected.length}) — the only things they can claim`,
              '',
              selected.map(scoreRecordText).join('\n\n'),
            ].join('\n'),
          },
        ],
      });

      const capped = applyCap(reply.data);
      const fit = {
        ...capped,
        summary: reply.data?.summary ?? '',
        matched: reply.data?.matched ?? [],
        unmet: reply.data?.unmet ?? [],
        // Kept whole and shown separately rather than folded into the number:
        // being too senior is a different kind of misfit from failing a hard
        // filter, and you asked to be able to see it and decide for yourself.
        overqualification: normaliseOverqualification(reply.data?.overqualification),
        offeredIds,
        scoredAt: new Date().toISOString(),
        model: reply.model ?? null,
        costCents: reply.costCents ?? 0,
      };

      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({ ...next, fit }));
      logEvent(dataDir, {
        jobId: job.id,
        type: 'scored',
        modelScore: fit.modelScore,
        cappedScore: fit.cappedScore,
        verdict: fit.verdict,
        costCents: fit.costCents,
      });
      res.json({ job: saved, fit });
    }),
  );

  // --- generation ------------------------------------------------------------

  // Generation STARTS here and finishes on its own.
  //
  // It used to be awaited: the request held open for the forty to ninety
  // seconds the model took, the screen sat blocked, and applying for three jobs
  // meant doing them strictly one after another. Nothing about the work needed
  // that — the progress record already existed and the browser already polled
  // it — so the request now returns the moment the work is under way, and the
  // run carries on in the process.
  //
  // What this buys: start the CV for one job, go to the next, start that one,
  // come back. Two model calls in flight cost exactly what two sequential ones
  // cost, so this is free in every sense that matters.
  app.post(
    '/api/jobs/:id/generate/:kind',
    wrap(async (req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}". Known kinds: ${ARTIFACT_KINDS.join(', ')}.`);
      }
      const job = mustFindJob(req.params.id);
      const profile = mustHaveProfile(job);
      const key = runKey(job.id, kind);

      // Two runs of the same document would both save, and the loser's version
      // would sit in the history looking like a draft you had asked for.
      if (runs.isRunning(key)) {
        throw new HttpError(409, `That ${kind} is already being written. Wait for it to finish, or reload to see where it is up to.`);
      }

      // Refused BEFORE the run starts, so the button gets a real error rather
      // than a run that fails a second later for a reason only the poll sees.
      if (kind === 'criteria' && questionsFor(job).questions.length === 0) {
        throw new HttpError(400, 'There are no application questions to answer yet. Paste them in first — most portals ask them behind a login, so they are rarely in the advertisement.');
      }

      const onProgress = runs.start(key);
      // Deliberately not awaited. Errors are caught inside and recorded on the
      // run, which is the only place anything is still listening once this
      // request has returned — an unhandled rejection here would take the
      // server down with it, taking every other application's run too.
      void runGeneration({ job, kind, profile, onProgress, key });

      res.status(202).json({ started: true, kind, jobId: job.id });
    }),
  );

  /** The work itself, outside the request that asked for it. */
  async function runGeneration({ job, kind, profile, onProgress, key }) {
    try {
      const result = await generateArtifact({
        artifactKind: kind,
        profile,
        profileConfig: profileConfig(profile),
        jdJson: job.parsed,
        evidence,
        profileMeta,
        date: today(),
        llmComplete: callModel,
        onProgress,
        publicationIds: job.publications?.selected ?? undefined,
        questions: questionsFor(job).questions,
        notes: job.notes ?? '',
        integrityExtra: integrityExtra(),
      });

      onProgress('saving');
      const { version } = docsStore.saveVersion(dataDir, job.id, kind, {
        markdown: result.markdown,
        model: result.model,
        costCents: result.costCents,
        flags: result.flags,
        gaps: result.gaps,
        changes_made: result.changes_made,
        editedByUser: false,
        offeredIds: result.offeredIds,
      });

      jobsStore.updateJob(dataDir, job.id, (next) => ({
        ...next,
        docs: { ...next.docs, [kind]: { version, editedByUser: false, updatedAt: new Date().toISOString() } },
      }));
      logEvent(dataDir, {
        jobId: job.id,
        type: 'doc-generated',
        kind,
        version,
        costCents: result.costCents ?? 0,
        errors: result.flags?.errors?.length ?? 0,
        warnings: result.flags?.warnings?.length ?? 0,
      });
      runs.finish(key);
    } catch (err) {
      // The run record is the only listener left. Without this the screen would
      // poll a run that simply stopped, with nothing to say about why.
      logError(`  [${kind}] generation failed for ${job.id}: ${err?.message ?? err}`);
      runs.finish(key, { outcome: 'failed', error: err?.message ?? String(err) });
    }
  }

  // Every run in flight, across every application. The board reads this: once a
  // generation survives navigating away, the only evidence it is still going
  // would otherwise be the screen you just left.
  app.get(
    '/api/runs',
    wrap((req, res) => {
      res.json({ runs: runs.list() });
    }),
  );

  // --- deleting, and undeleting ----------------------------------------------
  //
  // Delete moves an application to the bin. It is not destructive, which is why
  // it can be a single click on the job screen; permanent deletion lives on the
  // bin screen, which you have to go to on purpose.
  //
  // Both still insist on the id in the body as well as the path. That is not
  // security — the server is on 127.0.0.1 and you own it — it stops a stale link
  // from doing anything by being followed.
  app.delete(
    '/api/jobs/:id',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      if (req.body?.confirm !== job.id) {
        throw new HttpError(400, 'To move this application to the bin, send `confirm` set to its id.');
      }
      // A run in flight would keep writing after the files had moved, and its
      // save would recreate the folder this is about to move away.
      for (const kind of ARTIFACT_KINDS) {
        if (runs.isRunning(runKey(job.id, kind))) {
          throw new HttpError(409, `A ${kind} is being written for this application. Wait for it to finish, then try again.`);
        }
      }

      const { files } = jobsStore.trashJob(dataDir, job.id);
      logEvent(dataDir, { jobId: job.id, type: 'deleted', files });
      res.json({ deleted: true, id: job.id, files });
    }),
  );

  // What is in the bin. Carries the whole job record, so the screen can show
  // which company and role each one was without a second request per row.
  app.get(
    '/api/trash',
    wrap((req, res) => {
      res.json({ trash: jobsStore.listTrash(dataDir) });
    }),
  );

  // Put one back. The whole reason the bin exists.
  app.post(
    '/api/trash/:id/restore',
    wrap((req, res) => {
      const result = jobsStore.restoreJob(dataDir, req.params.id);
      if (!result.restored) {
        if (result.reason === 'already-exists') {
          throw new HttpError(409, 'There is already a live application with that id, so restoring would overwrite it. Nothing was changed.');
        }
        throw new HttpError(404, 'That application is not in the bin. It may have been restored already, or deleted for good.');
      }
      logEvent(dataDir, { jobId: req.params.id, type: 'restored' });
      res.json({ restored: true, job: result.job ?? null });
    }),
  );

  // Delete for good. The only route in the app that destroys anything.
  app.delete(
    '/api/trash/:id',
    wrap((req, res) => {
      if (req.body?.confirm !== req.params.id) {
        throw new HttpError(400, 'To delete this permanently, send `confirm` set to its id.');
      }
      const { purged, files } = jobsStore.purgeJob(dataDir, req.params.id);
      if (!purged) throw new HttpError(404, 'That application is not in the bin.');
      logEvent(dataDir, { jobId: req.params.id, type: 'purged', files });
      res.json({ purged: true, id: req.params.id, files });
    }),
  );

  // Empty it. Takes the count as confirmation rather than a word, so a stale
  // page cannot empty a bin that has had something added to it since.
  app.delete(
    '/api/trash',
    wrap((req, res) => {
      const inBin = jobsStore.listTrash(dataDir);
      if (Number(req.body?.confirm) !== inBin.length) {
        throw new HttpError(
          400,
          `To empty the bin, send \`confirm\` set to the number of applications in it (${inBin.length}).`,
        );
      }
      for (const job of inBin) logEvent(dataDir, { jobId: job.id, type: 'purged', files: job.files ?? 0 });
      res.json(jobsStore.emptyTrash(dataDir));
    }),
  );

  // Notes you write BEFORE anything is generated — "mention my E-3 eligibility
  // in the header", "lead with the teaching". Until now the only way to say
  // something like that was to generate, read, then ask the chat to fix it:
  // two model calls and a rewrite to get what one call would have produced if
  // it had been told. These go into every generation for this job.
  app.put(
    '/api/jobs/:id/notes',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      if (typeof req.body?.notes !== 'string') {
        throw new HttpError(400, 'Send `notes` as a string.');
      }
      const notes = req.body.notes.slice(0, MAX_NOTES);
      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({ ...next, notes }));
      res.json({ notes: saved.notes ?? '' });
    }),
  );

  // Every record in the master profile, for the panel that lets you paste one
  // into a draft the model left it out of. Read-only and cheap: the records are
  // already in memory and already re-read when the file changes.
  app.get(
    '/api/evidence',
    wrap((req, res) => {
      res.json({
        records: evidence.map((record) => ({
          id: record.id,
          kind: record.kind,
          title: record.title,
          org: record.org,
          dates: record.dates,
          tags: record.tags,
          markdown: recordMarkdown(record),
        })),
      });
    }),
  );

  // --- application questions --------------------------------------------------
  //
  // Most portals ask their questions behind a login, so they are rarely in the
  // advertisement — these are a field you paste into, seeded from the parse when
  // the ad happened to print its criteria. Splitting the paste and reading the
  // word limits out of it is done in code (server/generate/questions.js): a
  // model cannot count words, and a limit read wrongly costs you an answer the
  // portal truncates mid-sentence.
  app.get(
    '/api/jobs/:id/questions',
    wrap((req, res) => {
      res.json(questionsPayload(mustFindJob(req.params.id)));
    }),
  );

  app.put(
    '/api/jobs/:id/questions',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      const text = req.body?.text;
      if (typeof text !== 'string') {
        throw new HttpError(400, 'Send `text` as a string — paste the questions exactly as the form asks them.');
      }

      const items = parseQuestions(text);
      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({
        ...next,
        // The raw paste is kept as well as the split: if the split is ever
        // wrong, editing the box you typed into is the obvious fix, and you
        // cannot do that from a list of fragments.
        questions: items.length > 0 ? { text, items } : null,
      }));
      logEvent(dataDir, { jobId: job.id, type: 'questions-set', count: items.length });

      res.json(questionsPayload(saved));
    }),
  );

  /** The questions, where they came from, and how the saved answers measure up. */
  function questionsPayload(job) {
    const { questions, source } = questionsFor(job);
    const markdown = docsStore.readDoc(dataDir, job.id, 'criteria');
    return {
      questions,
      source,
      text: job.questions?.text ?? '',
      counts: markdown === null ? [] : answerCounts(markdown, questions),
    };
  }

  // Most applications are read by a machine before a person, and the machine
  // matches terms. This reports which of the advertisement's own terms the SAVED
  // draft actually uses — computed against the same list the generator was
  // given, so the screen and the prompt cannot drift apart.
  app.get(
    '/api/jobs/:id/docs/:kind/keywords',
    wrap((req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}".`);
      }
      const job = mustFindJob(req.params.id);
      // A cold approach has no advertisement: its "requirements" were inferred
      // from your own notes, so coverage would measure the app against itself.
      if (job.source === 'cold' || !job.parsed) {
        return res.json({ keywords: [], covered: [], missing: [], score: null, available: false });
      }

      const keywords = extractKeywords({ jdJson: job.parsed, profileMeta });
      const markdown = docsStore.readDoc(dataDir, job.id, kind);
      if (markdown === null) {
        return res.json({ keywords, covered: [], missing: keywords, score: null, available: true });
      }

      // `available` on every path, including this one: the panel hides itself
      // when it is false, so omitting it here hid the panel exactly when there
      // was finally a document to measure.
      res.json({ keywords, available: true, ...coverage({ keywords, text: markdown }) });
    }),
  );

  // A recruiter's read of the DOCUMENT, which is a different question from the
  // fit score.
  //
  // The score reads your records and answers "is this worth applying for", before
  // a draft exists. This reads the draft you are about to send and answers "does
  // this do you justice" — and a draft can be honest, well cited, pass every
  // check, and still bury the thing this employer cares about.
  //
  // Both kinds of suggestion it makes are verified in code before they are
  // returned; see server/generate/recruiter.js for why.
  app.post(
    '/api/jobs/:id/docs/:kind/review',
    wrap(async (req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}". Known kinds: ${ARTIFACT_KINDS.join(', ')}.`);
      }
      const job = mustFindJob(req.params.id);
      if (!job.parsed) {
        throw new HttpError(409, 'The advertisement has not been read yet, so there is nothing to review this against.');
      }
      if (job.source === 'cold') {
        throw new HttpError(
          400,
          'Nobody advertised this role, so there is no advertisement to be screened against. A review here would only compare the draft to notes the app wrote itself.',
        );
      }

      // The SAVED document, not whatever is in the editor. Reviewing unsaved text
      // would report on something that does not exist anywhere.
      const markdown = docsStore.readDoc(dataDir, job.id, kind);
      if (markdown === null || markdown.trim() === '') {
        throw new HttpError(409, `There is no ${kind} to review yet. Generate one first, and save any edits you want it to read.`);
      }

      const keywords = coverage({ keywords: extractKeywords({ jdJson: job.parsed, profileMeta }), text: markdown });
      const marked = [
        ...keywords.covered.map((keyword) => ({ ...keyword, used: true })),
        ...keywords.missing.map((keyword) => ({ ...keyword, used: false })),
      ];
      const cited = recordsUsedIn(markdown, evidence);

      const reply = await callModel({
        task: 'review-cv',
        system: reviewSystemPrompt({
          roleTitle: job.parsed?.role_title ?? '',
          company: job.parsed?.company ?? '',
          kind,
        }),
        messages: [
          {
            role: 'user',
            content: reviewUserMessage({
              jdJson: job.parsed,
              markdown,
              records: evidence,
              cited,
              keywords: marked,
            }),
          },
        ],
      });

      const review = {
        ...checkReview(reply.data, { records: evidence, cited, keywords: marked, markdown }),
        kind,
        version: job.docs?.[kind]?.version ?? null,
        costCents: reply.costCents ?? 0,
        model: reply.model ?? null,
        reviewedAt: new Date().toISOString(),
      };

      // Stored on the job so it survives a reload, and replaced rather than
      // appended: a review of an older draft is worse than no review, because it
      // reads as being about the one on screen.
      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({
        ...next,
        reviews: { ...(next.reviews ?? {}), [kind]: review },
      }));
      logEvent(dataDir, { jobId: job.id, type: 'reviewed', kind, verdict: review.verdict, costCents: review.costCents });
      res.json({ review, job: saved });
    }),
  );

  // The stored review, if there is one for the version on screen.
  app.get(
    '/api/jobs/:id/docs/:kind/review',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      const review = job.reviews?.[req.params.kind] ?? null;
      // Stale is worse than absent: a review of version 2 shown beside version 4
      // reads as a judgement on what is on screen.
      const current = job.docs?.[req.params.kind]?.version ?? null;
      res.json({ review, stale: review !== null && review.version !== current });
    }),
  );

  // --- publications ----------------------------------------------------------
  //
  // Which papers appear is a judgement, and it is yours. Everything below reads
  // from the records and renders APA in code (server/profile/citation.js) — the
  // model is never asked for a citation, because a citation is the one thing on
  // a CV a reader can check in ten seconds.
  app.get(
    '/api/jobs/:id/publications',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      res.json(publicationsFor(job));
    }),
  );

  app.put(
    '/api/jobs/:id/publications',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      const ids = req.body?.selected;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        throw new HttpError(400, 'Send `selected` as an array of publication ids.');
      }

      const missing = unknownIds({ evidence, selected: ids });
      if (missing.length > 0) {
        throw new HttpError(400, `No publication in your profile has the id ${missing.join(', ')}.`);
      }

      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({
        ...next,
        publications: { selected: ids, chosenBy: 'human' },
      }));
      logEvent(dataDir, { jobId: job.id, type: 'publications-chosen', count: ids.length });

      // Ticking used to change only what the NEXT generation would say, which
      // is invisible: you ticked, looked at the draft, and nothing had happened.
      // Citations are rendered in code, so the section is rewritten in place —
      // no model call, no cost, and nothing else in the document can move.
      res.json({ job: saved, ...publicationsFor(saved) });
    }),
  );

  /**
   * The chosen citations, applied to a document ON THE WAY OUT.
   *
   * Ticking a publication used to rewrite the saved CV and save a version. That
   * was wrong in the way that costs work: you could be part-way through editing,
   * tick a box, and the draft under you became a new version built from the last
   * SAVED text — silently discarding whatever was in the editor and unsaved. The
   * ticks were visible; the loss was not.
   *
   * So nothing writes to the draft any more. The selection is recorded, the next
   * generation uses it, and every way the document leaves the app — print view,
   * .tex, PDF — has the citations put in here, at render time, from the records.
   * Nothing on disk changes, so nothing can be lost.
   */
  function withPublications(markdown, job) {
    const ids = job.publications?.selected;
    if (!Array.isArray(ids)) return markdown; // nothing chosen; the draft stands
    const citations = renderSelected({ evidence, selected: ids });
    return replacePublications(markdown, citations).markdown;
  }

  /**
   * The picker's data: every publication, with the ones for this job ticked.
   * Until you choose, the ticks come from the profile's own policy applied to
   * this advertisement — which is what generation would use anyway, so the
   * screen and the document never disagree about what is on the CV.
   */
  function publicationsFor(job) {
    const profile = job.profile?.confirmed || job.profile?.guess || null;
    const config = (profile && getProfile(profile, { dir: profilesDir })) || {};
    const { selected: selectedEvidence } = job.parsed
      ? selectEvidence({ evidence, jdJson: job.parsed, profile, profileConfig: config })
      : { selected: [] };

    const surname = nameParts(profileMeta).surname;
    return {
      publications: publicationList({
        surname,
        evidence,
        selected: job.publications?.selected ?? undefined,
        // The same call generation makes, with the same arguments — the screen
        // and the document must never disagree about what would be ticked.
        proposed: proposeFrom(selectedEvidence, evidence, config, { surname }),
      }),
      chosenBy: job.publications?.chosenBy ?? null,
    };
  }

  // Polled by the job screen while a generation is running. Cheap on purpose:
  // it reads one object out of a Map and touches no disk, because it is called
  // every few hundred milliseconds and must never compete with the work itself.
  app.get(
    '/api/jobs/:id/generate/:kind/progress',
    wrap((req, res) => {
      res.json({ progress: runs.read(runKey(req.params.id, req.params.kind)) });
    }),
  );

  // --- asking the model about a draft ----------------------------------------
  //
  // A conversation about the document, kept per document. Answers a question, or
  // rewrites the draft when that is what was asked — and a rewrite is saved
  // through the ordinary version machinery, so it is undoable and the validator
  // still runs on it.
  app.get(
    '/api/jobs/:id/docs/:kind/chat',
    wrap((req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}".`);
      }
      const job = mustFindJob(req.params.id);
      res.json({ kind, turns: chatStore.readChat(dataDir, job.id, kind) });
    }),
  );

  app.delete(
    '/api/jobs/:id/docs/:kind/chat',
    wrap((req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}".`);
      }
      const job = mustFindJob(req.params.id);
      // Only the conversation goes. Every document version it produced stays —
      // clearing a chat must never be a way to lose a draft.
      chatStore.clearChat(dataDir, job.id, kind);
      logEvent(dataDir, { jobId: job.id, type: 'chat-cleared', kind });
      res.json({ kind, turns: [] });
    }),
  );
  /**
   * Your whole profile, marked up against the draft in front of you.
   *
   * A POST because the draft is the input, unsaved edits and all — you are
   * checking what you are looking at, not what last reached disk. Nothing is
   * written and no model is called; it is a read that happens to need a body.
   *
   * `used` comes from the same function the recruiter's read uses, rather than a
   * second heuristic in the client. Two rules for "is this record in the CV"
   * that disagree is worse than either rule alone.
   */
  app.post(
    '/api/jobs/:id/docs/:kind/records',
    wrap((req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}". Known kinds: ${ARTIFACT_KINDS.join(', ')}.`);
      }
      const job = mustFindJob(req.params.id);
      const onScreen = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
      const markdown = onScreen.trim() || docsStore.readDoc(dataDir, job.id, kind) || '';
      const used = new Set(recordsUsedIn(markdown, evidence));
      const surname = nameParts(profileMeta).surname || null;
      res.json({
        records: evidence.map((record) => ({
          ...record,
          used: used.has(record.id),
          // The record as it is written in master-profile.md, heading and all —
          // the same text /api/evidence hands the inserter, so "put it in the
          // draft" puts in the record rather than a reassembled version of it.
          markdown: recordMarkdown(record),
          ...(record.kind === 'publication' ? { citation: renderCitation(record, surname) } : {}),
        })),
        usedCount: used.size,
        profileError,
      });
    }),
  );

  app.post(
    '/api/jobs/:id/docs/:kind/revise',
    wrap(async (req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}". Known kinds: ${ARTIFACT_KINDS.join(', ')}.`);
      }
      const job = mustFindJob(req.params.id);
      const profile = mustHaveProfile(job);
      const instruction = String(req.body?.instruction ?? '').trim();
      if (instruction === '') throw new HttpError(400, 'Type a question or an instruction first.');

      // Ask unless Edit was chosen deliberately. An older page that does not send
      // a mode at all therefore cannot rewrite anything, which is the right way
      // round for a default: the failure mode of guessing wrong is somebody's
      // draft, and the failure mode of asking again is one more click.
      const mode = req.body?.mode === 'edit' ? 'edit' : 'ask';
      const quote = String(req.body?.quote ?? '').trim();

      // Unsaved edits in the textarea are sent along, so you can ask about the
      // text in front of you rather than the last thing that reached disk.
      const onScreen = typeof req.body?.markdown === 'string' ? req.body.markdown.trim() : '';
      const markdown = onScreen || docsStore.readDoc(dataDir, job.id, kind);
      if (!markdown) {
        throw new HttpError(404, `No ${kind} has been generated yet, so there is nothing to ask about.`);
      }

      // EVERY record, not the selection generation used.
      //
      // Generation is shown a ranked, capped subset because it is composing and
      // needs focus. Revision is editing a document you are looking at, and the
      // edit you want may well be "add my teaching role" — a record the
      // selector had capped out, or that this profile's evidenceProfiles cannot
      // reach. Withholding it meant the model answered "there are no evidence
      // records in your master profile for that university" about a record
      // sitting at line 296 of that file. That is the worst kind of wrong: a
      // confident denial that sends you off to add data you already has.
      //
      // The cost of the honest version is about 1,400 tokens.
      const { selected: relevant } = selectEvidence({
        evidence,
        jdJson: job.parsed,
        profile,
        profileConfig: profileConfig(profile),
      });

      // Your turn is recorded BEFORE the model is asked. If the call then fails
      // or times out, the question is still in the transcript rather than
      // having vanished along with the answer you never got.
      const asked = chatStore.appendTurn(dataDir, job.id, kind, {
        role: 'you',
        text: instruction,
        mode,
        ...(quote ? { quote } : {}),
      });

      let result;
      try {
        result = await reviseArtifact({
          instruction,
          markdown,
          artifactKind: kind,
          profile,
          mode,
          quote,
          jdJson: job.parsed,
          selected: evidence,
          highlighted: relevant.map((record) => record.id),
          transcript: chatStore.transcriptFor(
            chatStore.readChat(dataDir, job.id, kind).filter((turn) => turn.id !== asked.id),
          ),
          profileMeta,
          integrityExtra: integrityExtra(),
          llmComplete: callModel,
        });
      } catch (err) {
        chatStore.appendTurn(dataDir, job.id, kind, {
          role: 'model',
          text: err?.message ?? 'That did not work.',
          failed: true,
        });
        throw err;
      }

      // A proposal goes through the same cleaning as an applied rewrite, because
      // the only difference between them is a click. Doing it at apply time
      // instead would mean the text you read is not the text you get.
      if (result.proposal) {
        result.proposal = stripEvidenceIds(result.proposal, evidenceIds).markdown;
      }

      let version = null;
      let flags = null;
      if (result.revised) {
        // Same reason as the save route: a model asked to respect citations has
        // more than once decided that means printing them.
        result.markdown = stripEvidenceIds(result.markdown, evidenceIds).markdown;
        // Advisory, exactly like one of your own edits: the citations are gone
        // once a document is markdown, so every finding is a warning (R8).
        flags = validate({
          artifact: artifactFromMarkdown(result.markdown, kind, { contactLines: contactLinesFor(job) }),
          artifactKind: kind,
          evidence,
          profile,
          jobParsed: job.parsed ?? null,
          renderedText: result.markdown,
          mode: 'advisory',
          profileMeta,
        });
        ({ version } = docsStore.saveVersion(dataDir, job.id, kind, {
          markdown: result.markdown,
          flags,
          changes_made: result.changes_made,
          model: result.model,
          costCents: result.costCents,
          editedByUser: false,
        }));
        jobsStore.updateJob(dataDir, job.id, (next) => ({
          ...next,
          docs: { ...next.docs, [kind]: { version, editedByUser: false, updatedAt: new Date().toISOString() } },
        }));
      }

      logEvent(dataDir, {
        jobId: job.id,
        type: 'doc-revised',
        kind,
        revised: result.revised,
        version,
        costCents: result.costCents ?? 0,
      });

      const answer = chatStore.appendTurn(dataDir, job.id, kind, {
        role: 'model',
        text: result.reply,
        revised: result.revised,
        version,
        changes_made: result.changes_made,
        declined: result.declined,
        note: result.note,
        // Kept on the turn, not just in this response, so the offer survives a
        // reload. It is one document — a few kilobytes — against the alternative
        // of a reply describing a rewrite nobody can produce any more.
        ...(result.proposal ? { proposal: result.proposal, proposed_changes: result.proposed_changes } : {}),
        costCents: result.costCents ?? 0,
        model: result.model ?? null,
      });

      res.json({
        kind,
        turns: [asked, answer],
        reply: result.reply,
        revised: result.revised,
        markdown: result.markdown,
        proposal: result.proposal,
        changes_made: result.changes_made,
        declined: result.declined,
        note: result.note,
        version,
        flags,
        costCents: result.costCents,
        model: result.model,
      });
    }),
  );

  app.put(
    '/api/jobs/:id/docs/:kind',
    wrap((req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}".`);
      }
      const job = mustFindJob(req.params.id);
      const raw = String(req.body?.markdown ?? '');
      if (raw.trim() === '') throw new HttpError(400, 'The document is empty — nothing was saved.');
      // Evidence ids are how the validator traces a claim; they are not for a
      // reader. A revision once wrote them into the text and they compiled
      // straight into a PDF, so they are removed on the way in — whoever put
      // them there.
      const { markdown, removed } = stripEvidenceIds(raw, evidenceIds);

      // Advisory, not strict: after an edit the citations are gone, so numbers are
      // checked against the whole profile and every finding is a warning (R8).
      const flags = validate({
        artifact: artifactFromMarkdown(markdown, kind, { contactLines: contactLinesFor(job) }),
        artifactKind: kind,
        evidence,
        profile: job.profile?.confirmed ?? null,
        jobParsed: job.parsed ?? null,
        renderedText: markdown,
        mode: 'advisory',
        profileMeta,
      });

      const { version } = docsStore.saveVersion(dataDir, job.id, kind, {
        markdown,
        flags,
        editedByUser: true,
        model: null,
        costCents: 0,
      });

      jobsStore.updateJob(dataDir, job.id, (next) => ({
        ...next,
        docs: { ...next.docs, [kind]: { version, editedByUser: true, updatedAt: new Date().toISOString() } },
      }));
      logEvent(dataDir, { jobId: job.id, type: 'doc-saved', kind, version, warnings: flags.warnings.length });

      res.json({
        kind, version, flags, editedByUser: true,
        ...(removed.length > 0 ? { strippedIds: [...new Set(removed)] } : {}),
      });
    }),
  );

  // Read one earlier version. Every save has always kept the previous text, but
  // until now the only way to see it was to open the data directory in a file
  // manager — so in practice a regenerate looked like it had destroyed the
  // draft you preferred.
  app.get(
    '/api/jobs/:id/docs/:kind/versions/:v',
    wrap((req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) {
        throw new HttpError(404, `There is no document kind "${kind}".`);
      }
      const job = mustFindJob(req.params.id);
      const markdown = docsStore.readVersion(dataDir, job.id, kind, req.params.v);
      if (markdown === null) {
        throw new HttpError(404, `There is no version ${req.params.v} of this ${kind}.`);
      }
      res.json({ kind, v: Number(req.params.v), markdown });
    }),
  );

  // --- LaTeX and PDF export --------------------------------------------------
  //
  // Markdown stays the editable source and LaTeX is the last step, so this reads
  // the CURRENT SAVED markdown and works forward from there. Rendering the
  // model's original structured artifact instead would silently discard every
  // edit you made — the one failure mode this feature cannot have.
  //
  // Both exports run through here, freshly, on every request. That is the fix
  // for "changing the CV in the app doesn't change the LaTeX version": the file
  // was being rebuilt correctly all along, but the download was a plain <a href>
  // to an unchanging URL, so the browser served its cached copy of the previous
  // export and never asked. Hence `no-store` below and a version in the URL.
  function buildExport(req) {
    const kind = req.params.kind;
    if (!ARTIFACT_KINDS.includes(kind)) {
      throw new HttpError(404, `There is no document kind "${kind}". Known kinds: ${ARTIFACT_KINDS.join(', ')}.`);
    }
    const job = mustFindJob(req.params.id);
    const saved = docsStore.readDoc(dataDir, job.id, kind);
    if (saved === null) {
      throw new HttpError(404, `No ${kind} has been generated for this job yet, so there is nothing to export. Press Generate first.`);
    }
    // The publications you ticked go in HERE rather than into the saved file —
    // see withPublications. Only the CV has them.
    const markdown = kind === 'cv' ? withPublications(saved, job) : saved;

    const facts = jobFacts(job.parsed ?? {});
    const contact = contactBlock(profileMeta, facts);
    const profile = job.profile?.confirmed || job.profile?.guess || null;
    const document = documentFromMarkdown(markdown, { contactLines: contact.lines });

    const tex = renderLatex({
      artifact: document.artifact,
      artifactKind: kind,
      contact,
      profile,
      profileConfig: (profile && getProfile(profile)) || {},
      jobMeta: {
        ...facts,
        skills: job.parsed?.skills ?? [],
        evidenceTags: matchedTags(job, evidence),
      },
      profileMeta,
    });

    // Written beside the draft as well as sent, with the class file next to it:
    // pdflatex only finds atscv.sty if it sits in the same folder, and hunting
    // for it is exactly the sort of yak-shave that stops a document being sent.
    const dir = path.join(docsStore.appDir(dataDir, job.id), 'latex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${kind}.tex`), tex, 'utf8');
    fs.copyFileSync(ATSCV_STY, path.join(dir, 'atscv.sty'));

    return { kind, job, tex, dir };
  }

  /**
   * The contact lines this job's documents were built with. Needed by every
   * advisory re-check so the header is not mistaken for a set of claims: the
   * digits of a phone number are not statistics, and a validator that says they
   * are is a validator you stop reading.
   */
  function contactLinesFor(job) {
    return contactBlock(profileMeta, jobFacts(job.parsed ?? {})).lines;
  }

  /** An export must never be served from cache: the document changes under it. */
  function noStore(res) {
    res.setHeader('cache-control', 'no-store, must-revalidate');
    res.setHeader('pragma', 'no-cache');
    res.setHeader('expires', '0');
  }

  app.get(
    '/api/jobs/:id/docs/:kind/latex',
    wrap((req, res) => {
      const { kind, job, tex } = buildExport(req);
      const filename = suggestedFilename({ profileMeta, kind, job, ext: 'tex' });
      logEvent(dataDir, { jobId: job.id, type: 'doc-exported', kind, format: 'latex', filename });

      noStore(res);
      res.type('application/x-tex');
      res.setHeader('content-disposition', `attachment; filename="${filename}"`);
      res.send(tex);
    }),
  );

  // The PDF you actually submits. Compiled by a TeX engine on your machine, in the
  // same folder the .tex was written to, so `pdflatex cv.tex` by hand keeps
  // working and produces exactly the same document.
  app.get(
    '/api/jobs/:id/docs/:kind/pdf',
    wrap(async (req, res) => {
      const { kind, job, dir } = buildExport(req);
      // Announced in the terminal like every model call is. A compile can take
      // minutes on a first MiKTeX run while it fetches packages, and a silent
      // wait of that length is indistinguishable from a hang.
      log(`  [pdf] compiling ${kind}…`);
      const result = await compilePdf({ dir, name: kind, log: (line) => log(`  [pdf] ${line}`) });

      if (!result.ok) {
        const detail = result.reason === 'no-engine' ? installHint() : result.detail;
        logEvent(dataDir, { jobId: job.id, type: 'doc-export-failed', kind, format: 'pdf', reason: result.reason });
        throw new HttpError(result.reason === 'no-engine' ? 501 : 500, pdfFailureMessage(result, detail), {
          reason: result.reason,
          detail,
          texPath: path.join(dir, `${kind}.tex`),
        });
      }

      const filename = suggestedFilename({ profileMeta, kind, job, ext: 'pdf' });
      logEvent(dataDir, { jobId: job.id, type: 'doc-exported', kind, format: 'pdf', filename, engine: result.engine });

      noStore(res);
      res.type('application/pdf');
      res.setHeader('content-disposition', `attachment; filename="${filename}"`);
      res.send(fs.readFileSync(result.pdfPath));
    }),
  );

  // Asked once when the job screen loads, so the button can say "Download PDF"
  // or explain what to install BEFORE it is clicked and returns an error.
  app.get(
    '/api/latex-engine',
    wrap(async (_req, res) => {
      const engine = await findEngine();
      res.json({ available: engine !== null, engine: engine?.name ?? null, hint: engine ? null : installHint() });
    }),
  );

  // --- reading ---------------------------------------------------------------

  app.get(
    '/api/jobs/:id',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      res.json({ job, docs: docsStore.readDocs(dataDir, job.id, ARTIFACT_KINDS) });
    }),
  );

  app.get(
    '/api/board',
    wrap((req, res) => {
      const jobs = jobsStore.listJobs(dataDir);
      res.json({ statuses: jobsStore.STATUSES, board: jobsStore.groupByStatus(jobs), count: jobs.length });
    }),
  );

  app.patch(
    '/api/jobs/:id/status',
    wrap((req, res) => {
      const job = mustFindJob(req.params.id);
      const status = String(req.body?.status ?? '');
      if (!jobsStore.STATUSES.includes(status)) {
        throw new HttpError(400, `"${status}" is not a column. Use one of: ${jobsStore.STATUSES.join(', ')}.`);
      }
      const from = job.status;
      const saved = jobsStore.updateJob(dataDir, job.id, (next) => ({ ...next, status }));
      logEvent(dataDir, { jobId: job.id, type: 'status-change', from, to: status });
      res.json({ job: saved });
    }),
  );

  // --- CV profiles -----------------------------------------------------------
  //
  // A CV profile is the SHAPE of a document — section order, length, what leads,
  // how publications are handled. (Not to be confused with master-profile.md,
  // which is the record of the person.) They are files, so these routes are
  // "list them", "have a model write one", "write it to disk", and edit.

  // The one list of profiles the client is allowed to know about. It comes from the
  // files in server/generate/profiles/, so adding a profile changes the dropdown too.
  app.get(
    '/api/profiles',
    wrap((req, res) => {
      res.json(profileSummaries({ dir: profilesDir }));
    }),
  );

  // Draft, but do not save. You read what came back before anything is written:
  // a profile is two files on your disk, and a file you did not ask for is worse
  // than a click. The check runs here as well as on save so a broken draft is
  // caught while the description is still in front of you.
  app.post(
    '/api/profiles/draft',
    wrap(async (req, res) => {
      const description = String(req.body?.description ?? '').trim();
      if (description === '') {
        throw new HttpError(400, 'Describe the kind of role this profile is for, and it will draft one.');
      }

      const reply = await callModel({
        task: 'draft-profile',
        system: draftProfileSystemPrompt({ dir: profilesDir, profileMeta, evidenceTags: evidenceTags() }),
        messages: [{ role: 'user', content: `The kind of profile they want:\n\n${description}` }],
      });

      const { config, promptMarkdown } = splitDraft(reply.data);
      if (profileExists(config.id, { dir: profilesDir })) {
        throw new HttpError(
          409,
          `There is already a profile called "${config.id}". Say a bit more about how this one differs, ` +
            `and it will draft a different profile.`,
        );
      }
      const problems = checkProfile({ config, promptMarkdown, evidenceTags: evidenceTags() });
      if (problems.length > 0) throw new HttpError(422, draftRejection(problems));

      res.json({
        config,
        promptMarkdown,
        costCents: reply.costCents ?? 0,
        model: reply.model ?? null,
      });
    }),
  );

  // Save. Everything is re-checked: what comes back here is whatever the browser
  // posted, which is not necessarily what the model drafted.
  app.post(
    '/api/profiles',
    wrap((req, res) => {
      const config = req.body?.config ?? null;
      const promptMarkdown = String(req.body?.promptMarkdown ?? '');
      const id = config?.id;

      if (profileExists(id, { dir: profilesDir })) {
        throw new HttpError(
          409,
          `There is already a profile called "${id}", and it will not be overwritten. Give this one a ` +
            `different id, or edit server/generate/profiles/${id}.json by hand.`,
        );
      }
      const problems = checkProfile({ config, promptMarkdown, evidenceTags: evidenceTags() });
      if (problems.length > 0) throw new HttpError(400, draftRejection(problems));

      const written = saveProfile({
        config,
        promptMarkdown,
        dir: profilesDir,
        promptDir: profilePromptsDir,
        evidenceTags: evidenceTags(),
      });
      logEvent(dataDir, {
        jobId: null,
        type: 'profile-created',
        profile: written.id,
        sections: config.sections.map((section) => section.id),
        evidenceProfiles: config.evidenceProfiles,
      });

      res.status(201).json({
        profile: { id: written.id, description: config.description },
        profiles: profileSummaries({ dir: profilesDir }),
      });
    }),
  );

  app.get(
    '/api/usage',
    wrap((req, res) => {
      res.json(totals(ledgerFile));
    }),
  );

  app.get(
    '/api/meta',
    wrap((req, res) => {
      const contact = contactBlock(profileMeta, {});
      let provider = null;
      let providerProblem = null;
      try {
        provider = resolveProvider();
      } catch (err) {
        providerProblem = err.message;
      }
      const keyPresent = provider ? Boolean(process.env[PROVIDERS[provider].apiKeyEnvVar]) : false;
      res.json({
        name: profileMeta?.name ?? null,
        provider,
        providerProblem,
        keyPresent,
        needsAttention: contact.needsAttention,
        evidenceCount: evidence.length,
        // What the welcome screen reads. A fact about the data on disk rather
        // than a flag somebody clicked past, so deleting your profile takes you
        // back to setup instead of leaving the app quietly generating blank CVs.
        setup: setupState({ profileMeta, recordCount: evidence.length, keyPresent }),
        evidenceTags: evidenceTags(),
        // Non-null when master-profile.md currently does not parse. The app is
        // running on the last version that did, which is the right behaviour and
        // the wrong thing to be silent about: you would add a record, see nothing
        // change, and have no way to find out why.
        profileError,
        profiles: knownProfiles(),
        statuses: jobsStore.STATUSES,
        // The deadline the chat is working to. The screen counts seconds at
        // you, and a counter with no end in sight is the difference between
        // waiting and wondering whether it has hung.
        reviseTimeoutMs: reviseDeadlineMs(),
        // This server understands Ask and Edit, and will not rewrite a document
        // in Ask mode. A page that does not see this flag is talking to a server
        // older than itself — started before a pull and never restarted — and
        // that server WILL rewrite the draft for a question, because it has
        // never heard of the promise the page is making. Ask is a guarantee or
        // it is nothing, so the chat says so and refuses rather than finding out
        // the hard way on somebody's CV.
        chatModes: true,
        // When this changes, the process answering is not the one the open page
        // loaded against — it was restarted, usually after a pull. The
        // page then holds a client that may not match the API, which is the
        // sort of mismatch that produces baffling errors instead of a clear
        // "reload me".
        startedAt: STARTED_AT,
      });
    }),
  );

  // --- setup, settings and the profile editor --------------------------------
  //
  // Everything below exists so that a person who has just cloned this never has
  // to open a text editor to use it. The files are still plain markdown and
  // plain JSON on their own disk, and editing them by hand still works — these
  // routes write the same files, and the watcher means both directions are live.

  /**
   * The state of the machine, for the welcome screen. The slow checks are opt-in:
   * asking a provider for its model list is a network round trip, and compiling
   * a LaTeX probe document takes seconds, so neither runs unless asked for.
   */
  app.get(
    '/api/doctor',
    wrap(async (req, res) => {
      const wanted = new Set(
        req.query.checks
          ? String(req.query.checks).split(',').map((id) => id.trim()).filter(Boolean)
          : ['node', 'dependencies', 'env', 'provider', 'master-profile', 'contact', 'cv-profiles', 'data'],
      );
      const results = [];
      for (const check of CHECKS) {
        if (!wanted.has(check.id)) continue;
        try {
          results.push({ id: check.id, ...(await check.run({ dataDir })) });
        } catch (err) {
          results.push({ id: check.id, label: check.id, status: 'fail', detail: err?.message ?? String(err) });
        }
      }
      res.json({ checks: results, healthy: results.every((r) => r.status !== 'fail') });
    }),
  );

  /**
   * Save the provider and its key into .env. The key is never sent back — a
   * settings screen that redisplays a secret is a settings screen that leaks one
   * into a screenshot — so the answer says only whether one is now set.
   */
  app.post(
    '/api/setup/provider',
    wrap((req, res) => {
      const provider = String(req.body?.provider ?? '').trim().toLowerCase();
      if (!Object.keys(PROVIDERS).includes(provider)) {
        throw new HttpError(400, `"${provider}" is not a provider. Choose one of: ${Object.keys(PROVIDERS).join(', ')}.`);
      }
      const key = String(req.body?.apiKey ?? '').trim();
      const values = { LLM_PROVIDER: provider };
      // An empty key means "just switch provider", not "wipe the key I already
      // saved" — retyping a 40-character secret to change a dropdown is a trap.
      if (key !== '') values[PROVIDERS[provider].apiKeyEnvVar] = key;
      saveEnvValues(ENV_FILE, values);
      logEvent(dataDir, { type: 'provider-set', provider });
      res.json({
        provider,
        keyPresent: Boolean(process.env[PROVIDERS[provider].apiKeyEnvVar]),
        file: path.relative(REPO_ROOT, ENV_FILE),
      });
    }),
  );

  /**
   * One real call to the configured provider. This is the check that matters:
   * a key can be present, correctly spelled and still rejected, and finding that
   * out on your first job advertisement is finding it out at the worst moment.
   */
  app.post(
    '/api/setup/test-key',
    wrap(async (req, res) => {
      try {
        const reply = await callModel({
          task: 'parse-jd',
          schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
          system: 'Answer with the JSON object {"ok": true} and nothing else.',
          messages: [{ role: 'user', content: 'Reply with {"ok": true}.' }],
        });
        res.json({ ok: true, model: reply.model ?? null });
      } catch (err) {
        res.json({ ok: false, error: err?.message ?? String(err), type: err?.type ?? 'error' });
      }
    }),
  );

  /** Contact details, work rights and the honesty ground truth, as one object. */
  app.get(
    '/api/profile/meta',
    wrap((req, res) => {
      res.json({ meta: profileMeta, evidenceTags: evidenceTags() });
    }),
  );

  app.put(
    '/api/profile/meta',
    wrap((req, res) => {
      const incoming = req.body?.meta;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        throw new HttpError(400, 'Expected a "meta" object.');
      }
      const next = saveMeta({ ...blankProfileMeta(), ...incoming });
      // Evidence tags live in here, so the records have to be re-checked against
      // the new list — a tag you just deleted should show up as a problem now,
      // not the next time something happens to touch the file.
      rereadProfile();
      logEvent(dataDir, { type: 'meta-saved' });
      res.json({ meta: next, evidenceTags: evidenceTags(), profileError });
    }),
  );

  /** Free-text integrity constraints appended to every generation prompt. */
  app.get(
    '/api/profile/integrity',
    wrap((req, res) => {
      res.json({ text: integrityExtra(), derived: integrityRules({ profileMeta }) });
    }),
  );

  app.put(
    '/api/profile/integrity',
    wrap((req, res) => {
      fs.mkdirSync(paths.profileDir, { recursive: true });
      fs.writeFileSync(integrityFile, String(req.body?.text ?? ''), 'utf8');
      res.json({ text: integrityExtra(), derived: integrityRules({ profileMeta }) });
    }),
  );

  /**
   * Every record, plus what the app makes of it. Publications carry their parsed
   * citation and its problems: a citation that cannot be read is the one profile
   * error that is otherwise invisible, because it renders as something
   * half-right rather than as a failure.
   */
  app.get(
    '/api/profile/records',
    wrap((req, res) => {
      const surname = nameParts(profileMeta).surname || null;
      res.json({
        records: evidence.map((record) =>
          record.kind === 'publication'
            ? { ...record, citation: renderCitation(record, surname) }
            : record,
        ),
        kinds: RECORD_KINDS,
        evidenceTags: evidenceTags(),
        profileError,
      });
    }),
  );

  const writeRecords = (next, event) => {
    writeProfileText(paths.masterProfile, next);
    rereadProfile();
    logEvent(dataDir, event);
  };

  app.post(
    '/api/profile/records',
    wrap((req, res) => {
      const record = req.body?.record ?? {};
      const current = readProfileText(paths.masterProfile);
      let next;
      try {
        next = upsertRecord(current, record);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      writeRecords(next, { type: 'record-added', recordId: record.id, kind: record.kind });
      res.status(201).json({ id: record.id, count: evidence.length, profileError });
    }),
  );

  app.put(
    '/api/profile/records/:id',
    wrap((req, res) => {
      const record = req.body?.record ?? {};
      const current = readProfileText(paths.masterProfile);
      if (!hasRecord(current, req.params.id)) {
        throw new HttpError(404, `There is no record with the id "${req.params.id}".`);
      }
      let next;
      try {
        next = upsertRecord(current, record, { originalId: req.params.id });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      writeRecords(next, { type: 'record-edited', recordId: record.id });
      res.json({ id: record.id, count: evidence.length, profileError });
    }),
  );

  app.delete(
    '/api/profile/records/:id',
    wrap((req, res) => {
      const current = readProfileText(paths.masterProfile);
      if (!hasRecord(current, req.params.id)) {
        throw new HttpError(404, `There is no record with the id "${req.params.id}".`);
      }
      writeRecords(removeRecord(current, req.params.id), { type: 'record-deleted', recordId: req.params.id });
      res.json({ deleted: req.params.id, count: evidence.length, profileError });
    }),
  );

  /**
   * The whole file, for anyone who would rather work in markdown — and for the
   * case the record forms cannot reach, which is a file that currently does not
   * parse. A save is checked before it lands: writing a file the app then
   * refuses to read is a trap the editor should not be able to set.
   */
  app.get(
    '/api/profile/raw',
    wrap((req, res) => {
      res.json({ text: readProfileText(paths.masterProfile), path: path.relative(REPO_ROOT, paths.masterProfile) });
    }),
  );

  app.put(
    '/api/profile/raw',
    wrap((req, res) => {
      const text = String(req.body?.text ?? '');
      const { errors } = parseProfile(text, { allowedTags: profileMeta?.evidenceTags ?? null });
      if (errors.length > 0 && req.body?.force !== true) {
        throw new HttpError(400, 'This would not parse, so it has not been saved.', {
          problems: errors.map((error) => error.message),
        });
      }
      writeRecords(text, { type: 'profile-edited' });
      res.json({ count: evidence.length, profileError });
    }),
  );

  /**
   * Load the worked example, or start again from an empty profile. Both replace
   * what is there, so both keep a copy first — losing an afternoon of typing to
   * a button labelled "try the example" would be unforgivable.
   */
  app.post(
    '/api/profile/replace',
    wrap((req, res) => {
      const source = String(req.body?.source ?? '').trim();
      const from =
        source === 'example'
          ? { profile: path.join(EXAMPLE_DIR, 'example-profile.md'), meta: path.join(EXAMPLE_DIR, 'example-profile-meta.json') }
          : source === 'empty'
            ? { profile: path.join(REPO_ROOT, 'templates', 'master-profile.md'), meta: null }
            : null;
      if (!from) throw new HttpError(400, 'Choose either "example" or "empty".');

      const backup = path.join(paths.profileDir, 'backups', `master-profile-${Date.now()}.md`);
      const current = readProfileText(paths.masterProfile);
      if (current.trim() !== '') {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, current, 'utf8');
      }

      writeProfileText(paths.masterProfile, fs.readFileSync(from.profile, 'utf8'));
      if (from.meta && req.body?.withContactDetails !== false) saveMeta(readJson(from.meta));
      rereadProfile();
      logEvent(dataDir, { type: 'profile-replaced', source });
      res.json({
        count: evidence.length,
        profileError,
        backedUpTo: current.trim() === '' ? null : path.join('data', path.relative(dataDir, backup)),
      });
    }),
  );

  /**
   * Read a document into text, without involving a model. Split from the import
   * itself so the extraction can be shown and corrected before anything is spent
   * on it: a PDF that came out garbled is worth seeing BEFORE it becomes forty
   * confidently-wrong records.
   */
  app.post(
    '/api/profile/import/read',
    wrap((req, res) => {
      const name = String(req.body?.filename ?? '').trim();
      const base64 = String(req.body?.data ?? '');
      if (base64 === '') throw new HttpError(400, 'No file arrived.');

      const bytes = Buffer.from(base64, 'base64');
      // A .txt or .md is already text; only a PDF needs taking apart.
      if (/\.(txt|md|markdown)$/i.test(name) || !/\.pdf$/i.test(name)) {
        const text = bytes.toString('utf8');
        return res.json({ text, readable: text.trim() !== '', warnings: [], pages: 0 });
      }
      res.json(extractPdfText(bytes));
    }),
  );

  /**
   * Turn a CV into records. Nothing is written: the answer is a list to look at,
   * each entry carrying the fragment of the document it came from, because this
   * is the one place a model writes something that later becomes evidence.
   */
  app.post(
    '/api/profile/import/draft',
    wrap(async (req, res) => {
      const text = String(req.body?.text ?? '').trim();
      if (text.length < 100) {
        throw new HttpError(
          400,
          'There is not enough text there to read. Paste the whole CV, or upload the file again.',
        );
      }

      const reply = await callModel({
        task: 'import-profile',
        system: importSystemPrompt({ evidenceTags: evidenceTags() }),
        messages: [{ role: 'user', content: importUserMessage(text) }],
      });

      const drafted = normaliseImport(reply.data, {
        existingIds: evidenceIds,
        evidenceTags: evidenceTags(),
      });
      if (drafted.records.length === 0) {
        throw new HttpError(
          422,
          'Nothing in that document could be read as a job, a degree or a project. If it is a ' +
            'covering letter or a list of referees rather than a CV, try the CV instead.',
        );
      }
      res.json(drafted);
    }),
  );

  /**
   * Write the records that were kept. One request rather than one per record, so
   * a twenty-record import is one atomic edit of the file and cannot land
   * half-finished.
   */
  app.post(
    '/api/profile/import/apply',
    wrap((req, res) => {
      const incoming = Array.isArray(req.body?.records) ? req.body.records : [];
      if (incoming.length === 0) throw new HttpError(400, 'No records were chosen.');

      let text = readProfileText(paths.masterProfile);
      const added = [];
      const skipped = [];
      for (const record of incoming) {
        try {
          text = upsertRecord(text, record);
          added.push(record.id);
        } catch (err) {
          skipped.push({ id: record?.id ?? null, problem: err.message });
        }
      }

      if (added.length > 0) writeRecords(text, { type: 'profile-imported', count: added.length });
      res.json({ added, skipped, count: evidence.length, profileError });
    }),
  );

  /**
   * Tighten the wording of every record. Suggestions only, and every one is
   * checked in code first: a rewrite that has acquired a figure the record does
   * not contain is rejected before you ever see it as an option.
   */
  app.post(
    '/api/profile/polish',
    wrap(async (req, res) => {
      if (evidence.length === 0) {
        throw new HttpError(400, 'There is nothing in your profile to tighten yet.');
      }
      const reply = await callModel({
        task: 'polish-profile',
        system: polishSystemPrompt(),
        messages: [{ role: 'user', content: polishUserMessage(evidence) }],
      });
      res.json(checkPolish(reply.data, evidence));
    }),
  );

  /** Accept some rewrites. Same shape as the import apply, and the same reason. */
  app.post(
    '/api/profile/polish/apply',
    wrap((req, res) => {
      const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
      if (changes.length === 0) throw new HttpError(400, 'No rewrites were accepted.');

      const byId = new Map(evidence.map((record) => [record.id, record]));
      let text = readProfileText(paths.masterProfile);
      const applied = [];
      const skipped = [];

      for (const change of changes) {
        const record = byId.get(String(change?.id ?? ''));
        if (!record) {
          skipped.push({ id: change?.id ?? null, problem: 'That record no longer exists.' });
          continue;
        }
        try {
          text = upsertRecord(text, { ...record, body: String(change.body ?? record.body) }, { originalId: record.id });
          applied.push(record.id);
        } catch (err) {
          skipped.push({ id: record.id, problem: err.message });
        }
      }

      if (applied.length > 0) writeRecords(text, { type: 'profile-polished', count: applied.length });
      res.json({ applied, skipped, count: evidence.length, profileError });
    }),
  );

  /** One CV profile in full, for the editor. */
  app.get(
    '/api/profiles/:id',
    wrap((req, res) => {
      const config = getProfile(req.params.id, { dir: profilesDir });
      if (!config) throw new HttpError(404, `There is no CV profile called "${req.params.id}".`);
      res.json({
        profile: config,
        prompt: readProfilePrompt(req.params.id, { promptDir: profilePromptsDir }),
        sections: [...SECTION_CATALOGUE],
        registers: REGISTERS,
        evidenceTags: evidenceTags(),
      });
    }),
  );

  app.put(
    '/api/profiles/:id',
    wrap((req, res) => {
      if (!getProfile(req.params.id, { dir: profilesDir })) {
        throw new HttpError(404, `There is no CV profile called "${req.params.id}".`);
      }
      const config = { ...(req.body?.profile ?? {}), id: req.params.id };
      const promptMarkdown = String(req.body?.prompt ?? '');
      const problems = checkProfile({ config, promptMarkdown, evidenceTags: evidenceTags() });
      if (problems.length > 0) throw new HttpError(400, problems.join(' '), { problems });

      saveProfile({ config, promptMarkdown, dir: profilesDir, promptDir: profilePromptsDir, evidenceTags: evidenceTags() });
      logEvent(dataDir, { type: 'profile-edited', profile: config.id });
      res.json({ profile: config, profiles: profileSummaries({ dir: profilesDir }) });
    }),
  );

  app.delete(
    '/api/profiles/:id',
    wrap((req, res) => {
      if (req.params.id === FALLBACK_PROFILE) {
        throw new HttpError(
          400,
          `"${FALLBACK_PROFILE}" cannot be deleted — it is where a job lands when nothing else fits.`,
        );
      }
      if (!deleteProfile(req.params.id, { dir: profilesDir, promptDir: profilePromptsDir })) {
        throw new HttpError(404, `There is no CV profile called "${req.params.id}".`);
      }
      logEvent(dataDir, { type: 'profile-deleted', profile: req.params.id });
      res.json({ deleted: req.params.id, profiles: profileSummaries({ dir: profilesDir }) });
    }),
  );

  // --- print -----------------------------------------------------------------

  app.get(
    '/print/:jobId/:kind',
    wrap((req, res) => {
      const kind = req.params.kind;
      if (!ARTIFACT_KINDS.includes(kind)) throw new HttpError(404, `There is no document kind "${kind}".`);
      const job = mustFindJob(req.params.jobId);
      const saved = docsStore.readDoc(dataDir, job.id, kind);
      if (saved === null) {
        throw new HttpError(404, `No ${kind} has been generated for this job yet.`);
      }
      const markdown = kind === 'cv' ? withPublications(saved, job) : saved;
      res.type('html').send(printPage({ markdown, kind, job, profileMeta }));
    }),
  );

  // --- errors ----------------------------------------------------------------

  // A request for a route this server does not have almost always means the page
  // in the browser is newer than the process answering it — you pulled while
  // `npm start` was still running. Saying so is the difference between a
  // thirty-second fix and an hour.
  app.use('/api', (req, res) => {
    const route = `${req.method} /api${req.path}`;
    logError(`  [${route}] 404 — no such route. Is this server older than the page? Restart it.`);
    res.status(404).json({
      error: `This server has no route ${route}. That usually means the app was updated while the ` +
        'server was running: stop it with Ctrl+C in its terminal, run `npm start` again, then reload this page.',
      type: 'not-found',
      stale: true,
    });
  });

  // Every failed request says so in the terminal, whatever its status.
  //
  // Only 5xx used to be logged, which meant a request that failed with a 400 or
  // a 404 produced an error in the browser and complete silence where you were
  // looking. "It doesn't work and there's nothing in the terminal" is not a
  // report anyone can act on, and it was the app's fault that it was the only
  // report available.
  app.use((err, req, res, _next) => {
    const say = (status, message) =>
      logError(`  [${req.method} ${req.originalUrl}] ${status} — ${message}`);

    if (err instanceof LlmError) {
      const status = HTTP_FOR_LLM_ERROR[err.type] ?? 502;
      say(status, `${err.type}: ${err.message}`);
      res.status(status).json({
        error: err.message, // already written in plain language by the LLM layer
        type: err.type,
        hint: LLM_HINTS[err.type] ?? 'Try again.',
        task: err.task ?? null,
      });
      return;
    }
    const status = err.status ?? 500;
    say(status, err.message ?? 'no message');
    // A 500 is a bug in this app rather than a refused request, so it also gets
    // the stack — that is the line that says which file to open.
    if (status >= 500) logError(err);
    res.status(status).json({
      error: err.message ?? 'Something went wrong.',
      type: err.needs ? `needs-${err.needs}` : 'app-error',
      // Carried through when set, so a failed PDF compile can show the actual
      // LaTeX error instead of "something went wrong".
      ...(err.reason ? { reason: err.reason } : {}),
      ...(err.detail ? { detail: err.detail } : {}),
      // The per-line parse errors from a refused profile save. These were being
      // dropped here AND in client/api.js, so a refused save said only "this
      // would not parse" — true, and useless, when the list of which lines are
      // wrong is the whole reason to refuse rather than save.
      ...(Array.isArray(err.problems) ? { problems: err.problems } : {}),
    });
  });

  return app;
}

/**
 * How long a chat message can take before the server gives up on it.
 *
 * Read live rather than at startup, because LLM_TIMEOUT_MS in .env overrides
 * the registry and the whole point is to report the number that will actually
 * apply.
 */
function reviseDeadlineMs() {
  try {
    return configFor('revise-doc', resolveProvider()).timeoutMs ?? null;
  } catch {
    return null;
  }
}

/** Overqualification levels, in order. `none` is the default and says nothing. */
export const OVERQUALIFICATION_LEVELS = ['none', 'somewhat', 'clearly'];

/**
 * The overqualification signal, made safe to render.
 *
 * A model that omits the field, or invents a level, must not put a claim on the
 * screen that nothing behind it supports — so anything unrecognised becomes
 * `none`, which the UI draws as nothing at all.
 */
export function normaliseOverqualification(raw) {
  const level = OVERQUALIFICATION_LEVELS.includes(raw?.level) ? raw.level : 'none';
  const note = String(raw?.note ?? '').trim();
  return { level, note: level === 'none' ? '' : note };
}

/**
 * Why a PDF did not appear, in one sentence, with the next move. Each case has
 * a different next move, which is the whole reason they are separate messages:
 * "export failed" would leave you with nowhere to go.
 */
function pdfFailureMessage(result, detail) {
  if (result.reason === 'no-engine') {
    return `${detail} The .tex file is ready either way — download that and put it on overleaf.com, which needs nothing installed.`;
  }
  if (result.reason === 'timeout') {
    return `${detail} The .tex file is still there; try running pdflatex on it yourself to see what it is waiting for.`;
  }
  if (result.reason === 'no-source') {
    return `The LaTeX source was not written, so there was nothing to compile. ${detail ?? ''}`.trim();
  }
  return `${result.engine ?? 'LaTeX'} could not compile the document. This is the error it gave:\n\n${detail || '(no error text)'}`;
}

/**
 * A refused profile, said in one message. Every problem is listed rather than
 * only the first, because the alternative is drafting again to find the next
 * one — and each draft is a model call you pay for.
 */
function draftRejection(problems) {
  const one = problems.length === 1;
  return [
    one
      ? 'That profile cannot be used as it stands:'
      : `That profile cannot be used as it stands (${problems.length} problems):`,
    ...problems.map((problem) => `• ${problem}`),
    one ? '' : '',
    'Nothing was saved. Try describing the profile again, with a bit more about what should lead.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

// --- error mapping ----------------------------------------

const HTTP_FOR_LLM_ERROR = {
  auth: 401,
  'rate-limit': 429,
  network: 503,
  'schema-mismatch': 502,
  refusal: 422,
  truncated: 502,
  'provider-error': 502,
};

const LLM_HINTS = {
  auth: 'Open the .env file in the project folder and paste your API key after ANTHROPIC_API_KEY= (no quotes). Save it, then stop and restart the server.',
  'rate-limit': 'The provider is asking us to slow down. Wait a minute and press the button again — nothing was saved, so nothing is lost.',
  network: 'Check your internet connection, then press the button again.',
  'schema-mismatch': 'The model answered in the wrong shape twice. Press the button again; if it keeps happening, this step\'s prompt or schema needs a look.',
  refusal: 'The model declined this request. Check the pasted advertisement for anything that might have tripped a safety filter, then try again.',
  truncated: 'The answer was cut off at its length limit. Try again; if it keeps happening, raise maxTokens for this task in server/llm/registry.js.',
  'provider-error': 'This one is on the provider, not on you. Wait a few minutes and try again.',
};

// --- print rendering ---------------------------------------------------------

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const slug = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DOC_LABEL = { cv: 'CV', 'cover-letter': 'Cover-Letter', criteria: 'Selection-Criteria', 'cold-email': 'Email' };

/**
 * `Rosa-Kimani-CV-Acme.pdf` — shown on screen, hidden in print,
 * and reused as the download name for the `.tex`. `slug` is what sanitises the
 * company, so a name full of punctuation cannot escape into the filename or the
 * content-disposition header.
 */
export function suggestedFilename({ profileMeta, kind, job, ext = 'pdf' }) {
  const person = slug(profileMeta?.name)
    .split('-')
    .filter((part) => part.length > 1)
    .join('-');
  const company = slug(job?.parsed?.company) || 'Role';
  return `${person}-${DOC_LABEL[kind] ?? kind}-${company}.${ext}`;
}

/**
 * The evidence tags behind the requirements the scorer said you actually matched.
 * They go in the PDF keyword field: what this application is really about, in
 * your own vocabulary rather than the advertisement's. Empty until it is scored.
 */
export function matchedTags(job, evidence = []) {
  const byId = new Map(evidence.map((record) => [record.id, record]));
  return (job?.fit?.matched ?? [])
    .flatMap((match) => match?.evidence_ids ?? [])
    .flatMap((id) => byId.get(id)?.tags ?? []);
}

/**
 * Single column, no tables, no text boxes: an ATS parser reads document order,
 * and your old multi-column CVs scrambled into nonsense (diagnosed defect #5).
 */
export function printPage({ markdown, kind, job, profileMeta }) {
  const filename = suggestedFilename({ profileMeta, kind, job });
  const title = `${DOC_LABEL[kind] ?? kind} — ${job?.parsed?.company ?? 'job'}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/print/print.css">
</head>
<body>
<p class="screen-only">Print this page (Ctrl+P) and choose <strong>Save as PDF</strong>. Suggested file name: <strong>${escapeHtml(filename)}</strong></p>
<main class="document">
${marked.parse(markdown)}
</main>
</body>
</html>
`;
}

/** A publication as the app will actually print it, plus anything it could not read. */
function renderCitation(record, surname) {
  const citation = parseCitation(record, { surname });
  return { apa: apa(citation), status: citation.status, problems: citation.problems };
}

function scoreRecordText(record) {
  return [
    `### ${record.id} (${record.kind})`,
    `${record.title ?? ''} — ${record.org ?? ''}`,
    String(record.body ?? '').trim(),
  ].join('\n');
}

/** Today, formatted for a letter. An input to assembly, never read inside it. */
function today(now = new Date()) {
  return now.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// --- startup -----------------------------------------------------------------

/**
 * Everything that must be true before the server is worth starting, said out
 * loud. An unparseable profile is fatal; a missing API key is
 * NOT — it only matters when a model route is hit, and you should be able to read
 * the board without one.
 */
export function startup({ log = console } = {}) {
  const envFile = path.join(REPO_ROOT, '.env');
  try {
    // Node reads .env itself since 20.12; no dotenv dependency (D010).
    if (fs.existsSync(envFile)) {
      // Windows text editors like to prepend a byte-order mark, which turns the
      // first line's name into "﻿LLM_PROVIDER" — so that setting silently
      // does nothing and you end up on the wrong provider wondering why. Node's
      // loadEnvFile does not strip it, so handle that file ourselves.
      const raw = fs.readFileSync(envFile, 'utf8');
      if (raw.charCodeAt(0) === 0xfeff) {
        log.warn(
          '\nYour .env starts with a byte-order mark (a Windows editor added it).\n' +
            "  Reading it anyway, but save the file as \"UTF-8\" rather than\n" +
            '  "UTF-8 with BOM" to silence this.\n',
        );
        for (const line of raw.slice(1).split(/\r?\n/)) {
          const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
          if (!match) continue; // blank line or a # comment
          const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
          if (process.env[match[1]] === undefined) process.env[match[1]] = value;
        }
      } else {
        process.loadEnvFile(envFile);
      }
    }
  } catch (err) {
    log.warn(`Could not read .env (${err.message}). Environment variables still work.`);
  }

  // Create the person's own folder if this is a first run, or copy an older
  // in-repo profile/ across if this clone predates the split. Neither is
  // something to ask about: there is nothing else the app could sensibly do, and
  // a prompt on first start is a prompt in front of somebody who has not yet
  // been told what the app is.
  const { migratedFrom } = ensureUserData({ dataDir: DEFAULT_DATA_DIR });
  if (migratedFrom) {
    log.warn(
      `\nYour profile has been copied from ${migratedFrom} into data/profile/.\n` +
        '  That folder is gitignored, so your personal details are no longer tracked by git.\n' +
        '  The originals were left where they are — delete them once you are happy.\n',
    );
  }

  const paths = userPaths(DEFAULT_DATA_DIR);
  const profileMeta = readJson(paths.profileMeta, blankProfileMeta());

  let evidence;
  try {
    evidence = loadEvidence(paths.masterProfile, { allowedTags: profileMeta?.evidenceTags ?? null });
  } catch (err) {
    log.error('\ndata/profile/master-profile.md could not be parsed, so nothing else can be trusted:\n');
    log.error(err.message);
    log.error('\nFix the line named above and start the server again.');
    log.error('If more than one thing is wrong, `npm run doctor` lists them all at once.\n');
    process.exit(1);
  }

  // A brand-new profile is empty, and saying "FILL-ME" at somebody who has not
  // opened the app yet is noise. The welcome screen is where that conversation
  // belongs, so only warn once there is something half-finished to warn about.
  const contact = contactBlock(profileMeta, {});
  if (evidence.length > 0 && contact.needsAttention.length > 0) {
    log.warn(
      `\n!!! Your contact details are missing: ${contact.needsAttention.join(', ')}.\n` +
        '    Documents will generate, but they will carry "FILL-ME" where those details belong.\n' +
        '    Fill them in under Settings before you send anything to a human.\n',
    );
  }

  let provider = null;
  try {
    provider = resolveProvider();
    if (!process.env[PROVIDERS[provider].apiKeyEnvVar]) {
      log.warn(
        `Note: no ${PROVIDERS[provider].apiKeyEnvVar} is set. The board and the editor work fine;\n` +
          '      Parse, Score and Generate will fail with a message telling you the same thing.\n' +
          '      `npm run doctor` checks this and everything else in one go.\n',
      );
    }
  } catch (err) {
    log.warn(err.message);
  }

  return { evidence, profileMeta, provider };
}

/**
 * If this process is going to die, it says so first.
 *
 * Node's default for an uncaught exception is a stack trace and exit — which is
 * fine when someone is watching the terminal, and useless when the first sign
 * of trouble is the browser saying "could not reach the local server" with, as
 * reported, nothing in the terminal at all. An unhandled rejection is worse: it
 * also exits, and the reason can be a bare value with no stack.
 *
 * So both are caught, both explain themselves in the same shape as every other
 * message here, and both still exit — a server in an unknown state after an
 * uncaught throw is not one to keep writing your CV with.
 */
function installCrashHandlers({ log = console, exit = process.exit } = {}) {
  const die = (label, cause) => {
    log.error(`\n!!! The server stopped: ${label}.\n`);
    log.error(cause instanceof Error ? cause.stack ?? cause.message : String(cause));
    log.error('\n    Nothing you had is lost — jobs and drafts are on disk under data/.');
    log.error('    Start it again with `npm start`, and send the lines above if it keeps happening.\n');
    exit(1);
  };

  process.on('uncaughtException', (err) => die('an unexpected error', err));
  process.on('unhandledRejection', (reason) => die('an unexpected error in a background task', reason));
}

function main() {
  startup();
  installCrashHandlers();
  // Deliberately NOT handed the startup copies: createApp watches the profile and
  // re-reads the contact details when they are edited in the app, and passing
  // fixed ones here would freeze both at boot.
  const app = createApp();
  const port = Number(process.env.PORT ?? 4477);

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`\njob_hunt is running. Open either of these:\n`);
    console.log(`    http://127.0.0.1:${port}`);
    console.log(`    http://localhost:${port}\n`);
    console.log('Only this machine can reach it. Leave this window open while');
    console.log('you use the app — closing it, or pressing Ctrl+C, stops the');
    console.log('server and the page will stop loading.\n');
  });

  // "localhost" resolves to the IPv6 address ::1 before 127.0.0.1 on Windows,
  // and a browser that gets there first would find nothing listening. Answer on
  // both loopback addresses so either URL works. Best effort: if the machine
  // has IPv6 switched off this fails harmlessly and 127.0.0.1 still serves.
  const ipv6 = app.listen(port, '::1');
  ipv6.on('error', () => {});
  server.on('close', () => ipv6.close());

  // Without this, a port clash exits with a stack trace that says EADDRINUSE and
  // nothing about what to do next.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port} is already being used by something else.`);
      console.error('That is usually this app already running in another window.');
      console.error(`Either close that window, or pick a different port by adding`);
      console.error(`a line to .env:    PORT=${port + 1}\n`);
    } else if (err.code === 'EACCES') {
      console.error(`\nWindows would not let this app use port ${port}.`);
      console.error(`Add a line to .env choosing a higher one, e.g.  PORT=8080\n`);
    } else {
      console.error(`\nThe server could not start: ${err.message}\n`);
    }
    process.exit(1);
  });
}

// Was this file run directly (npm start), or imported by a test? Comparing
// paths naively breaks on Windows, where argv[1] and import.meta.url can differ
// in drive-letter case and separators — and the symptom is the worst kind:
// `npm start` prints nothing at all and exits 0, so it looks like it worked.
function isRunDirectly() {
  if (!process.argv[1]) return false;
  const normalise = (p) => {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  try {
    return normalise(process.argv[1]) === normalise(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isRunDirectly()) main();

export default createApp;
