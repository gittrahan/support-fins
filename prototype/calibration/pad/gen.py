#!/usr/bin/env python3
"""Pad coupon: how far off the part should the bed pad stand (Bed pad > Custom >
Pad gap) to hold the part down and still peel off clean? Too small welds the pad
on; too big lets the part go.

The one coupon that is SEVERAL pieces, on purpose: a bed pad holds a part that
barely touches the plate, so each rung is its own 15 mm cube standing on an edge,
held only by its pad (a cube that comes loose mid-print is the result, not a lost
coupon). Each cube is its own part (out/cube_<k>.stl): build.js runs the site's
Auto build on each one alone, with Bed pad = Custom at Light's numbers and that
cube's Pad gap, so every cube gets the pad the site would give it -- built
together, their contacts line up and the engine lays ONE pad under all six.
Cube k carries k dots.

    python3 prototype/calibration/pad/gen.py && deno run -A prototype/calibration/pad/build.js
"""
import json
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots  # noqa: E402

GAPS = [0, 0.08, 0.12, 0.16, 0.2, 0.3]   # 0.12 = Light's brim gap; under ~0.1 slicers close it
S, STEP = 15.0, 28.0

out = Path(__file__).parent / 'out'
out.mkdir(exist_ok=True)
rungs = []
for k, gap in enumerate(GAPS):
    cube = trimesh.boolean.union([bx(-S / 2, S / 2, -S / 2, S / 2, -S / 2, S / 2)]
                                 + dots(k + 1, -S / 2 + 2.5, -S / 2 + 2.5, S / 2, step=1.6, size=1.0),
                                 engine='manifold')
    assert cube.is_watertight and len(cube.split(only_watertight=False)) == 1
    cube.apply_transform(trimesh.transformations.rotation_matrix(0.7853981634, [1, 0, 0]))   # onto an edge
    cube.apply_translation([0, 0, -cube.bounds[0][2]])
    cube.export(out / f'cube_{k + 1}.stl')
    rungs.append({'id': k + 1, 'padGap': gap, 'x': k * STEP, 'file': f'cube_{k + 1}.stl'})
json.dump(rungs, open(out / 'rungs.json', 'w'), indent=1)
print(f'pad coupon: {len(GAPS)} cubes, {STEP:.0f} mm apart')
for r in rungs: print(f"  cube {r['id']} ({r['id']} dots): pad gap {r['padGap']} mm")
