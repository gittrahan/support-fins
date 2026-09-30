#!/usr/bin/env python3
"""Slenderness coupon: how tall may a wall standing ON THE PART be for its length?

ONE solid piece (the last multi-piece coupon lost parts off the bed): a 125 x 36 mm
slab, a spine along its middle, and ledges cantilevered off the spine. Under each
ledge build.js stands one part-attached wall on the slab, height:length 2/3/5/7:1.
Writes ledges.json (the wall lines) for build.js.

    python3 prototype/calibration/slender/gen.py && deno run -A prototype/calibration/slender/build.js
"""
import json, numpy as np, trimesh
from trimesh.creation import box
from pathlib import Path

OUT = Path(__file__).parent / 'out'
OUT.mkdir(exist_ok=True)
SLAB_T, SPINE_T, LEDGE_T, DEPTH, GAP_X, MARGIN = 3.0, 4.0, 2.0, 8.0, 10.0, 0.5
RATIOS = [2, 3, 5, 7]
MIN_SPAN = 3.0                       # PROP.minSpanPart

def bx(x0, x1, y0, y1, z0, z1):
    b = box([x1 - x0, y1 - y0, z1 - z0]); b.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]); return b

# +y side: 15 and 25 mm walls; -y side: 40 mm walls
sides = {+1: [15, 25], -1: [40]}
parts, ledges, xmax = [], [], 0
for side, heights in sides.items():
    x = 5.0
    for h in heights:
        for r in RATIOS:
            span = h / r
            if span < MIN_SPAN: continue
            w = span + 2 * MARGIN
            z = SLAB_T + h                               # ledge underside
            y0, y1 = (SPINE_T / 2, SPINE_T / 2 + DEPTH) if side > 0 else (-SPINE_T / 2 - DEPTH, -SPINE_T / 2)
            parts.append(bx(x, x + w, y0, y1, z, z + LEDGE_T))
            ledges.append({'h': h, 'ratio': r, 'span': span, 'z': z,
                           'x0': x + MARGIN, 'x1': x + MARGIN + span, 'y': (y0 + y1) / 2 + side * 0.0})
            x += w + GAP_X
    xmax = max(xmax, x)
L = xmax + 5.0 - GAP_X
top = max(l['z'] for l in ledges) + LEDGE_T + 3
parts.append(bx(0, L, -18, 18, 0, SLAB_T))                                  # slab
parts.append(bx(0, L, -SPINE_T / 2, SPINE_T / 2, SLAB_T - 0.5, top))         # spine
m = trimesh.boolean.union(parts, engine='manifold')
assert m.is_watertight and len(m.split(only_watertight=False)) == 1
m.export(OUT / 'coupon_part.stl')
json.dump(ledges, open(OUT / 'ledges.json', 'w'), indent=1)
print(f'coupon {np.round(m.extents, 1)} mm, {len(ledges)} ledges')
for l in ledges: print(f"  h {l['h']:2}  {l['ratio']}:1  span {l['span']:.1f}")
