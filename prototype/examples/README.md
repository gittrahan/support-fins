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

## What the probe measures
Auto path, called like the app: `analyze(topo, 45, rot)` then
`buildFins(topo, res, rot, {mode:'auto', bedPad:true, tines:true})`.

- `held%`: overhang area whose face centroid sits within `maxUnsupportedSpan/2` of a
  wall top in plan and 0-1.5 mm above it (or on the plate). A proxy: confirm a case by
  rendering or slicing before trusting a number.
- `walls` / `onPart`: walls built, and how many stand on the part instead of the plate.
- `stilt mm`, `g`: plate-standing wall height summed, and support + pad mass (PLA).
- `skipped`: `buildProps`' own reasons (`sliver` = a patch under 12 mm2, dropped).

Draw mode is not measured.
