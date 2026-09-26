#!/usr/bin/env python3
"""Export the top 100 orientation worksheet and every unresolved static sign.

python scripts/export_motion_review.py > artifacts/motion-review/review-packet.json
Requires installed frontend dependencies. Never writes approval records.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import motion_data  # noqa: E402
from playback import renderer_digest  # noqa: E402


def main() -> None:
    audit = json.loads(subprocess.check_output(
        ['npm', '--silent', '--prefix', str(ROOT / 'frontend'), 'run', 'audit', '--', '--json'],
        text=True, cwd=ROOT,
    ))
    signs = motion_data.all_signs()
    ranked = sorted((id for id, sign in signs.items() if sign.get('fidelity') == 'exact'),
                    key=lambda id: (-signs[id].get('SignFrequency', 0), id))[:100]
    static = [i['sign'] for i in audit['issues'] if i['kind'] == 'static-path']
    internal = [i['sign'] for i in audit['issues'] if i['kind'] == 'path-free-internal-movement']
    rows = []
    for id in dict.fromkeys([*ranked, *static, *internal]):
        record = signs[id]
        rows.append({
            'clip_id': id, 'frequency_rank': ranked.index(id) + 1 if id in ranked else None,
            'sign_frequency': record.get('SignFrequency'),
            'asl_lex_entry': record.get('asl_lex_entry'),
            'descriptors': record,
            'current_authored_augment': motion_data.augment().get(id, {}),
            'asl_phono_evidence': motion_data.phono_priors().get(id),
            'audit_findings': [i for i in audit['issues'] if i['sign'] == id],
            'reference_search': {'ASL-LEX': 'https://asl-lex.org/visualization/',
                                 'ASLLVD': 'https://dai.cs.rutgers.edu/dai/s/signbank'},
            'review': {'decision': 'pending', 'reviewer': '', 'qualification': '',
                       'reference_url': '', 'reference_variant': '', 'timecodes': '',
                       'palm_start': None, 'point_start': None, 'palm_end': None,
                       'point_end': None, 'movement_direction': None,
                       'path_free_is_correct': None, 'internal_movement_needed': None,
                       'nonmanuals_correct': None, 'back_translation': '', 'notes': ''},
        })
    print(json.dumps({
        'renderer_fingerprint': renderer_digest(),
        'status': 'pending; not a signer review or authorisation to teach',
        'instructions': 'Check the exact lexical variant against source video at start, stroke and end. '
                        'Use signer-relative +x right, +y up, +z away. Record reviewer identity and '
                        'evidence before transferring authored orientation into the augment file. '
                        'Do not copy estimated priors into the authored layer as if verified.',
        'licenses': {'ASL-LEX descriptors and frequencies': 'CC BY-NC 4.0',
                     'ASL-Phono estimates': 'CC BY 4.0'},
        'audit': audit, 'top_100': ranked, 'static_needs_review': static,
        'path_free_with_internal_movement': internal, 'signs': rows,
    }, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
