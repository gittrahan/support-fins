# Calibration coupons

Small test prints that settle a geometry number by printing it, instead of guessing.
Each coupon is ONE solid piece (a multi-piece coupon lost parts off the bed), built
by the engine's own code so the print tests what the app actually makes:

    python3 prototype/calibration/<name>/gen.py      # the part -> out/coupon_part.stl
    deno run -A prototype/calibration/<name>/build.js  # walls on it -> out/<name>-coupon.3mf

The user-facing coupons (gap, span, angle, pad, bore) share `coupon.py` (boxes, rung
dots, the one-piece check) and `coupon.js` (the site's own call -- `analyze(topo, 45,
rot)` then `buildFins(..., {mode: 'auto', bedPad: true})` at the site's PLA defaults --
run once per rung with that rung's setting, keeping the supports in the rung's box).
`python3 prototype/calibration/render.py <name>` draws a build. What a user does with
each one is `docs/CALIBRATION.md`.

`out/` is git-ignored. The files actually printed are committed in `<name>/print/`
(.3mf with the part and walls as separate objects, one merged .stl, a render), so a
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


### gap/ -- how close may a wall stand to the part? (the Gap field, PROP.gap)
Bar on the plate, six identical 12 x 10 mm flat ledges 10 mm up over open plate; the
site's Auto build per ledge with Gap = 1: 0.1, 2: 0.15, 3: 0.2, 4: 0.25, 5: 0.3,
6: 0.4 mm (the field's range). Two walls per ledge; each wall's top measured at
10 - gap (9.9 ... 9.6). For a user: the smallest gap that snaps off clean.
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
- **waiting on print.**

### angle/ -- what overhang does the printer manage unsupported? (the Overhang slider)
Bar on the plate, seven ramps whose undersides rise 8 mm at 1: 30, 2: 35, 3: 40,
4: 45, 5: 50, 6: 55, 7: 60 deg from the plate (checked from the face normals).
Printed with NO supports, so there is no build.js; `print/` has the STL only. For a
user: the shallowest clean ramp is the Overhang setting.
- **waiting on print.**

### pad/ -- how far off the part should the bed pad stand? (Bed pad > Custom > Pad gap)
The one multi-piece coupon, on purpose: six 15 mm cubes on an edge (bed contact is a
line, so each gets a pad), Auto per cube with Bed pad = Custom at Light's numbers
(h 0.2, grip 0, spread 4) and Pad gap 1: 0, 2: 0.08, 3: 0.12 (Light), 4: 0.16,
5: 0.2, 6: 0.3 mm. Where each pad's top crosses the first-layer cut, measured off
the cube's first-layer outline: -0.005 / 0.084 / 0.133 / 0.167 / 0.208 / 0.297 (the
0.1 mm brim mesh). A cube that comes loose is a result. The 3MF is re-packed
deflated (the brim mesh is 113k triangles: 7.5 MB stored, 0.9 MB deflated, local
issue 007); no merged STL in `print/`.
- **waiting on print.**

### bore/ -- do walls inside a sideways hole pull out clean, and from what size?
Block on the plate with through-bores along y, 1: 3, 2: 5, 3: 8, 4: 12 mm across,
centred 9 mm up. One Auto build at the defaults (nothing varied): one wall along each
bore's axis, inside the bore, running out the open end; 0 unserved. Checks the
2026-09-27 reversal (bores DO get supported) on a printed part.
- **waiting on print.**
