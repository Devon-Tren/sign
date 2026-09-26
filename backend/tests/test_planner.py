import asyncio
from copy import deepcopy
import pytest
from fastapi.testclient import TestClient
from main import app
from planner import Construction, Meaning, PlanRequest, catalog, create_plan, validate_plan


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', '')
    monkeypatch.setenv('SIGN_PLAYBACK_POLICY', 'candidate')


def test_candidate_example_and_unknown_input():
    with TestClient(app) as client:
        result = client.post('/api/plan', json={'text': 'Do you understand?'}).json()
        assert result['review_status'] == 'candidate'
        assert result['plan']['grammar']['question_type'] == 'yes_no'
        assert result['validation']['issues'] == []
        assert result['validation']['executable']
        assert not result['validation']['motion_issues']
        assert result['playback']['clips'][0]['sign_id'] == 'YOU'
        # Expanding the ASL-LEX extract from 11 to 97 entries gave NOT and DO
        # real descriptors, so this input now composes from catalog signs instead
        # of spelling them. It must still be labelled a candidate.
        result = client.post('/api/plan', json={'text': 'Do you not understand?'}).json()
        assert result['mode'] == 'catalog-composed'
        assert result['review_status'] == 'candidate'
        # ASL-LEX carries NOT_UNDERSTAND as its own lemma, and one lexical sign
        # is better ASL than NOT followed by UNDERSTAND. The planner takes the
        # longest registered expression, so the expansion improved this.
        # Auxiliary DO is not signed: ASL has no do-support, the question is on
        # the face (yes/no brow raise, checked above).
        assert [s['sign_id'] for s in result['plan']['manual_sequence']] == [
            'YOU', 'NOT_UNDERSTAND']
        # The invariant that matters is unchanged: a word with no catalog sign is
        # visibly fingerspelled rather than silently approximated by a near-miss.
        # BEFORE and FRIDAY are registered signs now, so that sentence composes.
        result = client.post('/api/plan', json={'text': 'Do you understand before Friday?'}).json()
        assert result['mode'] == 'catalog-composed'
        assert [s['sign_id'] for s in result['plan']['manual_sequence']] == [
            'YOU', 'UNDERSTAND', 'BEFORE', 'FRIDAY']
        # A main-verb DO is still signed.
        result = client.post('/api/plan', json={'text': 'What do you do?'}).json()
        assert [s['sign_id'] for s in result['plan']['manual_sequence']] == ['WHAT', 'YOU', 'DO']
        for text in ['Submit it', 'Please recalibrate the oscilloscope',
                     'Might you reconsider the premise?']:
            result = client.post('/api/plan', json={'text': text}).json()
            assert result['mode'] == 'fingerspell-fallback'
            assert any(step['sign_id'].startswith('FS:')
                       for step in result['plan']['manual_sequence'])
            assert result['playback']
        assert client.post('/api/plan', json={'text': '   '}).status_code == 422
        assert client.post('/api/plan', json={'text': 'Hello', 'context': ['x' * 3001]}).status_code == 422


def test_request_retains_ambiguity():
    result = asyncio.run(create_plan(PlanRequest(text='Could you explain that again?')))
    assert result['plan']['meaning']['intent'] == 'request'
    assert result['unresolved']
    # Context changes meaning: don't silently reuse a context-free example;
    # the conservative fallback preserves the unresolved reference explicitly.
    result = asyncio.run(create_plan(PlanRequest(text='Could you explain that again?', context=['Recursion'])))
    assert result['mode'] == 'fingerspell-fallback'
    assert any(step['sign_id'] == 'THAT' for step in result['plan']['manual_sequence'])


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
    assert result['mode'] == 'fingerspell-fallback'
    assert result['plan']['manual_sequence'][0]['sign_id'] == 'FS:UNKNOWN'


def test_candidate_policy_enables_labelled_live_playback():
    result = asyncio.run(create_plan(PlanRequest(text='Hello')))
    assert result['rehearsal']['clips'][0]['clip_id'] == 'hello'
    assert result['playback']
    assert result['review_status'] == 'candidate'
    assert result['validation']['playback_policy'] == 'experimental-candidate'


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
    monkeypatch.setenv('SIGN_PLAYBACK_POLICY', 'reviewed-only')
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


def test_evaluation_contrasts_remain_distinct_and_playable():
    import json
    from playback import ROOT
    for case in json.loads((ROOT / 'data/asl/evaluation.json').read_text())['cases']:
        result = asyncio.run(create_plan(PlanRequest(text=case['text'])))
        assert result['plan']['manual_sequence']
        if result['unresolved']:
            assert result['playback'] is None
        else:
            assert result['playback']


def test_how_are_you_candidate_gloss_and_nonmanual_span():
    result = asyncio.run(create_plan(PlanRequest(text='How are you?')))
    assert result['review_status'] == 'candidate'
    assert [step['sign_id'] for step in result['plan']['manual_sequence']] == ['HOW', 'YOU']
    assert result['plan']['grammar']['question_type'] == 'wh'
    assert result['playback']['nonmanuals'][0]['profile_id'] == 'WH_QUESTION_CANDIDATE'
    assert result['playback']['nonmanuals'][0]['end_ms'] == result['playback']['duration_ms']


def test_arbitrary_phrase_fingerspells_unknown_concepts():
    result = asyncio.run(create_plan(PlanRequest(text='Quantum entanglement is fascinating.')))
    assert result['mode'] == 'fingerspell-fallback'
    assert result['playback']['renderer'] == 'sign-procedural-v2'
    assert all(step['sign_id'].startswith('FS:') for step in result['plan']['manual_sequence'])


def test_fast_plan_never_waits_for_model(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'configured-but-not-called')
    async def should_not_run(*args, **kwargs):
        raise AssertionError('fast planning called the model')
    monkeypatch.setattr('planner.model_output', should_not_run)
    result = asyncio.run(create_plan(PlanRequest(
        text='Quantum entanglement is fascinating.', fast=True)))
    assert result['mode'] == 'fingerspell-fallback'
    assert result['playback']


def test_fallback_preserves_negation_time_and_quantity_fields():
    result = asyncio.run(create_plan(PlanRequest(text="Don't submit two files before Friday.")))
    meaning = result['plan']['meaning']
    assert meaning['negated'] is True
    assert meaning['quantities'] == ['two']
    assert meaning['time'] == ['before', 'friday']
    assert result['plan']['manual_sequence'][0]['sign_id'] == 'NOT'


def test_catalog_expansion_is_available_without_mongodb():
    refs = catalog()
    assert len(refs['signs']) >= 40
    assert len(refs['examples']) >= 20
    assert {'HOW', 'YOU', 'FEEL', 'WHAT', 'WHERE'} <= {sign['id'] for sign in refs['signs']}


def test_curated_paraphrases_reuse_candidate_constructions():
    cases = {
        'How are you doing?': ['HOW', 'YOU'],
        'Could you help me?': ['YOU', 'HELP', 'ME'],
        "Where's the bathroom?": ['BATHROOM', 'WHERE'],
        'Please explain again.': ['EXPLAIN', 'AGAIN'],
    }
    for text, expected in cases.items():
        result = asyncio.run(create_plan(PlanRequest(text=text)))
        assert result['mode'] == 'catalog-example'
        assert [step['sign_id'] for step in result['plan']['manual_sequence']] == expected
        assert result['review_status'] == 'candidate'


def test_fallback_prefers_longest_sign_expression_and_inflected_known_signs():
    result = asyncio.run(create_plan(PlanRequest(text='Good morning, teacher.')))
    assert result['mode'] == 'catalog-composed'
    assert [step['sign_id'] for step in result['plan']['manual_sequence']] == ['GOOD_MORNING', 'TEACHER']
    result = asyncio.run(create_plan(PlanRequest(text='They are going home.')))
    assert [step['sign_id'] for step in result['plan']['manual_sequence']] == ['FS:THEY', 'GO', 'HOME']


def test_uncatalogued_modal_is_preserved_instead_of_silently_dropped():
    # CAN, DRINK and WATER are all registered now, so this composes from catalog
    # signs rather than spelling the modal.
    result = asyncio.run(create_plan(PlanRequest(text='Can you drink water?')))
    assert result['mode'] == 'catalog-composed'
    assert [step['sign_id'] for step in result['plan']['manual_sequence']] == ['CAN', 'YOU', 'DRINK', 'WATER']
    assert result['plan']['grammar']['question_type'] == 'yes_no'
    assert result['plan']['nonmanuals'][0]['profile_id'] == 'YES_NO_QUESTION_CANDIDATE'

    # The behaviour under test is what happens to a modal with NO registered
    # sign: it must be spelled and kept in sequence, never silently dropped.
    result = asyncio.run(create_plan(PlanRequest(text='Might you reconsider the premise?')))
    assert result['mode'] == 'fingerspell-fallback'
    sequence = [step['sign_id'] for step in result['plan']['manual_sequence']]
    assert 'FS:MIGHT' in sequence and sequence[0] == 'FS:MIGHT'
