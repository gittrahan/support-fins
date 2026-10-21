#!/usr/bin/env python3
"""Rim fixtures for tests/rim_edge.test.js: a flat underside with a rim round its
edge, split off as a strip of its own (#269). A post holds each plate 15 mm up.

    python3 tests/fixtures/gen_rims.py      # trimesh + manifold3d
"""
import numpy as np, trimesh
from trimesh.creation import box, cylinder
from pathlib import Path

OUT = Path(__file__).parent

def U(*ms): return trimesh.boolean.union(list(ms), engine='manifold')
def D(a, b): return trimesh.boolean.difference([a, b], engine='manifold')
def B(x0, x1, y0, y1, z0, z1):
    m = box([x1 - x0, y1 - y0, z1 - z0]); m.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]); return m
def rod(a, b, r):   # a round bar from a to b
    m = cylinder(r, np.linalg.norm(np.subtract(b, a)), sections=48)
    m.apply_transform(trimesh.geometry.align_vectors([0, 0, 1], np.subtract(b, a)))
    m.apply_translation(np.add(a, b) / 2); return m
def save(name, m):
    m.export(OUT / f'{name}.stl')   # kept where built: the tests read the rim's place off it
    print(f'  {name:10} {len(m.faces):6} faces  watertight={m.is_watertight}  size={np.round(m.extents,1)}')

post = B(-3, 3, -3, 3, 0, 15)
S = {}
# a round bead (r 1.5) along every edge of a 60 x 40 plate, its axis on the underside
S['rim_bead'] = U(post, B(-30, 30, -20, 20, 15, 17),
                  *[rod(a, b, 1.5) for a, b in [((-30, -20, 15), (30, -20, 15)), ((-30, 20, 15), (30, 20, 15)),
                                                ((-30, -20, 15), (-30, 20, 15)), ((30, -20, 15), (30, 20, 15))]])
# a square lip 1.5 wide hanging 3 mm under the plate's edge
S['rim_lip'] = U(post, D(B(-30, 30, -20, 20, 12, 17), B(-28.5, 28.5, -18.5, 18.5, 11, 15)))
for k, m in S.items():
    assert len(m.split(only_watertight=False)) == 1, f'{k} is not one piece'
    save(k, m)
