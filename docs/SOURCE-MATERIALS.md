# Source material identities

`readThreeMF(bytes, { withMaterials: true })` and
`readThreeMFParts(parts, { withMaterials: true })` optionally retain categorical
source materials alongside the existing component provenance. Ordinary callers
keep the existing geometry, colours, raw painting and export behavior. This
internal interface does not yet assign support materials or change the preview.

Each returned object has `components` and a `materials` field:

- `materials.materials`: a catalog of package-local identities. `filament:N` identifies
  saved one-based filament slot N. A core 3MF identity includes the resource file,
  resource ID and entry index. Equal RGB values never merge identities. Names,
  types and display colours are descriptive metadata, not material matching.
- `materials.occurrences`: one entry per component occurrence, aligned with `components`.
  Its key includes the build item, component route and source mesh. Repeated
  references share source topology while retaining their own occurrence identity.
- `materials.occurrences[i].faces[j]`: the source face at `components[i].sourceFaces[j]`.
  It retains the inherited filament (`base`), core resource (`core`), applicable
  wall/infill/solid-infill assignments (`roles`) and exact painted `regions`.
- `materials.issues` and `materials.complete`: aggregated diagnostics. A face's `unresolved` reason
  identifies malformed paint, missing assignments, unavailable slots, conflicting
  settings, unsupported resource types or ambiguous mappings. Known identities
  are retained where possible; an unresolved face is not a successful match.

Region triangles use the **original face corner order**, in coordinates
`(0,0), (1,0), (0,1)`. `worldMaterialRegions(component, faceIndex, faceMaterials)`
maps them to the reader's transformed millimetre coordinates using its explicit
corner permutation. Mirroring must not silently reverse paint coordinates.
Face records are shared for repeated identical annotations; treat them as
read-only. The field's lifetime is the decoded input, with no global mesh cache.

Saved part or Prusa volume assignments override object assignments, then project
assignments. Zero inherits. A single declared filament slot can supply an
otherwise missing default; multiple slots cannot. Material-role overrides remain
separate from exterior colour painting: this field describes saved surface
assignments, not reconstructed interior sliced material volumes.

Bambu/Orca `paint_color` and Prusa `mmu_segmentation` are decoded as subdivision
trees, retaining inherited regions and extended slot identities. Their extended
state encodings differ: Bambu uses repeated F extensions, while current Prusa
uses an E escape followed by two nibbles for states 17–255. The independently
implemented codec is in `web/paint-tree.js`; the existing CLI import path remains
available. Format references are the serialization definitions in
[Bambu Studio](https://github.com/bambulab/BambuStudio/blob/v02.08.02.60/src/libslic3r/TriangleSelector.cpp)
and [PrusaSlicer 2.9.7](https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.7/src/libslic3r/TriangleSelector.cpp).

Core material and colour resources retain their own identities. Interpolated
corner properties and texture resources are unresolved. A core colour has no
implicit mapping to a filament, even if its RGB equals a saved slot's colour.
When core and filament assignments coexist, both are retained for an explicit
mapping; unpainted regions do not choose between them by colour proximity.

Raw source attributes, including seam/support painting and unknown attributes,
remain untouched in component provenance. This API neither repairs geometry nor
rewrites painting. A subtraction source-face hint alone is insufficient to move
paint onto a new face: consumers must prove geometric containment, and new cut
surfaces without such evidence remain unresolved. Callers must surface explicit
fallbacks instead of claiming a guessed material was preserved.

Focused verification:

```sh
deno test -A tests/source_materials.test.js tests/paint_tree.test.js \
  tests/provenance.test.js tests/threemf_bytes.test.js plugins/cli/tests/paint.test.js
```
