# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Job seekers wanting privacy and traceability. They use the tool to tailor CVs and cover letters for specific job ads without hallucinating false credentials.

## Product Purpose
A local job-application pipeline that reads a job ad, scores it honestly against the user's profile, and drafts a CV, cover letter, and answers to application questions where every generated point is traceable to a master record.

## Positioning
Runs entirely locally and privately on the user's machine. It ensures complete factual accuracy by making every drafted bullet traceable to the user's provided profile, and uses a deterministic code checker (not an LLM) to flag unsupported claims, missing facts, or made-up numbers.

## Operating Context
Used locally on a personal computer via a browser interface (localhost:4477). Requires Node.js. Users maintain a single Markdown master profile and use their own API key (e.g., Gemini free tier) to process jobs. Output is exported as LaTeX-typeset PDFs or raw text for Overleaf/Word.

## Capabilities and Constraints
- Runs locally (Node.js server with Preact frontend).
- Cost is zero on Gemini's free tier.
- Must not hallucinate or invent any qualifications, skills, or numbers.
- Handles Publications separately (formats as APA directly).
- Data (`data/` directory) and API keys (`.env`) stay purely local and are never tracked in Git.

## Brand Commitments
The voice and tone of the product (UI text, explanations, suggestions) should be encouraging, supportive, and friendly, taking the stress out of the job application process.

## Evidence on Hand
- Included examples (`examples/` directory) with a fictional ecologist's profile.
- Explicit CV profiles for different formats (`research`, `teaching`, `industry`, `industry-research`, `public-sector`, `general`).

## Product Principles
1. **Absolute Traceability**: Every claim made on a CV must be directly sourced from the user's master profile.
2. **Local Privacy**: User data and documents never leave their machine, except when explicitly sent to the chosen LLM.
3. **Deterministic Verification**: Use real code to check outputs (finding missing citations or numbers), not another LLM.
4. **Supportive Experience**: The tool should act as a friendly and encouraging assistant during a stressful process.

## Accessibility & Inclusion
Outputs are single-column PDFs, ensuring they are correctly read out-of-order by automated screening systems (ATS).
