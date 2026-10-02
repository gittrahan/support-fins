#!/usr/bin/env python3
"""Tine coupon: what leaves the smallest tine mark and still holds? The bite coupon
answered "not the bite": every rung fused the same, because under a sloped
underside the part's next layer prints straight onto the tine, and a slicer merges
a tine into the part it touches. So this one varies what does change the weld:

  near side (shape, 3 tines a wall):   1 square 0.5 wide (today)   2 square 0.4
                                       3 square 0.3   4 pointed tip (0.5 at the wall)
                                       5 KISS square   6 KISS pointed
  far side (count, today's square):    7 three tines   8 two   9 one   10 none

KISS ledges' tines are cut off at the part's surface and saved as their OWN object
in the 3MF, so the slicer keeps them separate from the part instead of merging them
(kiss.py). Every other ledge is the site's own output, part and supports one object.

ONE solid piece: the bite coupon's bar and 40 deg ledges (a face the site supports at
the default 45 deg Overhang). Ledge k carries k dots (a second row past six).

    python3 prototype/calibration/tine/gen.py && deno run -A prototype/calibration/tine/build.js \
      && python3 prototype/calibration/tine/kiss.py
"""
import math
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

# per ledge: the tunables it builds with, and whether its tines kiss
RUNGS = [
    {'label': 'square 0.5 (today)', 'tunables': {}},
    {'label': 'square 0.4', 'tunables': {'tineWidth': 0.4}},
    {'label': 'square 0.3', 'tunables': {'tineWidth': 0.3}},
    {'label': 'pointed tip', 'tunables': {'tineTip': 'point'}},
    {'label': 'kiss, square', 'tunables': {}, 'kiss': True},
    {'label': 'kiss, pointed', 'tunables': {'tineTip': 'point'}, 'kiss': True},
    {'label': '3 tines', 'tunables': {'tinesPerWall': 3}},
    {'label': '2 tines', 'tunables': {'tinesPerWall': 2}},
    {'label': '1 tine', 'tunables': {'tinesPerWall': 1}},
    {'label': 'no tines', 'tunables': {}, 'tines': False},
]
ANGLE, BAR_W, Z0, RISE, TOP_T, W, STEP = 40.0, 10.0, 6.0, 6.0, 2.0, 16.0, 19.0
D = RISE / math.tan(math.radians(ANGLE))


def ledge(x, side):
    """Off the bar face: underside from (bar, Z0) up to (bar + D, Z0 + RISE) at ANGLE,
    a vertical outer face, a flat top. (The bite coupon's ledge.)"""
    y_in, y_out, top = side * (BAR_W / 2 - 0.5), side * (BAR_W / 2 + D), Z0 + RISE + TOP_T
    yz = [(y_in, Z0), (side * BAR_W / 2, Z0), (y_out, Z0 + RISE), (y_out, top), (y_in, top)]
    if side < 0:
        yz = yz[::-1]
    m = trimesh.creation.extrude_polygon(trimesh.path.polygons.Polygon(yz), W)
    m.apply_transform([[0, 0, 1, x], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    return m


parts, rungs = [], []
for k, r in enumerate(RUNGS):
    side = 1 if k < 6 else -1
    x = 4.0 + (k % 6) * STEP
    parts.append(ledge(x, side))
    top = Z0 + RISE + TOP_T
    n = k + 1
    yd = side * (BAR_W / 2 + D - 1.2)
    parts += dots(min(n, 6), x + 2.0, yd, top, step=1.6, size=0.9)
    if n > 6:
        parts += dots(n - 6, x + 2.0, yd - side * 1.8, top, step=1.6, size=0.9)
    y0, y1 = sorted([side * BAR_W / 2, side * (BAR_W / 2 + D)])
    rungs.append({'id': n, **r, 'box': [x - 1.5, x + W + 1.5, y0 - 0.5, y1 + 0.5]})
L = 4.0 + 5 * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, Z0 + RISE + TOP_T + 2))
m = write(__file__, parts, rungs)
print(f'tine coupon {m.extents.round(1)} mm, ledges reach {D:.1f} mm out')
for r in rungs: print(f"  ledge {r['id']} ({r['id']} dots): {r['label']}")
