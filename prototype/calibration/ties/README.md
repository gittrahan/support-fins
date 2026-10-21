# Tie coupon (#57, #359)

Do zigzag ties between neighbouring walls (More settings → Tall parts → **Tie walls
together**) stop tall walls swaying on a fast bed slinger, and do they come off with
the walls? The answer sets the box's default (off until this prints).

Two separate tables, each a 3 mm deck 60 mm up on two solid 12 × 40 mm legs.
Auto stands three walls ~20 mm apart under each deck. **TIED** is built with the
box ticked (one strut per pair, 1.4 mm thick, ~67°, to ~51 mm up), **BARE** without.
The deck's top says which.

    python3 prototype/calibration/ties/gen.py && deno run -A prototype/calibration/ties/build.js

`print/ties-coupon.3mf` is the part + supports (supports as their own object);
`print/ties-endon.png` shows both tables side on.

## Print it
- A bed slinger, at the speed you'd normally print support at (faster is a fairer test).
- PLA or PETG, 0.4 nozzle, 0.2 layers, no slicer supports.

## Record
| printer | material | speed | TIED walls | BARE walls | struts snap off by hand? | notes |
|---|---|---|---|---|---|---|
| | | | | | | |

Swaying = layers shifted or missed on the walls' upper half; watch the last 20 mm.
