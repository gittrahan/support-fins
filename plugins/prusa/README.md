# Support Fins — PrusaSlicer 3.0 plugin

A native PrusaSlicer plugin companion to [printfins.com](https://printfins.com), targeting
the **3.0 plugin API** (`project.plugin` 1.0.0). Bundle `com.printfins.support-fins/` is one
flat directory with a single menu entry:

- **Support Fins → Add a Fin** (`add_fin.lua`) — drops one breakaway **support fin** for a part
  printed **tilted**: a thin (1.2 mm) right triangle that stands under the part's sloped
  underside, the same shape as the 30°/45°/60° angled-print fins people place by hand
  ([printables.com/model/1771718](https://www.printables.com/model/1771718)). Its **slope**
  runs from a low tip on the plate up to the top of a straight back edge, **0.2 mm under the
  part**, on a thin foot with a round back end. A **comb of tines** runs along the slope: one-layer
  horizontal nubs, one bead (0.5 mm) wide, each top on the print preset's layer grid, that
  reach across the gap and **0.5 mm into the part** at mid-layer (`PROP.tineBite`), so each prints as one
  strand that fuses in and snaps clean (`docs/FIN-SPEC.md`). The top of the slope ends in a
  short flat (1.2 mm, a little more when steep), never a point. Params: **Slope Angle** (20–70°, default 45), **Fin Height**,
  a **Gripping Tines** toggle, and **Tine Spacing** (default 6 mm, the sway braces' printed
  spacing; at least 1 mm). Tines spread evenly from just above the foot to just under the
  top, no further apart than Tine Spacing along the slope, so both ends always grip; a fin
  never gets fewer than 3 (the site's grip floor), so a huge spacing still leaves 3. A 25 mm
  45° fin gets 7 at 6 mm, 18 at 2 mm, 4 at 12 mm.

  **Placing it:** set Slope Angle to the angle of the part's underside. Turn the fin about Z
  only, so its slope climbs the same way as the underside, and slide it until the slope sits
  0.2 mm under the part — e.g. put the low tip 0.2/sin(angle) (0.28 mm at 45°) out from where
  the underside meets the plate. The foot starts where the slope rises above it, so the part
  keeps the slope's own gap off it. Wide parts want a fin near each side.

  The tines overlap your part, which PrusaSlicer slices as a separate object, so each tine's
  0.5 mm bite is extruded twice (a few hundredths of a mm³ per tine). If your version can
  merge the fin and part into one object, merging unions it instead.

  **How the slope is built:** the slope is **one cube turned to the angle** (`rotate = {y =
  -angle}`), a 1.5 mm rail whose top face *is* the slope. A stack of cube steps fills
  under it, every step corner inside the rail (one layer tall below where the rail starts, so
  the slope there is no rougher than the slicer's own layers). Each tine also reaches into the step behind it,
  so it holds on even if the rail misbehaves. The API's only triangle (`make_prism`) is
  isosceles with its apex centred (PrusaSlicer `its_make_prism`), so a vertical back edge
  would need a Negative cut, which the slicer draws as a grey box over half the fin.

## Why placement is by hand — read before filming

The website is the real product: load any STL → rotate it into a stronger orientation → it
finds the overhangs and contours breakaway fins to the part's underside → export an STL that
prints support-free in **any** slicer. All of that is **mesh analysis**: it reads the model's
triangles.

**The 3.0 plugin sandbox cannot read a mesh.** Verbatim from the API notes: *"a mesh's
geometry cannot be read back — `Mesh` exposes `bounds()` and `translate()`, not triangles,"*
and there is no getter for the user's loaded object's geometry anywhere in `ProjectApi.cpp`.
The API is **generative** (build parametric objects from `make_cube`/`make_cylinder`/…). So a
plugin can't auto-detect an overhang, contour a fin to it, or snap onto a surface — it can
only *generate* the fin and let you place it. Auto-fitting stays on the web. The honest
on-camera line: *"Prusa shipped plugins mid-build, so I brought the fin into the slicer — it
can't see your model, so it can't auto-fit like the site, but it drops the real fin in and you
set it under your overhang."*

## Install

**Dev (no signing) — the fast loop:** copy the bundle directory into PrusaSlicer's data dir:

```
cp -R .../plugins/prusa/com.printfins.support-fins "<data dir>/lua/"
```

`<data dir>` is the folder holding `PrusaSlicer.ini`. On the 3.0 alphas it is **not** the
plain name — a 3.0.0-alpha11 Windows build used `%APPDATA%\PrusaSlicer3-dev\`; on macOS look
under `~/Library/Application Support/`. Don't guess; find the folder with `PrusaSlicer.ini`,
or launch with `--datadir`. Create the `lua/` subfolder if needed, then restart the slicer;
the entry appears under **Support Fins → Add a Fin**.

**Release (signed ZIP import):** the convenient install path requires a signature:

```
PrusaSlicer plugin keygen -P author.private.pem -p author.public.pem
PrusaSlicer plugin sign   -P author.private.pem com.printfins.support-fins
```

The ZIP must hold the bundle's files **at its root** (`manifest.json` at the top level, not
inside a `com.printfins.support-fins/` folder), and importers need
`authorized_authors/matthewtrahan.pem` (the `author` field names the key file).

## Verify (must be done in a running 3.0 slicer — it can't be unit-tested)

1. **Support Fins → Add a Fin** appears; the dialog shows Slope Angle, Fin Height, the Gripping
   Tines toggle and Tine Spacing.
2. Generate with defaults → a 45° right triangle, 25 tall, its slope climbing toward +X with
   7 small tines spread along it, a straight back edge, and a foot running from near the low tip to past the back edge.
   Preview of the intended shapes at 30/45/60°: `~/Downloads/support-fin-prusa-preview.png`.
3. **The slope must be smooth and flush.** It is the one turned volume (a cube rotated about
   Y). If it tilts the wrong way or sits off the triangle, you'd see a plank sticking
   down or out and the stepped fill underneath. Report it with a screenshot.
4. Slice at your usual layer height and scrub the layer slider: each tine should show up on
   **exactly one layer** (never split across two). Change the layer height, generate a new
   fin, and check again — the tines follow the bed's print preset (a per-object layer height
   override isn't seen).
5. Set it under a tilted part (slope 0.2 mm under the underside), slice, print, bend the fin
   off — the tines should snap clean and leave faint dots.

All pieces are built in one flat object space via `shapes.builder()` (vendored from
leotrax3d, MIT), which anchors every volume to the first and places each primitive by its
bounding box, so nothing assumes where a primitive puts its origin.

**Lint / local checks:** run `./run-tests.sh` from the `plugins/prusa/` dir (needs `lua`/`luac`). It
covers syntax (`luac -p`), the manifest JSON, the slicer's **scan pass** on a bare engine, and
the fin **arithmetic** against a mock api (`tests/add_fin_test.lua`), which models the real
semantics (corner-origin cubes, Z-axis cylinders, `other_volumes` translated **relative to the
main mesh** and turned right-handed about their own origin, as the bundled temp tower's
upright text shows, and the preset's layer grid). At 30/45/60° and the clamps it asserts the
rail's top face **is** the slope, the fill stays under it with its notches inside the rail,
the foot clears the part, and every tine is one layer on the grid, grips the fin and bites
0.5 mm into the part (also at a 0.3 layer over a 0.25 first layer, with the preset handing back
strings like `"150%"`, and with no preset at all). The
fatal, silent trap the scan guards is any `require`/`api` call **at file scope** — the scan runs
the whole file just to read `info`, on an engine with neither, so a hit there produces no menu
entry and no error. Both files keep all `api`/`require` use inside functions (`execute()` for the
plugin, method bodies for the module); keep it that way.

## Notes / possible polish

- **Material.** Gap 0.2 / bite 0.5 are the site's PLA defaults (`PROP`). PETG wants bigger gaps
  and shallower tines; a material choice could come after the bite coupon prints.
- **Distribution:** optionally PR to
  [leotrax3d/prusaslicer-plugins-unofficial](https://github.com/leotrax3d/prusaslicer-plugins-unofficial)
  for reach + its CI and signing/release workflow, keeping the canonical copy here.
- The earlier self-contained **Overhang Test** and **Combined Support Demo** entries were
  removed (git history keeps them) — the single Add-a-Fin is the product.
