"""The review must account for every built-in library row and every skipped ID."""
import json
import unittest
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from db import SEED, motion_seed


class LibraryReviewTest(unittest.TestCase):
    def test_exhaustive_review_and_export(self):
        review = json.loads((ROOT / 'data/library_motion_review.json').read_text())
        entries = review['entries']
        catalog = {row[0] for row in [*SEED, *motion_seed()]}
        self.assertEqual(set(entries), catalog)
        report = (ROOT / 'docs/PHRASE_LIBRARY_REVIEW.md').read_text()
        authored = json.loads((ROOT / 'data/asl_authored_motions.json').read_text())
        for id, entry in entries.items():
            self.assertIn(entry['reason'], review['reasons'])
            self.assertIn(entry['status'], ('updated', 'preserved', 'skipped'))
            if entry['status'] == 'skipped':
                self.assertEqual(report.count(f'| `{id}` |'), 1, id)
            else:
                self.assertTrue(id in authored['clips'] or id in authored['sequences'], id)
            if entry['status'] == 'updated':
                self.assertTrue(entry['sources'])
                self.assertEqual(entry['sources'], authored['clips'][id]['references'])
