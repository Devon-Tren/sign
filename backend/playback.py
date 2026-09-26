"""Compile anchored plans for the parameterized avatar; approval is content-bound."""
import hashlib
import json

import motion_data
from curated_motion import definitions, phrase_for, valid_controls
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'data/asl/catalog.json'
REVIEWS = ROOT / 'data/asl/reviews.json'
CUSTOM_MOTIONS = ROOT / 'data/asl_custom_motions.json'


def renderer_digest():
    digest = hashlib.sha256()
    for name in ['frontend/src/clips.ts', 'frontend/src/components/Avatar.tsx',
                 'frontend/src/playback.ts', 'data/asl_lex_params.json',
                 'data/asl_custom_motions.json', 'backend/playback.py',
                 'data/asl_curated_motions.json', 'backend/curated_motion.py',
                 'frontend/src/anchors.ts', 'frontend/src/handshapes.ts', 'frontend/src/signerRig.ts',
                 *[str(p.relative_to(ROOT)) for p in sorted((ROOT / 'frontend/src/motion').glob('*.ts'))]]:
        digest.update((ROOT / name).read_bytes())
    return digest.hexdigest()


def review_digest(example, refs):
    payload = {'example': example,
               'signs': sorted(refs['signs'], key=lambda item: item['id']),
               'profiles': sorted(refs['profiles'], key=lambda item: item['id']),
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
    curated_signs = definitions()['signs']
    phrase_id, phrase = phrase_for([s.sign_id for s in construction.manual_sequence])
    available = motion_data.lex_signs()
    custom = motion_data.custom_signs()
    signs = {s['id']: s for s in refs['signs']}
    profiles = {p['id']: p for p in refs['profiles']}
    clips, spans, issues, offset = [], [], [], 0
    for step in construction.manual_sequence:
        if step.sign_id.startswith('FS:'):
            word = step.sign_id[3:]
            if not word or len(word) > 32 or not word.replace('-', '').isalnum():
                issues.append(f'Invalid fingerspelling token: {step.sign_id}')
                continue
            clip = f'fs:{word}'
            duration = max(700, len(word.replace('-', '')) * 360)
            clips.append({'anchor': step.id, 'sign_id': step.sign_id, 'clip_id': clip,
                          'start_ms': offset, 'end_ms': offset + duration,
                          'realization': 'fingerspelling-approximation', 'source': 'fingerspelling'})
            offset += duration
            continue
        asset = signs.get(step.sign_id, {}).get('motion_asset')
        supported = ((asset or {}).get('format') == 'asl-lex-procedural-v1'
                     and (asset or {}).get('clip_id') in available) or (
                     (asset or {}).get('format') == 'custom-procedural-v1'
                     and (asset or {}).get('clip_id') in custom)
        if not supported:
            issues.append(f'Missing compatible motion: {step.sign_id}')
            continue
        clip = asset['clip_id']
        # A planned timeline is connected signing, not isolated display. The
        # previous 2.1x isolated stretch made the live avatar wade through a
        # lecture; motion_data keeps this in step with the renderer.
        curated_sign = curated_signs.get(step.sign_id)
        duration = curated_sign['duration_ms'] if curated_sign else motion_data.clip_duration_ms(clip, 'continuous')
        clips.append({'anchor': step.id, 'sign_id': step.sign_id, 'clip_id': clip,
                      'start_ms': offset, 'end_ms': offset + duration,
                      'realization': asset['format'],
                      'source': 'curated-sign' if curated_sign else 'procedural'})
        offset += duration
    if phrase and len(clips) == len(construction.manual_sequence):
        offset = phrase['duration_ms']
        for index, clip in enumerate(clips):
            clip.update(start_ms=phrase['boundaries'][index] * offset,
                        end_ms=phrase['boundaries'][index + 1] * offset,
                        source='curated-phrase')
    anchors = {c['anchor']: c for c in clips}
    for span in construction.nonmanuals:
        controls = profiles.get(span.profile_id, {}).get('controls')
        if not controls:
            issues.append(f'Missing compatible expression: {span.profile_id}')
            continue
        if not valid_controls(controls):
            issues.append(f'Invalid expression controls: {span.profile_id}')
            continue
        if span.start_anchor not in anchors or span.end_anchor not in anchors:
            issues.append('Expression anchors have no playable motion.')
            continue
        start, end = anchors[span.start_anchor]['start_ms'], anchors[span.end_anchor]['end_ms']
        if end <= start:
            issues.append('Reversed expression spans are unsupported.')
            continue
        if any(start < s['end_ms'] and end > s['start_ms'] and
               set(controls) & set(s['controls']) for s in spans):
            issues.append('Overlapping expression spans cannot compete for the same controls.')
            continue
        spans.append({'profile_id': span.profile_id, 'start_ms': start, 'end_ms': end, 'controls': controls})
    if issues or not clips:
        return None, issues
    return {'version': 2, 'renderer': 'sign-procedural-v2', 'duration_ms': offset,
            'curated_phrase': phrase_id,
            'clips': clips, 'nonmanuals': spans}, []
