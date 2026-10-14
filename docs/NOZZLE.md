# Nozzle size and wall lines

Adapted from Per Hjort's nozzle-profile guide (#210).

Set **Setup → Nozzle** to your printer's nozzle diameter, and pick **Walls → Wall lines**
for how thick the supports should be. The Walls summary shows the wall thickness.

## What changes

Every support width was tuned on a 0.4 mm nozzle: a 1.0 mm wall (two 0.5 mm lines), a
0.6 mm contact tip, 0.5 mm tines. A different nozzle scales them by `nozzle / 0.4`:

| | 0.4 | 0.6 | 0.8 | 1.0 | 1.6 | 2.0 |
|---|---|---|---|---|---|---|
| wall, 2 lines | 1.0 | 1.5 | 2.0 | 2.5 | 4.0 | 5.0 |
| contact tip | 0.6 | 0.9 | 1.2 | 1.5 | 2.4 | 3.0 |
| tine | 0.5 | 0.75 | 1.0 | 1.25 | 2.0 | 2.5 |

- A **smaller** nozzle (0.2, 0.25) narrows the tip and tines, so they leave a smaller mark.
  Walls, wedges and braces never get thinner than the 0.4 numbers.
- **Wall lines** multiplies the walls, wedges and braces: 4 lines is twice the wall, 8 is
  four times. The tip and tines stay one line, so the supports break off the same way.
- Heights don't follow the nozzle. Tines are one layer tall, set by **Layer height**.

## Limits

- **Layer height goes up to 0.6 mm.** The breakaway gap, the feet and the bed pad are
  tuned for thin layers; thicker layers need those to scale first.
- **Walls stop at 6 mm**, half the 12 mm spacing between rows of walls, so a row never
  fuses into one block. A big nozzle offers only the Wall lines that fit (a 2.0 nozzle:
  2 lines; 1.2: up to 4), and the nozzle goes up to 2.0.
- **Thicker walls fit fewer places.** A big nozzle or 8 lines can leave a tight overhang
  without a wall; the readout lists what's left unsupported.
- The plugins build 0.4 / 2 lines for now (the PrusaSlicer and Onshape plugins take a nozzle).

## Check in the slicer

Sizes other than 0.4 / 2 lines follow these rules but haven't been print-tested. After slicing:

- the walls slice as solid perimeters with no gaps down the middle
- each tine shows as one line on one layer, touching the part
- there's a visible gap layer between each wall top and the part
- first layers: feet and pad stick and stay separate from the part
