#!/usr/bin/env python3
"""Bore coupon: do the walls the site stands inside a sideways hole pull out
clean, and from what size? Bores DO get supported (a wall along the bore's axis,
pulled out an open end; the old never-fin-a-bore rule was reversed 2026-09-27).

ONE solid piece: a block lying on the plate with four through-bores along y,
3 / 5 / 8 / 12 mm across, all centred 9 mm up. build.js runs the site's Auto
build once (nothing is varied) and keeps everything. Each bore has its diameter (mm) raised above it.

    python3 prototype/calibration/bore/gen.py && deno run -A prototype/calibration/bore/build.js
"""
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

DIAMETERS = [3, 5, 8, 12]
DEPTH, ZC, TOP, WALL = 20.0, 9.0, 18.0, 4.0     # bore length (y), centre height, block height, rib between bores

xs, x = [], WALL
for d in DIAMETERS:
    xs.append(x + d / 2)
    x += d + WALL + 2
L = x - 2
block = bx(0, L, -DEPTH / 2, DEPTH / 2, 0, TOP)
for k, (d, xc) in enumerate(zip(DIAMETERS, xs)):
    hole = trimesh.creation.cylinder(radius=d / 2, height=DEPTH + 2, sections=96)
    hole.apply_transform(trimesh.transformations.rotation_matrix(1.5707963, [1, 0, 0]))
    hole.apply_translation([xc, 0, ZC])
    block = block.difference(hole, engine='manifold')
parts = [block]
rungs = []
for k, (d, xc) in enumerate(zip(DIAMETERS, xs)):
    parts += label(f'{d}', xc, -DEPTH / 2 + 4.0, TOP, size=5.0)
    rungs.append({'id': k + 1, 'diameter': d, 'box': [xc - d / 2 - 1, xc + d / 2 + 1, -DEPTH / 2 - 30, DEPTH / 2 + 30]})
m = write(__file__, parts, rungs)
print(f'bore coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  bore {r['id']}: {r['diameter']} mm")
