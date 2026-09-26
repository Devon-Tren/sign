"""Fast context-aware gate for stored signing animations.

The matcher may accept cataloged meanings; it does not translate English into
ASL or certify that an illustrative animation is linguistically correct.
"""
from __future__ import annotations
import re
from typing import Any


def normalized(value: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', value.lower())).strip()


def _terms(value: str | None) -> list[str]:
    return [term for raw in (value or '').split('|') if (term := normalized(raw))]


def _contains(source: str, term: str) -> bool:
    return bool(re.search(r'(?<!\w)' + re.escape(term) + r'(?!\w)', source))


def evaluate_catalog(text: str, phrases: list[dict], context: list[str] | None = None) -> tuple[list[dict], list[str]]:
    """Return safe catalog matches plus short reasons for rejected ambiguities."""
    source = f' {normalized(text)} '
    combined = f" {normalized(' '.join([*(context or [])[-5:], text]))} "
    candidates = []
    rejected: list[str] = []
    for phrase in phrases:
        normal_aliases = _terms(phrase.get('aliases'))
        context_aliases = _terms(phrase.get('context_aliases'))
        positive = _terms(phrase.get('positive_contexts'))
        negative = _terms(phrase.get('negative_contexts'))
        threshold = float(phrase.get('match_threshold') or .90)
        aliases = [*((alias, False) for alias in normal_aliases),
                   *((alias, True) for alias in context_aliases)]
        for alias, needs_context in aliases:
            for match in re.finditer(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', source):
                positive_hits = [term for term in positive if _contains(combined, term)]
                negative_hits = [term for term in negative if _contains(combined, term)]
                if needs_context and negative_hits:
                    rejected.append(
                        f'“{alias}” was not mapped to {phrase["english"]}: conflicting context ({negative_hits[0]}).')
                    continue
                if needs_context and not positive_hits:
                    rejected.append(
                        f'“{alias}” needs more context before it can be mapped to {phrase["english"]}.')
                    continue
                confidence = .96 if not needs_context else .92
                if len(alias.split()) > 1:
                    confidence = .99
                if confidence < threshold:
                    rejected.append(f'“{alias}” did not meet the stored confidence threshold.')
                    continue
                reason = ('Exact stored phrase match.' if not needs_context else
                          f'Context supports the stored meaning ({positive_hits[0]}).')
                candidates.append((match.start(), match.end(), phrase, alias,
                                   confidence, threshold, reason))

    # Prefer longer non-overlapping aliases, then restore their spoken order.
    candidates.sort(key=lambda candidate: (-(candidate[1] - candidate[0]), candidate[0]))
    occupied: list[tuple[int, int]] = []
    selected = []
    for start, end, phrase, alias, confidence, threshold, reason in candidates:
        if all(end <= used_start or start >= used_end for used_start, used_end in occupied):
            occupied.append((start, end))
            selected.append((start, phrase, alias, confidence, threshold, reason))
    matches = [dict(
        phrase_id=phrase['id'], label=phrase['english'],
        validation_status=phrase['validation_status'], matched_text=alias,
        animation_file=phrase['animation_file'], meaning=phrase.get('meaning', ''),
        match_confidence=confidence, match_threshold=threshold,
        match_kind='contextual' if reason.startswith('Context') else 'exact',
        match_reason=reason,
    ) for _, phrase, alias, confidence, threshold, reason
        in sorted(selected, key=lambda candidate: candidate[0])]
    return matches, list(dict.fromkeys(rejected))


def match_catalog(text: str, phrases: list[dict], context: list[str] | None = None) -> list[dict]:
    """Compatibility wrapper returning accepted matches only."""
    return evaluate_catalog(text, phrases, context)[0]


async def interpret(text: str, phrases: list[dict], context: list[str] | None = None) -> dict[str, Any]:
    """Run the deterministic gate; predictable latency is a core requirement."""
    candidates, rejected = evaluate_catalog(text, phrases, context)
    return result(text, candidates, 'catalog-only', rejected, bool(context))


def result(text: str, selected: list[dict], mode: str,
           rejected: list[str] | None = None, context_used: bool = False) -> dict:
    rejected = rejected or []
    confidence = min((item['match_confidence'] for item in selected), default=0.0)
    reason = (f'{len(selected)} stored meaning match(es) passed the gate.' if selected else
              rejected[0] if rejected else 'No stored meaning matched the transcript.')
    return {
        'spoken': text, 'selected': selected[:8], 'mode': mode,
        'coverage': 'illustrative-only' if selected else 'unsupported',
        'gate': {
            'status': 'matched' if selected else 'captions-only',
            'strategy': 'context-aware-catalog-v1',
            'confidence': round(confidence, 2),
            'context_used': context_used,
            'reason': reason,
        },
        'note': ('Placeholder animation only; no verified ASL translation is available. '
                 'Use original English captions for the complete message.' if selected
                 else 'No matching supported animation. Original English captions retained.'),
    }
