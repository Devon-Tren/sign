#!/usr/bin/env python3
"""Download the ASL-LEX reference video for each phrase-bank sign.

    python scripts/fetch_reference_videos.py [--only THANK_YOU,DEAF] [--first 100]

Videos land in artifacts/reference-videos/<TOKEN>.mp4. artifacts/ is gitignored:
ASL-LEX videos are CC BY-NC 4.0 and must never be committed.

The Vimeo player only serves these videos to requests that carry
`Referer: https://asl-lex.org/` (ASL-LEX embeds them), and only as an HLS
stream, which ffmpeg saves to mp4 without re-encoding.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'data/asl/phrase_bank.json'
REFS = ROOT / 'data/asl/phrase_bank_references.json'
OUT = ROOT / 'artifacts/reference-videos'
REFERER = 'https://asl-lex.org/'


def stream_url(player_url: str) -> str:
    request = urllib.request.Request(player_url, headers={'Referer': REFERER, 'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(request, timeout=60).read().decode('utf-8', 'replace')
    match = re.search(r'window\.playerConfig\s*=\s*(\{.*?\})\s*(?:;|</script>)', html, re.S)
    if not match:
        raise RuntimeError('no player config on page')
    config = json.loads(match.group(1))
    files = config['request']['files']
    progressive = files.get('progressive') or []
    if progressive:
        return max(progressive, key=lambda f: f.get('height', 0))['url']
    hls = files['hls']
    return hls['cdns'][hls['default_cdn']]['avc_url']


def tokens_for(first: int | None) -> list[str]:
    phrases = json.loads(BANK.read_text())['phrases']
    if first:
        phrases = phrases[:first]
    return sorted({t for p in phrases for t in p['gloss'] if not t.startswith('FS:')})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--only', help='comma-separated tokens')
    parser.add_argument('--first', type=int, help='only signs used by the first N phrases')
    args = parser.parse_args()
    signs = json.loads(REFS.read_text())['signs']
    tokens = args.only.split(',') if args.only else tokens_for(args.first)
    OUT.mkdir(parents=True, exist_ok=True)
    ok, failed = 0, []
    for token in tokens:
        target = OUT / f'{token}.mp4'
        if target.exists() and target.stat().st_size > 0:
            ok += 1
            continue
        video = signs.get(token, {}).get('reference_video')
        if not video:
            failed.append((token, 'no reference video'))
            continue
        try:
            url = stream_url(video)
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-headers', f'Referer: {REFERER}\r\n',
                            '-i', url, '-c', 'copy', str(target)], check=True, timeout=180)
            ok += 1
            print(f'  {token}')
        except Exception as error:  # noqa: BLE001 - report and continue with the rest
            target.unlink(missing_ok=True)
            failed.append((token, str(error)[:120]))
    print(f'{ok}/{len(tokens)} videos in {OUT.relative_to(ROOT)}')
    for token, reason in failed:
        print(f'  FAILED {token}: {reason}')


if __name__ == '__main__':
    main()
