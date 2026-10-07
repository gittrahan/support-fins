#!/usr/bin/env python3
"""Bore coupon: do the walls the site stands inside a sideways hole pull out
clean, from what size, and does it matter which way they run?

ONE solid piece: a block lying on the plate with eight through-bores along y,
two sets of 3 / 5 / 8 / 12 mm across, all centred 9 mm up. Each bore has its
diameter (mm) raised above it at the front and its set's letter at the back:
  A (left four)   ALONG: the site's Auto build, one wall along the bore's axis,
                  pulled out an open end (bores DO get supported -- the old
                  never-fin-a-bore rule was reversed 2026-09-27).
  X (right four)  ACROSS: the same bores with their walls turned 90 deg -- three
                  Draw walls across each bore (y -6 / 0 / 6). A wall across a
                  round bore is shaped to its cross-section, so it can still slide
                  out along the bore; the orient coupon found walls across the
                  slicer's bridge lines beat walls along them on flat ledges.
build.js keeps Auto's walls in the A bores only and draws the X walls itself.

    python3 prototype/calibration/bore/gen.py && deno run -A prototype/calibration/bore/build.js
"""
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

DIAMETERS = [3, 5, 8, 12]
SETS = ['A', 'X']                               # along, across
CROSS_Y = [-6.0, 0.0, 6.0]                      # where the X bores' walls run across
DEPTH, ZC, TOP, WALL = 20.0, 9.0, 18.0, 4.0     # bore length (y), centre height, block height, rib between bores

bores, x = [], WALL                             # (set, diameter, x centre)
for s in SETS:
    for d in DIAMETERS:
        bores.append((s, d, x + d / 2))
        x += d + WALL + 2
L = x - 2
block = bx(0, L, -DEPTH / 2, DEPTH / 2, 0, TOP)
for _, d, xc in bores:
    hole = trimesh.creation.cylinder(radius=d / 2, height=DEPTH + 2, sections=96)
    hole.apply_transform(trimesh.transformations.rotation_matrix(1.5707963, [1, 0, 0]))
    hole.apply_translation([xc, 0, ZC])
    block = block.difference(hole, engine='manifold')
parts = [block]
rungs = []
for k, (s, d, xc) in enumerate(bores):
    parts += label(f'{d}', xc, -DEPTH / 2 + 4.0, TOP, size=5.0)
    parts += label(s, xc, DEPTH / 2 - 4.0, TOP, size=5.0)
    rungs.append({'id': k + 1, 'set': s, 'diameter': d, 'xc': xc, 'zc': ZC, 'cross_y': CROSS_Y if s == 'X' else [],
                  'box': [xc - d / 2 - 1, xc + d / 2 + 1, -DEPTH / 2 - 30, DEPTH / 2 + 30]})
m = write(__file__, parts, rungs)
print(f'bore coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  bore {r['id']}: {r['set']} {r['diameter']} mm")
