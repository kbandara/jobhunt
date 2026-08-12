# The words the app says

The user-facing wording for the setup screens, kept here separately from the
markup that displays it.

**Why this file exists.** The wording and the layout were being worked on at the
same time by different people, in the same files, and whoever pushed second would
have overwritten the other. Text is easy to re-apply to new markup; markup is not
easy to re-apply to new text. So the text lives here, and can be dropped into
whatever the screens end up looking like.

**If you are redesigning a screen**, take the wording from here rather than
rewriting it, and if you improve on it, update this file too. Treat this file as
the source and the screen as the copy.

The wording below IS applied, as of the copy pass that followed the UI redesign.
It was written before that redesign, held here while the markup was changing, and
then put back by hand onto the new layout — which is the whole reason for keeping
it separately.

**Style, so it stays consistent:**

- Say what happens. Don't say why it's better than something else.
- Second person, present tense. "You paste in an advertisement", not "the user
  provides".
- One idea per sentence. If a sentence needs an em-dash aside, it's two sentences.
- Bold is for the two real warnings and for UI labels. Not for emphasis.
- No closing flourishes. A paragraph can just end.
- Where something carries real risk, say so plainly, once. Don't repeat it and
  don't dramatise it.

---

## The welcome screen (`client/views/welcome.js`)

### Heading

> **job_hunt**
>
> Welcome. Paste in a job advertisement and this app reads the requirements,
> estimates how well you match, and drafts a CV, a cover letter and answers to any
> questions the application asks — all from **a profile you write yourself**. The
> board keeps track of where each application got to.
>
> There are four things to set up below, and it takes about ten minutes.
> Everything stays on this computer: your profile, your drafts and your API key
> never leave it. The only thing that goes anywhere is the text you send to the
> model, when you press a button that does that.

### Once setup is complete

> **You're all set up.** [Add your first job](#/add), or [go to the
> board](#/board). The steps below stay here if you ever want to change
> something.

### Step 1 — Check your computer is ready

Summary line: *Node 22 and five small packages. Usually already done.*

Under the check list:

> Anything with a `×` needs fixing before the app will work, and the line
> underneath tells you how. **Check again** once you've done it. You can also run
> `npm run doctor` in your terminal for a fuller check.

### Step 2 — Get an API key

Summary line: *Free with Google Gemini. Takes two minutes.*

> The app writes your documents using a language model, and you need your own key
> to reach one. That way you can see exactly what it costs, and nothing you write
> goes through anyone else's server.

Provider descriptions:

- **Google Gemini** — Recommended. Sign in with a Google account, press Create
  API key, and copy it. The free tier is enough to run this app — no payment and
  no card needed.
- **Anthropic Claude** — Paid, at roughly 20c per application. Worth choosing if
  you already have credits; the writing is a little better on longer documents.

Under the key field:

> Saved to a file called `.env` in this folder, which git ignores. It's only ever
> sent to *[provider]*, and this screen won't show it back to you.

After testing:

> **That key works.** *[Provider]* answered, using *[model]*.

> **The key was saved, but *[provider]* wouldn't accept it.**

### Step 3 — Add your contact details

Summary line: *Name, email, phone — these go at the top of every document.*

> These four go at the top of every CV and cover letter. The app copies them
> across exactly as you type them here — no model is involved, so your phone
> number can't come out wrong.

Link: *Add links, right to work and qualifications →*

### Step 4 — Build your profile

Summary line, before anything is added: *A list of what you have done. The app
needs this before it can write anything.*

Summary line, after: *[N] records saved. Everything the app writes comes from
these.*

> Your **profile** is a list of everything you've done: education, jobs,
> projects, findings, publications, skills. Every CV the app writes is built from
> it, and anything that isn't in here can't appear on one. That's what stops the
> app inventing a job or a number on your behalf.
>
> You have [N] records so far. Pick whichever way in suits you:

Buttons: *Start from my CV*, *Write it by hand*, *Load a worked example*

> **Start from my CV** is the quickest. Upload a PDF — a LinkedIn *Save to PDF*
> export works well — or paste the text in. It comes back as a list of records for
> you to check, and nothing is saved until you tick it.

> **Load a worked example** fills your profile with 21 records belonging to a
> made-up ecologist called Rosa Kimani. It's there so you can try the whole app —
> read an ad, score it, generate a CV — before typing anything about yourself.
> Your own profile is backed up first, so nothing is lost.

After loading:

> **Loaded [N] records.** Your previous profile was saved to `[path]`.

### The walkthrough at the bottom

Heading: **How you'll use it**

1. **Add a job.** Paste in the advertisement. There's a second tab for companies
   that aren't advertising, which gets you a cold email instead.
2. **It reads the ad.** Requirements, location, whether it's onsite or remote, any
   questions the application asks, and a suggestion for which CV profile to use.
3. **Worth applying?** An estimate of how a recruiter would react to your profile,
   and why. Anything you can't pass — a required degree, a citizenship rule —
   lowers the score, and the screen says which.
4. **Generate.** A CV, a cover letter, and answers to the application's questions.
   One tab each, and you can start several jobs at once.
5. **Check the flags.** The app reads the draft back and points out anything it
   can't support — a bullet with no source, or a number that isn't in your profile.
   That check is ordinary code, not another model.
6. **Get a recruiter's read.** A model plays the person screening this role and
   reads the draft you're about to send. It says what would make them hesitate, and
   which of your records this application isn't using.
7. **Edit and export.** Your edits are saved as new versions, never over the top.
   Export a PDF, a .tex file, or print straight from the browser.

A title already ending in `?` or `!` doesn't get a full stop appended — that is
what produced "Worth applying?." the first time.

Button: *Add your first job →*

---

## The right-to-work warning (`client/views/settings.js`)

This one matters more than the rest, because it is the only place the app prints a
legal claim on the user's behalf. It should stay roughly this length — shortening
it loses the part that matters.

> **Read every line here before you send anything.** Each one is printed on your
> CV word for word, as a statement you are making about your right to work
> somewhere, and the app checks none of it. It doesn't know which schemes exist,
> what their age limits are, or whether they're open this year. Rules change and
> schemes close.
>
> Delete anything you're not actually eligible for, or wouldn't want to use. A
> country you haven't listed uses your general relocation phrase, which is the
> safest option.

---

## The chat drawer (`client/views/chat.js`)

Two modes, and the wording carries the difference — the whole point of the
feature is that you can tell, before you press send, whether the thing you type
can change your document.

### The mode switch

Two buttons, `Ask` and `Edit`. Ask is selected when the drawer opens. The
explanation sits on each button as a tooltip rather than in a paragraph
underneath, because the paragraph is what nobody reads before the rewrite lands.

> **Ask** — Answer questions about this CV. It cannot change it.
>
> **Edit** — Let it rewrite this CV. Each rewrite is saved as a new version.

*("CV" is replaced by whichever document is open: cover letter, set of answers,
email.)*

### Placeholder in the box

> **Ask** — Ask what a line claims, or why it says that…
>
> **Edit** — Say what to change, and it rewrites the draft…

### Under the box

> **Ask** answers questions and never changes your draft. Switch to Edit when you
> want it to make the change. Enter sends, Shift+Enter starts a new line.

> **Edit** rewrites the draft and saves it as a new version — the one before it
> is kept, so nothing is lost. Enter sends, Shift+Enter starts a new line.

### Before you have said anything

> It has **every record in your profile** and the advertisement, and it will
> refuse anything that would need a fact you do not have.

> In **Ask** it only answers. Your draft is not touched, whatever it suggests.
> Highlight a passage in the editor — before opening this, or beside it on a wide
> screen — and you can quote it, so the question is about that passage alone.

> In **Edit** it changes the draft and saves the result as a new version. Ask for
> one change at a time — the rest of the document comes back as it was.

### Quoting

The button that appears once something is highlighted:

> Quote what you highlighted

### When it rewrites the document while you were only asking

The model does this, and it describes the rewrite in the past tense — "I have
updated the Technical Skills bullet to…" — so the correction goes **above** the
reply, where it is read first:

> It has written this as though the change were already made. **It is not** —
> your CV is exactly as you left it.

The rewrite itself is offered rather than binned:

> **The version it wrote** — not applied — your CV has not changed
>
> [Read it in full]
>
> **[Use this CV]** [Ignore it]
>
> Applying it saves a new version. The one you have now is kept, and the flags
> below are re-checked against whichever you end up with.

### When the server is older than the page

> **The server running is older than this page.** It has not heard of Ask, so it
> would rewrite your draft to answer a question. Stop it in the terminal with
> Ctrl+C, run `npm start` again, then reload this page.

---

## Reading an old version (`client/views/job.js`, `HistoryBar` and `DiffView`)

> Reading **version 2** of 4 — your edit, 3 h ago. Read-only.

The switch between the two ways of reading it:

> Changes · Full text

The line under the comparison, when there is a second version to compare with:

> Compare with the current draft instead

> Compare with the version before it instead

Above the diff:

> **+4** **−20** — version 2, against version 1

> **+0** **−0** — version 2 is identical to the current draft

And what stands in for the parts that did not change:

> 12 unchanged lines

---

## Your profile beside the draft (`client/views/profile-drawer.js`)

### The button that opens it

> Check against your profile

### The panel

> **Your profile** — 4 of 21 records are in this CV

Three filters, of which the middle one is the reason the panel exists:

> All · Not used · In it

### Under the list

> ✓ means this CV already mentions it. Matched on titles and organisations, so
> treat it as a prompt to look rather than proof. Inserting puts the record's own
> words at the end of the draft.

### When nothing matches

> Every record in your profile is in this CV.

> Nothing matches “…”.

### On a record

> Put it in the draft

---

## Wording used in more than one place

Keep these consistent wherever they appear — the README, the landing page, the
app, and `templates/`.

| Say | Not |
|---|---|
| your profile | your master profile *(fine in the file itself, too much elsewhere)* |
| records | evidence records |
| the app reads the draft back | a validator runs over the draft |
| it can't support | it cannot verify |
| a language model | the model, an LLM, an AI |
| your right to work | your work rights |
| runs on your own computer | runs locally, runs on your machine |
| the free tier is enough | free to run |
| Worth applying? | Is this worth a day? |
| a recruiter's read | an AI recruiter simulation |
| the app reads / this app does | I read, I'll draft, I can help *(no persona)* |
| the bin | the trash, the archive |
| Ask / Edit | chat mode, plan mode, act mode |
| your draft is not touched | read-only, non-destructive |
