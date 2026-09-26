#!/usr/bin/env python3
"""Evaluate a local ASLLVD CSV without copying annotations into runtime data.

python scripts/evaluate_asllvd.py /path/to/asllvd_signs_2023_10_23.csv
Source: https://dai.cs.rutgers.edu/asllvd/signbank/
Terms: https://www.bu.edu/asllrp/signbank-terms.pdf
Only aggregate statistics are emitted. Exact gloss strings are not proof that
the ASL-LEX and ASLLVD articulations are the same lexical variant.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    args = parser.parse_args()
    rows = list(csv.DictReader(args.csv.read_text(encoding='utf-8-sig').splitlines()))
    labels = {r['main entry gloss label'].lower().replace(' ', '_') for r in rows}
    lex = json.loads((Path(__file__).resolve().parents[1] / 'data/asl_lex_params.json').read_text())['signs']
    print(json.dumps({
        'source_file': args.csv.name,
        'source_sha256': hashlib.sha256(args.csv.read_bytes()).hexdigest(),
        'samples': len(rows), 'main_glosses': len(labels),
        'sign_types': dict(sorted(Counter(r['sign type'] for r in rows).items())),
        'dominant_handshape_changes': sum(r['Dominant start handshape'] != r['Dominant end handshape'] for r in rows),
        'non_dominant_handshape_changes': sum(r['Non-dominant start handshape'] != r['Non-dominant end handshape'] for r in rows),
        'catalog_exact_gloss_matches': sum(r['asl_lex_entry'].lower() in labels for r in lex.values()),
        'orientation_columns': [key for key in rows[0] if 'orient' in key.lower()],
        'morpheme_columns': [key for key in rows[0] if 'morpheme' in key.lower()],
        'decision': 'Reference and handshape-transition review source; not an orientation spec. '
                    'Compound type is present but this flat CSV has no morpheme columns. '
                    'Use the richer ASLLVD annotations for morpheme alignment. No runtime overrides imported.',
    }, indent=2))


if __name__ == '__main__':
    main()
