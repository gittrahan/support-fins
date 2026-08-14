#!/usr/bin/env python3
"""Generate a pool of varied watertight test shapes for the support-fin stress test.

Simple primitives + compound extrusions, spanning the general shape families that
break support placement differently: flat-faced boxes/wedges (fin territory),
round cones/spheres/tori (prop / bowl territory), thin plates, tall posts,
re-entrant L/T/U/plus profiles, and a needle/point-seated post like hub_post_foot.
"""
import numpy as np, trimesh
from shapely.geometry import Polygon
from pathlib import Path

OUT = Path(__file__).parent / 'models'
OUT.mkdir(exist_ok=True)


def save(name, mesh):
    mesh.rezero()
    mesh.apply_translation(-mesh.bounding_box.centroid)  # center on origin
    mesh.export(OUT / f'{name}.stl')
    print(f'  {name:16} {len(mesh.faces):6} faces  watertight={mesh.is_watertight}')


def prism(poly_xy, height):
    return trimesh.creation.extrude_polygon(Polygon(poly_xy), height)


shapes = {}
# --- flat-faced (fin territory) ---
shapes['cube']       = trimesh.creation.box([40, 40, 40])
shapes['bar']        = trimesh.creation.box([16, 16, 90])
shapes['plate']      = trimesh.creation.box([80, 60, 6])
shapes['wedge']      = prism([(0, 0), (60, 0), (0, 40)], 30)
shapes['ramp']       = prism([(0, 0), (80, 0), (80, 8), (8, 40), (0, 40)], 24)
shapes['lbracket']   = prism([(0, 0), (50, 0), (50, 14), (14, 14), (14, 50), (0, 50)], 30)
shapes['tshape']     = prism([(0, 0), (60, 0), (60, 16), (38, 16), (38, 50), (22, 50), (22, 16), (0, 16)], 24)
shapes['ushape']     = prism([(0, 0), (50, 0), (50, 44), (36, 44), (36, 14), (14, 14), (14, 44), (0, 44)], 30)
shapes['plus']       = prism([(16, 0), (32, 0), (32, 16), (48, 16), (48, 32), (32, 32),
                              (32, 48), (16, 48), (16, 32), (0, 32), (0, 16), (16, 16)], 24)
shapes['staircase']  = prism([(0, 0), (60, 0), (60, 12), (40, 12), (40, 24), (20, 24),
                              (20, 36), (0, 36)], 28)
shapes['arch']       = prism([(0, 0), (48, 0), (48, 24), (36, 40), (12, 40), (0, 24)], 30)
shapes['hexprism']   = prism([(20*np.cos(a), 20*np.sin(a)) for a in np.linspace(0, 2*np.pi, 7)[:-1]], 50)
# --- round (prop / bowl territory) ---
shapes['cylinder']   = trimesh.creation.cylinder(radius=20, height=60, sections=48)
shapes['cone']       = trimesh.creation.cone(radius=26, height=60, sections=48)
shapes['pyramid']    = trimesh.creation.cone(radius=30, height=55, sections=4)
shapes['sphere']     = trimesh.creation.icosphere(subdivisions=3, radius=26)
shapes['torus']      = trimesh.creation.torus(major_radius=30, minor_radius=11)
shapes['coin']       = trimesh.creation.cylinder(radius=40, height=6, sections=64)
shapes['tube']       = trimesh.creation.annulus(r_min=12, r_max=22, height=55, sections=48)
# --- needle / point-seated (the hub_post_foot family) ---
prof = np.array([[0, 0], [26, 0], [22, 6], [4, 150], [4, 165], [0, 165]])  # foot -> long taper
shapes['needle']     = trimesh.creation.revolve(prof, sections=48)

for name, m in shapes.items():
    save(name, m)
print(f'generated {len(shapes)} shapes into {OUT}')
