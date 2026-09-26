import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ['SIGN_DB_PATH'] = '/tmp/sign_api_test.db'
os.environ['OPENAI_API_KEY'] = ''  # override a local .env, keeping tests offline

from fastapi.testclient import TestClient
from main import app, pcm_rms, transcription_keywords
from db import SEED
from interpreter import match_catalog, normalized


def test_health_and_catalog():
    with TestClient(app) as client:
        r = client.get('/api/health')
        assert r.status_code == 200 and r.json()['project'] == 'sign'
        assert r.json()['catalog_consistent'] is True
        assert r.json()['catalog_mismatch_count'] == 0
        phrases = client.get('/api/phrases').json()
        assert len(phrases) >= 100
        assert all(p['validation_status'] == 'illustrative' for p in phrases)
        playable = {p['id']: p['animation_file'] for p in phrases if p['animation_file']}
        assert len(playable) >= 100
        assert playable['hello'] == 'hello'
        assert playable['bathroom'] == 'bathroom'


def test_interpret_without_key():
    with TestClient(app) as client:
        r = client.post('/api/interpret', json={'text': 'Hello, and thank you for coming today.'})
        assert r.status_code == 200
        data = r.json()
        assert data['mode'] == 'catalog-only'
        assert [p['phrase_id'] for p in data['selected']] == ['hello', 'thank_you', 'today']
        assert data['coverage'] == 'illustrative-only'
        assert data['gate']['status'] == 'matched'
        assert data['gate']['confidence'] >= .9
        assert client.post('/api/interpret', json={'text':'the mitochondria creates ATP'}).json()['coverage'] == 'unsupported'


def test_context_gate_disambiguates_intelligence():
    with TestClient(app) as client:
        supported = client.post('/api/interpret', json={
            'text': 'Intelligence can help computers recognize patterns.',
            'context': ['We are studying machine learning.'],
        }).json()
        assert [p['phrase_id'] for p in supported['selected']] == [
            'artificial_intelligence', 'help', 'computer']
        assert supported['selected'][0]['match_kind'] == 'contextual'
        assert supported['gate']['context_used'] is True

        ambiguous = client.post('/api/interpret', json={
            'text': 'Her intelligence impressed the class.',
        }).json()
        assert ambiguous['selected'] == []
        assert ambiguous['gate']['status'] == 'captions-only'
        assert 'more context' in ambiguous['gate']['reason']

        conflicting = client.post('/api/interpret', json={
            'text': 'The military intelligence report arrived.',
            'context': ['A classified agency briefing.'],
        }).json()
        assert conflicting['selected'] == []
        assert 'conflicting context' in conflicting['gate']['reason']


def test_input_validation_and_feedback():
    with TestClient(app) as client:
        assert client.post('/api/interpret', json={'text': ''}).status_code == 422
        r = client.post('/api/feedback', json={'drill_name':'Open hand','observed':'ring finger bent','expected':'four extended fingers','score':70})
        assert r.status_code == 200 and 'ring finger' in r.json()['feedback']


def test_pcm_rms():
    import struct
    assert pcm_rms(struct.pack('<100h', *([0]*100))) == 0
    assert pcm_rms(struct.pack('<100h', *([8192]*100))) > .20
    assert pcm_rms(b'odd') == 0


def test_transcription_keywords_are_catalog_backed_and_safe():
    with TestClient(app):
        keywords = transcription_keywords()
        assert 'Artificial intelligence' in keywords
        assert 'Good morning' in keywords
        assert len(keywords) <= 100
        assert all(len(value) <= 64 and '<' not in value and '\n' not in value for value in keywords)


def test_live_without_secret_has_clear_error():
    with TestClient(app) as client:
        with client.websocket_connect('/ws/live', headers={'origin':'http://localhost:5173'}) as ws:
            message = ws.receive_json()
            assert message['type'] == 'error'
            assert 'OPENAI_API_KEY' in message['message']


def test_origin_rejection():
    from starlette.websockets import WebSocketDisconnect
    with TestClient(app) as client:
        try:
            with client.websocket_connect('/ws/live', headers={'origin':'https://evil.example'}) as ws:
                ws.receive_json()
        except WebSocketDisconnect as exc:
            assert exc.code == 1008
        else:
            raise AssertionError('Untrusted WebSocket Origin was accepted')
