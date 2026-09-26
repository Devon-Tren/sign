"""Shared authored prototypes. These definitions carry no linguistic approval."""
from functools import lru_cache
from pathlib import Path
import json
import math

FILE = Path(__file__).resolve().parents[1] / 'data/asl_curated_motions.json'
SCALARS = {'brow', 'browRaise', 'browFurrow', 'mouth', 'torso', 'headShake',
           'headNod', 'eyeAperture', 'mouthShape', 'cheek', 'torsoLean', 'bodyShift'}
VECTORS = {'head', 'gaze'}


def valid_controls(controls):
    if not isinstance(controls, dict) or not controls or set(controls) - SCALARS - VECTORS:
        return False
    for name, value in controls.items():
        values = value if name in VECTORS else [value]
        if name in VECTORS and (not isinstance(value, list) or len(value) != 3):
            return False
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not -1 <= v <= 1 for v in values):
            return False
    return True


def validate_definition(record, phrase=False):
    assert record['status'] == 'experimental', 'Authored data cannot grant approval'
    assert record['provenance'] and record['base_clip']
    assert 100 <= record['duration_ms'] <= 60000
    keys = record['keyframes']
    times = [key['t'] for key in keys]
    assert len(times) >= 2 and times[0] == 0 and times[-1] == 1
    assert all(a < b for a, b in zip(times, times[1:]))
    phases = record.get('phases', [.18, .62, .82])
    assert len(phases) == 3 and 0 < phases[0] < phases[1] < phases[2] < 1
    for key in keys:
        controls = {k: v for k, v in key.items() if k not in {'t', 'right', 'left'}}
        assert not controls or valid_controls(controls)
        for side in ('right', 'left'):
            hand = key.get(side, {})
            assert not set(hand) - {'target', 'palm', 'point', 'elbow', 'shape', 'hand', 'contact', 'wristMax'}
            for field in ('target', 'palm', 'point', 'elbow'):
                if field in hand:
                    values = hand[field]
                    assert len(values) == 3 and all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= 2 for v in values)
                    if field != 'target':
                        assert sum(v*v for v in values) > 1e-8
    for span in record.get('nonmanuals', []):
        assert 0 <= span['start'] < span['end'] <= 1 and valid_controls(span['controls'])
    if phrase:
        boundaries = record['boundaries']
        assert record['sequence'] and len(boundaries) == len(record['sequence']) + 1
        assert boundaries[0] == 0 and boundaries[-1] == 1
        assert all(a < b for a, b in zip(boundaries, boundaries[1:]))


@lru_cache(maxsize=1)
def definitions():
    data = json.loads(FILE.read_text())
    for kind in ('signs', 'phrases'):
        for record in data[kind].values():
            validate_definition(record, kind == 'phrases')
    return data


def phrase_for(sequence):
    return next(((name, motion) for name, motion in definitions()['phrases'].items()
                 if motion['sequence'] == sequence), (None, None))
