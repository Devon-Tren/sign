"""Atlas accounts and private, client-measured learning history."""
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError

from catalog_store import get_database

router = APIRouter(prefix='/api')
COOKIE = 'sign_session'
SCORABLE = {'open', 'fist', 'index', 'two-open', 'hello', 'thank_you', 'please', 'me', 'you', 'understand', 'question'}


def database():
    db = get_database()
    if db is None:
        raise HTTPException(503, 'Account storage is unavailable. Please try again shortly.')
    return db


def init_accounts():
    db = get_database()
    if db is None:
        return
    db.users.create_index('email', unique=True)
    db.sessions.create_index('expires_at', expireAfterSeconds=0)
    db.auth_limits.create_index('expires_at', expireAfterSeconds=0)
    db.practice_attempts.create_index([('user_id', 1), ('attempt_id', 1)], unique=True)
    db.practice_attempts.create_index([('user_id', 1), ('created_at', -1)])
    db.lecture_sessions.create_index([('user_id', 1), ('session_id', 1)], unique=True)
    db.lecture_sessions.create_index([('user_id', 1), ('created_at', -1)])


def write_guard(request: Request):
    # A custom header forces cross-origin requests through CORS preflight.
    if request.headers.get('x-sign-client') != 'web':
        raise HTTPException(403, 'Invalid request origin.')
    origin = request.headers.get('origin')
    allowed = os.getenv('SIGN_ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',')
    local = f'{request.url.scheme}://{request.headers.get("host", "")}'
    if origin and origin not in [value.strip() for value in allowed] and origin != local:
        raise HTTPException(403, 'Invalid request origin.')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


class Credentials(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator('email')
    @classmethod
    def email_valid(cls, value):
        value = value.strip().casefold()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter a valid email address.')
        return value


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=80)

    @field_validator('name')
    @classmethod
    def name_valid(cls, value):
        if not value.strip():
            raise ValueError('Enter your name.')
        return value.strip()


def throttle(request, email):
    now = datetime.now(timezone.utc)
    bucket = int(now.timestamp()) // 900
    db = database()
    for key, limit in [(request.client.host if request.client else 'unknown', 40), (email, 12)]:
        record = db.auth_limits.find_one_and_update(
            {'_id': digest(f'{key}:{bucket}')},
            {'$inc': {'count': 1}, '$setOnInsert': {'expires_at': now + timedelta(minutes=30)}},
            upsert=True, return_document=True)
        if record['count'] > limit:
            raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.')


def public_user(user):
    return {'id': user['_id'], 'name': user['name'], 'email': user['email']}


def current_user(request: Request):
    token = request.cookies.get(COOKIE, '')
    if not token:
        raise HTTPException(401, 'Sign in to view your saved progress.')
    db = database()
    session = db.sessions.find_one({'_id': digest(token), 'expires_at': {'$gt': datetime.now(timezone.utc)}})
    user = db.users.find_one({'_id': session['user_id']}) if session else None
    if not user:
        raise HTTPException(401, 'Your session expired. Please sign in again.')
    return user


def start_session(user, response, request):
    token = secrets.token_urlsafe(32)
    db = database()
    old = request.cookies.get(COOKIE)
    if old:
        db.sessions.delete_one({'_id': digest(old)})
    db.sessions.insert_one({'_id': digest(token), 'user_id': user['_id'],
                            'expires_at': datetime.now(timezone.utc) + timedelta(days=7)})
    secure_default = 'true' if os.getenv('VERCEL') else 'false'
    response.set_cookie(COOKIE, token, max_age=604800, httponly=True, samesite='lax',
                        secure=os.getenv('SIGN_COOKIE_SECURE', secure_default).lower() == 'true', path='/api')
    response.headers['Cache-Control'] = 'no-store'
    return public_user(user)


@router.post('/auth/register', dependencies=[Depends(write_guard)])
def register(body: Registration, request: Request, response: Response):
    throttle(request, body.email)
    salt = secrets.token_hex(16)
    user = {'_id': secrets.token_hex(16), 'email': body.email, 'name': body.name,
            'salt': salt, 'password_hash': password_hash(body.password, salt),
            'created_at': datetime.now(timezone.utc)}
    try:
        database().users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, 'Unable to create this account. Try signing in.')
    return start_session(user, response, request)


@router.post('/auth/login', dependencies=[Depends(write_guard)])
def login(body: Credentials, request: Request, response: Response):
    throttle(request, body.email)
    user = database().users.find_one({'email': body.email})
    actual = password_hash(body.password, user['salt'] if user else '00' * 16)
    if not user or not hmac.compare_digest(actual, user['password_hash']):
        raise HTTPException(401, 'Email or password is incorrect.')
    return start_session(user, response, request)


@router.get('/auth/me')
def me(response: Response, user=Depends(current_user)):
    response.headers['Cache-Control'] = 'no-store'
    return public_user(user)


@router.post('/auth/logout', dependencies=[Depends(write_guard)])
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        database().sessions.delete_one({'_id': digest(token)})
    response.delete_cookie(COOKIE, path='/api')
    return {'ok': True}


class Attempt(BaseModel):
    model_config = ConfigDict(extra='forbid')
    attempt_id: UUID
    item_id: str
    score: int = Field(ge=0, le=100)
    matched: bool
    hold_frames: int = Field(ge=0, le=12)
    feedback: str = Field(max_length=600)

    @field_validator('item_id')
    @classmethod
    def supported(cls, value):
        if value not in SCORABLE:
            raise ValueError('This item does not support measured attempts.')
        return value


@router.post('/learning/attempts', dependencies=[Depends(write_guard)])
def save_attempt(body: Attempt, user=Depends(current_user)):
    record = body.model_dump(mode='json')
    record.update(user_id=user['_id'], created_at=datetime.now(timezone.utc), scope='client-measured-handshape')
    record['completed'] = body.matched and body.hold_frames >= 12 and body.score >= 92
    database().practice_attempts.update_one(
        {'user_id': user['_id'], 'attempt_id': record['attempt_id']}, {'$setOnInsert': record}, upsert=True)
    return {'ok': True}


@router.get('/learning/progress')
def progress(response: Response, user=Depends(current_user)):
    response.headers['Cache-Control'] = 'no-store'
    collection = database().practice_attempts
    match = {'user_id': user['_id']}
    rows = list(collection.aggregate([
        {'$match': match}, {'$sort': {'created_at': 1}},
        {'$group': {'_id': '$item_id', 'count': {'$sum': 1}, 'best': {'$max': '$score'},
                    'average': {'$avg': '$score'}, 'first': {'$first': '$score'}, 'latest': {'$last': '$score'},
                    'completed': {'$max': '$completed'}}},
    ]))
    recent = list(collection.find(match, {'_id': 0, 'user_id': 0}).sort('created_at', -1).limit(50))
    count = sum(row['count'] for row in rows)
    return {'completed': [row['_id'] for row in rows if row['completed']], 'items': rows,
            'recent': recent, 'total_attempts': count,
            'average': round(sum(row['average'] * row['count'] for row in rows) / count) if count else None,
            'best': max((row['best'] for row in rows), default=None)}


class Lecture(BaseModel):
    model_config = ConfigDict(extra='forbid')
    session_id: UUID
    title: str = Field(min_length=1, max_length=120)
    text: str = Field(min_length=1, max_length=100000)


@router.post('/lectures', dependencies=[Depends(write_guard)])
def save_lecture(body: Lecture, user=Depends(current_user)):
    record = body.model_dump(mode='json')
    database().lecture_sessions.update_one(
        {'user_id': user['_id'], 'session_id': record['session_id']},
        {'$set': record, '$setOnInsert': {'created_at': datetime.now(timezone.utc)}}, upsert=True)
    return {'ok': True}


@router.get('/lectures')
def lectures(response: Response, user=Depends(current_user)):
    response.headers['Cache-Control'] = 'no-store'
    return list(database().lecture_sessions.find({'user_id': user['_id']}, {'_id': 0, 'user_id': 0})
                .sort('created_at', -1).limit(50))


@router.post('/lectures/{session_id}/delete', dependencies=[Depends(write_guard)])
def delete_lecture(session_id: UUID, user=Depends(current_user)):
    database().lecture_sessions.delete_one({'user_id': user['_id'], 'session_id': str(session_id)})
    return {'ok': True}
