#!/usr/bin/env python3
"""Regenerate data/asl_lex_params.json from the ASL-LEX 2.0 database.

ASL-LEX 2.0 is CC BY-NC 4.0 (https://asl-lex.org/). This script extracts
phonological descriptors for the handful of catalog entries this prototype
animates; it does not vendor or redistribute the source database. Run it only
if you need to refresh or extend the extract.

    python scripts/extract_asl_lex.py

The generated file is committed, so a normal checkout needs no network access.
See data/LICENSE and NOTICE for attribution obligations before redistributing.
"""
from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://raw.githubusercontent.com/ASL-LEX/asl-lex/master"
    "/data-analysis/scripts/data/signdata_updated11-18.csv"
)
OUT = Path(__file__).resolve().parent.parent / "data" / "asl_lex_params.json"

# catalog phrase id -> (ASL-LEX EntryID, how faithful the mapping is)
#
# "exact"       the catalog entry and the ASL-LEX lemma are the same sign.
# "approximate" the nearest single lexical sign; NOT the same thing as the
#               catalog phrase. Flagged so the UI can say so.
MAPPING: dict[str, tuple[str, str, str]] = {
    "hello":       ("hello",      "exact",       ""),
    "thank_you":   ("thank_you",  "exact",       ""),
    "help":        ("help",       "exact",       ""),
    "no":          ("no",         "exact",       ""),
    "yes":         ("yes",        "exact",       ""),
    "learn":       ("learn",      "exact",       ""),
    "today":       ("today",      "exact",       ""),
    "understand":  ("understand", "exact",       ""),
    "computer":    ("computer",   "exact",       ""),
    "good_morning": ("morning",   "approximate",
                     "GOOD MORNING is a compound; only the MORNING component is "
                     "described here. The GOOD component is not represented."),
    "question":    ("ask",        "approximate",
                     "Nearest single lexeme is ASK. English 'question' has no "
                     "single ASL equivalent; QMwg (question-mark wiggle) differs."),
    # artificial_intelligence: intentionally absent. It is a compound/
    # fingerspelled item with no single ASL-LEX lexical entry.
}

COLUMNS = [
    "Handshape", "SelectedFingers", "Flexion", "FlexionChange",
    "Spread", "SpreadChange", "ThumbPosition", "ThumbContact",
    "SignType", "Movement", "RepeatedMovement",
    "MajorLocation", "MinorLocation", "SecondMinorLocation",
    "Contact", "NonDominantHandshape", "UlnarRotation",
]


def main() -> None:
    with urllib.request.urlopen(SOURCE_URL) as response:
        raw = response.read().decode("utf-8", errors="replace")
    rows = {
        (row.get("EntryID") or "").strip().lower(): row
        for row in csv.DictReader(io.StringIO(raw))
    }

    signs: dict[str, dict] = {}
    for phrase_id, (entry_id, fidelity, note) in MAPPING.items():
        row = rows.get(entry_id)
        if row is None:
            raise SystemExit(f"ASL-LEX entry {entry_id!r} not found; schema may have changed")
        params = {col: (row.get(f"{col}.2.0") or "").strip() or None for col in COLUMNS}
        duration = (row.get("SignDuration(ms)") or "").strip()
        signs[phrase_id] = {
            "asl_lex_entry": row.get("EntryID"),
            "asl_lex_lemma_id": row.get("LemmaID"),
            "fidelity": fidelity,
            "mapping_note": note or None,
            "duration_ms": int(float(duration)) if duration else None,
            **params,
        }

    OUT.write_text(json.dumps({
        "_license": "CC BY-NC 4.0 - see data/LICENSE. NOT covered by the repo's MIT license.",
        "_source": "ASL-LEX 2.0 (Sehyr, Caselli, Cohen-Goldberg & Emmorey, 2021) https://asl-lex.org/",
        "_source_url": SOURCE_URL,
        "_generated_by": "scripts/extract_asl_lex.py",
        "_warning": (
            "Phonological description only. These are linguistic annotations, not an "
            "animation specification. Rendering them is interpretation and the result "
            "is NOT validated ASL until a qualified Deaf signer reviews it."
        ),
        "signs": signs,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(OUT.parent.parent)} ({len(signs)} entries)")


if __name__ == "__main__":
    main()
