#!/usr/bin/env python3
"""Lip coupon: how far may an overhang run PAST its last wall before the free
edge curls? (local issue 009; the slenderness coupon's 4 mm lip curled on every
ledge.) Sets the rule for moving a row out to a free edge (PROP.edgeInset).

ONE solid piece, like the other coupons: a slab, a spine, and six ledges 10 mm up,
three per side. build.js stands one wall on the slab under each ledge, its outer
face LIP mm in from the ledge's free edge; between the wall and the spine is a
short 3 mm bridge, the same on every ledge. Ledge k carries k dots on top.

    python3 prototype/calibration/lip/gen.py && deno run -A prototype/calibration/lip/build.js
"""
import json, numpy as np, trimesh
from trimesh.creation import box
from pathlib import Path

OUT = Path(__file__).parent / 'out'
OUT.mkdir(exist_ok=True)
LIPS = [0.1, 1, 2, 3, 4, 6]          # 0.1 = flush (PROP.edgeInset 0.6 - th/2)
TH, BRIDGE = 1.0, 3.0                 # wall thickness; wall-to-spine bridge
SLAB_T, SPINE_T, LEDGE_T, H, W, MARGIN, GAP_X = 3.0, 4.0, 2.0, 10.0, 12.0, 1.0, 6.0

def bx(x0, x1, y0, y1, z0, z1):
    b = box([x1 - x0, y1 - y0, z1 - z0]); b.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]); return b

parts, ledges = [], []
depth_max = BRIDGE + TH + max(LIPS)
for k, lip in enumerate(LIPS):
    side = +1 if k < 3 else -1
    x = 5.0 + (k % 3) * (W + GAP_X)
    depth = BRIDGE + TH + lip
    z = SLAB_T + H
    y0, y1 = (SPINE_T / 2, SPINE_T / 2 + depth) if side > 0 else (-SPINE_T / 2 - depth, -SPINE_T / 2)
    parts.append(bx(x, x + W, y0, y1, z, z + LEDGE_T))
    ym = (SPINE_T / 2 + 1.5) * side                       # dots near the spine, on every ledge
    for d in range(k + 1):
        cx = x + 1.5 + d * 1.8
        parts.append(bx(cx - 0.5, cx + 0.5, ym - 0.5, ym + 0.5, z + LEDGE_T - 0.1, z + LEDGE_T + 0.8))
    free = y1 if side > 0 else y0                         # the free edge
    ywall = free - side * (lip + TH / 2)
    ledges.append({'id': k + 1, 'lip': lip, 'z': z, 'x0': x + MARGIN, 'x1': x + W - MARGIN, 'y': ywall})
L = 5.0 + 3 * (W + GAP_X) - GAP_X + 5.0
top = SLAB_T + H + LEDGE_T + 2
parts.append(bx(0, L, -SPINE_T / 2 - depth_max - 3, SPINE_T / 2 + depth_max + 3, 0, SLAB_T))  # slab
parts.append(bx(0, L, -SPINE_T / 2, SPINE_T / 2, SLAB_T - 0.5, top))                          # spine
m = trimesh.boolean.union(parts, engine='manifold')
assert m.is_watertight and len(m.split(only_watertight=False)) == 1
m.export(OUT / 'coupon_part.stl')
json.dump(ledges, open(OUT / 'ledges.json', 'w'), indent=1)
print(f'coupon {np.round(m.extents, 1)} mm, {len(ledges)} ledges')
for l in ledges: print(f"  ledge {l['id']} ({l['id']} dots): lip {l['lip']} mm past the wall")
