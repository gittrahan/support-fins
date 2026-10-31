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


def bent(lean0, lean1):
    """An arm whose lean changes along its length, lean0 at the foot to lean1 at the top
    (degrees from vertical, toward -X): curved UP its back, convex when the lean grows
    (the back rolls over) and concave when it shrinks. The reporter's parts curve this way."""
    n = 60
    ts = np.linspace(0, 1, n + 1)
    lean = np.radians(lean0 + (lean1 - lean0) * ts)
    ds = LENGTH / n
    sx = np.concatenate([[0], np.cumsum(-np.sin(lean[:-1]) * ds)])
    sz = np.concatenate([[0], np.cumsum(np.cos(lean[:-1]) * ds)])
    nx, nz = np.cos(lean), np.sin(lean)              # the back's normal (+X and up)
    back = [(x + nx_ * THICK / 2, z + nz_ * THICK / 2) for x, z, nx_, nz_ in zip(sx, sz, nx, nz)]
    front = [(x - nx_ * THICK / 2, z - nz_ * THICK / 2) for x, z, nx_, nz_ in zip(sx, sz, nx, nz)]
    m = trimesh.creation.extrude_polygon(Polygon(back + front[::-1]).buffer(0), WIDTH)  # (x, z) in XY, width along Z
    m.apply_transform(trimesh.transformations.rotation_matrix(np.radians(90), [1, 0, 0]))  # y -> z
    m.apply_translation([0, 0, -m.bounds[0][2]])
    m = trimesh.intersections.slice_mesh_plane(m, [0, 0, 1], [0, 0, FOOT], cap=True)
    m.apply_translation([0, 0, -FOOT])
    return m


def dome(r=220.0, h=150.0, w=90.0, thick=30.0):
    """A standing slab whose broad face is domed both ways (a sphere cap of radius r),
    like the plate in the reporter's second screenshot: no flat patch reaches far up it."""
    m = trimesh.creation.box([thick, w, h])
    for _ in range(5):          # uniform 4-way splits keep it watertight (~5 mm facets)
        m = m.subdivide()
    v = m.vertices.copy()
    # crown at the middle, receding to the edges; blended through the thickness (0 at
    # the back, all of it at the front) so the top and bottom faces don't fold over
    sag = np.sqrt(r * r - v[:, 1] ** 2 - v[:, 2] ** 2) - r
    v[:, 0] += sag * (v[:, 0] + thick / 2) / thick
    m.vertices = v
    m.apply_translation([0, 0, -m.bounds[0][2]])
    return m


for name, mesh in [('anchor_lean_flat', arm()), ('anchor_lean_curved', arm(curve_r=90.0)),
                   ('anchor_bend_convex', bent(20, 60)), ('anchor_bend_concave', bent(45, 5)),
                   ('anchor_dome', dome())]:
    mesh.apply_translation([-mesh.bounding_box.centroid[0], -mesh.bounding_box.centroid[1], 0])
    mesh.export(OUT / f'{name}.stl')
    e = mesh.extents
    print(f'  {name:20} {len(mesh.faces):5} faces  watertight={mesh.is_watertight}  '
          f'{e[0]:.0f} x {e[1]:.0f} x {e[2]:.0f} mm')
