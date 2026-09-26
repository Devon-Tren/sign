"""Compile anchored plans for the parameterized avatar; approval is content-bound."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'data/asl/catalog.json'
REVIEWS = ROOT / 'data/asl/reviews.json'


def renderer_digest():
    digest = hashlib.sha256()
    for name in ['frontend/src/clips.ts', 'frontend/src/components/Avatar.tsx',
                 'frontend/src/playback.ts', 'data/asl_lex_params.json', 'backend/playback.py']:
        digest.update((ROOT / name).read_bytes())
    return digest.hexdigest()


def review_digest(example, refs):
    payload = {'example': example, 'signs': refs['signs'], 'profiles': refs['profiles'],
               'renderer': renderer_digest()}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def approved(example, refs):
    if not example:
        return False
    fingerprint = review_digest(example, refs)
    records = json.loads(REVIEWS.read_text())['reviews']
    return any(r.get('example_id') == example['id'] and r.get('fingerprint') == fingerprint
               and r.get('decision') == 'approved' and r.get('reviewer')
               and r.get('qualification') and r.get('reviewed_at') and r.get('evidence')
               and all(r.get(k) is True for k in ['meaning_preserved', 'grammar_correct',
                   'nonmanuals_correct', 'rendered_comprehensible']) for r in records)


def compile_timeline(construction, refs):
    available = json.loads((ROOT / 'data/asl_lex_params.json').read_text())['signs']
    signs = {s['id']: s for s in refs['signs']}
    profiles = {p['id']: p for p in refs['profiles']}
    clips, spans, issues, offset = [], [], [], 0
    for step in construction.manual_sequence:
        asset = signs.get(step.sign_id, {}).get('motion_asset')
        if not asset or asset.get('format') != 'asl-lex-procedural-v1' or asset.get('clip_id') not in available:
            issues.append(f'Missing compatible motion: {step.sign_id}')
            continue
        clip = asset['clip_id']
        duration = max(1250, int((available[clip]['duration_ms'] or 600) * 2.1 + .5))
        clips.append({'anchor': step.id, 'sign_id': step.sign_id, 'clip_id': clip,
                      'start_ms': offset, 'end_ms': offset + duration})
        offset += duration
    anchors = {c['anchor']: c for c in clips}
    for span in construction.nonmanuals:
        controls = profiles.get(span.profile_id, {}).get('controls')
        if not controls or set(controls) != {'brow', 'mouth', 'head', 'torso'}:
            issues.append(f'Missing compatible expression: {span.profile_id}')
            continue
        values = [controls['brow'], controls['mouth'], controls['torso']]
        head = controls['head']
        if (not isinstance(head, list) or len(head) != 3 or
                any(not isinstance(v, (int, float)) or not -1 <= v <= 1 for v in values + head)):
            issues.append(f'Invalid expression controls: {span.profile_id}')
            continue
        if span.start_anchor not in anchors or span.end_anchor not in anchors:
            issues.append('Expression anchors have no playable motion.')
            continue
        start, end = anchors[span.start_anchor]['start_ms'], anchors[span.end_anchor]['end_ms']
        if end <= start or any(start < s['end_ms'] and end > s['start_ms'] for s in spans):
            issues.append('Reversed or overlapping expression spans are unsupported.')
            continue
        spans.append({'profile_id': span.profile_id, 'start_ms': start, 'end_ms': end, 'controls': controls})
    if issues or not clips:
        return None, issues
    return {'version': 1, 'renderer': 'asl-lex-procedural-v1', 'duration_ms': offset,
            'clips': clips, 'nonmanuals': spans}, []
