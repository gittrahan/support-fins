#!/usr/bin/env python3
"""Gap coupon: how many empty layers between a wall's top and the overhang above it
(the Gap field, PROP.gap) still snap off clean? Too few welds; too many lets the overhang sag.

The gap is vertical: the empty space between a wall's top and the underside of the
overhang it holds. A slicer can only leave whole empty layers there -- at 0.2 mm
layers a 0.1, 0.15, 0.2, 0.25 or 0.3 gap all slice to the same one layer (checked in
PrusaSlicer 2026-10-02: the first build's ledges 1-5 came out identical, only 0.4
differed). So the rungs are whole layers: 1, 2, 3 empty layers at LAYER, each twice.

ONE solid piece: a bar standing on the plate with six identical ledges sticking out
of it 10 mm up (a whole number of layers), three per side, over open plate. build.js
runs the site's Auto build once per ledge with that ledge's gap and keeps the walls
under it, so every ledge carries what the site would make at that setting. Each ledge
has its gap (mm) raised on top; the far side repeats the near side.

    python3 prototype/calibration/gap/gen.py && deno run -A prototype/calibration/gap/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

LAYER = 0.2                                 # print at this layer height (the site's default)
LAYERS = [1, 2, 3, 1, 2, 3]                 # empty layers per ledge; the far side repeats
BAR_W, H, LEDGE_T, W, DEPTH, STEP = 10.0, 10.0, 2.0, 12.0, 10.0, 18.0

parts, rungs = [], []
for k, n in enumerate(LAYERS):
    gap = round(n * LAYER, 3)
    side = 1 if k < 3 else -1
    x = 4.0 + (k % 3) * STEP
    y0, y1 = sorted([side * BAR_W / 2, side * (BAR_W / 2 + DEPTH)])
    parts.append(bx(x, x + W, y0, y1, H, H + LEDGE_T))
    parts += label(f'{gap:g}', x + W / 2, side * (BAR_W / 2 + DEPTH / 2), H + LEDGE_T, size=4.5)
    # the rung's box: the ledge's footprint and a little round it, never a neighbour's
    rungs.append({'id': k + 1, 'layers': n, 'gap': gap, 'box': [x - 2.5, x + W + 2.5, y0 - 0.5, y1 + 0.5]})
L = 4.0 + 2 * STEP + W + 4.0
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, H + LEDGE_T + 2))
m = write(__file__, parts, rungs)
print(f'gap coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ledge {r['id']}: {r['layers']} empty layer(s), gap {r['gap']} mm")
