# Support Fins — Onshape FeatureScript

A native **Onshape custom feature** that adds Support Fins' designed-in breakaway supports
to a part inside a Part Studio. It's a companion to [printfins.com](https://printfins.com):
same fins, same spec ([`docs/FIN-SPEC.md`](../../docs/FIN-SPEC.md)), but it runs on the CAD
model itself instead of an STL.

**Public Onshape document:**
[Fin Supports, V1](https://cad.onshape.com/documents/607917e8e297a68eb42cfb58/v/629a9559ea2972f32e386d1a/e/0875000cbc033d203bb4c861)
([latest workspace](https://cad.onshape.com/documents/607917e8e297a68eb42cfb58))

## What it does

Orient the part the way it will print, select it, and the feature adds the supports as new
parts beside it (the original part is never modified):

- **Overhang ribs.** Upside-down-T walls under each overhang. The rib top follows the
  underside a breakaway gap below it, necks to a 0.6 mm contact tip, and carries a comb of
  one-layer horizontal tines that fuse into the part. This is the web app's current default
  support.
- **Side bracing fins.** Round-topped walls standing a gap off a flat side of a part tipped
  onto an edge or corner, gripping it with rows of tines (the `fins.js` geometry). Off by
  default. Auto picks up to N faces facing apart, or you select the faces.
- **Bed pad.** A thin oval under a part that touches the bed only along an edge or at a
  point, the same height as the rib flanges so the two merge flush.

Export the part together with its supports as **one STL** and slice with supports off, the
same as a printfins.com export.

## Why a FeatureScript

The web app has to work on triangle soup, so most of its engine is mesh plumbing: welding
vertices, rebuilding adjacency, inside/outside tests, hand-built watertight solids. Onshape has
a B-rep kernel, which removes most of that:

| printfins.com (mesh) | This feature (B-rep) |
|---|---|
| Reorient the part, re-seat it on the plate | Pick a build plate (plane, face or mate connector); nothing moves |
| Overhang test per triangle | Overhang test per face against the build direction |
| Contour the rib top by sampling the mesh (`contourTop`, `settleTop`, …) | Sample the underside with kernel raycasts, then **subtract a copy of the part grown by the gap**, so the gap holds everywhere, including the flanks |
| Point-in-mesh parity tests | `qContainsPoint`, `evDistance`, booleans |
| Emit closed triangle solids | Sketch + extrude real solids; the slicer unions them with the part |

It also covers issues [#24](https://github.com/gittrahan/support-fins/issues/24) and
[#25](https://github.com/gittrahan/support-fins/issues/25) (STEP support): anything Onshape
imports as a solid (STEP, Parasolid, native parts) works.

## Install

1. Open the public document above.
2. In any Part Studio: toolbar **Custom features** → **Add custom features** → find the
   **Fin Supports** document → add **Support-Fins FS**.
3. Onshape pins your Part Studios to that version. When a new version is published, Onshape
   offers the update.

To work on the code instead, make a copy of the document, or paste
[`supportFins.fs`](supportFins.fs) into a new Feature Studio. The icon is
[`supportFins-icon.svg`](supportFins-icon.svg): upload it to the document and point the
`icon::import(...)` line at it.

## Use

1. Orient the part for printing (for example with a **Transform** feature). The Top plane is
   the build plate unless you pick another.
2. **Support-Fins FS** → select the part.
3. **Print settings** → set **Layer height** to the slicer's layer height (each tine is one
   layer, snapped to the layer grid) and pick **PLA** or **PETG** (the `MATERIAL` profiles
   from `web/app.js`).
4. Optionally turn on **Side bracing fins** for a part balanced on an edge or corner.
5. Select the part and all its orange supports → **Export** → STL, as one file.

Every option has a hover tooltip. The full manual, with diagrams, the options, a
troubleshooting table for every message the feature reports, and printing tips, is
[`SupportFins_User_Guide.pdf`](SupportFins_User_Guide.pdf).

## Port notes

Geometry and constants follow the web engine and `FIN-SPEC.md`. Where this port differs:

- **Placement rules are a subset.** Ported: 45° overhang test with a small slack on the
  threshold, 12 mm² minimum region, ribs running down-slope (or along the long axis when
  flat), rows at the max-unsupported-span pitch, a single rib on the lowest line of a large
  curved band, squat walls with a brim, edge-biased tine spacing with a 3-tine grip floor,
  and the side fin's 60° / 12 mm site separation. **Not ported:** `splitRegion`
  sub-patching, `withLowTails`, part-attached ("floor") supports, sway braces, wall cutouts
  and orientation scoring. The feature never picks the orientation; that stays the user's
  call, as on the site.
- **The rib tip steps rather than tapers.** The tip is a 0.6 mm wall over the top 1.5 mm of
  a 1.0 mm stem, instead of `profileHalf`'s linear neck.
- **One base height.** Rib flanges, squat-wall brims and the pad share one height
  (PLA 0.6 mm, PETG 0.4 mm, rounded to whole layers), so they meet without a step. Side-fin
  bases stay at the spec's 1 mm.
- **Side fins are sized to the face outline.** The fin rises only as high as the face
  reaches across its whole length, so a tilted square face (a diamond) gets a fin in the
  middle rather than a plank beside a corner.
- **Supports are separate parts.** Nothing is booleaned into the user's part. The tines and
  pad overlap it slightly, exactly as the web export does, and the slicer unions them.

## Limits

- **Solid parts only.** STL and other meshes import into Onshape as mesh bodies, which the
  feature can't process. For STLs, use printfins.com.
- Overhangs over another part of the model rather than over the plate get no rib, the same
  as the web app. Use **Add overhang faces** to force one.
- Side fins need a flat face at least 4 × 4 mm, leaning no more than the Max face lean
  (default 45°) from vertical, with open space beside it.
- Very complex parts with large curved overhangs can take a few seconds to regenerate.

## Status

Runs in Onshape (FeatureScript 2931) on test parts, including a tilted cube and a complex
part with curved overhangs. **Not yet print-tested:** the geometry follows `FIN-SPEC.md`,
but nothing generated by this feature has been sliced and printed yet. Reports from real
prints are welcome.

## Credits

Fin technique by Slant3D; engine, spec and constants from this repo by Matthew Trahan.
FeatureScript port by Chris Lee, Southeast Expedition Medical, LLC. MIT License, same as the
rest of the repo.

Claude Code (Opus 5.5) used to simplify the porting proccess and write much of the featurescript code.
