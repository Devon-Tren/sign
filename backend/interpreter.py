"""Closed-vocabulary prototype: never infer unsupported content has a signing animation."""
from __future__ import annotations
import json
import os
import re
from typing import Any


def normalized(value: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', value.lower())).strip()


def match_catalog(text: str, phrases: list[dict]) -> list[dict]:
    """Greedy span extraction using known aliases; not a grammar translation."""
    source = f' {normalized(text)} '
    candidates = []
    for p in phrases:
        for alias in p['aliases'].split('|'):
            alias = normalized(alias)
            if alias:
                for m in re.finditer(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', source):
                    candidates.append((m.start(), m.end(), p, alias))
    # Prefer longer non-overlapping aliases, then restore their spoken order.
    candidates.sort(key=lambda c: (-(c[1] - c[0]), c[0]))
    occupied: list[tuple[int, int]] = []
    selected = []
    for start, end, phrase, alias in candidates:
        if all(end <= a or start >= b for a, b in occupied):
            occupied.append((start, end))
            selected.append((start, phrase, alias))
    return [dict(phrase_id=p['id'], label=p['english'], validation_status=p['validation_status'],
                 matched_text=alias, animation_file=p['animation_file'])
            for _, p, alias in sorted(selected, key=lambda c: c[0])]


async def interpret(text: str, phrases: list[dict]) -> dict[str, Any]:
    """Use GPT to identify known phrases only; deterministic matching otherwise."""
    candidates = match_catalog(text, phrases)
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return result(text, candidates, 'catalog-only')

    catalog = [{ 'id': p['id'], 'english': p['english'], 'aliases': p['aliases'] }
               for p in phrases]
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=api_key, timeout=16.0, max_retries=0)
        completion = await client.chat.completions.create(
            model=os.getenv('OPENAI_TEXT_MODEL', 'gpt-4.1'),
            response_format={'type': 'json_object'},
            temperature=0,
            messages=[
                {'role': 'system', 'content': (
                    'You are a phrase RETRIEVAL selector, NOT an ASL interpreter. '
                    'Given a spoken sentence and a closed list of phrase IDs, select only '
                    'phrases whose meaning is directly present. Preserve sentence order. '
                    'Do not claim the sequence is grammatical ASL, omit unsupported content '
                    'rather than guessing. Return JSON {"ids": ["known_id"], "reason": "short"}. '
                    'Do not choose more than 5. If uncertain, choose none.')},
                {'role': 'user', 'content': json.dumps({'spoken': text, 'catalog': catalog})},
            ],
        )
        raw = json.loads(completion.choices[0].message.content or '{}')
        valid = {p['id']: p for p in phrases}
        ids = raw.get('ids', [])
        if not isinstance(ids, list):
            ids = []
        selected = []
        for pid in ids[:5]:
            if isinstance(pid, str) and pid in valid and pid not in [x['phrase_id'] for x in selected]:
                p = valid[pid]
                selected.append({'phrase_id': pid, 'label': p['english'],
                                 'validation_status': p['validation_status'],
                                 'matched_text': '', 'animation_file': p['animation_file']})
        return result(text, selected, 'ai-catalog')
    except Exception:
        return result(text, candidates, 'catalog-fallback')


def result(text: str, selected: list[dict], mode: str) -> dict:
    return {
        'spoken': text, 'selected': selected[:8], 'mode': mode,
        'coverage': 'illustrative-only' if selected else 'unsupported',
        'note': ('Placeholder animation only; no verified ASL translation is available. '
                 'Use original English captions for the complete message.' if selected
                 else 'No matching supported animation. Original English captions retained.'),
    }
