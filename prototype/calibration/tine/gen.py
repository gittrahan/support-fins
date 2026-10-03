#!/usr/bin/env python3
"""Tine coupon v2: does cutting tines at the part's surface (KISS, own object) help,
or is it just fewer tines? v1 (in git at 6ec7c16) found no clear order; its two best
ledges were one KISS and one with a single tine, both least contact, so it couldn't
tell the two apart. v2 crosses them, 3 copies each:

    A merged, 3 tines   B KISS, 3 tines   C merged, 1 tine   D KISS, 1 tine   E no tines

All square 0.5 tines (v1: widths 0.3-0.5 and a pointed tip all print as one bead).
"Merged" is the site's own output (part and supports one object, the slicer unions
them); KISS ledges' tines are cut at the part's surface and saved as their OWN object
(kiss.py). The 15 ledges are in a fixed SHUFFLED order and carry only their number in
dots (1-15, rows of five), so marks are scored before anyone looks at the key
(print/key.json). The order is the first seed whose shuffle puts every condition on
both sides of the bar and no two copies of a condition next to each other.

ONE solid piece: a bar with 40 deg ledges (a face the site supports at the default 45
deg Overhang), 8 on the near side, 7 on the far side.

    python3 prototype/calibration/tine/gen.py && deno run -A prototype/calibration/tine/build.js \
      && python3 prototype/calibration/tine/kiss.py
"""
import json
import math
import random
import sys
from pathlib import Path

import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

# the five conditions; every tined one asks for an exact count (tinesPerWall)
CONDITIONS = {
    'A': {'label': 'merged, 3 tines', 'tunables': {'tinesPerWall': 3}},
    'B': {'label': 'KISS, 3 tines', 'tunables': {'tinesPerWall': 3}, 'kiss': True},
    'C': {'label': 'merged, 1 tine', 'tunables': {'tinesPerWall': 1}},
    'D': {'label': 'KISS, 1 tine', 'tunables': {'tinesPerWall': 1}, 'kiss': True},
    'E': {'label': 'no tines', 'tunables': {}, 'tines': False},
}
COPIES, NEAR = 3, 8    # 15 ledges: 1-8 on the near side, 9-15 on the far side


def shuffled():
    """The first seed's order with every condition on both sides, no neighbours alike."""
    for seed in range(1000):
        order = [k for k in CONDITIONS for _ in range(COPIES)]
        random.Random(seed).shuffle(order)
        near, far = order[:NEAR], order[NEAR:]
        if all(k in near and k in far for k in CONDITIONS) and \
           all(a != b for side in (near, far) for a, b in zip(side, side[1:])):
            return seed, order
    raise SystemExit('no seed satisfies the layout')


ANGLE, BAR_W, Z0, RISE, TOP_T, W, STEP = 40.0, 10.0, 6.0, 6.0, 2.0, 16.0, 19.0
D = RISE / math.tan(math.radians(ANGLE))


def ledge(x, side):
    """Off the bar face: underside from (bar, Z0) up to (bar + D, Z0 + RISE) at ANGLE,
    a vertical outer face, a flat top."""
    y_in, y_out, top = side * (BAR_W / 2 - 0.5), side * (BAR_W / 2 + D), Z0 + RISE + TOP_T
    yz = [(y_in, Z0), (side * BAR_W / 2, Z0), (y_out, Z0 + RISE), (y_out, top), (y_in, top)]
    if side < 0:
        yz = yz[::-1]
    m = trimesh.creation.extrude_polygon(trimesh.path.polygons.Polygon(yz), W)
    m.apply_transform([[0, 0, 1, x], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]])
    return m


seed, order = shuffled()
parts, rungs = [], []
for k, cond in enumerate(order):
    side = 1 if k < NEAR else -1
    x = 3.0 + (k if k < NEAR else k - NEAR) * STEP
    parts.append(ledge(x, side))
    top = Z0 + RISE + TOP_T
    n = k + 1
    for row in range((n + 4) // 5):   # rows of five dots, stepping in from the outer edge
        yd = side * (BAR_W / 2 + D - 1.2 - row * 1.8)
        parts += dots(min(5, n - row * 5), x + 2.0, yd, top, step=1.8, size=0.9)
    y0, y1 = sorted([side * BAR_W / 2, side * (BAR_W / 2 + D)])
    rungs.append({'id': n, 'cond': cond, **CONDITIONS[cond], 'box': [x - 1.5, x + W + 1.5, y0 - 0.5, y1 + 0.5]})
L = 3.0 + (NEAR - 1) * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, Z0 + RISE + TOP_T + 2))
m = write(__file__, parts, rungs)
key = {'seed': seed, 'conditions': {k: c['label'] for k, c in CONDITIONS.items()},
       'ledges': {r['id']: r['cond'] for r in rungs}}
(Path(__file__).resolve().parent / 'out' / 'key.json').write_text(json.dumps(key, indent=1) + '\n')
print(f'tine coupon v2 {m.extents.round(1)} mm, ledges reach {D:.1f} mm out, seed {seed}')
print('key in out/key.json (not printed here: score the marks first)')
