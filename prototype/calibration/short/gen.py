#!/usr/bin/env python3
"""Short-wall coupon: how slender may a SHORT wall standing on the plate be?
(PROP.minSpanShort 4 mm and PROP.maxShortAspect 6, web/prop/config.js.)

Walls under PROP.minSpan (7 mm) are built only in the last-resort pass
(web/fins/shortwalls.js), and only down to minSpanShort 4 mm while height <=
maxShortAspect 6 x length -- both numbers guessed, never printed. The coverage probe
(2026-10-03) says those two are what leave organic parts unheld: with walls down to
2 mm the M4 headset went 45 -> 68 %, the knuckle 74 -> 85 %, the octopus 53 -> 74 %,
but those walls are 2-3 mm long and up to 20:1 and more. slender/ only tried walls on
the part, up to 7:1. This asks how slender a short wall standing alone on the plate
may be and still stay up all the way to its overhang.

ONE solid piece: a spine on the plate with twelve ledges, six a side, one wall each:
lengths 2/3/4 mm x height:length 6 (today's cap, the control), 10, 15, 20. Each ledge is
a wide ROOT on the spine (it carries the dots) and a TONGUE out to the free edge only
0.2 mm wider than its wall at each end, so there is no lip to curl into a tall wall
(slender/ saw lips curl). The wall runs ALONG x under the tongue's tip, its faces
8 mm clear of the spine and its foot at least 2.5 mm clear: nothing holds it up until
it reaches the ledge (a short wall under a small island on an organic part). Auto would
run a wall along this ledge's long side instead; the wall is drawn along x on purpose,
so its length is exactly the one under test. Ledge k carries k dots, rows of four.

    python3 prototype/calibration/short/gen.py && deno run -A prototype/calibration/short/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

LENGTHS = [2.0, 3.0, 4.0]                    # wall length along x, mm
RATIOS = [6, 10, 15, 20]                     # height:length; 6 = maxShortAspect today
SPINE_W, LEDGE_T, ROOT_W, ROOT_D, DEPTH, STEP = 8.0, 2.0, 9.0, 5.5, 9.5, 12.0
END = 0.2                                    # tongue past each wall end (no lip to curl)

grid = [(L, L * r, r) for L in LENGTHS for r in RATIOS]
TOP = max(h for _, h, _ in grid) + LEDGE_T + 2.0
parts, rungs = [], []
for k, (L, H, ratio) in enumerate(grid):
    side = 1 if k < 6 else -1
    x = 4.0 + (k % 6) * STEP
    r0, r1 = sorted([side * SPINE_W / 2, side * (SPINE_W / 2 + ROOT_D)])
    parts.append(bx(x, x + ROOT_W, r0, r1, H, H + LEDGE_T))
    cx = x + ROOT_W / 2                                  # the tongue's and wall's centre
    t0, t1 = sorted([side * SPINE_W / 2, side * (SPINE_W / 2 + DEPTH)])
    parts.append(bx(cx - L / 2 - END, cx + L / 2 + END, t0, t1, H, H + LEDGE_T))
    n = k + 1
    for r in range(0, n, 4):
        parts += dots(min(4, n - r), x + 1.5, side * (SPINE_W / 2 + 1.2 + 1.6 * (r // 4)), H + LEDGE_T,
                      step=2.0)
    wy = side * (SPINE_W / 2 + DEPTH - 1.0)
    rungs.append({'id': n, 'length': L, 'height': H, 'ratio': ratio,
                  'wall': [[cx - L / 2, wy], [cx + L / 2, wy]], 'z': H,
                  'box': [x - 1.0, x + ROOT_W + 1.0, t0 - 0.5, t1 + 0.5]})
LEN = 4.0 + 5 * STEP + ROOT_W + 4.0
parts.append(bx(0, LEN, -SPINE_W / 2, SPINE_W / 2, 0, TOP))
m = write(__file__, parts, rungs)
print(f'short-wall coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ledge {r['id']:2d}: wall {r['length']:.0f} mm long x {r['height']:.0f} mm tall ({r['ratio']}:1)")
