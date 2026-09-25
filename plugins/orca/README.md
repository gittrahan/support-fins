# Support Fins — OrcaSlicer plugin lane

Companion to [printfins.com](https://printfins.com), targeting **OrcaSlicer's Python
plugin system** (embedded CPython; single-`.py` PEP 723 plugins or `.whl`).

## Slice-time fins (`src/support_fins_orca.py`) — the write path exists

The table below is right that Orca's *model* API is read-only. But the
**slicing pipeline is writable**: at `Step.posSlice` a plugin can replace each
layer's slice polygons (`LayerRegion.slices.set/append`, then
`Layer.make_slices()`), and Orca carries the edit through perimeters, infill and
G-code. Orca's own samples do exactly this (`sandboxes/orca_inset_plugin_any.py`,
`orca_twistify_plugin_any.py`). This isn't the support-toolpath route either:
at `posSlice` there are no toolpaths yet, only the per-layer polygons a finned STL
would have produced.

So this plugin:

1. reads the part as Orca slices it (`PrintObject.model_object()` volumes through
   `PrintObject.trafo()`),
2. runs **the website's engine, unmodified** — `web/*.js` bundled with esbuild and
   executed in an embedded V8 ([mini-racer](https://pypi.org/project/mini-racer/)).
   The bundle and its bridge are shared with the other plugins
   ([`plugins/shared/`](../shared/README.md)),
3. cross-sections the fin shells at every layer's `slice_z` and merges them into the
   layer (Orca's own `union_ex` fuses the tines into the part).

No export, no re-import, no "fins land on the plate" API needed. Rotate the part,
re-slice, and the fins follow. Parts with Orca's **Enable support** on are skipped,
so the per-object support toggle picks fins vs Orca supports.

```
python3 plugins/orca/build.py                   # -> build/support_fins_orca.py (one file, ~100 KB)
deno test --allow-read tests/ plugins/shared/tests/
python3 -m pytest -q plugins/orca/tests/        # needs numpy, trimesh, scipy, shapely, rtree, networkx, mini-racer
```

Install and turn on (OrcaSlicer 2.5 nightly):

1. Drop `build/support_fins_orca.py` into `<data_dir>/orca_plugins/SupportFins/`
   (or Plugins ▸ Install plugin). Open **Plugins** from the main menu and tick
   **Support Fins**. Orca's bundled `uv` installs `numpy` and `mini-racer` from the
   PEP 723 header on that first activation.
2. Switch the process settings to **Advanced**, open **Others ▸ Slicing Pipeline
   Plugin ▸ Add plugin** and pick **Support Fins**. Activating the plugin alone does
   nothing; the process preset has to reference it.
3. Slice. The first slice of each Orca session shows a few **Plugin permission
   request** prompts (reading Python's own library files, and `socket.__new__`,
   which is the local self-pipe of the asyncio loop mini-racer creates, not network
   access). Answer Yes.

### What the tests pin (offline)

* `plugins/shared/tests/entry.test.js` — the plugin entry places the same fins as the
  website on the same posed part, anywhere on the plate; watertight; walls clear the
  part; tines bite.
* `tests/test_plugin.py` — against `tests/fake_orca.py` (same shapes/units as the real
  bindings): every layer's islands match an **independent** trimesh+shapely slice of
  part + fins, including off-centre placement and XY/Z shrinkage compensation;
  supports-on parts, other steps and a disabled config change nothing; errors come
  back as `RecoverableError`, never an exception mid-slice.
* `plugins/shared/ENGINE-SENSITIVITY.md` — an upstream engine finding (tine placement moves under
  1e-13 mm of noise) and how the plugin neutralises it.

### Checked in a real Orca build (2.5.0-dev nightly, Windows, 2026-09-23)

Part: `lbracket` tilted 35°, Elegoo Centauri Carbon 2 profile, 0.2 mm layers.
Compared the plugin's G-code with the website's finned STL sliced the normal way.

* Plugin log: `4 fin(s), 16 tine(s) on 139 layer(s)`, the same as the engine run
  offline.
* `PrintObject.bounding_box()` is the tight XY footprint, centred on the origin. The
  frame calibration measured a scale of 1.0000000 of nominal.
* From layer 4 up, every layer's wall toolpaths are **identical** to the finned STL.
  Total extrusion is within **0.01 %**.
* Layers 1–3 (the bed pad) overlap 87–97 %. Two Orca-side effects cause it, and
  the plugin now handles the first:
  * Orca puts a layer whose slice plane touches a top face *inside* the solid.
    The plugin now does the same (it was the other way, which dropped one pad layer).
  * Orca applies elephant-foot compensation during slicing, before the hook runs.
    The plugin now shrinks first-layer fins to match, leaving thin walls intact.
    It's approximate, since Orca's own routine is flow-aware.
* **Auto brim** is decided from the plain part, so Orca adds a brim around the pad
  that it wouldn't add for a finned STL. Set Brim type to *No brim* if you don't want it.
* Parts with **Enable support** on are skipped. The log reads `skipped (Orca supports are on for this part)`.

---

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

## Roadmap

1. **`support_fins_probe.py` — the spike (this commit).** Reads the loaded model via
   `orca.host`, runs the 45° overhang classification in **pure numpy** (no trimesh),
   reports faces/bbox/overhang-area per volume, and separately reports whether
   `trimesh` imports. Answers the two unknowns before we port anything: *does the read
   work on a real dragged-in model, and what deps can the port rely on?*
2. **Port the analysis + fit.** `spike_overhangs.py` → region/contact-line, then
   `spike_orient.py` (re-orient to minimise overhang) and `spike_fins.py` (contour the
   breakaway fins). Reimplement trimesh's few calls (submesh, surface sample) in numpy
   if step 1 says trimesh is absent.
3. **Export.** Reuse `web/threemf.js`'s structure (part + fins as separate placed
   objects, mm units, production UUIDs) to write a finned `.3mf` to disk. Filesystem
   writes are permitted (permission-gated audit hook).
4. **Funnel option.** A lightweight "flag my overhangs → open in printfins.com" panel
   using only the read-only mesh API — legit in-slicer discovery within the rules.

## Install (side-load)

OrcaSlicer → **Plugins** dialog → **Browse ▸ Install local plugin** → pick
`support_fins_probe.py`. Or drop it in `<data_dir>/orca_plugins/`. Load a model, then
**Plugins ▸ Run** the probe; the report comes back in the result dialog (and stdout).

**Status:** untested against a live OrcaSlicer build — written to the documented API.
Run the probe first; if it loads and reports sane overhang numbers, phase 2 is greenlit.
