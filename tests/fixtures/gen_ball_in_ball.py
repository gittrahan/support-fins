"""ball_in_ball.stl (#450): a hollow 40 mm ball, opened at 8 corners, with a 5 mm
radius ball hanging from the top of the cavity and one standing on the bottom. It is
centred on its axes on purpose: the hanging ball's lowest point sits on x = y = 0,
where a containment ray can run exactly through the mesh's shared edges and vertices.

Needs trimesh + manifold3d. python3 tests/fixtures/gen_ball_in_ball.py
"""
import itertools
from pathlib import Path

import numpy as np
import trimesh

R, WALL, BALL, HOLE = 20.0, 2.0, 5.0, 6.0


def sphere(r, z=0.0, sub=3):
    m = trimesh.creation.icosphere(subdivisions=sub, radius=r)
    m.apply_translation((0, 0, z))
    return m


def opening(d):
    d = np.array(d, float) / np.linalg.norm(d)
    c = trimesh.creation.cylinder(radius=HOLE, height=30, sections=32)
    c.apply_transform(trimesh.geometry.align_vectors((0, 0, 1), d))
    c.apply_translation(d * R)
    return c


inner = R - WALL
part = sphere(R).difference(sphere(inner))
for d in itertools.product((1, -1), repeat=3):
    part = part.difference(opening(d))
part = part.union(sphere(BALL, inner - BALL * 0.8)).union(sphere(BALL, -inner + BALL * 0.8))
part.apply_translation((0, 0, -part.bounds[0][2]))
assert part.is_watertight
part.export(Path(__file__).with_name('ball_in_ball.stl'))
print(len(part.faces), 'faces', part.bounds.round(2).tolist())
