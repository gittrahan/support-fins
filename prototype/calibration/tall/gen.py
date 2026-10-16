#!/usr/bin/env python3
"""Tall-wall coupon: how tall may a plate wall stand before it wobbles, and do face
ribs fix it? (BRACE.tallH, BRACE.rise, web/prop/brace.js; local issue 046.)

A user: "you're definitely going to want some sort of bracing for fins taller than
10cm or they wobble too much, maybe just a perpendicular fin." A plate wall is a 1 mm
sheet whose foot stops at footMax 3 mm, so a 120 mm wall stands on the same foot as a
25 mm one; its tines tie it to the part only at the top. Nothing printed so far went
past 80 mm (short/).

ONE solid piece: a stepped spine on the plate with twelve ledges, six a side, one
20 mm plate wall under each ledge's tip, running along x: heights 60/80/100/120 mm x
bare, ribs rising 50 % of the wall (BRACE.rise today), ribs rising 80 %. Ledges are
in height order, so the spine steps up along x and is only as tall as its ledges. The
wall stands 17 mm off the spine, past a 120 mm wall's rib reach (14.4 mm), so the
inner rib is never cut short and nothing holds the wall up until it reaches the ledge.
A stair bracket (1 mm steps, 45 deg) carries the ledge's root; the tongue past it
bridges to the wall. The ledge's top has the wall's height and BARE / R50 / R80.

    python3 prototype/calibration/tall/gen.py && deno run -A prototype/calibration/tall/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

HEIGHTS = [60.0, 80.0, 100.0, 120.0]         # wall height, mm
RISES = [0.0, 0.5, 0.8]                      # rib rise as a share of the wall; 0 = bare
NAMES = {0.0: 'BARE', 0.5: 'R50', 0.8: 'R80'}
WALL_L, SPINE_W, LEDGE_T, OFF, END, STEP, BRACKET = 20.0, 15.0, 2.0, 17.0, 0.2, 26.0, 8

grid = [(h, r) for h in HEIGHTS for r in RISES]   # in height order: the spine steps up
parts, rungs = [], []
for k, (H, rise) in enumerate(grid):
    side = 1 if k % 2 == 0 else -1
    slot = k // 2
    x0 = 4.0 + slot * STEP
    cx = x0 + (WALL_L + 2 * END) / 2                     # the tongue's and wall's centre
    face = side * SPINE_W / 2
    t0, t1 = sorted([face, face + side * (OFF + 1.0)])
    tx0, tx1 = cx - WALL_L / 2 - END, cx + WALL_L / 2 + END
    parts.append(bx(tx0, tx1, t0, t1, H, H + LEDGE_T))
    for s in range(1, BRACKET + 1):                    # stair bracket under the root
        b0, b1 = sorted([face - side * 0.5, face + side * s])
        parts.append(bx(tx0, tx1, b0, b1, H - (BRACKET + 1 - s), H + 0.01))
    ly = face + side * 5.0
    parts += label(f'{H:g}', cx, ly - side * 2.3, H + LEDGE_T, size=3.5)
    parts += label(NAMES[rise], cx, ly + side * 2.3, H + LEDGE_T, size=3.5)
    wy = face + side * OFF
    rungs.append({'id': k + 1, 'height': H, 'rise': rise, 'name': NAMES[rise],
                  'wall': [[cx - WALL_L / 2, wy], [cx + WALL_L / 2, wy]], 'z': H,
                  'box': [tx0 - 2.0, tx1 + 2.0, min(t0, t1) - 16.0, max(t0, t1) + 16.0]})
for slot in range(len(grid) // 2):                     # the spine, stepped to its ledges
    x0 = slot * STEP + (0.0 if slot == 0 else 4.0)
    x1 = 4.0 + (slot + 1) * STEP + (4.0 if slot == len(grid) // 2 - 1 else 0.0)
    top = max(grid[2 * slot][0], grid[2 * slot + 1][0]) + LEDGE_T + 2.0
    parts.append(bx(x0 - 0.01, x1 + 0.01, -SPINE_W / 2, SPINE_W / 2, 0, top))
m = write(__file__, parts, rungs)
print(f'tall-wall coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ledge {r['id']:2d}: wall {r['height']:.0f} mm tall, {r['name']}")
