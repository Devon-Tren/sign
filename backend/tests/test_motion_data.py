"""Integrity of the procedural motion descriptor set.

These are two-way checks in the same spirit as the SQLite/planner match that
``/api/health`` performs: a descriptor value that the renderer has no entry for
does not crash, it silently degrades - a handshape falls back to a relaxed hand,
a location falls back to neutral space in front of the body. Those are exactly
the failures that are invisible one sign at a time, so they are asserted here.

The renderer's vocabularies live in TypeScript, so this module reads the keys out
of the source rather than duplicating them. A duplicated table would drift.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / 'backend'))

import motion_data  # noqa: E402

ANCHORS_TS = ROOT / 'frontend/src/anchors.ts'
HANDSHAPES_TS = ROOT / 'frontend/src/handshapes.ts'


def _block(source: str, declaration: str) -> str:
    """The text of a top-level `const NAME ... = { ... }` initialiser."""
    start = source.index(declaration)
    depth, index = 0, source.index('{', start)
    for position in range(index, len(source)):
        if source[position] == '{':
            depth += 1
        elif source[position] == '}':
            depth -= 1
            if depth == 0:
                return source[index:position + 1]
    raise AssertionError(f'unterminated block for {declaration!r}')


def _keys(block: str) -> set[str]:
    """Top-level keys of an object literal, quoted or bare."""
    keys, depth = set(), 0
    for line in block.splitlines():
        stripped = line.strip()
        if depth == 1:
            match = re.match(r"^'([^']+)'\s*:|^\"([^\"]+)\"\s*:|^([A-Za-z_$][\w$]*)\s*:", stripped)
            if match:
                keys.add(next(g for g in match.groups() if g is not None))
        depth += line.count('{') - line.count('}')
    return keys


@pytest.fixture(scope='module')
def anchors() -> set[str]:
    return _keys(_block(ANCHORS_TS.read_text(), 'export const ANCHORS'))


@pytest.fixture(scope='module')
def base_forms() -> set[str]:
    return _keys(_block(HANDSHAPES_TS.read_text(), 'export const BASE_FORMS'))


@pytest.fixture(scope='module')
def hand_surfaces() -> set[str]:
    return _keys(_block(ANCHORS_TS.read_text(), 'export const HAND_SURFACE'))


MODIFIERS = {'flat', 'curved', 'bent', 'open', 'closed', 'spread', 'stacked'}
COMPOUND = {'flatspread': ('flat', 'spread')}
ATOMIC = {'baby_o', 'goody_goody'}
LOCATION_ALIASES = {'Chest', 'Cheek', 'Nose'}


def _parse_handshape(name: str) -> str:
    if name in ATOMIC:
        return name
    return name.split('_')[-1]


def _morphemes(record: dict) -> list[dict]:
    return record.get('morphemes') or [record]


def test_descriptor_files_are_disjoint_and_complete():
    lex, custom = motion_data.lex_signs(), motion_data.custom_signs()
    assert not set(lex) & set(custom), (
        'A sign described in both files would silently resolve to one of them; '
        'move it out of asl_custom_motions.json once the extract covers it.'
    )
    assert len(motion_data.all_signs()) == len(lex) + len(custom)
    # The extract auto-expands by frequency, so the count is not fixed. What
    # must hold is that the app-authored set stays small and every id the
    # renderer can be asked for is described somewhere.
    assert len(custom) <= 12, 'app-authored motions should shrink, not grow'
    assert len(lex) > 900, 'the ASL-LEX auto-expansion is not running'


def test_every_licensed_entry_records_its_provenance():
    for clip_id, record in motion_data.lex_signs().items():
        assert record.get('asl_lex_entry'), f'{clip_id} has no ASL-LEX entry id'
        assert record.get('fidelity') in {'exact', 'approximate'}, clip_id
        if record['fidelity'] == 'approximate':
            assert record.get('mapping_note'), (
                f'{clip_id} is an approximate mapping with no note explaining '
                'how it differs from the lemma it borrows'
            )


def test_app_authored_entries_are_flagged():
    for clip_id, record in motion_data.custom_signs().items():
        assert record.get('app_authored') is True, (
            f'{clip_id} has no licensed descriptor and must be flagged '
            'app_authored so the UI and the audit can say so'
        )
        assert not record.get('asl_lex_entry'), clip_id


def test_every_handshape_resolves_to_a_base_form(base_forms):
    unresolved = []
    for clip_id, record in motion_data.all_signs().items():
        for index, morpheme in enumerate(_morphemes(record)):
            name = morpheme.get('Handshape')
            if not name or name == 'NA':
                continue
            base = _parse_handshape(name)
            if base not in base_forms:
                unresolved.append(f'{clip_id}[{index}] {name!r} -> base {base!r}')
    assert not unresolved, (
        'These handshapes fall back to a relaxed hand instead of rendering:\n'
        + '\n'.join(unresolved)
    )


def test_every_location_has_an_anchor(anchors):
    missing = []
    for clip_id, record in motion_data.all_signs().items():
        for index, morpheme in enumerate(_morphemes(record)):
            for field in ('MajorLocation', 'MinorLocation', 'SecondMinorLocation'):
                value = morpheme.get(field)
                if not value or value == 'NA':
                    continue
                if value not in anchors and value not in LOCATION_ALIASES:
                    missing.append(f'{clip_id}[{index}] {field}={value!r}')
    assert not missing, (
        'These locations fall back to neutral space in front of the body:\n'
        + '\n'.join(missing)
    )


def test_hand_located_signs_resolve_to_a_relation(hand_surfaces):
    """A sign articulated on the non-dominant hand needs the two hands in
    register; an absolute anchor puts them in unrelated places."""
    augment = motion_data.augment()
    named = {'on_palm', 'on_back', 'on_radial', 'on_tip', 'on_heel', 'on_wrist',
             'on_forearm', 'on_upper_arm', 'above', 'crossed', 'tip_to_tip', 'beside'}
    unresolved = []
    for clip_id, record in motion_data.all_signs().items():
        override = augment.get(clip_id, {}).get('hand_relation')
        for index, morpheme in enumerate(_morphemes(record)):
            if morpheme.get('MajorLocation') != 'Hand':
                continue
            minor = morpheme.get('MinorLocation')
            if override in named or minor in hand_surfaces:
                continue
            unresolved.append(f'{clip_id}[{index}] MinorLocation={minor!r}')
    assert not unresolved, (
        'These two-handed signs have no contact relation:\n' + '\n'.join(unresolved)
    )


def test_augment_keys_refer_to_real_signs():
    unknown = set(motion_data.augment()) - set(motion_data.all_signs())
    assert not unknown, f'augment block references unknown sign ids: {sorted(unknown)}'


def test_augment_values_are_in_range():
    for clip_id, entry in motion_data.augment().items():
        for channel, value in (entry.get('nonmanual') or {}).items():
            if channel == 'head':
                assert isinstance(value, list) and len(value) == 3, f'{clip_id}.head'
                assert all(-1 <= v <= 1 for v in value), f'{clip_id}.head out of range'
            else:
                assert 0 <= value <= 1, f'{clip_id}.{channel}={value} out of 0..1'
        if 'repeat_count' in entry:
            assert 1 <= entry['repeat_count'] <= 6, clip_id
        if 'movement_size' in entry:
            assert 0 < entry['movement_size'] <= 2, clip_id
        if 'movement_axis' in entry:
            assert entry['movement_axis'] in {'vertical', 'lateral', 'forward'}, clip_id


def test_connected_durations_stay_inside_the_corpus_band():
    """Connected signing runs near citation tempo, not at the isolated stretch.
    See the timing note in backend/motion_data.py."""
    for clip_id in motion_data.all_signs():
        continuous = motion_data.clip_duration_ms(clip_id, 'continuous')
        isolated = motion_data.clip_duration_ms(clip_id, 'isolated')
        components = motion_data.clip_sequence(clip_id)
        assert (motion_data.CONTINUOUS_MIN_MS * len(components)
                <= continuous
                <= motion_data.CONTINUOUS_MAX_MS * len(components))
        assert (motion_data.ISOLATED_MIN_MS * len(components)
                <= isolated
                <= motion_data.ISOLATED_MAX_MS * len(components))
        assert continuous < isolated, clip_id


def test_catalog_registers_every_playable_motion():
    import catalog_store
    catalog = catalog_store.get_catalog()
    registered = {
        (entry.get('motion_asset') or {}).get('clip_id')
        for entry in catalog['signs']
    } - {None}
    assert set(motion_data.all_signs()) <= registered, (
        'These descriptor-backed motions are not registered in the catalog, so '
        'the planner cannot select them: '
        f'{sorted(set(motion_data.all_signs()) - registered)}'
    )


def test_augment_entries_that_carry_several_fields_kept_all_of_them():
    """Six ids need more than one augment field. They are authored as a list of
    declarations and merged, because a dict literal with a repeated key silently
    drops the earlier entry - which is how NO lost its head shake and SORRY lost
    its brow furrow. Each of these asserts both halves survived."""
    augment = motion_data.augment()
    expected = {
        'no':       {'nonmanual': {'headShake', 'browFurrow'}, 'scalars': {'movement_size'}},
        'sorry':    {'nonmanual': {'browFurrow'}, 'scalars': {'repeat_count'}},
        'please':   {'nonmanual': set(), 'scalars': {'repeat_count', 'movement_size'}},
        'water':    {'nonmanual': set(), 'scalars': {'repeat_count', 'movement_size'}},
        'bathroom': {'nonmanual': set(), 'scalars': {'repeat_count', 'movement_size', 'movement_axis'}},
        'name':     {'nonmanual': set(), 'scalars': {'repeat_count', 'hand_relation'}},
    }
    for clip_id, want in expected.items():
        entry = augment.get(clip_id)
        assert entry, f'{clip_id} has no augment entry'
        assert want['nonmanual'] <= set(entry.get('nonmanual') or {}), (
            f'{clip_id} lost non-manual channel(s) '
            f'{want["nonmanual"] - set(entry.get("nonmanual") or {})}'
        )
        assert want['scalars'] <= set(entry), (
            f'{clip_id} lost field(s) {want["scalars"] - set(entry)}'
        )


def test_negation_is_marked_on_the_head():
    """Negation in ASL is obligatorily marked by a head shake. A negative sign
    with correct hands and no head shake is missing its grammar."""
    augment = motion_data.augment()
    for clip_id in ('no', 'not'):
        shake = (augment.get(clip_id, {}).get('nonmanual') or {}).get('headShake', 0)
        assert shake > 0.5, f'{clip_id} carries no head shake'


def test_wh_questions_furrow_and_yes_no_questions_raise():
    """The two brow markers are not opposites and must not be conflated."""
    augment = motion_data.augment()
    for clip_id in ('what', 'where', 'why', 'when', 'how'):
        nm = augment.get(clip_id, {}).get('nonmanual') or {}
        assert nm.get('browFurrow', 0) > 0.5, f'{clip_id} is a WH-question without a furrow'
        assert not nm.get('browRaise'), f'{clip_id} is a WH-question and must not raise'
    question = augment.get('question', {}).get('nonmanual') or {}
    assert question.get('browRaise', 0) > 0.5
    assert not question.get('browFurrow')
