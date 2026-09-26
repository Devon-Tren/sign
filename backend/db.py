"""Small local phrase catalog. Animation records are illustrative until signer-validated."""
from __future__ import annotations
import os
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).parent / 'data' / 'sign.db'
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

def get_connection(path: str | Path | None = None) -> sqlite3.Connection:
    if path is None:
        path = os.getenv('SIGN_DB_PATH') or DEFAULT_DB
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
    conn.executemany('''INSERT OR IGNORE INTO phrases
      (id, english, aliases, category, level, validation_status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)''', SEED)
    conn.commit()

def get_phrases(conn: sqlite3.Connection) -> list[dict]:
    return [dict(row) for row in conn.execute('SELECT * FROM phrases ORDER BY level, english')]
