#!/usr/bin/env python3
"""Stand-ins for GH #351 (anchor braces) until the reporter's mask STL arrives.

A tall arm leaning ANCHOR_LEAN degrees from vertical on a narrow foot: its underside
faces down (the side the reporter wants left bare), its back faces UP, and that back
is what an anchor brace stands against. Two backs: flat, and curved across the width
like the mask's, so a tine failure on the curve isn't mistaken for the face gate.

Kept out of prototype/stress so the regression sweep's case list doesn't change.
"""
import numpy as np, trimesh
from shapely.geometry import Polygon
from pathlib import Path

OUT = Path(__file__).parent
LEAN = 40.0      # degrees from vertical
LENGTH = 190.0   # mm along the arm (about 145 mm tall)
THICK = 12.0
WIDTH = 50.0
FOOT = 2.5       # mm of the arm's low corner cut off flat: the narrow foot


def arm(curve_r=None):
    # cross-section in (a, y): a = across the thickness, +a is the back
    if curve_r is None:
        sec = [(0, -WIDTH / 2), (THICK, -WIDTH / 2), (THICK, WIDTH / 2), (0, WIDTH / 2)]
    else:
        ys = np.linspace(-WIDTH / 2, WIDTH / 2, 41)
        sag = curve_r - np.sqrt(curve_r ** 2 - ys ** 2)      # back bulges out mid-width
        back = [(THICK + sag.max() - s, y) for s, y in zip(sag, ys)]
        sec = [(0, -WIDTH / 2)] + back + [(0, WIDTH / 2)]
    m = trimesh.creation.extrude_polygon(Polygon(sec), LENGTH)  # (a, y) in XY, length along Z
    # lean the top toward -X: a rotation about +Y by -LEAN keeps +X (the back) facing up
    m.apply_transform(trimesh.transformations.rotation_matrix(np.radians(-LEAN), [0, 1, 0]))
    m.apply_translation([0, 0, -m.bounds[0][2]])
    m = trimesh.intersections.slice_mesh_plane(m, [0, 0, 1], [0, 0, FOOT], cap=True)
    m.apply_translation([0, 0, -FOOT])
    return m


for name, mesh in [('anchor_lean_flat', arm()), ('anchor_lean_curved', arm(curve_r=90.0))]:
    mesh.apply_translation([-mesh.bounding_box.centroid[0], -mesh.bounding_box.centroid[1], 0])
    mesh.export(OUT / f'{name}.stl')
    e = mesh.extents
    print(f'  {name:20} {len(mesh.faces):5} faces  watertight={mesh.is_watertight}  '
          f'{e[0]:.0f} x {e[1]:.0f} x {e[2]:.0f} mm')
