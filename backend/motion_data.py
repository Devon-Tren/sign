"""Shared access to the procedural motion descriptor set.

Two files describe motions and both are load-bearing:

* ``data/asl_lex_params.json`` - phonological descriptors extracted from
  ASL-LEX 2.0 (CC BY-NC 4.0). This is the licensed, citable source.
* ``data/asl_custom_motions.json`` - application-authored approximations for the
  handful of catalog ids that have no plausible ASL-LEX lemma, plus an
  ``augment`` block of app-authored values layered on top of licensed
  descriptors.

``catalog_store`` and ``playback`` previously each read only the custom file
when registering playable motions, so a sign described by the licensed extract
was invisible to the planner unless it was ALSO hand-authored. That was
survivable while the extract held 11 entries and the custom file held 92; it is
not survivable now that the ratio is reversed. Both modules go through this
module instead, so the two files can never drift apart again.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEX_FILE = ROOT / 'data/asl_lex_params.json'
CUSTOM_FILE = ROOT / 'data/asl_custom_motions.json'

#: Motion asset format tags, kept in sync with the frontend renderer.
LEX_FORMAT = 'asl-lex-procedural-v1'
CUSTOM_FORMAT = 'custom-procedural-v1'


@lru_cache(maxsize=1)
def lex_signs() -> dict[str, dict]:
    """Descriptors backed by the ASL-LEX extract, keyed by clip id."""
    return json.loads(LEX_FILE.read_text())['signs']


@lru_cache(maxsize=1)
def custom_signs() -> dict[str, dict]:
    """Application-authored descriptors for ids with no ASL-LEX lemma."""
    return json.loads(CUSTOM_FILE.read_text())['signs']


@lru_cache(maxsize=1)
def augment() -> dict[str, dict]:
    """App-authored values layered on top of licensed descriptors."""
    return json.loads(CUSTOM_FILE.read_text()).get('augment', {})


@lru_cache(maxsize=1)
def all_signs() -> dict[str, dict]:
    """Every playable clip id. Licensed descriptors take precedence."""
    return {**custom_signs(), **lex_signs()}


def format_for(clip_id: str) -> str | None:
    """Which motion-asset format tag a clip id is served under."""
    if clip_id in lex_signs():
        return LEX_FORMAT
    if clip_id in custom_signs():
        return CUSTOM_FORMAT
    return None


def descriptors_for(clip_id: str) -> dict | None:
    return all_signs().get(clip_id)


# ---------------------------------------------------------------------------
# Timing
#
# ASL-LEX citation durations are isolated elicitations (334-1134 ms). A planned
# timeline is CONNECTED signing, which runs close to citation tempo rather than
# the ~2.1x stretch that suits isolated display - see the timing note in
# frontend/src/clips.ts for the corpus frame counts this is derived from. The
# backend allocates connected durations so the planner and the renderer agree.
# ---------------------------------------------------------------------------
ISOLATED_MIN_MS, ISOLATED_MAX_MS, ISOLATED_STRETCH = 1250, 2500, 2.1
CONTINUOUS_MIN_MS, CONTINUOUS_MAX_MS, CONTINUOUS_STRETCH = 700, 1400, 1.15


def _clamp(value: float, low: int, high: int) -> int:
    return int(min(high, max(low, value)) + 0.5)


def clip_duration_ms(clip_id: str, mode: str = 'continuous') -> int:
    """Playback length for a clip, matching ``clipLengthMs`` in the frontend."""
    record = descriptors_for(clip_id) or {}
    citation = record.get('duration_ms') or 600
    if mode == 'isolated':
        return _clamp(citation * ISOLATED_STRETCH, ISOLATED_MIN_MS, ISOLATED_MAX_MS)
    return _clamp(citation * CONTINUOUS_STRETCH, CONTINUOUS_MIN_MS, CONTINUOUS_MAX_MS)


def provenance_for(clip_id: str) -> dict:
    """Provenance record for the catalog, distinguishing licensed from authored."""
    record = descriptors_for(clip_id) or {}
    if clip_id in lex_signs():
        return {
            'source': '../asl_lex_params.json',
            'fidelity': record.get('fidelity') or 'candidate',
            'asl_lex_entry': record.get('asl_lex_entry'),
            'mapping_note': record.get('mapping_note'),
        }
    return {'source': '../asl_custom_motions.json', 'fidelity': 'candidate'}
