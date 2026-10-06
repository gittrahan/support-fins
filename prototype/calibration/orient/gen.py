#!/usr/bin/env python3
"""Orientation coupon: does it matter which way a flat overhang's walls run, and how
close do they have to be? (Matthew 2026-10-06: the gap coupon at 0.2 was clean but
"not better than tree or snug supports" -- would rotated walls help?)

A slicer prints a flat underside's first layer as a BRIDGE from its anchors (here the
bar), and on the gap coupon PrusaSlicer runs those lines across the ledge (y), over
walls running along it (x). Between walls the underside is only as good as the bridge.

Bar on the plate, six identical flat ledges 10 mm up (16.6 deep x 17.2 wide, so both
sides space their walls exactly), every wall at the
default 0.2 gap (the gap coupon's winner), stood by Draw's own drawnWall so each is
exactly where it's put:

    near side, ACROSS: walls along x -- across the bridge lines (Auto's choice here)
    far side, PARALLEL: the same ledges, walls along y -- parallel to the bridge lines

Ledge pairs share the wall spacing (centre to centre, the bar face counting as a
support), raised on top: 8 / 5.3 / 4 mm. ACROSS: 2 / 3 / 4 walls, the last 0.6 in from
the free edge. PARALLEL: 3 / 4 / 5 walls, the outer two 0.6 in from the side edges
(a parallel ledge has two free side edges to hold, an across one only its far edge).
What still differs, by nature: PARALLEL has more wall under each ledge (more contact
to snap off), and its far edge is bare between walls where ACROSS has a wall.

    python3 prototype/calibration/orient/gen.py && deno run -A prototype/calibration/orient/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

SPANS = [8.0, 16 / 3, 4.0]                  # wall spacing, mm (16 / 2, 3, 4)
BAR_W, H, LEDGE_T, STEP, INSET = 10.0, 10.0, 2.0, 23.0, 0.6
D = 16.0 + INSET                            # depth: n spacings from the bar face, then the inset
W = 16.0 + 2 * INSET                        # width: n spacings between walls inset at both sides
parts, rungs = [], []
for side, name in ((1, 'across'), (-1, 'parallel')):
    for k, s in enumerate(SPANS):
        x0 = 4.0 + k * STEP
        face, edge = side * BAR_W / 2, side * (BAR_W / 2 + D)
        y0, y1 = sorted([face, edge])
        parts.append(bx(x0, x0 + W, y0, y1, H, H + LEDGE_T))
        parts += label(f'{s:.2g}', x0 + W / 2, (face + edge) / 2, H + LEDGE_T, size=5.0)
        n = round(16.0 / s)
        if name == 'across':   # rows along x, the bar holds the root: the last at the free edge
            walls = [[[x0 + INSET, face + side * s * (i + 1)],
                      [x0 + W - INSET, face + side * s * (i + 1)]] for i in range(n)]
        else:                  # rows along y, both side edges free: one at each edge
            walls = [[[x0 + INSET + s * i, face + side * 1.0],
                      [x0 + INSET + s * i, edge - side * INSET]] for i in range(n + 1)]
        rungs.append({'id': len(rungs) + 1, 'side': name, 'span': round(s, 2), 'walls': walls, 'z': H,
                      'box': [x0 - 2, x0 + W + 2, y0 - 0.5, y1 + 0.5]})
L = 4.0 + 2 * STEP + W + 4.0
top = H + LEDGE_T + 2
parts.append(bx(0, L, -BAR_W / 2, BAR_W / 2, 0, top))
parts += label('ACROSS', L / 2, BAR_W / 4, top, size=3.5) + label('PARALLEL', L / 2, -BAR_W / 4, top, size=3.5)
m = write(__file__, parts, rungs)
print(f'orientation coupon {m.extents.round(1)} mm')
for r in rungs:
    print(f"  ledge {r['id']}: {r['side']:8s} wall spacing {r['span']} mm, {len(r['walls'])} walls")
