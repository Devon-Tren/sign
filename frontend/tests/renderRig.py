"""Render the posed production mesh exported by verifyRig.ts, without WebGL.

Usage: python3 frontend/tests/renderRig.py artifacts/rig-verify/meshes
Flat lighting and bone-region colours make arm/body occlusion legible. These
are geometry review images, not screenshots of the textured Motion Inspector.
"""
import json
import math
import pathlib
import sys
from PIL import Image, ImageDraw

directory = pathlib.Path(sys.argv[1])
ids = ['father', 'know', 'think', 'mother', 'thank_you', 'good', 'hello', 'morning', 'cannot', 'fish']
size = (320, 400)

def render(data, side):
    image = Image.new('RGB', size, '#edf1f4')
    draw = ImageDraw.Draw(image)
    vertices, indices, regions = data['positions'], data['indices'], data['regions']
    triangles = []
    for i in range(0, len(indices), 3):
        ids = indices[i:i+3]
        a, b, c = [vertices[j] for j in ids]
        if max(a[1], b[1], c[1]) < -0.35:
            continue
        u, v = [b[k]-a[k] for k in range(3)], [c[k]-a[k] for k in range(3)]
        normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        length = math.hypot(*normal) or 1
        light = max(0, sum(n*l for n, l in zip(normal, [-0.4, 0.6, 0.7])) / length)
        shade = 0.45 + 0.55 * light
        color = (215, 166, 129) if sum(regions[j] for j in ids) >= 2 else (59, 94, 123)
        color = tuple(int(ch * shade) for ch in color)
        points = [(160 + (p[2] - .30 if side else p[0]) * 160, 365 - (p[1]+.35) * 180) for p in [a, b, c]]
        depth = sum(-p[0] if side else p[2] for p in [a, b, c])
        triangles.append((depth, points, color))
    for _, points, color in sorted(triangles, key=lambda x: x[0]):
        draw.polygon(points, fill=color)
    return image

for page in range(2):
    sheet = Image.new('RGB', (size[0]*6, size[1]*5), 'white')
    for row, sign in enumerate(ids[page*5:page*5+5]):
        for phase, f in enumerate([.35, .55, .75]):
            data = json.loads((directory / f'{sign}-{f}.json').read_text())
            for side in [False, True]:
                picture = render(data, side)
                ImageDraw.Draw(picture).text((8, 8), f'{sign} {f:.2f} {"side" if side else "front"}', fill='black')
                sheet.paste(picture, ((phase*2+int(side))*size[0], row*size[1]))
    sheet.save(directory.parent / f'front-side-{page+1}.png')
