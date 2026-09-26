#!/usr/bin/env python3
"""Regenerate data/asl_lex_params.json from the ASL-LEX 2.0 database.

ASL-LEX 2.0 is CC BY-NC 4.0 (https://asl-lex.org/). This script extracts
phonological descriptors for the catalog entries this prototype animates; it
does not vendor or redistribute the source database. Run it only if you need
to refresh or extend the extract.

    python scripts/extract_asl_lex.py

The generated file is committed, so a normal checkout needs no network access.
See data/LICENSE and NOTICE for attribution obligations before redistributing.

Every catalog entry that has a plausible ASL-LEX lemma is mapped here. Entries
with no lemma stay in data/asl_custom_motions.json and are reported by
scripts/audit_motions.py as descriptor-free, so the gap stays visible instead
of being silently filled with a guess.
"""
from __future__ import annotations

import csv
import io
import json
import re
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://raw.githubusercontent.com/ASL-LEX/asl-lex/master"
    "/data-analysis/scripts/data/signdata_updated11-18.csv"
)
OUT = Path(__file__).resolve().parent.parent / "data" / "asl_lex_params.json"

# catalog phrase id -> (ASL-LEX EntryID, how faithful the mapping is, note)
#
# "exact"       the catalog entry and the ASL-LEX lemma are the same sign.
# "approximate" the nearest single lexical sign; NOT the same thing as the
#               catalog phrase. Flagged so the UI can say so.
MAPPING: dict[str, tuple[str, str, str]] = {
    # -- exact lemma matches -------------------------------------------------
    "hello":       ("hello",      "exact", ""),
    "thank_you":   ("thank_you",  "exact", ""),
    "help":        ("help",       "exact", ""),
    "no":          ("no",         "exact", ""),
    "yes":         ("yes",        "exact", ""),
    "learn":       ("learn",      "exact", ""),
    "today":       ("today",      "exact", ""),
    "understand":  ("understand", "exact", ""),
    "computer":    ("computer",   "exact", ""),
    "again":       ("again",      "exact", ""),
    "alone":       ("alone",      "exact", ""),
    "ask":         ("ask",        "exact", ""),
    "bad":         ("bad",        "exact", ""),
    "bathroom":    ("bathroom",   "exact", ""),
    "bottle":      ("bottle",     "exact", ""),
    "cold":        ("cold",       "exact", ""),
    "come":        ("come",       "exact", ""),
    "different":   ("different",  "exact", ""),
    "drink":       ("drink",      "exact", ""),
    "due":         ("due",        "exact", ""),
    "example":     ("example",    "exact", ""),
    "feel":        ("feel",       "exact", ""),
    "find":        ("find",       "exact", ""),
    "first":       ("first",      "exact", ""),
    "friend":      ("friend",     "exact", ""),
    "give":        ("give",       "exact", ""),
    "go":          ("go",         "exact", ""),
    "good":        ("good",       "exact", ""),
    "group":       ("group",      "exact", ""),
    "happy":       ("happy",      "exact", ""),
    "have":        ("have",       "exact", ""),
    "here":        ("here",       "exact", ""),
    "home":        ("home",       "exact", ""),
    "how":         ("how",        "exact", ""),
    "last":        ("last",       "exact", ""),
    "like":        ("like",       "exact", ""),
    "me":          ("me",         "exact", ""),
    "meet":        ("meet",       "exact", ""),
    "name":        ("name",       "exact", ""),
    "near":        ("near",       "exact", ""),
    "need":        ("need",       "exact", ""),
    "next":        ("next",       "exact", ""),
    "nice":        ("nice",       "exact", ""),
    "not":         ("not",        "exact", ""),
    "now":         ("now",        "exact", ""),
    "ok":          ("ok",         "exact", ""),
    "or":          ("or",         "exact", ""),
    "please":      ("please",     "exact", ""),
    "run":         ("run",        "exact", ""),
    "sad":         ("sad",        "exact", ""),
    "school":      ("school",     "exact", ""),
    "science":     ("science",    "exact", ""),
    "see":         ("see",        "exact", ""),
    "show":        ("show",       "exact", ""),
    "slow":        ("slow",       "exact", ""),
    "sorry":       ("sorry",      "exact", ""),
    "step":        ("step",       "exact", ""),
    "stuck":       ("stuck",      "exact", ""),
    "student":     ("student",    "exact", ""),
    "study":       ("study",      "exact", ""),
    "teacher":     ("teacher",    "exact", ""),
    "that":        ("that",       "exact", ""),
    "thirsty":     ("thirsty",    "exact", ""),
    "three":       ("three",      "exact", ""),
    "time":        ("time",       "exact", ""),
    "tired":       ("tired",      "exact", ""),
    "tomorrow":    ("tomorrow",   "exact", ""),
    "want":        ("want",       "exact", ""),
    "water":       ("water",      "exact", ""),
    "way":         ("way",        "exact", ""),
    "we":          ("we",         "exact", ""),
    "week":        ("week",       "exact", ""),
    "when":        ("when",       "exact", ""),
    "where":       ("where",      "exact", ""),
    "why":         ("why",        "exact", ""),
    "word":        ("word",       "exact", ""),
    "work":        ("work",       "exact", ""),
    "you":         ("you",        "exact", ""),

    # -- approximate: nearest single lemma, NOT the same sign ---------------
    "good_morning": ("morning", "approximate",
                     "GOOD MORNING is a compound; only the MORNING component is "
                     "described here. The GOOD component is not represented."),
    "question":     ("ask", "approximate",
                     "Nearest single lexeme is ASK. English 'question' has no "
                     "single ASL equivalent; QMwg (question-mark wiggle) differs."),
    "accessible":   ("access", "approximate",
                     "ACCESS is the nearest lemma; ACCESSIBLE is not a distinct "
                     "ASL-LEX entry."),
    "assignment":   ("homework", "approximate",
                     "HOMEWORK is the nearest lemma. ASSIGNMENT in a classroom "
                     "register is often fingerspelled or compounded."),
    "classroom":    ("class", "approximate",
                     "CLASS describes the group, not the room. CLASSROOM is a "
                     "CLASS+ROOM compound that ASL-LEX does not code."),
    "code":         ("program", "approximate",
                     "PROGRAM is the nearest lemma. CODE in a software sense is "
                     "commonly fingerspelled."),
    "downstairs":   ("down", "approximate",
                     "DOWN is a direction, not the STAIRS-relative locative. The "
                     "real sign is directional and not captured by this lemma."),
    "eat":          ("eat_1", "approximate",
                     "ASL-LEX splits EAT into eat_1 and eat_2; eat_1 is used here."),
    "everyone":     ("all", "approximate",
                     "ALL is the nearest lemma; EVERYONE is ALL+ONE-style "
                     "compounding that ASL-LEX does not code."),
    "goodbye":      ("bye", "approximate",
                     "BYE is the nearest lemma."),
    "loop":         ("circle", "approximate",
                     "CIRCLE describes the path only. LOOP as a programming term "
                     "has no ASL-LEX lemma and is commonly fingerspelled."),
    "mean":         ("mean_1", "approximate",
                     "ASL-LEX splits MEAN into mean_1 and mean_2; mean_1 is used."),
    "represent":    ("show", "approximate",
                     "SHOW is the nearest lemma; REPRESENT is not distinctly coded."),
    "say":          ("tell", "approximate",
                     "TELL is the nearest lemma; SAY is not distinctly coded."),
    "speak":        ("talk", "approximate",
                     "TALK is the nearest lemma."),
    "this":         ("this/it", "approximate",
                     "ASL-LEX codes this lemma as 'this/it'; the deictic use "
                     "depends on real-world pointing this descriptor cannot carry."),
    "upstairs":     ("up", "approximate",
                     "UP is a direction, not the STAIRS-relative locative."),
    "variable":     ("change", "approximate",
                     "CHANGE is the nearest lemma. VARIABLE as a programming term "
                     "has no ASL-LEX lemma and is commonly fingerspelled."),
    "what":         ("what_1", "approximate",
                     "ASL-LEX splits WHAT into what_1 and what_2; what_1 is used."),

    # Intentionally absent - no plausible single ASL-LEX lemma. These stay in
    # data/asl_custom_motions.json and remain flagged as descriptor-free:
    #   artificial_intelligence, compile, do, explain, five, part, refill
}

# Per-morpheme descriptor block. ASL-LEX codes up to six morphemes; a compound
# such as GOOD MORNING is two sequential articulations, which a single-block
# schema flattens into one wrong movement.
MORPHEME_COLUMNS = [
    "Handshape", "SelectedFingers", "Flexion", "FlexionChange",
    "Spread", "SpreadChange", "ThumbPosition", "ThumbContact",
    "SignType", "Movement", "RepeatedMovement",
    "MajorLocation", "MinorLocation", "SecondMinorLocation",
    "Contact", "NonDominantHandshape", "UlnarRotation",
]
# Sign-level columns that are not per-morpheme.
SIGN_COLUMNS = ["Initialized", "FingerspelledLoanSign", "Compound", "NumberOfMorphemes"]

MAX_MORPHEMES = 6

# Auto-expansion. Beyond the curated MAPPING above, every ASL-LEX entry whose id
# is a single clean token and whose subjective frequency rating clears this
# threshold is extracted under its own id. ASL-LEX rates SignFrequency(M) on a
# 1-7 scale; 4.0 keeps ~1,300 everyday signs and drops the long tail of rare
# lemmas that would bloat the bundle without being reachable from ordinary text.
#
# This is what lets the avatar SIGN rather than spell. Fingerspelling an unknown
# word is a visible admission of a coverage gap, not a translation, so the
# cheapest real improvement is to have fewer gaps.
AUTO_MIN_FREQUENCY = 4.0
AUTO_ID = re.compile(r"[a-z][a-z0-9_']*")
#: Sense-split lemmas (what_1/what_2). Picking one arbitrarily would assert a
#: sense the data does not choose, so they are left to the curated MAPPING.
SENSE_SUFFIXES = ('_1', '_2', '_3', '_4')

#: English function words excluded from auto-expansion. ASL does not lexicalise
#: these: there is no article, the copula is not signed, and conjunctions and
#: light prepositions are carried by space, role shift and non-manual marking
#: rather than by separate signs. Auto-adding them made the planner emit
#: HELLO AND THANK-YOU FOR TODAY, which is English word order wearing signs, not
#: ASL. Several do exist as ASL-LEX lemmas; they are excluded from the automatic
#: pass only, so the curated MAPPING above can still register one deliberately.
FUNCTION_WORDS = frozenset("""
a an the is are am was were be been being
of to and for but or so if then than as at by from in into on with
""".split())


def _blank(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _coded(value: str | None) -> bool:
    """ASL-LEX writes the literal string "NA" for an uncoded cell."""
    return bool(value) and value != "NA"


def _frequency(row: dict) -> float:
    try:
        return float((row.get('SignFrequency(M)') or '').strip() or 0)
    except ValueError:
        return 0.0


def _auto_entries(rows: dict[str, dict], curated: set[str]) -> dict[str, tuple[str, str, str]]:
    """Every common, unambiguous lemma not already covered by MAPPING."""
    out: dict[str, tuple[str, str, str]] = {}
    for entry_id, row in rows.items():
        if entry_id in curated or entry_id in out:
            continue
        if not AUTO_ID.fullmatch(entry_id) or entry_id.endswith(SENSE_SUFFIXES):
            continue
        if entry_id in FUNCTION_WORDS:
            continue
        if _frequency(row) < AUTO_MIN_FREQUENCY:
            continue
        out[entry_id] = (entry_id, 'exact', '')
    return out


def _morpheme(row: dict, index: int) -> dict | None:
    """Descriptors for morpheme `index` (1-based). M1 has no column suffix.

    "NA" is preserved inside the block, because on a coded morpheme it carries
    meaning (SecondMinorLocation="NA" means the sign does not relocate), but a
    morpheme whose handshape AND location are both "NA" is not coded at all.
    """
    infix = "" if index == 1 else f"M{index}"
    block = {
        col: _blank(row.get(f"{col}{infix}.2.0"))
        for col in MORPHEME_COLUMNS
    }
    if not _coded(block["Handshape"]) and not _coded(block["MajorLocation"]):
        return None
    return block


def main() -> None:
    with urllib.request.urlopen(SOURCE_URL) as response:
        raw = response.read().decode("utf-8", errors="replace")
    rows = {
        (row.get("EntryID") or "").strip().lower(): row
        for row in csv.DictReader(io.StringIO(raw))
    }

    mapping = dict(MAPPING)
    mapping.update(_auto_entries(rows, {e for e, _, _ in MAPPING.values()} | set(MAPPING)))

    signs: dict[str, dict] = {}
    for phrase_id, (entry_id, fidelity, note) in sorted(mapping.items()):
        row = rows.get(entry_id)
        if row is None:
            raise SystemExit(f"ASL-LEX entry {entry_id!r} not found; schema may have changed")

        morphemes = [m for m in (_morpheme(row, i) for i in range(1, MAX_MORPHEMES + 1)) if m]
        if not morphemes:
            raise SystemExit(f"ASL-LEX entry {entry_id!r} has no coded morpheme")
        declared = _blank(row.get("NumberOfMorphemes.2.0"))
        if declared and declared.isdigit() and int(declared) != len(morphemes):
            print(f"  note: {entry_id} declares {declared} morphemes, "
                  f"{len(morphemes)} are coded")

        duration = (row.get("SignDuration(ms)") or "").strip()
        record = {
            "asl_lex_entry": row.get("EntryID"),
            "fidelity": fidelity,
            "duration_ms": int(float(duration)) if duration else None,
            # Morpheme 1 is promoted to the top level so the renderer reads one
            # descriptor block; `morphemes` carries the full sequence, and is
            # omitted entirely for the single-morpheme majority.
            **morphemes[0],
        }
        if note:
            record["mapping_note"] = note
        if len(morphemes) > 1:
            record["morphemes"] = morphemes
            record["NumberOfMorphemes"] = str(len(morphemes))
        # Null fields carry no information and are ~40% of the file at this size.
        signs[phrase_id] = {k: v for k, v in record.items() if v is not None}

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
        "_schema": (
            "Morpheme 1 descriptors are promoted to the top level for renderer "
            "compatibility; `morphemes` holds the full sequence (ASL-LEX codes up "
            "to six). `fidelity` is 'exact' or 'approximate'; read `mapping_note` "
            "before trusting an approximate entry."
        ),
        "signs": signs,
    }, indent=2) + "\n", encoding="utf-8")

    exact = sum(1 for v in signs.values() if v["fidelity"] == "exact")
    multi = sum(1 for v in signs.values() if v.get("morphemes"))
    size = OUT.stat().st_size / 1024
    print(f"wrote {OUT.relative_to(OUT.parent.parent)} "
          f"({len(signs)} entries: {exact} exact, {len(signs) - exact} approximate, "
          f"{multi} multi-morpheme, {size:.0f} KB)")


if __name__ == "__main__":
    main()
