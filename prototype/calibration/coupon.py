"""Shared part-building for the calibration coupons' gen.py scripts.

Boxes, raised rung dots, and the one-solid-piece check every coupon makes before
it writes out/coupon_part.stl (a multi-piece coupon lost parts off the bed).
"""
import json
from pathlib import Path

import trimesh
from trimesh.creation import box


def bx(x0, x1, y0, y1, z0, z1):
    b = box([x1 - x0, y1 - y0, z1 - z0])
    b.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    return b


def dots(n, x, y, z, step=1.8, size=1.0, height=0.8):
    """n raised dots in a row along +x from (x, y), standing on the face at z: rung n."""
    return [bx(x + i * step - size / 2, x + i * step + size / 2, y - size / 2, y + size / 2, z - 0.1, z + height)
            for i in range(n)]


def write(here, parts, rungs, one_piece=True):
    """Union the parts, check they are one watertight solid, write out/coupon_part.stl
    and out/rungs.json (what build.js reads), and return the mesh."""
    out = Path(here).parent / 'out'
    out.mkdir(exist_ok=True)
    m = trimesh.boolean.union(parts, engine='manifold')
    assert m.is_watertight, 'coupon is not watertight'
    if one_piece:
        assert len(m.split(only_watertight=False)) == 1, 'coupon is not one piece'
    m.export(out / 'coupon_part.stl')
    json.dump(rungs, open(out / 'rungs.json', 'w'), indent=1)
    return m
