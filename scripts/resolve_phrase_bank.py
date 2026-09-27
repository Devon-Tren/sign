#!/usr/bin/env python3
"""Attach an ASL-LEX reference video to every sign in data/asl/phrase_bank.json.

    python scripts/resolve_phrase_bank.py [--props sign_props.json]

Each gloss token is resolved to the ASL-LEX entry its motion was derived from
(data/asl_lex_params.json), else the pinned sense in the bank's `lex_senses`,
else the bare or most frequent `_N` sense of the same EntryID. The entry's
Vimeo video is ASL-LEX's recording of a Deaf signer producing the citation
form - the ground truth to compare the avatar against, one sign at a time.

ASL-LEX 2.0 is CC BY-NC 4.0 (https://asl-lex.org/). Only EntryIDs and video
links are written; see data/LICENSE and NOTICE before redistributing.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import motion_data  # noqa: E402

PROPS_URL = 'https://asl-lex.org/visualization/data/sign_props.json'
BANK = ROOT / 'data/asl/phrase_bank.json'
OUT = ROOT / 'data/asl/phrase_bank_references.json'


def load_props(path: Path | None) -> dict:
    raw = path.read_bytes() if path else urllib.request.urlopen(PROPS_URL, timeout=120).read()
    return {p['EntryID']: p for p in json.loads(raw)}


def lex_entry(token: str, props: dict, senses: dict, derived: dict) -> str | None:
    key = token.lower()
    if key in derived:
        return derived[key]
    if token in senses:
        return senses[token]
    if key in props:
        return key
    variants = [e for e in props if re.fullmatch(re.escape(key) + r'_\d+', e)]
    return max(variants, key=lambda e: float(props[e].get('SignFrequency(M)') or 0), default=None)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--props', type=Path, help=f'local copy of {PROPS_URL}')
    args = parser.parse_args()

    bank = json.loads(BANK.read_text())
    props = load_props(args.props)
    playable = set(motion_data.all_signs())
    derived = {k: v['asl_lex_entry'] for k, v in motion_data.lex_signs().items() if v.get('asl_lex_entry')}

    signs, phrases = {}, []
    for phrase in bank['phrases']:
        tokens = [t for t in phrase['gloss'] if not t.startswith('FS:')]
        for token in tokens:
            if token in signs:
                continue
            entry = lex_entry(token, props, bank['lex_senses'], derived)
            video = props.get(entry, {}).get('VimeoVideo') if entry else None
            signs[token] = {
                'clip_id': token.lower() if token.lower() in playable else None,
                'asl_lex_entry': entry,
                'reference_video': video,
                'asl_lex_page': f'https://asl-lex.org/visualization/?sign={entry}' if entry else None,
            }
        missing_motion = [t for t in tokens if not signs[t]['clip_id']]
        missing_video = [t for t in tokens if not signs[t]['reference_video']]
        phrases.append({'id': phrase['id'], 'status': 'missing_motion' if missing_motion else 'playable',
                        'missing_motion': missing_motion, 'missing_video': missing_video})

    status = Counter(p['status'] for p in phrases)
    OUT.write_text(json.dumps({
        '_license': 'ASL-LEX 2.0 EntryIDs and video links, CC BY-NC 4.0 - see data/LICENSE.',
        '_source': PROPS_URL,
        '_generated_by': 'scripts/resolve_phrase_bank.py',
        '_note': 'reference_video is an isolated citation-form sign by a Deaf signer. '
                 'Phrase-level timing, transitions and non-manual markers need a separate source.',
        'summary': {'phrases': len(phrases), **status, 'unique_signs': len(signs),
                    'signs_with_video': sum(bool(s['reference_video']) for s in signs.values()),
                    'signs_with_motion': sum(bool(s['clip_id']) for s in signs.values())},
        'signs': dict(sorted(signs.items())),
        'phrases': phrases,
    }, indent=2) + '\n')
    print(json.dumps(json.loads(OUT.read_text())['summary'], indent=2))
    for token, sign in sorted(signs.items()):
        if not sign['clip_id'] or not sign['reference_video']:
            print(f"  {token}: motion={'yes' if sign['clip_id'] else 'NO'} video={'yes' if sign['reference_video'] else 'NO'}")


if __name__ == '__main__':
    main()
