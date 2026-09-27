# Example models for the support logic

Shapes chosen because the engine struggles with them today, plus a probe that scores
how much overhang AREA is actually held up. The stress set (`prototype/stress/`) calls
a case OK once any wall is placed, so a curved ceiling with one wall under it passes
there and scores 15% here.

    python3 prototype/examples/gen.py            # regenerate models/ (trimesh + manifold3d)
    deno run -A prototype/examples/probe.js      # every model, upright and tilted 30deg
    deno run -A prototype/examples/probe.js bowl mushroom

    pip install thingi10k
    python3 prototype/examples/fetch_thingi.py   # real/: 19 Thingiverse files (~10 GB first download)
    deno run -A prototype/examples/probe.js --real

`real/` is git-ignored: each file keeps its own Thingiverse license (listed in
`real/CREDITS.md`), so they're fetched for local testing, never committed. They were
picked by eye from a contact sheet (whole, upright objects, not kit pieces); miniatures
are also written scaled to 32 mm tall.

Families:
- **tall / high ceiling** (`mushroom`, `table`, `shelf`, `bridge_span`): held fine, but
  every wall runs from the plate. `stilt mm` is the total bed-to-part wall height, which
  branching supports (issue #8) would cut.
- **curved** (`bowl`, `dome_ceiling`, `hook`, `vase_flare`, `torus_flat`): undersides
  that curve in plan and/or section.
- **miniature** (`mini_figure`, `mini_cape`, `mini_dragon_wing`): ~30 mm figures with
  small, fine overhangs near the engine's size floors.

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
