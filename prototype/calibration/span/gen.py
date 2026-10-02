#!/usr/bin/env python3
"""Span coupon: how far apart may the walls under a broad flat overhang sit
before the part sags between them? Sets the Coverage dial (Auto: how densely a
broad face is lined with walls).

ONE solid piece: a bar standing on the plate with identical wide flat shelves
sticking out of it 10 mm up, over open plate. build.js runs the site's Auto build
once per shelf with that shelf's Coverage and keeps the walls under it. Read the
shelves' undersides: the lowest Coverage that printed flat is your setting.
Shelf k carries k dots.

    python3 prototype/calibration/span/gen.py && deno run -A prototype/calibration/span/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, dots, write  # noqa: E402

COVERAGES = [0, 25, 50, 75, 100]            # the dial, as the site shows it (%)
BAR_W, H, SHELF_T, W, DEPTH, STEP = 10.0, 10.0, 1.6, 30.0, 24.0, 36.0

parts, rungs = [], []
for k, cov in enumerate(COVERAGES):
    side = 1 if k < 3 else -1
    x = 4.0 + (k % 3) * STEP
    y0, y1 = sorted([side * BAR_W / 2, side * (BAR_W / 2 + DEPTH)])
    parts.append(bx(x, x + W, y0, y1, H, H + SHELF_T))
    parts += dots(k + 1, x + 2.0, side * (BAR_W / 2 + DEPTH - 2.0), H + SHELF_T)
    rungs.append({'id': k + 1, 'coverage': cov, 'box': [x - 2.5, x + W + 2.5, y0 - 0.5, y1 + 0.5]})
L = 4.0 + 2 * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, H + SHELF_T + 2))
m = write(__file__, parts, rungs)
print(f'span coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  shelf {r['id']} ({r['id']} dots): coverage {r['coverage']}%")
