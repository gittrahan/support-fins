#!/usr/bin/env python3
"""Downward counterbore fixture for tests/counterbore.test.js (#504): a 30 x 30 x 15
block on the plate with an 11 mm, 5 mm deep recess in its underside narrowing into a
5.5 mm screw hole through the top. The step is a level ring 5 mm over the plate.

    python3 tests/fixtures/gen_counterbore.py
"""
from pathlib import Path
import trimesh

HERE = Path(__file__).parent

block = trimesh.creation.box([30, 30, 15])
block.apply_translation([0, 0, 7.5])
recess = trimesh.creation.cylinder(radius=5.5, height=5, sections=64)
recess.apply_translation([0, 0, 2.5 - 0.01])
hole = trimesh.creation.cylinder(radius=2.75, height=20, sections=48)
hole.apply_translation([0, 0, 7.5])
part = trimesh.boolean.difference([block, recess, hole], engine='manifold')
assert part.is_watertight
part.export(HERE / 'counterbore_down.stl')
