import asyncio
from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from main import app
from planner import Construction, Meaning, PlanRequest, catalog, create_plan, validate_plan


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', '')


def test_candidate_example_and_unknown_input():
    with TestClient(app) as client:
        result = client.post('/api/plan', json={'text': 'Do you understand?'}).json()
        assert result['review_status'] == 'candidate'
        assert result['plan']['grammar']['question_type'] == 'yes_no'
        assert result['validation']['issues'] == []
        assert not result['validation']['executable']
        assert result['validation']['motion_issues']
        assert result['playback'] is None
        for text in ['Do you not understand?', 'Submit it', 'Do you understand before Friday?', 'Do you understand on Friday?']:
            result = client.post('/api/plan', json={'text': text}).json()
            assert result['plan'] is None and result['unresolved']
        assert client.post('/api/plan', json={'text': '   '}).status_code == 422
        assert client.post('/api/plan', json={'text': 'Hello', 'context': ['x' * 3001]}).status_code == 422


def test_request_retains_ambiguity():
    result = asyncio.run(create_plan(PlanRequest(text='Could you explain that again?')))
    assert result['plan']['meaning']['intent'] == 'request'
    assert result['unresolved']
    # Context changes meaning: don't silently reuse a context-free example.
    result = asyncio.run(create_plan(PlanRequest(text='Could you explain that again?', context=['Recursion'])))
    assert result['plan'] is None


def test_rejects_bad_ids_spans_and_meaning_loss():
    refs = catalog()
    example = deepcopy(refs['examples'][0])
    construction = example['construction']
    construction['manual_sequence'][0]['sign_id'] = 'INVENTED'
    construction['nonmanuals'][0]['profile_id'] = 'INVENTED'
    construction['nonmanuals'][0]['end_anchor'] = 'missing'
    construction['expressed_meaning']['negated'] = True
    result = validate_plan(Meaning.model_validate(refs['examples'][0]['meaning']), Construction.model_validate(construction), refs)
    assert len(result['issues']) == 4
    assert not result['executable']


def test_duplicate_and_reversed_anchors():
    refs = catalog(); e = refs['examples'][0]
    c = Construction.model_validate(e['construction'])
    c.nonmanuals[0].start_anchor, c.nonmanuals[0].end_anchor = 's2', 's1'
    assert 'Expression span is reversed.' in validate_plan(Meaning.model_validate(e['meaning']), c, refs)['issues']
    c.manual_sequence[1].id = 's1'
    assert 'Duplicate sign anchors.' in validate_plan(Meaning.model_validate(e['meaning']), c, refs)['issues']


def test_model_pipeline_and_failure(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'test-not-real')
    calls = []
    async def fake(client, schema, instruction, payload):
        calls.append(payload)
        e = catalog()['examples'][0]
        return schema.model_validate(e['meaning'] if schema is Meaning else e['construction'])
    monkeypatch.setattr('planner.model_output', fake)
    result = asyncio.run(create_plan(PlanRequest(text='Does that make sense?', context=['A lesson'])))
    assert result['mode'] == 'experimental-model'
    assert len(calls) == 2 and calls[0]['context'] == ['A lesson']
    assert calls[1]['meaning']['predicate'] == 'understand'
    async def fail(*args):
        raise ValueError('invalid schema or refusal')
    monkeypatch.setattr('planner.model_output', fail)
    result = asyncio.run(create_plan(PlanRequest(text='Unknown')))
    assert result['plan'] is None and result['mode'] == 'unavailable'


def test_rehearsal_does_not_enable_live_playback():
    result = asyncio.run(create_plan(PlanRequest(text='Hello')))
    assert result['rehearsal']['clips'][0]['clip_id'] == 'hello'
    assert result['playback'] is None
    assert result['validation']['executable'] is False


def test_exact_review_enables_playback_and_changes_invalidate_it(monkeypatch, tmp_path):
    import json
    import playback
    refs = catalog()
    example = next(e for e in refs['examples'] if e['english'] == 'Hello')
    record = dict(example_id=example['id'], fingerprint=playback.review_digest(example, refs),
                  decision='approved', reviewer='TEST FIXTURE ONLY', qualification='test',
                  reviewed_at='2026-09-26', evidence='test fixture', meaning_preserved=True,
                  grammar_correct=True, nonmanuals_correct=True, rendered_comprehensible=True)
    reviews = tmp_path / 'reviews.json'
    reviews.write_text(json.dumps({'reviews': [record]}))
    monkeypatch.setattr(playback, 'REVIEWS', reviews)
    result = asyncio.run(create_plan(PlanRequest(text='Hello', context=['A greeting'])) )
    assert result['validation']['executable']
    assert result['playback']['clips'][0]['sign_id'] == 'HELLO'
    monkeypatch.setattr(playback, 'renderer_digest', lambda: 'changed')
    assert not asyncio.run(create_plan(PlanRequest(text='Hello')))['validation']['executable']


def test_timeline_expression_and_unknown_motion():
    from playback import compile_timeline
    refs = catalog()
    c = Construction.model_validate(refs['examples'][0]['construction'])
    c.manual_sequence[0].sign_id = 'HELLO'
    timeline, errors = compile_timeline(c, refs)
    assert not errors
    assert timeline['nonmanuals'][0]['end_ms'] == timeline['duration_ms']
    assert timeline['clips'][1]['start_ms'] == timeline['clips'][0]['end_ms']
    c.nonmanuals.append(c.nonmanuals[0].model_copy())
    assert compile_timeline(c, refs)[0] is None
    c.manual_sequence[0].sign_id = 'INVENTED'
    assert compile_timeline(c, refs)[0] is None


def test_evaluation_contrasts_stay_captions_only():
    import json
    from playback import ROOT
    for case in json.loads((ROOT / 'data/asl/evaluation.json').read_text())['cases']:
        result = asyncio.run(create_plan(PlanRequest(text=case['text'])))
        assert result['playback'] is None
        if case['offline_expectation'] == 'unsupported':
            assert result['plan'] is None
