#!/usr/bin/env python
"""Static checks for a LaTeX cover letter.

Checks:
  * leftover placeholders (TBD, XX%, [Journal], <...>)
  * required metadata (title, journal, manuscript ID, date, email, signature)
  * one-page claim consistency against the compiled PDF (optional --pdf)
  * numbers in the letter that also appear in the manuscript (optional --manuscript)
  * banned marketing phrases
  * unbalanced braces / duplicate dates

Usage:
    python check_cover_letter.py cover-letter.tex
    python check_cover_letter.py cover-letter.tex --pdf out/cover-letter.pdf --manuscript ../sn-article.tex
Exit code: 0 pass, 1 errors, 2 unreadable input.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

PLACEHOLDER = re.compile(r"(TBD|TODO|XXX|\bXX%|\[Journal\]|\[Manuscript ID\]|<[^>\n]{2,}>)")
BANNED = [
    "groundbreaking",
    "paradigm",
    "delighted",
    "thrilled",
    "world-class",
    "first-ever",
    "revolutionary",
    "cutting-edge",
]


def read_pdf_pages(pdf: Path) -> int | None:
    try:
        out = subprocess.run(
            ["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=30
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    match = re.search(r"Pages:\s+(\d+)", out)
    return int(match.group(1)) if match else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Static checks for a cover letter.")
    parser.add_argument("tex", type=Path)
    parser.add_argument("--pdf", type=Path, help="compiled cover-letter PDF")
    parser.add_argument("--manuscript", type=Path, help="manuscript .tex for number cross-check")
    args = parser.parse_args()

    if not args.tex.is_file():
        print(f"ERROR: cannot read {args.tex}", file=sys.stderr)
        return 2
    text = args.tex.read_text(encoding="utf-8", errors="replace")
    errors: list[str] = []
    warnings: list[str] = []

    for match in PLACEHOLDER.finditer(text):
        line = text[: match.start()].count("\n") + 1
        errors.append(f"line {line}: placeholder '{match.group(1)}'")

    for phrase in BANNED:
        if re.search(rf"\b{re.escape(phrase)}\b", text, re.I):
            errors.append(f"marketing phrase not allowed: '{phrase}'")

    required = {
        r"\\setkomavar\{subject\}": "subject line",
        r"\\setkomavar\{date\}": "date",
        r"\\opening\{": "opening",
        r"\\closing\{": "closing",
        r"\\begin\{letter\}": "recipient letter block",
    }
    for pattern, label in required.items():
        if not re.search(pattern, text):
            errors.append(f"missing {label}")

    if not re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text):
        errors.append("no e-mail address found")

    dates = re.findall(r"\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b", text)
    if len(dates) > 1:
        warnings.append(f"{len(dates)} full dates found; keep exactly one letter date")

    if text.count("{") != text.count("}"):
        errors.append("unbalanced braces")

    if args.pdf:
        if not args.pdf.is_file():
            errors.append(f"PDF not found: {args.pdf}")
        else:
            pages = read_pdf_pages(args.pdf)
            if pages is None:
                warnings.append("could not read PDF page count via pdfinfo")
            else:
                print(f"PDF pages: {pages}")
                if pages > 1:
                    errors.append(f"cover letter is {pages} pages; trim to one page")
                if re.search(r"(within|fits|fit)\s+(the\s+)?(ten|10)[- ]page", text, re.I) and pages > 10:
                    errors.append("letter claims compliance with a 10-page limit, but PDF exceeds 10 pages")

    numbers = set(re.findall(r"\b\d+(?:\.\d+)?\s?\\?%", text))
    if numbers and args.manuscript and args.manuscript.is_file():
        manuscript = args.manuscript.read_text(encoding="utf-8", errors="replace")
        missing = [n for n in sorted(numbers) if n.replace(" ", "") not in manuscript.replace(" ", "")]
        for item in missing:
            warnings.append(f"number '{item}' not found verbatim in manuscript")

    print(f"percentages: {', '.join(sorted(numbers)) if numbers else '(none)'}")
    if warnings:
        print("\nWARNINGS")
        for item in warnings:
            print(f"  - {item}")
    if errors:
        print("\nERRORS")
        for item in errors:
            print(f"  - {item}")
        return 1
    print("\nPASS: no blocking issues found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
