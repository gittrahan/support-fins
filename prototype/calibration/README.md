# Calibration coupons

Small test prints that settle a geometry number by printing it, instead of guessing.
Each coupon's PART is ONE solid piece (a multi-piece coupon lost parts off the bed),
with its supports built by the engine's own code so the print tests what the app
actually makes (tine/ also adds its KISS tines as a second object, on purpose):

    python3 prototype/calibration/<name>/gen.py      # the part -> out/coupon_part.stl
    deno run -A prototype/calibration/<name>/build.js  # walls on it -> out/<name>-coupon.3mf

The user-facing coupons (angle, gap, bite, span, pad, bore) share `coupon.py` (boxes, rung
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

### bite/ -- how far should tines reach into the part? (the Tine bite field, PROP.tineBite)
Bar on the plate, twelve identical 16 mm ledges, undersides 40 deg off the plate;
Auto per ledge with Tine bite 0.15 ... 0.70 in 0.05 steps (1-12 dots, a second row
past six). One wall + 3 tines per ledge on every rung. Each tine's reach INTO the
part (its overlap with the solid / its cross-section) climbs with the rung: 0.15 ->
0.01-0.08 mm, 0.50 -> 0.31-0.49, 0.70 -> 0.51-0.69 (layer snap makes the three
differ). At 0.10 the engine places no tines on this slope, so the ladder starts at
0.15. One print reads both ends: the low rungs where a wall drops off with no snap
(grip failed) and the high rungs where a snapped tine leaves a mark.
- Field added with it (Tines section, 0.1-0.8, default 0.5, `tunables.wallBite`;
  the field was removed in #167).
  The material profile's `tineBite` (PLA 0.30 / PETG 0.15) is FIN.tineBite, which
  only the sway braces read; walls always used PROP.tineBite 0.5. Unchanged here.
- **2026-10-02, PLA: every rung fused, all left marks; none failed.** Bite isn't the
  dial. Measured on this coupon: at a tine's own layer the part's edge is only
  0.02-0.20 mm out from the wall's centreline (inside the 1 mm wall), and one layer up
  the part reaches 0.05-0.23 mm back OVER the wall. So the part's next layer prints
  straight onto the tine with no gap, and a slicer merges a tine into the part it
  touches. The weld is about the tine's plan area under the part, the same at 0.15
  and 0.70. Replaced by tine/ (local issue 027).
- **2026-10-03, PLA, second print (all-coupons plate): rung 1 (0.15) looked best, but
  all twelve look nearly the same.** Matches the finding above. The Tine bite field
  is gone (#167) and tines now end at the part's surface (#168): bite is only a
  placement reach.

### tine/ -- what leaves the smallest tine mark and still holds?
The bite coupon's bar and 40 deg ledges, ten of them; Auto per ledge with:
near side (shape, 3 tines a wall) 1 square 0.5 wide (today), 2 square 0.4, 3 square
0.3, 4 pointed tip, 5 KISS square, 6 KISS pointed; far side (count, today's square)
7 three tines, 8 two, 9 one, 10 none. Knobs: `tunables.tineWidth` / `tineTip` /
`tinesPerWall` (#166, calibration only; no site field until this prints).
KISS: kiss.py cuts those tines off at the part's surface and writes them as their
OWN object in the 3MF, so the slicer keeps them apart from the part instead of
merging them. **Print the 3MF** (the .stl can't keep objects apart), and if the
slicer asks whether to load it as one object with several parts, say **no**.
**Never Arrange** (and turn off arrange-on-load): it moves the two objects apart,
leaving the kiss walls standing loose and ledges 5-6 bare. The file places both
together on any bed 180 mm or bigger; to move it, select both and move them as one.
Check in the preview that ledges 5-6 have their walls under them.
Measured before printing (PrusaSlicer, 0.2 layers): every tine prints, 0.3 and
pointed included; two objects in the G-code; tine top under the part's next layer,
per ledge: 1 0.97 mm2, 2 0.74, 3 0.53, 4 0.60, 5 0.36, 6 0.34, 7 0.97, 8 0.65, 9 0.33.
For a user: the ledge with the faintest marks that still snapped (didn't fall off).
- **2026-10-02/03, PLA, printed twice (alone, then on the all-coupons plate): no clear
  order. Best were 5 (kiss, square) and 9 (one tine), but every ledge looked similar.**
  Those two are among the least tine-top contact (9 0.33, 6 0.34, 5 0.36 mm2; 10
  has no tines at all), so it leans the right way, but 6 and 10 didn't stand out and
  the effect is small next to print-to-print variation. Likely why (a guess, not
  measured): XY has the same rounding as the gap's layers. A tine is one bead, and
  0.3, 0.4 and 0.5 mm wide probably all print as about one ~0.45 mm extrusion, so the
  width rungs differ less on the plate than in the model. Next, if any: exaggerate (0 vs 1 vs 3 tines; kiss vs merged on
  the same ledge), and repeat each rung 2-3 times. Decision pending (local issue 027).
