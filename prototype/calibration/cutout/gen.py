#!/usr/bin/env python3
"""Cutout coupon: what does each Cutouts style (Walls > Cutouts) do to a tall wall --
how much plastic it saves, and does the cut wall still stand and hold its ledge?

ONE solid piece: a bar standing on the plate with five identical flat ledges sticking
out of it H mm up, over open plate -- three on the near side, two on the far side.
Tall on purpose: cutouts only open a wall's middle (its top, foot and ends stay
solid, and a short wall stays solid), so a short wall would show nothing. build.js
runs the site's Auto build once per ledge at that ledge's style and keeps the walls
under it. Each ledge has its style raised on top.

    python3 prototype/calibration/cutout/gen.py && deno run -A prototype/calibration/cutout/build.js

HONEYCOMB print gate (not in the Calibrate menu): three ledges, LATTICE beside the
honeycomb at the shipped ~55deg roofs (HONEY) and as regular hexagons, 30deg roofs
(HEX30) -- do regular hexagons' roofs print clean, and is the honeycomb stiffer?

    python3 prototype/calibration/cutout/gen.py honeycomb && deno run -A prototype/calibration/cutout/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

HONEY = len(sys.argv) > 1 and sys.argv[1] == 'honeycomb'
# web/cutout.js CUTOUT_PATTERNS; 'hex30' is the honeycomb with CUT.hexSlope 1/sqrt(3) (build.js)
STYLES = ['lattice', 'honeycomb', 'hex30'] if HONEY else ['none', 'diamond', 'triangle', 'arch', 'lattice']
NEAR = 2 if HONEY else 3                                         # ledges on the near side
BAR_W, H, LEDGE_T, W, DEPTH, STEP = 10.0, 25.0, 2.0, 28.0, 14.0, 33.0

parts, rungs = [], []
for k, style in enumerate(STYLES):
    side = 1 if k < NEAR else -1
    x = 4.0 + (k if k < NEAR else k - NEAR) * STEP
    y0, y1 = sorted([side * BAR_W / 2, side * (BAR_W / 2 + DEPTH)])
    parts.append(bx(x, x + W, y0, y1, H, H + LEDGE_T))
    parts += label({'honeycomb': 'HONEY'}.get(style, style.upper()), x + W / 2, side * (BAR_W / 2 + DEPTH / 2), H + LEDGE_T, size=4.0)
    # the rung's box: the ledge's footprint and a little round it, never a neighbour's
    rungs.append({'id': k + 1, 'style': style, 'box': [x - 2.5, x + W + 2.5, y0 - 0.5, y1 + 0.5]})
L = 4.0 + (NEAR - 1) * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, H + LEDGE_T + 2))
m = write(__file__, parts, rungs)
print(f'{"honeycomb" if HONEY else "cutout"} coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ledge {r['id']}: {r['style']}")
