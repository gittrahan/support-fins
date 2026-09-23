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
**auto-fit** fins to its overhangs — but we **cannot** place the result on the live
plate. There is no add-object / import-mesh / make-primitive call anywhere in Orca's
plugin surface (verified across `orca.host`, `orca.script`, `orca.slicing`). The
honest ceiling: compute the fins in-Orca, write a finned `.3mf`, user does
`File ▸ Import`. That still beats the Prusa plugin (real auto-fit, not hand-placed),
it just isn't the "fins land on your plate automatically" the feature request imagined.

The one theoretical write-path is the slicing pipeline (`posSupportMaterial`, "mutate
the live slicing graph") — but that emits support as *toolpaths*, not our contoured
breakaway mesh fin. Different, deeper, lower-fidelity. Not the plan.

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
3. **Next:** read layer height from the active print preset; per-run options
   (tines, coverage, bed pad); a threaded build so a big part doesn't freeze the UI.

## How the plugin is built

```
engine_glue.js            browser-API stand-ins + sfFinPart() entry point
support_fins.template.py  the Orca plugin; @@ENGINE_JS@@ is spliced in
build.py                  esbuild-bundles web/ -> dist/support_fins.py
test_plugin.py            runs dist/ against a stand-in `orca` module
dist/support_fins.py      GENERATED (gitignored) — the file users install
```

Rebuild after **any** change to the engine modules in `web/`:
`python3 plugin/orca/build.py` (needs node; esbuild comes via npx). Test with Orca's
own interpreter in a venv that has `numpy mini-racer trimesh networkx lxml`:
`<venv>/bin/python plugin/orca/test_plugin.py web/dev-models/hub_corner.stl …` —
it checks each .3mf opens as part + fins, a mirrored copy fins correctly, and that
`execute()` opens no files besides its own output.

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
a self-contained V8). Run **Support Fins — fit fins to the plate** from the Plugins
dialog, then `File ▸ Import` each `<part>-fins.3mf` and delete the original part.
