#!/usr/bin/env python3
"""Angle coupon: what overhang angle does YOUR printer manage with no support at
all? Sets the Overhang slider (the surface angle from the plate below which a
face gets support).

Print it with NO supports (slicer supports off, no fins). ONE solid piece: a bar
standing on the plate with seven ramps sticking out of it, each underside at its
own angle from the plate (10-40 deg, every one rising the same 4 mm). Read the
undersides: the shallowest ramp that printed clean is your Overhang setting.
Ramp k carries k dots.

The first build (30-60 deg, 8 mm rise, commit 925380c) printed clean on every ramp
on Matthew's printer (PLA, 2026-10-02), so this one goes shallower. Its 30-40 deg
ramps overlap that print. The Overhang slider stops at 30, so a clean ramp below 30
says the slider's floor is too high, not a setting to type.

    python3 prototype/calibration/angle/gen.py      # -> out/angle-coupon.stl (no build.js: no supports)
"""
import math
import shutil
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

ANGLES = [10, 15, 20, 25, 30, 35, 40]   # 30-60 all printed clean (first build); the slider runs 30-70
BAR_W, Z0, RISE, TOP_T, W, STEP = 10.0, 2.0, 4.0, 2.0, 10.0, 14.0


def ramp(x, side, angle):
    """A prism off the bar face: underside from (bar, Z0) up to (bar + d, Z0 + RISE),
    vertical outer face, flat top RISE + TOP_T up."""
    d = RISE / math.tan(math.radians(angle))
    y_in, y_out = side * BAR_W / 2, side * (BAR_W / 2 + d)
    top = Z0 + RISE + TOP_T
    yz = [(y_in, Z0), (y_out, Z0 + RISE), (y_out, top), (y_in - side * 0.5, top), (y_in - side * 0.5, Z0)]
    if side < 0:
        yz = yz[::-1]                     # keep the outline counter-clockwise
    pts = [(y, z) for y, z in yz]
    poly = trimesh.path.polygons.Polygon(pts)
    m = trimesh.creation.extrude_polygon(poly, W)          # outline in XY, extruded along +Z
    # outline (y, z) drawn as (x', y'), extruded along z' -> map x'->y, y'->z, z'->x
    m.apply_transform([[0, 0, 1, x], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    return m, d


parts, rungs = [], []
for k, a in enumerate(ANGLES):
    side = 1 if k < 4 else -1
    x = 4.0 + (k % 4) * STEP
    m, d = ramp(x, side, a)
    parts.append(m)
    parts += dots(k + 1, x + 1.0, side * (BAR_W / 2 + d - 1.5), Z0 + RISE + TOP_T, step=1.4, size=0.9)
    rungs.append({'id': k + 1, 'angle': a, 'depth': round(d, 1)})
L = 4.0 + 3 * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, Z0 + RISE + TOP_T + 2))
m = write(__file__, parts, rungs)
out = Path(__file__).parent / 'out'
shutil.copy(out / 'coupon_part.stl', out / 'angle-coupon.stl')
print(f'angle coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ramp {r['id']} ({r['id']} dots): {r['angle']} deg, reaches {r['depth']} mm out")
