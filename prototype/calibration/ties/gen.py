#!/usr/bin/env python3
"""Tie coupon: do zigzag ties between neighbouring walls stop tall walls swaying on a
fast bed slinger, and do they come off with the walls? (Tie walls together,
web/fins/ties.js; GH #57, local issue 060.)

A user, #57: fins "a few inches or a dozen or so cm" up "start to flop all over the
place" on a bed slinger at speed, until layers miss. Ties have never been printed.

TWO separate pieces, TIED and BARE, so a bare wall that flops can't take the tied
side down with it (#359 review: the first draft, one 8 mm spine carrying two 45 mm
shelves 80 mm up, was top-heavy and risky in itself). Each is a table: a 3 mm deck,
its underside 60 mm up, on two solid 12 x 40 mm legs, 46 mm of open span between
them -- the part is stout, and the only tall thin things on the plate are the walls
under test. 60 mm is twice Tie walls together's 3 cm floor and under the 10 cm Brace
tall walls height, so no ribs: the ties are the only difference. Auto stands its
comb under each deck; TIED is built with Tie walls together, BARE without. The deck's
top says which.

    python3 prototype/calibration/ties/gen.py && deno run -A prototype/calibration/ties/build.js
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from coupon import bx, label, write  # noqa: E402

H, DECK_T, LEG, SPAN, DEPTH, APART = 60.0, 3.0, 12.0, 46.0, 40.0, 25.0
LEN = LEG + SPAN + LEG
parts, rungs = [], []
for k, name in enumerate(['TIED', 'BARE']):
    y0 = k * (DEPTH + APART)
    y1 = y0 + DEPTH
    parts.append(bx(0, LEG, y0, y1, 0, H + DECK_T))                 # the legs
    parts.append(bx(LEN - LEG, LEN, y0, y1, 0, H + DECK_T))
    parts.append(bx(0, LEN, y0, y1, H, H + DECK_T))                 # the deck
    parts += label(name, LEN / 2, (y0 + y1) / 2, H + DECK_T, size=6)
    rungs.append({'id': k + 1, 'name': name, 'tie': name == 'TIED',
                  'box': [-5.0, LEN + 5.0, y0 - APART / 2, y1 + APART / 2]})
m = write(__file__, parts, rungs, one_piece=False)
assert len(m.split(only_watertight=False)) == 2, 'two separate tables'
print(f'tie coupon {m.extents.round(1)} mm')
