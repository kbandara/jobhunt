# LLM fixtures

**Every fixture currently in this folder is SYNTHETIC.** They were hand-written
to match each provider's wire shape; none of them came from a live API call.
Each file says so in its own `"synthetic": true` field and its `note`.

They exist so `npm test` can exercise the full path — request building, schema
down-conversion, response parsing, validation, costing, ledger — without ever
touching the network or needing an API key.

## Replacing them with real recordings

```
node server/llm/record-fixtures.js      # or: npm run record-fixtures
```

That script makes real, billed calls with whichever keys are in `.env`, and
overwrites the files for those providers with real responses (`"synthetic"`
becomes `false` and `recordedAt` is stamped). It sends only invented job ads and
invented evidence records — nothing from `data/`, nothing about you — so the
recordings stay safe to commit even though this repo is private.

## Layout

```
fixtures/<provider>/<task>.json
```

with the shape:

```jsonc
{
  "synthetic": true,        // false once recorded live
  "note": "...",
  "provider": "anthropic",  // or "gemini"
  "task": "parse-jd",
  "status": 200,            // HTTP status the stub should return
  "body": { ... }           // the provider's response body, verbatim
}
```

Tasks covered: `parse-jd`, `score-batch`, `generate-cv` — one cheap task, one
batch task and one big generation task, on both providers. The failure cases
(refusal, truncation, rate-limit, schema mismatch) are built inline in
`conformance.test.js` instead, because deliberately provoking them live would
cost money for no extra confidence.

## What to check after re-recording

The conformance suite asserts that both providers return the **same result
shape** for the same task — the same keys, all the way down — not the same
wording. Real recordings differ in wording and that is fine. If the
cross-provider comparison fails after recording, that is the suite doing its
job: one provider dropped or renamed a field, and the fix belongs in that
adapter, not in the test.
