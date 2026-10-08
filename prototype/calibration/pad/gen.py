#!/usr/bin/env python3
"""Pad coupon: how far off the part should the bed pad stand (Bed pad > Custom >
Pad gap) to hold the part down and still peel off clean? Too small welds the pad
on; too big lets the part go.

ONE piece (Matthew: no loose cubes): a keel -- a bar whose underside is a knife
edge, so it meets the bed along a line -- with pointed arches cut out of that edge
so it stands on three long feet. Each foot gets its own pad at its own Pad gap. The
keel's sides (above a 1.5 mm 45 deg edge), the arches and the ramps at the ends all rise at 60 deg, steeper than
the 45 deg overhang limit, so nothing but the pads holds the bar (a square bar on
its edge leaned at 45 deg, and Auto braced those faces with wedges). A foot whose
pad stands too far off lifts at that corner; a pad that won't peel, or tears the
edge, is too close.

The engine lays ONE pad under all of a part's bed contact, so build.js builds each
foot's pad on its own post: out/foot_<k>.stl is the bar cut at the arch apexes
either side of foot k, or at the same height up the end ramp (above the pad, so the pad sees the same part it would under
the whole bar). out/coupon_part.stl is the whole bar. The pad's oval is centred on
the contact's mean VERTEX, so a foot with a flat end face (many vertices at one
end) got a lopsided pad that reached the next one; with the end ramps the end
feet's pads come out like the middle one's. Each foot has its pad gap (mm) raised on the top above it.

    python3 prototype/calibration/pad/gen.py && deno run -A prototype/calibration/pad/build.js
"""
import math
import sys
from pathlib import Path

import trimesh
from shapely.geometry import Polygon
from trimesh.creation import extrude_polygon

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import label, write  # noqa: E402

GAPS = [0, 0.12, 0.2]       # 0.12 = Light's brim gap; under ~0.1 slicers close it (0.3 dropped: 2026-10-08 print)
B = 12.0                     # keel width (mm)
H = 13.0                     # keel height: low, so a foot that lets go doesn't lever the rest off
FOOT = 25.0                  # each foot's length on the bed (12 gave ~24 mm of outline, near minGripOutline 20)
ARCH = 11.0                  # arch width at the bed (apex 9.5 mm, under the 13 mm keel)
RISE = math.radians(60)      # every slope under the bar, clear of the 45 deg overhang limit
EDGE = 1.5                   # ...but the keel's bottom 1.5 mm is a 45 deg edge, a cube's on its
                             # edge (the pad's case), too short for a wedge (PERP.minH 2)
t = 1 / math.tan(RISE)       # x per mm of rise
L = len(GAPS) * (FOOT + ARCH)   # foot to foot, plus half an arch's width at each end
xs = [(k + 0.5) * (FOOT + ARCH) for k in range(len(GAPS))]   # foot centres
apex = ARCH / 2 / t


def prism(poly, plane, length):
    """The polygon `poly`, drawn in the yz plane (extruded along x, from 0) or in
    the xz plane (extruded across y, centred on y = 0)."""
    m = extrude_polygon(Polygon(poly), length)
    if plane == 'yz':      # drawn as (y, z) in xy, extruded along z -> along x
        m.apply_transform([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    else:                  # drawn as (x, z) in xy, extruded along z -> across y
        m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0]))
        m.apply_translation([0, length / 2, 0])
    return m


x0b, x1b = ARCH / 2 - (H + 1) * t, L - ARCH / 2 + (H + 1) * t
zs = EDGE + (B / 2 - EDGE) / t     # where the 60 deg sides meet the keel's walls
keel = prism([(0, 0), (EDGE, EDGE), (B / 2, zs), (B / 2, H), (-B / 2, H), (-B / 2, zs), (-EDGE, EDGE)], 'yz', x1b - x0b)
keel.apply_translation([x0b, 0, 0])
cuts = [prism([(xc - ARCH / 2 - t, -1), (xc + ARCH / 2 + t, -1), (xc, apex)], 'xz', B + 2)
        for xc in ((a + b) / 2 for a, b in zip(xs, xs[1:]))]
cuts.append(prism([(x0b - 1, -1), (ARCH / 2 + t, -1), (ARCH / 2 - (H + 1) * t, H + 1), (x0b - 1, H + 1)], 'xz', B + 2))
cuts.append(prism([(x1b + 1, -1), (L - ARCH / 2 - t, -1), (L - ARCH / 2 + (H + 1) * t, H + 1), (x1b + 1, H + 1)], 'xz', B + 2))
bar = trimesh.boolean.difference([keel] + cuts, engine='manifold')
bar = trimesh.boolean.union([bar] + [m for x, g in zip(xs, GAPS) for m in label(f'{g:g}', x, 0, H, size=5)],
                            engine='manifold')

out = Path(__file__).parent / 'out'
out.mkdir(exist_ok=True)
rungs = []
for k, (x, g) in enumerate(zip(xs, GAPS)):
    lo, hi = max(x0b, x - FOOT / 2 - ARCH / 2), min(x1b, x + FOOT / 2 + ARCH / 2)
    post = trimesh.boolean.intersection([bar, prism([(lo, -1), (hi, -1), (hi, H + 2), (lo, H + 2)], 'xz', B + 2)],
                                        engine='manifold')
    assert post.is_watertight and len(post.split(only_watertight=False)) == 1
    post.export(out / f'foot_{k + 1}.stl')
    rungs.append({'id': k + 1, 'padGap': g, 'x': x, 'span': [lo, hi], 'file': f'foot_{k + 1}.stl'})
write(__file__, [bar], rungs)
ext = bar.bounds[1] - bar.bounds[0]
print(f'pad coupon: one bar {ext[0]:.0f} x {ext[1]:.0f} x {ext[2]:.1f} mm, {len(GAPS)} feet {FOOT:g} mm long, '
      f'arches {ARCH:g} mm wide and {apex:.1f} mm high')
for r in rungs: print(f"  foot {r['id']} at x {r['x']:g}: pad gap {r['padGap']} mm")
