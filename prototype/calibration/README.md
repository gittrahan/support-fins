# Calibration coupons

Small test prints that settle a geometry number by printing it, instead of guessing.
Each coupon is ONE solid piece (a multi-piece coupon lost parts off the bed), built
by the engine's own code so the print tests what the app actually makes:

    python3 prototype/calibration/<name>/gen.py      # the part -> out/coupon_part.stl
    deno run -A prototype/calibration/<name>/build.js  # walls on it -> out/<name>-coupon.3mf

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

