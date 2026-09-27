import asyncio
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ['OPENAI_API_KEY'] = ''
os.environ['GEMINI_API_KEY'] = ''

from planner import PlanRequest, create_plan


DEMO = json.loads((ROOT / 'data/asl/demo_utterances.json').read_text())['phrases']


def plan(text: str):
    return asyncio.run(create_plan(PlanRequest(text=text)))


def gloss(result):
    return [step['sign_id'] for step in result['plan']['manual_sequence']]


def test_all_48_demo_inputs_are_playable_without_unknown_word_spelling():
    assert [case['id'] for case in DEMO] == [f'demo-{number:02d}' for number in range(1, 49)]
    proper_name_cases = {'demo-13': ['FS:HECTOR'], 'demo-18': ['FS:MAYA']}
    for case in DEMO:
        result = plan(case['english'])
        spelled = [sign_id for sign_id in gloss(result) if sign_id.startswith('FS:')]
        assert spelled == proper_name_cases.get(case['id'], []), case['id']
        assert result['playback'], case['id']
        assert result['validation']['issues'] == [], case['id']
        assert result['validation']['motion_issues'] == [], case['id']
        assert result['review_status'] == 'candidate', case['id']


def test_requested_meaning_contrasts_remain_distinct():
    results = {number: plan(DEMO[number - 1]['english']) for number in range(1, 49)}
    assert 'HELP' in gloss(results[1]) and 'HELP' in gloss(results[2])
    assert results[1]['plan']['grammar']['question_type'] == 'yes_no'
    assert results[2]['plan']['grammar']['question_type'] == 'none'
    assert gloss(results[7]) == gloss(results[8]) == ['THAT', 'AGAIN']
    assert 'BATHROOM' in gloss(results[19]) and 'BATHROOM' in gloss(results[20])
    assert gloss(results[23])[-1] == 'UPSTAIRS'
    assert gloss(results[24])[-1] == 'DOWNSTAIRS'
    assert results[25]['plan']['meaning']['negated'] is False
    assert results[30]['plan']['meaning']['negated'] is True
    assert results[31]['plan']['meaning']['negated'] is False
    assert results[32]['plan']['meaning']['negated'] is True
    assert results[31]['plan']['grammar']['question_type'] == 'none'
    assert results[35]['plan']['grammar']['question_type'] == 'yes_no'
    assert results[33]['plan']['meaning']['references'] == ['first_part']
    assert results[34]['plan']['meaning']['references'] == ['last_part']
    assert results[34]['plan']['meaning']['negated'] is True


def test_requested_name_number_and_date_variations_are_preserved():
    assert gloss(plan('My name is Maya.'))[-1] == 'FS:MAYA'
    assert gloss(plan('Why does this loop run three times?')) == [
        'WHY', 'THIS', 'LOOP', 'RUN', 'THREE', 'TIME',
    ]
    assert gloss(plan('Goodbye, see you next week.')) == [
        'GOODBYE', 'SEE', 'YOU', 'NEXT', 'WEEK',
    ]
    unsupported_date = gloss(plan('The assignment is due September 26.'))
    assert 'FS:SEPTEMBER' in unsupported_date and 'FS:26' in unsupported_date
