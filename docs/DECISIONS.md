# DECISIONS

One entry per architectural choice, with the reasoning, so a choice is not
silently reversed later by somebody who only sees the code. Comments across the
tree cite these by number — `D007` in `workrights.js` means the entry below, not
a line number.

To change a decision, add a superseding entry that references the old one. Never
edit or delete history: the value of this file is that it says why something is
the way it is, including the things that turned out to be mistakes.

Format: `D### — title` / the problem / the decision / what it costs.

This app began as one person's, in a private repository. Entries that were
project history rather than architecture — file intakes, credit balances, one
provider's pricing on one day — are not carried over; what remains is what still
governs the code. Numbering is preserved so the citations in the source resolve.

---

## D001 — No build step in the frontend

**Problem**: a bundler is a second toolchain to install, keep working and debug,
and it puts the code you read at arm's length from the code that runs.

**Decision**: Preact + htm, vendored as plain ES modules in `client/vendor/` and
loaded straight by the browser through an import map. No JSX, no compile step, no
dev server beyond the app's own Express one. Components are genuinely needed —
the board, the editor, the checks panel — but the toolchain is not; htm gives
templates in ordinary tagged template strings.

**Cost**: no tree-shaking, no TypeScript, and a component file is a little more
verbose than JSX. Revisit if the client outgrows roughly fifteen components or
performance visibly suffers.

## D002 — Plain JSON files on disk, through one IO module

**Problem**: a database is an install risk (native modules fail on exactly the
machines least able to fix them), and it hides the data behind a client.

**Decision**: all state as JSON and JSONL under `data/`, touched only through
`server/store.js`, which strips a byte-order mark on read and writes atomically
via a temp file and a rename.

**Why those two details**: they are the failure modes JSON-on-disk actually has.
A BOM makes `JSON.parse` throw on a file that looks perfect in an editor, and a
non-atomic write truncates everything if the process dies mid-save.

**Cost**: no queries, no concurrent writers. Neither is wanted here — this is one
person's applications on one machine.

## D003 — Raw fetch for the model adapters, no provider SDKs

**Problem**: an SDK per provider is two more dependencies tracking somebody
else's churn, for a surface this app barely uses.

**Decision**: adapters call the HTTP APIs with Node's global `fetch`, taking
`fetchImpl` as an injected parameter so tests can hand them a canned response.

**Cost**: features that only exist in an SDK have to be hand-rolled. Revisit if
one is genuinely needed.

## D004 — `node:test` as the only test runner

**Problem**: every dependency is an install risk, and a test runner is a large
one.

**Decision**: `node --test` and `node:assert`, with ajv where a schema needs
asserting. No jest, no vitest.

**Cost**: no watch mode, no snapshot tooling. The suite runs in about four
seconds, which covers most of what a watch mode buys.

## D005 — PDF export is the browser's own print-to-PDF

**Problem**: a headless browser dependency downloads a Chromium onto the machine
of somebody who wanted a CV.

**Decision**: `/print/:jobId/:doc` renders print-ready HTML and you use the
browser's Save as PDF. The print stylesheet owns page breaks and heading orphans.
A LaTeX path exists alongside it for anyone who wants typeset output.

**Cost**: one more click than a Download button, and the exact output depends on
the browser. In exchange the preview is the export — they are the same page.

## D006 — Qualification status is structured data, never a text search

**Problem**: the validator once substring-matched "submitted" inside a record
that read "has NOT been submitted", and approved the very claim it exists to
forbid. A real CV went out with a false statement on it.

**Decision**: qualifications live as booleans in `profile-meta.json` —
`submitted: false`, `awarded: false`, plus the exact wordings that are allowed —
and rule R4 checks documents against those fields. Negation-window matching
survives only as a backstop for records with no structured status.

**Why it generalises**: the same reasoning moved publications out of the model's
hands (`server/profile/citation.js`) and keeps the keyword extractor from ever
proposing a term that would assert an unawarded qualification. Handling a bug
class by being cleverer about text is a losing game; making it impossible to
express is not.

**Cost**: you have to fill the booleans in. Settings does it for you, and a
qualification you never mention needs no entry at all.

## D007 — The contact block and the work-rights line are code, never model output

**Problem**: these are facts, and a paraphrased fact is a wrong fact. A model
asked to reproduce a phone number will sometimes produce a plausible one.

**Decision**: `server/generate/workrights.js` assembles the block from
`profile-meta.json`; the assembler injects it after generation; validator rule R7
errors if the document's version differs byte for byte from what the function
returned.

**Cost**: the model cannot adapt the header to the job, which is the point.

## D008 — A capped score says it was capped, and why

**Problem**: a tool that quietly rewrites its own output is one you stop being
able to reason about.

**Decision**: store `modelScore`, `cappedScore` and `capReason` separately, and
always show "the model said X, capped to Y because Z".

**Cost**: a busier panel. The cap value is tunable; the display rule is not.

## D009 — Append-only events from the first day

**Problem**: "how long until they replied" is the question that eventually tells
you whether any of this is working, and it cannot be answered retroactively.

**Decision**: every status change, generation, save and export appends a
timestamped line to `data/events.jsonl`. Board state is derived from the job
records; the events are the history beside them.

**Deletion does not touch it.** Removing an application moves the job record and
its drafts to the bin (D022) and leaves the event lines — so even an application
deleted for good leaves exactly the trace it should: that it happened, and when.

*This entry originally argued against a bin, on the grounds that a hidden pile of
dead applications is a screen you would eventually have to build. D022 supersedes
that and says why it was wrong.*

**Cost**: a file that only grows. It is a few hundred bytes per application.

## D010 — A runtime dependency budget of five packages

**Problem**: every package is an install risk and a supply-chain exposure, in a
repository whose whole job is to sit next to somebody's personal data.

**Decision**: `express`, `ajv`, `marked`, `preact`, `htm`. Adding a sixth needs an
entry in this file saying why.

**Cost**: some things are hand-written that a library would have done. That has
been the right trade every time so far — the PDF path (D005) is the clearest
example, and the PDF *reader* in `server/import/pdf-text.js` is the other: it
uses `node:zlib` and nothing else.

## D011 — A one-time project intake, now closed

The original repository was created empty, and this entry gated the work on
copying four files across from its predecessor. It is recorded only so the
numbering below stays faithful to the citations in the source. Nothing in the
code depends on it.

## D012 — Digits only, and no timezone claims unless you ask for them

**Problem**: two rules that look like polish and are not.

**Numbers are digits.** The validator once flagged number-words, and a draft
responded by deleting a claim that was TRUE — "one honest difference" is
rhetoric, not a figure. `server/profile/numbers.js` tokenises digit runs only,
and both the parser and the validator call it, because any disagreement between
them is a gap a fabricated figure walks through.

**Timezone overlap is off by default.** `timezoneOverlapClaims` in
`profile-meta.json` starts false. Advertising your current working hours anchors a
reader to where you are now, which is wrong if you would relocate — and it is the
kind of claim that reads as helpful while quietly narrowing what you are offered.

**Cost**: a genuinely useful overlap line has to be switched on deliberately.

## D013 — A document may never claim an unawarded qualification

**Problem**: this is the rule the whole honesty checker exists to enforce, and it
is the one that was broken in production (D006). It is not negotiable and it is
not configurable.

**Decision**: `prompts/integrity.md` is canonical for what the model is told, and
the R4 check reads the structured booleans rather than the prose. The two are
built from the same source — `server/generate/integrity.js` — so the prompt and
the checker cannot drift apart.

**Why false-credential claims are not in `banned.json`**: that file is a list of
clichés, and it is config anybody may extend. A credential check depends on your
name and on what your profile says you hold, so R4 builds it from your own data
instead of from a fixed list of strings.

---

The entries below cover the work of generalising this app so somebody other than
its author can run it.

## D014 — One person's facts leave the source, so the app can be shared

**Problem**: the person it was written for was written into it. A surname
constant decided first authorship in the citation parser, two regexes in the
validator watched for that name in front of "Dr", two prompts named them, and
the work-rights module held four hardcoded lines naming one city and one
citizenship.

None of that is merely inert in somebody else's copy — it is actively wrong. It
decides a stranger is not first author on their own paper, fails to notice a
false "Dr" in front of the name they actually have, and prints one person's
citizenship on another's CV.

**Decision**: everything about a person is read from `data/profile/profile-meta.json`
through `server/profile/identity.js`. `server/profile/identity.test.js` reads
every tracked file and fails if a personal fact appears anywhere in the
repository, if anything under `data/` is tracked, or if the ignore rule that
keeps it untracked is unanchored.

**The rule for anything added from here on**: if it is a fact about a person, it
goes in their profile file, and code may only ask `identity.js` what that file
says.

**Where there is no answer, there is no claim.** A profile with no name produces
no honorific pattern, so no "Dr" is flagged; no surname means first authorship is
false rather than guessed; no work-rights data means the header has three lines
rather than a fourth asserting a nationality nobody wrote down. Silence beats a
default, because the default is somebody else's fact.

## D015 — The work-rights line names the visa route, from a table you own

**Problem**: the header said "open to relocation" for every country. An employer
advertising in the US reads that as "will need sponsorship" and stops — while an
Australian applying there is eligible for the E-3, which is not an H-1B, has no
lottery, and costs the employer a one-page filing rather than a petition. The
single most useful sentence in the application was missing because the table had
nowhere to put it.

**Decision**: `workRights.byCountry` in `profile-meta.json`, one entry per
country, each able to carry a `relocation` phrase and a `visa` clause — or a
whole `line` for where the composition reads wrongly in some convention. Composed
in code, printed verbatim, checked by R7 like the rest of the contact block. A
country with no entry gets the general relocation phrase; deleting the table gets
that everywhere, which is the safe default.

**The app asserts no immigration facts.** Every phrase is copied from your profile
onto your CV, so it is your statement about yourself in your own words. Schemes
have age limits and rules change, and nothing here checks any of it — which is
why the Settings editor says so on the screen where the routes are edited, and
why the example routes belong to a fictional person.

## D016 — The advertisement's terms are extracted in code, and measured

**Problem**: most applications are term-matched before a person opens them. A CV
describing the right work in its own vocabulary — "measurement instruments" for
an ad that says "evaluations" — scores zero on the term that mattered. The model
was already given the parsed ad, but as a JSON blob, where words sit as data.

**Decision**: `server/generate/keywords.js` extracts the ad's terms from its
must-have requirements, responsibilities, skills and vocabulary; ranks them by
where they came from; hands them to the generator as an explicit list; and then
measures the saved draft with the same list, so the screen and the prompt cannot
drift apart.

**The constraint is the feature.** The prompt says unmissably that this changes
WORDING and never CLAIMS: no term for work not done, no "key skills" block to
hold terms that fit nowhere real, no stretching a record to reach a word. A term
with no honest home is meant to stay missing and be reported. Keyword stuffing
works on the machine and fails on the human who opens the file next, and that
human is the one who decides.

**Phrases must appear whole to count.** "Item response theory" matched by a
document containing those three words in three unrelated bullets would be a
coverage number that means nothing, and a number that means nothing is worse than
no number at all.

## D017 — Ticking a publication stops writing to the draft

**Problem**: it rewrote the saved CV and stored a new version. Mid-edit that
rebuilt the document from the last SAVED text and silently discarded whatever was
in the editor. The tick was visible; the loss was not — you find out later, by
noticing work missing that you never saw go.

**Decision**: nothing on disk changes when a box is ticked. The selection is
recorded, the next generation uses it, and the citations are inserted at RENDER
time — the print view, the `.tex` and the PDF each call `withPublications` on the
way out. Nothing to overwrite, so nothing can be lost.

**Cost**: the editor no longer shows the current selection. Accepted — the panel
says what will be added, the print view is one click away, and a draft that is
exactly what you typed is worth more than one that previews itself.

## D018 — A truncation is a measurement, not a verdict

**Problem**: "the reply was cut off — raise `MAX_TOKENS_GEMINI_GENERATE_CV` in
.env and restart" is a correct explanation and the wrong behaviour. The app knew
what had gone wrong and what would fix it, and stopped to ask permission —
mid-application, after you had already waited, having saved nothing.

**Decision**: `server/llm/headroom.js`. On a truncation the ceiling doubles and
the call is repeated, up to twice, capped at 131,072 tokens (raise it with
`MAX_TOKENS_CEILING`).

**Why bounded**: each growth costs a whole second call, and on Gemini the model's
own reasoning is charged against the same budget — so a task that genuinely
cannot fit would otherwise double its bill on every attempt.

**Why capped**: a `max_tokens` above the model's real limit is a 400, which would
turn a recoverable problem into an unrecoverable one.

The message that survives all that no longer suggests raising a ceiling that has
already been raised twice.

## D019 — Generation returns before it finishes, so applications go in parallel

**Problem**: the request was held open for the forty to ninety seconds the model
took. Applying for three jobs meant doing them strictly one after another.

**Decision**: `POST /generate/:kind` starts the run and answers 202. The work
carries on in the process, and the progress record — which already existed, and
which the browser already polled — becomes the only thing listening, so a failure
is recorded there rather than thrown into a request nobody is holding.

Three consequences worth stating:

- **The screen polls the SERVER's run, not a local busy flag.** That is what makes
  a generation survive navigating away, and what lets a freshly-opened job screen
  say "still writing" about work it did not start.
- **A second run of the same document is refused with a 409.** Both would save,
  and the loser's version would sit in the history looking like a draft you had
  asked for.
- **The run registry belongs to the app, not the module.** It was a module-level
  Map, which is identical while one server runs and wrong the moment two exist in
  one process — which is every test file.

Nothing about this costs money: two model calls in flight cost exactly what two
sequential ones cost.

## D020 — You can say what you want before it is written

**Problem**: the only way to steer a draft was to read it first. "Mention my E-3
eligibility in the header" meant generate, read, open the chat, ask, wait again —
two model calls and a rewrite to get what one call would have produced if it had
simply been told.

**Decision**: a per-job notes field, placed FIRST in the user message, before the
advertisement and before the records — because a model reading a long prompt
weights the top of it, and this is the only part of the brief you wrote yourself.

**It steers, it cannot license.** The prompt says your words govern emphasis,
ordering, length, tone and omission — your call, already made — and that a request
for a fact no record supports gets the closest honest thing plus an entry in
`gaps`. The integrity layer still wins, as it must.

## D021 — The skills section answers the list it was given

**Problem**: the technical section was grouped the way the writer thinks —
Analysis, Tooling, Domain — while the reader is checking it against the list they
wrote, in the order they wrote it. That makes the reader do the matching.

**Decision**: the ad's skills go into the CV prompt numbered, in the ad's order,
with the instruction to lead with what was asked for and to use the ad's word for
it. A skill with no record behind it is LEFT OUT — not softened, not implied by a
neighbour, not written as "familiar with" — and the checks report it as a gap,
which is a true and useful thing to see before applying. A line claiming it is
neither.

## D022 — Delete moves to a bin; only the bin destroys anything

**Problem**: Delete removed a job, every draft version, the chat and the exports,
permanently, behind a two-click confirmation. D009's note argued against an
archive on the grounds that a hidden pile of dead applications is a screen you
eventually have to build.

That reasoning was about clutter. The risk is a mis-aimed click destroying a day
of writing, in an app whose entire purpose is not losing your work. A confirmation
is a speed bump, not a safety net — confirmations get clicked.

**Decision**: Delete moves the job and its drafts to `data/trash/`. A bin screen
lists what is in there with Restore, and permanent deletion lives there as a
separate act, still armed before it fires. Restore puts the application back in
the lane it was in with every version intact.

**What the tests are for**: a bin that loses the drafts is worse than no bin,
because it looks safe. One test restores an edited draft and compares it byte for
byte, including the version history.

**Cost**: the screen D009 said we would have to build. It took an afternoon, which
was the wrong thing to weigh against somebody's work.

## D023 — The model scores out of 20, and the app multiplies by five

**Problem**: asked for a number out of 100, a model drifts. Most of the hundred
choices mean nothing to it, so it grades against an imagined perfect applicant and
lands almost everything in the low forties — which makes the number useless for
the one thing it is for, deciding whether to spend a day on an application.

**Decision**: the prompt asks for a whole number 0–20. `server/score/cap.js`
multiplies by five at the boundary, so the cap, the verdict bands, every score
already on disk and the screen all keep working in 0–100.

**The guard that matters**: a model that ignores the instruction and answers 85
must not have that read as 85/20 and inflated to 100 — every score would sit at
the ceiling and the cap would be the only thing still working. Anything above 20
is read as already being out of 100.

**Found while writing this**: the prompt described five bands against four
verdicts, so a 4 the prompt called "a stretch" was scored skip. The bands are now
VERDICT_BANDS divided by five, and a test fails if they drift apart again.

## D024 — A recruiter's read of the DOCUMENT, not the profile

**Problem**: every judgement in the app was made against your records. The fit
score (D008) answers "is this worth applying for" before a draft exists, and says
nothing about whether the CV you ended up with does you justice. A draft can be
honest, fully cited, pass every check in `server/validate/`, and still bury the
one thing this employer cares about on page two.

**Decision**: `server/generate/recruiter.js`. A model plays the screener for this
specific role, reads the SAVED draft against the advertisement, and says what it
would do with it. It suggests two kinds of change: a term the ad uses that a
record supports, and a record the application should be drawing on and is not.

**Both kinds are verified in code before they are shown**, the same discipline as
`import/polish.js` and for the same reason. A suggestion is thrown away when the
term is not one the advertisement used, when the record id does not exist, or when
the document already has it. Rejections are shown with their reason rather than
filtered silently — a review that quietly invented a qualification to "work in"
would walk straight around the only thing this app is for.

**What is inferred, and admitted as such**: which records a draft already uses.
A saved version stores the markdown and which records were OFFERED, not which were
cited, and the ids are stripped out because a reader should never see them. So it
matches record titles against the text, strictly — a missed match costs a
redundant suggestion, a wrong match would silently hide a real one.

**A stale review is shown, not hidden.** Knowing the verdict was about version 2
is useful; presenting it as a judgement on version 4 is not.

## D025 — The fonts are in the repository, twice

**Problem**: the UI redesign loaded Inter and Outfit from `fonts.googleapis.com`.
That sent Google a request on every launch, carrying the user's IP and — through
the Referer header — the fact that they were using this app. The first screen says
nothing about you leaves your machine. It also meant no webfonts offline, which is
exactly when somebody on a train works on applications.

**Decision**: the four woff2 files live in `client/vendor/fonts/`. Both families
are variable fonts, so one file covers every weight rather than one per weight —
176KB in total, which is what makes this cheap enough to do at all. Both are under
the SIL Open Font License, which permits redistribution; `OFL.txt` sits beside
them.

**Why they are duplicated into `docs/fonts/`**: GitHub Pages serves only `docs/`,
so the landing page cannot reach into `client/`, and a symlink is not reliably
followed. 176KB duplicated is cheaper than a page arguing for this app's privacy
while fetching a stylesheet from a third party.

**Verified by**: loading the app with every non-localhost request blocked in a
real browser. Zero external requests attempted, both faces loaded across 100–900.
That check is the one worth repeating if anybody adds an asset — a `<link>` to
somewhere else is a one-line change that quietly makes the app's central claim
false.

**Cost**: two copies of four binary files, and a note in `docs/fonts/README.md`
saying to replace both.

## D026 — Every GET route is exercised by a test

**Problem**: `/api/profile/records` returned a 500 for days. A refactor moved
surname handling into `identity.js` and removed the `surnameFrom` import from
`index.js` while leaving the call. The entire Profile screen was dead — it showed
"Loading your profile…" for ever — and the suite was green through all of it,
because no test had ever asked that route for anything. It shipped to a public
repository in that state.

**Decision**: one test walks every `app.get` the source declares, calls it with
real ids, and fails on any 5xx. It asserts almost nothing about the bodies; other
tests do that. Its only job is that a route cannot be dead while the suite passes.

**The one exception, pinned rather than excluded**: the PDF route answers 501 when
no LaTeX engine is installed, which is a correct and useful answer. A second test
asserts that it is a 501 naming the install command, so the allowance cannot widen
into a hole.

**What this does not catch**: a route that returns 200 with the wrong body. That
is what the other tests are for. But "throws on every request" is the cheapest
possible bug to catch and the most embarrassing to ship.

## D027 — An error the server bothered to explain reaches the screen intact

**Problem**: refusing to save a profile that does not parse is right — the app
keeps working from the last good version. It listed exactly which lines were wrong
and why. None of that reached the user: the error middleware forwarded `reason`
and `detail` but not `problems`, and `client/api.js` rebuilt the error from a fixed
three fields, dropping anything else. So a refused save said "this would not
parse" and stopped, which is true and useless.

**Decision**: the middleware forwards `problems`, and `client/api.js` spreads the
whole response body onto the error before adding the fields every view relies on.
A field added to a response is now visible to the view without a second edit one
layer down.

**Cost**: an error object can carry more than a view expects, which is harmless.
The alternative cost was a whole diagnostic feature that silently did nothing.

## D028 — The master file is editable in the app, and it is not a code editor

**Problem**: the whole-file tab was called "Markdown" and was a bare textarea.
Somebody wanting to edit their master profile opened File Explorer instead — the
feature existed and did not read as existing.

**Decision**: the tab is called "The whole file". It has a line-number gutter, a
jump list built from the file's own headings, an unsaved-changes guard on both the
tab switch and the browser close, Ctrl+S, and Tab-inserts-spaces. The parse errors
name a line, so each one is a button that puts the caret there.

**What it deliberately is not**: a code editor. No highlighting, no autocomplete,
no dependency (D010). Line numbers and a jump list are what a long structured file
actually needs, and both are plain DOM.

**Editing here and editing in a text editor stay the same thing.** The file is
watched either way, which is the property that makes this a convenience rather
than a second source of truth.

## D029 — The chat asks by default, and only edits when you say so

**Problem**: one chat box did two jobs. "Why does the summary lead with the PhD?"
is a question; "cut this to one page" is an instruction; and the model decided
which it had been given. It guessed wrong often enough that people stopped using
the feature — the cost of a wrong guess is an hour of your own edits replaced by
a rewrite you did not ask for.

**Decision**: two modes, and the default is **Ask**.

The two failure modes are not symmetric. Being stuck in Ask costs one click.
Being unexpectedly in Edit costs a draft. So Ask is the default, an unrecognised
mode falls back to Ask, a request with no mode at all is Ask, and the mode resets
to Ask when you open a different document.

**It is enforced in code, not asked for in the prompt.** `normaliseRevision`
cannot return markdown in ask mode, whatever the model set `revised` to. The
prompt is told the mode as well, because a model that knows it cannot edit writes
a better answer than one that tries and is ignored — but that is the courtesy and
this is the guarantee.

**A dropped rewrite is said out loud.** If the model rewrites while you are only
asking, the reply still appears, with a note saying the draft was left alone and
that Edit is where to go. Silently discarding it would read as the app ignoring
you.

## D030 — Quoting a passage, and why the chat lives at the end of `<body>`

**Problem**: "is this bullet supported?" gave the model no way to know which
bullet. The answer was about the document in general.

**Decision**: whatever you have highlighted in the editor can be pinned above the
box. It reaches the model as a quoted block, ahead of the question, and it stays
on the turn afterwards so the transcript shows what was being discussed. The
selection is read by the component that owns the textarea and passed down as a
prop — the drawer reaching across the page for an element by id is how two
components get out of step the first time either one moves.

**The part worth remembering: `position: fixed` does not always mean "fixed to
the window".** Any ancestor with a transform, a filter or a backdrop-filter
becomes the containing block for its fixed descendants. This app had all three —
cards animate in, panels are frosted, and the page slides sideways to make room
for the drawer. The drawer measured 2,323px tall, starting 1,709px above the top
of the screen, because it was being sized against the card it happened to sit
inside.

Three things came out of that:

- `.animate-blur-in-up` fills `backwards`, not `both`. `both` keeps the last
  keyframe applied for good, and a filled transform computes as
  `matrix(1, 0, 0, 1, 0, 0)` — invisible, and still a containing block. Ending
  the keyframe on `none` does not help: the filled value is the interpolated one.
- The drawer renders through `client/views/portal.js`, straight into `<body>`.
  No stylesheet can fix this from inside, because the problem is where the
  element is, not how it is styled.
- The page only slides aside above 118rem. Below that it slid 15rem off the left
  edge of the window — clipped and unscrollable, with its right-hand side still
  under the drawer. The page is 88rem and the drawer 30rem, so 118rem is where
  there is genuinely room for both; under it, the drawer overlays with a scrim,
  which is honest about covering the page and can be dismissed by clicking it.

## D031 — A rewrite made in Ask is held, not binned

**Problem**: D029 threw away any rewrite made while you were only asking. That
was the wrong half of the fix. The model does not merely rewrite — it also
*reports*, in the past tense: "I have updated the Technical Skills bullet to
frame your expertise in terms more standard for a general data science
audience." Drop the document and keep the sentence, and the reply on screen
describes a version of your CV that does not exist. You paid for the call and
were handed a report about a phantom.

**Decision**: the rewrite comes back as a **proposal**. `markdown` is still null
in ask mode — the guarantee is unchanged and the document cannot be touched
without you — but the text is offered, in full, with a button that applies it
through the ordinary save path. Until you press it, the reply is preceded by a
correction: *it has written this as though the change were already made; it is
not.*

**And the prompt names the mistake.** The ASK section now forbids the past tense
explicitly and quotes the exact shape of it, because a general instruction not to
rewrite was not enough — the model complied with the letter (a proposal) while
describing it as done.

**Three places, not one.** The mode is enforced in `normaliseRevision`, defaulted
on the route, and checked again in the client before any markdown reaches the
editor. The third is not redundancy for its own sake: a server started before the
last pull answers `revised: true` for a question because it has never heard of
Ask. `/api/meta` now carries `chatModes: true`, and a page that does not see it
refuses to send in Ask mode and says why, rather than finding out on somebody's
CV.

## D032 — Your profile opens beside the draft, and stays open beside the chat

**Problem**: the question you have while reading a draft is "what have I got that
this leaves out?" Answering it meant leaving for the Profile screen or opening
`master-profile.md` in a text editor. Both lose your place, and neither lets you
see the two at once, which is the entire comparison.

**Decision**: a panel on the left, opposite the chat, and both can be open
together — records on one side, the model on the other, the draft between them.
Each record is marked according to whether this draft already uses it, and the
list filters to **Not used**, which is the view that answers the question.

**`used` comes from the server**, from `recordsUsedIn` — the same function behind
the recruiter's read — rather than a second heuristic in the client. Two rules
for "is this record in the CV" that disagree would be worse than either alone. It
is a POST because the input is the unsaved draft: you are checking what you can
see, not what last reached disk.

**It is not an editor.** Records have a screen already, with a form per kind and a
validator behind it. A second, half-implemented editor writing the same file is
how the two drift apart. This one reads, filters, and inserts a record's own
words at the end of the draft.

**The chat stops being modal while it is open.** Two panels that both dim the page
and both drag focus back inside themselves make each other unusable, so the chat
drops its scrim and its focus trap whenever the profile is beside it.

## D033 — What changed between two versions, in the space history already had

**Problem**: the version history could say a version existed, who wrote it and
when, and could show the whole document — but not the one thing you open it to
find out. Reading two hundred lines of CV twice and spotting the altered sentence
is not something anyone does, so in practice history was used for restoring and
nothing else.

**Decision**: a line diff, `+` and `−`, in the notation everybody already knows.

**Where it goes is the whole design.** The obvious version of this feature is a
new panel, and the job screen already carries a rail, an editor, the flags, the
advertisement's words and the recruiter's read. So the diff takes over the
editor's own space and only while you are **reading history** — a mode you
entered deliberately — behind a Changes / Full text switch in the bar that was
already there. Nothing new appears on the screen you spend your time on.

**Unchanged runs are collapsed** to `12 unchanged lines`, with three lines of
context either side. Without that, a two-page CV where one sentence moved shows
you 95% noise, which is the thing you opened the diff to see past. A gap of a
single line is shown rather than described, because the description is longer
than the line.

**Two comparisons, because there are two questions.** By default a version is
compared with the one before it — what did this change. One link switches to
comparing with the current draft, which is the question you have when you are
deciding whether to restore it.

**No dependency, and it is tested** (D010, D001). A line diff is common-prefix
trimming plus longest-common-subsequence, and `client/views/diff.js` has no
imports at all so `node --test` can load it directly, like the other pure client
modules. The tests that matter are the ones asserting both documents rebuild
exactly from what the diff claims — a diff that is subtly wrong is worse than
none, because you believe it and restore the wrong version.

**The sign carries the meaning, not the colour.** Colour is the fast read; `+`
and `−` are what survive printing, a colour-blind reader, and a screenshot pasted
into a document.
