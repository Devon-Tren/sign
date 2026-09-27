"""Opt-in integration check; creates and removes only its own temporary accounts."""
import os
import secrets
from pathlib import Path
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from pymongo import MongoClient


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    mongo = MongoClient(os.environ['MONGODB_URI'], serverSelectionTimeoutMS=8000)
    db = mongo[os.getenv('MONGODB_DB', 'sign')]
    emails = [f'sign-smoke-{uuid4().hex}@example.test' for _ in range(2)]
    password = secrets.token_urlsafe(32)
    headers = {'X-Sign-Client': 'web', 'Origin': 'http://127.0.0.1:5182'}
    try:
        with httpx.Client(base_url='http://127.0.0.1:5182/api/', headers=headers, timeout=30) as client:
            health = client.get('health').json()
            assert health['catalog_backend'] == 'mongodb'
            assert db.phrases.count_documents({}) > 1000
            for email in emails:
                response = client.post('auth/register', json={'email':email,'name':'Temporary QA learner','password':password})
                assert response.status_code == 200, response.status_code
                assert client.get('learning/progress').json()['total_attempts'] == 0
                client.post('auth/logout', json={}).raise_for_status()
            client.post('auth/login', json={'email':emails[0],'password':password}).raise_for_status()
            attempt = {'attempt_id':str(uuid4()),'item_id':'open','score':96,'matched':True,'hold_frames':12,'feedback':'Synthetic QA measurement'}
            client.post('learning/attempts', json=attempt).raise_for_status()
            client.post('learning/attempts', json=attempt).raise_for_status()
            lecture = {'session_id':str(uuid4()),'title':'Temporary QA lecture','text':'Synthetic test text.'}
            client.post('lectures', json=lecture).raise_for_status()
            client.post('auth/logout', json={}).raise_for_status()
            assert client.get('learning/progress').status_code == 401
            client.post('auth/login', json={'email':emails[0],'password':password}).raise_for_status()
            summary = client.get('learning/progress').json()
            assert summary['total_attempts'] == 1 and summary['completed'] == ['open']
            assert client.get('lectures').json()[0]['text'] == lecture['text']
            client.post('auth/logout', json={}).raise_for_status()
            client.post('auth/login', json={'email':emails[1],'password':password}).raise_for_status()
            assert client.get('learning/progress').json()['total_attempts'] == 0
            assert client.get('lectures').json() == []
            client.post(f'lectures/{lecture["session_id"]}/delete', json={}).raise_for_status()
            assert db.lecture_sessions.count_documents({'session_id':lecture['session_id']}) == 1
            client.post('auth/logout', json={}).raise_for_status()
        print('PASS: Atlas phrases, signup/login/logout, cookie session, idempotent attempts, persistent progress, private transcripts.')
    finally:
        ids = [user['_id'] for user in db.users.find({'email':{'$in':emails}}, {'_id':1})]
        for collection in ('sessions','practice_attempts','lecture_sessions'):
            db[collection].delete_many({'user_id':{'$in':ids}})
        db.users.delete_many({'_id':{'$in':ids}})
        mongo.close()


if __name__ == '__main__':
    main()
