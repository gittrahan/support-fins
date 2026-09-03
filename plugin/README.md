# Support Fins — PrusaSlicer 3.0 plugin

A native PrusaSlicer plugin companion to [printfins.com](https://printfins.com), targeting
the **3.0 plugin API** (`project.plugin` 1.0.0). Bundle `com.printfins.support-fins/` is one
flat directory with two menu entries under **Support Fins**:

- **Overhang Test** (`support_fins.lua`) — generates a cantilever overhang test object with a
  breakaway fin baked in: a thin wall on a wide foot that stops the breakaway `gap` (0.2 mm)
  below the overhang, so the overhang bridges the last layer and the fin snaps off clean.
  Print it, bend the fin off, look at the underside. Nothing to position — it's self-contained.
- **Add a Fin** (`add_fin.lua`) — drops ONE standalone breakaway fin (wall + foot + a necked
  tip), sized to your overhang, into the scene. You then slide it under your overhang with
  **PrusaSlicer's own move tool**. The plugin can't read your model or place things on its
  surface (see below), so positioning is by hand — set **Overhang Height** to your overhang's
  height above the plate, keep the fin's foot on the plate, and centre it under the overhang;
  the tip then lands `gap` below the surface. Auto-fitting is exactly what the website does.
- **Combined Support Demo** (`combined_support.lua`) — a cube tilted onto its edge (so it
  would topple mid-print) held by a fin with a comb of **horizontal tines** biting the
  vertical front face — Slant3D's *combined* support. The **Tines (combined)** toggle is the
  lesson: on = it grips and prints; off = a plain wall the cube falls away from. Print it and
  bend the fin off — the horizontal tines fatigue and snap clean.

## Why this is a *demo*, not the whole tool — read before filming

The website is the real product: load any STL → rotate it into a stronger orientation → it
finds the overhangs and contours breakaway fins to the part's underside → export an STL that
prints support-free in **any** slicer. All of that is **mesh analysis**: it reads the model's
triangles.

**The 3.0 plugin sandbox cannot read a mesh.** Verbatim from the API notes: *"a mesh's
geometry cannot be read back — `Mesh` exposes `bounds()` and `translate()`, not triangles,"*
and there is no getter for the user's loaded object's geometry anywhere in `ProjectApi.cpp`.
The API is **generative** (build parametric objects from `make_cube`/`make_cylinder`/…), the
same genre as Prusa's own fan/flow calibration towers. Analyzing and modifying an arbitrary
imported part is explicitly outside what it can do.

So the auto tool stays on the web, and the plugin does the one thing a plugin genuinely can:
**generate the fin itself**, natively, so PrusaSlicer users get a printable proof of the
mechanism without leaving the slicer. The honest on-camera line: *"Prusa shipped plugins
mid-build, so I brought the fin into the slicer — turns out the sandbox can't read your
model, so the automatic version has to stay on the site, but the fin ships native."*

## Install

**Dev (no signing) — the fast loop:** copy the bundle directory into PrusaSlicer's data dir:

```
<data dir>/lua/com.printfins.support-fins/
```

`<data dir>` is the folder holding `PrusaSlicer.ini`. On the 3.0 alphas it is **not** the
plain name — a 3.0.0-alpha11 Windows build used `%APPDATA%\PrusaSlicer3-dev\`. Don't guess;
find the folder with `PrusaSlicer.ini`, or launch with `--datadir`. Restart the slicer; the
entry appears under **Calibration → Support Fin Overhang Test**.

**Release (signed ZIP import):** the convenient install path requires a signature. Build a
keypair once, sign, and users import the ZIP:

```
PrusaSlicer plugin keygen -P author.private.pem -p author.public.pem
PrusaSlicer plugin sign   -P author.private.pem com.printfins.support-fins
```

The ZIP must hold the bundle's files **at its root** (`manifest.json` at the top level, not
inside a `com.printfins.support-fins/` folder), and importers need
`authorized_authors/matthewtrahan.pem` (the `author` field names the key file).

## Verify (must be done in a running 3.0 slicer — it can't be unit-tested)

`api`, `VolumeType`, and the preset system exist only inside PrusaSlicer, so behaviour is
verified by hand, once:

1. Both entries appear under a **Support Fins** menu (`Overhang Test`, `Add a Fin`); each
   dialog shows five float params.
2. **Overhang Test** with defaults → an upright post carrying a slab that juts out over air,
   with a thin finned wall on a foot standing under the slab's free end.
3. **Add a Fin** with defaults → one standalone fin (wall + wide foot + a thin top tip). Move
   it under an overhang with PrusaSlicer's move tool; foot stays on the plate.
4. **The one unverified assumption to eyeball:** each object's main mesh is *not* translated,
   so it relies on `make_cube` being corner-origin (base at z = 0). This matches
   `tolerance_test.lua` and the API notes, but if a piece sits half-buried in the plate,
   `make_cube` is centred — fix by giving `add_object` an object `translate` of `+height/2`.
5. Slice: the fin's tip should sit ~0.2 mm under the overhang (breakaway gap); on the Overhang
   Test the slicer's own supports should be absent from the span (`SupportBlocker` +
   `support_material = 0`).
6. Print, then bend the fin off and check the underside is clean. That's the whole thesis.

**Lint / local checks:** run `./run-tests.sh` from the `plugin/` dir (needs `lua`/`luac`). It
covers syntax (`luac -p`), the manifest JSON, the slicer's **scan pass** on a bare engine, and
the placement **arithmetic** against a mock api (`tests/`). The fatal, silent trap it guards
is any `require`/`api` call at file scope — the scan runs the whole file just to read `info`,
on an engine with neither, and a hit there produces no menu entry and no error. Both plugins
keep all `api` use inside `execute()` and need no `require`; keep it that way. Behaviour itself
can't be unit-tested (`api`/`VolumeType`/presets exist only in the slicer) — verify in-slicer.

## Roadmap

- **v0 (this):** two entries — the self-contained **Overhang Test** demo and **Add a Fin**
  (manual breakaway-fin primitive you position with the slicer's move tool). Both are the PROP
  primitive (the web tool's default), no tines — flat undersides correctly get none.
- **v1 — the combined-support hero (SHIPPED):** `combined_support.lua` — a cube tilted onto
  its edge held by a fin with a horizontal tine comb + a `combined` toggle (tines on = holds;
  off = falls away, Slant3D's "why you need tines"). The tilt keeps the front face on y = 0
  (vertical), so tines are constant-gap horizontal nubs; `combined_test.lua` point-in-polygon
  verifies every tine bites the face. Bed-start caveat: the cube rests on a line edge onto a
  breakaway raft — confirm first-layer adhesion in-slicer; a brim is the fallback (we skip the
  part-modifying chamfer by design).
- **Distribution:** optionally PR to
  [leotrax3d/prusaslicer-plugins-unofficial](https://github.com/leotrax3d/prusaslicer-plugins-unofficial)
  for reach + its CI (`check-plugins.sh`, `run-tests.sh`) and signing/release workflow, while
  keeping the canonical copy here.
