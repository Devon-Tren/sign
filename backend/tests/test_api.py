import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ['SIGN_DB_PATH'] = '/tmp/sign_api_test.db'
os.environ['OPENAI_API_KEY'] = ''  # override a local .env, keeping tests offline

from fastapi.testclient import TestClient
from main import app, pcm_rms
from db import SEED
from interpreter import match_catalog, normalized


def test_health_and_catalog():
    with TestClient(app) as client:
        r = client.get('/api/health')
        assert r.status_code == 200 and r.json()['project'] == 'sign'
        phrases = client.get('/api/phrases').json()
        assert len(phrases) >= 10
        assert all(p['validation_status'] == 'illustrative' for p in phrases)


def test_interpret_without_key():
    with TestClient(app) as client:
        r = client.post('/api/interpret', json={'text': 'Hello, and thank you for coming today.'})
        assert r.status_code == 200
        data = r.json()
        assert data['mode'] == 'catalog-only'
        assert [p['phrase_id'] for p in data['selected']] == ['hello', 'thank_you', 'today']
        assert data['coverage'] == 'illustrative-only'
        assert client.post('/api/interpret', json={'text':'the mitochondria creates ATP'}).json()['coverage'] == 'unsupported'


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
