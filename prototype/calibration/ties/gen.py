#!/usr/bin/env python3
"""Tie coupon: do zigzag ties between neighbouring walls stop tall walls swaying on a
fast bed slinger, and do they come off with the walls? (Tie walls together,
web/fins/ties.js; GH #57, local issue 060.)

A user, #57: fins "a few inches or a dozen or so cm" up "start to flop all over the
place" on a bed slinger at speed, until layers miss. Ties have never been printed.

ONE solid piece: a spine on the plate with a 40 x 45 mm shelf out from each side,
80 mm up -- under the 10 cm Brace tall walls height, so no ribs: the ties are the only
difference. Auto stands a comb of ~15 mm-spaced walls under each shelf; one side is
built with Tie walls together (TIED), the other without (BARE). A stair bracket
(1 mm steps, 45 deg) carries each shelf's root. The shelf's top says which.

    python3 prototype/calibration/ties/gen.py && deno run -A prototype/calibration/ties/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

H, SHELF_T, SHELF_L, REACH, SPINE_W, BRACKET = 80.0, 2.0, 40.0, 45.0, 8.0, 8
parts, rungs = [], []
parts.append(bx(0, SHELF_L, -SPINE_W / 2, SPINE_W / 2, 0, H + SHELF_T))      # the spine
for k, (side, name) in enumerate([(1, 'TIED'), (-1, 'BARE')]):
    face = side * SPINE_W / 2
    s0, s1 = sorted([face, face + side * REACH])
    parts.append(bx(0, SHELF_L, s0, s1, H, H + SHELF_T))
    for s in range(1, BRACKET + 1):                    # stair bracket under the root
        b0, b1 = sorted([face - side * 0.5, face + side * s])
        parts.append(bx(0, SHELF_L, b0, b1, H - (BRACKET + 1 - s), H + 0.01))
    parts += label(name, SHELF_L / 2, face + side * REACH * 0.6, H + SHELF_T, size=6)
    rungs.append({'id': k + 1, 'name': name, 'tie': name == 'TIED',
                  'box': [-20.0, SHELF_L + 20.0, min(s0, s1) - 2.0 if side > 0 else min(s0, s1) - 30.0,
                          max(s0, s1) + 30.0 if side > 0 else max(s0, s1) + 2.0]})
m = write(__file__, parts, rungs)
print(f'tie coupon {m.extents.round(1)} mm')
