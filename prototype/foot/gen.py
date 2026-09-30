#!/usr/bin/env python3
"""Foot coupon (local issue 009): how should a wall standing ON THE PART meet it?

ONE solid piece, like prototype/slender/: a slab, a spine, and six 8 mm ledges
15 mm up, three per side. build.js stands one part-attached wall under each ledge
with a different foot (VARIANTS). Ledge k carries k dots on top so you can tell
them apart. Each wall sits 1 mm in from the ledge's free edge so the free-edge
curl from the slenderness print doesn't muddy the scar.

    python3 prototype/foot/gen.py && deno run -A prototype/foot/build.js
"""
import json, numpy as np, trimesh
from trimesh.creation import box
from pathlib import Path

OUT = Path(__file__).parent / 'out'
OUT.mkdir(exist_ok=True)
VARIANTS = [
    {'name': 'welded (today)',         'footGap': 0.0, 'footTeeth': 0},
    {'name': 'gap 0.2',                'footGap': 0.2, 'footTeeth': 0},
    {'name': 'gap 0.3',                'footGap': 0.3, 'footTeeth': 0},
    {'name': 'teeth every 3 mm',       'footGap': 0.0, 'footTeeth': 3},
    {'name': 'teeth every 5 mm',       'footGap': 0.0, 'footTeeth': 5},
    {'name': 'teeth every 3 mm + gap 0.2', 'footGap': 0.2, 'footTeeth': 3},
]
SLAB_T, SPINE_T, LEDGE_T, DEPTH, H, SPAN, MARGIN, GAP_X, EDGE = 3.0, 4.0, 2.0, 8.0, 15.0, 12.0, 1.0, 6.0, 1.0

def bx(x0, x1, y0, y1, z0, z1):
    b = box([x1 - x0, y1 - y0, z1 - z0]); b.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]); return b

parts, ledges = [], []
w = SPAN + 2 * MARGIN
for k, v in enumerate(VARIANTS):
    side = +1 if k < 3 else -1
    x = 5.0 + (k % 3) * (w + GAP_X)
    z = SLAB_T + H
    y0, y1 = (SPINE_T / 2, SPINE_T / 2 + DEPTH) if side > 0 else (-SPINE_T / 2 - DEPTH, -SPINE_T / 2)
    parts.append(bx(x, x + w, y0, y1, z, z + LEDGE_T))
    for d in range(k + 1):                                   # k+1 dots: ledge id
        cx = x + 2 + d * 2.0
        parts.append(bx(cx - 0.6, cx + 0.6, (y0 + y1) / 2 - 0.6, (y0 + y1) / 2 + 0.6, z + LEDGE_T - 0.1, z + LEDGE_T + 1.0))
    ywall = y1 - EDGE if side > 0 else y0 + EDGE
    ledges.append({**v, 'id': k + 1, 'z': z, 'x0': x + MARGIN, 'x1': x + MARGIN + SPAN, 'y': ywall})
L = 5.0 + 3 * (w + GAP_X) - GAP_X + 5.0
top = SLAB_T + H + LEDGE_T + 3
parts.append(bx(0, L, -SPINE_T / 2 - DEPTH - 4, SPINE_T / 2 + DEPTH + 4, 0, SLAB_T))   # slab
parts.append(bx(0, L, -SPINE_T / 2, SPINE_T / 2, SLAB_T - 0.5, top))                # spine
m = trimesh.boolean.union(parts, engine='manifold')
assert m.is_watertight and len(m.split(only_watertight=False)) == 1
m.export(OUT / 'coupon_part.stl')
json.dump(ledges, open(OUT / 'ledges.json', 'w'), indent=1)
print(f'coupon {np.round(m.extents, 1)} mm, {len(ledges)} ledges')
for l in ledges: print(f"  ledge {l['id']} ({l['id']} dots): {l['name']}")
