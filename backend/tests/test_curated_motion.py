from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from main import app
from curated_motion import definitions, phrase_for, validate_definition, valid_controls
from planner import Construction, fallback_plan, catalog
from playback import compile_timeline, renderer_digest


def test_all_curated_data_has_valid_structure_and_registered_signs():
    refs = catalog()
    signs = {s['id'] for s in refs['signs']}
    for name, motion in definitions()['signs'].items():
        assert name in signs
        validate_definition(motion)
    for motion in definitions()['phrases'].values():
        assert set(motion['sequence']) <= signs
        validate_definition(motion, phrase=True)


def test_exact_phrase_wins_and_does_not_consume_suffix():
    refs = catalog()
    _, construction = fallback_plan('hello thank you', refs)
    result, issues = compile_timeline(construction, refs)
    assert not issues
    assert result['curated_phrase'] == 'greeting_thanks_prototype'
    assert result['duration_ms'] == 2300
    assert all(c['source'] == 'curated-phrase' for c in result['clips'])
    assert phrase_for(['HELLO', 'THANK_YOU', 'FS:JAMES']) == (None, None)


def test_individual_override_and_fallbacks():
    refs = catalog()
    _, construction = fallback_plan('hello school xyzzy', refs)
    result, issues = compile_timeline(construction, refs)
    assert not issues
    assert result['clips'][0]['source'] == 'curated-sign'
    assert result['clips'][0]['end_ms'] == 1200
    assert result['clips'][1]['source'] == 'procedural'
    assert result['clips'][2]['clip_id'] == 'fs:XYZZY'


def test_nonmanual_extension_and_overlap_preserve_lexical_scope():
    refs = deepcopy(catalog())
    _, construction = fallback_plan('hello thank you', refs)
    refs['profiles'] += [{'id':'GAZE','controls':{'gaze':[.1,.2,0], 'headNod':.2}}, {'id':'BROW','controls':{'brow':-.6}}]
    payload=construction.model_dump()
    payload['nonmanuals']=[{'profile_id':p,'start_anchor':'s1','end_anchor':'s2'} for p in ['GAZE','BROW']]
    result, issues=compile_timeline(Construction.model_validate(payload), refs)
    assert not issues and len(result['nonmanuals']) == 2
    assert all(s['end_ms'] == 2300 for s in result['nonmanuals'])
    assert not valid_controls({'gaze':[1,2]})
    assert not valid_controls({'invented':.5})
    assert not valid_controls({'mouth':float('nan')})


def test_invalid_keyframe_order_is_rejected():
    record=deepcopy(definitions()['signs']['HELLO'])
    record['keyframes'][1]['t']=0
    with pytest.raises(AssertionError): validate_definition(record)


def test_candidate_policy_still_gates_hybrid_motion(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY','')
    monkeypatch.setenv('SIGN_PLAYBACK_POLICY','reviewed-only')
    with TestClient(app) as client:
        result=client.post('/api/plan',json={'text':'Hello thank you','fast':True}).json()
        assert result['playback'] is None
        assert result['rehearsal']['curated_phrase'] == 'greeting_thanks_prototype'
        assert result['review_status'] == 'candidate'
    assert len(renderer_digest()) == 64
