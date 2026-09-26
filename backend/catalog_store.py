"""ASL catalog storage with an optional MongoDB backend and JSON fallback."""
from __future__ import annotations

import json
import logging
import os
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_FILE = ROOT / 'data/asl/catalog.json'
CUSTOM_MOTIONS_FILE = ROOT / 'data/asl_custom_motions.json'
PHRASE_SEED_FILE = ROOT / 'data/asl/phrase_seed.json'
log = logging.getLogger('sign.catalog')

_database = None
_backend = 'json'


def _seed_catalog() -> dict:
    catalog = json.loads(CATALOG_FILE.read_text())
    custom = json.loads(CUSTOM_MOTIONS_FILE.read_text())['signs']
    phrases = json.loads(PHRASE_SEED_FILE.read_text())
    signs = {entry['id']: entry for entry in catalog['signs']}
    for clip_id in custom:
        sign_id = clip_id.upper()
        signs[sign_id] = {
            'id': sign_id,
            'meaning': clip_id.replace('_', ' '),
            'english_expressions': [clip_id.replace('_', ' ')],
            'variant': 'Application-authored procedural candidate',
            'review_status': 'candidate',
            'motion_asset': {'format': 'custom-procedural-v1', 'clip_id': clip_id},
            'provenance': {'source': '../asl_custom_motions.json', 'fidelity': 'candidate'},
        }
    catalog['signs'] = list(signs.values())
    profiles = {entry['id']: entry for entry in catalog['profiles']}
    profiles.update({entry['id']: entry for entry in phrases['profiles']})
    catalog['profiles'] = list(profiles.values())
    examples = {entry['id']: entry for entry in catalog['examples']}
    for phrase in phrases['phrases']:
        meaning = {
            'intent': phrase['intent'], 'predicate': phrase['predicate'],
            'participants': [], 'negated': False, 'time': [], 'quantities': [],
            'entities': [], 'conditions': [], 'references': [], 'unresolved': [],
        }
        steps = [{'id': f's{index + 1}', 'sign_id': sign_id}
                 for index, sign_id in enumerate(phrase['gloss'])]
        spans = []
        if phrase.get('profile') and steps:
            spans.append({'profile_id': phrase['profile'], 'start_anchor': 's1',
                          'end_anchor': steps[-1]['id']})
        examples[phrase['id']] = {
            'id': phrase['id'], 'english': phrase['english'], 'context': [],
            'context_independent': True, 'review_status': 'candidate',
            'meaning': meaning,
            'construction': {
                'manual_sequence': steps,
                'grammar': {'question_type': phrase.get('question_type', 'none')},
                'nonmanuals': spans, 'expressed_meaning': meaning, 'unresolved': [],
            },
        }
    catalog['examples'] = list(examples.values())
    return catalog


def init_catalog_store() -> str:
    """Connect and seed MongoDB when configured; otherwise use bundled JSON."""
    global _database, _backend
    uri = os.getenv('MONGODB_URI', '').strip()
    if not uri:
        _database, _backend = None, 'json'
        return _backend
    try:
        from pymongo import MongoClient, ReplaceOne
        client = MongoClient(uri, serverSelectionTimeoutMS=1800, connectTimeoutMS=1800)
        client.admin.command('ping')
        database = client[os.getenv('MONGODB_DB', 'sign')]
        seed = _seed_catalog()
        for collection_name in ('signs', 'profiles', 'examples'):
            documents = seed[collection_name]
            if documents:
                database[collection_name].bulk_write([
                    ReplaceOne({'id': document['id']}, document, upsert=True)
                    for document in documents
                ])
        database.metadata.replace_one(
            {'id': 'catalog'},
            {'id': 'catalog', 'version': seed.get('version', 1),
             'source': seed.get('_source'), 'license': seed.get('_license')},
            upsert=True,
        )
        database.examples.create_index('english')
        database.signs.create_index('english_expressions')
        _database, _backend = database, 'mongodb'
    except Exception as exc:
        _database, _backend = None, 'json-fallback'
        log.warning('MongoDB unavailable; using bundled ASL catalog')
        log.debug('MongoDB connection detail: %s', exc)
    return _backend


def catalog_backend() -> str:
    return _backend


def get_catalog() -> dict:
    if os.getenv('MONGODB_URI', '').strip() and _database is None and _backend == 'json':
        init_catalog_store()
    if _database is None:
        return deepcopy(_seed_catalog())
    metadata = _database.metadata.find_one({'id': 'catalog'}, {'_id': 0}) or {}
    return {
        'version': metadata.get('version', 1),
        '_source': metadata.get('source'),
        '_license': metadata.get('license'),
        'signs': list(_database.signs.find({}, {'_id': 0}).sort('id', 1)),
        'profiles': list(_database.profiles.find({}, {'_id': 0}).sort('id', 1)),
        'examples': list(_database.examples.find({}, {'_id': 0}).sort('id', 1)),
    }
