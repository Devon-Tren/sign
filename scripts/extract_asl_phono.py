#!/usr/bin/env python3
"""Build a reproducible, consensus-gated ASL-Phono prior (stdlib only).

python scripts/extract_asl_phono.py --archive /tmp/asl-phono.zip
Omit --archive to download the pinned Zenodo release. No extraction is needed.
Only exact ASL-LEX EntryID/ASL-Phono label matches are used: no fuzzy glosses,
variant stripping, handshape replacement, or estimated facial grammar.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import io
import json
import math
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = 'https://zenodo.org/records/5484145/files/asl-phono.zip?download=1'
SOURCE_MD5 = '5486d7af11500ca3fa4a9e0e4b8a4f2e'
CHANNELS = ('orientation_dh', 'movement_dh')
AXES = {'right': (1, 0, 0), 'left': (-1, 0, 0), 'up': (0, 1, 0),
        'down': (0, -1, 0), 'front': (0, 0, 1), 'body': (0, 0, -1)}


def direction_vector(label: str) -> list[float]:
    """Signer-relative +x right, +y up, +z away; reject malformed directions.

    Upstream constant/constants.py names image -x as right, -y as up and
    +z as front. The LABELS already account for the camera mirror. Do not
    mirror them again; Avatar.toDir handles body-to-world conversion.
    """
    result = [0, 0, 0]
    for token in label.split('_'):
        if token not in AXES:
            raise ValueError(f'unknown direction: {label!r}')
        axis = AXES[token]
        index = next(i for i, value in enumerate(axis) if value)
        if result[index]:
            raise ValueError(f'repeated/conflicting axis: {label!r}')
        result[index] = axis[index]
    length = math.hypot(*result)
    return [round(value / length, 9) for value in result]


def consensus(samples: list[dict], channel: str) -> dict | None:
    """Unweighted frame votes, matching the exploratory >50% calculation.

    This is FRAME agreement, not independent-signer agreement or probability
    of correctness. Long samples contribute more votes. Source confidence is
    recorded separately; it is never used as a substitute for consensus.
    """
    counts: Counter = Counter()
    scores: dict[str, list[float]] = defaultdict(list)
    supporting: dict[str, set[str]] = defaultdict(set)
    for sample in samples:
        for frame in sample.get('frames', []):
            observation = frame.get('phonology', {}).get(channel)
            if not isinstance(observation, dict):
                continue
            label, score = observation.get('value'), observation.get('score')
            if not isinstance(label, str) or isinstance(score, bool):
                continue
            if not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 1:
                continue
            try:
                direction_vector(label)
            except ValueError:
                continue
            counts[label] += 1
            scores[label].append(score)
            supporting[label].add(sample['_sample_id'])
    if not counts:
        return None
    label, votes = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0]
    total = counts.total()
    return {
        'direction': label, 'vector': direction_vector(label),
        'votes': votes, 'observations': total, 'consensus': votes / total,
        'mean_confidence': sum(scores[label]) / votes,
        'supporting_samples': len(supporting[label]),
        'accepted': votes * 2 > total,
    }


def build(archive: bytes, lex: dict) -> dict:
    if hashlib.md5(archive).hexdigest() != SOURCE_MD5:
        raise ValueError('ASL-Phono archive checksum differs from Zenodo 5484145')
    grouped: dict[str, list[dict]] = defaultdict(list)
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        for name in sorted(source.namelist()):
            if '/phonology/3d/' not in '/' + name or not name.endswith('.json'):
                continue
            sample = json.loads(source.read(name))
            if sample.get('mode') != '3d':
                continue
            sample['_sample_id'] = Path(name).stem
            grouped[sample['label']].append(sample)
    signs = {}
    for clip_id, record in sorted(lex.items()):
        label = record.get('asl_lex_entry')
        samples = grouped.get(label, [])
        if not samples:
            continue
        signs[clip_id] = {
            'label': label, 'sample_count': len(samples),
            'sample_ids': [sample['_sample_id'] for sample in samples],
            **{channel: consensus(samples, channel) for channel in CHANNELS},
        }
    return {
        '_schema': 'asl-phono-priors-v1',
        '_source': 'ASL-Phono, Cleison Correia de Amorim and Cleber Zanchettin (2021)',
        '_source_url': SOURCE_URL, '_doi': '10.5281/zenodo.5484145',
        '_license': 'CC BY 4.0', '_license_url': 'https://creativecommons.org/licenses/by/4.0/',
        '_archive_sha256': hashlib.sha256(archive).hexdigest(),
        '_generated_by': 'scripts/extract_asl_phono.py',
        '_coordinates': '+x signer right, +y up, +z away from body; unit vectors',
        '_gate': 'Strictly more than 50% of valid frame observations, independently per channel',
        '_warning': 'Vision estimates at 3 fps, not human annotations or validated ASL. '
                    'Frame consensus is not cross-signer agreement. Same gloss can hide lexical variants. '
                    'All source frames are retained, including quantized boundary frames.',
        '_stats': {
            'samples': sum(map(len, grouped.values())), 'labels': len(grouped),
            'matched_signs': len(signs),
            **{channel: sum(bool(s[channel] and s[channel]['accepted']) for s in signs.values())
               for channel in CHANNELS},
        },
        'signs': signs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/asl_phono_priors.json')
    args = parser.parse_args()
    archive = args.archive.read_bytes() if args.archive else urllib.request.urlopen(SOURCE_URL, timeout=60).read()
    lex = json.loads((ROOT / 'data/asl_lex_params.json').read_text())['signs']
    result = build(archive, lex)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    print(json.dumps(result['_stats'], indent=2))


if __name__ == '__main__':
    main()
