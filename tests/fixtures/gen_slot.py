#!/usr/bin/env python3
"""Slot-through-a-tube fixtures for tests/arc.test.js: an upright cup (tube wall
plus a 2 mm floor) with a horizontal slot cut through its front wall, the shape of
a candy dispenser's dispensing slot. The slot's ceiling is a level strip the wall's
thickness wide, curving round the tube's axis (prop/arc.js).

    python3 tests/fixtures/gen_slot.py
"""
from pathlib import Path
import trimesh

HERE = Path(__file__).parent


def slot_cup(R, T, W, name, H=40, FLOOR=2, SH=12, Z0=12, sections=96):
    outer = trimesh.creation.cylinder(radius=R, height=H, sections=sections)
    outer.apply_translation([0, 0, H / 2])
    inner = trimesh.creation.cylinder(radius=R - T, height=H, sections=sections)
    inner.apply_translation([0, 0, H / 2 + FLOOR])
    slot = trimesh.creation.box([W, 2 * R, SH])
    slot.apply_translation([0, -R, Z0 + SH / 2])     # ceiling at z = Z0 + SH = 24
    part = outer.difference(inner).difference(slot)
    assert part.is_watertight
    part.export(HERE / name)


slot_cup(15, 1.6, 22, 'slot_d30_t1.6.stl')     # thin wall: straight tracks found no line
slot_cup(25, 2.5, 32, 'slot_d50_t2.5.stl')     # thick wall: straight tracks held it in pieces
