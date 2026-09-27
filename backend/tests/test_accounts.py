"""Account boundaries tested against an isolated in-memory MongoDB double."""
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import accounts
import mongomock


@pytest.fixture
def service(monkeypatch):
    db = mongomock.MongoClient(tz_aware=True).sign
    monkeypatch.setattr(accounts, 'get_database', lambda: db)
    accounts.init_accounts()
    app = FastAPI()
    app.include_router(accounts.router)
    return TestClient(app, headers={'X-Sign-Client': 'web'}), db


def register(client, email='one@example.test'):
    return client.post('/api/auth/register', json={'email': email, 'name': 'Learner', 'password': 'long test password 123'})


def attempt(**extra):
    return {'attempt_id': str(uuid4()), 'item_id': 'open', 'score': 96, 'matched': True,
            'hold_frames': 12, 'feedback': 'Measured shape matches.', **extra}


def test_registration_login_and_logout(service):
    client, db = service
    assert client.get('/api/auth/me').status_code == 401
    response = register(client)
    assert response.status_code == 200
    assert 'httponly' in response.headers['set-cookie'].lower()
    assert 'password' not in response.text
    stored = db.users.find_one()
    assert stored['password_hash'] != 'long test password 123'
    assert db.sessions.find_one()['_id'] != client.cookies.get(accounts.COOKIE)
    assert client.get('/api/auth/me').json()['email'] == 'one@example.test'
    assert register(client, 'ONE@example.test').status_code == 409
    assert client.post('/api/auth/logout', json={}).status_code == 200
    assert client.get('/api/auth/me').status_code == 401
    assert db.sessions.count_documents({}) == 0
    assert client.post('/api/auth/login', json={'email':'one@example.test','password':'wrong password 123'}).status_code == 401
    assert client.post('/api/auth/login', json={'email':'one@example.test','password':'long test password 123'}).status_code == 200


def test_attempt_isolation_idempotency_and_summary(service):
    client, db = service
    register(client)
    payload = attempt()
    assert client.post('/api/learning/attempts', json=payload).status_code == 200
    assert client.post('/api/learning/attempts', json=payload).status_code == 200
    assert db.practice_attempts.count_documents({}) == 1
    result = client.get('/api/learning/progress').json()
    assert result['completed'] == ['open']
    assert result['average'] == 96
    assert result['total_attempts'] == 1
    client.post('/api/auth/logout', json={})
    register(client, 'two@example.test')
    assert client.get('/api/learning/progress').json()['total_attempts'] == 0
    assert client.post('/api/learning/attempts', json=attempt(item_id='name')).status_code == 422
    assert client.post('/api/learning/attempts', json=attempt(score=101)).status_code == 422
    assert client.post('/api/learning/attempts', json=attempt(user_id='other')).status_code == 422
    client.post('/api/learning/attempts', json=attempt(score=100, hold_frames=1))
    assert client.get('/api/learning/progress').json()['completed'] == []


def test_expiry_csrf_and_rate_limit(service):
    client, db = service
    assert client.post('/api/auth/register', headers={'X-Sign-Client':''}, json={}).status_code == 403
    assert client.post('/api/auth/register', headers={'Origin':'https://evil.example'}, json={}).status_code == 403
    register(client)
    db.sessions.update_many({}, {'$set': {'expires_at':datetime.now(timezone.utc)-timedelta(seconds=1)}})
    assert client.get('/api/learning/progress').status_code == 401
    for _ in range(12):
        response = client.post('/api/auth/login', json={'email':'one@example.test','password':'incorrect password'})
    assert response.status_code == 429


def test_lecture_ownership_and_explicit_save(service):
    client, db = service
    register(client)
    payload = {'session_id':str(uuid4()), 'title':'Python', 'text':'Functions take arguments.'}
    client.post('/api/lectures', json=payload)
    client.post('/api/lectures', json=payload)
    assert db.lecture_sessions.count_documents({}) == 1
    assert client.get('/api/lectures').json()[0]['text'] == payload['text']
    client.post('/api/auth/logout', json={})
    register(client, 'two@example.test')
    assert client.get('/api/lectures').json() == []
    client.post(f'/api/lectures/{payload["session_id"]}/delete', json={})
    assert db.lecture_sessions.count_documents({}) == 1


def test_storage_unavailable(service, monkeypatch):
    client, _ = service
    monkeypatch.setattr(accounts, 'get_database', lambda: None)
    assert register(client).status_code == 503
