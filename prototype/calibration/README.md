# Calibration coupons

Small test prints that settle a geometry number by printing it, instead of guessing.
Each coupon's PART is ONE solid piece (a multi-piece coupon lost parts off the bed),
with its supports built by the engine's own code so the print tests what the app
actually makes (tine/ also adds its KISS tines as a second object, on purpose):

    python3 prototype/calibration/<name>/gen.py      # the part -> out/coupon_part.stl
    deno run -A prototype/calibration/<name>/build.js  # walls on it -> out/<name>-coupon.3mf

The user-facing coupons (angle, gap, tine, span, pad, bore) share `coupon.py` (boxes, rung
dots, the one-piece check) and `coupon.js` (the site's own call -- `analyze(topo, 45,
rot)` then `buildFins(..., {mode: 'auto', bedPad: true})` at the site's PLA defaults --
run once per rung with that rung's setting, keeping the support PIECES -- whole
connected bodies, never cut -- whose centre is in the rung's box; every coupon's
supports are checked closed before they're written).
`python3 prototype/calibration/render.py <name>` draws a build.
`python3 prototype/calibration/plate.py` lays every coupon's `print/` file on one
256 mm plate -> `out/all-coupons.3mf` (the "all-coupons plate" below; the tine
coupon's KISS object stays in register with its coupon, so never Arrange it). What a user does with
each one is `docs/CALIBRATION.md`.

`out/` is git-ignored. The files actually printed are committed in `<name>/print/`
(.3mf with the part and walls as two parts of ONE object -- a slicer unions them, as it
does the site's 3MF -- one merged .stl, a render), so a
coupon can be reprinted as-is even after the engine moves on. Record each print's result below, with the date and the
setting it decided; the number itself goes in `web/prop/config.js` with a pointer here.

## Coupons

### slender/ -- how tall may a wall on the part be for its length?
Slab + spine + ledges; one part-attached wall per ledge at h 15/25/40 mm x 2/3/5/7:1.
- **2026-09-28, PLA:** none fell, including 5.7 x 40 mm (7:1). Slenderness is not the
  failure, so no `partMaxSlender` limit. It did show two other problems: every wall
  left a **foot scar** (-> foot/), and the lip past a mid-ledge wall curled (the
  free-edge rule, local issue 009).

### short/ -- how slender may a SHORT wall standing on the plate be? (PROP.minSpanShort, maxShortAspect)
Coverage work (goal 1). Walls under `minSpan` (7 mm) are built only in the last-resort
pass (`web/fins/shortwalls.js`), down to `minSpanShort` 4 mm while height <=
`maxShortAspect` 6 x length. Both numbers were guessed. With walls down to 2 mm the
probe went M4 45 -> 68 %, knuckle 74 -> 85 %, octopus 53 -> 74 % (`prototype/examples/`,
2026-10-03), but those walls are 2-3 mm long at up to 20:1 and more, and slender/ only
tried walls on the part, up to 7:1.
Spine on the plate, twelve ledges, ONE plate wall under each ledge's tip. The wall's
faces are 8 mm from the spine and its foot at least 2.5 mm, so nothing holds it up
until it reaches the ledge (a short wall under a small island on an organic part).
The walls come from draw mode's own `drawnWall` at the site's defaults (same sweep and
foot as Auto), with minSpan lifted for the build. Each runs along x on purpose, so its
length is exactly the one under test (Auto would run along the ledge's long side). The
ledge's tongue sticks out only 0.2 mm past each wall end, so no lip can curl into a
tall wall. The dots sit on the wide root by the spine. Flat ledges get no tines
(nothing for one to bite sideways into), same as the site. Ledge k carries k dots, in
rows of four:

| ledge | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| wall length mm | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| height mm | 12 | 20 | 30 | 40 | 18 | 30 | 45 | 60 | 24 | 40 | 60 | 80 |
| height:length | 6 | 10 | 15 | 20 | 6 | 10 | 15 | 20 | 6 | 10 | 15 | 20 |

6:1 is today's cap, the control. Score each ledge: stood / wobbled (ripples on the
wall's upper half) / fell, and whether the ledge printed flat. Read per LENGTH: the
tallest ratio that stood at each length sets maxShortAspect (one number if it's the
same for every length, otherwise per length), and the shortest length that stands at
6:1 sets minSpanShort. A fall here is conservative: a part with little plate contact
also gets the bed pad, which this coupon doesn't.
- **waiting on print.**

### foot/ -- how should a wall on the part meet the part?
Six ledges 15 mm up, a 12 mm wall under each, 1 mm in from the free edge. Ledge k
carries k dots (`print/` is the as-printed build, from commit a2e5a80 which still had teeth): 1 welded (the old default), 2 gap 0.2, 3 gap 0.3, 4 teeth every 3 mm,
5 teeth every 5 mm, 6 teeth every 3 mm + gap 0.2. Knobs: `PROP.footGap` / `footTeeth`.
- **2026-09-30, PLA:** only 1 (welded) scarred. 2, 3, 4, 6 printed clean. 5 had a
  failure mid-print but recovered -- possibly chance, since 4 and 6 (tighter teeth) were fine.

### lip/ -- how far may an overhang run past its last wall?
Six ledges 10 mm up off a spine, each with one wall on the slab 3 mm from the spine
(the same short bridge on every ledge); the ledges get deeper so the lip past the
wall's outer face grows. Ledge k carries k dots: 1 lip 0.1 (flush), 2 lip 1, 3 lip 2,
4 lip 3, 5 lip 4, 6 lip 6 mm. Sets when a row moves out to a free edge (PROP.edgeInset,
local issue 009's free-edge rule).
- **waiting on print.**


### gap/ -- how much empty space between a wall's top and the overhang? (the Gap field, PROP.gap)
The gap is vertical: wall top to the underside of the overhang it holds. Too small
welds; too big lets the overhang sag. Bar on the plate, six identical 12 x 10 mm flat
ledges 10 mm up; the site's Auto build per ledge. **Rungs are whole empty layers**,
because a slicer can only leave whole layers there: dots = layers, 1 dot 0.2, 2 dots
0.4, 3 dots 0.6 mm at 0.2 mm layers, and the far side repeats the near side. **Print
at 0.2 mm layers with a 0.2 first layer and variable/adaptive layer height off**: a
0.3 first layer shifts every slice plane 0.1 mm and the gaps stop being whole layers.
For a user: the fewest empty layers that snap off clean. The 3-layer rung (0.6) is
above the Gap field's 0.4 max, so if it wins the field can't be set to it yet (local
issue 026).
- **2026-10-02: first build (0.1, 0.15, 0.2, 0.25, 0.3, 0.4) was rebuilt before
  printing.** Matthew saw every ledge look the same; sliced in PrusaSlicer at 0.2 mm
  layers, ledges 1-5 all printed a one-layer (0.2) gap and only 0.4 differed. The
  rebuilt coupon slices as labelled (0.2 / 0.4 / 0.6, checked in the G-code). The
  Gap field itself has the same problem (local issue 026).
- **waiting on print** (PLA and PETG: the same file, the rungs ARE the gaps).

### span/ -- how far apart may walls under a broad face sit? (the Coverage dial)
Bar on the plate, five identical 30 x 24 mm flat shelves 10 mm up; Auto per shelf
with Coverage 1: 0, 2: 25, 3: 50, 4: 75, 5: 100 %. For a user: the lowest Coverage
whose shelf printed flat.
- **Found while building it (2026-10-02): the dial is not monotonic on this shelf.**
  Rows from the bar face (y 5) to the free edge (y 29): 0-25 % -> rows at 17.0 / 28.4
  (widest open stretch 12.0 mm); 40-60 % -> 11.0 / 28.4 (**17.4 mm**, the inner row
  hugs the bar, which already holds the shelf's root); 75 % -> 9.0 / 18.7 / 28.4
  (9.7); 100 % -> 8.0 / 14.8 / 21.6 / 28.4 (6.8). So the default 50 % leaves a wider
  span than 0 %. The coupon prints what the site makes, so it will show it.
  Cause and proposed fix: local issue 024. Until then CALIBRATION.md asks users to
  report flat / sagged per shelf, not to set the dial from it.
- **waiting on print.**

### angle/ -- what overhang does the printer manage unsupported? (the Overhang slider)
Bar on the plate, seven ramps, printed with NO supports (no build.js; `print/` has
STLs only). For a user: the shallowest clean ramp is the Overhang setting.
- First build (`print/angle-coupon-30-60.stl`, commit 925380c): undersides rising
  8 mm at 30-60 deg in 5 deg steps.
  **2026-10-02, PLA, Matthew's printer: all seven clean.** Nothing failed, so it
  set nothing.
- Second build (`print/angle-coupon.stl`): rising 4 mm at 1: 10, 2: 15, 3: 20,
  4: 25, 5: 30, 6: 35, 7: 40 deg (face normals checked; 10 deg reaches 22.7 mm out).
  30-40 overlap the first print. **The slider's floor is 30** (web/index.html #thr,
  options.json threshold min 30): a clean ramp below 30 means the floor should drop,
  not a number to type. **waiting on print.**

### pad/ -- how far off the part should the bed pad stand? (Bed pad > Custom > Pad gap)
The one multi-piece coupon, on purpose: six 15 mm cubes on an edge (bed contact is a
line, so each gets a pad), each built ALONE (out/cube_<k>.stl; built together their
contacts line up and the engine lays one pad under all six), Auto with Bed pad =
Custom at Light's numbers (h 0.2, grip 0, spread 4) and Pad gap 1: 0, 2: 0.08,
3: 0.12 (Light), 4: 0.16, 5: 0.2, 6: 0.3 mm. Six separate closed pads. Where each
pad's top crosses the first-layer cut, measured off the cube's first-layer outline:
0.0 / 0.076 / 0.13 / 0.161 / 0.2 / 0.3 (the 0.1 mm brim mesh). A cube that comes
loose is a result. The 3MF is re-packed deflated (the brim mesh is ~64k triangles,
local issue 007); no merged STL in `print/`.
- **waiting on print.**

### bore/ -- do walls inside a sideways hole pull out clean, and from what size?
Block on the plate with through-bores along y, 1: 3, 2: 5, 3: 8, 4: 12 mm across,
centred 9 mm up. One Auto build at the defaults (nothing varied): one wall along each
bore's axis, inside the bore, running out the open end; 0 unserved. Checks the
2026-09-27 reversal (bores DO get supported) on a printed part.
- **waiting on print.**

### bite/ -- RETIRED 2026-10-03 (files removed; last in git at 6ec7c16)
Asked how far tines should reach into the part (the old Tine bite field): twelve 40 deg
ledges, bite 0.15-0.70. **Printed twice in PLA: every rung fused and left a mark, none
failed, all looked about the same.** Why: at a tine's layer the part's edge is already
inside the 1 mm wall, and one layer up the part reaches back over the wall, so the
part's next layer prints straight onto the tine; the slicer merges part and supports
(one object), so the reach changes nothing. Bite is not a user setting any more (field
removed in #167; tines end at the part's surface in #168), so the coupon went too.
Replaced by tine/ (local issue 027).

### tine/ -- does a separate-object (KISS) tine leave a fainter mark, or is it just fewer tines?
**v2 (current).** Bar on the plate with fifteen 40 deg ledges, 8 on the near side
(1-8) and 7 on the far side (9-15). Each carries its number in dots, in rows of five.
Five conditions, three copies each, in a fixed SHUFFLED order: A merged, 3 tines;
B KISS, 3 tines; C merged, 1 tine; D KISS, 1 tine; E no tines (the control). All are
today's square 0.5 tine, and since #168 every tine already ends at the part's
surface. **Merged** = the site's own output: part and supports in one object, which
the slicer unions. **KISS** = kiss.py moves those ledges' supports into their OWN
object, so the slicer keeps the tine separate from the part (it trims only
0.012 mm3, because the tines already kiss). So v2 tests exactly one thing: one object
vs two. Knob: `tunables.tinesPerWall` (#166).
**Score blind:** for each ledge 1-15, note the mark 0 (none) - 3 (bad), and whether
the wall snapped clean or fell off during the print. Only then open
`print/key.json`, which maps each ledge to its condition. The tine count (0/1/3) is
visible on the print anyway, so what's truly blind is merged vs KISS, the main
question. The slicer's object list shows which walls are the KISS object, so if you
slice it yourself, don't study the preview's object colours.
**Print the 3MF** (the .stl can't keep objects apart). If the slicer asks whether to
load it as one object with several parts, say **no**. **Never Arrange** (and turn
off arrange-on-load): it moves the two objects apart, leaving the KISS walls
standing loose. The file places both together on any bed 180 mm or bigger (156 mm
long); to move it, select both and move them as one. Check in the preview that every
ledge has a wall under it.
Checked before printing (PrusaSlicer 3.0 alpha, 0.2 layers): two objects in the
G-code, placed together. build.js checks that every wall reaches the same distance
out (12.15 mm from the bar's centre, the ledge's edge on this build). Before #171,
one ledge's wall stopped 0.9 mm short through float noise (local issue 023).
Reading it: B beats A and D beats C -> separate objects help, so a "fins as their
own object" export is worth building (local issue 027). Only 1 vs 3 matters -> fewer
tines, no export change. Neither beats E's no-tine control on marks -> look at grip
instead (did E's walls fall?).
- **waiting on print.**

**v1** (files in git at 6ec7c16): ten ledges. Near side, the tine's shape (3 tines a
wall): 1 square 0.5, 2 square 0.4, 3 square 0.3, 4 pointed, 5 KISS square, 6 KISS
pointed. Far side, the count: 7 three, 8 two, 9 one, 10 none. Tine-top contact
under the part's next layer (PrusaSlicer, 0.2 layers): 1 0.97 mm2, 2 0.74, 3 0.53,
4 0.60, 5 0.36, 6 0.34, 7 0.97, 8 0.65, 9 0.33.
- **2026-10-02/03, PLA, printed twice (alone, then on the all-coupons plate): no clear
  order. Best were 5 (kiss, square) and 9 (one tine), but every ledge looked similar.**
  Those two are among the least tine-top contact (9 0.33, 6 0.34, 5 0.36 mm2; 10
  has no tines at all), so it leans the right way, but 6 and 10 didn't stand out and
  the effect is small next to print-to-print variation. Likely why (a guess, not
  measured): XY has the same rounding as the gap's layers. A tine is one bead, and
  0.3, 0.4 and 0.5 mm wide probably all print as about one ~0.45 mm extrusion, so the
  width rungs differ less on the plate than in the model. Next, if any: exaggerate (0 vs 1 vs 3 tines; kiss vs merged on
  the same ledge), and repeat each rung 2-3 times. -> v2 above. Width and pointed tip
  showed nothing, so their knobs go (local issue 027).
