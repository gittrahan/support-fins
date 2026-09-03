# Support Fins — PrusaSlicer 3.0 plugin

A native PrusaSlicer plugin companion to [printfins.com](https://printfins.com), targeting
the **3.0 plugin API** (`project.plugin` 1.0.0). Bundle `com.printfins.support-fins/` is one
flat directory with a single menu entry:

- **Support Fins → Add a Fin** (`add_fin.lua`) — drops one breakaway support fin onto the
  plate: a thin blade on a flared foot, necking to a thin tip, with a **comb of horizontal
  tines up the gripping face** (denser near the base, per Slant3D's spec) — the same fin the
  website bakes in. You position it by hand with **PrusaSlicer's own move tool**: turn it so
  the **tine face** (the combed +X side) sits against your part's overhanging face, foot on
  the plate, and nudge it until the tines just touch. Then bend the fin off — the horizontal
  tines fuse in one layer line and snap clean. Params: fin height, length, wall, foot, and a
  **Gripping Tines** toggle (off = a plain breakaway wall for a flat overhang).

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
cp -R .../plugin/com.printfins.support-fins "<data dir>/lua/"
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

1. **Support Fins → Add a Fin** appears; the dialog shows four floats + the Tines toggle.
2. Generate with defaults → a thin blade on a T-foot, a necked tip, and a comb of ~7 tine ribs
   up the lower part of one face. (Preview of the intended shape:
   `~/Downloads/support-fin-plugin-preview.png`.)
3. Move it so the tine face meets a part's overhanging face, foot on the plate; nudge until the
   tines just kiss the face.
4. **The one unverified assumption to eyeball:** the wall (main mesh) is *not* translated, so it
   relies on `make_cube` being corner-origin (base at z = 0). This matches `tolerance_test.lua`
   and the API notes; if the fin sits half-buried, `make_cube` is centred — fix with an object
   `translate` of `+height/2`.
5. Slice, print, bend the fin off — tines should snap clean and leave faint marks.

**Lint / local checks:** run `./run-tests.sh` from the `plugin/` dir (needs `lua`/`luac`). It
covers syntax (`luac -p`), the manifest JSON, the slicer's **scan pass** on a bare engine, and
the fin **arithmetic** against a mock api (`tests/add_fin_test.lua`). The fatal, silent trap it
guards is any `require`/`api` call at file scope — the scan runs the whole file just to read
`info`, on an engine with neither, and a hit there produces no menu entry and no error. The
plugin keeps all `api` use inside `execute()` and needs no `require`; keep it that way.

## Notes / possible polish

- **Chamfered foot.** The foot is currently a flat flange; a bevel up to the wall would read
  even more like the `breakaway.py` profile. Skipped for now — it needs rotated `Negative` cuts
  whose result can't be verified headlessly; add it with an in-slicer look.
- **Distribution:** optionally PR to
  [leotrax3d/prusaslicer-plugins-unofficial](https://github.com/leotrax3d/prusaslicer-plugins-unofficial)
  for reach + its CI and signing/release workflow, keeping the canonical copy here.
- The earlier self-contained **Overhang Test** and **Combined Support Demo** entries were
  removed (git history keeps them) — the single Add-a-Fin is the product.
