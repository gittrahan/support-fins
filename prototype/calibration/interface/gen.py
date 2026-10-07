#!/usr/bin/env python3
"""Interface coupon (GitHub #21): for a toolchanger printing each wall's top band in a
second material that won't bond to the part (PETG under PLA) -- Walls > Interface
material > Flat contacts. Two questions on one print:

  WIDTH  the PETG band sits on the PLA wall, and PETG barely bonds to PLA: at the
         wall's 1.0 mm a portal's walls came off their bands mid-print (2026-10-07).
         Wider crests stand on a 45deg flare of the wall, so the PLA under the PETG is
         as wide as it: 1.0 / 2.0 / 3.0 mm (PROP.ifaceW).
  GAP    PETG doesn't fuse to PLA, so the part can print straight onto it (gap 0, no
         empty layer, what PETG-interface users run) or over one empty layer (0.2, the
         PLA default) (PROP.ifaceGap). A slicer only leaves whole empty layers (gap/),
         so 0 and 0.2 are the two that differ at 0.2 mm layers.

ONE solid piece: a bar on the plate with six 16 x 10 mm flat ledges 10 mm up, three
per side over open plate. Near side (+y) gap 0, far side gap 0.2; each ledge has its
crest width raised on top, and the bar's top reads GAP 0 / GAP .2 toward each side.
build.js runs the site's Auto build per ledge at that width and gap and keeps the
walls under it.

    python3 prototype/calibration/interface/gen.py && deno run -A prototype/calibration/interface/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

WIDTHS = [1.0, 2.0, 3.0]
GAPS = [0.0, 0.2]                           # near side, far side
BAR_W, H, LEDGE_T, W, DEPTH, STEP = 10.0, 10.0, 2.0, 16.0, 10.0, 22.0

parts, rungs = [], []
for s, gap in enumerate(GAPS):
    side = 1 if s == 0 else -1
    y0, y1 = sorted([side * BAR_W / 2, side * (BAR_W / 2 + DEPTH)])
    for k, w in enumerate(WIDTHS):
        x = 4.0 + k * STEP
        parts.append(bx(x, x + W, y0, y1, H, H + LEDGE_T))
        parts += label(f'{w:g}', x + W / 2, side * (BAR_W / 2 + DEPTH / 2), H + LEDGE_T, size=5.0)
        # the rung's box: the ledge's footprint and a little round it, never a neighbour's
        rungs.append({'id': len(rungs) + 1, 'width': w, 'gap': gap,
                      'box': [x - 2.5, x + W + 2.5, y0 - 0.5, y1 + 0.5]})
L = 4.0 + 2 * STEP + W + 4.0
TOP = H + LEDGE_T + 2
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, TOP))
parts += label('GAP 0', L / 2, 2.5, TOP, size=4.0)
parts += label('GAP .2', L / 2, -2.5, TOP, size=4.0)
m = write(__file__, parts, rungs)
print(f'interface coupon {m.extents.round(1)} mm')
for r in rungs: print(f"  ledge {r['id']}: crest {r['width']} mm, gap {r['gap']} mm")
