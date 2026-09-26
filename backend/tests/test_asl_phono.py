"""Evidence gates, provenance and reproducibility of the ASL-Phono import."""
import itertools
import json
import math
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'backend'))
from extract_asl_phono import consensus, direction_vector  # noqa: E402
import motion_data  # noqa: E402


def sample(*directions, score=0.6, name='one'):
    return {'_sample_id': name, 'frames': [
        {'phonology': {'orientation_dh': {'value': d, 'score': score}}}
        for d in directions
    ]}


def test_strict_majority_and_separate_confidence():
    tied = consensus([sample('up', 'down', score=0.99)], 'orientation_dh')
    assert tied['consensus'] == 0.5 and not tied['accepted']
    majority = consensus([sample('up', 'up', 'down', score=0.2)], 'orientation_dh')
    assert majority['accepted'] and majority['direction'] == 'up'
    assert majority['mean_confidence'] == pytest.approx(0.2)
    assert majority['consensus'] == pytest.approx(2 / 3)


def test_frame_votes_are_not_misrepresented_as_sample_votes():
    result = consensus([sample('up', 'up', 'up'), sample('down', name='two')], 'orientation_dh')
    assert result['votes'] == 3 and result['observations'] == 4
    assert result['supporting_samples'] == 1


def test_null_invalid_and_nonfinite_observations_abstain():
    values = [sample('left_right'), sample('nowhere'), sample('up', score=math.nan),
              sample('up', score=2), sample('up', score=True), {'frames': [{}]}]
    assert consensus(values, 'orientation_dh') is None
    assert consensus([sample('up')], 'movement_dh') is None


def test_all_26_directions_are_unit_vectors_in_signer_space():
    seen = set()
    for tokens in itertools.product(('', 'left', 'right'), ('', 'up', 'down'), ('', 'front', 'body')):
        if not any(tokens):
            continue
        vector = direction_vector('_'.join(filter(None, tokens)))
        assert math.hypot(*vector) == pytest.approx(1)
        seen.add(tuple(vector))
    assert len(seen) == 26
    assert direction_vector('right') == [1, 0, 0]
    assert direction_vector('up') == [0, 1, 0]
    assert direction_vector('front') == [0, 0, 1]
    assert direction_vector('body') == [0, 0, -1]
    for invalid in ('', 'left_right', 'up_up', 'up_down', 'front_body', 'forward'):
        with pytest.raises(ValueError):
            direction_vector(invalid)


def test_committed_priors_are_exact_matches_with_auditable_votes():
    priors = motion_data.phono_priors()
    assert priors
    for clip_id, prior in priors.items():
        assert prior['label'] == motion_data.lex_signs()[clip_id]['asl_lex_entry']
        assert prior['sample_count'] == len(set(prior['sample_ids']))
        assert set(prior) == {'label', 'sample_count', 'sample_ids', 'orientation_dh', 'movement_dh'}
        for channel in ('orientation_dh', 'movement_dh'):
            evidence = prior[channel]
            if not evidence:
                continue
            assert evidence['consensus'] == evidence['votes'] / evidence['observations']
            assert evidence['accepted'] == (evidence['consensus'] > 0.5)
            assert evidence['vector'] == direction_vector(evidence['direction'])
            assert 1 <= evidence['supporting_samples'] <= prior['sample_count']
            assert 0 <= evidence['mean_confidence'] <= 1
    data = json.loads(motion_data.PHONO_FILE.read_text())
    assert data['_license'] == 'CC BY 4.0'
    assert data['_stats']['matched_signs'] == len(priors)
    assert len(data['_archive_sha256']) == 64


def test_render_review_fingerprint_covers_prior_and_rig(monkeypatch):
    import playback
    original = Path.read_bytes
    baseline = playback.renderer_digest()
    for name in ('data/asl_phono_priors.json', 'frontend/src/phono.ts',
                 'frontend/src/anchors.ts', 'frontend/src/handshapes.ts', 'frontend/src/signerRig.ts'):
        target = ROOT / name
        with monkeypatch.context() as patch:
            patch.setattr(Path, 'read_bytes', lambda path: original(path) + (b'\n' if path == target else b''))
            assert playback.renderer_digest() != baseline, name


def test_frequency_is_available_for_review_prioritisation():
    for record in motion_data.lex_signs().values():
        assert 0 <= record['SignFrequency'] <= 7
