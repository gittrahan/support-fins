# Calibration coupons

Small test prints that settle a geometry number by printing it, instead of guessing.
Each coupon's PART is ONE solid piece (a multi-piece coupon lost parts off the bed),
with its supports built by the engine's own code so the print tests what the app
actually makes (tine/ also adds its KISS tines as a second object, on purpose):

    python3 prototype/calibration/<name>/gen.py      # the part -> out/coupon_part.stl
    deno run -A prototype/calibration/<name>/build.js  # walls on it -> out/<name>-coupon.3mf

The user-facing coupons (angle, gap, grip, span, pad, bore) share `coupon.py` (boxes, rung
labels -- `label()` raises each rung's value as text; tine/ keeps `dots()` and foot/ its
own inline dots, as printed -- the one-piece check) and `coupon.js` (the site's own call -- `analyze(topo, 45,
rot)` then `buildFins(..., {mode: 'auto', bedPad: true})` at the site's PLA defaults --
run once per rung with that rung's setting, keeping the support PIECES -- whole
connected bodies, never cut -- whose centre is in the rung's box; every coupon's
supports are checked closed before they're written).
`python3 prototype/calibration/render.py <name>` draws a build.
`python3 prototype/calibration/plate.py` lays every coupon's `print/` file on one
256 mm plate -> `out/all-coupons.3mf` (the "all-coupons plate" below; the tine
coupon's KISS object stays in register with its coupon, so never Arrange it). What a user does with
each one is `docs/CALIBRATION.md`.

The site's Calibrate menu (`web/ui/calibrate.js`) serves the user-facing coupons'
print files from `web/calibration/`. After changing any of them, run
`python3 prototype/calibration/estimate.py`: it copies them there and slices each with
PrusaSlicer's command line for the time and filament the menu shows
(`web/calibration/coupons.json`). `tests/calibrate.test.js` fails if a copy is stale.

`out/` is git-ignored. The files actually printed are committed in `<name>/print/`
(.3mf, one merged .stl, a render), so a coupon can be reprinted as-is even after the
engine moves on. The .3mf has the part and supports as TWO objects in register, as the
site's Export > 3MF writes them since #199 (the slicer keeps them apart, so a tine only
touches the part); never Arrange them apart. Files printed before that were one object;
`separate.py` converted gap, grip, pad, span and lip in place on 2026-10-07 with their
meshes unchanged (slender, foot, orient keep the one-object form they were printed in;
tine/ has its own split). Record each print's result below, with the date and the
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
tall wall. The label (wall length x height, mm) sits on the wide root by the spine. Flat ledges get no tines
(nothing for one to bite sideways into), same as the site. The ledges, in print order:

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
wall's outer face grows. Each ledge has its lip raised on top: 1 lip 0.1 (flush), 2 lip 1, 3 lip 2,
4 lip 3, 5 lip 4, 6 lip 6 mm. Sets when a row moves out to a free edge (PROP.edgeInset,
local issue 009's free-edge rule).
- **waiting on print.**


### gap/ -- how much empty space between a wall's top and the overhang? (the Gap field, PROP.gap)
The gap is vertical: wall top to the underside of the overhang it holds. Too small
welds; too big lets the overhang sag. Bar on the plate, six identical 12 x 10 mm flat
ledges 10 mm up; the site's Auto build per ledge. **Rungs are whole empty layers**,
because a slicer can only leave whole layers there: each ledge's gap is raised on top,
0.2 / 0.4 / 0.6 mm = 1 / 2 / 3 layers at 0.2 mm layers, and the far side repeats the near side. **Print
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
- **2026-10-06, PLA:** 0.2 (one empty layer) was the only worthwhile gap; 0.4 and 0.6
  were worse. 0.2 is already the default (PROP.gap, MATERIAL.pla.propGap), so
  nothing changes; the Gap field's in-between values are moot (local issue 026). The
  underside at 0.2 was clean but "not better than tree or snug supports": between
  the two walls the slicer bridges (PrusaSlicer: bridge infill across the ledge,
  over walls along it) -> orient/.

### interface/ -- with a PETG interface (toolchanger), how wide a band, and what gap? (PROP.ifaceW, PROP.ifaceGap)
For Walls > Interface material > Flat contacts (GitHub #21, `web/prop/crest.js`): the top
0.6 mm of a wall under a flat underside printed in a material that won't bond to the
part (PETG under PLA). PETG barely bonds to PLA either: on the first build, whose
crest was the wall's tapered tip (~0.4-0.6 mm wide), a portal's walls came off their
PETG bands mid-print (2026-10-07; the part still printed, but it was risky). Flat
contacts now keeps the wall's full 1.0 mm; this asks whether more is needed. Bar on the plate, six 16 x 10 mm flat ledges 10 mm up, two walls
under each from the site's Auto build at that ledge's numbers:
- **width** (raised on each ledge): 1.0 / 2.0 / 3.0 mm crest. Wider than the wall, the
  PLA flares out to it at 45° under the band, so the PLA-PETG bond is the crest's
  whole area. Auto stands one wall per ledge 0.6 mm in from the ledge's outer edge, so
  there a 2 / 3 mm crest overhangs the edge by 0.4 / 0.9 mm (nothing above it).
- **gap** (GAP 0 / GAP .2 on the bar, toward each side): 0 = the part prints straight
  onto the PETG, what PETG-interface users run; 0.2 = one empty layer, PLA's default.
  Whole layers only (gap/), so these are the two that differ at 0.2 mm layers.
**Print** PLA part and supports, the `Interface coupon interface` part (inside the
supports object) PETG, at 0.2 mm layers with a 0.2 first layer. Look for: does each
wall stay on its band through the print; does the part's underside release clean;
how each underside looks. The narrowest width that holds and the gap that releases
clean become Flat contacts' numbers (`PROP.ifaceW`, and `PROP.ifaceGap` or a field).
Not on the site's Calibrate menu: it needs a toolchanger, and the menu's estimates
slice one material.

### orient/ -- does it matter which way a flat overhang's walls run, and how close? (no setting yet)
Bar on the plate, six identical flat ledges 10 mm up (16.6 deep x 17.2 wide), walls
from Draw's drawnWall at the default 0.2 gap. Near side ACROSS: walls along x, across
the slicer's bridge lines (Auto's choice on the gap coupon). Far side PARALLEL: the
same ledges, walls along y, parallel to them. Pairs share the wall spacing exactly
(centre to centre, the bar face counting as one), raised on top: 8 / 5.3 / 4 mm
(2 / 3 / 4 walls across, the last 0.6 in from the free edge; 3 / 4 / 5 parallel, the
outer two 0.6 in from the side edges). What still differs, by nature: PARALLEL puts
more wall under a ledge (more to snap off), and its far edge is bare between walls. Checked in PrusaSlicer 3.0
alpha (default profile, 0.2 layers): every ledge's first layer is bridge infill at
90 deg, so the near side's walls cross it and the far side's run with it.
For a user: compare each pair (does direction matter?) and down each side (how
close do walls need to be for an underside you'd keep?). If ACROSS wins, a wall
direction rule (cross the slicer's bridge) is worth building; the spacing that
looks good sets the Coverage dial's target (span/).
- **2026-10-07, PLA:** ACROSS beat PARALLEL at every spacing; within each side the
  three spacings looked about the same. So direction matters and spacing (8 down to
  4 mm) doesn't: a wall direction rule (cross the slicer's bridge) is worth building
  (not built), and this sets no Coverage target.

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

### cutout/ -- what does each Cutouts style do to a tall wall? (Walls > Cutouts, CUT.pattern)
Bar on the plate, five identical 28 x 14 mm flat ledges 25 mm up (three near side,
two far); the site's Auto build per ledge with Cutouts 1: none, 2: diamond,
3: triangle, 4: arch, 5: lattice (style raised on top). Tall on purpose: cutouts open
only a wall's middle, and a short wall stays solid. Two walls a ledge. Support volume
per ledge (build.js; a cut wall's overlapping solids read a little high): none 1572,
diamond 1230 (78 %), triangle 1230 (78 %), arch 1043 (66 %), lattice 1048 (67 %) mm3.
For a user: the most open style whose walls stood, held their ledge flat and snapped
off whole. Built for the Calibrate menu; also shows the Lattice style off.
- **2026-10-07, PLA (Matthew):** every cut wall printed perfectly, all five styles --
  but every LEDGE was bad: the overhang printed in midair and hung down; the inner wall
  looked badly placed. Kept in the Calibrate menu: it's the wall test, and the walls
  passed. Why the ledges failed: in Matthew's slice the ledges' first layer ran PARALLEL to
  the walls -- the orient coupon's junk case -- though PrusaSlicer's default profile
  bridges across them. Same walls, different bridge direction: the slicer (or how it
  was set up) picks it, so a wall layout that only works across the bridge is a gamble
  (local issue 038).
Found building it: a cut wall's solids share edges (4 or 6 triangles to an edge), which
coupon.js's closed check refused; it now checks every directed edge has its reverse
(closed, consistently wound bodies). Most of those shared edges are FLUSH, not
overlapping -- web/cutout.js stacks slab pieces that meet exactly at their boundary
(CUT.eps grows pieces only across the strip sides and into the bands). Already on
main; it breaks the overlap-never-flush rule, so it's a follow-up.

### bore/ -- do walls inside a sideways hole pull out clean, from what size, and which way?
Block on the plate with eight through-bores along y, two sets of 3 / 5 / 8 / 12 mm,
centred 9 mm up; each has its size raised at the front and its set's letter at the back.
- **A** (bores 1-4, ALONG): the site's Auto build at the defaults, one wall along each
  bore's axis, running out the open end; 0 unserved. Checks the 2026-09-27 reversal
  (bores DO get supported) on a printed part.
- **X** (bores 5-8, ACROSS, added 2026-10-07 on Matthew's ask): the same bores with the
  walls turned 90 deg -- three Draw walls (drawnWall) across each bore at y -6 / 0 / 6,
  spanning 80 % of its width, standing on the bore's floor (foot gap) with tines at its
  ceiling: 2.4 x 2.7, 4.0 x 4.8, 6.4 x 7.7, 9.6 x 11.8 mm (length x height). Shaped to
  the bore's cross-section, a cross wall can still slide out along the bore; it may come
  out easier, and the orient coupon found walls across the slicer's bridge lines beat
  walls along them. Nothing touches the part (checked: 0 mm3 overlap).
For a user: pull every wall out an open end; note per bore clean / broke / stuck, and
whether A or X left the better ceiling. If X wins, a bore's wall direction is worth
changing in the engine.
- **v1 (A only): waiting on print; not printed.** Replaced by this build.
- **2026-10-07, PLA (Matthew):** A (one wall ALONG the bore) is better than X (walls across).
  The engine's bore walls stay as they are.

### sampler/ -- one part with every hard shape, as the site supports it (no setting)
Not a rung coupon: a showcase that sets nothing. A spine on the plate with, front:
40 / 30 / 20 deg ramps rising 10 mm (angle raised on top), a 20 mm ball, a 2 mm
ledge 18 mm out and 24 mm up; back: a table (28 mm flat bridge between its legs, 14 up), a 26 mm
mushroom cap on a 5 mm stem, a cave (18 x 14 flat ceiling); through the spine:
3 / 6 / 12 mm sideways holes (size raised above each); on the end: an arch tunnel.
One build in Full coverage (mode 'full') at every other default, all supports kept.
Every feature is big enough for real walls (10-26 mm long), so the print shows
whether each kind snaps off clean. A point-down tip in the first draft was dropped
(Matthew: a mess, tells us nothing).
- **2026-10-06, PLA (Matthew), the FIRST draft** (3-8 mm stubs, a point-down cone, one
  locked object): mostly bad -- spaghetti under the ball, mushroom cap, table and cone (too
  little support there), prominent tine marks; the holes looked okay. -> walls made real
  (bigger features), the cone dropped, supports exported as their own object.
- **Current build:** 44 walls (22 from the fill pass), must-hold 100 % (coverage scoreboard).
  `print/sampler-coupon.3mf` = supports as their own object (the site's Export > 3MF since
  #199).
  Expected weak spot: the table. PrusaSlicer bridges its underside at 0 deg (leg to leg)
  and Auto's flat-face walls run the same way -- parallel, which the orient coupon showed
  is junk (local wall-direction rule, still to build).
- **2026-10-07, PLA (Matthew), the current build:** pretty solid. The ball has a few
  drooping layers; the table's underside isn't perfect nearer the spine. Everything
  else printed well. The table was the expected weak spot (walls parallel to the
  bridge). It's in the site's Calibrate menu as the last print: what to expect once
  the others are tuned.

### bite/ -- RETIRED 2026-10-03 (files removed; last in git at 6ec7c16)
Asked how far tines should reach into the part (the old Tine bite field): twelve 40 deg
ledges, bite 0.15-0.70. **Printed twice in PLA: every rung fused and left a mark, none
failed, all looked about the same.** Why: at a tine's layer the part's edge is already
inside the 1 mm wall, and one layer up the part reaches back over the wall, so the
part's next layer prints straight onto the tine; the slicer merges part and supports
(one object), so the reach changes nothing. Bite is not a user setting any more (field
removed in #167; tines end at the part's surface in #168), so the coupon went too.
Replaced by tine/ (local issue 027).

### grip/ -- what does the Tine grip slider do on a print? (Tines > Tine grip)
The user-facing tine coupon. Bar on the plate, four 32 mm wide 30 deg ledges rising
14 mm (24 mm out), the site's Auto build per ledge, three walls each, every wall 23 mm
up the ramp. Each ledge has its setting raised on top (coupon.py label(), no dots):
OFF, LIGHT (slider left, the default), MID, FIRM (right) -> 0 / 5 / 7 / 11 tines a wall (build.js checks every wall
in a ledge got the same count). For a user: the lightest setting whose walls held
and whose ledge printed clean; marks get worse to the right.
Why 30 deg and this long: every wall gets at least 3 tines (`PROP.minGripTines`), and
the slider runs 5 -> 2 mm between them, so on a short wall it does nothing. The tine
coupon's 6 mm walls got 3 tines at both ends of the slider. A 30 deg ramp gives a long
wall at a low height.
Found building it: a main-pass wall's `built.fins[i].tines` reads 0 even when it has
tines (`built.props[i].tines` is right), so build.js counts from props.
- **2026-10-06, PLA:** all walls stood at every rung; OFF best for marks, LIGHT next.
- **split** (`split.py` -> `print/grip-coupon-split.3mf`): the same part and walls saved as TWO
  objects, the way Clough42 splits his support ("Split to objects"; GitHub #38). One object
  makes the slicer run one perimeter through part and tine (a weld); two keep their own.
  **2026-10-06, PLA:** loads and slices as wanted in Bambu Studio and PrusaSlicer; marks
  "a little bit better" than the merged print -- an improvement on a steep overhang, not
  as much as hoped. Decision: build a site export with supports as their own object (not built yet).

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
