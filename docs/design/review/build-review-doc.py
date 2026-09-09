#!/usr/bin/env python3
"""Build the reviewable single-file version of the design set.

Concatenates the active chapters and inserts a REVIEW block after every
top-level and second-level heading, so the whole design can be walked through
in one file with a verdict per section.

Usage:  python3 docs/design/review/build-review-doc.py <out.md> [--rev N]

Chapters 11 and 12 are history (see their banners) and are deliberately
excluded — the point of this document is to be reviewable as a specification.
"""
import re
import sys
import datetime
from pathlib import Path

DESIGN = Path(__file__).resolve().parent.parent
ACTIVE = [
    "00-overview.md",
    "01-domain-model.md",
    "02-security-privacy.md",
    "03-deployment-model.md",
    "04-ux.md",
    "05-technical.md",
    "06-delivery.md",
    "07-operations.md",
    "08-open-decisions.md",
    "09-decision-register.md",
    "10-findings.md",
    "13-configuration-and-setup.md",
    "14-backup-restore-upgrade.md",
    "15-assessment-and-fees.md",
]

BLOCK = (
    "\n> **REVIEW** — [ ] akkoord   [ ] wijzigen   [ ] bespreken\n"
    "> commentaar:\n>\n\n"
)


def annotate(text: str) -> str:
    """Insert a REVIEW block after each `#`/`##` heading, outside code fences.

    A blockquote banner directly under a heading belongs to that heading, so
    the block goes after the banner rather than splitting the two.
    """
    lines = text.splitlines()
    out, fence, i = [], False, 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            fence = not fence
        out.append(line)
        i += 1
        if fence or not re.match(r"^#{1,2} \S", line):
            continue
        # carry over blank lines and a blockquote banner attached to the heading
        while i < len(lines) and not lines[i].strip():
            out.append(lines[i])
            i += 1
        if i < len(lines) and lines[i].startswith(">"):
            while i < len(lines) and (lines[i].startswith(">") or not lines[i].strip()):
                out.append(lines[i])
                i += 1
        out.append(BLOCK.rstrip("\n"))
        out.append("")
    return "\n".join(out)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    out_path = Path(sys.argv[1])
    rev = sys.argv[sys.argv.index("--rev") + 1] if "--rev" in sys.argv else None
    today = datetime.date.today().isoformat()

    reg = (DESIGN / "09-decision-register.md").read_text(encoding="utf-8")
    fin = (DESIGN / "10-findings.md").read_text(encoding="utf-8")
    n_dec = len(set(re.findall(r"^\| (D-\d{3}) \|", reg, re.M)))
    n_fnd = len(set(re.findall(r"^### (F-\d{2,3}) ", fin, re.M)))

    head = [
        "# SplashTrack — Design & Architecture",
        "",
        f"**Versie:** {today}"
        + (f" (rev. {rev})" if rev else "")
        + " · **Branch:** `design/architecture-phase` · PR #14",
        "",
        f"**{n_dec} beslissingen · {n_fnd} findings · {len(ACTIVE)} actieve hoofdstukken.**",
        "",
        "Hoofdstuk 00 staat op AKKOORD. Hoofdstukken 01–15 blijven in review.",
        "Hoofdstukken 11 en 12 zijn historie en staan bewust niet in dit document.",
        "",
        "Onder elke sectiekop staat een reviewblok. Kruis aan, typ eronder, stuur terug.",
        "",
    ]

    parts = ["\n".join(head)]
    for name in ACTIVE:
        body = (DESIGN / name).read_text(encoding="utf-8")
        parts.append("\n---\n\n" + annotate(body).rstrip() + "\n")

    doc = "\n".join(parts)
    out_path.write_text(doc, encoding="utf-8")
    print(f"{out_path}  ·  {len(doc.splitlines())} regels  ·  "
          f"{doc.count('**REVIEW**')} reviewblokken  ·  "
          f"{n_dec} beslissingen  ·  {n_fnd} findings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
