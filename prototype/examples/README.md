# Example models for the support logic

Real models the engine struggles with, plus a probe that scores how much overhang
AREA is actually held up. The stress set (`prototype/stress/`) calls a case OK once
any wall is placed, so a curved ceiling with one wall under it passes there and
scores 15% here.

    pip install thingi10k
    python3 prototype/examples/fetch_thingi.py   # real/: 19 Thingiverse files (~10 GB first download)
    deno run -A prototype/examples/probe.js      # every real model, upright and tilted 30deg
    deno run -A prototype/examples/probe.js curved_two_headed_bunny_64957
    deno run -A prototype/examples/probe.js --fixtures   # the curved test shapes in tests/fixtures/
    # any folder, more poses, and pictures (red unheld / green held / amber = in a region
    # under MIN_REGION_AREA the engine never looks at)
    deno run -A prototype/examples/probe.js --dir prototype/examples/reports --poses up,X45,Y45,suggested --dump /tmp/held
    python3 prototype/examples/render_held.py /tmp/held /tmp/held-png

    # the SCOREBOARD: main vs this checkout on must% (reports/ + real/, ~2 min, one process)
    prototype/examples/vs-base.sh
    deno run -A prototype/examples/probe.js --web ../other-checkout/web --json head.json   # any engine
    deno run -A prototype/examples/probe_diff.js base.json head.json

    # one model, raster placement off vs on (web/prop/raster.js), as a picture
    deno run -A prototype/examples/compare.js tests/fixtures/torus_flat.stl 30 /tmp/t.json
    python3 prototype/examples/render.py /tmp/t.json /tmp/t.png

`real/` is git-ignored: each file keeps its own Thingiverse license (listed in
`real/CREDITS.md`), so they're fetched for local testing, never committed. They were
picked by eye from a contact sheet (whole, upright objects, not kit pieces); miniatures
are also written scaled to 32 mm tall. File names carry the family: `mini_`, `curved_`,
`tall_`.

The generated shapes that used to live in `models/` were dropped (2026-09-28): the
figures were nothing like real miniatures. The three curved ones the raster tests use
(`bowl`, `dome_ceiling`, `torus_flat`) are test fixtures now, made by
`tests/fixtures/gen_curved.py`.

## reports/ -- the parts users reported (git-ignored)
Other people's files, kept locally in `reports/`, never committed: `dro_housing` (a customer's
DRO housing, 2026-10-05; they print it at X-90, back on the plate), `issue18_ssd_mounts`,
`issue50_knuckle`, `issue119_recessed_box`, `issue121_m4_front`, `issue157_bosch_vac` (from
the GitHub issues) and `mini_goblin_janitor` (Matthew's figure work).

**Baseline 2026-10-03 (main 8e0f3aa; the knuckle rows reproduce on 3155267)**, held% / small% (share of the overhang in regions
too small to be seen):

    issue121_m4_front     up 68/3    X45 69/3    Y45 51/2    suggested 45/3   sliver ~850-1090 per pose
    issue157_bosch_vac    up 66/10   X45 50/0    Y45 75/1    suggested 69/1   up: the bolt-hole flange gets nothing
    issue50_knuckle       up 74/1    X45 65/3    Y45 56/10   suggested 63/7
    issue18_ssd_mounts    up 96/0    suggested (on edge) 0/59: the four bosses bare
    mini_goblin_janitor   up 0/75    X45 0/100   Y45 0/77    suggested 42/63
    real minis, 32 mm, up: held 0-28%, small 34-100% (overhang only 5-125 mm2);
      witches' hat brim: a 124 mm2 ring split into 381 slivers, every one dropped, 0 walls

Two separate losses: on minis most overhang is in regions under the 12 mm2 floor
(small%); on organic parts the regions are big enough but `splitRegion` cuts them into
strips and drops every strip under the same floor (`sliver:`), plus `stub:` (wall too
short) and `noLine:`. Suggest picks least support, not best held (local issue 031).

**Baseline 2026-10-05 (main 7ef4cfa), must%** -- the policy number (below), area-weighted over
every case `vs-base.sh` runs (reports/ at up, suggested, X-90; real/ at up, X30):
**64.4% of 283,431 mm2**. By family:

    reports/  (21 cases)   70.9% of 87,383 mm2    tiny holes exempted: 634 mm2 (DRO 3 mm holes,
                                                  Bosch vac bores, M4 bolt holes, goblin base lettering)
    curved_   (18)         83.3% of 90,294
    tall_     (8)          57.5% of 31,027        (soap bubble chair: 0% both poses; castle window slots exempt)
    mini_     (12)         58.5% of 7,645         32 mm copies (12): 58.0% of 6,388
    others    (6)          31.8% of 60,694        buster 19-23%, M4 large 65-68%

## What the probe measures
Auto path, called like the app: `analyze(topo, 45, rot)` then
`buildFins(topo, res, rot, {mode:'auto', bedPad:true, tines:true})`.

- `held%`: overhang area whose face centroid sits within `maxUnsupportedSpan/2` of a
  wall top in plan and 0-1.5 mm above it (or on the plate, or at most 0.5 mm over the
  bed pad's top -- a cleat sole on studs over the pad; since 2026-10-06), over EVERY overhang face
  (held.js; before 2026-10-03 only faces in regions >= 12 mm2 counted, which hid minis;
  compare.js shares held.js, so its held faces and heldFrac changed the same way). A proxy:
  confirm a case by rendering or slicing before trusting a number.
- `must%`: **the policy number** (Matthew 2026-10-05: if there's red overhang, something
  has to hold it). `held%`'s rule over the MUST-hold faces only: all overhang but
  - `hole` (mm2, exempt): a tiny hole's ceiling, a horizontal bore or slot up to ~6 mm
    wide -- a model issue, left unsupported and flagged. A patch is one when it is a
    cylinder or flat roof (some face within ~14deg of straight down, normals square to the
    bore on area-weighted average), no wider than a 6 mm bore's overhang chord, with air
    at its plan centre just under the apex, part equally far either side there, and part
    under it within 6 mm (`classify` in web/fins/coverage.js, the rule the engine shares;
    held.js scores with it). Known gap: the axis is fitted to triangle corners, so a
    long slot roofed by two triangles skews it and reads wider than it is. On the goblin that is lettering under its
    base; the Bosch vac's toothed ring (V-notches), every armpit, and a flat collar round
    a post (a crossguard, a bolt head) stay must-hold.
  - `low` (mm2, reported apart): the strip under the squat-wall floor (0.82 mm), where
    no wall fits; it counts once a shim is coupon-tested. `low%` is how much of it is
    held anyway (by the bed pad, or a wall top in reach); probe_diff.js prints the total.
  It scores REACH, not the wall: the DRO housing's +X bore counts as held by a 3.8 mm
  wall with no tines. Look at the picture before trusting a 99.
- `small%`: the share of overhang in regions under MIN_REGION_AREA (12 mm2).
- `walls` / `onPart`: walls built, and how many stand on the part instead of the plate.
- `stilt mm`, `g`: plate-standing wall height summed, and support + pad mass (PLA).
- `skipped`: `buildProps`' own reasons (`sliver` = a patch under 12 mm2, dropped).

Draw mode is not measured.
