#!/usr/bin/env python3
"""Bite coupon: how far should the tines reach into the part (the Tine bite field,
PROP.tineBite)? Too far leaves a mark where each tine snaps off; too little and the
tine never fuses, so it stops gripping. One print finds both ends: the rungs run
0.15-0.70 mm in 0.05 steps (at 0.10 the engine places no tines on this slope).

ONE solid piece: a bar standing on the plate with twelve identical ledges, six per
side, each underside sloping 40 deg off the plate (a face the site supports at the
default 45 deg Overhang) over open plate. build.js runs the site's Auto build once
per ledge with that ledge's Tine bite and keeps the walls under it. Ledge k carries
k dots (a second row past six).

    python3 prototype/calibration/bite/gen.py && deno run -A prototype/calibration/bite/build.js
"""
import math
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

BITES = [round(0.15 + 0.05 * i, 2) for i in range(12)]   # 0.15 ... 0.70
ANGLE, BAR_W, Z0, RISE, TOP_T, W, STEP = 40.0, 10.0, 6.0, 6.0, 2.0, 16.0, 19.0
D = RISE / math.tan(math.radians(ANGLE))


def ledge(x, side):
    """Off the bar face: underside from (bar, Z0) up to (bar + D, Z0 + RISE) at ANGLE,
    a vertical outer face, a flat top."""
    y_in, y_out, top = side * (BAR_W / 2 - 0.5), side * (BAR_W / 2 + D), Z0 + RISE + TOP_T
    yz = [(y_in, Z0), (side * BAR_W / 2, Z0), (y_out, Z0 + RISE), (y_out, top), (y_in, top)]
    if side < 0:
        yz = yz[::-1]
    m = trimesh.creation.extrude_polygon(trimesh.path.polygons.Polygon(yz), W)
    m.apply_transform([[0, 0, 1, x], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    return m


parts, rungs = [], []
for k, bite in enumerate(BITES):
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
    rungs.append({'id': n, 'bite': bite, 'box': [x - 1.5, x + W + 1.5, y0 - 0.5, y1 + 0.5]})
L = 4.0 + 5 * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, Z0 + RISE + TOP_T + 2))
m = write(__file__, parts, rungs)
print(f'bite coupon {m.extents.round(1)} mm, ledges reach {D:.1f} mm out')
for r in rungs: print(f"  ledge {r['id']} ({r['id']} dots): tine bite {r['bite']} mm")
