#!/usr/bin/env python3
"""Read a CV PDF the way a parser does, and report what breaks.

Usage:
    python3 ats_check.py cv.pdf                       # structural checks
    python3 ats_check.py cv.pdf job-description.txt   # + keyword coverage

Requires pdftotext (poppler-utils). `-raw` mode follows the PDF content
stream, which is roughly what a naive extractor sees; `-layout` mode
reconstructs visual columns. If the two disagree badly, your layout is
scrambling the reading order -- the classic two-column failure.
"""
import re
import subprocess
import sys
from collections import Counter
from difflib import SequenceMatcher

OK, WARN, FAIL = "  ok  ", " warn ", " FAIL "

STANDARD_SECTIONS = [
    "summary", "profile", "objective", "experience", "employment",
    "education", "skills", "projects", "publications", "certifications",
    "awards", "additional",
]

STOPWORDS = set("""a an the and or but if then than that this these those for to of in on at by
with from as is are was were be been being it its we you your our their they he she his her
will would can could should may might must have has had do does did not no so such other more
most some any all each we're you'll role team work working experience years year strong
ability able across including include includes etc via using use used new job position
candidate applicants apply please company us who what when where how why also well plus
looking run write against partner own build owning great like need needs seeking join help
""".split())


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def report(status, msg):
    print(f"[{status}] {msg}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pdf = sys.argv[1]
    jd_path = sys.argv[2] if len(sys.argv) > 2 else None

    raw = run(["pdftotext", "-raw", "-enc", "UTF-8", pdf, "-"])
    layout = run(["pdftotext", "-layout", "-enc", "UTF-8", pdf, "-"])

    print(f"\n=== {pdf} ===\n")

    # 1. Did anything extract at all?
    if len(raw.strip()) < 200:
        report(FAIL, "Almost no text extracted. The PDF is an image or the "
                     "fonts have no ToUnicode map.")
        sys.exit(1)
    words = re.findall(r"[A-Za-z][A-Za-z'\-]+", raw)
    pages = run(["pdfinfo", pdf]).count("Pages:") and \
        re.search(r"Pages:\s+(\d+)", run(["pdfinfo", pdf]))
    npages = int(pages.group(1)) if pages else "?"
    report(OK, f"{len(words)} words extracted across {npages} page(s)")

    # 2. Reading order: raw vs layout
    sim = SequenceMatcher(None, " ".join(raw.split()), " ".join(layout.split())).ratio()
    if sim > 0.97:
        report(OK, f"Reading order stable across extraction modes ({sim:.0%})")
    elif sim > 0.90:
        report(WARN, f"Reading order differs between modes ({sim:.0%}); check "
                     "for side-by-side content")
    else:
        report(FAIL, f"Reading order scrambled ({sim:.0%}). Multi-column or "
                     "floating layout -- linearise it.")

    # 3. Encoding integrity
    bad = [c for c in raw if c == "\ufffd" or 0xE000 <= ord(c) <= 0xF8FF]
    if bad:
        report(FAIL, f"{len(bad)} unmappable glyph(s). Add "
                     r"\input{glyphtounicode} and \pdfgentounicode=1")
    else:
        report(OK, "No unmappable or private-use glyphs")

    # 4. Hyphenated line breaks eat keywords
    hyph = re.findall(r"[A-Za-z]{2,}-\s*\n\s*[a-z]{2,}", layout)
    if hyph:
        report(FAIL, f"{len(hyph)} word(s) hyphenated across a line break; "
                     r"these never match a keyword search. Use \raggedright.")
    else:
        report(OK, "No words broken across lines")

    # 5. Contact details survived
    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", raw)
    phone = re.search(r"(\+?\d[\d\s().-]{7,}\d)", raw)
    report(OK if email else FAIL,
           f"Email {'found: ' + email.group(0) if email else 'NOT found'}")
    report(OK if phone else WARN,
           f"Phone {'found: ' + phone.group(1).strip() if phone else 'NOT found'}")

    # 6. Name should be the first substantive line
    first = next((l.strip() for l in raw.splitlines() if l.strip()), "")
    if 1 < len(first.split()) <= 6 and not re.search(r"\d", first):
        report(OK, f"First line reads as a name: {first!r}")
    else:
        report(WARN, f"First extracted line is {first!r} -- parsers often take "
                     "this as the candidate name")

    # 7. Section headings
    low = raw.lower()
    found = [s for s in STANDARD_SECTIONS if re.search(rf"\b{s}\b", low)]
    if len(found) >= 4:
        report(OK, f"Standard sections detected: {', '.join(found[:8])}")
    else:
        report(WARN, f"Only {len(found)} standard section heading(s) found. "
                     "Use conventional names (Experience, Education, Skills).")

    # 8. Dates
    dates = re.findall(
        r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b", raw)
    report(OK if len(dates) >= 2 else WARN,
           f"{len(dates)} month-year date(s) found. 'Mar 2022' parses far more "
           "reliably than '03/22' or '2022-'.")

    # 9. Keyword coverage against a job description
    if jd_path:
        jd = open(jd_path, encoding="utf-8").read().lower()
        jd_terms = [w for w in (t.strip(".-") for t in
                                re.findall(r"[a-z][a-z+#.\-]{2,}", jd))
                    if w and w not in STOPWORDS]
        ranked = [t for t, _ in Counter(jd_terms).most_common(60)]
        missing = [t for t in ranked if t not in low]
        print("\n--- keyword coverage ---")
        hit = len(ranked) - len(missing)
        report(OK if hit / max(len(ranked), 1) > 0.6 else WARN,
               f"{hit}/{len(ranked)} of the ad's most frequent terms appear in the CV")
        if missing:
            print("      missing:", ", ".join(missing[:25]))

    print()


if __name__ == "__main__":
    main()
