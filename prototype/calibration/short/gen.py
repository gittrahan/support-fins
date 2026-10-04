#!/usr/bin/env python3
"""Short-wall coupon: how short may a wall standing on the PLATE be for its height?
(PROP.minSpan, 7 mm today: "not worth the plate space".)

Coverage probe, 2026-10-03: minSpan is what leaves organic parts unheld. Walls down
to 2 mm lift the M4 headset 45 -> 68 %, the knuckle 74 -> 85 %, the octopus 53 -> 74 %,
but those walls are 2 mm long and 40-60 mm tall (20:1 and more). slender/ only tried
walls standing on the part, at up to 7:1. This one asks whether a short wall standing
alone on the plate stays up all the way to its overhang.

ONE solid piece: a spine on the plate with twelve small ledges, six a side. The ledges
are lengths x heights: wall length L in LENGTHS, ledge underside at H in HEIGHTS. Each
ledge is L + 2 mm wide (1 mm lip past each end of the wall) and sticks DEPTH out of the
spine, so the wall under its free edge stands DEPTH - 1 mm clear of the spine, held by
nothing but its own foot until its tines reach the ledge. That is the case on an
organic part: a short wall under a small island, nothing beside it. A ledge's dots
count its rung (1-12); the table in the README maps rung -> L x H.

    python3 prototype/calibration/short/gen.py && deno run -A prototype/calibration/short/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

LENGTHS = [2.0, 3.0, 4.0, 5.0]               # wall length along x, mm
HEIGHTS = [20.0, 40.0, 60.0]                 # ledge underside above the plate, mm
SPINE_W, LEDGE_T, DEPTH, STEP = 8.0, 2.0, 8.0, 12.0
TOP = max(HEIGHTS) + LEDGE_T + 2.0

parts, rungs = [], []
# near side: L 2, 3 at every height; far side: L 4, 5 at every height (rungs 1-6, 7-12)
grid = [(L, H) for L in LENGTHS[:2] for H in HEIGHTS] + [(L, H) for L in LENGTHS[2:] for H in HEIGHTS]
for k, (L, H) in enumerate(grid):
    side = 1 if k < 6 else -1
    x = 4.0 + (k % 6) * STEP
    w = L + 2.0
    y0, y1 = sorted([side * SPINE_W / 2, side * (SPINE_W / 2 + DEPTH)])
    parts.append(bx(x, x + w, y0, y1, H, H + LEDGE_T))
    # dots on the ledge's top, rows of three (a 3 mm ledge can't hold a row of six)
    n = k + 1
    for r in range(0, n, 3):
        parts += dots(min(3, n - r), x + 0.6, side * (SPINE_W / 2 + DEPTH - 1.2 - 1.6 * (r // 3)), H + LEDGE_T,
                      step=1.3 if w < 5 else 1.8, size=0.8)
    # the wall: along x under the free edge, 1 mm in from it and from each end
    wy = side * (SPINE_W / 2 + DEPTH - 1.0)
    rungs.append({'id': n, 'length': L, 'height': H, 'ratio': round(H / L, 1),
                  'wall': [[x + 1.0, wy], [x + 1.0 + L, wy]], 'z': H,
                  'box': [x - 1.0, x + w + 1.0, y0 - 0.5, y1 + 0.5]})
LEN = 4.0 + 5 * STEP + max(LENGTHS) + 2.0 + 4.0
parts.append(bx(0, LEN, -SPINE_W / 2, SPINE_W / 2, 0, TOP))
m = write(__file__, parts, rungs)
print(f'short-wall coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ledge {r['id']:2d}: wall {r['length']:.0f} mm long x {r['height']:.0f} mm tall ({r['ratio']}:1)")
