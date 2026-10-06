# Tuning Support Fins to your printer

Support Fins ships numbers tuned on PLA and PETG printed on one printer. Your printer,
filament and slicer profile are different. Each test print below sets one setting:
print it, find the best rung, and type that number into the site. Every rung is marked
with its value raised on top (the angle, the gap in mm, the setting), so there's
nothing to look up.

Print them with the slicer profile you normally use, with **slicer supports off**. The
supports are already in the file (and the angle test needs none). Files are in
`prototype/calibration/<name>/print/`.

| Test | Sets | Where on printfins.com |
|---|---|---|
| Angle | which faces need support | Overhang slider (top bar) |
| Gap | how close walls stand to the part | Clearances ▸ Support gap |
| Grip | how many tines hold each wall | Tines ▸ Tine grip |
| Span | how wide a bare stretch your printer bridges (tells us, for now) | Walls ▸ Wide-face coverage (Auto) |
| Pad | how the bed pad lets go | Clearances ▸ Bed pad ▸ Custom ▸ Pad gap |
| Bore | whether holes pull clean (no setting: tells us) | — |

## Angle (`angle/print/angle-coupon.stl`) — print this first
Seven ramps, 10° to 40°, each with its angle in degrees written on top. The angle is measured **up from the
plate**, so **lower is harder**: 0° would be a flat ceiling, 90° a straight wall. (Many
overhang tests count from vertical instead; their 60° is our 30°.) Look at the undersides.
The **shallowest ramp that came out clean** (no droop, no stringy curls) is your
**Overhang** setting. Faces shallower than that get support. The slider stops at
30°: if a ramp below 30° came out clean, set 30 and tell us which ramp it was.

## Gap (`gap/print/gap-coupon.3mf`)
Six ledges, each held by walls standing a whole number of empty layers below it:
0.2 = 1 layer, 0.4 = 2, 0.6 = 3 (each ledge says its gap in mm); the far side repeats the
near side. A slicer can only leave whole layers there, so in-between gaps print the
same. **Print at 0.2 mm layers, 0.2 mm first layer, adaptive layer height off.** Snap
each wall off.
- Welded, tears the ledge's skin → gap too small.
- Ledge underside saggy or stringy → gap too big.
- Use the **fewest layers that snap off clean**, times 0.2, in **Support gap** (the
  field stops at 0.4 for now: if only 3 layers came clean, tell us).

## Grip (`grip/print/grip-coupon.3mf`)
Four ramps, three walls under each, built at four **Tine grip** settings, each
written on top of its ramp: **OFF** = Tines off, **LIGHT** = the slider all the way
left (the default), **MID** = the middle, **FIRM** = all the way right. That's 0, 5, 7 and 11 tines on each wall. Before
snapping anything off, check that every wall is still standing. Then snap the walls
off and look at each ramp's underside.
- A wall leaned or came loose → too few tines for your printer: go one step right.
  If even the firm walls leaned, keep firm and tell us: that's more grip than the slider gives.
- Ramp marked or torn where the tines were → more grip than you need: go one step left.
- Use the **lightest setting whose walls all held**. If even Tines off held, your
  parts may not need tines on gentle slopes, but a tall or tippy part still does.

## Span (`span/print/span-coupon.3mf`)
Five wide shelves, built at five **Wide-face coverage** slider positions, each written on top as a percentage (0%, 25%, 50%, 75%, 100%):
all the way left, a quarter, the middle (the default), three quarters, all the way
right. Snap the walls off and look at each shelf's underside between the walls, and
tell us which shelves came out flat and which sagged.

Don't set the slider from this one yet. Today the slider doesn't always add walls
as it moves right: on this shelf the middle position leaves a wider bare stretch
(17 mm) than all the way left (12 mm). We're fixing that. Your result tells us how wide a
bare stretch your printer can bridge.

## Pad (`pad/print/pad-coupon.3mf`)
Six cubes standing on an edge. A pad is all that holds each one down. Each pad stands
a different gap off its cube: 0, 0.08, 0.12, 0.16, 0.2, 0.3 mm, written on each cube.
- Cube came loose mid-print → gap too big.
- Pad won't peel, or tears the cube's edge → gap too small.
- Use the **biggest gap whose cube stayed put**. Set Bed pad to **Custom**, put it in
  **Pad gap**, and set the other three the way the test print had them: **Pad thickness
  0.2, Pad grip 0, Pad spread 4**. Custom starts from whatever pad the part had before,
  which may not be those.

## Bore (`bore/print/bore-coupon.3mf`)
A block with four sideways holes, 3, 5, 8 and 12 mm across (the size is written above each), each with a
wall inside. Pull each wall out of the open end. Tell us which came out clean and
which broke or stuck. That tells us how small a hole the tool should still support.

## Tell us what you got
These results are how the defaults get better. Open a
[calibration result](https://github.com/gittrahan/support-fins/issues/new?template=calibration-result.yml)
issue with your printer, nozzle, filament and the best rung of each test. A photo of
the undersides helps most.
