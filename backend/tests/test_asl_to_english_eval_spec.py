import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'data/asl_to_english/evaluation_cases.json'


def test_asl_to_english_eval_spec_covers_release_risks():
    payload = json.loads(SPEC.read_text())
    cases = payload['cases']
    categories = {case['category'] for case in cases}
    assert {
        'meaning_preservation', 'negation', 'references', 'fingerspelling',
        'numbers', 'signer_generalization', 'observation_failure', 'open_set',
        'contextual_ambiguity',
    } <= categories
    assert payload['required_split'] == 'signer-held-out'
    assert all(case['required_evidence'] for case in cases)
    assert all(case['forbidden_inference'] for case in cases)


def test_observation_failure_and_unsupported_sign_are_distinct():
    cases = {case['id']: case for case in json.loads(SPEC.read_text())['cases']}
    assert cases['occluded-discriminating-movement']['expected_outcome'] == 'observation_failure'
    assert cases['clear-unknown-sign']['expected_outcome'] == 'unsupported_sign'
    assert cases['clear-unknown-sign']['expected_outcome'] in cases['occluded-discriminating-movement']['forbidden_inference']
    assert cases['occluded-discriminating-movement']['expected_outcome'] in cases['clear-unknown-sign']['forbidden_inference']

