#!/usr/bin/env python3
"""Example models for the support-logic work (issue #8 + curved + miniatures).

Three families, each chosen because today's engine is expected to struggle:
  tall/ceiling  -- high, wide undersides where every wall runs to the plate (branching)
  curved        -- overhangs whose underside curves in plan and/or section
  mini          -- ~30 mm figures: small, fine, curved overhangs near the size floors
"""
import numpy as np, trimesh
from trimesh.creation import box, cylinder, icosphere, capsule, annulus, torus
from pathlib import Path

OUT = Path(__file__).parent / 'models'
OUT.mkdir(exist_ok=True)

def U(*ms): return trimesh.boolean.union(list(ms), engine='manifold')
def D(a, b): return trimesh.boolean.difference([a, b], engine='manifold')
def at(m, x=0, y=0, z=0): m = m.copy(); m.apply_translation([x, y, z]); return m
def rot(m, deg, axis): m = m.copy(); m.apply_transform(trimesh.transformations.rotation_matrix(np.radians(deg), axis)); return m
def save(name, m):
    m.rezero(); m.apply_translation(-m.bounding_box.centroid)
    m.export(OUT / f'{name}.stl')
    print(f'  {name:18} {len(m.faces):6} faces  watertight={m.is_watertight}  size={np.round(m.extents,1)}')

S = {}
# ---- tall / high ceiling (branching candidates) ----
S['mushroom']   = U(at(cylinder(5, 60, sections=48), z=30), at(cylinder(25, 5, sections=96), z=62.5))
S['table']      = U(at(box([70, 45, 4]), z=52),
                    *[at(box([5, 5, 50]), x=sx*30, y=sy*18, z=25) for sx in (-1, 1) for sy in (-1, 1)])
S['shelf']      = U(at(box([6, 40, 70]), z=35), at(box([35, 40, 4]), x=14.5, z=68))
S['bridge_span']= U(at(box([8, 20, 40]), x=-40, z=20), at(box([8, 20, 40]), x=40, z=20),
                    at(box([88, 20, 4]), z=42))
# ---- curved ----
S['bowl']       = D(icosphere(4, 30), U(icosphere(4, 27), at(box([80, 80, 40]), z=20)))  # lower half-shell
S['bowl']       = U(S['bowl'], at(cylinder(10, 3, sections=64), z=-29))           # foot ring
S['dome_ceiling']= U(  # post under a half-sphere cap: curved ceiling
                     at(cylinder(6, 50, sections=48), z=25),
                     D(at(icosphere(4, 25), z=75), at(box([80, 80, 60]), z=105)))
S['hook']       = U(at(box([8, 12, 40]), z=20),
                    D(at(rot(torus(15, 4, major_sections=96, minor_sections=32), 90, [1, 0, 0]), x=15, z=40),
                      at(box([60, 20, 40]), x=15, z=20)))
S['vase_flare'] = trimesh.creation.revolve(np.array([[0, 0], [12, 0], [14, 10], [11, 30], [10, 45],
                                                     [22, 60], [22, 62], [0, 62]]), sections=96)
S['torus_flat'] = torus(20, 5, major_sections=96, minor_sections=32)
# ---- miniature-ish (~32 mm) ----
base  = at(cylinder(12.5, 3, sections=64), z=1.5)
legs  = U(at(cylinder(1.6, 11, sections=24), x=-2.2, z=8.5), at(cylinder(1.6, 11, sections=24), x=2.2, z=8.5))
torso = at(capsule(8, 3.8, count=[24, 24]), z=18)
head  = at(icosphere(3, 3.2), z=27.5)
armR  = at(rot(capsule(9, 1.3, count=[16, 16]), 90, [0, 1, 0]), x=8.5, z=21)              # straight out: flat overhang
armL  = at(rot(capsule(8, 1.3, count=[16, 16]), 50, [0, 1, 0]), x=-6.5, z=19)             # angled down
sword = at(rot(box([1.0, 2.2, 18]), -70, [0, 1, 0]), x=17, z=22)                           # blade out past the hand
hat   = at(cylinder(6.5, 0.8, sections=64), z=30.2)                                         # thin brim: curved-in-plan ledge
S['mini_figure'] = U(base, legs, torso, head, armR, armL, sword, hat)
cape = D(at(cylinder(6, 14, sections=64), z=18), at(cylinder(5.2, 16, sections=64), z=18))
cape = D(cape, at(box([14, 8, 16]), y=4, z=18))                                            # half shell behind
S['mini_cape'] = U(base, legs, torso, head, at(rot(cape, 25, [1, 0, 0]), y=-2.5, z=17.5))
S['mini_dragon_wing'] = U(at(cylinder(10, 3, sections=64), z=1.5),
                          at(capsule(10, 3, count=[24, 24]), z=10),
                          *[at(rot(rot(box([14, 0.9, 7]), s*15, [0, 0, 1]), s*30, [1, 0, 0]), x=s*8, z=17)
                            for s in (-1, 1)])
for k, m in S.items(): save(k, m)
