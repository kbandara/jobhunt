# job_hunt

A job application assistant that runs on your own computer.

You paste in a job advertisement. It reads the requirements, gives you a score
for how well you match, and drafts a CV, a cover letter, and answers to any
questions the application asks. You edit the drafts, export a PDF, and a board
keeps track of where each application got to.

Your profile, your drafts and your API key stay on your machine. The only thing
that leaves it is the text sent to the language model, when you press a button
that does that.

**Using Google Gemini's free tier, it costs nothing to run.**

---

## How it works

You write a **master profile**: one file listing your education, jobs, projects,
publications and skills. Everything the app writes comes from that file.

When it drafts a CV, every bullet point records which parts of your profile it
came from. Then a checker reads the draft and flags problems:

- a bullet with no source in your profile
- a number that does not appear in the records that bullet cites
- a claim that you hold a qualification your profile says is still in progress

The checker is ordinary code, not another language model, and it does not change
your document. It shows you what it found and you decide what to do.

Publications are handled separately: they are read from your profile and
formatted in APA by the app itself, so a year or a journal name cannot get
altered along the way.

---

## Setup

Around ten minutes, once.

### 1. Check you have Node 22

```
node --version
```

If it prints v22 or higher, you're set. Otherwise install the LTS version from
<https://nodejs.org>.

### 2. Download the code

```
git clone https://github.com/kbandara/jobhunt.git
cd jobhunt
npm install
```

Five small packages, and no build step.

### 3. Start it

```
npm start
```

Then open <http://127.0.0.1:4477> in your browser. The server only accepts
connections from your own computer.

### 4. Follow the first screen

It walks you through the rest:

**An API key.** Google Gemini has a free tier and the screen links to the page
that issues a key. Paste it in and press *Save and test it* — the app stores it
in a file called `.env` and makes one real call to check it works.

**Your contact details.** Name, email, phone, where you live.

**Your profile.** Three ways to start:

- *Start from my CV* — upload a PDF (a LinkedIn "Save to PDF" export works) or
  paste the text in. The app turns it into records and shows each one next to the
  part of your CV it came from. Nothing is saved until you tick it. Read them
  properly: these records are what every future CV draws on, so a mistake here
  follows you around.
- *Write it by hand* — add records one at a time in the profile editor, or edit the
  whole file directly under **Profile → The whole file**. That tab has line
  numbers, a jump list of your records, and warns you before you lose unsaved
  changes; if the file wouldn't parse it tells you which line and refuses to save
  rather than breaking your profile.
- *Load a worked example* — 21 records belonging to a made-up ecologist, so you
  can try the whole app before typing anything real.

**Where you can work.** This becomes the last line of your CV header. There's a
section on it further down that's worth reading.

If something isn't working, run `npm run doctor`. It checks Node, the packages,
your API key, whether the model names are still valid, whether your profile
parses, whether the data folder is writable, whether the port is free, and
whether LaTeX can build a PDF. Anything wrong comes with a suggested fix.

---

## Where you can work

Under **Settings → Where you can work** you describe your right to work, and the
app puts it at the end of your CV header.

You can write a different line for each country. This is more useful than it
sounds. An employer advertising in the US will read "open to relocation" as
"needs sponsorship" and often stop there — but an Australian applying for that
job can use the E-3 visa, which has no lottery and only needs a one-page form
from the employer. Saying so plainly can be the difference between getting read
and getting filtered out.

Countries you haven't listed use your general relocation phrase. If you delete
the country list entirely, that phrase is used everywhere.

### Please read what you write here

Whatever you type gets printed on your CV word for word, as a statement you are
making about yourself. **The app does not check any of it.** It doesn't know
which visa schemes exist, what their age limits are, or whether they're open this
year. Rules change and schemes close.

So go through each line and delete anything you're not actually eligible for, or
wouldn't want to use. The example routes belong to a fictional person and are
there to show the format, not to tell you what you qualify for.

Remote roles never mention a visa, since there's nothing to ask about.

---

## Using it

**1. Add a job.** Paste the advertisement. There's a second tab, *A company to
approach*, for companies that aren't advertising — you describe what you know
about them and get a cold email plus a CV aimed at that kind of work.

**2. It reads the ad.** Requirements, location, whether it's onsite or remote,
any questions the application asks, and a guess at which CV profile suits.

**3. Worth applying?** A model reads your profile against the ad and estimates
what a recruiter would do with your application, before you spend anything on a
draft. It answers out of 20 and the app shows that out of 100 — asked for a number
out of a hundred, models drift low and grade everything against an imaginary
perfect candidate.

Two things are reported separately from the number:

- *Hard filters.* Something you can't pass — a required degree, a citizenship
  requirement, a minimum number of years — lowers the score, and the screen tells
  you which one and by how much.
- *Overqualified.* Being too senior is a common reason for rejection and nobody
  ever tells you it happened. It's shown as its own note and doesn't change the
  score, since you might reasonably disagree.

**4. Choose your publications.** A tick list, each formatted in APA. Some are
already ticked based on which are most relevant to this ad. Unpublished
manuscripts are capped at half the list so they don't push out peer-reviewed
work.

Ticking a box doesn't change your draft. The choice is saved, and the citations
are added when you export — so a tick can never overwrite something you were
part-way through writing.

**5. Add any notes.** *Your notes for this application* is where you say things
like "mention my E-3 eligibility in the header" or "lead with the teaching".
These are read before the advertisement, so one draft gives you what would
otherwise take a draft plus a rewrite. Notes affect emphasis, ordering and length
— they can't add something your profile doesn't support.

**6. Generate.** CV, cover letter, and answers to the application's questions,
one tab each.

The button returns immediately and the writing continues in the background. You
can start a CV, move to another application, start that one too, and come back
later. The board shows which drafts are in progress. Running two at once costs
the same as running them one after the other.

**7. Read the flags.** Described below.

**8. Get a recruiter's read.** This is the other half of the score, and the more
useful half. A model plays the person screening applications for this role and
reads **the draft you are about to send** — not your profile — against the
advertisement. You get what they notice in the first twenty seconds, whether they
would interview you, what would make them hesitate, and two kinds of suggested
change:

- *The ad's words for things you have done.* A term the advertisement uses that
  your draft does not, where one of your records shows you genuinely did that
  work. The record backing it is named next to each one.
- *In your profile, missing from this draft.* Something you have done that answers
  this ad and the draft never mentions.

Every suggestion is checked against your records before you see it. A term the
advertisement never used, or one pointing at a record that does not exist, is
thrown away — and shown to you as thrown away with the reason, rather than
quietly dropped.

**9. Check the advertisement's words.** *The advertisement's words* lists the
terms an automated screening system is likely to search for, with the ad's
must-haves first, and ticks the ones your draft already uses. Where a bullet
describes work you genuinely did, using the advertisement's word for it is free.
Where you haven't done the thing, leave the term unticked — that's what the list
is for.

**10. Edit.** Your version is saved alongside the model's, not over it. The
dropdown next to the export buttons lists every version of the document with
where each came from. *Add a record the model left out* lets you search your
profile and paste a record in as written.

Pick an older version and it opens on **Changes** — a `+`/`−` diff of what that
version did, with unchanged runs collapsed so a one-sentence edit reads as one
sentence rather than two pages. *Full text* shows the whole document instead, and
one link switches the comparison from "what did this version change" to "what
happens if I restore it".

**11. Ask questions about the draft.** *Ask about this draft* opens a chat next
to the document. It can see your whole profile, not just the records this CV
used, so "add my teaching role" works even if the draft never mentioned it.

The chat has two modes, and it starts in **Ask**. Ask answers questions and
cannot change your draft. Switch to **Edit** when you want the change made; that
rewrites the document and saves a new version, and the version before it is still
there.

If the model rewrites the document while you are only asking — which it does,
usually while describing the change as though it had already been made — nothing
reaches your draft. The rewrite is offered instead, in full, with a button that
applies it, and the reply above it is labelled as describing something that has
not happened.

Highlight a passage in the editor first and *Quote what you highlighted* pins it
above the box, so "what does this actually claim?" is about that passage rather
than the whole CV.

**12. Check it against your profile.** *Check against your profile* opens your
records on the left, and it can stay open beside the chat — your profile on one
side, the model on the other, the draft between them. Each record is marked
according to whether this draft already mentions it, and **Not used** filters to
the ones it does not, which is usually the question you actually have. Any record
can be inserted into the draft in its own words.

The mark is matched on titles and organisations, so treat it as a prompt to look
rather than proof.

**13. Export.** *Download PDF* builds a typeset PDF through LaTeX. *.tex* gives
you the source to upload to Overleaf. *Open print view* then Ctrl+P → Save as PDF
works with nothing extra installed.

All three produce a single-column document on purpose: multi-column CVs get read
out of order by automated screening systems.

---

## The flags panel

After each draft, a checker reads it and reports what it found. It never edits
your document.

**Red — worth looking at:**

- a bullet with no source, or one citing a record the model wasn't shown
- a number that appears in none of the records that bullet cites
- a figure in a bullet based on a record you marked *not releasable*
- a claim that a qualification is submitted or awarded, when your settings say
  otherwise
- your name with a credential you don't hold, or a stock phrase like "team
  player"

**Amber — probably fine, but have a look:**

- a figure that's the difference between two other figures you cited
- a specialist term the advertisement itself didn't use, with a plainer
  alternative suggested. The advertisement decides this: if the ad uses the term,
  you can too.
- something the ad lists as essential that your document doesn't mention. Only
  ever a warning, since your draft may cover it in different words.

Once you edit and save, everything becomes amber. Your edits are treated as
deliberate.

---

## Improving your profile

**Profile → Tighten the wording** reads your records and suggests clearer
versions: outcome first, less filler.

Every suggestion is checked before you see it. A rewrite is rejected if it adds a
figure your record doesn't contain, drops one that it does, or grows by more than
half.

Rejected suggestions are still shown, under *not offered*, with the reason. They
tend to be useful — usually a sign the underlying record is missing something you
could add yourself.

Where a record is genuinely thin, you get questions rather than padding: "how
many sites?", "what did the error rate drop to?"

Nothing is saved until you accept it, one record at a time.

---

## Deleting an application, and getting it back

*Delete* is at the top right of a job screen. It moves the application to a bin
rather than destroying it, so a click you did not mean can always be undone.

The bin is linked from the board whenever there is something in it. *Restore* puts
an application back in the lane it was in, with every draft and every earlier
version exactly as they were. Permanent deletion lives in the bin too, as a
separate step you have to arm first.

Neither will run while something is being written for that job.

The event log is never touched by any of it, so you can still answer "how long did
they take to reply" across your whole history even after something is thrown
away.

---

## Where files live

| Path | What's in it |
|---|---|
| `data/profile/master-profile.md` | Your profile. If something isn't in here, it can't appear on a CV. Edit it under **Profile → The whole file**, or in any text editor — the app notices either way. |
| `data/profile/profile-meta.json` | Contact details, right to work, and your qualification statuses. |
| `data/` | Everything about you: profile, jobs, drafts, spending. Not tracked by git, and never touched by an update. Copy this folder if you change computers. |
| `.env` | Your API key. Not tracked by git. Written by the app, editable by hand. |
| `examples/` | The made-up person's profile behind "load a worked example". |
| `server/import/` | Reading CVs: PDF text extraction and turning it into records. |
| `server/generate/profiles/` | One file per CV profile. Add a file to add a profile. |
| `server/generate/prompts/` | House style and one file per profile, in plain English. Edit them if the tone isn't right. |

Nothing about you is tracked by git. Everything you write goes in `data/`, which
git ignores, so `git pull` can't overwrite your profile.

---

## CV profiles

A profile controls the **shape** of a document: section order, roughly how long
it runs, what goes first, how publications are handled. It doesn't decide what
the document says — that comes from your records and the advertisement.

Seven are included:

| Profile | Suits |
|---|---|
| `research` | postdocs, fellowships, research scientist posts. Full publication list, no page limit. |
| `teaching` | lecturing, teaching fellowships, education development. |
| `data-science` | data scientist, ML engineer, applied scientist. Skills section second, so the stack is the first thing read, and projects get their own section. |
| `industry` | analyst, consulting, applied technical roles where the reader may not be technical. Plainer language than `data-science`. |
| `industry-research` | research scientist and R&D roles inside a company. |
| `public-sector` | government, agencies, NGOs. Selection criteria as a separate document. |
| `general` | anything that doesn't fit the others. |

`data-science` and `industry` overlap on purpose. The difference is who is
reading: `data-science` assumes a technical reader and lets specialist terms
through where a record supports them, and puts your stack above your job history
because that is what such a reader scans for first. `industry` assumes they might
not be technical and translates.

Edit any of them under **CV profiles**, or press *New profile* and describe the
kind of role you have in mind. The app drafts one and shows it to you before
saving anything.

---

## Costs

Shown live in the app header and recorded per call in `data/usage/ledger.jsonl`.
The ledger holds token counts and amounts only, never the text of your documents.

On Gemini's free tier: nothing.

On Anthropic: roughly 20c per application — about 1c to read the ad, 10c for a
CV, 6c for a cover letter — plus another 10c or so if you also answer a set of
selection criteria.

---

## Getting PDFs

PDFs are typeset with LaTeX, which needs a TeX engine installed. The app can't
include one; they're several gigabytes. It's a ten-minute install, once, and then
*Download PDF* just works.

| Your computer | Install |
|---|---|
| Windows | [MiKTeX](https://miktex.org/download) with the default options. It downloads packages as it needs them, so your first PDF may pause briefly. |
| macOS | [MacTeX](https://tug.org/mactex/). If you chose the smaller BasicTeX, also run `sudo tlmgr update --self && sudo tlmgr install titlesec enumitem microtype charter`. |
| Linux | `sudo apt install texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended` |

Close and reopen your terminal afterwards so the engine is found.

If you'd rather not install anything, use the *.tex* button and upload the file
to <https://overleaf.com>, or use the print view.

When a build fails, the app shows you the LaTeX error itself. It's usually a
missing package, and the message names it.

---

## If something goes wrong

Start with `npm run doctor` — one command that checks everything and suggests
fixes.

### The page won't load

1. **Is the terminal still open?** The server only runs while `npm start` is
   running in that window.
2. **Did it say "job_hunt is running"?** If it printed an error instead, that's
   the problem. If it printed nothing, you're probably in the wrong folder.
3. **Include `http://` in the address.** Typing `127.0.0.1:4477` on its own can
   make the browser search for it instead.
4. **Try the other address.** Both `http://localhost:4477` and
   `http://127.0.0.1:4477` work.
5. **Port already in use?** Usually this app already running in another window.
   Use that one, or add `PORT=4478` to `.env`.

### Other messages

| What you see | What it means |
|---|---|
| "No API key found" | `.env` is missing or the key is blank. Set it under Settings. |
| A model-not-found error | Run `npm run models` to see which models your key can reach, then set `MODEL_GEMINI=…` in `.env`. |
| "rate limit" | The free tier's per-minute cap. Wait a minute and try again. |
| "no capacity for this model" (HTTP 503) | The model is busy at Google's or Anthropic's end. The app already waited about 30 seconds. Try again in a few minutes. |
| "took longer than N seconds" | Usually the provider being briefly slow. If one step keeps timing out, add `LLM_TIMEOUT_MS=600000` to `.env`. |
| "This server has no route …" | You updated the app while it was running. Press Ctrl+C, run `npm start`, reload the page. |
| A red banner about your profile | Your profile has a formatting problem on the line it names. The app is still using the last version that worked. Fix that line under **Profile → Markdown**. |
| "The text came out garbled" when importing a CV | The PDF's fonts can't be read. Open the PDF, select all, copy, and paste into the box instead. |
| "It is probably a scan" when importing | The PDF is an image of a page rather than text, so there's nothing to extract. Paste the text instead. |

### Running the tests

```
npm test
```

837 tests, no network access and no API key needed. Scroll to the bottom for the
summary — you're looking for `pass 837` and `fail 0`.

Some tests deliberately cause errors to check the app handles them, so you may
see messages that look alarming. If the summary says `fail 0`, everything passed.

### Two Windows notes

PowerShell's `npm` wrapper strips `--` arguments, which is why every option in
this app is an environment variable instead.

`Set-Content -Encoding utf8` adds an invisible character at the start of a file
that breaks JSON parsing. The app removes it when reading, so you don't have to
worry about it.

---

## Updating

```
git pull
npm install
npm start
```

`npm install` is only needed if the packages changed, but running it anyway does
no harm.

Your API key, profile and data are never affected — `.env` and `data/` are
ignored by git.

Keep model names in `.env` (`MODEL_GEMINI=…`) rather than editing
`server/llm/registry.js`. That file is code and gets updated, so changes to it
cause conflicts when you pull.

---

## For developers

`docs/ARCHITECTURE.md` explains how the code is organised and which parts are
easy to break. `docs/DECISIONS.md` records why things were built the way they
were — comments in the source refer to it by number.
