#!/usr/bin/env python3
"""
1stOne — branded .docx generator for the code-derived documentation set
(Docs 3-6: Architecture, Business Logic, Screen-by-Screen, Ops Runbook).

Approach: brand a pandoc reference.docx with the app's palette
(src/theme/index.ts) — Tahoma body, sky-blue headings (#38bdf8) — then run
pandoc (markdown -> docx) with a clickable Table of Contents for each file.

One generic converter, four outputs. Re-run any time the .md files change:
    python3 docs/build_docx.py
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Brand palette (from src/theme/index.ts)
SKY = "38BDF8"        # action.primary — H1
MINT = "4ECDC4"       # text.mint      — H2
DARKBLUE = "0A6E9E"   # darker sky     — H3+
INK = "1A1A1A"        # near-black body (readable, printable)
SUBTLE = "555555"

DOCS = [
    ("03-architecture-and-data-model.md", "03-architecture-and-data-model.docx",
     "Architecture & Data Model"),
    ("04-business-logic-and-flows.md", "04-business-logic-and-flows.docx",
     "Business Logic & Flows"),
    ("05-screen-by-screen.md", "05-screen-by-screen.docx",
     "Screen-by-Screen Specification"),
    ("06-ops-and-maintenance-runbook.md", "06-ops-and-maintenance-runbook.docx",
     "Operations & Maintenance Runbook"),
]


def build_reference(path):
    """Recolor / re-font pandoc's default reference doc into the 1stOne brand."""
    from docx import Document
    from docx.shared import RGBColor, Pt

    default = os.path.join(HERE, "_reference_default.docx")
    if not os.path.exists(default):
        subprocess.run(
            ["pandoc", "-o", default, "--print-default-data-file", "reference.docx"],
            cwd=HERE, check=True,
        )
    doc = Document(default)

    def hexcolor(h):
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    heading_colors = {
        "Title": SKY, "Heading 1": SKY, "Heading 2": MINT,
        "Heading 3": DARKBLUE, "Heading 4": DARKBLUE,
        "Heading 5": DARKBLUE, "Heading 6": DARKBLUE,
    }
    for style in doc.styles:
        try:
            font = style.font
        except Exception:
            continue
        # Base font = Tahoma everywhere (matches the app's typography mandate)
        font.name = "Tahoma"
        if style.name in heading_colors:
            font.color.rgb = hexcolor(heading_colors[style.name])
        elif style.name in ("Normal", "Body Text", "First Paragraph", "Compact"):
            font.color.rgb = hexcolor(INK)

    # Normal body slightly larger for readability
    try:
        doc.styles["Normal"].font.size = Pt(11)
    except Exception:
        pass

    doc.save(path)


def convert(md, out, ref):
    cmd = [
        "pandoc", os.path.join(HERE, md),
        "-o", os.path.join(HERE, out),
        "--reference-doc", ref,
        "--toc", "--toc-depth=3",
        "-V", "toc-title=Contents",
        "--from", "gfm",
        "--standalone",
    ]
    subprocess.run(cmd, check=True)


def main():
    ref = os.path.join(HERE, "_reference_branded.docx")
    build_reference(ref)
    for md, out, title in DOCS:
        if not os.path.exists(os.path.join(HERE, md)):
            print(f"  SKIP (missing): {md}")
            continue
        convert(md, out, ref)
        print(f"  built {out}  ({title})")
    print("Done.")


if __name__ == "__main__":
    sys.exit(main())
