#!/usr/bin/env python3
"""Rebuild frontend/public/avatar/ from the Microsoft Rocketbox library.

Rocketbox is MIT licensed, so unlike data/ this carries no NonCommercial
restriction. See NOTICE for attribution.

The upstream repository is ~4 GB, so this fetches only the files for one
avatar by URL rather than cloning. The outputs are committed, so a normal
checkout needs no network access.

    python scripts/build_avatar.py                    # rebuild the current signer
    python scripts/build_avatar.py Adults Male_Adult_09

Textures ship as 2048x2048 uncompressed TGA (~100 MB per avatar). They are
downsampled and re-encoded to WebP here, which is what keeps the avatar under
3 MB on the wire.
"""
from __future__ import annotations

import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

RAW = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars"
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "avatar"

# category, avatar name, texture prefix
DEFAULT = ("Professions", "Business_Female_01", "f014")

# name -> (size, quality). The head gets full resolution because the face carries
# the non-manual markers that ASL grammar rides on; the body is a dark suit and
# shows far less.
TEXTURES = {
    "head_color": (2048, 92),
    "body_color": (1024, 90),
    "head_normal": (1024, 90),
    "body_normal": (512, 88),
    "opacity_color": (1024, 90),
}

# Rocketbox ships specular maps. three.js wants roughness, which is the inverse,
# so these are inverted on the way through. Without them skin renders as a flat
# matte plane - the "waxy forehead" look.
SPECULAR_AS_ROUGHNESS = {
    "head_specular": ("head_rough", 1024, 88),
    "body_specular": ("body_rough", 512, 86),
}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        return response.read()


def main() -> None:
    category, name, prefix = DEFAULT
    if len(sys.argv) >= 3:
        category, name = sys.argv[1], sys.argv[2]
        prefix = sys.argv[3] if len(sys.argv) > 3 else prefix
    base = f"{RAW}/{category}/{name}"
    OUT.mkdir(parents=True, exist_ok=True)

    # The _facial variant carries the 175 blend shapes; the plain one does not.
    print(f"fetching {name}_facial.fbx ...")
    model = fetch(f"{base}/Export/{name}_facial.fbx")
    (OUT / "signer.fbx").write_bytes(model)
    print(f"  signer.fbx  {len(model)/1e6:.1f} MB")

    total = len(model)
    for tex, (size, quality) in TEXTURES.items():
        url = f"{base}/Textures/{prefix}_{tex}.tga"
        try:
            raw = fetch(url)
        except Exception as exc:  # noqa: BLE001 - a missing map is not fatal
            print(f"  skip {tex}: {exc}")
            continue
        image = Image.open(io.BytesIO(raw))
        image = image.convert("RGBA" if "opacity" in tex else "RGB")
        image = image.resize((size, size), Image.LANCZOS)
        dst = OUT / f"{prefix}_{tex}.webp"
        image.save(dst, quality=quality, method=6)
        total += dst.stat().st_size
        print(f"  {dst.name}  {size}px  {dst.stat().st_size/1024:.0f} KB")

    for src_name, (dst_name, size, quality) in SPECULAR_AS_ROUGHNESS.items():
        url = f"{base}/Textures/{prefix}_{src_name}.tga"
        try:
            raw = fetch(url)
        except Exception as exc:  # noqa: BLE001
            print(f"  skip {src_name}: {exc}")
            continue
        image = Image.open(io.BytesIO(raw)).convert("L")
        image = ImageOps.invert(image).resize((size, size), Image.LANCZOS)
        dst = OUT / f"{prefix}_{dst_name}.webp"
        image.save(dst, quality=quality, method=6)
        total += dst.stat().st_size
        print(f"  {dst.name}  {size}px  {dst.stat().st_size/1024:.0f} KB  (inverted specular)")

    print(f"\ntotal {total/1e6:.1f} MB")
    print("If the texture prefix changed, update TEXTURES in frontend/src/signerRig.ts.")


if __name__ == "__main__":
    main()
