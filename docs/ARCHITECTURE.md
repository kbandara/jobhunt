# How this is put together

Written for somebody about to change something. The README says what the app
does; this says why the code looks the way it does, and which parts will bite if
you change them without knowing.

## Shape

One Node process. Express serves a static client and a JSON API, bound to
`127.0.0.1` only — the machine holds a phone number, a citizenship and a full
employment record, and none of it should be reachable from the network.

```
server/
  index.js            every route; thin, the thinking lives in the modules
  user-data.js        where the person's own files are, and first-run creation
  store.js            all disk IO — BOM-safe reads, atomic writes
  env-file.js         reads and rewrites .env without losing anything else in it
  profile/            parse master-profile.md, edit it, render citations
  generate/           evidence selection, prompts, assembly, LaTeX, PDF
  validate/           the honesty checker (R1–R9)
  score/              the blocking-requirement cap
  llm/                one adapter per provider, a task→model registry, costs
                      headroom.js retries a truncated reply with more room
  import/             reading a CV into records, and the check behind the polish tool
  track/              jobs, documents, chat, the append-only event log
client/               no-build Preact + htm; every view a plain function
  vendor/fonts/       Inter and Outfit, self-hosted — nothing is fetched from
                      anywhere else at runtime (D025)
templates/            what a brand-new profile is created from
examples/             a made-up person's profile, and the tests' fixture
```

There is no build step and there is not going to be one (D001). The client
imports vendored ES modules directly; an import map in `index.html` wires the
bare `preact` specifier.

Anything pinned to the window — the chat drawer on the right, the profile panel
on the left, the chat's scrim — renders through `client/views/portal.js` into
`<body>`. `position: fixed` is measured against the nearest ancestor carrying a
transform, a filter or a backdrop-filter, and this app has all three, so a fixed
panel left where it sits in the tree is sized against a card rather than the
window (D030).

## The two files everything hangs off

**`data/profile/master-profile.md`** — the only source of truth about the person.
Parsed by `server/profile/parse.js`, a hand-rolled line scanner rather than a
markdown AST walk, precisely so every error can name a line number and say what
it expected. Parse failures are fatal *for the file*, never for the process: the
watcher in `profile/live.js` keeps the last version that parsed and reports the
error, because half-finished editing is the normal state of a file being edited.

**`data/profile/profile-meta.json`** — the facts the app injects as code and never
asks a model for: contact details, work rights, and the qualification statuses
the honesty checker treats as ground truth.

Both live under `data/`, which is gitignored. **The repository ships no personal
data at all.** That is load-bearing rather than tidy: the previous version kept
them in a tracked `profile/` folder, which made the repo unpublishable and put
every user one `git commit -a` away from publishing their employment history.

## Editing the profile without destroying it

`server/profile/edit.js` makes surgical edits. A record occupies a known span of
lines; adding, changing or deleting one rewrites only that span. The obvious
alternative — parse everything, write it all back — would silently strip the
preamble, the comments and whatever formatting its owner likes, on every edit,
forever. It is also what makes editing in the app and editing in a text editor
the same operation on the same file rather than two systems fighting over it.

## Editing the whole file

**Profile → The whole file** is a textarea with a line-number gutter and a jump
list built from the file's own `##` and `###` headings. Deliberately not a code
editor: no highlighting, no autocomplete, no dependency (D010).

Saving runs the parser first. If it would not parse, nothing is written and the
per-line errors come back — each one names a line, so the UI turns it into a
button that puts the caret there. *Save it anyway* exists because a half-finished
edit is a normal state; the app keeps using the last version that parsed, so
generation does not break while you are mid-thought.

Unsaved text is guarded twice: `beforeunload` for a tab close, and the tab list
itself for a click that would unmount the editor. `beforeunload` does not fire for
the second one.

## The honesty checker

`server/validate/validator.js`. Deterministic, makes no model calls, and
**surfaces** problems rather than silently correcting them. Rules R1–R9; the ones
worth knowing:

- **R2** — a number in a bullet that appears in none of the records that bullet
  cites. This is the rule the whole app exists for.
- **R4** — a claim that a qualification has been submitted or awarded, checked
  against the booleans in `profile-meta.json` and **never** against the prose of
  the profile. An earlier version did a substring check and read the sentence
  "has NOT been submitted" as permission to write "submitted" onto a real CV.
- **R7** — the contact block, checked byte-for-byte against what
  `generate/workrights.js` produced. A model is never asked to phrase it.

R4's credential patterns are built from the person's own name, because a profile
legitimately names supervisors and co-authors who really do hold doctorates, and
flagging a true statement about somebody else is how a checker loses its
authority. No name in profile-meta, no check.

## The work-rights line, and why it is a table

`generate/workrights.js` builds the last line of every CV header from
`profile-meta.json`, and validator R7 then checks the document against it byte for
byte. The part that earns a section here is `workRights.byCountry`.

"Open to relocation" is read by an employer advertising in the US as "will need
sponsorship", and they stop there — while an Australian applying to that same ad
is eligible for the E-3, which is not an H-1B, has no lottery, and costs them a
one-page filing. That sentence is the difference between being read and being
filtered, and it is only sayable if the table can hold a different one per
country. A country with no entry gets the general relocation phrase; delete
`byCountry` entirely and you get that everywhere, which is the safe default.

**Nothing here checks an immigration fact, and nothing here asserts one.** Every
phrase is copied verbatim from the profile onto the CV, so it is the owner's
statement about themselves in their own words. Schemes have age limits and the
rules change. The Settings editor says so on the screen where the routes live,
and the routes in `examples/` belong to a person who does not exist.

A remote role skips the table entirely: there is no visa question, so raising one
would invent a problem the reader did not have.

## Keywords from the advertisement

`generate/keywords.js` extracts the terms an applicant tracking system is likely
matching on — from the must-have requirements, the responsibilities, the skills
array and the ad's own vocabulary — and weights each by where it came from, so a
must-have outranks a nice-to-have. The same list does two jobs: it goes into the
generation prompt, and it measures the saved draft for the panel on the job
screen. One source, so the screen and the document cannot disagree.

Three constraints are the whole design:

- A term that would assert a qualification `profile-meta.json` says is not held is
  dropped before the list is built.
- A phrase counts only when its words appear together, in order. Matching "item
  response theory" against a document with those three words in three unrelated
  bullets would be a coverage number that means nothing.
- The prompt says the list changes **wording, never claims** — and a term with no
  honest home is meant to stay missing and be reported as a gap. Keyword stuffing
  works on the machine and fails on the person who opens the file next.

A cold approach gets no keywords at all: its "requirements" were inferred by this
app from your own notes, so coverage would be measuring the app against itself.

## Prompts

Four layers, assembled in `generate/generate.js`:

1. `prompts/house-style.md` — universal.
2. Positioning, derived from `profile-meta.json` (career level, a free-text note).
3. The CV profile's own prompt file.
4. Integrity constraints, **built** by `generate/integrity.js` from the same
   profile-meta the validator reads, plus the person's own `integrity.md`.

Layer 4 used to be a checked-in file of facts about one person. Deriving it
matters beyond tidiness: the model being told "the degree has not been awarded"
and the checker enforcing it now read the same source, so they cannot drift
apart. The old pair could.

Layers 1–3 are byte-stable for a given profile so the provider's prompt cache
applies; the cache key includes the integrity text precisely so that stability is
not merely assumed.

The volatile user turn opens with **your notes for this application**, before the
advertisement and before the records. First because a model reading a long prompt
weights the top of it, and because that is the only part of the brief you wrote.
Notes govern emphasis, ordering, length, tone and omission; they cannot license a
claim, and the integrity layer says so in terms they cannot override.

## CV profiles

A profile is a document *shape*: section order, rough length, what leads, how
publications are handled. Every `*.json` in `server/generate/profiles/` **is** a
profile — there is no list of profiles anywhere in the code, so adding one is
adding a file (plus a prompt file, and the app can draft both).

Every shipped profile declares `evidenceProfiles: ["*"]`, meaning "every record
whatever it is tagged with". Evidence tags are a vocabulary each person invents,
so a shipped profile naming particular tags would match nothing at all in a
profile written by somebody who called theirs something else. Narrowing is for
profiles you write yourself.

## The LLM layer

`llm.complete({ task, messages })`. Call sites name a *task* ("parse-jd"), and
`llm/registry.js` maps tasks to models per provider — so switching provider is
one line in `.env` and no code change. Raw `fetch`, no SDKs. Typed errors, a cost
ledger, and conformance tests that run **both** adapters from recorded fixtures.

Model names belong in `.env` (`MODEL_GEMINI=…`), never edited into `registry.js`,
which is code and gets updated.

## Generation does not block

`POST /api/jobs/:id/generate/:kind` starts the work and answers **202**. The run
carries on in the process, and `generate/progress.js` holds the record the browser
polls. That is what lets you start a CV, move to the next application, start that
one, and come back to find both either finished or still going; the board reads
`/api/runs` and shows everything in flight.

Two details that are easy to get wrong:

- The screen polls the **server's** run, never a local "am I busy" flag. A local
  flag says "idle" the moment you navigate away, about work that is very much
  still happening.
- The registry is created per app (`createRuns()`), not per module. A module-level
  Map is identical while one server runs and wrong the moment two exist in one
  process — which is every test file.

A second run of the same document is refused with a 409, because both would save
and the loser's version would sit in the history looking like a draft you asked
for. Deleting a job is refused while one is running, for the same reason in
reverse: the save would recreate the folder the delete just removed.

`llm/headroom.js` sits under all of it. A truncated reply is a measurement, not a
verdict — the answer needed more room than it was given — so the ceiling doubles
and the call repeats, twice at most, capped at 131,072 tokens. Bounded because
each growth is a whole paid call; capped because a `max_tokens` above the model's
real limit is a 400, which would turn a recoverable problem into an unrecoverable
one.

## Publications go in on the way out

Ticking a publication records the choice and **writes nothing to the draft**. The
citations are rendered from records (D006, same reasoning as the qualification
booleans) and inserted at render time — the print view, the `.tex` and the PDF each
call `withPublications` on the way out.

This replaced a version that rebuilt the CV from the last *saved* text and stored
it as a new version, which discarded whatever was unsaved in the editor at the
moment you ticked a box. The tick was visible; the loss was not.

## A recruiter's read, which is not the fit score

`generate/recruiter.js`. The fit score reads your **records** and answers "is this
worth applying for", before a draft exists. This reads the **saved draft** and
answers "does it do you justice" — a document can be honest, fully cited, pass
every rule in `validate/` and still bury the thing this employer cares about.

It suggests two kinds of change, and both are checked in code before they are
returned (the same pattern as `import/polish.js`):

- a term the advertisement uses that the draft does not, where a record supports
  the work. The term must be one `keywords.js` actually extracted from the ad, and
  the record id must exist.
- a record the application should be drawing on and is not.

A suggestion failing either check is dropped and **shown as dropped, with the
reason**. A review that quietly invented a qualification to "work in" would walk
around the only thing this app is for.

Which records a draft already uses is **inferred from its text**, and admitted as
such in the code: a saved version stores the markdown and which records were
offered, not which were cited, and the ids are stripped because a reader should
never see them. The matching is strict on purpose — a missed match costs a
redundant suggestion, a wrong match would silently hide a real one.

## Deleting, and the bin

`track/jobs.js`. Delete moves the job and its drafts to `data/trash/`; the bin
screen restores them or destroys them. Moves use `rename` where it works and
copy-then-delete where it does not, so a cross-volume data directory or a Windows
destination clash cannot lose an application. Emptying the bin is confirmed by its
count, so a stale page cannot empty more than it was showing.

## Reading a CV, and tightening a profile

Two features where a model writes something that becomes *evidence* rather than a
draft, which makes them the two most dangerous things in the app.

**`import/pdf-text.js`** reads text out of a PDF with Node's zlib and nothing
else. It is not a general PDF library: it handles text PDFs and gives up
honestly on anything else, because the paste box beside it always works and a
silent half-extraction produces a profile with words missing and no sign of it.
Two things earn their complexity — resolving each font's `/ToUnicode` CMap (a
subset font decoded without one is a substitution cipher, not text), and
inferring line breaks from the positioning operators (a PDF has none).

The garbled-text check is two tests, because one is not enough: a letter ratio
catches obvious noise, and a common-word check catches the cipher case, which is
almost all letters and passes a ratio test comfortably.

**`import/from-cv.js`** turns that text into records. Every record carries a
verbatim `quote` from the source, and nothing is written until a person ticks it
— because everything downstream trusts the profile absolutely, so a job invented
at import time is invisible forever after.

**`import/polish.js`** is the one that rewrites existing records. The prompt asks
for wording changes only, and then the answer is **checked in code**: a rewrite
that acquired a figure the record does not contain is rejected before it is
offered, as is one that lost a figure, as is prose that grew by more than half.
Rejections are shown rather than filtered, and the model's honest alternative to
inventing — asking a question only the person can answer — is a first-class part
of the schema.

## Tests

`npm test`. No network, no API key, no cost. 837 of them.

The suite runs against `examples/example-profile.md` — a made-up person — rather
than against anybody real. That is a fixture the repo controls, so "the example
publications all parse and render" is a claim a reader can go and check; and
because the app offers the same file as *Load a worked example*, every test run
is also a check that the first thing a new person clicks still works.

`server/profile/identity.test.js` is the one that keeps a shared copy honest. It
reads every file git tracks and fails if a personal fact appears anywhere in the
repository, if anything under `data/` has been committed, or if the ignore rule
that keeps it untracked is unanchored. That last check exists because an
unanchored `profile/` once matched `server/profile/` and silently kept a whole new
module out of a commit — found by cloning the repo and running it, which is the
only way that class of mistake ever is.

## Decisions that bite if forgotten

`docs/DECISIONS.md` has the full set with the reasoning; comments across the tree
cite them by number. The four that come up most:

- **A document may never claim an unawarded qualification.** Not negotiable, and
  the reason R4 reads structured booleans rather than text.
- **Terminology follows the advertisement, not the field.** If the ad uses a
  specialist term the document may too, whatever profile the job is in.
- **Overqualification never routes through the score cap.** A hard filter ends an
  application; being too senior is an opinion the applicant may disagree with,
  and folding them together would blame a cap on a "blocking" item.
- **An update must never edit the user's own files.** That is why `data/` is
  gitignored, why the parser still accepts the older `lanes:` spelling alongside
  `profiles:`, and why model overrides live in `.env`.
