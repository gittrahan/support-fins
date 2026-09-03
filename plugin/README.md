# Support Fins — PrusaSlicer 3.0 plugin

A native PrusaSlicer plugin companion to [printfins.com](https://printfins.com). It
generates a **cantilever overhang test object with a real breakaway support fin baked in**
— a thin wall on a wide foot that rises from the plate and stops the breakaway `gap`
(0.2 mm) below the overhang, so the overhang bridges the last layer and the fin snaps off
clean. Print it, bend the fin off, look at the underside.

Bundle: `com.printfins.support-fins/` — one flat directory (`manifest.json` +
`support_fins.lua`), targeting the PrusaSlicer **3.0 plugin API** (`project.plugin` 1.0.0).

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

1. Menu entry appears under `Calibration/Support Fin Overhang Test`; the dialog shows the
   five float params.
2. Generate with defaults → an upright post carrying a slab that juts out over air, with a
   thin finned wall on a foot standing under the slab's free end.
3. **The one unverified assumption to eyeball:** the post (the object's main mesh) is *not*
   translated, so it relies on `make_cube` being corner-origin (base at z = 0). This matches
   `tolerance_test.lua` and the API notes, but if the post sits half-buried in the plate,
   `make_cube` is centred — fix by giving `add_object` an object `translate` of `+H/2` in z.
4. Slice: the fin's top should sit ~0.2 mm under the slab (breakaway gap), and the slicer's
   own supports should be absent from the span (the `SupportBlocker` + `support_material = 0`).
5. Print, then bend the fin off and check the underside is clean. That's the whole thesis.

**Lint:** this machine has no `lua`/`luac`, so the Lua here is unlinted locally. Before a
release run `luac -p support_fins.lua` (syntax) and reproduce the slicer's scan pass with a
`check-plugins.sh`-style check — the fatal, silent trap is any `require`/`api` call at file
scope (the scan runs the whole file just to read `info`, on a bare engine with neither). This
plugin keeps all `api` use inside `execute()` and needs no `require`; keep it that way.

## Roadmap

- **v0 (this):** cantilever overhang + breakaway wall — the PROP primitive (the web tool's
  default), no tines. Flat undersides correctly get no tines.
- **v1 — the combined-support hero:** a block tilted onto its edge held by a fin *with a
  horizontal tine comb*, plus a `combined` toggle (tines on = it holds; tines off = it falls
  away, Slant3D's own "why you need tines" failure). This is the signature snap-off and the
  video's money shot; it needs 2-object placement + tilt trig, so it ships after v0 is
  verified in-slicer.
- **Distribution:** optionally PR to
  [leotrax3d/prusaslicer-plugins-unofficial](https://github.com/leotrax3d/prusaslicer-plugins-unofficial)
  for reach + its CI (`check-plugins.sh`, `run-tests.sh`) and signing/release workflow, while
  keeping the canonical copy here.
