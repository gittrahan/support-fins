#!/usr/bin/env python3
"""Pad coupon: how far off the part should the bed pad stand (Bed pad > Custom >
Pad gap) to hold the part down and still peel off clean? Too small welds the pad
on; too big lets the part go.

The one coupon that is SEVERAL pieces, on purpose: a bed pad holds a part that
barely touches the plate, so each rung is its own 15 mm cube standing on an edge,
held only by its pad (a cube that comes loose mid-print is the result, not a lost
coupon). build.js runs the site's Auto build once per cube with Bed pad = Custom
at Light's numbers and that cube's Pad gap. Cube k carries k dots.

    python3 prototype/calibration/pad/gen.py && deno run -A prototype/calibration/pad/build.js
"""
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

GAPS = [0, 0.08, 0.12, 0.16, 0.2, 0.3]   # 0.12 = Light's brim gap; under ~0.1 slicers close it
S, STEP = 15.0, 28.0

parts, rungs = [], []
for k, gap in enumerate(GAPS):
    cube = trimesh.util.concatenate([bx(-S / 2, S / 2, -S / 2, S / 2, -S / 2, S / 2)]
                                    + dots(k + 1, -S / 2 + 2.5, -S / 2 + 2.5, S / 2, step=1.6, size=1.0))
    cube = trimesh.boolean.union([cube], engine='manifold')
    cube.apply_transform(trimesh.transformations.rotation_matrix(0.7853981634, [1, 0, 0]))   # onto an edge
    cube.apply_translation([k * STEP, 0, -cube.bounds[0][2]])
    parts.append(cube)
    rungs.append({'id': k + 1, 'padGap': gap, 'box': [k * STEP - STEP / 2, k * STEP + STEP / 2, -STEP, STEP]})
m = write(__file__, parts, rungs, one_piece=False)
print(f'pad coupon {m.extents.round(1)} mm, {len(GAPS)} cubes')
for r in rungs: print(f"  cube {r['id']} ({r['id']} dots): pad gap {r['padGap']} mm")
