#!/usr/bin/env python3
"""Export a reviewer worksheet. This command never approves catalog entries."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from planner import catalog, Construction
from playback import compile_timeline, review_digest

refs = catalog()
packet = {'instructions': 'Review source meaning, plan, and rendered rehearsal. Fill identity, qualification, evidence, decisions and checks. Copy approved records into data/asl/reviews.json only after actual review.', 'reviews': []}
for example in refs['examples']:
    timeline, issues = compile_timeline(Construction.model_validate(example['construction']), refs)
    packet['reviews'].append({
        'example_id': example['id'], 'fingerprint': review_digest(example, refs),
        'source_text': example['english'], 'context': example.get('context', []),
        'plan': example['construction'], 'timeline': timeline, 'motion_issues': issues,
        'decision': 'pending', 'reviewer': '', 'qualification': '', 'reviewed_at': '',
        'evidence': '', 'meaning_preserved': None, 'grammar_correct': None,
        'nonmanuals_correct': None, 'rendered_comprehensible': None,
        'viewer_back_translation': '', 'corrections': '',
    })
print(json.dumps(packet, indent=2))
