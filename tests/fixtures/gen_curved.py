#!/usr/bin/env python3
"""Curved test fixtures for tests/raster.test.js: undersides that curve in plan
and/or section, where the normal placement leaves most of the area bare.

    python3 tests/fixtures/gen_curved.py      # trimesh + manifold3d
"""
import numpy as np, trimesh
from trimesh.creation import box, cylinder, icosphere, torus
from pathlib import Path

OUT = Path(__file__).parent

def U(*ms): return trimesh.boolean.union(list(ms), engine='manifold')
def D(a, b): return trimesh.boolean.difference([a, b], engine='manifold')
def at(m, x=0, y=0, z=0): m = m.copy(); m.apply_translation([x, y, z]); return m
def save(name, m):
    m.rezero(); m.apply_translation(-m.bounding_box.centroid)
    m.export(OUT / f'{name}.stl')
    print(f'  {name:18} {len(m.faces):6} faces  watertight={m.is_watertight}  size={np.round(m.extents,1)}')

S = {}
S['bowl']       = D(icosphere(4, 30), U(icosphere(4, 27), at(box([80, 80, 40]), z=20)))  # lower half-shell
S['bowl']       = U(S['bowl'], at(cylinder(10, 3, sections=64), z=-29))           # foot ring
S['dome_ceiling']= U(  # post under a half-sphere cap: curved ceiling
                     at(cylinder(6, 52, sections=48), z=26),              # 2 mm into the cap
                     D(at(icosphere(4, 25), z=75), at(box([80, 80, 60]), z=105)))
S['torus_flat'] = torus(20, 5, major_sections=96, minor_sections=32)
for k, m in S.items():
    assert len(m.split(only_watertight=False)) == 1, f'{k} is not one piece'
    save(k, m)
