"""Small local phrase catalog. Animation records are illustrative until signer-validated."""
from __future__ import annotations
import json
import os
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path(__file__).parent / 'data' / 'sign.db'
MOTION_FILES = (
    (ROOT / 'data/asl_lex_params.json', 'ASL-LEX descriptor candidate'),
    (ROOT / 'data/asl_custom_motions.json', 'Application-authored motion candidate'),
)
SEED = [
    ('hello', 'Hello', 'hello', 'Greeting', 1, 'illustrative', 'A hand-wave animation placeholder; NOT verified ASL.'),
    ('thank_you', 'Thank you', 'thank you|thanks', 'Courtesy', 1, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('yes', 'Yes', 'yes|correct|that is right', 'Responses', 1, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('no', 'No', 'no|not really', 'Responses', 1, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('help', 'Help', 'help|can you help', 'Classroom', 1, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('good_morning', 'Good morning', 'good morning', 'Greeting', 1, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('question', 'Question', 'question|any questions', 'Classroom', 2, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('learn', 'Learn', 'learn|learning|we will learn', 'Classroom', 2, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('understand', 'Understand', 'understand|i understand|do you understand', 'Classroom', 2, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('today', 'Today', 'today', 'Classroom', 2, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('artificial_intelligence', 'Artificial intelligence', 'artificial intelligence|ai', 'Technology', 3, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
    ('computer', 'Computer', 'computer|computers', 'Technology', 3, 'illustrative', 'Animation placeholder; NOT verified ASL.'),
]

# Matching metadata is deliberately separate from the display aliases above.
# A context alias is never enough on its own: it must be supported by one of
# the positive context phrases and must not conflict with a negative phrase.
SEMANTIC_METADATA = {
    'hello': ('A greeting or acknowledgment.', '', '', '', .90),
    'thank_you': ('An expression of thanks or gratitude.', '', '', '', .90),
    'yes': ('An affirmative answer or confirmation.', '', '', '', .90),
    'no': ('A negative answer or rejection.', '', '', '', .90),
    'help': ('A request for or offer of assistance.', '', '', '', .90),
    'good_morning': ('A greeting used in the morning.', '', '', '', .90),
    'question': ('A question or request for an answer.', '', '', '', .90),
    'learn': ('Learning or gaining knowledge.', '', '', '', .90),
    'understand': ('Understanding or comprehending something.', '', '', '', .90),
    'today': ('The current day.', '', '', '', .90),
    'artificial_intelligence': (
        'Artificial intelligence, machine learning, or computer intelligence.',
        'intelligence',
        'artificial|machine learning|computer|computers|algorithm|model|software|technology|data|automation',
        'military|classified|spy|espionage|intelligence agency|intelligence report|intelligence officer',
        .88,
    ),
    'computer': ('An electronic computer or computers.', '', '', '', .90),
}


def motion_seed() -> list[tuple]:
    """Expose every playable procedural clip through the searchable phrase DB.

    These rows improve retrieval coverage; they do not upgrade an unreviewed
    motion into validated ASL. Real skeletal assets can later replace a row's
    ``animation_file`` without changing the matching contract.
    """
    rows: dict[str, tuple] = {}
    for path, provenance in MOTION_FILES:
        for clip_id, params in json.loads(path.read_text())['signs'].items():
            label = clip_id.replace('_', ' ')
            rows[clip_id] = (
                clip_id, label.title(), label, 'Motion Catalog', 3,
                'illustrative',
                f'{provenance}; procedural and not signer-validated.',
                clip_id, label, '', '', '', .90,
            )
    return list(rows.values())

def get_connection(path: str | Path | None = None) -> sqlite3.Connection:
    if path is None:
        # Vercel's deployed source tree is read-only. The phrase database is a
        # derived cache that is rebuilt from the bundled catalog at startup, so
        # use the function's writable scratch directory there. User data lives
        # in MongoDB and is never stored in this ephemeral file.
        default = Path('/tmp/sign.db') if os.getenv('VERCEL') else DEFAULT_DB
        path = os.getenv('SIGN_DB_PATH') or default
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db(conn: sqlite3.Connection) -> None:
    conn.execute('''CREATE TABLE IF NOT EXISTS phrases (
      id TEXT PRIMARY KEY, english TEXT NOT NULL, aliases TEXT NOT NULL,
      category TEXT NOT NULL, level INTEGER NOT NULL,
      validation_status TEXT NOT NULL CHECK(validation_status IN ('illustrative','validated')),
      notes TEXT NOT NULL, animation_file TEXT
    )''')
    # Migrate existing local catalogs in place. SQLite only permits constant
    # defaults here, which also keeps older user-created rows usable.
    existing = {row['name'] for row in conn.execute('PRAGMA table_info(phrases)')}
    migrations = {
        'meaning': "TEXT NOT NULL DEFAULT ''",
        'context_aliases': "TEXT NOT NULL DEFAULT ''",
        'positive_contexts': "TEXT NOT NULL DEFAULT ''",
        'negative_contexts': "TEXT NOT NULL DEFAULT ''",
        'match_threshold': 'REAL NOT NULL DEFAULT 0.90',
    }
    for column, definition in migrations.items():
        if column not in existing:
            conn.execute(f'ALTER TABLE phrases ADD COLUMN {column} {definition}')
    conn.executemany('''INSERT OR IGNORE INTO phrases
      (id, english, aliases, category, level, validation_status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)''', SEED)
    conn.executemany('''INSERT OR IGNORE INTO phrases
      (id, english, aliases, category, level, validation_status, notes,
       animation_file, meaning, context_aliases, positive_contexts,
       negative_contexts, match_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''', motion_seed())
    # Older databases already contain the original 12 phrase rows. Connect
    # those rows to their same-named playable clip without replacing any real
    # animation asset that a developer may have registered later.
    conn.executemany('''UPDATE phrases SET animation_file = ?
      WHERE id = ? AND (animation_file IS NULL OR animation_file = '')''',
      [(row[7], row[0]) for row in motion_seed()])
    conn.executemany('''UPDATE phrases SET
      meaning = ?, context_aliases = ?, positive_contexts = ?,
      negative_contexts = ?, match_threshold = ? WHERE id = ?''',
      [(*metadata, phrase_id) for phrase_id, metadata in SEMANTIC_METADATA.items()])
    conn.commit()

def get_phrases(conn: sqlite3.Connection) -> list[dict]:
    return [dict(row) for row in conn.execute('SELECT * FROM phrases ORDER BY level, english')]
