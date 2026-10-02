# Tuning Support Fins to your printer

Support Fins ships numbers tuned on PLA and PETG printed on one printer. Your printer,
filament and slicer profile are different. Each test print below sets one setting:
print it, find the best rung, and type that number into the site. Every rung is marked
with raised dots on top: **1 dot = rung 1**, and so on.

Print them with the slicer profile you normally use, with **slicer supports off**. The
supports are already in the file (and the angle test needs none). Files are in
`prototype/calibration/<name>/print/`.

| Test | Sets | Where on printfins.com |
|---|---|---|
| Angle | which faces need support | Overhang slider (top bar) |
| Gap | how close walls stand to the part | Clearances ▸ Support gap |
| Bite | how far tines reach into the part | Tines ▸ Tine bite |
| Span | how wide a bare stretch your printer bridges (tells us, for now) | Walls ▸ Wide-face coverage (Auto) |
| Pad | how the bed pad lets go | Clearances ▸ Bed pad ▸ Custom ▸ Pad gap |
| Bore | whether holes pull clean (no setting: tells us) | — |

## Angle (`angle/print/angle-coupon.stl`) — print this first
Seven ramps, from 10° (1 dot) to 40° (7 dots) off the plate. Look at the undersides.
The **shallowest ramp that came out clean** (no droop, no stringy curls) is your
**Overhang** setting. Faces shallower than that get support. The slider stops at
30°: if a ramp below 30° came out clean, set 30 and tell us which ramp it was.

## Gap (`gap/print/gap-coupon.3mf`)
Six ledges, each held by walls standing a different gap below it: 0.1, 0.15, 0.2,
0.25, 0.3, 0.4 mm (1–6 dots). Snap each wall off.
- Welded, tears the ledge's skin → gap too small.
- Ledge underside saggy or stringy → gap too big.
- Use the **smallest gap that snaps off clean**. Put it in **Support gap**.

## Bite (`bite/print/bite-coupon.3mf`)
Twelve ledges held by tined walls, built at Tine bite 0.15 mm (1 dot) to 0.70 mm
(12 dots, in a second row past six), in 0.05 steps. Those are the field's values; how
deep a tine actually lands in the part is a little less, since it snaps to your layers.
Snap each wall off, from rung 1 up.
- Wall falls off with no snap, tines never stuck → too little bite: the grip failed.
- Snaps off and leaves no mark → good.
- Snaps but leaves pits or nubs on the underside → too much bite.
- The good rungs sit between the last one that failed to grip and the first one that
  left marks. Pick the **lowest rung that still needed a snap**, and put its value in
  **Tine bite**. Send us both ends (where grip failed, where marks started): that
  window is what we're after.

## Span (`span/print/span-coupon.3mf`)
Five wide shelves, built at five **Wide-face coverage** slider positions (1–5 dots):
all the way left, a quarter, the middle (the default), three quarters, all the way
right. Snap the walls off and look at each shelf's underside between the walls, and
tell us which shelves came out flat and which sagged.

Don't set the slider from this one yet. Today the slider doesn't always add walls
as it moves right: on this shelf the middle position leaves a wider bare stretch
(17 mm) than all the way left (12 mm). We're fixing that. Your result tells us how wide a
bare stretch your printer can bridge.

## Pad (`pad/print/pad-coupon.3mf`)
Six cubes standing on an edge. A pad is all that holds each one down. Each pad stands
a different gap off its cube: 0, 0.08, 0.12, 0.16, 0.2, 0.3 mm (1–6 dots).
- Cube came loose mid-print → gap too big.
- Pad won't peel, or tears the cube's edge → gap too small.
- Use the **biggest gap whose cube stayed put**. Set Bed pad to **Custom**, put it in
  **Pad gap**, and set the other three the way the test print had them: **Pad thickness
  0.2, Pad grip 0, Pad spread 4**. Custom starts from whatever pad the part had before,
  which may not be those.

## Bore (`bore/print/bore-coupon.3mf`)
A block with four sideways holes, 3, 5, 8 and 12 mm across (1–4 dots), each with a
wall inside. Pull each wall out of the open end. Tell us which came out clean and
which broke or stuck. That tells us how small a hole the tool should still support.

## Tell us what you got
These results are how the defaults get better. Open a
[calibration result](https://github.com/gittrahan/support-fins/issues/new?template=calibration-result.yml)
issue with your printer, nozzle, filament and the best rung of each test. A photo of
the undersides helps most.
