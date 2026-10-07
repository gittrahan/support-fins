#!/usr/bin/env python3
"""Sampler: one part with every overhang the tool has to handle, built by the
site's Full coverage at its defaults. Not a rung coupon: it sets nothing. It shows
what the site makes on each shape, in one print.

Along a spine block on the plate (x 0-126, y -7..7, 30 mm tall), clockwise from the
front left:

    front (-y)  ramps at 40 / 30 / 20 deg rising 10 mm, a 20 mm ball, a 2 mm ledge 18 mm out
    back  (+y)  a table (28 mm flat bridge between its legs), a 26 mm mushroom cap on a 5 mm stem, a cave
    through     sideways holes 3 / 6 / 12 mm across, along y
    end         an arch tunnel (x 0 end)

Every feature is big enough that its walls are real walls (the first draft's 3-8 mm
stubs couldn't show whether a wall snaps off clean). Ramps and holes carry their
angle / size as raised text.

Everything joins the spine, so it is ONE solid piece (coupon.write checks).

    python3 prototype/calibration/sampler/gen.py && deno run -A prototype/calibration/sampler/build.js
"""
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
from trimesh.creation import cylinder, icosphere

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

L, HW, H = 126.0, 7.0, 30.0
add, cut = [], []


def ramp(x0, w, angle, z0=4.0, rise=10.0, side=-1):
    """A wedge off the spine face: underside rising `rise` at `angle` up from the plate."""
    d = rise / math.tan(math.radians(angle))
    yz = [(0, z0), (d, z0 + rise), (d, z0 + rise + 2), (0, z0 + rise + 2)]
    yz = [(side * (HW - 0.5 + y), z) for y, z in yz]
    if side < 0:
        yz = yz[::-1]
    m = trimesh.creation.extrude_polygon(trimesh.path.polygons.Polygon(yz), w)
    m.apply_transform([[0, 0, 1, x0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    return m


def along_y(m):
    """Rotate a z-axis primitive (cylinder) to run along y."""
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
    return m


def at(m, x, y, z):
    m.apply_translation([x, y, z])
    return m


# the spine
add.append(bx(0, L, -HW, HW, 0, H))

# FRONT (-y): three ramps, a ball, a thin far ledge
for x0, a in [(2, 40), (17, 30), (32, 20)]:
    add.append(ramp(x0, 13, a))
    d = 10 / math.tan(math.radians(a))
    add += label(f'{a}', x0 + 6.5, -HW - min(d, 14) / 2 - 0.5, 16, size=5.0)  # on the ramp's top
add.append(at(icosphere(subdivisions=3, radius=10), 56, -HW - 7, 17))         # ball, low point 7 up
add.append(bx(70, 94, -HW - 18, -HW + 0.5, 24, 26))                           # 2 mm ledge, 18 out, 24 up

# BACK (+y): table, mushroom, cave
add += [bx(2, 38, HW - 0.5, HW + 16, 14, 17),                                # table top: 30 mm bridge
        bx(2, 6, HW + 12, HW + 16, 0, 14), bx(34, 38, HW + 12, HW + 16, 0, 14)]  # its two legs
add += [at(cylinder(radius=2.5, height=16, sections=32), 56, HW + 14, 8),     # stem on the plate
        at(cylinder(radius=13, height=3, sections=64), 56, HW + 14, 17.5),    # cap, 13 mm round
        bx(53.5, 58.5, HW - 0.5, HW + 12, 0, 3)]                               # foot strip to the spine
add.append(bx(70, 94, HW - 0.5, HW + 14, 0, 24))                              # block holding the cave
cut.append(bx(73, 91, HW + 0.5, HW + 14.5, 3, 18))                            # cave: open to +y, flat 18 x 14 ceiling

# THROUGH: sideways holes along y, centred high enough that each has a ceiling to hold
# (their own stretch, x 96-124: nothing else on either face there)
for x, d in [(99, 3.0), (106, 6.0), (117, 12.0)]:
    cut.append(at(along_y(cylinder(radius=d / 2, height=2 * HW + 2, sections=48)), x, 0, 16))
    add += label(f'{d:g}', x, 0, H, size=5.0)                                  # its size, on the spine's top

# END: arch through a block on the x 0 end (along y)
add.append(bx(-14, 0.5, -HW, HW, 0, 20))
cut += [at(along_y(cylinder(radius=5, height=2 * HW + 2, sections=48)), -7, 0, 8),
        bx(-12, -2, -HW - 1, HW + 1, -1, 8)]                                  # arch: 10 wide, 13 high

m = trimesh.boolean.difference([trimesh.boolean.union(add, engine='manifold'),
                                trimesh.boolean.union(cut, engine='manifold')], engine='manifold')
m = write(__file__, [m], [])
print(f'sampler part {m.extents.round(1)} mm, {len(m.faces)} triangles')
