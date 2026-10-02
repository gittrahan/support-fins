#!/usr/bin/env python3
"""Gap coupon: how close may a support wall stand to the part (the Gap field,
PROP.gap) and still snap off clean? Too small welds; too big lets the overhang sag.

ONE solid piece: a bar standing on the plate with six identical ledges sticking out
of it 10 mm up, three per side, over open plate. build.js runs the site's Auto
build once per ledge with that ledge's gap and keeps the walls under it, so every
ledge carries what the site would make at that setting. Ledge k carries k dots.

    python3 prototype/calibration/gap/gen.py && deno run -A prototype/calibration/gap/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

GAPS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4]     # the Gap field's range is 0.1-0.4
BAR_W, H, LEDGE_T, W, DEPTH, STEP = 10.0, 10.0, 2.0, 12.0, 10.0, 18.0

parts, rungs = [], []
for k, gap in enumerate(GAPS):
    side = 1 if k < 3 else -1
    x = 4.0 + (k % 3) * STEP
    y0, y1 = sorted([side * BAR_W / 2, side * (BAR_W / 2 + DEPTH)])
    parts.append(bx(x, x + W, y0, y1, H, H + LEDGE_T))
    parts += dots(k + 1, x + 2.0, side * (BAR_W / 2 + DEPTH - 2.0), H + LEDGE_T)
    # the rung's box: the ledge's footprint and a little round it, never a neighbour's
    rungs.append({'id': k + 1, 'gap': gap, 'box': [x - 2.5, x + W + 2.5, y0 - 0.5, y1 + 0.5]})
L = 4.0 + 2 * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, H + LEDGE_T + 2))
m = write(__file__, parts, rungs)
print(f'gap coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ledge {r['id']} ({r['id']} dots): gap {r['gap']} mm")
