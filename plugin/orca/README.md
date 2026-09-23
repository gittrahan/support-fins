# Support Fins — OrcaSlicer plugin lane

Companion to [printfins.com](https://printfins.com), targeting **OrcaSlicer's Python
plugin system** (embedded CPython; single-`.py` PEP 723 plugins or `.whl`).

## The read/write split that shapes everything here

OrcaSlicer and PrusaSlicer expose **opposite halves** of what this tool needs, and
neither exposes both:

| | read the loaded mesh? | add geometry to the plate? |
|---|---|---|
| **PrusaSlicer 3.0** (Lua) | ❌ no triangle access | ✅ generative (`make_cube`…) — our Prusa plugin drops a fin you hand-place |
| **OrcaSlicer** (Python) | ✅ `orca.host` returns `vertices()`/`triangles()` | ❌ host is **read-only** — "nothing here mutates the model" |

So on Orca we can do the *smart* half Prusa can't — read the user's actual model and
**auto-fit** fins to its overhangs — but we **cannot** add an object to the plate.
Verified in Orca's source (2026-09-22, `src/slic3r/plugin/host/`): the model graph is
read-only, `Plater` exposes only `model()` and dirty flags, and no binding loads a file
or adds/deletes an object.

**The way around it is the slicing pipeline.** A `slicing-pipeline` capability runs at
`Step.posSlice` — right after Orca slices an object, before perimeters — and may edit
each layer's region slices (`SurfaceCollection.set/append`, then `Layer.make_slices()`;
see Orca's own `sandboxes/orca_inset_plugin_any.py`). So the plugin cuts the fins at
every layer height and unions them into the object's slices: the same layers Orca would
get from slicing the part+fins `.3mf`, with no import. The cost: fins appear in the
sliced Preview, not in the 3D editor. The `.3mf` export stays as the second mode for
when you want to see or edit the fins before slicing.

## Status

1. **`support_fins_probe.py` — the spike. ✅ Passed in OrcaSlicer nightly (2026-09-22).**
   Reads the plate via `orca.host` in plate space (rotating a part in Orca changes its
   numbers), 45° overhang math matches, and packages declared in the PEP 723 block
   install via Orca's bundled `uv` — *if* imported at module load (see sandbox rules).
2. **`support_fins.py` — the real plugin. Built, harness-tested, not yet run in Orca.**
   Runs **printfins.com's own engine** (`web/*.js`) in an embedded V8 instead of a
   Python port — the Python spikes had fallen far behind the ~5k lines of JS the
   site runs, and a port would drift from the site every time `fins.js`/`prop.js`
   change. Fins every part on the plate with the site's Auto-mode defaults and writes
   `<part>-fins.3mf` (byte-identical to the site's Export 3MF for the same pose) to
   `~/Downloads/support-fins/`.
3. **Slice-time fins (`Support Fins — add fins when slicing`). Built, harness-tested,
   not yet run in Orca.** Reads the layer height from the live print config.
   `test_slicing.py` poses 4 dev parts plain / tilted+moved / mirrored against a stand-in
   PrintObject built with Orca's frame rules and trimesh-cut layers: all 12 match
   trimesh's cut of part+fins on every layer (0.00% area mismatch). Re-slice cost with
   the fin cache warm: ~0.15–1.4 s per object.
4. **Next:** a docked settings panel (`orca.host.ui.create_dock_panel`) shared by both
   modes — mode, tines, tine density, coverage, bed pad.

## Slice-time mode: the frame

Layer slices are NOT in plate coordinates. From `PrintApply.cpp` / `PrintObject.cpp`:
slices are cut from the mesh under `trafo_centered()` = `trafo()` (first instance's
matrix with its XY translation zeroed; includes shrinkage compensation) followed by an
XY shift of `-center_offset`, the XY centre of `ModelObject::raw_bounding_box()` (model
parts under the instance matrix with no offset). The binding exposes `trafo()` but not
the centre, so the plugin rebuilds it the same way — then cuts its own copy of the part
at a mid layer and compares centroids with Orca's slice. Over 0.05 mm apart it adds
**no** fins and says so (use the `.3mf` export), rather than guessing.

Two cutter details that tests caught: the fin mesh is several closed solids that
overlap/touch by design, so (1) an edge can be shared by four faces — chain segments
through a multimap, never a one-successor dict — and (2) a reference cut must union
body-by-body (cutting the whole soup at once even-odds overlaps into holes).

## How the plugin is built

```
engine_glue.js            browser-API stand-ins + sfFinPart() entry point
support_fins.template.py  the Orca plugin; @@ENGINE_JS@@ is spliced in
build.py                  esbuild-bundles web/ -> dist/support_fins.py
test_plugin.py            runs dist/'s .3mf export against a stand-in `orca` module
test_slicing.py           runs dist/'s slice-time mode against a stand-in PrintObject
dist/support_fins.py      GENERATED (gitignored) — the file users install
```

Rebuild after **any** change to the engine modules in `web/`:
`python3 plugin/orca/build.py` (needs node; esbuild comes via npx). Test with Orca's
own interpreter in a venv that has `numpy mini-racer trimesh networkx lxml`:
`<venv>/bin/python plugin/orca/test_plugin.py web/dev-models/hub_corner.stl …` —
it checks each .3mf opens as part + fins, a mirrored copy fins correctly, and that
`execute()` opens no files besides its own output. `test_slicing.py` (same venv plus
`scipy`) checks every layer against trimesh's cut of part + fins.

## Sandbox rules learned the hard way

- **Import third-party packages at module load, never inside `execute()`.** Orca's
  audit hook is off while plugins load and gates every file open during execution;
  trimesh (reads its own JSON) and V8 (reads its ICU data) both die with
  `PermissionError` / `[AUDIT BLOCKED] … denied path` in the Orca log otherwise.
- **numpy is not bundled** — declare it; `mesh.vertices()` and `matrix()` need it.
- **Host meshes are volume-local.** Apply `instance.matrix() @ volume.matrix()`, and
  flip winding when the determinant is negative (mirrored parts).
- **`ExecutionResult.failure()` takes an `orca.PluginResult` enum**, not a string;
  `skipped(message)` is the safe way to report an error.
- **V8 must run `--jitless`.** mini-racer's JIT SIGTRAPs on macOS (and a hardened app
  may refuse JIT memory anyway). Interpreter mode is ~15× slower: ~0.1–0.3 s for a
  typical part, ~2 s for a 44k-face Voron part.
- **Writing outside Orca's data folder triggers a Yes/No prompt per new file.** The
  plugin falls back to `<data_dir>/support-fins/` if refused.
- **The result dialog flattens newlines** — keep the message to a sentence; the full
  per-part report is printed to the Orca log.

## Install (side-load)

**Needs an OrcaSlicer nightly (or a release newer than 2.4.2)** — the Python plugin
system is not in 2.4.2 stable. First install pulls `numpy` via Orca's bundled `uv`
(declared in the PEP 723 block).

OrcaSlicer → **Plugins** → **Browse plugins ▸ Install local plugin** → pick
`support_fins_probe.py` (or `dist/support_fins.py`). Manual alternative: each plugin needs **its own subfolder** —
`<data_dir>/orca_plugins/support_fins_probe/support_fins_probe.py`. Load a model, then
**Plugins ▸ Run** the probe; the report comes back in the result dialog (and stdout).

Install `dist/support_fins.py` the same way. First install pulls `mini-racer` (~60 MB,
a self-contained V8) and `shapely`. Then either:
- **Slice-time:** Process settings (Advanced mode on) → **Others** → **Slicing Pipeline
  Plugin** → add **Support Fins — add fins when slicing**. Slice; fins are in Preview.
- **Export:** Plugins dialog → run **Support Fins — export finned .3mf**, then
  `File ▸ Import` each `<part>-fins.3mf` and delete the original part.
