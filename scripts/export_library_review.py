"""Export the complete, alphabetized skipped-entry list from the review manifest."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def render():
    review = json.loads((ROOT / 'data/library_motion_review.json').read_text())
    entries = review['entries']
    groups = {status: [(key, value) for key, value in entries.items() if value['status'] == status]
              for status in ('updated', 'preserved', 'skipped')}
    lines = ['# Phrase Library motion review', '', f"Review date: {review['date']}", '', review['scope'], '',
             f"Total: **{len(entries)}**. Updated: **{len(groups['updated'])}**. Previously customized, preserved: **{len(groups['preserved'])}**. Skipped: **{len(groups['skipped'])}**.", '',
             '## Updated', '']
    for key, item in groups['updated']:
        sources = ', '.join(f'[ASLU reference]({url})' for url in item.get('sources', []))
        lines += [f"- **{item['label']}** (`{key}`): {item['summary']}. {sources}"]
    lines += ['', '## Preserved', '', ', '.join(f"{item['label']} (`{key}`)" for key, item in groups['preserved']) + '.', '',
              '## Verification limits', '',
              'The 13 reference-based candidates were checked on the production avatar. Ten were withdrawn after the rig audit reported unresolved wrist, finger, contact, or turn-speed concerns: Drink, Finish, Learn, Need, Sorry, Stop, Today, Want, Water, and You. Their previous animations remain intact. The three retained changes did not introduce new audit failure categories; existing resting-hand/body overlap findings remain. This is not a clean safety audit or ASL signer approval.', '',
              'All other skips are conservative metadata triage, not individual video reviews. The reason below identifies the evidence still needed; it is not a diagnosis that the current sign is wrong. The separate 200-entry phrase bank is not the Phrase Library inventory.', '',
              '## Every skipped entry', '',
              'Give the entry ID with your preferred handshape, palm direction, location, movement, and repetition count. Entries below are unchanged.', '',
              '| Entry | ID | Reason skipped |', '| --- | --- | --- |']
    for key, item in sorted(groups['skipped'], key=lambda pair: (pair[1]['label'].casefold(), pair[0])):
        reason = review['reasons'][item['reason']]
        sources = ' '.join(f'[Reference]({url})' for url in item.get('sources', []))
        lines += [f"| {item['label']} | `{key}` | {reason} {sources} |"]
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    (ROOT / 'docs/PHRASE_LIBRARY_REVIEW.md').write_text(render())
